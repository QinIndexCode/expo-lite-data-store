import type { IStorageAdapter } from '../types/storageAdapterInfc';
import {
  isStorageRecord,
  type BulkOperation,
  type CreateTableOptions,
  type FilterCondition,
  type FindOptions,
  type NonInfer,
  type ReadOptions,
  type StorageInput,
  type StorageRecord,
  type TableOptions,
  type UpdatePayload,
  type WriteOptions,
  type WriteResult,
} from '../types/storageTypes';
import type { LiteStoreConfig } from '../types/config';
import type { TableSchema } from './meta/MetadataManager';
import {
  decrypt,
  getMasterKey,
  getMasterKeyGeneration,
  decryptFields,
  decryptBulk,
  decryptFieldsBulk,
  encrypt,
  encryptFieldsBulk,
  encryptFields,
} from '../utils/crypto';
import { configManager } from './config/ConfigManager';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler as StorageErrorHandler } from '../utils/StorageErrorHandler';
import { StorageError } from '../types/storageErrorInfc';
import { QueryEngine } from './query/QueryEngine';
import logger from '../utils/logger';

type CachedTableData = {
  data: StorageRecord[];
  timestamp: number;
  sourceCiphertext?: string;
};

type FullTableWriteSnapshot = {
  existed: boolean;
  records: StorageRecord[];
  logicalRecordCount?: number;
};

