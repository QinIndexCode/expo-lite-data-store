import type { SQLiteDatabase, SQLiteBindParams } from 'expo-sqlite';
import { loadRequiredExpoModule } from '../../utils/expoModuleLoader';
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
import { SqlQueryBuilder } from '../query/SqlQueryBuilder';
import {
  getLogicalRecordCount,
  getTransactionOwner,
  hasDynamicFieldEncryption,
  hasInternalDirectWrite,
  TransactionService,
  withInternalDirectWrite,
  type TransactionOwnerToken,
  type TransactionWriteOptions,
} from '../service/TransactionService';
import { meta, type TableSchema } from '../meta/MetadataManager';
import { configManager } from '../config/ConfigManager';
import { assertValidTableName } from '../../utils/tableName';
import { ensureStorageRootReady } from '../../utils/ROOTPath';

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

  private enqueue<T>(operation: () => Promise<T>, forceChain = false): Promise<T> {
    // Inside an open SQL transaction every statement already runs under the
    // single enqueued task that opened it, so queuing again would chain
    // behind that task and deadlock the statement chain. Callers that do NOT
    // belong to the open transaction pass forceChain to queue behind it
    // instead of interleaving with its statements — otherwise a concurrent
    // insert arriving during an update's read-modify-replace would run in
    // the middle of that transaction and be silently erased by the replace.
    if (this.sqlTxDepth > 0 && !forceChain) {
      return Promise.resolve().then(operation);
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
   * `nested` must be passed only by calls that genuinely run inside an
   * already-open transaction (the replay carries `withInternalDirectWrite`,
   * which no public entry point can forge): those inline their task or they
   * would chain behind the task awaiting them and deadlock the statement
   * chain. A concurrent call that merely arrives while some other operation's
   * transaction is open passes the default (`nested = false`) and chains
   * behind that transaction, so its statements cannot interleave with the
   * open transaction's read-modify-replace.
   */
  private async withSqlTransaction(task: () => Promise<void>, nested = false): Promise<void> {
    if (nested && this.sqlTxDepth > 0) {
      await task();
      return;
    }
    await this.enqueue(async () => {
      const db = this.assertDatabase();
      this.sqlTxDepth = 1;
      try {
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
        }
      } finally {
        this.sqlTxDepth = 0;
      }
    }, true);
  }

  /**
   * Guards expression-index creation against identifier-normalization
   * collisions. `cleanIdentifier` maps both `user.name` and `user_name` to the
   * same index name, so a second CREATE ... IF NOT EXISTS would silently skip
   * (leaving a UNIQUE constraint physically absent while metadata claims it
   * exists) and a later dropIndex would drop the shared index. Fail closed
   * whenever the name is taken by a different field expression.
   */
  private async assertIndexNameAvailable(
    db: SQLiteDatabase,
    tableName: string,
    field: string,
    indexName: string
  ): Promise<void> {
    const row = await db.getFirstAsync<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName]
    );
    if (!row) {
      return;
    }
    const expectedPath = SqlQueryBuilder.getJsonPath(field);
    if (expectedPath && row.sql && row.sql.includes(`'${expectedPath}'`)) {
      // Same table/field expression: recreate is idempotent.
      return;
    }
    throw new StorageError(
      `Index name '${indexName}' is already used by a different field expression`,
      'TABLE_INDEX_ALREADY_EXISTS',
      {
        details: `Field '${field}' normalizes to an index name that already exists on this database with a different JSON path.`,
        suggestion: 'Rename one of the conflicting fields or drop the existing index before creating this one.',
        tableName,
      }
    );
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

  private async readPersistedRecordsOrEmpty(tableName: string): Promise<StorageRecord[]> {
    // Transaction staging mirrors the file-system engine: a table that does not
    // exist yet materializes as an empty view so implicit creation can be
    // staged. Public reads keep the tested TABLE_NOT_FOUND contract.
    if (!this.metadataManager.get(tableName)) {
      return [];
    }
    return this.readPersistedRecords(tableName);
  }

  private async createTableIfMissing(
    tableName: string,
    options?: InternalWriteOptions & Pick<CreateTableOptions<StorageRecord>, 'columns' | 'encryptedFields'>
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.metadataManager.get(tableName)) {
      // Commit replay carries the internal direct-write capability in `options`
      // but builds a fresh object here; propagate it so implicit creation can
      // run inside the commit instead of tripping the public DDL guard.
      const createOptions = {
        mode: (options?.forceChunked ? 'chunked' : undefined) as 'chunked' | undefined,
        columns: options?.columns,
        encrypted: options?.encrypted === true || options?.encryptFullTable === true,
        encryptFullTable: options?.encryptFullTable,
        encryptedFields: options?.encryptedFields,
        requireAuthOnAccess: options?.requireAuthOnAccess,
      };
      await this.createTable(
        tableName,
        hasInternalDirectWrite(options) ? withInternalDirectWrite(createOptions) : createOptions
      );
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
      (currentTableName: string) => this.readPersistedRecordsOrEmpty(currentTableName),
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
    await ensureStorageRootReady();
    // Cold start must hydrate the persisted metadata snapshot before any
    // public API touches `metadataManager.get()`. Without this, every table
    // reports as missing after a restart and the first implicit createTable
    // overwrites surviving rows with empty seed data.
    const metadataLoader = this.metadataManager as IMetadataManager & {
      reload?: () => Promise<void>;
      waitForLoad?: () => Promise<void>;
    };
    if (typeof metadataLoader.reload === 'function') {
      await metadataLoader.reload();
    } else if (typeof metadataLoader.waitForLoad === 'function') {
      await metadataLoader.waitForLoad();
    }
    const directory = pathHelper.getStorageFolder();
    const options = { enableChangeListener: false } as const;
    const sqliteModule = loadRequiredExpoModule<{
      openDatabaseAsync: (
        name: string,
        options?: { enableChangeListener?: boolean },
        directory?: string
      ) => Promise<SQLiteDatabase>;
    }>('expo-sqlite', 'To use the SQLite engine, please install expo-sqlite: `npx expo install expo-sqlite`');
    const db = await sqliteModule.openDatabaseAsync(this.databaseName, options, directory);
    try {
      // The DDL below reads the handle through `assertDatabase()`, so the
      // assignment has to land before the enqueued task runs. It is only kept
      // when every step succeeds; a failure rolls it back so the next
      // `ensureInitialized()` call retries instead of returning early against
      // a handle whose schema was never created.
      this.db = db;
      await this.enqueue(async () => {
        const db = this.assertDatabase();
        await db.execAsync('PRAGMA journal_mode = WAL');
        await db.execAsync('PRAGMA busy_timeout = 5000');
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
    } catch (error) {
      this.db = null;
      try {
        await (db as { closeAsync?: () => Promise<void> }).closeAsync?.();
      } catch {
        // Best effort: failing to close the abandoned handle must never mask
        // the original initialization error.
      }
      throw error;
    }
    this.warnAboutIgnoredCrossCuttingConfig();
  }

  /**
   * One-time notice for cross-cutting config the SQLite engine does not
   * implement: `autoSync` and the storage-side sampling of
   * `monitoring.enablePerformanceTracking` only take effect on the
   * file-system engine, so leaving them on under `sqlite` would silently do
   * nothing storage-side (encrypt/decrypt timing samples still record on both
   * engines). `ensureInitialized()` runs `initialize()` at most once per
   * adapter (guarded by `this.db`, which is only kept after a successful
   * initialization while a failed attempt resets it to `null` so the next call
   * retries, plus the memoized `initializationPromise`), which keeps this
   * warning from repeating for the same adapter instance.
   */
  private warnAboutIgnoredCrossCuttingConfig(): void {
    const config = configManager.getConfig();
    const ignoredKeys: string[] = [];
    const reasons: string[] = [];
    if (config.autoSync?.enabled === true) {
      ignoredKeys.push('autoSync');
      reasons.push('autoSync is only implemented by the file-system engine');
    }
    if (config.monitoring?.enablePerformanceTracking === true) {
      ignoredKeys.push('monitoring.enablePerformanceTracking');
      reasons.push(
        'monitoring.enablePerformanceTracking only records storage-side operations on the file-system engine ' +
          '(encrypt/decrypt timing samples still record on both engines)'
      );
    }
    if (ignoredKeys.length === 0) {
      return;
    }
    const message =
      `[SQLiteStorageAdapter] Configuration has no storage-side effect on the sqlite engine: ${ignoredKeys.join(', ')}. ` +
      `${reasons.join('; ')}. Use engine: 'file-system' or remove them from the config.`;
    logger.warn(message);
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

      const indexesRecord: Record<string, 'unique' | 'normal'> = {};
      await this.withSqlTransaction(async () => {
        await this.sqlWrite(tableName, initialData, true);
        if (Array.isArray(options.indexes)) {
          const db = this.assertDatabase();
          for (const idx of options.indexes) {
            const isUnique = typeof idx === 'object' && idx?.unique === true;
            const fieldName = typeof idx === 'string' ? idx : idx.field;
            if (typeof fieldName !== 'string' || !fieldName.trim()) {
              throw new StorageError('Index field name cannot be empty', 'TABLE_INDEX_INVALID', {
                details:
                  'Every entry of the indexes option must be a field name or { field, unique } with a non-empty field',
                suggestion: 'Provide valid field names via createTable({ indexes })',
              });
            }
            const stmt = SqlQueryBuilder.buildIndexStatement(tableName, fieldName, isUnique);
            if (stmt) {
              const indexName = `idx_${SqlQueryBuilder.cleanIdentifier(tableName)}__${SqlQueryBuilder.cleanIdentifier(fieldName)}`;
              await this.assertIndexNameAvailable(db, tableName, fieldName, indexName);
              await db.execAsync(stmt);
              indexesRecord[`${fieldName}_${isUnique ? 'unique' : 'normal'}`] = isUnique ? 'unique' : 'normal';
            }
          }
        }
      }, hasInternalDirectWrite(options));

      try {
        this.metadataManager.update(tableName, {
          mode: options.mode ?? 'single',
          path: `${tableName}.ldb`,
          count: initialData.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          columns: this.normalizeColumnSchema(options.columns),
          indexes: Object.keys(indexesRecord).length > 0 ? indexesRecord : undefined,
          isHighRisk: options.isHighRisk || false,
          highRiskFields: options.highRiskFields || [],
          encryptedFields: options.encryptedFields || [],
          encrypted:
            options.encrypted === true || options.encryptFullTable === true || options.requireAuthOnAccess === true,
          encryptFullTable: options.encryptFullTable || false,
          ...(hasDynamicFieldEncryption(options) ? { encryptAllFields: true } : {}),
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

  async createIndex(tableName: string, field: string, unique = false): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
        details: `Cannot create index on non-existent table: ${tableName}`,
        suggestion: 'Create the table first before creating an index',
      });
    }

    const stmt = SqlQueryBuilder.buildIndexStatement(tableName, field, unique);
    if (!stmt) {
      throw new StorageError(`Cannot create index on unsafe field: ${field}`, 'TABLE_INDEX_INVALID');
    }

    const oppositeKey = `${field}_${unique ? 'normal' : 'unique'}`;
    const newIndexes = { ...tableMeta.indexes };
    if (newIndexes[oppositeKey] !== undefined) {
      delete newIndexes[oppositeKey];
      const dropStmt = SqlQueryBuilder.buildDropIndexStatement(tableName, field);
      if (dropStmt) {
        await this.enqueue(async () => {
          const db = this.assertDatabase();
          await db.execAsync(dropStmt);
        }, true);
      }
    }

    await this.enqueue(async () => {
      const db = this.assertDatabase();
      const indexName = `idx_${SqlQueryBuilder.cleanIdentifier(tableName)}__${SqlQueryBuilder.cleanIdentifier(field)}`;
      await this.assertIndexNameAvailable(db, tableName, field, indexName);
      await db.execAsync(stmt);
    }, true);

    const indexName = `${field}_${unique ? 'unique' : 'normal'}`;
    newIndexes[indexName] = unique ? 'unique' : 'normal';
    this.metadataManager.update(tableName, {
      indexes: newIndexes,
      updatedAt: Date.now(),
    });
    await this.metadataManager.saveImmediately?.();
  }

  async dropIndex(tableName: string, field: string): Promise<void> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
        details: `Cannot drop index on non-existent table: ${tableName}`,
        suggestion: 'Create the table first before dropping an index',
      });
    }

    const stmt = SqlQueryBuilder.buildDropIndexStatement(tableName, field);
    if (!stmt) {
      throw new StorageError(`Cannot drop index on unsafe field: ${field}`, 'TABLE_INDEX_INVALID');
    }
    await this.enqueue(async () => {
      const db = this.assertDatabase();
      const indexName = `idx_${SqlQueryBuilder.cleanIdentifier(tableName)}__${SqlQueryBuilder.cleanIdentifier(field)}`;
      const row = await db.getFirstAsync<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        [indexName]
      );
      const expectedPath = SqlQueryBuilder.getJsonPath(field);
      if (row && expectedPath && row.sql && !row.sql.includes(`'${expectedPath}'`)) {
        // Legacy databases can hold a shared index name created before
        // collision detection existed. Dropping it also removes the other
        // field's index, so surface that before it happens.
        logger.warn(
          `[SQLiteStorageAdapter] Dropping index '${indexName}' which was created for a different field expression than '${field}'. Metadata for the other affected field should be re-created explicitly.`
        );
      }
      await db.execAsync(stmt);
    }, true);
    if (tableMeta.indexes) {
      const newIndexes = { ...tableMeta.indexes };
      delete newIndexes[`${field}_normal`];
      delete newIndexes[`${field}_unique`];
      this.metadataManager.update(tableName, {
        indexes: Object.keys(newIndexes).length > 0 ? newIndexes : undefined,
        updatedAt: Date.now(),
      });
      await this.metadataManager.saveImmediately?.();
    }
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
          const db = this.assertDatabase();
          await this.sqlDeleteAll(tableName);
          const cleanTable = SqlQueryBuilder.cleanIdentifier(tableName);
          const escapedPrefix = `idx_${cleanTable.replace(/([_%])/g, '\\$1')}__`;
          const indexRows = await db.getAllAsync<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ? ESCAPE '\\'",
            [`${escapedPrefix}%`]
          );
          for (const idx of indexRows) {
            await db.execAsync(`DROP INDEX IF EXISTS ${idx.name}`);
          }
          return undefined;
        } catch (error) {
          return error;
        }
      }, !hasInternalDirectWrite(options));

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
          const persistedData = await this.readPersistedRecordsOrEmpty(tableName);
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
        }, directWrite);
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

        if (!this.metadataManager.get(tableName)) {
          throw new StorageError(`Table '${tableName}' not found`, 'TABLE_NOT_FOUND');
        }

        const customSortAlgorithm = options?.sortAlgorithm && options.sortAlgorithm !== 'default';
        if (!customSortAlgorithm) {
          const query = SqlQueryBuilder.buildFindQuery(tableName, storageOptions?.filter, storageOptions);
          if (query.canPushdown) {
            const rows = await this.enqueue(async () => {
              const db = this.assertDatabase();
              return db.getAllAsync<PayloadRow>(query.sql, query.params as SQLiteBindParams);
            });
            return rows.map(row => JSON.parse(row.payload) as T);
          }
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
    // A full-table encrypted table physically stores a single envelope row.
    // The logical count lives in metadata and must not be reconciled against
    // the physical row count (mirrors DataWriter.validateCountAsync).
    if (tableMeta.encryptFullTable === true) {
      return tableMeta.count ?? 0;
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
    const tableMeta = this.metadataManager.get(tableName);
    const actualCount = await this.enqueue(async () => this.sqlCount(tableName));

    // Only the encrypted decorator can verify a full-table encrypted table's
    // logical count; report the envelope mismatch without "correcting" the
    // logical count down to 1 (mirrors DataWriter.verifyCount).
    if (tableMeta?.encryptFullTable === true) {
      logger.warn(
        `[SQLiteStorageAdapter] verifyCount skipped for full-table encrypted table '${tableName}': the physical row count (${actualCount}) reflects the encrypted envelope, not the logical record count.`
      );
      return { metadata: metadataCount, actual: actualCount, match: metadataCount === actualCount };
    }

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

  /**
   * Counts the physical rows backing a table without touching metadata.
   * EngineMigrationService uses this to detect real destination occupancy —
   * shared metadata makes `hasTable` unreliable across engines.
   */
  async getPhysicalRecordCount(tableName: string): Promise<number> {
    await this.ensureInitialized();
    this.validateTableName(tableName);
    return this.enqueue(async () => this.sqlCount(tableName));
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
          const persisted = await this.readPersistedRecordsOrEmpty(tableName);
          this.saveTransactionSnapshot(tableName, persisted, transactionOwner);
          this.transactionService.addOperation(
            { tableName, type: 'delete', where: storageWhere, options },
            transactionOwner
          );
          return deletedCount;
        }

        if (!this.metadataManager.get(tableName)) {
          return 0;
        }

        const deleteQuery = SqlQueryBuilder.buildDeleteQuery(tableName, storageWhere);
        if (deleteQuery.canPushdown) {
          let changes = 0;
          await this.withSqlTransaction(async () => {
            const db = this.assertDatabase();
            const res = await db.runAsync(deleteQuery.sql, deleteQuery.params as SQLiteBindParams);
            changes = res.changes;
          }, directWrite);

          if (changes > 0) {
            const finalCount = await this.enqueue(async () => this.sqlCount(tableName));
            this.metadataManager.update(tableName, { count: finalCount, updatedAt: Date.now() });
            await this.metadataManager.saveImmediately?.();
          }
          return changes;
        }

        // Same read-inside-the-transaction rule as update(): the filtered
        // full-table replace must be computed from a read that no concurrent
        // write can slip in front of on the sqlChain.
        let deletedCount = 0;
        let remainingLength = 0;
        await this.withSqlTransaction(async () => {
          const data = await this.readPersistedRecordsOrEmpty(tableName);
          const filteredData = data.filter(item => QueryEngine.filter([item], storageWhere).length === 0);
          deletedCount = data.length - filteredData.length;
          if (deletedCount === 0) {
            return;
          }
          remainingLength = filteredData.length;
          await this.sqlWrite(tableName, filteredData, true);
        }, directWrite);

        if (deletedCount === 0) {
          return 0;
        }

        this.metadataManager.update(tableName, { count: remainingLength, updatedAt: Date.now() });
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
          const persisted = await this.readPersistedRecordsOrEmpty(tableName);
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
        let finalCount = 0;

        if (insertOnly) {
          const insertItems = normalizedOperations.flatMap(operation =>
            Array.isArray(operation.data) ? operation.data : [operation.data]
          );
          await this.withSqlTransaction(async () => {
            await this.sqlWrite(tableName, insertItems, false);
          }, directWrite);
          finalCount = await this.enqueue(async () => this.sqlCount(tableName));
          this.metadataManager.update(tableName, { count: finalCount, updatedAt: Date.now() });
          await this.metadataManager.saveImmediately?.();
          return { written: insertItems.length, totalAfterWrite: finalCount, chunked: false };
        }

        // Read and full-table replace share one SQL transaction (see delete
        // fallback) so interleaved writes cannot land between them.
        let writtenCount = 0;
        await this.withSqlTransaction(async () => {
          const allData = await this.readPersistedRecords(tableName);
          let finalData = [...allData];

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

          await this.sqlWrite(tableName, finalData, true);
          finalCount = finalData.length;
        }, directWrite);
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

        if (this.transactionService.isInTransaction() && !directWrite) {
          const allData = await this.getCurrentTransactionData(tableName, transactionOwner);
          const matchedItems = QueryEngine.filter(allData, storageWhere);
          const updatedCount = matchedItems.length;
          if (updatedCount === 0) {
            return 0;
          }
          const persisted = await this.readPersistedRecordsOrEmpty(tableName);
          this.saveTransactionSnapshot(tableName, persisted, transactionOwner);
          this.transactionService.addOperation(
            { tableName, type: 'update', data: storageData, where: storageWhere, options },
            transactionOwner
          );
          return updatedCount;
        }

        if (!this.metadataManager.get(tableName)) {
          return 0;
        }

        const findQuery = SqlQueryBuilder.buildFindQuery(tableName, storageWhere);
        if (findQuery.canPushdown) {
          let updatedCount = 0;
          await this.withSqlTransaction(async () => {
            const db = this.assertDatabase();
            const matchedRows = await db.getAllAsync<PayloadRow>(findQuery.sql, findQuery.params as SQLiteBindParams);

            if (matchedRows.length === 0) {
              return;
            }

            for (const row of matchedRows) {
              const original = JSON.parse(row.payload) as StorageRecord;
              const updated = QueryEngine.update(original, storageData);
              await db.runAsync('UPDATE __elds_records SET payload = ? WHERE table_name = ? AND id = ?', [
                JSON.stringify(updated),
                tableName,
                row.id,
              ]);
            }
            updatedCount = matchedRows.length;
          }, directWrite);

          if (updatedCount > 0) {
            this.metadataManager.update(tableName, { updatedAt: Date.now() });
            await this.metadataManager.saveImmediately?.();
          }
          return updatedCount;
        }

        // The read must share the write's SQL transaction: a read queued on
        // sqlChain separately from the full-table replace lets a concurrent
        // insert land between them and be silently erased by the replace.
        let updatedCount = 0;
        let finalLength = 0;
        await this.withSqlTransaction(async () => {
          const allData = await this.readPersistedRecordsOrEmpty(tableName);
          const matchedItems = QueryEngine.filter(allData, storageWhere);
          updatedCount = matchedItems.length;
          if (updatedCount === 0) {
            return;
          }
          const matchedItemRefs = new Set(matchedItems);
          const finalData = allData.map(item =>
            matchedItemRefs.has(item) ? QueryEngine.update(item, storageData) : item
          );
          finalLength = finalData.length;
          await this.sqlWrite(tableName, finalData, true);
        }, directWrite);

        if (updatedCount > 0) {
          this.metadataManager.update(tableName, { count: finalLength, updatedAt: Date.now() });
          await this.metadataManager.saveImmediately?.();
        }

        return updatedCount;
      },
      cause => StorageErrorHandler.createFileError('update', `table ${tableName}`, cause)
    );
  }

  // ------------------------------------------------------------------
  // IStorageEngine extensions
  // ------------------------------------------------------------------

  async migrateToChunked(tableName: string, options?: TableOptions): Promise<void> {
    this.validateTableName(tableName);
    // SQLite's layout needs no conversion, but the public schema-change contract
    // must still reject the call while a transaction is active.
    await this.runPublicSchemaChange(options, async () => {
      logger.info('[SQLiteStorageAdapter] migrateToChunked is a no-op for SQLite storage');
    });
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

  async cleanup(): Promise<void> {
    await this.sqlChain.catch(() => undefined);
    if (this.db) {
      const dbToClose = this.db as { closeAsync?: () => Promise<void> };
      if (typeof dbToClose.closeAsync === 'function') {
        try {
          await dbToClose.closeAsync();
        } catch {
          // ignore close error
        }
      }
      this.db = null;
    }
    this.initializationPromise = null;
    this.sqlChain = Promise.resolve();
    this.sqlTxDepth = 0;
  }
}
