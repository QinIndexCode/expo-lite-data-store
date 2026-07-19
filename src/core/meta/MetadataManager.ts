import { StorageError } from '../../types/storageErrorInfc';
import { isStorageRecord } from '../../types/storageTypes';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { ensureStorageRootReady } from '../../utils/ROOTPath';
import logger from '../../utils/logger';
import withTimeout from '../../utils/withTimeout';

const CURRENT_VERSION = '1.0.0';
const METADATA_PATH_LOCK_TIMEOUT_MS = 30000;

export interface ColumnSchema {
  [field: string]:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'blob'
    | {
        type: 'string' | 'number' | 'boolean' | 'date' | 'blob';
        isHighRisk?: boolean;
      };
}

export interface TableSchema {
  mode: 'single' | 'chunked';
  path: string;
  count: number;
  size?: number;
  lastId?: number;
  chunks?: number;
  createdAt: number;
  updatedAt: number;
  columns: ColumnSchema;
  indexes?: Record<string, 'unique' | 'normal'>;
  isHighRisk?: boolean;
  highRiskFields?: string[];
  encryptedFields?: string[];
  encrypted?: boolean;
  encryptFullTable?: boolean;
  /** Distinguishes new dynamic all-field encryption from legacy empty field metadata. */
  encryptAllFields?: boolean;
  /** Whether this encrypted table is bound to the per-access authentication key scope. */
  requireAuthOnAccess?: boolean;
  /** Internal generation token used to reconcile single-file data and metadata commits. */
  storageCommitToken?: string;
}

export interface DatabaseMeta {
  version: string;
  generatedAt: number;
  tables: Record<string, TableSchema>;
}

type TableMutation =
  | {
      type: 'update';
      tableName: string;
      updates: Partial<TableSchema>;
      updatedAt: number;
      expectedCreatedAt: number;
    }
  | {
      type: 'upsert';
      tableName: string;
      updates: Partial<TableSchema>;
      updatedAt: number;
    }
  | {
      type: 'delete';
      tableName: string;
      expectedCreatedAt?: number;
    };

type PersistedTableSchema = Omit<TableSchema, 'createdAt' | 'updatedAt'> & {
  createdAt?: number;
  updatedAt?: number;
};

interface PersistedDatabaseMeta {
  version: string;
  generatedAt: number;
  tables: Record<string, PersistedTableSchema>;
}

const metadataPathLockTails = new Map<string, Promise<void>>();
const metadataPathMutationEpochs = new Map<string, number>();

const getMetadataPathMutationEpoch = (metaFilePath: string): number =>
  metadataPathMutationEpochs.get(metaFilePath) ?? 0;

const advanceMetadataPathMutationEpoch = (metaFilePath: string): number => {
  const nextEpoch = getMetadataPathMutationEpoch(metaFilePath) + 1;
  metadataPathMutationEpochs.set(metaFilePath, nextEpoch);
  return nextEpoch;
};

const withMetadataPathLock = async <T>(metaFilePath: string, operation: () => Promise<T>): Promise<T> => {
  const previousTail = metadataPathLockTails.get(metaFilePath) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>(resolve => {
    releaseCurrent = resolve;
  });
  const currentTail = previousTail.then(() => currentGate);
  metadataPathLockTails.set(metaFilePath, currentTail);

  try {
    await withTimeout(previousTail, METADATA_PATH_LOCK_TIMEOUT_MS, `acquire metadata lock ${metaFilePath}`);
  } catch (error) {
    releaseCurrent();
    void currentTail.then(() => {
      if (metadataPathLockTails.get(metaFilePath) === currentTail) {
        metadataPathLockTails.delete(metaFilePath);
      }
    });
    throw error;
  }

  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (metadataPathLockTails.get(metaFilePath) === currentTail) {
      metadataPathLockTails.delete(metaFilePath);
    }
  }
};

const createTableMap = (source?: Readonly<Record<string, TableSchema>>): Record<string, TableSchema> => {
  const tables = Object.create(null) as Record<string, TableSchema>;
  if (source) {
    for (const [tableName, schema] of Object.entries(source)) {
      tables[tableName] = schema;
    }
  }
  return tables;
};

const getOwnTable = (tables: Readonly<Record<string, TableSchema>>, tableName: string): TableSchema | undefined =>
  Object.prototype.hasOwnProperty.call(tables, tableName) ? tables[tableName] : undefined;

