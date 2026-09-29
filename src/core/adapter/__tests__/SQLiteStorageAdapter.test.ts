import { configManager } from '../../config/ConfigManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { transactionOwnerOption } from '../../service/TransactionService';
import type { InternalWriteOptions, TableOptions } from '../../../types/storageTypes';
import logger from '../../../utils/logger';
import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter';

type UserRecord = {
  id: number;
  name: string;
  age?: number;
  active?: boolean;
};

const DATABASE_NAME = 'sqlite-adapter-test.db';

const getGlobalSqliteMockState = (): { databases: Record<string, unknown[]> } =>
  (global as unknown as { __expo_sqlite_mock__: { databases: Record<string, unknown[]> } }).__expo_sqlite_mock__;

const createAdapter = (metadataManager: MetadataManager): SQLiteStorageAdapter =>
  new SQLiteStorageAdapter(metadataManager, { databaseName: DATABASE_NAME });

describe('SQLiteStorageAdapter', () => {
  let adapter: SQLiteStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'users';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = createAdapter(metadataManager);
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    if (await adapter.hasTable(tableName)) {
      await adapter.deleteTable(tableName);
    }
    delete getGlobalSqliteMockState().databases[DATABASE_NAME];
    metadataManager.cleanup();
  });

  describe('table lifecycle', () => {
    it('creates a logical table with metadata', async () => {
      expect(await adapter.hasTable(tableName)).toBe(true);
      expect(adapter.getTableMeta(tableName)).toMatchObject({
        mode: 'single',
        count: 0,
      });
    });

    it('lists tables', async () => {
      await adapter.createTable('second_table');
      const tables = await adapter.listTables();
      expect(tables).toContain(tableName);
      expect(tables).toContain('second_table');
      await adapter.deleteTable('second_table');
    });

    it('seeds initialData on createTable', async () => {
      await adapter.createTable('seeded_table', {
        initialData: [{ id: 1, name: 'Seed' }],
      });
      const records = await adapter.read<UserRecord>('seeded_table', { bypassCache: true });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: 1, name: 'Seed' });
      await adapter.deleteTable('seeded_table');
    });

    it('deletes a table and its rows', async () => {
      await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
      await adapter.deleteTable(tableName);
      expect(await adapter.hasTable(tableName)).toBe(false);
      await expect(adapter.read(tableName)).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
    });

    it('rejects invalid table names', async () => {
      await expect(adapter.createTable('bad name')).rejects.toBeTruthy();
      await expect(adapter.createTable('')).rejects.toBeTruthy();
    });
  });

  describe('writes', () => {
    it('appends records while keeping insertion order', async () => {
      const first = await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
      const second = await adapter.write(tableName, [{ id: 2, name: 'Bob' }]);

      expect(first.totalAfterWrite).toBe(1);
      expect(second.totalAfterWrite).toBe(2);

      const records = await adapter.read<UserRecord>(tableName);
      expect(records.map(record => record.name)).toEqual(['Alice', 'Bob']);
    });

    it('auto-creates a table on first write with encrypted options', async () => {
      await adapter.deleteTable(tableName);
      const result = await adapter.write(tableName, [{ id: 1, name: 'Auto' }], {
        encrypted: true,
        requireAuthOnAccess: true,
      });
      expect(result.totalAfterWrite).toBe(1);
      expect(adapter.getTableMeta(tableName)).toMatchObject({
        encrypted: true,
        requireAuthOnAccess: true,
      });
    });

    it('overwrites existing rows', async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
      const result = await adapter.overwrite(tableName, [{ id: 9, name: 'Zoe' }]);

      expect(result.totalAfterWrite).toBe(1);
      const records = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: 9, name: 'Zoe' });
    });

    it('rejects non-object payloads', async () => {
      await expect(adapter.write(tableName, [null as unknown as UserRecord])).rejects.toMatchObject({
        code: 'FILE_CONTENT_INVALID',
      });
      await expect(adapter.write(tableName, 'nope' as unknown as UserRecord)).rejects.toMatchObject({
        code: 'FILE_CONTENT_INVALID',
      });
    });

    it('persists records as raw JSON payloads', async () => {
      const nested = { id: 1, profile: { tags: ['a', 'b'], meta: { depth: 3 } } };
      await adapter.write(tableName, [nested]);
      const raw = await adapter.read<typeof nested>(tableName, { bypassCache: true });
      expect(raw[0]).toEqual(nested);
    });
  });

  describe('reads', () => {
    beforeEach(async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 32, active: false },
      ]);
    });

    it('filters, skips, and limits reads', async () => {
      const filtered = await adapter.read<UserRecord>(tableName, {
        filter: { active: true },
      });
      expect(filtered).toHaveLength(3);

      const paged = await adapter.read<UserRecord>(tableName, { skip: 1, limit: 2 });
      expect(paged.map(record => record.name)).toEqual(['Bob', 'Charlie']);
    });

    it('findOne returns the first match or null', async () => {
      await expect(adapter.findOne<UserRecord>(tableName, { id: 2 })).resolves.toMatchObject({ name: 'Bob' });
      await expect(adapter.findOne<UserRecord>(tableName, { id: 999 })).resolves.toBeNull();
    });

    it('findMany supports compound conditions', async () => {
      const matches = await adapter.findMany<UserRecord>(tableName, {
        $and: [{ age: { $gt: 26 } }, { active: true }],
      });
      expect(matches.map(record => record.name).sort()).toEqual(['Bob', 'David']);
    });

    it('count and verifyCount agree with metadata', async () => {
      await expect(adapter.count(tableName)).resolves.toBe(5);
      await expect(adapter.verifyCount(tableName)).resolves.toMatchObject({ metadata: 5, actual: 5, match: true });
    });
  });

  describe('mutations', () => {
    beforeEach(async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
      ]);
    });

    it('updates matching records and reports the count', async () => {
      const updated = await adapter.update(tableName, { age: 99 }, { active: true });
      expect(updated).toBe(2);
      const alice = await adapter.findOne<UserRecord>(tableName, { id: 1 });
      expect(alice?.age).toBe(99);
    });

    it('deletes matching records', async () => {
      const deleted = await adapter.delete(tableName, { id: 2 });
      expect(deleted).toBe(1);
      const remaining = await adapter.read<UserRecord>(tableName);
      expect(remaining).toHaveLength(2);
    });

    it('clears all rows', async () => {
      await adapter.clearTable(tableName);
      await expect(adapter.count(tableName)).resolves.toBe(0);
    });
  });

  describe('bulkWrite', () => {
    it('inserts multiple records through the fast path', async () => {
      const result = await adapter.bulkWrite(tableName, [
        { type: 'insert', data: { id: 1, name: 'Alice' } },
        { type: 'insert', data: { id: 2, name: 'Bob' } },
      ]);
      expect(result).toMatchObject({ written: 2, totalAfterWrite: 2, chunked: false });
    });

    it('applies mixed operations atomically', async () => {
      await adapter.write(tableName, [{ id: 1, name: 'Alice', age: 25 }]);

      const result = await adapter.bulkWrite(tableName, [
        { type: 'insert', data: { id: 2, name: 'Bob', age: 30 } },
        { type: 'update', data: { age: 26 }, where: { id: 1 } },
        { type: 'delete', where: { id: 2 } },
      ]);

      expect(result.written).toBe(3);
      const records = await adapter.read<UserRecord>(tableName);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: 1, name: 'Alice', age: 26 });
    });
  });

  describe('transactions', () => {
    it('commits staged writes', async () => {
      await adapter.beginTransaction();
      await adapter.write(tableName, [{ id: 10, name: 'Zed' }]);
      await adapter.commit();

      const records = await adapter.read<UserRecord>(tableName);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: 10, name: 'Zed' });
    });

    it('rolls back staged writes and restores the snapshot', async () => {
      await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
      await adapter.beginTransaction();
      await adapter.write(tableName, [{ id: 2, name: 'Bob' }]);
      await adapter.rollback();

      const records = await adapter.read<UserRecord>(tableName);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ name: 'Alice' });
      expect(adapter.isInTransaction()).toBe(false);
    });

    it('stages writes to a missing table inside a transaction and creates it on commit', async () => {
      const missingTable = 'implicit_tx_table';
      expect(await adapter.hasTable(missingTable)).toBe(false);

      await adapter.beginTransaction();
      await adapter.write(missingTable, [{ id: 1, name: 'Staged' }]);
      await expect(adapter.read<UserRecord>(missingTable)).resolves.toEqual([{ id: 1, name: 'Staged' }]);
      await adapter.commit();

      await expect(adapter.read<UserRecord>(missingTable)).resolves.toEqual([{ id: 1, name: 'Staged' }]);
      await adapter.deleteTable(missingTable);
    });

    it('preserves encryptedFields on implicit table creation', async () => {
      const implicitTable = 'implicit_policy_table';
      await adapter.write(implicitTable, [{ id: 1, secret: 'x' }], {
        encryptedFields: ['secret'],
      } as unknown as InternalWriteOptions);

      expect(adapter.getTableMeta(implicitTable)).toMatchObject({ encryptedFields: ['secret'] });
      await adapter.deleteTable(implicitTable);
    });

    it('rejects table structure changes inside a transaction', async () => {
      await adapter.beginTransaction();
      await expect(adapter.createTable('forbidden_table')).rejects.toMatchObject({
        code: 'TRANSACTION_OPERATION_NOT_SUPPORTED',
      });
      await adapter.rollback();
    });

    it('rejects migrateToChunked inside a transaction even though it is a no-op for SQLite', async () => {
      await expect(adapter.migrateToChunked(tableName)).resolves.toBeUndefined();

      await adapter.beginTransaction();
      await expect(adapter.migrateToChunked(tableName)).rejects.toMatchObject({
        code: 'TRANSACTION_OPERATION_NOT_SUPPORTED',
      });
      await adapter.rollback();
      expect(adapter.isInTransaction()).toBe(false);
    });

    it('commits batched staged operations and keeps row order', async () => {
      await adapter.beginTransaction();
      await adapter.update(tableName, { name: 'Renamed' }, { id: 1 });
      await adapter.bulkWrite(tableName, [{ type: 'insert', data: { id: 1, name: 'Inserted' } }]);
      await adapter.commit();

      const records = await adapter.read<UserRecord>(tableName);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: 1, name: 'Inserted' });
    });

    it('aborts when the transaction fails and restores the previous state', async () => {
      await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
      await adapter.beginTransaction();
      await adapter.write(tableName, [{ id: 2, name: 'Bob' }]);

      await expect(
        adapter.commit(undefined, async () => {
          throw new Error('finalize failed');
        })
      ).rejects.toThrow('finalize failed');

      const records = await adapter.read<UserRecord>(tableName);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ name: 'Alice' });
    });
  });

  describe('engine extensions', () => {
    it('setLogicalRecordCount validates and publishes the count', async () => {
      await adapter.setLogicalRecordCount(tableName, 42);
      expect(adapter.getTableMeta(tableName)?.count).toBe(42);
      await expect(adapter.setLogicalRecordCount(tableName, -1)).rejects.toMatchObject({
        code: 'FILE_CONTENT_INVALID',
      });
      await expect(adapter.setLogicalRecordCount('missing', 1)).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
    });

    it('migrateToChunked is a no-op for SQLite', async () => {
      await expect(adapter.migrateToChunked(tableName)).resolves.toBeUndefined();
    });

    it('assertTransactionOwner enforces ownership', async () => {
      const ownerA = {};
      const ownerB = {};
      await adapter.beginTransaction({ [transactionOwnerOption]: ownerA } as TableOptions);
      expect(() => adapter.assertTransactionOwner(ownerB)).toThrow();
      expect(() => adapter.assertTransactionOwner(ownerA)).not.toThrow();
      await adapter.rollback({ [transactionOwnerOption]: ownerA } as TableOptions);
    });
  });

  describe('concurrency', () => {
    it('serializes concurrent appends without losing data', async () => {
      const writes = Array.from({ length: 25 }, (_, index) =>
        adapter.write(tableName, [{ id: index + 1, name: `User${index + 1}` }])
      );
      await Promise.all(writes);
      await expect(adapter.count(tableName)).resolves.toBe(25);
    });
  });

  describe('expression indexes and pushdown optimization', () => {
    it('creates expression indexes via createTable options and enforces unique constraint', async () => {
      const indexedTable = 'users_indexed';
      await adapter.createTable(indexedTable, {
        indexes: ['name', { field: 'email', unique: true }],
      });

      await adapter.write(indexedTable, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

      // Duplicate email must violate UNIQUE constraint
      await expect(adapter.write(indexedTable, [{ id: 2, name: 'Bob', email: 'alice@example.com' }])).rejects.toThrow();

      await adapter.deleteTable(indexedTable);
    });

    it('creates and drops expression index dynamically via createIndex / dropIndex', async () => {
      await adapter.createIndex(tableName, 'age', false);
      await adapter.createIndex(tableName, 'email', true);

      await adapter.dropIndex(tableName, 'age');
      await adapter.dropIndex(tableName, 'email');

      await expect(adapter.createIndex(tableName, 'bad;identifier')).rejects.toMatchObject({
        code: 'TABLE_INDEX_INVALID',
      });
      await expect(adapter.dropIndex(tableName, 'bad;identifier')).rejects.toMatchObject({
        code: 'TABLE_INDEX_INVALID',
      });
    });

    it('cleans up expression indexes when deleteTable is called', async () => {
      const tempTable = 'temp_idx_table';
      await adapter.createTable(tempTable, {
        indexes: ['score', { field: 'code', unique: true }],
      });
      await adapter.deleteTable(tempTable);
      expect(await adapter.hasTable(tempTable)).toBe(false);
    });

    it('rolls the whole table back when a createTable index declaration is malformed', async () => {
      const badTable = 'bad_idx_decl_table';
      await expect(
        adapter.createTable(badTable, { indexes: [{} as { field: string; unique?: boolean }] })
      ).rejects.toMatchObject({ code: 'TABLE_INDEX_INVALID' });
      expect(await adapter.hasTable(badTable)).toBe(false);
    });

    it('ignores createTable declarations on an existing table without touching its rows', async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Alice' },
      ]);

      // Existing table: declarations (even unique-violating or malformed ones)
      // and initialData are all ignored — the creation statement returns early,
      // so stored rows can never be rewritten or deleted by a redeclaration.
      await expect(
        adapter.createTable(tableName, {
          indexes: [{ field: 'name', unique: true }],
          initialData: [{ id: 3, name: 'Seed' }],
        })
      ).resolves.toBeUndefined();
      await expect(
        adapter.createTable(tableName, { indexes: [{} as { field: string; unique?: boolean }] })
      ).resolves.toBeUndefined();

      expect(await adapter.count(tableName)).toBe(2);
      expect(metadataManager.get(tableName)?.indexes?.name_unique).toBeUndefined();
    });

    it('pushes down complex queries, sorting, and pagination to SQLite', async () => {
      const records = [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 22, active: true },
      ];
      await adapter.write(tableName, records);

      // findMany with filter, sort desc, limit and skip
      const results = await adapter.findMany<UserRecord>(
        tableName,
        { active: true, age: { $gt: 24 } },
        { sortBy: 'age', order: 'desc', limit: 2, skip: 1 }
      );

      // Matching: Bob (30), David (28), Alice (25).
      // Sorted desc: Bob (30), David (28), Alice (25).
      // skip 1, limit 2: David (28), Alice (25).
      expect(results.map(r => r.name)).toEqual(['David', 'Alice']);
    });

    it('safely falls back to QueryEngine for non-pushdown conditions', async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ]);

      // Function filter cannot be pushed down to SQL
      const results = await adapter.findMany<UserRecord>(tableName, (record: UserRecord) => record.age === 30);
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Bob');
    });

    it('executes pushdown updates and deletes', async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
      ]);

      const updated = await adapter.update(tableName, { active: false }, { age: { $gte: 30 } });
      expect(updated).toBe(2);

      const bob = await adapter.findOne<UserRecord>(tableName, { id: 2 });
      expect(bob?.active).toBe(false);

      const deleted = await adapter.delete(tableName, { age: { $lt: 28 } });
      expect(deleted).toBe(1);
      expect(await adapter.count(tableName)).toBe(2);
    });
  });
});

