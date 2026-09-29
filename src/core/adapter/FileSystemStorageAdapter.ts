import { configManager } from '../config/ConfigManager';
import logger from '../../utils/logger';
import { StorageTaskProcessor } from '../../taskQueue/StorageTaskProcessor';
import { taskQueue } from '../../taskQueue/taskQueue';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageAdapter } from '../../types/storageAdapterInfc';
import { StorageError } from '../../types/storageErrorInfc';
import type {
  BulkOperation,
  CreateTableOptions,
  FilterCondition,
  FindOptions,
  InternalWriteOptions,
  NonInfer,
  ReadOptions,
  StorageInput,
  StorageRecord,
  TableOptions,
  UpdatePayload,
  WriteOptions,
  WriteResult,
} from '../../types/storageTypes';
import { isStorageRecord } from '../../types/storageTypes';
import { FileHandlerBase } from '../file/FileHandlerBase';
import { PermissionChecker } from '../file/PermissionChecker';
import { CacheConfig, CacheManager, CacheStrategy } from '../cache/CacheManager';
import { CACHE } from '../constants';
import { DataReader } from '../data/DataReader';
import { DataWriter } from '../data/DataWriter';
import { IndexManager, IndexType } from '../index/IndexManager';
import { MetadataManager, type TableSchema } from '../meta/MetadataManager';
import { CacheMonitor } from '../monitor/CacheMonitor';
import { performanceMonitor } from '../monitor/PerformanceMonitor';
import { CacheService } from '../service/CacheService';
import {
  getTransactionOwner,
  guardedAutoSyncWrite,
  hasDynamicFieldEncryption,
  hasInternalDirectWrite,
  transactionOwnerOption,
  TransactionService,
  withDynamicFieldEncryption,
  withInternalDirectWrite,
  type TransactionOwnerToken,
  type TransactionScopedOptions,
  type TransactionWriteOptions,
} from '../service/TransactionService';
import { AutoSyncService } from '../service/AutoSyncService';

import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { ensureStorageRootReady } from '../../utils/ROOTPath';
import { pathHelper } from '../../utils/PathHelper';
import { QueryEngine } from '../query/QueryEngine';
import { assertValidTableName } from '../../utils/tableName';

/**
 * Marks a write that already runs under withTableWriteLock. update() and the
 * commit update replay read-modify-write a table while holding the lock and
 * finish with an overwrite through write(); without this marker those nested
 * writes would queue on the lock they already hold and deadlock.
 */
const internalTableLockOption: unique symbol = Symbol('internalTableLock');

type InternalTableLockOptions = {
  readonly [internalTableLockOption]?: true;
};

const withInternalTableLock = <T extends object>(options: T): T & InternalTableLockOptions => ({
  ...options,
  [internalTableLockOption]: true,
});

const hasInternalTableLock = (options: unknown): boolean =>
  typeof options === 'object' &&
  options !== null &&
  (options as InternalTableLockOptions)[internalTableLockOption] === true;

/**
 * StorageError `details` can embed stored values (e.g. the violating value of a
 * unique index); RN logboxes render enumerable error props, so startup warnings
 * must log only the code and message.
 */
const describeLogError = (error: unknown): unknown =>
  error instanceof StorageError ? `${error.code}: ${error.message}` : error;

export class FileSystemStorageAdapter implements IStorageAdapter {
  private metadataManager: IMetadataManager;

  private indexManager: IndexManager;

  private cacheManager: CacheManager;

  private cacheService: CacheService;

  private transactionService: TransactionService;

  private autoSyncService: AutoSyncService;

  private dataReader: DataReader;

  private dataWriter: DataWriter;

  private permissionChecker: PermissionChecker;

  private cacheMonitor: CacheMonitor;
  private initializationPromise: Promise<void> | null = null;
  private servicesStarted = false;
  private taskQueueInitialized = false;
  private initializedStorageFolder: string | null = null;

  private assertTransactionAccess(options?: unknown): TransactionOwnerToken | undefined {
    const owner = getTransactionOwner(options);
    this.transactionService.assertTransactionOwner(owner);
    return owner;
  }

  private createTransactionDdlError(): StorageError {
    return new StorageError(
      'Table structure changes are not supported during an active transaction',
      'TRANSACTION_OPERATION_NOT_SUPPORTED',
      {
        details: 'createTable(), deleteTable(), and migrateToChunked() persist metadata or files immediately.',
        suggestion: 'Commit or roll back the active transaction before changing table structure.',
      }
    );
  }

  /** Public schema changes must not escape an in-memory transaction. */
  private assertTransactionDdlAllowed(options?: unknown): void {
    if (this.transactionService.isInTransaction() && !hasInternalDirectWrite(options)) {
      throw this.createTransactionDdlError();
    }
  }

