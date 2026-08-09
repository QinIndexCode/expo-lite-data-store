import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageEngine } from '../../types/storageEngineInfc';
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
import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import logger from '../../utils/logger';
import { pathHelper } from '../../utils/PathHelper';
import { QueryEngine } from '../query/QueryEngine';
import {
  getLogicalRecordCount,
  getTransactionOwner,
  hasInternalDirectWrite,
  TransactionService,
  withInternalDirectWrite,
  type TransactionOwnerToken,
  type TransactionWriteOptions,
} from '../service/TransactionService';
import { meta, type TableSchema } from '../meta/MetadataManager';
import { configManager } from '../config/ConfigManager';
import { assertValidTableName } from '../../utils/tableName';

type PayloadRow = {
  id: number;
  payload: string;
};

type SequenceRow = {
  nextId: number;
};

type CountRow = {
  count: number;
};

/**
 * SQLite-backed storage engine.
 *
 * Logical tables share one physical table (`__elds_records`) keyed by
 * `table_name` with an ordered per-table sequence column. Records are stored
 * as JSON payloads so encrypted envelopes produced by the decorator layer are
 * persisted verbatim. Table schemas and logical counts stay in the shared
 * {@link IMetadataManager}, keeping the decorator contract identical to the
 * file-system engine.
 *
 * Every SQL statement is serialized through a chain so the asynchronous
 * expo-sqlite API never interleaves statements inside a transaction.
 */
export class SQLiteStorageAdapter implements IStorageEngine {
  private readonly metadataManager: IMetadataManager;
  private readonly transactionService = new TransactionService();

  private readonly databaseName: string;
  private db: SQLiteDatabase | null = null;
  private initializationPromise: Promise<void> | null = null;
  private sqlChain: Promise<unknown> = Promise.resolve();

