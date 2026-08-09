import { MetadataManager } from '../../meta/MetadataManager';
import { transactionOwnerOption } from '../../service/TransactionService';
import type { TableOptions } from '../../../types/storageTypes';
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

    it('rejects table structure changes inside a transaction', async () => {
      await adapter.beginTransaction();
      await expect(adapter.createTable('forbidden_table')).rejects.toMatchObject({
        code: 'TRANSACTION_OPERATION_NOT_SUPPORTED',
      });
      await adapter.rollback();
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
});