  /** Holds transaction start until a public schema change has completed. */
  private async runPublicSchemaChange<T>(options: unknown, operation: () => Promise<T>): Promise<T> {
    this.assertTransactionAccess(options);
    if (hasInternalDirectWrite(options)) {
      return operation();
    }

    let executed = false;
    let result: T | undefined;
    await this.transactionService.runWhenNoTransaction(async () => {
      executed = true;
      this.assertTransactionDdlAllowed(options);
      result = await operation();
    });

    if (!executed) {
      throw this.createTransactionDdlError();
    }
    return result as T;
  }

  private getCurrentTransactionData(tableName: string, owner?: TransactionOwnerToken): Promise<StorageRecord[]> {
    return this.transactionService.getCurrentTransactionData(
      tableName,
      (currentTableName: string) => this.dataReader.read(currentTableName, { bypassCache: true }),
      owner
    );
  }

  private saveTransactionSnapshot(tableName: string, data: StorageRecord[], owner?: TransactionOwnerToken): void {
    const tableMeta = this.metadataManager.get(tableName);
    this.transactionService.saveSnapshot(
      tableName,
      data,
      tableMeta !== undefined,
      owner,
      tableMeta?.count ?? data.length
    );
  }

  /** Validates an encrypted decorator's identity against the active transaction. */
  assertTransactionOwner(owner: TransactionOwnerToken): void {
    this.transactionService.assertTransactionOwner(owner);
  }

  /** Creates or validates encryption metadata before a queued implicit write is applied. */
  private async ensureTransactionTablePolicy(tableName: string, options?: TransactionWriteOptions): Promise<void> {
    if (options?.encryptedFields === undefined) {
      return;
    }

    const requestedFields = new Set(options.encryptedFields);
    const requestedAllFields = hasDynamicFieldEncryption(options);
    const tableMeta = this.metadataManager.get(tableName);
    if (tableMeta) {
      const persistedFields = new Set(tableMeta.encryptedFields ?? []);
      const fieldsMatch =
        requestedFields.size === persistedFields.size &&
        Array.from(requestedFields).every(field => persistedFields.has(field));
      const policyMatches =
        tableMeta.encrypted === true &&
        (tableMeta.encryptFullTable === true) === (options.encryptFullTable === true) &&
        (tableMeta.encryptAllFields === true) === requestedAllFields &&
        (tableMeta.requireAuthOnAccess === true) === (options.requireAuthOnAccess === true) &&
        fieldsMatch;

      if (!policyMatches) {
        throw new StorageError(
          `Table '${tableName}' has a different encryption policy within the active transaction`,
          'MIGRATION_FAILED',
          {
            details: 'Queued writes cannot create or reinterpret one table with different encryption policies.',
            suggestion: 'Use one policy for the transaction, or migrate the table explicitly.',
            tableName,
          }
        );
      }
      return;
    }

    const transactionOwner = getTransactionOwner(options);
    const createOptions: CreateTableOptions<StorageRecord> & TransactionScopedOptions = {
      encrypted: true,
      encryptFullTable: options.encryptFullTable === true,
      requireAuthOnAccess: options.requireAuthOnAccess === true,
      encryptedFields: [...options.encryptedFields],
      [transactionOwnerOption]: transactionOwner,
    };
    await this.createTable(
      tableName,
      withInternalDirectWrite(withDynamicFieldEncryption(createOptions, requestedAllFields))
    );
  }

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

  private applyReadOptions(data: StorageRecord[], options?: ReadOptions<StorageRecord>): StorageRecord[] {
    let result = data;
    if (options?.filter) {
      result = QueryEngine.filter(result, options.filter);
    }
    if (options?.sortBy) {
      const sortAlgorithm = options.sortAlgorithm ?? configManager.getConfig().sortMethods;
      result = QueryEngine.sort(result, options.sortBy, options.order, sortAlgorithm);
    }
    return QueryEngine.paginate(result, options?.skip, options?.limit);
  }

  private toStorageFindOptions<T extends object>(options?: FindOptions<T>): FindOptions<StorageRecord> | undefined {
    return options as unknown as FindOptions<StorageRecord> | undefined;
  }

  private validateTableName(tableName: string): void {
    assertValidTableName(tableName);
  }

  private assertStorageRootIsCurrent(): void {
    if (!this.servicesStarted || !this.initializedStorageFolder) {
      return;
    }

    const configuredFolder = pathHelper.getStorageFolder();
    if (configuredFolder !== this.initializedStorageFolder) {
      throw new StorageError('storageFolder changed while storage is active', 'STORAGE_ROOT_CHANGED', {
        details: `The adapter is initialized for "${this.initializedStorageFolder}" but configuration now selects "${configuredFolder}".`,
        suggestion:
          'Configure storageFolder before initialization. Test-only cleanup/reinitialization flows must finish cleanup before the next operation.',
      });
    }
  }