  constructor(metadataManager?: IMetadataManager, options?: { databaseName?: string }) {
    this.metadataManager = metadataManager ?? meta;
    this.databaseName = options?.databaseName ?? 'expo-lite-data-store.db';
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private assertDatabase(): SQLiteDatabase {
    if (!this.db) {
      throw new StorageError('SQLite database is not initialized', 'DB_NOT_INITIALIZED', {
        suggestion: 'Call ensureInitialized() or another public API first.',
      });
    }
    return this.db;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    // Inside an open SQL transaction every statement already runs under the
    // single enqueued task that opened it, so queuing again would chain
    // behind that task and deadlock the statement chain.
    if (this.sqlTxDepth > 0) {
      return operation();
    }
    const next = this.sqlChain.then(operation, operation);
    this.sqlChain = next.catch(() => undefined);
    return next;
  }

  private validateTableName(tableName: string): void {
    assertValidTableName(tableName);
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

  private normalizeBulkOperations<T extends object>(operations: BulkOperation<T>[]): BulkOperation<StorageRecord>[] {
    return operations.map(operation => {
      switch (operation.type) {
        case 'insert': {
          const records = this.normalizeStorageInput(operation.data);
          return { type: 'insert', data: Array.isArray(operation.data) ? records : records[0] };
        }
        case 'update':
          return {
            type: 'update',
            data: this.normalizeStorageRecord(operation.data),
            where: operation.where as FilterCondition<StorageRecord>,
          };
        case 'delete':
          return { type: 'delete', where: operation.where as FilterCondition<StorageRecord> };
      }
    });
  }

  private toStorageReadOptions<T extends object>(options?: ReadOptions<T>): ReadOptions<StorageRecord> | undefined {
    return options as unknown as ReadOptions<StorageRecord> | undefined;
  }

  private toStorageFindOptions<T extends object>(options?: FindOptions<T>): FindOptions<StorageRecord> | undefined {
    return options as unknown as FindOptions<StorageRecord> | undefined;
  }

  private toPublicRecords<T extends object>(records: StorageRecord[]): T[] {
    return records as unknown as T[];
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

  private sqlTxDepth = 0;

  /**
   * Runs a task atomically as one SQLite transaction. SQLite does not support
   * nested transactions, so when this method re-enters itself — the commit/
   * rollback replay from {@link TransactionService} calls storage writes while
   * the SQL transaction is already open — the inner invocation executes the
   * task inside the existing transaction instead of issuing a nested BEGIN.
   *
   * The depth check happens before {@link enqueue} because the commit replay
   * runs inside an enqueued task: an inner enqueue would chain behind the
   * task that is awaiting it and deadlock the statement chain.
   */
  private async withSqlTransaction(task: () => Promise<void>): Promise<void> {
    if (this.sqlTxDepth > 0) {
      await task();
      return;
    }
    await this.enqueue(async () => {
      const db = this.assertDatabase();
      this.sqlTxDepth = 1;
      await db.execAsync('BEGIN');
      try {
        await task();
        await db.execAsync('COMMIT');
      } catch (error) {
        try {
          await db.execAsync('ROLLBACK');
        } catch (rollbackError) {
          logger.warn('[SQLiteStorageAdapter] rollback failed after write error', rollbackError);
        }
        throw error;
      } finally {
        this.sqlTxDepth = 0;
      }
    });
  }

  private async sqlWrite(tableName: string, items: StorageRecord[], overwrite: boolean): Promise<void> {
    const db = this.assertDatabase();
    if (overwrite) {
      await db.runAsync('DELETE FROM __elds_records WHERE table_name = ?', [tableName]);
    }
    const seq = await db.getFirstAsync<SequenceRow>(
      'SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM __elds_records WHERE table_name = ?',
      [tableName]
    );
    let nextId = seq?.nextId ?? 1;
    for (const item of items) {
      await db.runAsync('INSERT INTO __elds_records (table_name, id, payload) VALUES (?, ?, ?)', [
        tableName,
        nextId++,
        JSON.stringify(item),
      ]);
    }
  }

  private async sqlRead(tableName: string): Promise<PayloadRow[]> {
    const db = this.assertDatabase();
    return db.getAllAsync<PayloadRow>('SELECT id, payload FROM __elds_records WHERE table_name = ? ORDER BY id ASC', [
      tableName,
    ]);
  }

  private async sqlDeleteAll(tableName: string): Promise<void> {
    const db = this.assertDatabase();
    await db.runAsync('DELETE FROM __elds_records WHERE table_name = ?', [tableName]);
  }

  private async sqlCount(tableName: string): Promise<number> {
    const db = this.assertDatabase();
    const row = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM __elds_records WHERE table_name = ?', [
      tableName,
    ]);
    return row?.count ?? 0;
  }

  private async readPersistedRecords(tableName: string): Promise<StorageRecord[]> {
    if (!this.metadataManager.get(tableName)) {
      throw new StorageError(`Table '${tableName}' not found`, 'TABLE_NOT_FOUND');
    }
    const rows = await this.enqueue(async () => this.sqlRead(tableName));
    return rows.map(row => JSON.parse(row.payload) as StorageRecord);
  }

  private async createTableIfMissing(tableName: string, options?: InternalWriteOptions): Promise<void> {
    await this.ensureInitialized();
    if (!this.metadataManager.get(tableName)) {
      await this.createTable(tableName, {
        mode: options?.forceChunked ? 'chunked' : undefined,
        encrypted: options?.encrypted === true || options?.encryptFullTable === true,
        encryptFullTable: options?.encryptFullTable,
        requireAuthOnAccess: options?.requireAuthOnAccess,
      });
    }
  }

  private createTransactionDdlError(): StorageError {
    return new StorageError(
      'Table structure changes are not supported during an active transaction',
      'TRANSACTION_OPERATION_NOT_SUPPORTED',
      {
        details: 'createTable(), deleteTable(), and migrateToChunked() persist metadata or physical rows immediately.',
        suggestion: 'Commit or roll back the active transaction before changing table structure.',
      }
    );
  }

  private assertTransactionDdlAllowed(options?: unknown): void {
    if (this.transactionService.isInTransaction() && !hasInternalDirectWrite(options)) {
      throw this.createTransactionDdlError();
    }
  }

  private assertTransactionAccess(options?: unknown): TransactionOwnerToken | undefined {
    const owner = getTransactionOwner(options);
    this.transactionService.assertTransactionOwner(owner);
    return owner;
  }

  private async runPublicSchemaChange<T>(options: unknown, operation: () => Promise<T>): Promise<T> {
    this.assertTransactionAccess(options);
    if (hasInternalDirectWrite(options)) {
      this.assertTransactionDdlAllowed(options);
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

  private getCurrentTransactionData(tableName: string, owner?: TransactionOwnerToken): Promise<StorageRecord[]> {
    return this.transactionService.getCurrentTransactionData(
      tableName,
      (currentTableName: string) => this.readPersistedRecords(currentTableName),
      owner
    );
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async ensureInitialized(): Promise<void> {
    if (this.db) {
      return;
    }
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize().catch(error => {
        this.initializationPromise = null;
        throw error;
      });
    }
    await this.initializationPromise;
  }

  private async initialize(): Promise<void> {
    const directory = pathHelper.getStorageFolder();
    const options = { enableChangeListener: false } as const;
    this.db = await openDatabaseAsync(this.databaseName, options, directory);
    await this.enqueue(async () => {
      const db = this.assertDatabase();
      await db.execAsync('PRAGMA journal_mode = WAL');
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS __elds_records (' +
          'table_name TEXT NOT NULL, ' +
          'id INTEGER NOT NULL, ' +
          'payload TEXT NOT NULL, ' +
          'PRIMARY KEY (table_name, id)' +
          ') WITHOUT ROWID'
      );
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_elds_records_table ON __elds_records (table_name, id)');
    });
  }

  // ------------------------------------------------------------------
  // IStorageAdapter
  // ------------------------------------------------------------------

  async createTable<T extends object = StorageRecord>(
    tableName: string,
    options: CreateTableOptions<T> & {
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {}
  ): Promise<void> {
    this.validateTableName(tableName);

    return this.runPublicSchemaChange(options, async () => {
      await this.ensureInitialized();
      if (this.metadataManager.get(tableName)) {
        return;
      }

      const initialData = options.initialData ? this.normalizeStorageInput(options.initialData) : [];

      await this.withSqlTransaction(async () => {
        await this.sqlWrite(tableName, initialData, true);
      });

      try {
        this.metadataManager.update(tableName, {
          mode: options.mode ?? 'single',
          path: `${tableName}.ldb`,
          count: initialData.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          columns: this.normalizeColumnSchema(options.columns),
          isHighRisk: options.isHighRisk || false,
          highRiskFields: options.highRiskFields || [],
          encryptedFields: options.encryptedFields || [],
          encrypted:
            options.encrypted === true || options.encryptFullTable === true || options.requireAuthOnAccess === true,
          encryptFullTable: options.encryptFullTable || false,
          requireAuthOnAccess: options.requireAuthOnAccess === true,
          ...(hasInternalDirectWrite(options) ? { storageCommitToken: undefined } : {}),
        });
        await this.metadataManager.saveImmediately?.();
      } catch (error) {
        await this.sqlDeleteAll(tableName);
        throw error;
      }
    });
  }

  private normalizeColumnSchema(columns?: CreateTableOptions<StorageRecord>['columns']): TableSchema['columns'] {
    const schema: TableSchema['columns'] = {};
    if (!columns) {
      return schema;
    }
    for (const [column, definition] of Object.entries(columns)) {
      if (typeof definition === 'string' || (definition && typeof definition === 'object')) {
        schema[column] = definition as TableSchema['columns'][string];
      }
    }
    return schema;
  }

  async deleteTable(tableName: string, options?: TableOptions): Promise<void> {
    this.validateTableName(tableName);

    return this.runPublicSchemaChange(options, async () => {
      await this.ensureInitialized();
      const tableMeta = this.metadataManager.get(tableName);
      this.metadataManager.delete(tableName);
      try {
        await this.metadataManager.saveImmediately?.();
      } catch (commitError) {
        if (tableMeta) {
          this.metadataManager.update(tableName, tableMeta);
        }
        throw commitError;
      }

      const cleanupError = await this.enqueue(async () => {
        try {
          await this.sqlDeleteAll(tableName);
          return undefined;
        } catch (error) {
          return error;
        }
      });

      if (cleanupError) {
        throw new StorageError(
          `Table '${tableName}' was deleted but physical cleanup is incomplete`,
          'TABLE_DELETE_FAILED',
          {
            cause: cleanupError,
            details: 'The metadata deletion is durable, so the table remains logically absent.',
            suggestion: 'Retry deleteTable with the same name to remove orphaned records.',
            tableName,
          }
        );
      }
    });
  }

  async hasTable(tableName: string, options?: TableOptions): Promise<boolean> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    this.validateTableName(tableName);
    return this.metadataManager.get(tableName) !== undefined;
  }

  async listTables(options?: TableOptions): Promise<string[]> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    return this.metadataManager.allTables();
  }

  async overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return this.write(tableName, data, { ...options, mode: 'overwrite' });
  }

  async insert<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.write(tableName, data, { ...options, mode: 'append' });
  }

