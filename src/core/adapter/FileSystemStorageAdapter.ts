import { configManager } from '../config/ConfigManager';
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
import { FileOperationManager } from '../FileOperationManager';
import { CacheConfig, CacheManager, CacheStrategy } from '../cache/CacheManager';
import { CACHE } from '../constants';
import { DataReader } from '../data/DataReader';
import { DataWriter } from '../data/DataWriter';
import { IndexManager } from '../index/IndexManager';
import { MetadataManager, type TableSchema } from '../meta/MetadataManager';
import { CacheMonitor } from '../monitor/CacheMonitor';
import { performanceMonitor } from '../monitor/PerformanceMonitor';
import { CacheService } from '../service/CacheService';
import { TransactionService } from '../service/TransactionService';
import { AutoSyncService } from '../service/AutoSyncService';

import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { ensureStorageRootReady, getRootPathSync } from '../../utils/ROOTPath';
import { getFileSystem } from '../../utils/fileSystemCompat';
import { pathHelper } from '../../utils/PathHelper';
import { QueryEngine } from '../query/QueryEngine';
import { assertValidTableName } from '../../utils/tableName';

export class FileSystemStorageAdapter implements IStorageAdapter {
  private metadataManager: IMetadataManager;

  private indexManager: IndexManager;

  private fileOperationManager: FileOperationManager;

  private cacheManager: CacheManager;

  private cacheService: CacheService;

  private transactionService: TransactionService;

  private autoSyncService: AutoSyncService;

  private dataReader: DataReader;

  private dataWriter: DataWriter;

  private cacheMonitor: CacheMonitor;
  private initializationPromise: Promise<void> | null = null;
  private servicesStarted = false;
  private taskQueueInitialized = false;
  private initializedStorageFolder: string | null = null;

  /** Converts public object inputs into runtime-validated persistence records. */
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