  private flattenInsertOperations(operations: BulkOperation<StorageRecord>[]): StorageRecord[] | null {
    if (operations.length === 0) {
      return null;
    }

    const insertOperations = operations.filter(
      (operation): operation is Extract<BulkOperation<StorageRecord>, { type: 'insert' }> => operation.type === 'insert'
    );

    if (insertOperations.length !== operations.length) {
      return null;
    }

    return insertOperations.flatMap(operation => (Array.isArray(operation.data) ? operation.data : [operation.data]));
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

  constructor(
    metadataManager?: IMetadataManager,
    options?: {
      cacheConfig?: Partial<CacheConfig>;
    }
  ) {
    this.metadataManager = metadataManager || new MetadataManager();
    this.indexManager = new IndexManager(this.metadataManager);
    const currentConfig = configManager.getConfig();
    const defaultCacheConfig: CacheConfig = {
      strategy: CacheStrategy.LRU,
      maxSize: currentConfig.cache.maxSize || CACHE.DEFAULT_MAX_SIZE,
      defaultExpiry: currentConfig.cache.defaultExpiry || CACHE.DEFAULT_EXPIRY,
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
      maxMemoryUsage: 50 * 1024 * 1024, // Default 50MB memory limit
      memoryThreshold: currentConfig.cache.memoryWarningThreshold || CACHE.MEMORY_THRESHOLD,
      avalancheRandomExpiry: CACHE.AVALANCHE_PROTECTION_RANGE,
    };

    this.cacheManager = new CacheManager({
      ...defaultCacheConfig,
      ...options?.cacheConfig,
    });

    this.cacheService = new CacheService(this.cacheManager);
    this.permissionChecker = new PermissionChecker();
    this.transactionService = new TransactionService();
    this.cacheMonitor = new CacheMonitor(this.cacheManager);
    this.dataReader = new DataReader(this.metadataManager, this.indexManager, this.cacheManager);
    this.dataWriter = new DataWriter(this.metadataManager, this.indexManager);
    this.autoSyncService = AutoSyncService.getInstance(this.cacheService, this);
  }

  private async initializeRuntime(): Promise<void> {
    const storageFolder = pathHelper.getStorageFolder();
    await ensureStorageRootReady();
    await this.permissionChecker.checkPermissions();

    if (pathHelper.getStorageFolder() !== storageFolder) {
      throw new StorageError('storageFolder changed during initialization', 'STORAGE_ROOT_CHANGED', {
        suggestion: 'Configure storageFolder before initializing storage.',
      });
    }

    const metadataManager = this.metadataManager as MetadataManager & {
      reload?: () => Promise<void>;
      waitForLoad?: () => Promise<void>;
    };

    if (typeof metadataManager.reload === 'function') {
      await metadataManager.reload();
    } else if (typeof metadataManager.waitForLoad === 'function') {
      await metadataManager.waitForLoad();
    }

    // Restore index acceleration before any public API or sync writer can touch a table.
    await this.rebuildPersistedIndexes();

    if (!this.taskQueueInitialized) {
      const storageTaskProcessor = new StorageTaskProcessor(this);
      taskQueue.addProcessor(storageTaskProcessor);
      this.taskQueueInitialized = true;
    }

    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
      taskQueue.start();
      this.cacheMonitor.startMonitoring(60000);
      this.autoSyncService.start(true);
    }

    this.initializedStorageFolder = storageFolder;
    this.servicesStarted = true;
  }

  async ensureInitialized(): Promise<void> {
    if (this.servicesStarted) {
      this.assertStorageRootIsCurrent();
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRuntime().catch(error => {
        this.initializationPromise = null;
        throw error;
      });
    }

    await this.initializationPromise;
  }

  /** Re-registers persisted index declarations and rebuilds their data so acceleration survives restarts. */
  private async rebuildPersistedIndexes(): Promise<void> {
    for (const tableName of this.metadataManager.allTables()) {
      const declaredIndexes = this.metadataManager.get(tableName)?.indexes;
      if (!declaredIndexes || Object.keys(declaredIndexes).length === 0) {
        continue;
      }

      let restored = false;
      for (const [indexName, type] of Object.entries(declaredIndexes)) {
        const suffix = `_${type}`;
        const field = indexName.endsWith(suffix) ? indexName.slice(0, -suffix.length) : '';
        if (!field) {
          logger.warn(`cannot restore index ${indexName} on table ${tableName}: unrecognized index name`);
          continue;
        }
        if (this.indexManager.getTableIndexes(tableName).some(index => index.name === indexName)) {
          continue;
        }

        try {
          await this.indexManager.createIndex(
            tableName,
            field,
            type === 'unique' ? IndexType.UNIQUE : IndexType.NORMAL,
            {
              persistMetadata: false,
            }
          );
          restored = true;
        } catch (error) {
          logger.warn(`failed to restore index ${indexName} on table ${tableName}`, describeLogError(error));
        }
      }

      if (!restored) {
        continue;
      }

      try {
        await this.withTableWriteLock(tableName, async () => {
          // bypassCache: the rebuild needs the on-disk snapshot, not a cached
          // clone, and must not leave a full-table copy behind in the cache.
          const records = await this.dataReader.read(tableName, { bypassCache: true });
          this.indexManager.rebuildIndexes(tableName, records);
        });
      } catch (error) {
        logger.warn(
          `failed to rebuild indexes on table ${tableName}; they stay inactive until a full-table overwrite rebuilds them`,
          describeLogError(error)
        );
      }
    }
  }