  async write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        this.validateTableName(tableName);
        const transactionOwner = this.assertTransactionAccess(options);
        const normalizedData = this.normalizeStorageInput(data);
        const directWrite = hasInternalDirectWrite(options);
        const logicalCount = getLogicalRecordCount(options);

        if (this.transactionService.isInTransaction() && !directWrite) {
          const persistedData = await this.readPersistedRecords(tableName);
          this.saveTransactionSnapshot(tableName, persistedData, transactionOwner);
          this.transactionService.addOperation(
            {
              tableName,
              type: options?.mode === 'overwrite' ? 'overwrite' : 'write',
              data: normalizedData,
              options,
            },
            transactionOwner
          );
          const currentCount = await this.getCurrentTransactionData(tableName, transactionOwner);
          return {
            written: normalizedData.length,
            totalAfterWrite: logicalCount ?? currentCount.length,
            chunked: false,
          };
        }

        await this.createTableIfMissing(tableName, options);
        await this.withSqlTransaction(async () => {
          await this.sqlWrite(tableName, normalizedData, options?.mode === 'overwrite');
        });
        const finalCount = logicalCount ?? (await this.enqueue(async () => this.sqlCount(tableName)));
        this.metadataManager.update(tableName, { count: finalCount, updatedAt: Date.now() });
        await this.metadataManager.saveImmediately?.();

