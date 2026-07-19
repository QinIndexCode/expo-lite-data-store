import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { StorageError } from '../../types/storageErrorInfc';
import type {
  ColumnDefinition,
  CreateTableOptions,
  FilterCondition,
  InternalWriteOptions,
  StorageInput,
  StorageRecord,
  WriteResult,
} from '../../types/storageTypes';
import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import logger from '../../utils/logger';

import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { FileHandlerBase } from '../file/FileHandlerBase';
import { createStorageCommitToken, SingleFileHandler } from '../file/SingleFileHandler';
import { assertValidTableName } from '../../utils/tableName';
import { IndexManager, type Index } from '../index/IndexManager';
import type { ColumnSchema, TableSchema } from '../meta/MetadataManager';
import { QueryEngine } from '../query/QueryEngine';
import { getLogicalRecordCount, hasDynamicFieldEncryption } from '../service/TransactionService';

class SingleFileRecoveryError extends Error {
  constructor(
    readonly primaryError: unknown,
    readonly recoveryErrors: readonly unknown[]
  ) {
    const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
    super(
      `Single-file recovery failed after metadata persistence error: ${describe(primaryError)}; ` +
        `recovery errors: ${recoveryErrors.map(describe).join('; ')}`
    );
    this.name = 'SingleFileRecoveryError';
  }
}

class TableDeleteMetadataRecoveryError extends Error {
  constructor(
    readonly commitError: unknown,
    readonly recoveryError: unknown
  ) {
    const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
    super(
      `Table deletion metadata commit failed: ${describe(commitError)}; ` +
        `restoring the original metadata also failed: ${describe(recoveryError)}`
    );
    this.name = 'TableDeleteMetadataRecoveryError';
  }
}

class TableArtifactCleanupError extends Error {
  constructor(
    tableName: string,
    readonly failures: readonly { path: string; error: unknown }[]
  ) {
    super(`Failed to remove ${failures.length} physical artifact(s) for table '${tableName}'`);
    this.name = 'TableArtifactCleanupError';
  }
}

export class DataWriter {
  private static readonly operationLocks = new Map<string, Promise<void>>();

  private chunkSize: number;
  private indexManager: IndexManager;
  private metadataManager: IMetadataManager;
  private countValidationCache = new Map<string, { lastCheckTime: number; isAccurate: boolean }>();
  private countValidationInFlight = new Map<string, Promise<void>>();
  private readonly VALIDATION_INTERVAL = 5 * 60 * 1000;
  private readonly MAX_VALIDATION_CACHE_SIZE = 100;
  private readonly LOCK_TIMEOUT = 30 * 1000;
  private activeOperations = 0;
  private readonly maxConcurrentOperations: number;
  private operationQueue: Array<() => void> = [];