describe('SQLiteStorageAdapter ignored cross-cutting configuration warnings', () => {
  let adapter: SQLiteStorageAdapter;
  let metadataManager: MetadataManager;

  beforeEach(() => {
    configManager.resetConfig();
    metadataManager = new MetadataManager();
    adapter = createAdapter(metadataManager);
  });

  afterEach(() => {
    metadataManager.cleanup();
    configManager.resetConfig();
    delete getGlobalSqliteMockState().databases[DATABASE_NAME];
    jest.restoreAllMocks();
  });

  const collectIgnoredConfigWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>): string[] =>
    calls
      .map(call => String(call[0]))
      .filter(
        message =>
          message.includes('[SQLiteStorageAdapter]') &&
          message.includes('file-system') &&
          (message.includes('autoSync') || message.includes('monitoring.enablePerformanceTracking'))
      );

  it('warns on initialization when autoSync.enabled is turned on', async () => {
    configManager.setConfig({ autoSync: { enabled: true } });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await adapter.ensureInitialized();

    const messages = collectIgnoredConfigWarnings(warnSpy.mock.calls);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('SQLiteStorageAdapter');
    expect(messages[0]).toContain('autoSync');
    expect(messages[0]).toContain('file-system');
  });

  it('warns on initialization when monitoring.enablePerformanceTracking is turned on', async () => {
    configManager.setConfig({ monitoring: { enablePerformanceTracking: true } });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await adapter.ensureInitialized();

    const messages = collectIgnoredConfigWarnings(warnSpy.mock.calls);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('SQLiteStorageAdapter');
    expect(messages[0]).toContain('monitoring.enablePerformanceTracking');
    expect(messages[0]).toContain('file-system');
  });

  it('stays silent under the default configuration', async () => {
    configManager.resetConfig();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await adapter.ensureInitialized();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns at most once across repeated initialization of the same adapter', async () => {
    configManager.setConfig({ autoSync: { enabled: true } });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await adapter.ensureInitialized();
    await adapter.ensureInitialized();
    expect(await adapter.hasTable('never_created')).toBe(false);
    await adapter.ensureInitialized();

    expect(collectIgnoredConfigWarnings(warnSpy.mock.calls)).toHaveLength(1);
  });
});