        return {
          written: normalizedData.length,
          totalAfterWrite: finalCount,
          chunked: false,
        };
      },
      cause => StorageErrorHandler.createFileError('write', `table ${tableName}`, cause)
    );
  }

  async read<T extends object = StorageRecord>(tableName: string, options?: ReadOptions<NonInfer<T>>): Promise<T[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        this.validateTableName(tableName);
        const transactionOwner = this.assertTransactionAccess(options);
        const storageOptions = this.toStorageReadOptions(options);

        if (this.transactionService.isInTransaction()) {
          const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
          return this.toPublicRecords<T>(this.applyReadOptions(transactionData, storageOptions));
        }

        const data = await this.readPersistedRecords(tableName);
        return this.toPublicRecords<T>(this.applyReadOptions(data, storageOptions));
      },
      cause => StorageErrorHandler.createFileError('read', `table ${tableName}`, cause)
    );
  }

  async count(tableName: string, options?: TableOptions): Promise<number> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    const transactionOwner = this.assertTransactionAccess(options);

    if (this.transactionService.isInTransaction()) {
      const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
      return transactionData.length;
    }

    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      return 0;
    }
    const actual = await this.enqueue(async () => this.sqlCount(tableName));
    if (actual !== tableMeta.count) {
      this.metadataManager.update(tableName, { count: actual, updatedAt: Date.now() });
    }
    return actual;
  }

  async verifyCount(
    tableName: string,
    options?: TableOptions
  ): Promise<{ metadata: number; actual: number; match: boolean }> {
    await this.ensureInitialized();
    this.assertTransactionAccess(options);
    this.validateTableName(tableName);

    const metadataCount = this.metadataManager.count(tableName);
    const actualCount = await this.enqueue(async () => this.sqlCount(tableName));
    const match = metadataCount === actualCount;

    if (!match) {
      this.metadataManager.update(tableName, { count: actualCount, updatedAt: Date.now() });
      await this.metadataManager.saveImmediately?.();
    }

    return { metadata: metadataCount, actual: actualCount, match };
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    options?: TableOptions
  ): Promise<T | null> {
    const records = await this.read(tableName, {
      ...options,
      filter: filter as FilterCondition<StorageRecord>,
      limit: 1,
    });
    return (records[0] ?? null) as T | null;
  }

  async findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    findOptions?: TableOptions
  ): Promise<T[]> {
    return this.read<T>(tableName, {
      ...findOptions,
      ...this.toStorageFindOptions(options),
      ...(filter ? { filter: filter as FilterCondition<StorageRecord> } : {}),
    } as ReadOptions<NonInfer<T>>);
  }

  async clearTable(tableName: string, options?: TableOptions): Promise<void> {
    await this.write(tableName, [], { ...options, mode: 'overwrite' });
  }

  async delete<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: InternalWriteOptions
  ): Promise<number> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        this.validateTableName(tableName);
        const transactionOwner = this.assertTransactionAccess(options);
        const directWrite = hasInternalDirectWrite(options);
        const storageWhere = where as FilterCondition<StorageRecord>;

        if (this.transactionService.isInTransaction() && !directWrite) {
          const transactionData = await this.getCurrentTransactionData(tableName, transactionOwner);
          const deletedCount = QueryEngine.filter(transactionData, storageWhere).length;
          const persisted = await this.readPersistedRecords(tableName);
          this.saveTransactionSnapshot(tableName, persisted, transactionOwner);
          this.transactionService.addOperation(
            { tableName, type: 'delete', where: storageWhere, options },
            transactionOwner
          );
          return deletedCount;
        }

        const data = await this.readPersistedRecords(tableName);
        const filteredData = data.filter(item => QueryEngine.filter([item], storageWhere).length === 0);
        const deletedCount = data.length - filteredData.length;

        if (deletedCount === 0) {
          return 0;
        }

        await this.withSqlTransaction(async () => {
          await this.sqlWrite(tableName, filteredData, true);
        });
        this.metadataManager.update(tableName, { count: filteredData.length, updatedAt: Date.now() });
        await this.metadataManager.saveImmediately?.();

        return deletedCount;
      },
      cause => StorageErrorHandler.createFileError('delete', `table ${tableName}`, cause)
    );
  }

  async remove<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    return this.delete(tableName, where, options);
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: InternalWriteOptions
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        this.validateTableName(tableName);
        const transactionOwner = this.assertTransactionAccess(options);
        const directWrite = hasInternalDirectWrite(options);
        const normalizedOperations = this.normalizeBulkOperations(operations);

        if (this.transactionService.isInTransaction() && !directWrite) {
          const persisted = await this.readPersistedRecords(tableName);
          this.saveTransactionSnapshot(tableName, persisted, transactionOwner);
          this.transactionService.addOperation(
            { tableName, type: 'bulkWrite', operations: normalizedOperations, options },
            transactionOwner
          );
          const currentCount = await this.getCurrentTransactionData(tableName, transactionOwner);
          return {
            written: operations.length,
            totalAfterWrite: currentCount.length,
            chunked: false,
          };
        }

        await this.createTableIfMissing(tableName, options);
        const insertOnly = normalizedOperations.every(operation => operation.type === 'insert');
        let finalCount: number;

        if (insertOnly) {
          const insertItems = normalizedOperations.flatMap(operation =>
            Array.isArray(operation.data) ? operation.data : [operation.data]
          );
          await this.withSqlTransaction(async () => {
            await this.sqlWrite(tableName, insertItems, false);
          });
          finalCount = await this.enqueue(async () => this.sqlCount(tableName));
          this.metadataManager.update(tableName, { count: finalCount, updatedAt: Date.now() });
          await this.metadataManager.saveImmediately?.();
          return { written: insertItems.length, totalAfterWrite: finalCount, chunked: false };
        }

        const allData = await this.readPersistedRecords(tableName);
        let finalData = [...allData];
        let writtenCount = 0;

        for (const operation of normalizedOperations) {
          if (operation.type === 'insert') {
            const insertItems = Array.isArray(operation.data) ? operation.data : [operation.data];
            finalData = [...finalData, ...insertItems];
            writtenCount += insertItems.length;
          } else if (operation.type === 'update') {
            const matchedItems = QueryEngine.filter(finalData, operation.where);
            const matchedItemRefs = new Set(matchedItems);
            finalData = finalData.map(item =>
              matchedItemRefs.has(item) ? QueryEngine.update(item, operation.data) : item
            );
            writtenCount += matchedItems.length;
          } else {
            const deletedItems = QueryEngine.filter(finalData, operation.where);
            const deletedItemRefs = new Set(deletedItems);
            finalData = finalData.filter(item => !deletedItemRefs.has(item));
            writtenCount += deletedItems.length;
          }
        }

        await this.withSqlTransaction(async () => {
          await this.sqlWrite(tableName, finalData, true);
        });
        finalCount = finalData.length;
        this.metadataManager.update(tableName, { count: finalCount, updatedAt: Date.now() });
        await this.metadataManager.saveImmediately?.();

        return { written: writtenCount, totalAfterWrite: finalCount, chunked: false };
      },
      cause => StorageErrorHandler.createFileError('bulkWrite', `table ${tableName}`, cause)
    );
  }

  async update<T extends object = StorageRecord>(
    tableName: string,
    data: UpdatePayload<T>,
    where: FilterCondition<T>,
    options?: InternalWriteOptions
  ): Promise<number> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.ensureInitialized();
        this.validateTableName(tableName);
        const transactionOwner = this.assertTransactionAccess(options);
        const directWrite = hasInternalDirectWrite(options);
        const storageWhere = where as FilterCondition<StorageRecord>;
        const storageData = this.normalizeStorageRecord(data as object);

        let allData: StorageRecord[];
        if (this.transactionService.isInTransaction()) {
          allData = await this.getCurrentTransactionData(tableName, transactionOwner);
        } else {
          allData = await this.readPersistedRecords(tableName);
        }

        const matchedItems = QueryEngine.filter(allData, storageWhere);
        const updatedCount = matchedItems.length;

        if (updatedCount === 0) {
          return 0;
        }

        const matchedItemRefs = new Set(matchedItems);
        const finalData = allData.map(item =>
          matchedItemRefs.has(item) ? QueryEngine.update(item, storageData) : item
        );

        if (this.transactionService.isInTransaction() && !directWrite) {
          const persisted = await this.readPersistedRecords(tableName);
          this.saveTransactionSnapshot(tableName, persisted, transactionOwner);
          this.transactionService.addOperation(
            { tableName, type: 'update', data: storageData, where: storageWhere, options },
            transactionOwner
          );
          return updatedCount;
        }

        await this.withSqlTransaction(async () => {
          await this.sqlWrite(tableName, finalData, true);
        });
        this.metadataManager.update(tableName, { count: finalData.length, updatedAt: Date.now() });
        await this.metadataManager.saveImmediately?.();

        return updatedCount;
      },
      cause => StorageErrorHandler.createFileError('update', `table ${tableName}`, cause)
    );
  }

  // ------------------------------------------------------------------
  // IStorageEngine extensions
  // ------------------------------------------------------------------

  async migrateToChunked(_tableName: string, _options?: TableOptions): Promise<void> {
    // SQLite is already the optimal physical layout; chunked file mode is a
    // file-system concept and requires no action here.
    logger.info('[SQLiteStorageAdapter] migrateToChunked is a no-op for SQLite storage');
  }

  getTableMeta(tableName: string): TableSchema | undefined {
    this.validateTableName(tableName);
    return this.metadataManager.get(tableName);
  }

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

    this.metadataManager.update(tableName, { count, updatedAt: Date.now() });
    await this.metadataManager.saveImmediately?.();
  }

  assertTransactionOwner(owner: TransactionOwnerToken): void {
    this.transactionService.assertTransactionOwner(owner);
  }

  isInTransaction(): boolean {
    return this.transactionService.isInTransaction();
  }

  async beginTransaction(options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    await this.transactionService.beginTransaction(getTransactionOwner(options));
  }

  async commit(options?: TableOptions, finalize?: () => Promise<void>): Promise<void> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);

    await this.withSqlTransaction(async () => {
      await this.transactionService.commit(
        async (tableName: string, data: StorageInput<StorageRecord>, opOptions?: TransactionWriteOptions) => {
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
          return this.update(tableName, data, where, withInternalDirectWrite({ ...options, ..._updateOptions }));
        },
        (tableName: string) => this.deleteTable(tableName, withInternalDirectWrite({ ...options })),
        finalize,
        transactionOwner
      );
    });
  }

  async rollback(options?: TableOptions): Promise<void> {
    await this.ensureInitialized();
    const transactionOwner = this.assertTransactionAccess(options);

    const restoreOperation = async (): Promise<void> => {
      await this.transactionService.rollback(
        async (tableName: string, data: StorageInput<StorageRecord>, restoreOptions?: InternalWriteOptions) => {
          return this.write(tableName, data, withInternalDirectWrite({ ...restoreOptions }));
        },
        (tableName: string) => this.deleteTable(tableName, withInternalDirectWrite({ ...options })),
        false,
        transactionOwner
      );
    };

    await this.withSqlTransaction(restoreOperation);
  }
}