  constructor(metadataManager: IMetadataManager, indexManager: IndexManager) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
    this.chunkSize = configManager.getConfig().chunkSize;
    this.maxConcurrentOperations = configManager.getConfig().performance.maxConcurrentOperations || 5;
  }

  private static readonly supportedColumnTypes = ['string', 'number', 'boolean', 'date', 'blob'] as const;

  private static isSupportedColumnType(value: string): value is (typeof DataWriter.supportedColumnTypes)[number] {
    return (DataWriter.supportedColumnTypes as readonly string[]).includes(value);
  }

  private normalizeColumnSchema(columns?: Record<string, ColumnDefinition>): ColumnSchema {
    const schema: ColumnSchema = {};
    if (!columns) return schema;

    for (const [column, definition] of Object.entries(columns)) {
      let type: string;
      let isHighRisk = false;

      if (typeof definition === 'string') {
        type = definition;
      } else {
        type = definition.type;
        isHighRisk = definition.isHighRisk || false;
      }

      if (!DataWriter.isSupportedColumnType(type)) {
        throw StorageErrorHandler.createGeneralError(
          `Unsupported column type: ${column}: ${type}`,
          'TABLE_COLUMN_INVALID',
          undefined,
          `Column '${column}' has an unsupported type '${type}'`,
          'Please use one of the supported types: string, number, boolean, date, blob'
        );
      }

      if (isHighRisk) {
        schema[column] = {
          type,
          isHighRisk,
        };
      } else {
        schema[column] = type;
      }
    }
    return schema;
  }

  private getSingleFile(tableName: string): SingleFileHandler {
    assertValidTableName(tableName);
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    return new SingleFileHandler(filePath, async () =>
      this.metadataManager.getPersisted
        ? await this.metadataManager.getPersisted(tableName)
        : this.metadataManager.get(tableName)
    );
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    assertValidTableName(tableName);
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  private async getLatestTableMetadata(tableName: string): Promise<TableSchema | undefined> {
    const cachedMetadata = this.metadataManager.get(tableName);
    const latestMetadata = this.metadataManager.getLatest
      ? await this.metadataManager.getLatest(tableName)
      : cachedMetadata;
    if (latestMetadata !== cachedMetadata) {
      this.indexManager.invalidateTableIndexes(tableName);
    }
    return latestMetadata;
  }

  private getTableArtifactPaths(tableName: string): {
    singleFile: string;
    singleTempFile: string;
    singleBackupFile: string;
    singleBackupTempFile: string;
    singleCommitMarker: string;
    singleCommitMarkerTemp: string;
    chunkDirectory: string;
    overwriteBackupDirectory: string;
    journals: string[];
  } {
    assertValidTableName(tableName);
    const tablePath = `${getRootPathSync()}${tableName}`;
    return {
      singleFile: `${tablePath}.ldb`,
      singleTempFile: `${tablePath}.ldb.tmp`,
      singleBackupFile: `${tablePath}.ldb.bak`,
      singleBackupTempFile: `${tablePath}.ldb.bak.tmp`,
      singleCommitMarker: `${tablePath}.ldb.commit-marker`,
      singleCommitMarkerTemp: `${tablePath}.ldb.commit-marker.tmp`,
      chunkDirectory: `${tablePath}/`,
      overwriteBackupDirectory: `${tablePath}.overwrite-backup/`,
      journals: [
        `${tablePath}.overwrite-journal`,
        `${tablePath}.overwrite-journal.tmp`,
        `${tablePath}.append-journal`,
        `${tablePath}.append-journal.tmp`,
      ],
    };
  }

  private async deleteTableArtifact(path: string): Promise<void> {
    try {
      await withTimeout(
        getFileSystem().deleteAsync(path, { idempotent: true }),
        10000,
        `delete table artifact ${path}`
      );
    } finally {
      FileHandlerBase.invalidateFileInfoCache(path, path.endsWith('/'));
    }
  }

  /** Removes every physical representation after the metadata deletion is durable. */
  private async purgeTableArtifacts(tableName: string, mode?: 'single' | 'chunked'): Promise<void> {
    const {
      singleFile,
      singleTempFile,
      singleBackupFile,
      singleBackupTempFile,
      singleCommitMarker,
      singleCommitMarkerTemp,
      chunkDirectory,
      overwriteBackupDirectory,
      journals,
    } = this.getTableArtifactPaths(tableName);
    const paths =
      mode === 'single'
        ? [
            chunkDirectory,
            overwriteBackupDirectory,
            ...journals,
            singleBackupTempFile,
            singleBackupFile,
            singleCommitMarkerTemp,
            singleCommitMarker,
            singleTempFile,
            singleFile,
          ]
        : mode === 'chunked'
          ? [
              singleFile,
              singleTempFile,
              singleBackupFile,
              singleBackupTempFile,
              singleCommitMarker,
              singleCommitMarkerTemp,
              ...journals,
              overwriteBackupDirectory,
              chunkDirectory,
            ]
          : [
              singleTempFile,
              singleBackupFile,
              singleBackupTempFile,
              singleCommitMarker,
              singleCommitMarkerTemp,
              ...journals,
              overwriteBackupDirectory,
              singleFile,
              chunkDirectory,
            ];

    const failures: Array<{ path: string; error: unknown }> = [];
    for (const path of paths) {
      try {
        await this.deleteTableArtifact(path);
      } catch (error) {
        failures.push({ path, error });
      }
    }

    if (failures.length > 0) {
      throw new TableArtifactCleanupError(tableName, failures);
    }
  }

  private async cleanupMigratedSingleFileArtifacts(tableName: string): Promise<void> {
    const {
      singleFile,
      singleTempFile,
      singleBackupFile,
      singleBackupTempFile,
      singleCommitMarker,
      singleCommitMarkerTemp,
    } = this.getTableArtifactPaths(tableName);

    for (const path of [
      singleTempFile,
      singleBackupTempFile,
      singleBackupFile,
      singleCommitMarkerTemp,
      singleCommitMarker,
      singleFile,
    ]) {
      try {
        await this.deleteTableArtifact(path);
      } catch (error) {
        logger.warn(`DELETE MIGRATED SINGLE-FILE ARTIFACT FAILED for ${path}`, error);
      }
    }
  }

  private async persistMetadataIfSupported(): Promise<void> {
    if (typeof this.metadataManager.saveImmediately === 'function') {
      await this.metadataManager.saveImmediately();
    }
  }

  private snapshotTableMetadata(tableName: string, source?: TableSchema): TableSchema | undefined {
    const metadata = source ?? this.metadataManager.get(tableName);
    if (!metadata) {
      return undefined;
    }

    return {
      ...metadata,
      columns: { ...metadata.columns },
      indexes: metadata.indexes ? { ...metadata.indexes } : undefined,
      highRiskFields: metadata.highRiskFields ? [...metadata.highRiskFields] : undefined,
      encryptedFields: metadata.encryptedFields ? [...metadata.encryptedFields] : undefined,
    };
  }

  private restoreTableMetadata(tableName: string, snapshot: TableSchema | undefined): void {
    if (snapshot) {
      this.metadataManager.update(tableName, snapshot);
    } else {
      this.metadataManager.delete(tableName);
    }
  }

  private cloneIndexData(data: Index['data']): Index['data'] {
    return new Map(Array.from(data.entries(), ([key, items]) => [key, items.map(item => ({ ...item }))]));
  }

  private snapshotIndexes(tableName: string): Index[] {
    return this.indexManager.getTableIndexes(tableName).map(index => ({
      ...index,
      fields: [...index.fields],
      data: this.cloneIndexData(index.data),
    }));
  }

  private async restoreIndexes(tableName: string, snapshots: Index[]): Promise<void> {
    this.indexManager.clearTableIndexes(tableName);

    for (const snapshot of snapshots) {
      await this.indexManager.createIndex(tableName, snapshot.fields, snapshot.type);
      const restoredIndex = this.indexManager.getTableIndexes(tableName).find(index => index.name === snapshot.name);
      if (!restoredIndex) {
        throw new Error(`Failed to restore index ${snapshot.name} for table ${tableName}`);
      }
      restoredIndex.data = this.cloneIndexData(snapshot.data);
      restoredIndex.ready = snapshot.ready;
    }
  }

  private async rollbackSingleFileMutation(
    tableName: string,
    handler: SingleFileHandler,
    metadataSnapshot: TableSchema | undefined,
    indexSnapshots: Index[],
    primaryError: unknown
  ): Promise<void> {
    const recoveryErrors: unknown[] = [];
    let metadataRollbackCommitted = false;

    try {
      await handler.rollbackPendingWrite(async () => {
        this.restoreTableMetadata(tableName, metadataSnapshot);
        await this.persistMetadataIfSupported();
        metadataRollbackCommitted = true;
      });
    } catch (error) {
      recoveryErrors.push(error);
    }

    if (metadataRollbackCommitted) {
      try {
        await this.restoreIndexes(tableName, indexSnapshots);
      } catch (error) {
        recoveryErrors.push(error);
      }
    }

    if (recoveryErrors.length > 0) {
      throw new SingleFileRecoveryError(primaryError, recoveryErrors);
    }
  }

  private shouldUseChunkedMode(data: StorageRecord[]): boolean {
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
    return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
  }

  private createLockTimeoutError(tableName: string): StorageError {
    return StorageErrorHandler.createGeneralError(
      `Lock acquisition timeout for table: ${tableName}`,
      'LOCK_TIMEOUT',
      undefined,
      `Failed to acquire lock within ${this.LOCK_TIMEOUT / 1000} seconds`,
      'This may indicate a deadlock or long-running operation. Please try again.'
    );
  }

  private async acquireOperationSlot(): Promise<void> {
    if (this.activeOperations < this.maxConcurrentOperations && this.operationQueue.length === 0) {
      this.activeOperations++;
      return;
    }

    await new Promise<void>(resolve => {
      this.operationQueue.push(() => {
        this.activeOperations++;
        resolve();
      });
    });
  }

  private releaseOperationSlot(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);

    if (this.operationQueue.length > 0 && this.activeOperations < this.maxConcurrentOperations) {
      const nextOperation = this.operationQueue.shift();
      if (nextOperation) {
        nextOperation();
      }
    }
  }

  private async acquireLock(tableName: string): Promise<() => void> {
    assertValidTableName(tableName);
    const lockKey = `${getRootPathSync()}${tableName}`;
    const previousLock = DataWriter.operationLocks.get(lockKey) ?? Promise.resolve();

    let resolveLock!: () => void;
    const lockPromise = new Promise<void>(resolve => {
      resolveLock = resolve;
    });
    const lockTail = previousLock.then(() => lockPromise);

    DataWriter.operationLocks.set(lockKey, lockTail);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        previousLock,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(this.createLockTimeoutError(tableName));
          }, this.LOCK_TIMEOUT);
        }),
      ]);
      await this.acquireOperationSlot();
    } catch (error) {
      resolveLock();
      void lockTail.then(() => {
        if (DataWriter.operationLocks.get(lockKey) === lockTail) {
          DataWriter.operationLocks.delete(lockKey);
        }
      });
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      resolveLock();
      if (DataWriter.operationLocks.get(lockKey) === lockTail) {
        DataWriter.operationLocks.delete(lockKey);
      }
      this.releaseOperationSlot();
    };
  }

  async createTable(
    tableName: string,
    options: CreateTableOptions<StorageRecord> & {
      columns?: Record<string, ColumnDefinition>;
      initialData?: StorageRecord[];
      mode?: 'single' | 'chunked';
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {}
  ): Promise<void> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        assertValidTableName(tableName);

        const releaseLock = await this.acquireLock(tableName);

        try {
          if (await this.getLatestTableMetadata(tableName)) {
            return;
          }

          await this.purgeTableArtifacts(tableName);

          const { columns = {}, initialData = [], mode = 'single' } = options;

          const actualMode = mode === 'chunked' || this.shouldUseChunkedMode(initialData) ? 'chunked' : 'single';

          let singleFileHandler: SingleFileHandler | undefined;
          let singleFileCommitToken: string | undefined;
          let chunkedFileHandler: ChunkedFileHandler | undefined;
          if (actualMode === 'chunked') {
            chunkedFileHandler = this.getChunkedHandler(tableName);
            await chunkedFileHandler.append(initialData);
          } else {
            singleFileHandler = this.getSingleFile(tableName);
            singleFileCommitToken = createStorageCommitToken();
            await singleFileHandler.writeRecoverably(initialData, singleFileCommitToken);
          }

          try {
            const chunkMeta = actualMode === 'chunked' ? this.metadataManager.get(tableName) : undefined;

            this.metadataManager.update(tableName, {
              mode: actualMode,
              path: actualMode === 'chunked' ? `${tableName}/` : `${tableName}.ldb`,
              count: initialData.length,
              chunks: actualMode === 'chunked' ? (chunkMeta?.chunks ?? 0) : 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              columns: this.normalizeColumnSchema(columns),
              isHighRisk: options.isHighRisk || false,
              highRiskFields: options.highRiskFields || [],
              encryptedFields: options.encryptedFields || [],
              encrypted:
                options.encrypted === true || options.encryptFullTable === true || options.requireAuthOnAccess === true,
              encryptFullTable: options.encryptFullTable || false,
              ...(hasDynamicFieldEncryption(options) ? { encryptAllFields: true } : {}),
              requireAuthOnAccess: options.requireAuthOnAccess === true,
              storageCommitToken: singleFileCommitToken,
            });
            await this.persistMetadataIfSupported();
          } catch (error) {
            if (singleFileHandler) {
              await this.rollbackSingleFileMutation(tableName, singleFileHandler, undefined, [], error);
            } else if (chunkedFileHandler) {
              const recoveryErrors: unknown[] = [];
              try {
                await this.purgeTableArtifacts(tableName, 'chunked');
              } catch (cleanupError) {
                recoveryErrors.push(cleanupError);
              }
              try {
                this.metadataManager.delete(tableName);
                await this.persistMetadataIfSupported();
              } catch (cleanupError) {
                recoveryErrors.push(cleanupError);
              }
              if (recoveryErrors.length > 0) {
                logger.error(`failed to clean up chunked table ${tableName} after creation failure`, recoveryErrors);
              }
            }
            throw error;
          }

          await singleFileHandler?.commitPendingWrite();
        } finally {
          releaseLock();
        }
      },
      error => {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
          logger.error('[DataWriter.createTable] failed:', {
            tableName,
            mode: options.mode ?? 'single',
            initialRecordCount: options.initialData?.length ?? 0,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        return StorageErrorHandler.createTableError('create', tableName, error);
      }
    );
  }

  async deleteTable(tableName: string): Promise<void> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const releaseLock = await this.acquireLock(tableName);

        try {
          const metadataSnapshot = this.snapshotTableMetadata(tableName, await this.getLatestTableMetadata(tableName));
          this.metadataManager.delete(tableName);
          try {
            await this.persistMetadataIfSupported();
          } catch (commitError) {
            this.restoreTableMetadata(tableName, metadataSnapshot);
            try {
              await this.persistMetadataIfSupported();
            } catch (recoveryError) {
              throw new StorageError(
                `Failed to delete table '${tableName}' and restore its metadata`,
                'TABLE_DELETE_FAILED',
                {
                  cause: new TableDeleteMetadataRecoveryError(commitError, recoveryError),
                  details: 'The physical table was not modified, but metadata recovery is still pending.',
                  suggestion: 'Retry after restoring metadata storage access.',
                  tableName,
                }
              );
            }

            throw new StorageError(`Failed to commit deletion of table '${tableName}'`, 'TABLE_DELETE_FAILED', {
              cause: commitError,
              details: 'The original metadata and physical table were preserved.',
              suggestion: 'Retry after restoring metadata storage access.',
              tableName,
            });
          }

          try {
            this.indexManager.clearTableIndexes(tableName);
            await this.purgeTableArtifacts(tableName, metadataSnapshot?.mode);
          } catch (cleanupError) {
            throw new StorageError(
              `Table '${tableName}' was deleted but physical cleanup is incomplete`,
              'TABLE_DELETE_FAILED',
              {
                cause: cleanupError,
                details: 'The metadata deletion is durable, so the table remains logically absent.',
                suggestion: 'Retry deleteTable with the same name to remove orphaned artifacts.',
                tableName,
              }
            );
          }
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createTableError('delete', tableName, error)
    );
  }

  /**
   * Convert a single-file table while holding the same table lock used by
   * writes, so a migration cannot snapshot past a concurrent append.
   */
  async migrateToChunked(tableName: string): Promise<void> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        assertValidTableName(tableName);
        const releaseLock = await this.acquireLock(tableName);

        try {
          const tableMeta = await this.getLatestTableMetadata(tableName);
          if (!tableMeta) {
            throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND');
          }
          if (tableMeta.mode === 'chunked') {
            return;
          }

          const finalCount = await this.writeToForcedChunkedTable(tableName, []);
          await this.updateTableMetadata(tableName, finalCount, true);
        } finally {
          releaseLock();
        }
      },
      error =>
        new StorageError(`Failed to migrate table ${tableName} to chunked mode`, 'MIGRATION_FAILED', {
          cause: error,
          suggestion: 'Retry after checking storage permissions and available space.',
        })
    );
  }

  async write(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const items = Array.isArray(data) ? data : [data];
        const logicalRecordCount = getLogicalRecordCount(options);

        if (items.length === 0 && options?.mode !== 'overwrite') {
          return await this.handleEmptyData(tableName);
        }

        if (items.length > 0) {
          this.validateWriteData(items);
        }

        await this.ensureTableExists(tableName, options);

        const releaseLock = await this.acquireLock(tableName);

        try {
          const tableMeta = await this.getLatestTableMetadata(tableName);
          if (!tableMeta) {
            throw new StorageError(
              `Table ${tableName} was deleted before the write acquired its lock`,
              'TABLE_NOT_FOUND',
              {
                suggestion: 'Retry the write to create a new table generation explicitly.',
              }
            );
          }
          const indexUpdatePlan = this.indexManager.stageIndexUpdate(
            tableName,
            items,
            options?.mode === 'overwrite' ? 'rebuild' : 'append'
          );
          const isSingleFileMutation = tableMeta?.mode !== 'chunked' && !options?.forceChunked;
          const metadataSnapshot = isSingleFileMutation ? this.snapshotTableMetadata(tableName, tableMeta) : undefined;
          const indexSnapshots = isSingleFileMutation ? this.snapshotIndexes(tableName) : [];
          const writeResult = await this.executeWriteOperation(tableName, items, options, tableMeta);

          try {
            this.indexManager.applyIndexUpdate(indexUpdatePlan);
            await this.updateTableMetadata(
              tableName,
              logicalRecordCount ?? writeResult.finalCount,
              writeResult.isChunked,
              writeResult.singleFileCommitToken
            );
          } catch (error) {
            if (writeResult.singleFileHandler) {
              await this.rollbackSingleFileMutation(
                tableName,
                writeResult.singleFileHandler,
                metadataSnapshot,
                indexSnapshots,
                error
              );
            }
            throw error;
          }

          await writeResult.singleFileHandler?.commitPendingWrite();

          return {
            written: items.length,
            totalAfterWrite: logicalRecordCount ?? writeResult.finalCount,
            chunked: writeResult.isChunked,
          };
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createFileError('write', `table ${tableName}`, error)
    );
  }

  private async handleEmptyData(tableName: string): Promise<WriteResult> {
    return {
      written: 0,
      totalAfterWrite: await this.count(tableName),
      chunked: false,
    };
  }

  private async ensureTableExists(tableName: string, options?: InternalWriteOptions): Promise<void> {
    if (!(await this.hasTable(tableName))) {
      await this.createTable(tableName, {
        mode: options?.forceChunked ? 'chunked' : undefined,
        encrypted:
          options?.encrypted === true || options?.encryptFullTable === true || options?.requireAuthOnAccess === true,
        encryptFullTable: options?.encryptFullTable,
        requireAuthOnAccess: options?.requireAuthOnAccess,
      });
    }
  }

  private async executeWriteOperation(
    tableName: string,
    items: StorageRecord[],
    options?: InternalWriteOptions,
    tableMeta?: TableSchema
  ): Promise<{
    finalCount: number;
    isChunked: boolean;
    singleFileHandler?: SingleFileHandler;
    singleFileCommitToken?: string;
  }> {
    let finalCount: number;
    let isChunked = false;
    let singleFileHandler: SingleFileHandler | undefined;
    let singleFileCommitToken: string | undefined;

    if (tableMeta?.mode === 'chunked') {
      finalCount = await this.writeToChunkedTable(tableName, items, options);
      isChunked = true;
    } else if (options?.forceChunked) {
      finalCount = await this.writeToForcedChunkedTable(tableName, items, options);
      isChunked = true;
    } else {
      const result = await this.writeToSingleFileTable(tableName, items, options);
      finalCount = result.finalCount;
      singleFileHandler = result.handler;
      singleFileCommitToken = result.storageCommitToken;
    }

    return { finalCount, isChunked, singleFileHandler, singleFileCommitToken };
  }

  private async writeToChunkedTable(
    tableName: string,
    items: StorageRecord[],
    options?: InternalWriteOptions
  ): Promise<number> {
    const handler = this.getChunkedHandler(tableName);

    if (options?.mode === 'overwrite') {
      await handler.write(items);
    } else {
      await handler.append(items);
    }

    return this.metadataManager.count(tableName);
  }

  private async writeToSingleFileTable(
    tableName: string,
    items: StorageRecord[],
    options?: InternalWriteOptions
  ): Promise<{ finalCount: number; handler: SingleFileHandler; storageCommitToken: string }> {
    const handler = this.getSingleFile(tableName);

    const existing =
      options?.mode === 'overwrite'
        ? []
        : await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);

    const final = options?.mode === 'overwrite' ? items : [...existing, ...items];
    const storageCommitToken = createStorageCommitToken();

    await handler.writeRecoverably(final, storageCommitToken);

    return { finalCount: final.length, handler, storageCommitToken };
  }

  /**
   * Move a single-file table to chunked storage while its table lock is held.
   * The old file is removed only after the chunked replacement is durable.
   */
  private async writeToForcedChunkedTable(
    tableName: string,
    items: StorageRecord[],
    options?: InternalWriteOptions
  ): Promise<number> {
    const singleFile = this.getSingleFile(tableName);
    const existing =
      options?.mode === 'overwrite'
        ? []
        : await withTimeout(singleFile.read(), 10000, `read single file table ${tableName} before chunk migration`);
    const finalData = options?.mode === 'overwrite' ? items : [...existing, ...items];
    const chunkedHandler = this.getChunkedHandler(tableName);

    await chunkedHandler.writeSingleFileMigration(finalData);
    await this.cleanupMigratedSingleFileArtifacts(tableName);

    return finalData.length;
  }

  private async updateTableMetadata(
    tableName: string,
    newCount: number,
    isChunked: boolean,
    storageCommitToken?: string
  ): Promise<void> {
    // ChunkedFileHandler publishes its journal, chunks, and count together and
    // persists that generation before returning. Avoid a second metadata flush
    // here: a transient failure on the redundant save must not report a write
    // failure after the chunked data is already durable.
    if (isChunked) {
      const current = this.metadataManager.get(tableName);
      if (current?.mode === 'chunked' && current.count === newCount && current.path === `${tableName}/`) {
        return;
      }
    }

    this.metadataManager.update(tableName, {
      count: newCount,
      updatedAt: Date.now(),
      ...(!isChunked && storageCommitToken ? { storageCommitToken } : {}),
      ...(isChunked
        ? {
            mode: 'chunked',
            path: `${tableName}/`,
          }
        : {}),
    });
    await this.persistMetadataIfSupported();
  }

  private validateWriteData(data: StorageRecord[]): void {
    StorageErrorHandler.handleSyncError(
      () => {
        if (!Array.isArray(data)) {
          throw StorageErrorHandler.createGeneralError(
            'Invalid data format',
            'FILE_CONTENT_INVALID',
            undefined,
            `Expected array of records, received ${typeof data}`,
            'Please provide an array of records or a single record'
          );
        }

        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          if (typeof item !== 'object' || item === null) {
            throw StorageErrorHandler.createGeneralError(
              `Invalid data item at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              `Expected object, received ${typeof item}`,
              'Please provide valid objects for all items'
            );
          }

          if (Object.keys(item).length === 0) {
            throw StorageErrorHandler.createGeneralError(
              `Empty object at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              'Object must contain at least one field',
              'Please provide objects with valid fields'
            );
          }

          const hasValidValue = Object.values(item).some(value => value !== undefined);
          if (!hasValidValue) {
            throw StorageErrorHandler.createGeneralError(
              `Invalid object at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              'Object must contain at least one valid (non-undefined) value',
              'Please provide objects with valid values for at least one field'
            );
          }

          for (const [key, value] of Object.entries(item)) {
            if (value === undefined) {
              throw StorageErrorHandler.createGeneralError(
                `Undefined value for field '${key}' at index ${i}`,
                'FILE_CONTENT_INVALID',
                undefined,
                'Fields cannot have undefined values',
                'Please provide valid values for all fields'
              );
            }
          }
        }
      },
      error =>
        error instanceof StorageError
          ? error
          : StorageErrorHandler.createGeneralError('Invalid write data', 'FILE_CONTENT_INVALID', error)
    );
  }

  async hasTable(tableName: string): Promise<boolean> {
    return (await this.getLatestTableMetadata(tableName)) !== undefined;
  }

  async count(tableName: string): Promise<number> {
    const tableMeta = await this.getLatestTableMetadata(tableName);
    if (!tableMeta) {
      return 0;
    }

    const metadataCount = this.metadataManager.count(tableName);
    this.scheduleCountValidation(tableName);

    return metadataCount;
  }

  private scheduleCountValidation(tableName: string): void {
    const validationInfo = this.countValidationCache.get(tableName);
    const now = Date.now();

    if (validationInfo && now - validationInfo.lastCheckTime < this.VALIDATION_INTERVAL) {
      return;
    }

    if (this.countValidationInFlight.has(tableName)) {
      return;
    }

    const validation = this.validateCountAsync(tableName);
    this.countValidationInFlight.set(tableName, validation);
    void validation
      .finally(() => {
        if (this.countValidationInFlight.get(tableName) === validation) {
          this.countValidationInFlight.delete(tableName);
        }
      })
      .catch(() => undefined);
  }

  /** Reconciles stale counts without blocking foreground reads. */
  private async validateCountAsync(tableName: string): Promise<void> {
    let releaseLock: (() => void) | undefined;

    try {
      releaseLock = await this.acquireLock(tableName);
      const now = Date.now();
      const tableMeta = await this.getLatestTableMetadata(tableName);
      if (!tableMeta) return;

      // A full-table encrypted table intentionally stores one physical envelope
      // for many logical records. Only the encrypted adapter can verify its
      // logical count, so the raw-file validator must not overwrite it.
      if (tableMeta.encryptFullTable) {
        this.countValidationCache.set(tableName, { lastCheckTime: now, isAccurate: true });
        this.cleanupValidationCache();
        return;
      }

      const expectedMetadata = {
        count: this.metadataManager.count(tableName),
        updatedAt: tableMeta.updatedAt,
      };

      if (now - tableMeta.updatedAt > 24 * 60 * 60 * 1000) {
        this.countValidationCache.set(tableName, { lastCheckTime: now, isAccurate: true });
        return;
      }

      const actualCount = await this.getActualCount(tableName);
      const currentMetadata = this.metadataManager.get(tableName);
      if (
        !currentMetadata ||
        currentMetadata.updatedAt !== expectedMetadata.updatedAt ||
        currentMetadata.count !== expectedMetadata.count
      ) {
        return;
      }

      const metadataCount = expectedMetadata.count;

      this.countValidationCache.set(tableName, {
        lastCheckTime: now,
        isAccurate: actualCount === metadataCount,
      });

      this.cleanupValidationCache();

      if (actualCount !== metadataCount) {
        logger.warn(
          `[DataWriter] Count mismatch detected for table '${tableName}': ` +
            `metadata=${metadataCount}, actual=${actualCount}. Auto-correcting...`
        );
        this.metadataManager.update(tableName, {
          count: actualCount,
          updatedAt: now,
        });
        await this.persistMetadataIfSupported();
      }
    } catch (error) {
      logger.error(`[DataWriter] Failed to validate count for table '${tableName}':`, error);
    } finally {
      releaseLock?.();
    }
  }

  private cleanupValidationCache(): void {
    if (this.countValidationCache.size > this.MAX_VALIDATION_CACHE_SIZE) {
      const entries = Array.from(this.countValidationCache.entries());
      entries.sort((a, b) => a[1].lastCheckTime - b[1].lastCheckTime);
      const toRemove = entries.slice(0, this.countValidationCache.size - this.MAX_VALIDATION_CACHE_SIZE + 1);
      toRemove.forEach(([key]) => {
        this.countValidationCache.delete(key);
      });
    }
  }

  private async getActualCount(tableName: string): Promise<number> {
    const tableMeta = await this.getLatestTableMetadata(tableName);
    if (!tableMeta) return 0;

    let data: StorageRecord[];
    if (tableMeta.mode === 'chunked') {
      const handler = this.getChunkedHandler(tableName);
      data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
    } else {
      const handler = this.getSingleFile(tableName);
      data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
    }
    return data.length;
  }

  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const releaseLock = await this.acquireLock(tableName);
    try {
      await this.getLatestTableMetadata(tableName);
      const metadataCount = this.metadataManager.count(tableName);
      const actualCount = await this.getActualCount(tableName);
      const match = metadataCount === actualCount;

      if (!match) {
        this.metadataManager.update(tableName, {
          count: actualCount,
          updatedAt: Date.now(),
        });
        await this.persistMetadataIfSupported();
      }

      return { metadata: metadataCount, actual: actualCount, match };
    } finally {
      releaseLock();
    }
  }

  async delete(tableName: string, where: FilterCondition<StorageRecord>): Promise<number> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const releaseLock = await this.acquireLock(tableName);

        try {
          const tableMeta = await this.getLatestTableMetadata(tableName);
          if (!tableMeta) {
            return 0;
          }

          let data: StorageRecord[];
          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
          }

          const filteredData = data.filter(item => {
            return !QueryEngine.filter([item], where).length;
          });

          const deletedCount = data.length - filteredData.length;

          if (deletedCount === 0) {
            return 0;
          }

          let singleFileHandler: SingleFileHandler | undefined;
          let singleFileCommitToken: string | undefined;
          let metadataSnapshot: TableSchema | undefined;
          let indexSnapshots: Index[] = [];
          const indexUpdatePlan = this.indexManager.stageIndexUpdate(tableName, filteredData, 'rebuild');
          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await handler.write(filteredData);
          } else {
            singleFileHandler = this.getSingleFile(tableName);
            metadataSnapshot = this.snapshotTableMetadata(tableName);
            indexSnapshots = this.snapshotIndexes(tableName);
            singleFileCommitToken = createStorageCommitToken();
            await singleFileHandler.writeRecoverably(filteredData, singleFileCommitToken);
          }

          try {
            this.indexManager.applyIndexUpdate(indexUpdatePlan);
            await this.updateTableMetadata(
              tableName,
              filteredData.length,
              tableMeta.mode === 'chunked',
              singleFileCommitToken
            );
          } catch (error) {
            if (singleFileHandler) {
              await this.rollbackSingleFileMutation(
                tableName,
                singleFileHandler,
                metadataSnapshot,
                indexSnapshots,
                error
              );
            }
            throw error;
          }

          await singleFileHandler?.commitPendingWrite();

          return deletedCount;
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createFileError('delete from', `table ${tableName}`, error)
    );
  }
}