export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string> | null = null;
  private keyGeneration = -1;
  private cacheKeyGeneration = getMasterKeyGeneration();
  private cachedData: Map<string, CachedTableData> = new Map();
  private cacheTimeout = configManager.getConfig().encryption.cacheTimeout; // Read cache timeout from config
  private maxCacheSize = configManager.getConfig().encryption.maxCacheSize; // Read max cache size from config
  private requireAuthOnAccess: boolean = false;
  private pendingLogicalRecordCounts = new Map<string, number>();
  private transactionLogicalRecordCountSnapshots = new Map<string, number>();
  private static tableWriteLocks = new Map<string, Promise<void>>();

  // Optimization: Add query index cache
  private queryIndexes: Map<string, Map<string, Map<string | number, StorageRecord[]>>> = new Map();

  private normalizeStorageInput<T extends object>(data: StorageInput<T>): StorageRecord[] {
    const records: unknown[] = Array.isArray(data) ? data : [data];
    if (!records.every(isStorageRecord)) {
      throw new StorageError('Invalid data: expected an object or an array of objects', 'FILE_CONTENT_INVALID', {
        suggestion: 'Provide a non-null object for every record.',
      });
    }
    return records;
  }

  private normalizeStorageRecord(record: object): StorageRecord {
    if (!isStorageRecord(record)) {
      throw new StorageError('Invalid update payload: expected a non-array object', 'FILE_CONTENT_INVALID', {
        suggestion: 'Provide one non-null object for the update payload.',
      });
    }
    return record;
  }

  private toPublicRecords<T extends object>(records: StorageRecord[]): T[] {
    return records as unknown as T[];
  }

  private toPublicRecord<T extends object>(record: StorageRecord | null): T | null {
    return record as unknown as T | null;
  }

  private toStorageFilter<T extends object>(filter: FilterCondition<T>): FilterCondition<StorageRecord> {
    return filter as unknown as FilterCondition<StorageRecord>;
  }

  private toStorageReadOptions<T extends object>(options?: ReadOptions<T>): ReadOptions<StorageRecord> | undefined {
    return options as unknown as ReadOptions<StorageRecord> | undefined;
  }

  private toStorageFindOptions<T extends object>(options?: FindOptions<T>): FindOptions<StorageRecord> | undefined {
    return options as unknown as FindOptions<StorageRecord> | undefined;
  }

  private normalizeBulkOperations<T extends object>(operations: BulkOperation<T>[]): BulkOperation<StorageRecord>[] {
    return operations.map(operation => {
      switch (operation.type) {
        case 'insert': {
          const records = this.normalizeStorageInput(operation.data);
          return {
            type: 'insert',
            data: Array.isArray(operation.data) ? records : records[0],
          };
        }
        case 'update':
          return {
            type: 'update',
            data: this.normalizeStorageRecord(operation.data),
            where: this.toStorageFilter(operation.where),
          };
        case 'delete':
          return {
            type: 'delete',
            where: this.toStorageFilter(operation.where),
          };
      }
    });
  }

  constructor(options?: { requireAuthOnAccess?: boolean }) {
    this.requireAuthOnAccess = options?.requireAuthOnAccess ?? false;
    this.validateConfig();
  }

  private invalidateCachesIfMasterKeyChanged(): void {
    const currentGeneration = getMasterKeyGeneration();
    if (this.cacheKeyGeneration !== currentGeneration) {
      this.cacheKeyGeneration = currentGeneration;
      this.clearAllCache();
    }
  }

  private async getOrInitKey(): Promise<string> {
    if (this.requireAuthOnAccess) {
      while (true) {
        const currentGeneration = getMasterKeyGeneration();
        const key = await getMasterKey(true);
        if (currentGeneration === getMasterKeyGeneration()) {
          return key;
        }
      }
    }

    while (true) {
      const currentGeneration = getMasterKeyGeneration();
      if (!this.keyPromise || this.keyGeneration !== currentGeneration) {
        this.keyPromise = getMasterKey(false);
        this.keyGeneration = currentGeneration;
      }

      const keyPromise = this.keyPromise!;
      try {
        const key = await keyPromise;
        if (currentGeneration === getMasterKeyGeneration()) {
          return key;
        }
      } catch (error) {
        if (this.keyPromise === keyPromise) {
          this.keyPromise = null;
          this.keyGeneration = -1;
        }
        throw error;
      }

      if (this.keyPromise === keyPromise) {
        this.keyPromise = null;
        this.keyGeneration = -1;
      }
    }
  }

  async ensureInitialized(): Promise<void> {
    await storage.ensureInitialized();

    if (this.requireAuthOnAccess) {
      await this.key();
    }
  }

  private validateConfig(): void {
    const config = configManager.getConfig();
    if (!['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)) {
      throw new Error(
        `Invalid HMAC algorithm: ${config.encryption.hmacAlgorithm}. Must be either 'SHA-256' or 'SHA-512'.`
      );
    }
    if (config.encryption.keyIterations < 10000 || config.encryption.keyIterations > 1000000) {
      throw new Error(`Invalid key iterations: ${config.encryption.keyIterations}. Must be between 10000 and 1000000.`);
    }

    if (config.encryption.cacheTimeout < 0 || config.encryption.cacheTimeout > 3600000) {
      throw new Error(
        `Invalid cache timeout: ${config.encryption.cacheTimeout}. Must be between 0 and 3600000 (1 hour).`
      );
    }
    if (config.encryption.maxCacheSize < 1 || config.encryption.maxCacheSize > 1000) {
      throw new Error(`Invalid max cache size: ${config.encryption.maxCacheSize}. Must be between 1 and 1000.`);
    }
    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      throw new Error(`Invalid useBulkOperations value: ${config.encryption.useBulkOperations}. Must be a boolean.`);
    }
    if (config.encryption.encryptedFields !== undefined && !Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private async normalizeFullTableWriteResult(
    tableName: string,
    result: WriteResult,
    written: number,
    totalAfterWrite: number,
    snapshot?: FullTableWriteSnapshot
  ): Promise<WriteResult> {
    if (this.isStorageTransactionInProgress()) {
      this.rememberLogicalRecordCountBeforeTransactionWrite(tableName);
      this.pendingLogicalRecordCounts.set(tableName, totalAfterWrite);
    } else {
      try {
        await storage.setLogicalRecordCount(tableName, totalAfterWrite);
      } catch (error) {
        await this.restoreFailedFullTableWrite(tableName, snapshot, error);
        throw error;
      }
    }
    return {
      ...result,
      written,
      totalAfterWrite,
    };
  }

  private async key() {
    this.invalidateCachesIfMasterKeyChanged();
    const key = await this.getOrInitKey();
    this.invalidateCachesIfMasterKeyChanged();
    return key;
  }

  private async ensureAccessAuthorized(): Promise<string | undefined> {
    if (this.requireAuthOnAccess) {
      return this.key();
    }

    return undefined;
  }

  private isStorageTransactionInProgress(): boolean {
    return storage.isInTransaction();
  }

  private async withTableWriteLock<T>(tableName: string, operation: () => Promise<T>): Promise<T> {
    const previous = EncryptedStorageAdapter.tableWriteLocks.get(tableName);
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const queued = previous ? previous.then(() => current) : current;
    EncryptedStorageAdapter.tableWriteLocks.set(tableName, queued);

    if (previous) {
      await previous;
    }

    try {
      return await operation();
    } finally {
      releaseCurrent?.();
      if (EncryptedStorageAdapter.tableWriteLocks.get(tableName) === queued) {
        EncryptedStorageAdapter.tableWriteLocks.delete(tableName);
      }
    }
  }

  private rememberLogicalRecordCountBeforeTransactionWrite(tableName: string): void {
    if (this.transactionLogicalRecordCountSnapshots.has(tableName)) {
      return;
    }

    const currentCount = storage.getTableMeta(tableName)?.count;
    if (typeof currentCount === 'number' && Number.isSafeInteger(currentCount) && currentCount >= 0) {
      this.transactionLogicalRecordCountSnapshots.set(tableName, currentCount);
    }
  }

  private async restoreTransactionLogicalRecordCounts(): Promise<void> {
    for (const [tableName, count] of this.transactionLogicalRecordCountSnapshots) {
      await storage.setLogicalRecordCount(tableName, count);
    }
  }

  private async restoreTransactionLogicalRecordCountsSafely(): Promise<void> {
    try {
      await this.restoreTransactionLogicalRecordCounts();
    } catch (error) {
      logger.error('Failed to restore logical record counts after transaction rollback', error);
    }
  }

  private async captureFullTableWriteSnapshot(tableName: string): Promise<FullTableWriteSnapshot> {
    const existed = await storage.hasTable(tableName);
    if (!existed) {
      return { existed: false, records: [] };
    }

    const logicalRecordCount = storage.getTableMeta(tableName)?.count;
    if (typeof logicalRecordCount !== 'number' || !Number.isSafeInteger(logicalRecordCount) || logicalRecordCount < 0) {
      throw new StorageError(
        `Cannot safely update full-table encrypted data for '${tableName}' because its logical record count is invalid`,
        'TABLE_UPDATE_FAILED',
        {
          details: 'The existing logical record count must be a non-negative safe integer before a recoverable write.',
          suggestion: 'Repair the table metadata before retrying the write.',
          tableName,
        }
      );
    }

    const records = await storage.read(tableName, { bypassCache: true });
    return {
      existed: true,
      records: this.cloneRecords(records),
      logicalRecordCount,
    };
  }

  private async prepareFullTableWriteSnapshot(tableName: string): Promise<FullTableWriteSnapshot | undefined> {
    if (this.isStorageTransactionInProgress()) {
      return undefined;
    }

    return this.captureFullTableWriteSnapshot(tableName);
  }

  private async restoreFullTableWriteSnapshot(tableName: string, snapshot: FullTableWriteSnapshot): Promise<void> {
    try {
      if (!snapshot.existed) {
        await storage.deleteTable(tableName);
        return;
      }

      await storage.write(tableName, this.cloneRecords(snapshot.records), { mode: 'overwrite' });
      await storage.setLogicalRecordCount(tableName, snapshot.logicalRecordCount!);
    } finally {
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
    }
  }

  private async restoreFailedFullTableWrite(
    tableName: string,
    snapshot: FullTableWriteSnapshot | undefined,
    originalError: unknown
  ): Promise<void> {
    if (!snapshot) {
      throw new StorageError(
        `Failed to recover full-table encrypted write for '${tableName}' after logical record count publication failed`,
        'TABLE_UPDATE_FAILED',
        {
          cause: originalError,
          details: 'No pre-write snapshot was available for recovery.',
          suggestion: 'Verify the table contents before retrying the write.',
          tableName,
        }
      );
    }

    try {
      await this.restoreFullTableWriteSnapshot(tableName, snapshot);
    } catch (recoveryError) {
      throw new StorageError(
        `Failed to recover full-table encrypted write for '${tableName}' after logical record count publication failed`,
        'TABLE_UPDATE_FAILED',
        {
          cause: originalError,
          details: `Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          suggestion: 'Verify the table contents and metadata before retrying the write.',
          tableName,
        }
      );
    }
  }

  private async getTableMeta(tableName: string) {
    await storage.ensureInitialized();
    const tableMeta = storage.getTableMeta(tableName);
    this.assertTableAccessPolicy(tableName, tableMeta);
    return tableMeta;
  }

  private assertTableAccessPolicy(tableName: string, tableMeta: TableSchema | undefined): void {
    if (tableMeta?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires strict access authentication`, 'PERMISSION_DENIED', {
        details: 'This table is bound to the requireAuthOnAccess key scope.',
        suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
        tableName,
      });
    }

    if (this.requireAuthOnAccess && tableMeta && tableMeta.requireAuthOnAccess !== true) {
      throw new StorageError(
        `Table '${tableName}' is not bound to the strict access-authentication key scope`,
        'MIGRATION_FAILED',
        {
          details:
            'Switching an existing table between normal and strict encryption requires an explicit data migration.',
          suggestion: 'Migrate the table with an application-controlled flow before enabling requireAuthOnAccess.',
          tableName,
        }
      );
    }
  }

  private fullTableCacheKey(tableName: string): string {
    return `__enc_full_table_${tableName}`;
  }

  private cloneRecords(data: StorageRecord[]): StorageRecord[] {
    const cloned: unknown = JSON.parse(JSON.stringify(data));
    if (!Array.isArray(cloned) || !cloned.every(isStorageRecord)) {
      throw new StorageError('Encrypted records could not be cloned safely', 'FILE_CONTENT_INVALID');
    }
    return cloned;
  }

  private parseEncryptedRecords(serializedData: string): StorageRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedData);
    } catch (cause) {
      throw new StorageError('Encrypted data could not be parsed', 'FILE_CONTENT_INVALID', { cause });
    }

    const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (!records.every(isStorageRecord)) {
      throw new StorageError('Encrypted data has an invalid record structure', 'FILE_CONTENT_INVALID');
    }
    return records;
  }

  private getCachedFullTableData(tableName: string, sourceCiphertext: string): StorageRecord[] | undefined {
    if (this.cacheTimeout <= 0) {
      return undefined;
    }

    const entry = this.cachedData.get(this.fullTableCacheKey(tableName));
    if (!entry || entry.sourceCiphertext !== sourceCiphertext || Date.now() - entry.timestamp >= this.cacheTimeout) {
      return undefined;
    }

    return this.cloneRecords(entry.data);
  }

  private cacheFullTableData(tableName: string, data: StorageRecord[], sourceCiphertext: string): void {
    if (this.cacheTimeout <= 0) {
      return;
    }

    this.cachedData.set(this.fullTableCacheKey(tableName), {
      data: this.cloneRecords(data),
      timestamp: Date.now(),
      sourceCiphertext,
    });
    this.manageCacheSize();
  }

  private clearTableCache(tableName: string): void {
    this.cachedData.delete(tableName);
    this.queryIndexes.delete(tableName);
  }

  private clearFullTableCache(tableName: string): void {
    this.cachedData.delete(this.fullTableCacheKey(tableName));
  }

  private resolveConfiguredEncryptedFields(tableMeta: TableSchema | undefined, config: LiteStoreConfig): string[] {
    const tableEncryptedFields = tableMeta?.encryptedFields;
    if (tableEncryptedFields && tableEncryptedFields.length > 0) {
      return tableEncryptedFields;
    }

    return config.encryption.encryptedFields || [];
  }

  private resolveAllRecordFields(data: Record<string, unknown>[]): string[] {
    const fields = new Set<string>();
    for (const item of data) {
      Object.keys(item).forEach(field => fields.add(field));
    }
    return [...fields];
  }

  private resolveFieldsForWrite(
    data: Record<string, unknown>[],
    tableMeta: TableSchema | undefined,
    config: LiteStoreConfig
  ): string[] {
    const configuredFields = this.resolveConfiguredEncryptedFields(tableMeta, config);
    if (configuredFields.length > 0) {
      return configuredFields;
    }

    if (tableMeta?.encrypted) {
      return this.resolveAllRecordFields(data);
    }

    return [];
  }

  private resolveFieldsForRead(
    raw: Record<string, unknown>[],
    tableMeta: TableSchema | undefined,
    config: LiteStoreConfig
  ): string[] {
    const configuredFields = this.resolveConfiguredEncryptedFields(tableMeta, config);
    if (configuredFields.length > 0) {
      return configuredFields;
    }

    if (tableMeta?.encrypted) {
      return this.resolveAllRecordFields(raw);
    }

    return [];
  }

  clearAllCache(): void {
    this.cachedData.clear();
    this.queryIndexes.clear();
  }

  private manageCacheSize(): void {
    if (this.cachedData.size > this.maxCacheSize) {
      const entries = Array.from(this.cachedData.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.cachedData.size - this.maxCacheSize);
      toRemove.forEach(([tableName]) => {
        this.cachedData.delete(tableName);
        // Also clear corresponding query index
        this.queryIndexes.delete(tableName);
      });
    }
  }

  private buildQueryIndex(tableName: string, field: string): void {
    const cached = this.cachedData.get(tableName);
    if (!cached) return;

    const index = new Map<string | number, StorageRecord[]>();
    for (const item of cached.data) {
      const value = item[field];
      if (value !== undefined && value !== null) {
        const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(item);
      }
    }

    if (!this.queryIndexes.has(tableName)) {
      this.queryIndexes.set(tableName, new Map());
    }
    this.queryIndexes.get(tableName)!.set(field, index);
  }

  async createTable<T extends object = StorageRecord>(
    tableName: string,
    options?: CreateTableOptions<T> & {
      enableFieldLevelEncryption?: boolean;
    }
  ): Promise<void> {
    const accessKey = await this.ensureAccessAuthorized();
    const { initialData = [], ...tableOptions } = options ?? {};
    const normalizedInitialData = this.normalizeStorageInput(initialData);
    const alreadyExists = await storage.hasTable(tableName);
    if (alreadyExists) {
      await this.getTableMeta(tableName);
      return;
    }

    if (options?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires a strict encrypted storage adapter`, 'PERMISSION_DENIED', {
        details: 'requireAuthOnAccess must be selected when the encrypted adapter is created.',
        suggestion: 'Create the adapter with requireAuthOnAccess: true before creating the table.',
        tableName,
      });
    }

    await storage.createTable<StorageRecord>(tableName, {
      ...tableOptions,
      encrypted: this.requireAuthOnAccess || tableOptions.encrypted,
      requireAuthOnAccess: this.requireAuthOnAccess,
      initialData: [],
    });

    if (normalizedInitialData.length === 0) {
      return;
    }

    try {
      await this.overwriteWithKey(
        tableName,
        normalizedInitialData,
        {
          encrypted: options?.encrypted,
          requireAuthOnAccess: options?.requireAuthOnAccess,
          encryptFullTable: options?.encryptFullTable,
        },
        accessKey ?? (await this.key())
      );
    } catch (error) {
      try {
        await storage.deleteTable(tableName);
      } catch (cleanupError) {
        logger.error(`Failed to clean up table ${tableName} after encrypted initialization failed`, cleanupError);
      }
      throw error;
    }
  }

  async deleteTable(tableName: string, _options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    return this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      try {
        return await storage.deleteTable(tableName, _options);
      } finally {
        this.clearTableCache(tableName);
        this.clearFullTableCache(tableName);
      }
    });
  }

  async hasTable(tableName: string, _options?: TableOptions): Promise<boolean> {
    await this.ensureAccessAuthorized();
    return storage.hasTable(tableName, _options);
  }

  async listTables(_options?: TableOptions): Promise<string[]> {
    await this.ensureAccessAuthorized();
    return storage.listTables(_options);
  }

  async overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return this.overwriteWithKey(tableName, this.normalizeStorageInput(data), options, await this.key());
  }

  private async overwriteWithKey(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.overwriteWithKeyUnlocked(tableName, data, options, key));
  }

  private async overwriteWithKeyUnlocked(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(this.normalizeStorageInput(data));

        let encryptedData: StorageRecord[] = [];
        let fullTableCiphertext: string | undefined;
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Decide which encryption strategy to use
        const shouldEncryptFullTable = tableMeta?.encryptFullTable === true || options?.encryptFullTable === true;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          // Field-level encryption mode
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config);

          if (config.encryption.useBulkOperations && finalData.length > 1) {
            encryptedData = await encryptFieldsBulk(finalData, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            const encryptionPromises = finalData.map(item =>
              encryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            encryptedData = await Promise.all(encryptionPromises);
          }

          return storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
        } else {
          // Full table encryption mode
          if (shouldEncryptFullTable) {
            // Overwrite mode: Direct encrypted write
            const serializedData = JSON.stringify(finalData);
            const encrypted = await encrypt(serializedData, key);
            encryptedData = [{ __enc: encrypted }];
            fullTableCiphertext = encrypted;
          }
        }

        const fullTableWriteSnapshot = fullTableCiphertext
          ? await this.prepareFullTableWriteSnapshot(tableName)
          : undefined;
        const result = await storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
        const normalizedResult = await this.normalizeFullTableWriteResult(
          tableName,
          result,
          finalData.length,
          finalData.length,
          fullTableWriteSnapshot
        );
        if (fullTableCiphertext) {
          this.cacheFullTableData(tableName, finalData, fullTableCiphertext);
        }
        return normalizedResult;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to overwrite table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.writeWithKey(tableName, this.normalizeStorageInput(data), options, await this.key());
  }

  private async writeWithKey(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.writeWithKeyUnlocked(tableName, data, options, key));
  }

  private async writeWithKeyUnlocked(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(this.normalizeStorageInput(data));

        let encryptedData: StorageRecord[] = [];
        let fullTableTotal: number | undefined;
        let fullTableCacheData: StorageRecord[] | undefined;
        let fullTableCacheCiphertext: string | undefined;
        let fullTableWriteSnapshot: FullTableWriteSnapshot | undefined;
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Decide which encryption strategy to use
        // Only use full-table encryption when encryptFullTable is explicitly true
        // Prefer table metadata encryption config
        const tableEncryptFullTable = tableMeta?.encryptFullTable || false;
        const tableEncrypted = tableMeta?.encrypted || options?.encrypted || false;

        const shouldEncryptFullTable = options?.encryptFullTable === true || tableEncryptFullTable;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          // Prefer table metadata encrypted fields over global config
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config);

          if (config.encryption.useBulkOperations && finalData.length > 1) {
            encryptedData = await encryptFieldsBulk(finalData, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            const encryptionPromises = finalData.map(item =>
              encryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            encryptedData = await Promise.all(encryptionPromises);
          }
          const writeOptions = { ...options };
          delete writeOptions.encrypted;
          delete writeOptions.requireAuthOnAccess;
          return storage.write(tableName, encryptedData, writeOptions);
        } else {
          if (shouldEncryptFullTable) {
            fullTableWriteSnapshot = await this.prepareFullTableWriteSnapshot(tableName);
            if (options?.mode === 'append') {
              // Full-table encryption append mode optimization
              // Optimization 1: Use cache to reduce repeated decryption
              // Optimization 2: Encrypt only new data, not entire table
              // Optimization 3: Use incremental encryption strategy

              // Read existing encrypted data first
              const existingEncrypted =
                fullTableWriteSnapshot?.records ?? (await storage.read(tableName, { bypassCache: true }));
              let combinedData = finalData;

              if (existingEncrypted.length > 0) {
                const existingCiphertext = existingEncrypted[0]?.['__enc'];
                if (typeof existingCiphertext !== 'string') {
                  throw new StorageError('Encrypted table envelope is invalid', 'FILE_CONTENT_INVALID');
                }
                const cachedData = this.getCachedFullTableData(tableName, existingCiphertext);
                const existingData = cachedData ?? this.parseEncryptedRecords(await decrypt(existingCiphertext, key));
                combinedData = [...existingData, ...finalData];
              }

              // The cached plaintext must track every append, including a cache
              // hit, otherwise a later append can overwrite an earlier record.
              fullTableCacheData = combinedData;

              // Optimization 4: Use more efficient serialization and encryption
              const serializedData = JSON.stringify(combinedData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = combinedData.length;
            } else {
              // Overwrite mode: Direct encrypted write
              const serializedData = JSON.stringify(finalData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheData = finalData;
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = finalData.length;
            }
          } else {
            // Not explicitly required full-table, check if table needs encryption
            if (tableEncrypted || options?.encrypted) {
              if (config.encryption.useBulkOperations && finalData.length > 1) {
                encryptedData = await encryptFieldsBulk(finalData, {
                  fields: Object.keys(finalData[0] || {}),
                  masterKey: key,
                });
              } else {
                const encryptionPromises = finalData.map(item =>
                  encryptFields(item, {
                    fields: Object.keys(item),
                    masterKey: key,
                  })
                );
                encryptedData = await Promise.all(encryptionPromises);
              }
            }
          }
        }
        if (encryptedData.length === 0) {
          if (tableEncrypted || options?.encrypted) {
            throw new Error('Encryption logic was not executed for encrypted table');
          }
          encryptedData = finalData;
        }
        const finalWriteOptions = { ...options };
        delete finalWriteOptions.encrypted;
        delete finalWriteOptions.requireAuthOnAccess;
        const storageMode = fullTableTotal !== undefined ? 'overwrite' : options?.mode;
        const result = await storage.write(tableName, encryptedData, { ...finalWriteOptions, mode: storageMode });
        if (fullTableTotal !== undefined) {
          const normalizedResult = await this.normalizeFullTableWriteResult(
            tableName,
            result,
            finalData.length,
            fullTableTotal,
            fullTableWriteSnapshot
          );
          if (fullTableCacheData && fullTableCacheCiphertext) {
            this.cacheFullTableData(tableName, fullTableCacheData, fullTableCacheCiphertext);
          }
          return normalizedResult;
        }
        return result;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async read<T extends object = StorageRecord>(tableName: string, options?: ReadOptions<NonInfer<T>>): Promise<T[]> {
    return this.toPublicRecords<T>(
      await this.readWithKey(tableName, this.toStorageReadOptions(options), await this.key())
    );
  }

  private async readWithKey(
    tableName: string,
    options: ReadOptions<StorageRecord> | undefined,
    key: string
  ): Promise<StorageRecord[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // A zero timeout explicitly disables decrypted data and query-index caches.
        if (this.cacheTimeout === 0) {
          this.cachedData.clear();
          this.queryIndexes.clear();
        }
        const tableMeta = await this.getTableMeta(tableName);
        const readOptions = options ? { bypassCache: options.bypassCache } : undefined;
        const raw = await storage.read<StorageRecord>(tableName, readOptions);
        if (raw.length === 0) {
          this.clearTableCache(tableName);
          this.clearFullTableCache(tableName);
          return [];
        }

        const first = raw[0];
        let result: StorageRecord[] = [];
        const config = configManager.getConfig();
        // Prefer table metadata encrypted fields over global config
        const encryptedFields = this.resolveFieldsForRead(raw, tableMeta, config);

        const encryptedTablePayload = first?.['__enc'];
        const encryptedBulkPayload = first?.['__enc_bulk'];
        if (encryptedTablePayload !== undefined) {
          // Full data decryption
          if (typeof encryptedTablePayload !== 'string') {
            throw new StorageError('Encrypted table payload is invalid', 'FILE_CONTENT_INVALID');
          }
          result = this.parseEncryptedRecords(await decrypt(encryptedTablePayload, key));
          this.cacheFullTableData(tableName, result, encryptedTablePayload);
        } else if (encryptedBulkPayload !== undefined) {
          // Batch data decryption
          if (!Array.isArray(encryptedBulkPayload) || !encryptedBulkPayload.every(value => typeof value === 'string')) {
            throw new StorageError('Encrypted batch payload is invalid', 'FILE_CONTENT_INVALID');
          }
          const decryptedStrings = await decryptBulk(encryptedBulkPayload, key);
          result = decryptedStrings.map(serializedRecord => {
            const records = this.parseEncryptedRecords(serializedRecord);
            if (records.length !== 1) {
              throw new StorageError('Encrypted batch item must contain one record', 'FILE_CONTENT_INVALID');
            }
            return records[0];
          });
        } else if (encryptedFields.length > 0) {
          if (config.encryption.useBulkOperations && raw.length > 1) {
            // Batch field-level decryption
            result = await decryptFieldsBulk(raw, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            // Single field-level decryption
            const decryptionPromises = raw.map(item =>
              decryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            result = await Promise.all(decryptionPromises);
          }
        } else {
          result = raw;
        }
        if (this.cacheTimeout > 0) {
          this.cachedData.set(tableName, {
            data: this.cloneRecords(result),
            timestamp: Date.now(),
          });

          // Manage cache size
          this.manageCacheSize();
          if (configManager.getConfig().performance.enableQueryOptimization && result.length > 0) {
            if (result.some(item => item['id'] !== undefined)) {
              this.buildQueryIndex(tableName, 'id');
            }
            // Build index for other common fields
            const commonFields = ['name', 'email', 'type', 'status'];
            commonFields.forEach(field => {
              if (result.some(item => item[field] !== undefined)) {
                this.buildQueryIndex(tableName, field);
              }
            });
          }
        }

        // Filtering and sorting must observe decrypted fields rather than encrypted envelopes.
        let visibleRecords = result;
        if (options?.filter) {
          visibleRecords = QueryEngine.filter(visibleRecords, options.filter);
        }
        if (options?.sortBy) {
          visibleRecords = QueryEngine.sort(visibleRecords, options.sortBy, options.order, options.sortAlgorithm);
        }

        return this.cloneRecords(QueryEngine.paginate(visibleRecords, options?.skip, options?.limit));
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to read from table ${tableName}`,
          'TABLE_READ_FAILED',
          cause,
          'Decryption or storage operation failed',
          'Check if you have read permissions and the encryption key is valid'
        )
    );
  }

  async count(tableName: string): Promise<number> {
    return this.countWithKey(tableName, await this.key());
  }

  private async countWithKey(tableName: string, key: string): Promise<number> {
    await this.getTableMeta(tableName);
    // Optimization: Get count from cache if valid, avoid reading all data
    const cached = this.cachedData.get(tableName);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data.length;
    }

    // For encrypted tables, read all data to get count
    const data = await this.readWithKey(tableName, undefined, key);
    return data.length;
  }

  /** Reconciles a full-table envelope's logical metadata count with its decrypted row count. */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const key = await this.key();
    const tableMeta = await this.getTableMeta(tableName);
    if (!tableMeta?.encryptFullTable) {
      return storage.verifyCount(tableName);
    }

    const metadata = tableMeta.count ?? 0;
    const actual = await this.countWithKey(tableName, key);
    const match = metadata === actual;
    if (!match && !this.isStorageTransactionInProgress()) {
      await storage.setLogicalRecordCount(tableName, actual);
    }
    return { metadata, actual, match };
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    options?: TableOptions
  ): Promise<T | null> {
    const storageFilter = this.toStorageFilter(filter);
    const result = await StorageErrorHandler.handleAsyncError(
      async () => {
        const key = await this.key();
        await this.getTableMeta(tableName);
        // Optimization: Use index for fast lookup
        if (configManager.getConfig().performance.enableQueryOptimization) {
          const tableIndexes = this.queryIndexes.get(tableName);
          if (tableIndexes && isStorageRecord(storageFilter)) {
            const filterRecord = storageFilter as StorageRecord;
            // Find index fields used in filter
            const filterFields = Object.keys(filterRecord);
            for (const field of filterFields) {
              if (tableIndexes.has(field)) {
                const fieldIndex = tableIndexes.get(field)!;
                const filterValue = filterRecord[field];
                const serializedValue = typeof filterValue === 'object' ? JSON.stringify(filterValue) : undefined;
                const indexKey = serializedValue ?? String(filterValue);

                // Find matching data from index
                const indexedData = fieldIndex.get(indexKey) || [];
                if (indexedData.length > 0) {
                  // If matches found, use QueryEngine for more precise filtering
                  const filtered = QueryEngine.filter(indexedData, storageFilter);
                  if (filtered.length > 0) {
                    return this.cloneRecords([filtered[0]])[0];
                  }
                }
              }
            }
          }
        }

        // No usable index or not found, fallback to read all data
        const data = await this.readWithKey(tableName, options, key);
        const filtered = QueryEngine.filter(data, storageFilter);
        return filtered.length > 0 ? this.cloneRecords([filtered[0]])[0] : null;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to findOne in table ${tableName}`,
          'QUERY_FAILED',
          cause,
          'Query operation failed',
          'Check if your query filter is valid and the table exists'
        )
    );
    return this.toPublicRecord<T>(result);
  }

  async findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    findOptions?: TableOptions
  ): Promise<T[]> {
    const key = await this.key();
    // Prefer cache
    const readOptions: ReadOptions<StorageRecord> | undefined = findOptions ? { ...findOptions } : undefined;

    let data = await this.readWithKey(tableName, readOptions, key);
    if (filter) {
      const filtered = QueryEngine.filter(data, this.toStorageFilter(filter));
      data = filtered;
    }

    // Apply sorting
    const storageOptions = this.toStorageFindOptions(options);
    if (storageOptions?.sortBy) {
      data = QueryEngine.sort(data, storageOptions.sortBy, storageOptions.order, storageOptions.sortAlgorithm);
    } else {
      // Default sort by id, ensure consistent pagination
      data = QueryEngine.sort(data, 'id', 'asc', storageOptions?.sortAlgorithm);
    }
    const skip = storageOptions?.skip || 0;
    const limit = storageOptions?.limit;

    if (limit !== undefined) {
      return this.toPublicRecords<T>(this.cloneRecords(data.slice(skip, skip + limit)));
    } else {
      return this.toPublicRecords<T>(this.cloneRecords(data.slice(skip)));
    }
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: TableOptions
  ): Promise<WriteResult> {
    const key = await this.key();
    const normalizedOperations = this.normalizeBulkOperations(operations);
    if (normalizedOperations.length > 0 && normalizedOperations.every(operation => operation.type === 'insert')) {
      const insertItems = normalizedOperations.flatMap(operation =>
        Array.isArray(operation.data) ? operation.data : [operation.data]
      );
      const result = await this.writeWithKey(tableName, insertItems, { ...options, mode: 'append' }, key);
      return {
        ...result,
        written: insertItems.length,
      };
    }

    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      let finalData = [...allData];
      let writtenCount = 0;

      for (const operation of normalizedOperations) {
        if (operation.type === 'insert') {
          const insertData = Array.isArray(operation.data) ? operation.data : [operation.data];
          finalData = [...finalData, ...insertData];
          writtenCount += insertData.length;
        } else if (operation.type === 'update') {
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          const matchedItemRefs = new Set(matchedItems);
          finalData = finalData.map(item =>
            matchedItemRefs.has(item) ? QueryEngine.update(item, operation.data) : item
          );
          writtenCount += matchedItems.length;
        } else if (operation.type === 'delete') {
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          const matchedItemRefs = new Set(matchedItems);
          finalData = finalData.filter(item => !matchedItemRefs.has(item));
          writtenCount += matchedItems.length;
        }
      }

      const result = await this.writeWithKeyUnlocked(tableName, finalData, { ...options, mode: 'overwrite' }, key);

      return { ...result, written: writtenCount };
    });
  }

  async migrateToChunked(tableName: string): Promise<void> {
    await this.ensureAccessAuthorized();
    await this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
      await storage.migrateToChunked(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
    });
  }

  async delete<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    const key = await this.key();
    const storageWhere = this.toStorageFilter(where);
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const matchedItemRefs = new Set(matchedItems);
      const remainingData = allData.filter(item => !matchedItemRefs.has(item));

      await this.writeWithKeyUnlocked(tableName, remainingData, { ...options, mode: 'overwrite' }, key);
      return matchedItems.length;
    });
  }

  async beginTransaction(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    await storage.beginTransaction(options);
    this.pendingLogicalRecordCounts.clear();
    this.transactionLogicalRecordCountSnapshots.clear();
  }

  async commit(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    const pendingCounts = new Map(this.pendingLogicalRecordCounts);
    try {
      await storage.commit(options, async () => {
        for (const [tableName, count] of pendingCounts) {
          await storage.setLogicalRecordCount(tableName, count);
        }
      });
    } catch (error) {
      await this.restoreTransactionLogicalRecordCountsSafely();
      throw error;
    } finally {
      this.clearAllCache();
      this.pendingLogicalRecordCounts.clear();
      this.transactionLogicalRecordCountSnapshots.clear();
    }
  }

  async rollback(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    try {
      await storage.rollback(options);
    } finally {
      await this.restoreTransactionLogicalRecordCountsSafely();
      this.clearAllCache();
      this.pendingLogicalRecordCounts.clear();
      this.transactionLogicalRecordCountSnapshots.clear();
    }
  }

  async update<T extends object = StorageRecord>(
    tableName: string,
    data: UpdatePayload<T>,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    const key = await this.key();
    const storageData = this.normalizeStorageRecord(data);
    const storageWhere = this.toStorageFilter(where);
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const matchedItemRefs = new Set(matchedItems);
      let updatedCount = 0;
      const updatedData = allData.map(item => {
        if (matchedItemRefs.has(item)) {
          updatedCount++;
          return QueryEngine.update(item, storageData);
        }
        return item;
      });

      await this.writeWithKeyUnlocked(tableName, updatedData, { ...options, mode: 'overwrite' }, key);
      return updatedCount;
    });
  }

  async remove<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    return this.delete(tableName, where, options);
  }

  async clearTable(tableName: string): Promise<void> {
    await this.ensureAccessAuthorized();
    await this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
      await storage.clearTable(tableName);
    });
  }

  async insert<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.write(tableName, data, { ...options, mode: 'append' });
  }
}