  async cleanup(): Promise<void> {
    await this.autoSyncService.cleanup();
    await taskQueue.stop({ force: true });
    await taskQueue.cleanup();

    if (this.cacheMonitor) {
      this.cacheMonitor.stopMonitoring();
    }

    const metadataManager = this.metadataManager as MetadataManager;
    if (typeof metadataManager.saveImmediately === 'function') {
      await metadataManager.saveImmediately();
    }

    if (this.cacheManager) {
      this.cacheManager.clear();
      this.cacheManager.cleanup();
    }

    if (typeof metadataManager.cleanup === 'function') {
      metadataManager.cleanup();
    }

    FileHandlerBase.invalidateFileInfoCache();

    this.initializationPromise = null;
    this.servicesStarted = false;
    this.taskQueueInitialized = false;
    this.initializedStorageFolder = null;
  }

  async createTable<T extends object = StorageRecord>(
    tableName: string,
    options: CreateTableOptions<T> & {
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {}
  ): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    const normalizedOptions: CreateTableOptions<StorageRecord> & {
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {
      ...options,
      initialData: options.initialData ? this.normalizeStorageInput(options.initialData) : undefined,
    };

    return this.runPublicSchemaChange(options, async () => {
      const created = await this.dataWriter.createTable(tableName, normalizedOptions);
      // Declarations only apply when this call created the table. An existing
      // table must not run (or roll back) index declarations: a duplicate or
      // failing declaration would otherwise delete the caller's stored rows,
      // and the SQLite engine likewise ignores declarations on existing tables.
      if (created) {
        await this.createDeclaredIndexes(tableName, normalizedOptions.indexes);
      }
    });
  }

  /** Builds indexes declared through createTable({ indexes }); a failure rolls the new table back. */
  private async createDeclaredIndexes(
    tableName: string,
    indexes: (string | { field: string; unique?: boolean })[] | undefined
  ): Promise<void> {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return;
    }

    try {
      for (const declaration of indexes) {
        const field = typeof declaration === 'string' ? declaration : declaration?.field;
        if (typeof field !== 'string' || !field.trim()) {
          throw new StorageError('Index field name cannot be empty', 'TABLE_INDEX_INVALID', {
            details:
              'Every entry of the indexes option must be a field name or { field, unique } with a non-empty field',
            suggestion: 'Provide valid field names via createTable({ indexes })',
          });
        }
        const unique = typeof declaration === 'object' && declaration !== null && declaration.unique === true;
        await this.createIndex(tableName, field, unique);
      }
    } catch (error) {
      // Index declaration failures must not leave a half-created table behind.
      try {
        await this.dataWriter.deleteTable(tableName);
      } catch (cleanupError) {
        logger.error(`failed to roll back table ${tableName} after index creation failed`, cleanupError);
      }
      this.cacheService.clearTableCache(tableName);
      throw error;
    }
  }

  async deleteTable(tableName: string, _options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    return this.runPublicSchemaChange(_options, async () => {
      try {
        return await this.dataWriter.deleteTable(tableName);
      } finally {
        // A durable metadata delete can precede a failed artifact cleanup. Rotate
        // the namespace on every outcome so a same-name recreation cannot reuse stale data.
        this.cacheService.clearTableCache(tableName);
      }
    });
  }

  async hasTable(tableName: string, _options?: TableOptions): Promise<boolean> {
    await this.ensureInitialized();
    this.assertTransactionAccess(_options);
    this.validateTableName(tableName);
    return this.dataWriter.hasTable(tableName);
  }

  async listTables(_options?: TableOptions): Promise<string[]> {
    await this.ensureInitialized();
    this.assertTransactionAccess(_options);
    return this.metadataManager.allTables();
  }

  async overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        const transactionOwner = this.assertTransactionAccess(options);
        this.validateTableName(tableName);
        const normalizedData = this.normalizeStorageInput(data);
        const startTime = Date.now();
        const dataSize = normalizedData.length;

        if (this.transactionService.isInTransaction()) {
          const currentData = await this.dataReader.read(tableName, { bypassCache: true });
          this.saveTransactionSnapshot(tableName, currentData, transactionOwner);

          this.transactionService.addOperation(
            {
              tableName,
              type: 'overwrite',
              data: normalizedData,
              options,
            },
            transactionOwner
          );
          return {
            written: normalizedData.length,
            totalAfterWrite: normalizedData.length,
            chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
          };
        }

        const result = await this.withTableWriteLock(tableName, () =>
          this.dataWriter.write(tableName, normalizedData, { ...options, mode: 'overwrite' })
        );
        this.cacheService.clearTableCache(tableName);
        performanceMonitor.record({
          operation: 'overwrite',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          success: true,
          dataSize,
        });