const createEmptyMetadata = (): DatabaseMeta => ({
  version: CURRENT_VERSION,
  generatedAt: Date.now(),
  tables: createTableMap(),
});

const createDefaultTableSchema = (tableName: string, timestamp: number): TableSchema => ({
  mode: 'single',
  path: `${tableName}.ldb`,
  count: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  columns: {},
});

const mergeTableSchema = (existing: TableSchema, updates: Partial<TableSchema>, updatedAt: number): TableSchema => {
  const merged = {
    ...existing,
    ...updates,
    updatedAt,
  };

  if (Object.prototype.hasOwnProperty.call(updates, 'storageCommitToken') && updates.storageCommitToken === undefined) {
    delete merged.storageCommitToken;
  }

  return merged;
};

const applyTableMutations = (
  snapshot: DatabaseMeta,
  mutations: readonly TableMutation[],
  generatedAt = snapshot.generatedAt
): DatabaseMeta => {
  const tables = createTableMap(snapshot.tables);

  for (const mutation of mutations) {
    if (mutation.type === 'delete') {
      const existing = getOwnTable(tables, mutation.tableName);
      if (existing && existing.createdAt === mutation.expectedCreatedAt) {
        delete tables[mutation.tableName];
      }
      continue;
    }

    const existing = getOwnTable(tables, mutation.tableName);
    if (mutation.type === 'update' && (!existing || existing.createdAt !== mutation.expectedCreatedAt)) {
      continue;
    }
    if (mutation.type === 'upsert' && existing) {
      continue;
    }

    const base = existing ?? createDefaultTableSchema(mutation.tableName, mutation.updatedAt);
    tables[mutation.tableName] = mergeTableSchema(base, mutation.updates, mutation.updatedAt);
  }

  return {
    ...snapshot,
    generatedAt,
    tables,
  };
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isColumnDefinition = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return ['string', 'number', 'boolean', 'date', 'blob'].includes(value);
  }

  return (
    isStorageRecord(value) &&
    typeof value.type === 'string' &&
    ['string', 'number', 'boolean', 'date', 'blob'].includes(value.type) &&
    (value.isHighRisk === undefined || typeof value.isHighRisk === 'boolean')
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isTableSchema = (value: unknown): value is PersistedTableSchema => {
  if (!isStorageRecord(value)) {
    return false;
  }

  if (
    (value.mode !== 'single' && value.mode !== 'chunked') ||
    typeof value.path !== 'string' ||
    !isNonNegativeSafeInteger(value.count) ||
    !isStorageRecord(value.columns) ||
    !Object.values(value.columns).every(isColumnDefinition)
  ) {
    return false;
  }

  if (
    (value.createdAt !== undefined && !isNonNegativeSafeInteger(value.createdAt)) ||
    (value.updatedAt !== undefined && !isNonNegativeSafeInteger(value.updatedAt)) ||
    (value.size !== undefined && !isNonNegativeSafeInteger(value.size)) ||
    (value.lastId !== undefined && !Number.isSafeInteger(value.lastId)) ||
    (value.chunks !== undefined && !isNonNegativeSafeInteger(value.chunks)) ||
    (value.isHighRisk !== undefined && typeof value.isHighRisk !== 'boolean') ||
    (value.encrypted !== undefined && typeof value.encrypted !== 'boolean') ||
    (value.encryptFullTable !== undefined && typeof value.encryptFullTable !== 'boolean') ||
    (value.encryptAllFields !== undefined && typeof value.encryptAllFields !== 'boolean') ||
    (value.requireAuthOnAccess !== undefined && typeof value.requireAuthOnAccess !== 'boolean') ||
    (value.storageCommitToken !== undefined &&
      (typeof value.storageCommitToken !== 'string' || value.storageCommitToken.length === 0)) ||
    (value.highRiskFields !== undefined && !isStringArray(value.highRiskFields)) ||
    (value.encryptedFields !== undefined && !isStringArray(value.encryptedFields))
  ) {
    return false;
  }

  if (
    value.encryptAllFields === true &&
    (value.encrypted !== true ||
      value.encryptFullTable === true ||
      !Array.isArray(value.encryptedFields) ||
      value.encryptedFields.length !== 0)
  ) {
    return false;
  }

  if (value.indexes !== undefined) {
    if (
      !isStorageRecord(value.indexes) ||
      !Object.values(value.indexes).every(index => index === 'unique' || index === 'normal')
    ) {
      return false;
    }
  }

  return true;
};

const isDatabaseMeta = (value: unknown): value is PersistedDatabaseMeta => {
  if (!isStorageRecord(value) || typeof value.version !== 'string' || !isNonNegativeSafeInteger(value.generatedAt)) {
    return false;
  }

  return isStorageRecord(value.tables) && Object.values(value.tables).every(isTableSchema);
};

const normalizeDatabaseMeta = (snapshot: PersistedDatabaseMeta): DatabaseMeta => ({
  ...snapshot,
  tables: createTableMap(
    Object.fromEntries(
      Object.entries(snapshot.tables).map(([tableName, schema]) => {
        const createdAt = schema.createdAt ?? snapshot.generatedAt;
        return [
          tableName,
          {
            ...schema,
            createdAt,
            updatedAt: schema.updatedAt ?? createdAt,
          },
        ];
      })
    )
  ),
});

export class MetadataManager {
  private cache: DatabaseMeta = createEmptyMetadata();

  private dirty = false;
  private pendingMutations: TableMutation[] = [];
  private savePromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void> | null = null;
  private metaFilePath: string | null = null;
  private observedMutationEpoch = -1;

  constructor() {}

  private async getCurrentRootMetaFilePath(): Promise<string> {
    const rootPath = await ensureStorageRootReady();
    return `${rootPath}meta.ldb`;
  }

  private async getMetaFilePath(): Promise<string> {
    if (!this.metaFilePath) {
      this.metaFilePath = await this.getCurrentRootMetaFilePath();
    }

    return this.metaFilePath;
  }

  private getBackupMetaFilePath(metaFilePath: string): string {
    return `${metaFilePath}.bak`;
  }

  private async readSnapshot(metaFilePath: string): Promise<{
    snapshot: DatabaseMeta;
    serialized: string;
  }> {
    const text = await getFileSystem().readAsStringAsync(metaFilePath, {
      encoding: getEncodingType().UTF8,
    });
    const parsed: unknown = JSON.parse(text) as unknown;
    if (!isDatabaseMeta(parsed)) {
      throw new Error('Metadata file has an invalid structure');
    }
    return { snapshot: normalizeDatabaseMeta(parsed), serialized: text };
  }

  private async restoreBackupSnapshot(metaFilePath: string): Promise<DatabaseMeta | undefined> {
    const fileSystem = getFileSystem();
    const backupMetaFilePath = this.getBackupMetaFilePath(metaFilePath);
    const backupInfo = await fileSystem.getInfoAsync(backupMetaFilePath);
    if (!backupInfo.exists) {
      return undefined;
    }

    const { serialized, snapshot } = await this.readSnapshot(backupMetaFilePath);
    await fileSystem.writeAsStringAsync(metaFilePath, serialized, {
      encoding: getEncodingType().UTF8,
    });
    await fileSystem.deleteAsync(backupMetaFilePath, { idempotent: true });
    return snapshot;
  }

  private async discardStaleBackup(metaFilePath: string): Promise<void> {
    const backupMetaFilePath = this.getBackupMetaFilePath(metaFilePath);
    await getFileSystem().deleteAsync(backupMetaFilePath, { idempotent: true });
  }

  private async readLatestSnapshot(
    metaFilePath: string,
    discardBackup: boolean
  ): Promise<{
    snapshot: DatabaseMeta;
    exists: boolean;
  }> {
    const fileSystem = getFileSystem();
    const info = await fileSystem.getInfoAsync(metaFilePath);

    if (!info.exists) {
      try {
        const recoveredSnapshot = await this.restoreBackupSnapshot(metaFilePath);
        if (recoveredSnapshot) {
          return { snapshot: normalizeDatabaseMeta(recoveredSnapshot), exists: true };
        }
      } catch (error) {
        throw new StorageError(
          'Metadata recovery failed: backup could not be restored cleanly',
          'META_FILE_READ_ERROR',
          {
            cause: error,
            details: `Refusing to initialize metadata while recovery backup remains: ${this.getBackupMetaFilePath(metaFilePath)}`,
            suggestion: 'Verify filesystem access, then retry recovery or restore metadata from a known-good backup',
          }
        );
      }

      return { snapshot: createEmptyMetadata(), exists: false };
    }

    try {
      const { snapshot } = await this.readSnapshot(metaFilePath);
      if (discardBackup) {
        await this.discardStaleBackup(metaFilePath);
      }
      return { snapshot: normalizeDatabaseMeta(snapshot), exists: true };
    } catch (error) {
      throw new StorageError('Metadata read failed: metadata file is corrupted or unreadable', 'META_FILE_READ_ERROR', {
        cause: error,
        details: `Refusing to replace the existing metadata file with a potentially stale backup: ${metaFilePath}`,
        suggestion: 'Verify the metadata generation and repair it explicitly before reopening the database',
      });
    }
  }

  private async load(): Promise<void> {
    const activeSave = this.savePromise;
    if (activeSave) {
      await activeSave;
    }

    const metaFilePath = await this.getCurrentRootMetaFilePath();
    this.metaFilePath = metaFilePath;
    const loaded = await withMetadataPathLock(metaFilePath, async () => {
      const latest = await this.readLatestSnapshot(metaFilePath, true);
      if (!latest.exists) {
        await this.persistSnapshot(latest.snapshot, metaFilePath);
      }
      return {
        snapshot: latest.snapshot,
        mutationEpoch: getMetadataPathMutationEpoch(metaFilePath),
      };
    });

    this.cache = applyTableMutations(loaded.snapshot, this.pendingMutations);
    this.dirty = this.pendingMutations.length > 0;
    this.observedMutationEpoch = loaded.mutationEpoch;
  }

  async waitForLoad(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    await this.loadPromise;
  }

  async reload(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await this.save();
    this.loadPromise = this.load();
    await this.loadPromise;
  }

  cleanup(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  async saveImmediately(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  private async persistSnapshot(snapshot: DatabaseMeta, metaFilePath: string): Promise<number> {
    const fileSystem = getFileSystem();
    const tempMetaFilePath = `${metaFilePath}.tmp`;
    const backupMetaFilePath = this.getBackupMetaFilePath(metaFilePath);
    const backupTempMetaFilePath = `${backupMetaFilePath}.tmp`;
    const dirPath = metaFilePath.substring(0, metaFilePath.lastIndexOf('/'));

    try {
      await fileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
    } catch (dirError) {
      logger.warn(`MAKE DIRECTORY FAILED for ${dirPath}`, dirError);
    }

    try {
      await fileSystem.writeAsStringAsync(tempMetaFilePath, JSON.stringify(snapshot, null, 2), {
        encoding: getEncodingType().UTF8,
      });
      const currentInfo = await fileSystem.getInfoAsync(metaFilePath);
      if (currentInfo.exists) {
        const { serialized: currentContent } = await this.readSnapshot(metaFilePath);
        await fileSystem.writeAsStringAsync(backupTempMetaFilePath, currentContent, {
          encoding: getEncodingType().UTF8,
        });
        // Expo's legacy move API does not guarantee destination replacement on
        // every platform, so publish only after removing the stale generation.
        await fileSystem.deleteAsync(backupMetaFilePath, { idempotent: true });
        await fileSystem.moveAsync({ from: backupTempMetaFilePath, to: backupMetaFilePath });
        await fileSystem.deleteAsync(metaFilePath, { idempotent: true });
      }
      await fileSystem.moveAsync({ from: tempMetaFilePath, to: metaFilePath });
      await this.discardStaleBackup(metaFilePath);
      return advanceMetadataPathMutationEpoch(metaFilePath);
    } catch (error) {
      await Promise.allSettled([
        fileSystem.deleteAsync(tempMetaFilePath, { idempotent: true }),
        fileSystem.deleteAsync(backupTempMetaFilePath, { idempotent: true }),
      ]);
      throw error;
    }
  }

  private async flushDirtyState(): Promise<void> {
    while (this.dirty) {
      const metaFilePath = await this.getMetaFilePath();
      const mutations = this.pendingMutations;
      this.pendingMutations = [];
      this.dirty = false;

      if (mutations.length === 0) {
        continue;
      }

      try {
        const persisted = await withMetadataPathLock(metaFilePath, async () => {
          const latest = await this.readLatestSnapshot(metaFilePath, false);
          const merged = applyTableMutations(latest.snapshot, mutations, Date.now());
          const mutationEpoch = await this.persistSnapshot(merged, metaFilePath);
          return { snapshot: merged, mutationEpoch };
        });
        this.cache = applyTableMutations(persisted.snapshot, this.pendingMutations);
        this.observedMutationEpoch = persisted.mutationEpoch;
      } catch (error) {
        this.pendingMutations = [...mutations, ...this.pendingMutations];
        this.dirty = true;
        if (error instanceof StorageError && error.code === 'TIMEOUT') {
          throw error;
        }
        throw new StorageError('Metadata write failed', 'META_FILE_WRITE_ERROR', { cause: error });
      }
    }
  }

  private async save(): Promise<void> {
    if (this.savePromise) {
      await this.savePromise;
      if (this.dirty) {
        await this.save();
      }
      return;
    }

    const activeLoad = this.loadPromise;
    if (activeLoad) {
      await activeLoad;
    }

    if (!this.dirty) return;

    const savePromise = this.flushDirtyState();
    this.savePromise = savePromise;
    try {
      await savePromise;
    } finally {
      if (this.savePromise === savePromise) {
        this.savePromise = null;
      }
    }

    if (this.dirty) {
      await this.save();
    }
  }

  private triggerSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 10 : 200;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(error => {
        logger.error('[MetadataManager] Failed to persist metadata:', error);
      });
    }, delay);
  }

  get(tableName: string): TableSchema | undefined {
    return getOwnTable(this.cache.tables, tableName);
  }

  async getPersisted(tableName: string): Promise<TableSchema | undefined> {
    const metaFilePath = await this.getCurrentRootMetaFilePath();
    return withMetadataPathLock(metaFilePath, async () => {
      const latest = await this.readLatestSnapshot(metaFilePath, false);
      return getOwnTable(latest.snapshot.tables, tableName);
    });
  }

  async getLatest(tableName: string): Promise<TableSchema | undefined> {
    await this.waitForLoad();
    const activeSave = this.savePromise;
    if (activeSave) {
      await activeSave;
    }

    const metaFilePath = await this.getCurrentRootMetaFilePath();
    if (this.metaFilePath !== metaFilePath) {
      await this.reload();
    }

    if (this.observedMutationEpoch === getMetadataPathMutationEpoch(metaFilePath)) {
      return this.get(tableName);
    }

    const refreshed = await withMetadataPathLock(metaFilePath, async () => {
      const latest = await this.readLatestSnapshot(metaFilePath, false);
      return {
        snapshot: latest.snapshot,
        mutationEpoch: getMetadataPathMutationEpoch(metaFilePath),
      };
    });

    const saveStartedDuringRefresh = this.savePromise;
    if (saveStartedDuringRefresh) {
      await saveStartedDuringRefresh;
      return this.getLatest(tableName);
    }
    if (refreshed.mutationEpoch !== getMetadataPathMutationEpoch(metaFilePath)) {
      return this.getLatest(tableName);
    }

    this.cache = applyTableMutations(refreshed.snapshot, this.pendingMutations);
    this.dirty = this.pendingMutations.length > 0;
    this.observedMutationEpoch = refreshed.mutationEpoch;
    return this.get(tableName);
  }

  async getAsync(tableName: string): Promise<TableSchema | undefined> {
    await this.waitForLoad();
    return this.get(tableName);
  }

  getPath(tableName: string): string {
    return this.get(tableName)?.path || `${tableName}.ldb`;
  }

  update(tableName: string, updates: Partial<TableSchema>): void {
    const updatedAt = Date.now();
    const normalizedUpdates = { ...updates };
    const existing = getOwnTable(this.cache.tables, tableName);
    const base = existing ?? createDefaultTableSchema(tableName, updatedAt);

    this.cache.tables[tableName] = mergeTableSchema(base, normalizedUpdates, updatedAt);
    this.pendingMutations.push(
      existing
        ? {
            type: 'update',
            tableName,
            updates: normalizedUpdates,
            updatedAt,
            expectedCreatedAt: existing.createdAt,
          }
        : { type: 'upsert', tableName, updates: normalizedUpdates, updatedAt }
    );

    this.triggerSave();
  }

  async updateAsync(tableName: string, updates: Partial<TableSchema>): Promise<void> {
    await this.waitForLoad();
    this.update(tableName, updates);
  }

  updateSync(tableName: string, updates: Partial<TableSchema>): void {
    this.update(tableName, updates);
  }

  delete(tableName: string): void {
    const existing = getOwnTable(this.cache.tables, tableName);
    delete this.cache.tables[tableName];
    this.pendingMutations.push({ type: 'delete', tableName, expectedCreatedAt: existing?.createdAt });
    this.triggerSave();
  }

  allTables(): string[] {
    return Object.keys(this.cache.tables);
  }

  count(tableName: string): number {
    return this.get(tableName)?.count ?? 0;
  }

  debugDump_checkMetaCache(): DatabaseMeta {
    return this.cache;
  }
}

export const meta = new MetadataManager();