describe('SQLiteStorageAdapter initialization failure recovery', () => {
  let adapter: SQLiteStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'recovery_users';

  type SqliteHandleMock = {
    execAsync: (sql: string) => Promise<void>;
    closeAsync?: () => Promise<void>;
  };

  type SqliteModuleMock = {
    openDatabaseAsync: (name: string, options?: unknown, directory?: unknown) => Promise<SqliteHandleMock>;
  };

  type InitializationHooks = {
    openedHandles: SqliteHandleMock[];
    closedHandles: SqliteHandleMock[];
    failNextOpen: () => void;
    failNextExecSql: (fragment: string) => void;
  };

  const loadSqliteModuleMock = (): SqliteModuleMock => {
    const loaded = require('expo-sqlite') as SqliteModuleMock & { default?: SqliteModuleMock };
    return loaded.default ?? loaded;
  };

  /**
   * Instruments the expo-sqlite mock for a single test: every handle the
   * adapter opens is recorded, closes are recorded against the handle they
   * belong to, and one `openDatabaseAsync` / `execAsync` failure can be
   * injected. The instrumentation dies with the spy, so shared mock state and
   * unrelated suites are untouched.
   */
  const installInitializationHooks = (): InitializationHooks => {
    const sqliteModuleMock = loadSqliteModuleMock();
    const openDatabaseAsync = sqliteModuleMock.openDatabaseAsync.bind(sqliteModuleMock);
    let failOpen = false;
    let failExecSql: string | null = null;

    const hooks: InitializationHooks = {
      openedHandles: [],
      closedHandles: [],
      failNextOpen: () => {
        failOpen = true;
      },
      failNextExecSql: fragment => {
        failExecSql = fragment;
      },
    };

    jest.spyOn(sqliteModuleMock, 'openDatabaseAsync').mockImplementation(async (name, options, directory) => {
      if (failOpen) {
        failOpen = false;
        throw new Error('expo-sqlite open failed (injected)');
      }
      const handle = await openDatabaseAsync(name, options, directory);
      const execAsync = handle.execAsync.bind(handle);
      handle.execAsync = async (sql: string) => {
        if (failExecSql !== null && sql.includes(failExecSql)) {
          failExecSql = null;
          throw new Error('SQLite DDL failed (injected)');
        }
        return execAsync(sql);
      };
      const closeAsync = handle.closeAsync?.bind(handle);
      handle.closeAsync = async () => {
        hooks.closedHandles.push(handle);
        await closeAsync?.();
      };
      hooks.openedHandles.push(handle);
      return handle;
    });

    return hooks;
  };

  const collectInitializationWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>): string[] =>
    calls
      .map(call => String(call[0]))
      .filter(message => message.includes('[SQLiteStorageAdapter]') && message.includes('autoSync'));

  const rejectionMessage = (result: PromiseSettledResult<unknown>): string =>
    result.status === 'rejected' ? String(result.reason) : '';

  beforeEach(() => {
    configManager.resetConfig();
    metadataManager = new MetadataManager();
    adapter = createAdapter(metadataManager);
  });

  afterEach(async () => {
    try {
      if (await adapter.hasTable(tableName)) {
        await adapter.deleteTable(tableName);
      }
    } catch {
      // Best effort: a failed test may have left the adapter without a usable schema.
    }
    delete getGlobalSqliteMockState().databases[DATABASE_NAME];
    metadataManager.cleanup();
    configManager.resetConfig();
    jest.restoreAllMocks();
  });

  it('recovers from a failed DDL instead of staying half-initialized', async () => {
    configManager.setConfig({ autoSync: { enabled: true } });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const hooks = installInitializationHooks();
    hooks.failNextExecSql('CREATE TABLE IF NOT EXISTS __elds_records');

    await expect(adapter.write(tableName, [{ id: 1, name: 'Alice' }])).rejects.toMatchObject({
      code: 'FILE_WRITE_FAILED',
    });
    // An attempt whose DDL never completed must not emit the config warning.
    expect(collectInitializationWarnings(warnSpy.mock.calls)).toHaveLength(0);

    // The failed attempt must be retried instead of answered from a handle
    // whose `__elds_records` schema was never created.
    await adapter.ensureInitialized();
    expect(hooks.openedHandles).toHaveLength(2);

    const writeResult = await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
    expect(writeResult.totalAfterWrite).toBe(1);
    const records = await adapter.read<UserRecord>(tableName);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 1, name: 'Alice' });

    // The warning is emitted once, only after initialization finally succeeded,
    // and repeated calls keep it at exactly one.
    expect(collectInitializationWarnings(warnSpy.mock.calls)).toHaveLength(1);
    await adapter.ensureInitialized();
    expect(collectInitializationWarnings(warnSpy.mock.calls)).toHaveLength(1);
  });

  it('closes the abandoned handle when initialization fails', async () => {
    const hooks = installInitializationHooks();
    hooks.failNextExecSql('CREATE INDEX IF NOT EXISTS idx_elds_records_table');

    await expect(adapter.ensureInitialized()).rejects.toThrow('SQLite DDL failed (injected)');

    expect(hooks.openedHandles).toHaveLength(1);
    expect(hooks.closedHandles).toHaveLength(1);
    expect(hooks.closedHandles[0]).toBe(hooks.openedHandles[0]);

    // The rollback closes the abandoned handle, so the retry opens exactly one
    // fresh handle instead of leaking one per attempt.
    await adapter.ensureInitialized();
    expect(hooks.openedHandles).toHaveLength(2);
    expect(hooks.closedHandles).toHaveLength(1);

    await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
    expect(await adapter.count(tableName)).toBe(1);
  });

  it('retries initialization when openDatabaseAsync fails', async () => {
    const hooks = installInitializationHooks();
    hooks.failNextOpen();

    await expect(adapter.ensureInitialized()).rejects.toThrow('expo-sqlite open failed (injected)');
    // Nothing was handed out, so there is no handle to roll back.
    expect(hooks.openedHandles).toHaveLength(0);
    expect(hooks.closedHandles).toHaveLength(0);

    await adapter.ensureInitialized();
    expect(hooks.openedHandles).toHaveLength(1);

    await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
    expect(await adapter.read<UserRecord>(tableName)).toHaveLength(1);
  });

  it('rejects every concurrent caller on one shared failed attempt and retries once', async () => {
    configManager.setConfig({ autoSync: { enabled: true } });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const hooks = installInitializationHooks();
    hooks.failNextExecSql('CREATE TABLE IF NOT EXISTS __elds_records');

    const firstAttempt = await Promise.allSettled([adapter.ensureInitialized(), adapter.ensureInitialized()]);
    expect(firstAttempt.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(firstAttempt.map(rejectionMessage)).toEqual([
      expect.stringContaining('SQLite DDL failed (injected)'),
      expect.stringContaining('SQLite DDL failed (injected)'),
    ]);
    // Both callers shared the same attempt: one open, one rollback close.
    expect(hooks.openedHandles).toHaveLength(1);
    expect(hooks.closedHandles).toHaveLength(1);
    expect(collectInitializationWarnings(warnSpy.mock.calls)).toHaveLength(0);

    const secondAttempt = await Promise.allSettled([adapter.ensureInitialized(), adapter.ensureInitialized()]);
    expect(secondAttempt.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(hooks.openedHandles).toHaveLength(2);
    expect(hooks.closedHandles).toHaveLength(1);

    await adapter.write(tableName, [{ id: 1, name: 'Alice' }]);
    expect(await adapter.read<UserRecord>(tableName)).toHaveLength(1);
    expect(collectInitializationWarnings(warnSpy.mock.calls)).toHaveLength(1);
  });
});