  /** Public record types may be named interfaces without index signatures. */
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
    this.fileOperationManager = new FileOperationManager(currentConfig.chunkSize, this.metadataManager);
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
    this.transactionService = new TransactionService();
    this.cacheMonitor = new CacheMonitor(this.cacheManager);
    this.dataReader = new DataReader(this.metadataManager, this.indexManager, this.cacheManager);
    this.dataWriter = new DataWriter(this.metadataManager, this.indexManager, this.fileOperationManager);
    this.autoSyncService = AutoSyncService.getInstance(this.cacheService, this);
  }

  private async initializeRuntime(): Promise<void> {
    const storageFolder = pathHelper.getStorageFolder();
    await ensureStorageRootReady();

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

  async cleanup(): Promise<void> {
    await this.autoSyncService.cleanup();
    await taskQueue.stop({ force: true });
    await taskQueue.cleanup();

    if (this.cacheMonitor) {
      this.cacheMonitor.stopMonitoring();
    }

    if (this.cacheManager) {
      this.cacheManager.clear();
      this.cacheManager.cleanup();
    }

    if (typeof (this.metadataManager as MetadataManager).cleanup === 'function') {
      (this.metadataManager as MetadataManager).cleanup();
    }

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

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }

    const normalizedOptions: CreateTableOptions<StorageRecord> & {
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {
      ...options,
      initialData: options.initialData ? this.normalizeStorageInput(options.initialData) : undefined,
    };

    return this.dataWriter.createTable(tableName, normalizedOptions);
  }

  async deleteTable(tableName: string, _options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }

    const result = await this.dataWriter.deleteTable(tableName);
    // Clear all cache related to this table
    this.cacheService.clearTableCache(tableName);
    return result;
  }

  async hasTable(tableName: string, _options?: TableOptions): Promise<boolean> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    return this.dataWriter.hasTable(tableName);
  }

  async listTables(_options?: TableOptions): Promise<string[]> {
    await this.ensureInitialized();
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
        this.validateTableName(tableName);

        // Input validation: table name cannot be empty and must be a string
        if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
          throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
            suggestion: 'Provide a valid non-empty string for tableName',
          });
        }
        const normalizedData = this.normalizeStorageInput(data);
        const startTime = Date.now();
        const dataSize = normalizedData.length;

        // Transaction handling logic
        if (this.transactionService.isInTransaction()) {
          const currentData = await this.dataReader.read(tableName, { bypassCache: true });
          this.transactionService.saveSnapshot(
            tableName,
            currentData,
            this.metadataManager.get(tableName) !== undefined
          );

          // Add operation to transaction queue
          this.transactionService.addOperation({
            tableName,
            type: 'overwrite',
            data: normalizedData,
            options,
          });
          return {
            written: normalizedData.length,
            totalAfterWrite: normalizedData.length,
            chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
          };
        }

        // Overwrite mode: write data directly
        const result = await this.dataWriter.write(tableName, normalizedData, { ...options, mode: 'overwrite' });
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
        this.validateTableName(tableName);

        // Input validation: table name cannot be empty and must be a string
        if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
          throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
            suggestion: 'Provide a valid non-empty string for tableName',
          });
        }
        const normalizedData = this.normalizeStorageInput(data);
        const startTime = Date.now();
        const dataSize = normalizedData.length;

        // Transaction handling logic
        if (this.transactionService.isInTransaction() && !options?.directWrite) {
          const currentData = await this.dataReader.read(tableName, { bypassCache: true });
          this.transactionService.saveSnapshot(
            tableName,
            currentData,
            this.metadataManager.get(tableName) !== undefined
          );

          // Add operation to transaction queue
          this.transactionService.addOperation({
            tableName,
            type: 'write',
            data: normalizedData,
            options,
          });
          const currentCount = await this.count(tableName);
          return {
            written: normalizedData.length,
            totalAfterWrite: currentCount + normalizedData.length,
            chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
          };
        }

        // Not in transaction, or directWrite is true. Let DataWriter own append merging
        // so concurrent inserts stay behind the same per-table lock instead of racing on
        // adapter-level stale snapshots.
        const writtenCount = normalizedData.length;
        const result = await this.dataWriter.write(tableName, normalizedData, options);

        if (options?.mode === 'append') {
          result.written = writtenCount;
        }
        if (this.transactionService.isInTransaction() && options?.directWrite) {
          // Append/default writes need a post-write read because the writer merged with the
          // current persisted table inside its lock.
          const latestTransactionData =
            options?.mode === 'overwrite'
              ? normalizedData
              : await this.dataReader.read(tableName, { bypassCache: true });
          this.transactionService.setTransactionData(tableName, latestTransactionData);
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
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }
    // Transactional reads include staged operations that are not persisted yet.
    if (this.transactionService.isInTransaction()) {
      const transactionData = await this.transactionService.getCurrentTransactionData(
        tableName,
        (currentTableName: string) => this.dataReader.read(currentTableName, this.toStorageReadOptions(options))
      );
      return this.toPublicRecords<T>(transactionData);
    }

    return this.toPublicRecords<T>(await this.dataReader.read(tableName, this.toStorageReadOptions(options)));
  }

  async count(tableName: string): Promise<number> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    return this.dataWriter.count(tableName);
  }

  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }

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
  async setLogicalRecordCount(tableName: string, count: number): Promise<void> {
    await this.ensureInitialized();
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

  private async recoverTableMetaFromFiles(tableName: string, recordCount: number): Promise<TableSchema | undefined> {
    this.validateTableName(tableName);
    const fileSystem = getFileSystem();
    const rootPath = getRootPathSync();
    const singleFilePath = `${rootPath}${tableName}.ldb`;
    const chunkedDirPath = `${rootPath}${tableName}/`;

    const [singleInfo, chunkedInfo] = await Promise.all([
      fileSystem.getInfoAsync(singleFilePath),
      fileSystem.getInfoAsync(chunkedDirPath),
    ]);

    if (!singleInfo.exists && !chunkedInfo.exists) {
      return undefined;
    }

    const chunkEntries = chunkedInfo.exists ? await fileSystem.readDirectoryAsync(chunkedDirPath) : [];
    const chunkFiles = chunkEntries.filter(entry => entry.endsWith('.ldb'));

    this.metadataManager.update(tableName, {
      mode: chunkedInfo.exists ? 'chunked' : 'single',
      path: chunkedInfo.exists ? `${tableName}/` : `${tableName}.ldb`,
      count: recordCount,
      chunks: chunkedInfo.exists ? chunkFiles.length : 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      columns: {},
    });

    return this.metadataManager.get(tableName);
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    _options?: TableOptions
  ): Promise<T | null> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
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
    this.validateTableName(tableName);
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
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }

    // Transaction handling logic
    if (this.transactionService.isInTransaction() && !options?.directWrite) {
      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.transactionService.saveSnapshot(tableName, currentData, this.metadataManager.get(tableName) !== undefined);

      // Add operation to transaction queue
      this.transactionService.addOperation({
        tableName,
        type: 'delete',
        where: this.toStorageFilter(where),
        options,
      });
      return 0;
    }
    const result = await this.dataWriter.delete(tableName, this.toStorageFilter(where));
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
    this.validateTableName(tableName);

    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }
    let allData;
    if (this.transactionService.isInTransaction()) {
      allData = await this.transactionService.getCurrentTransactionData(tableName, (tableName: string) =>
        this.dataReader.read(tableName)
      );
    } else {
      allData = await this.dataReader.read(tableName);
    }

    // Optimization:
    const storageWhere = this.toStorageFilter(where);
    const storageData = this.normalizeStorageRecord(data);
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

    if (this.transactionService.isInTransaction() && !options?.directWrite) {
      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.transactionService.saveSnapshot(tableName, currentData, this.metadataManager.get(tableName) !== undefined);

      // Add operation to transaction queue
      this.transactionService.addOperation({
        tableName,
        type: 'update',
        data: storageData,
        where: storageWhere,
        options: { mode: 'overwrite' },
      });

      return updatedCount;
    }

    if (updatedCount > 0) {
      await this.write(tableName, finalData, { mode: 'overwrite', directWrite: options?.directWrite });

      // Note:
      // Avoid duplicate updates causing operators like $inc to execute multiple times
    }

    return updatedCount;
  }

  async clearTable(tableName: string): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    // Input validation: table name cannot be empty and must be a string
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: must be a non-empty string', 'TABLE_NAME_INVALID', {
        suggestion: 'Provide a valid non-empty string for tableName',
      });
    }

    // Write empty array to clear table
    await this.write(tableName, [], { mode: 'overwrite' });
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    const startTime = Date.now();
    if (this.transactionService.isInTransaction() && !options?.directWrite) {
      const currentData = await this.dataReader.read(tableName, { bypassCache: true });
      this.transactionService.saveSnapshot(tableName, currentData, this.metadataManager.get(tableName) !== undefined);
      const normalizedOperations = this.normalizeBulkOperations(operations);
      this.transactionService.addOperation({
        tableName,
        type: 'bulkWrite',
        operations: normalizedOperations,
        options,
      });

      // Return mock result in transaction
      const currentCount = await this.count(tableName);
      return {
        written: operations.length,
        totalAfterWrite: currentCount + operations.length,
        chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
      };
    }

    const normalizedOperations = this.normalizeBulkOperations(operations);
    const insertOnlyItems = this.flattenInsertOperations(normalizedOperations);
    if (insertOnlyItems) {
      const result = await this.dataWriter.write(tableName, insertOnlyItems, { mode: 'append' });

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
    const BATCH_SIZE = 1000; // Data per batch
    const currentData = await this.read(tableName);
    let finalData = [...currentData];
    let writtenCount = 0;

    // Batch process operations
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
    const result = await this.dataWriter.write(tableName, finalData, { mode: 'overwrite' });

    // Clear cache for this table
    this.cacheService.clearTableCache(tableName);
    performanceMonitor.record({
      operation: 'bulkWrite',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: finalData.length,
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

  async beginTransaction(_options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    await this.transactionService.beginTransaction();
  }

  async commit(options?: TableOptions, finalize?: () => Promise<void>): Promise<void> {
    await this.ensureInitialized();
    await this.transactionService.commit(
      // writeFn - Write handler function
      (tableName: string, data: StorageInput<StorageRecord>, opOptions?: InternalWriteOptions) =>
        this.write(tableName, data, { ...options, ...opOptions, directWrite: true }),
      // deleteFn - Delete handler function
      (tableName: string, where: FilterCondition<StorageRecord>, deleteOptions?: InternalWriteOptions) =>
        this.delete(tableName, where, { ...options, ...deleteOptions, directWrite: true }),
      // bulkWriteFn - Bulk write handler
      (tableName: string, operations: BulkOperation<StorageRecord>[], bulkOptions?: InternalWriteOptions) =>
        this.bulkWrite(tableName, operations, { ...options, ...bulkOptions, directWrite: true }),
      // updateFn - Update handler function
      async (
        tableName: string,
        data: UpdatePayload<StorageRecord>,
        where: FilterCondition<StorageRecord>,
        _updateOptions?: InternalWriteOptions
      ) => {
        // Note:
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

        // Write updated data directly
        await this.write(tableName, finalData, { mode: 'overwrite', directWrite: true });

        return updatedCount;
      },
      (tableName: string) => this.deleteTable(tableName),
      finalize
    );
  }

  async rollback(_options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    await this.transactionService.rollback(
      (tableName: string, data: StorageInput<StorageRecord>, options?: InternalWriteOptions) =>
        this.dataWriter.write(tableName, data, { ...options, directWrite: true }),
      (tableName: string) => this.deleteTable(tableName),
      false
    );
  }

  async migrateToChunked(tableName: string): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);

    // Preserve the existing metadata-recovery path before handing the actual
    // conversion to DataWriter, which owns the per-table write lock.
    if (!this.metadataManager.get(tableName)) {
      const data = await this.read(tableName, { bypassCache: true });
      if (!this.metadataManager.get(tableName)) {
        await this.recoverTableMetaFromFiles(tableName, data.length);
      }
    }

    if (!this.metadataManager.get(tableName)) {
      throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
        details: `Failed to migrate table ${tableName} to chunked mode: table not found`,
        suggestion: 'Check if the table name is correct',
      });
    }

    await this.dataWriter.migrateToChunked(tableName);
    this.cacheService.clearTableCache(tableName);
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