        return result;
      },
      (cause: unknown) => StorageErrorHandler.createFileError('overwrite', `table ${tableName}`, cause)
    );
  }

  /**
   * Writes with the caller-selected mode. Retained for backward compatibility.
   *
   * @deprecated Use insert for append mode or overwrite for replacement mode.
   */
  async write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        const transactionOwner = this.assertTransactionAccess(options);
        this.validateTableName(tableName);
        const normalizedData = this.normalizeStorageInput(data);
        const startTime = Date.now();
        const dataSize = normalizedData.length;
        const directWrite = hasInternalDirectWrite(options);

        if (this.transactionService.isInTransaction() && !directWrite) {
          const currentData = await this.dataReader.read(tableName, { bypassCache: true });
          this.saveTransactionSnapshot(tableName, currentData, transactionOwner);

          this.transactionService.addOperation(
            {
              tableName,
              type: 'write',
              data: normalizedData,
              options,
            },
            transactionOwner
          );
          const currentCount = await this.count(tableName, options);
          return {
            written: normalizedData.length,
            totalAfterWrite: currentCount,
            chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
          };
        }

        // Outside a transaction, or with an internal commit capability, every
        // physical write first serializes on the table write lock: a plain
        // append or overwrite must not interleave between an in-flight
        // update()'s read and its stale overwrite, which would silently erase
        // the concurrent write (or resurrect one it deleted). Callers already
        // holding the lock (update's own overwrite, commit update replay)
        // pass the internal marker instead of re-acquiring it.
        const writtenCount = normalizedData.length;
        const performWrite = () => this.dataWriter.write(tableName, normalizedData, options);
        const result = hasInternalTableLock(options)
          ? await performWrite()
          : await this.withTableWriteLock(tableName, performWrite);

        if (options?.mode === 'append') {
          result.written = writtenCount;
        }
        if (this.transactionService.isInTransaction() && directWrite) {
          // Append/default writes need a post-write read because the writer merged with the
          // current persisted table inside its lock.
          const latestTransactionData =
            options?.mode === 'overwrite'
              ? normalizedData
              : await this.dataReader.read(tableName, { bypassCache: true });
          this.transactionService.setTransactionData(tableName, latestTransactionData, transactionOwner);
        }
        this.cacheService.clearTableCache(tableName);
        performanceMonitor.record({
          operation: 'write',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          success: true,
          dataSize,
        });

        return result;
      },
      (cause: unknown) => StorageErrorHandler.createFileError('write', `table ${tableName}`, cause)
    );
  }

  async read<T extends object = StorageRecord>(tableName: string, options?: ReadOptions<NonInfer<T>>): Promise<T[]> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    // Transactional reads include staged operations that are not persisted yet.
    if (this.transactionService.isInTransaction()) {
      const storageOptions = this.toStorageReadOptions(options);
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      return this.toPublicRecords<T>(this.applyReadOptions(transactionData, storageOptions));
    }

    return this.toPublicRecords<T>(await this.dataReader.read(tableName, this.toStorageReadOptions(options)));
  }

  async count(tableName: string, options?: TableOptions): Promise<number> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    if (this.transactionService.isInTransaction()) {
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      return transactionData.length;
    }

    return this.dataWriter.count(tableName);
  }

  async verifyCount(
    tableName: string,
    options?: TableOptions
  ): Promise<{ metadata: number; actual: number; match: boolean }> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    return this.dataWriter.verifyCount(tableName);
  }

  getTableMeta(tableName: string): TableSchema | undefined {
    this.assertStorageRootIsCurrent();
    this.validateTableName(tableName);
    return this.metadataManager.get(tableName);
  }

  /**
   * Keep decorator-level logical record counts in the shared metadata store.
   * Full-table encryption stores one physical envelope for many logical rows,
   * so the encrypted decorator must publish the logical count after a write.
   * @internal
   */
  async setLogicalRecordCount(tableName: string, count: number, options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    if (!Number.isSafeInteger(count) || count < 0) {
      throw new StorageError('Invalid logical record count', 'FILE_CONTENT_INVALID', {
        details: `Expected a non-negative safe integer, received: ${count}`,
      });
    }

    if (!this.metadataManager.get(tableName)) {
      throw new StorageError(`Table '${tableName}' does not exist`, 'TABLE_NOT_FOUND');
    }

    this.metadataManager.update(tableName, {
      count,
      updatedAt: Date.now(),
    });
    await this.metadataManager.saveImmediately?.();
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    _options?: TableOptions
  ): Promise<T | null> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(_options);
    this.validateTableName(tableName);

    if (this.transactionService.isInTransaction()) {
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      const [record] = this.applyReadOptions(transactionData, {
        filter: this.toStorageFilter(filter),
        limit: 1,
      });
      return this.toPublicRecord<T>(record ?? null);
    }

    return this.toPublicRecord<T>(await this.dataReader.findOne(tableName, this.toStorageFilter(filter)));
  }

  async findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    _findOptions?: TableOptions
  ): Promise<T[]> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(_findOptions);
    this.validateTableName(tableName);

    if (this.transactionService.isInTransaction()) {
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      return this.toPublicRecords<T>(
        this.applyReadOptions(transactionData, {
          filter: filter ? this.toStorageFilter(filter) : undefined,
          ...this.toStorageFindOptions(options),
        })
      );
    }

    return this.toPublicRecords<T>(
      await this.dataReader.findMany(
        tableName,
        filter ? this.toStorageFilter(filter) : undefined,
        this.toStorageFindOptions(options)
      )
    );
  }

  async delete<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: InternalWriteOptions
  ): Promise<number> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    this.validateTableName(tableName);
    const directWrite = hasInternalDirectWrite(options);
    const storageWhere = this.toStorageFilter(where);

    if (this.transactionService.isInTransaction() && !directWrite) {
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      const deletedCount = QueryEngine.filter(transactionData, storageWhere).length;
      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.saveTransactionSnapshot(tableName, currentData, transactionOwner);

      this.transactionService.addOperation(
        {
          tableName,
          type: 'delete',
          where: storageWhere,
          options,
        },
        transactionOwner
      );
      return deletedCount;
    }
    // Serialize with in-flight update()/bulkWrite() read-modify-write cycles
    // so a delete can neither be erased by a stale overwrite nor have its
    // target row resurrected by one.
    const result = await this.withTableWriteLock(tableName, () => this.dataWriter.delete(tableName, storageWhere));
    this.cacheService.clearTableCache(tableName);

    return result;
  }

  async remove<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    return this.delete(tableName, where, options);
  }

  async insert<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.write(tableName, data, { ...options, mode: 'append' });
  }

  async update<T extends object = StorageRecord>(
    tableName: string,
    data: UpdatePayload<T>,
    where: FilterCondition<T>,
    options?: InternalWriteOptions
  ): Promise<number> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    this.validateTableName(tableName);
    const directWrite = hasInternalDirectWrite(options);

    if (this.transactionService.isInTransaction() && !directWrite) {
      const allData = await this.transactionService.getCurrentTransactionData(
        tableName,
        (transactionTableName: string) => this.dataReader.read(transactionTableName),
        transactionOwner
      );

      const storageWhere = this.toStorageFilter(where);
      const storageData = this.normalizeStorageRecord(data);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const updatedCount = matchedItems.length;

      if (updatedCount === 0) {
        return 0;
      }

      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.saveTransactionSnapshot(tableName, currentData, transactionOwner);

      this.transactionService.addOperation(
        {
          tableName,
          type: 'update',
          data: storageData,
          where: storageWhere,
          options: { ...options, mode: 'overwrite' },
        },
        transactionOwner
      );

      return updatedCount;
    }

    // Non-transaction updates read the full table, compute the new contents,
    // and write it back with one overwrite. Without this per-table lock the
    // read runs outside DataWriter's write lock and a concurrent append or
    // second update can be silently erased by the stale overwrite.
    return this.withTableWriteLock(tableName, async () => {
      const storageWhere = this.toStorageFilter(where);
      const storageData = this.normalizeStorageRecord(data);
      const allData = await this.dataReader.read(tableName);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const updatedCount = matchedItems.length;

      if (updatedCount === 0) {
        return 0;
      }

      // Use object identity from QueryEngine.filter instead of id/_id so tables
      // without an identifier field still update only the matched rows.
      const matchedItemRefs = new Set(matchedItems);
      const finalData = allData.map(item => {
        if (matchedItemRefs.has(item)) {
          return QueryEngine.update(item, storageData);
        }
        return item;
      });

      const writeOptions = { ...options, mode: 'overwrite' as const };
      await this.write(
        tableName,
        finalData,
        withInternalTableLock(directWrite ? withInternalDirectWrite(writeOptions) : writeOptions)
      );

      return updatedCount;
    });
  }

  /**
   * Serializes adapter-level read-modify-write cycles (update, mixed bulkWrite,
   * commit update replay) per table. DataWriter's internal lock only covers the
   * final write, so without this the read runs outside the lock and a concurrent
   * write can be erased by a stale overwrite.
   */
  private async withTableWriteLock<T>(tableName: string, operation: () => Promise<T>): Promise<T> {
    const previous = FileSystemStorageAdapter.tableWriteLocks.get(tableName);
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const queued = previous ? previous.then(() => current) : current;
    FileSystemStorageAdapter.tableWriteLocks.set(tableName, queued);

    if (previous) {
      await previous;
    }

    try {
      return await operation();
    } finally {
      releaseCurrent?.();
      if (FileSystemStorageAdapter.tableWriteLocks.get(tableName) === queued) {
        FileSystemStorageAdapter.tableWriteLocks.delete(tableName);
      }
    }
  }

  private static readonly tableWriteLocks = new Map<string, Promise<unknown>>();

  async clearTable(tableName: string, options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    await this.write(tableName, [], { ...options, mode: 'overwrite' });
  }

  /**
   * Counts physical records without consulting metadata. EngineMigrationService
   * uses this to detect real destination occupancy — shared metadata makes
   * hasTable unreliable across engines. A physically missing or unreadable
   * table counts as empty; the migration's own overwrite path self-heals it.
   */
  async getPhysicalRecordCount(tableName: string): Promise<number> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    try {
      const records = await this.dataReader.read(tableName, { bypassCache: true });
      return records.length;
    } catch {
      return 0;
    }
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    this.validateTableName(tableName);
    const directWrite = hasInternalDirectWrite(options);

    const startTime = Date.now();
    if (this.transactionService.isInTransaction() && !directWrite) {
      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.saveTransactionSnapshot(tableName, currentData, transactionOwner);
      const normalizedOperations = this.normalizeBulkOperations(operations);
      this.transactionService.addOperation(
        {
          tableName,
          type: 'bulkWrite',
          operations: normalizedOperations,
          options,
        },
        transactionOwner
      );

      const currentCount = await this.count(tableName, options);
      return {
        written: operations.length,
        totalAfterWrite: currentCount,
        chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
      };
    }

    const normalizedOperations = this.normalizeBulkOperations(operations);
    const insertOnlyItems = this.flattenInsertOperations(normalizedOperations);
    if (insertOnlyItems) {
      // Same table lock as the mixed path below: a plain batch append must
      // not interleave with an in-flight update() read-modify-write cycle.
      const result = await this.withTableWriteLock(tableName, () =>
        this.dataWriter.write(tableName, insertOnlyItems, { ...options, mode: 'append' })
      );

      this.cacheService.clearTableCache(tableName);
      performanceMonitor.record({
        operation: 'bulkWrite',
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        success: true,
        dataSize: insertOnlyItems.length,
        group: 'concurrency',
      });

      return {
        ...result,
        written: insertOnlyItems.length,
      };
    }

    // Execute batch operations directly to avoid recursion.
    const BATCH_SIZE = 1000;
    // Same stale-overwrite window as update(): the read-modify-write cycle
    // must be serialized per table against other bulk writes and appends.
    const { result, writtenCount, finalDataSize } = await this.withTableWriteLock(tableName, async () => {
      const currentData = await this.dataReader.read(tableName);
      let finalData = [...currentData];
      let writtenCount = 0;

      for (let i = 0; i < normalizedOperations.length; i += BATCH_SIZE) {
        const batchOperations = normalizedOperations.slice(i, i + BATCH_SIZE);
        for (const op of batchOperations) {
          switch (op.type) {
            case 'insert':
              const insertItems = Array.isArray(op.data) ? op.data : [op.data];
              finalData = [...finalData, ...insertItems];
              writtenCount += insertItems.length;
              break;
            case 'update':
              const matchedItems = QueryEngine.filter(finalData, op.where);
              const matchedItemRefs = new Set(matchedItems);
              finalData = finalData.map(item => (matchedItemRefs.has(item) ? QueryEngine.update(item, op.data) : item));
              writtenCount += matchedItems.length;
              break;
            case 'delete':
              const deletedItems = QueryEngine.filter(finalData, op.where);
              const deletedItemRefs = new Set(deletedItems);
              finalData = finalData.filter(item => !deletedItemRefs.has(item));
              writtenCount += deletedItems.length;
              break;
          }
        }
      }

      const result = await this.dataWriter.write(tableName, finalData, { ...options, mode: 'overwrite' });
      return { result, writtenCount, finalDataSize: finalData.length };
    });

    this.cacheService.clearTableCache(tableName);
    performanceMonitor.record({
      operation: 'bulkWrite',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: finalDataSize,
    });

    return {
      ...result,
      written: writtenCount,
    };
  }
  /**
   * Exposes transaction state to decorators that must defer metadata updates
   * until the underlying write has committed.
   */
  isInTransaction(): boolean {
    return this.transactionService.isInTransaction();
  }

  /** @internal Writes only while transaction start is atomically excluded. */
  async [guardedAutoSyncWrite](tableName: string, data: StorageRecord[]): Promise<WriteResult | undefined> {
    return this.transactionService.runWhenNoTransaction(() =>
      this.write(tableName, data, {
        mode: 'overwrite',
      })
    );
  }

  async beginTransaction(_options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    await this.transactionService.beginTransaction(getTransactionOwner(_options));
  }

  async commit(options?: TableOptions, finalize?: () => Promise<void>): Promise<void> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);
    await this.transactionService.commit(
      async (tableName: string, data: StorageInput<StorageRecord>, opOptions?: TransactionWriteOptions) => {
        await this.ensureTransactionTablePolicy(tableName, opOptions);
        return this.write(tableName, data, withInternalDirectWrite({ ...options, ...opOptions }));
      },
      (tableName: string, where: FilterCondition<StorageRecord>, deleteOptions?: InternalWriteOptions) =>
        this.delete(tableName, where, withInternalDirectWrite({ ...options, ...deleteOptions })),
      (tableName: string, operations: BulkOperation<StorageRecord>[], bulkOptions?: InternalWriteOptions) =>
        this.bulkWrite(tableName, operations, withInternalDirectWrite({ ...options, ...bulkOptions })),
      async (
        tableName: string,
        data: UpdatePayload<StorageRecord>,
        where: FilterCondition<StorageRecord>,
        _updateOptions?: InternalWriteOptions
      ) => {
        return this.withTableWriteLock(tableName, async () => {
          const allData = await this.dataReader.read(tableName);
          const matchedItems = QueryEngine.filter(allData, where);
          const updatedCount = matchedItems.length;

          if (updatedCount === 0) {
            return 0;
          }

          const matchedItemRefs = new Set(matchedItems);
          const finalData = allData.map(item => {
            if (matchedItemRefs.has(item)) {
              return QueryEngine.update(item, data);
            }
            return item;
          });

          await this.write(
            tableName,
            finalData,
            withInternalTableLock(
              withInternalDirectWrite({
                ...options,
                ..._updateOptions,
                mode: 'overwrite' as const,
              })
            )
          );

          return updatedCount;
        });
      },
      (tableName: string) => this.deleteTable(tableName, withInternalDirectWrite({ ...options })),
      finalize,
      transactionOwner
    );
  }

  async rollback(_options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(_options);
    await this.transactionService.rollback(
      (tableName: string, data: StorageInput<StorageRecord>, options?: InternalWriteOptions) =>
        this.withTableWriteLock(tableName, () =>
          this.dataWriter.write(tableName, data, withInternalDirectWrite({ ...options }))
        ),
      (tableName: string) => this.deleteTable(tableName, withInternalDirectWrite({ ..._options })),
      false,
      transactionOwner
    );
  }

  async migrateToChunked(tableName: string, options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    return this.runPublicSchemaChange(options, async () => {
      const tableMeta = this.metadataManager.getLatest
        ? await this.metadataManager.getLatest(tableName)
        : this.metadataManager.get(tableName);
      if (!tableMeta) {
        throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
          details: `Failed to migrate table ${tableName} to chunked mode: table not found`,
          suggestion: 'Check if the table name is correct',
        });
      }

      await this.dataWriter.migrateToChunked(tableName);
      this.cacheService.clearTableCache(tableName);
    });
  }

  async createIndex(tableName: string, field: string, unique = false): Promise<void> {
    await this.ensureInitialized();
    assertValidTableName(tableName);
    const indexType = unique ? IndexType.UNIQUE : IndexType.NORMAL;
    await this.indexManager.createIndex(tableName, field, indexType);

    try {
      // Hold the table write lock across snapshot read and rebuild so no write can
      // slip in between and leave the ready index missing entries.
      await this.withTableWriteLock(tableName, async () => {
        const records = await this.dataReader.read(tableName, { bypassCache: true });
        this.indexManager.rebuildIndexes(tableName, records);
      });
    } catch (error) {
      try {
        await this.indexManager.dropIndex(tableName, field, indexType);
      } catch {
        // Keep the original build failure as the reported error.
      }
      // A crash between the debounced declaration write and its flush must not
      // resurrect a dropped index, so persist the final state immediately. The
      // debounced save still retries this, so a flush failure must never mask
      // the original build failure.
      try {
        await this.metadataManager.saveImmediately?.();
      } catch (flushError) {
        logger.warn(`failed to flush index metadata for table ${tableName}`, describeLogError(flushError));
      }
      throw error;
    }
    // Persist the declaration right away (as the SQLite engine does): a unique
    // constraint silently lost to a crash inside the debounce window would
    // change write semantics on the next launch.
    await this.metadataManager.saveImmediately?.();
  }

  async dropIndex(tableName: string, field: string): Promise<void> {
    await this.ensureInitialized();
    assertValidTableName(tableName);
    try {
      await this.indexManager.dropIndex(tableName, field, IndexType.NORMAL);
    } catch {
      await this.indexManager.dropIndex(tableName, field, IndexType.UNIQUE);
    }
    // The drop is already final in memory and in staged metadata; the debounced
    // save retries a failed flush, so report success rather than a spurious error.
    try {
      await this.metadataManager.saveImmediately?.();
    } catch (error) {
      logger.warn(`failed to flush index metadata for table ${tableName}`, describeLogError(error));
    }
  }
}
let storageInstance: FileSystemStorageAdapter | null = null;

function getStorageInstance(): FileSystemStorageAdapter {
  if (!storageInstance) {
    storageInstance = new FileSystemStorageAdapter();
  }
  return storageInstance;
}

const storage = new Proxy({} as FileSystemStorageAdapter, {
  get(_, prop) {
    const instance = getStorageInstance();
    const value = instance[prop as keyof FileSystemStorageAdapter];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});

export default storage;
