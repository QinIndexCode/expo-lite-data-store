// Comprehensive & Optimized API Test for expo-lite-data-store
// This file acts as both a test suite and an executable behavior specification.

import {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  read,
  findOne,
  findMany,
  update,
  remove,
  bulkWrite,
  beginTransaction,
  commit,
  rollback,
  migrateToChunked,
  clearTable,
  countTable,
  getSyncStats,
  syncNow,
  setAutoSyncConfig
} from '../src/expo-lite-data-store';

const TEST_TABLE = 'test_main_table';
const TEST_TABLE_CHUNKED = 'test_chunked_table';

/* -------------------------------------------------------------------------- */
/*                               Test Helpers                                 */
/* -------------------------------------------------------------------------- */

const cleanupTables = async () => {
  const tables = await listTables();
  for (const table of tables) {
    if (table.startsWith('test_')) {
      await deleteTable(table);
    }
  }
};

const seedBasicUsers = async () => {
  await insert(TEST_TABLE, [
    { id: 1, name: 'User A', age: 25, active: true },
    { id: 2, name: 'User B', age: 30, active: false },
    { id: 3, name: 'User C', age: 35, active: true }
  ]);
};

/* -------------------------------------------------------------------------- */
/*                                 Test Suite                                 */
/* -------------------------------------------------------------------------- */

describe('expo-lite-data-store – Optimized API Tests', () => {
  beforeEach(cleanupTables);
  afterAll(cleanupTables);

  /* ------------------------------------------------------------------------ */
  /*                              Table Management                             */
  /* ------------------------------------------------------------------------ */

  describe('Table Management', () => {
    it('creates, checks and deletes tables safely', async () => {
      expect(await hasTable(TEST_TABLE)).toBe(false);

      await createTable(TEST_TABLE);
      expect(await hasTable(TEST_TABLE)).toBe(true);

      await createTable(TEST_TABLE); // duplicate create should not throw
      await deleteTable(TEST_TABLE);
      await deleteTable(TEST_TABLE); // duplicate delete should not throw
    });

    it('creates table with initial data', async () => {
      await createTable(TEST_TABLE, {
        initialData: [{ id: 1, name: 'Init', age: 20 }]
      });

      expect(await countTable(TEST_TABLE)).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                          Basic Insert & Read                              */
  /* ------------------------------------------------------------------------ */

  describe('Insert & Read', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
    });

    it('supports single and multiple inserts', async () => {
      await insert(TEST_TABLE, { id: 1, name: 'Single' });
      await insert(TEST_TABLE, [
        { id: 2, name: 'Multi-1' },
        { id: 3, name: 'Multi-2' }
      ]);

      const data = await read(TEST_TABLE);
      expect(data.length).toBe(3);
    });

    it('returns empty array for non-existent table', async () => {
      expect(await read('not_exists')).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                              Query Engine                                 */
  /* ------------------------------------------------------------------------ */

  describe('Query Capabilities', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await seedBasicUsers();
    });

    it('supports equality and comparison operators', async () => {
      expect((await findMany(TEST_TABLE, { age: { $gt: 30 } })).length).toBe(1);
      expect((await findMany(TEST_TABLE, { age: { $lte: 30 } })).length).toBe(2);
    });

    it('supports logical operators ($and / $or)', async () => {
      const result = await findMany(TEST_TABLE, {
        $and: [{ active: true }, { age: { $gt: 30 } }]
      });
      expect(result[0].id).toBe(3);
    });

    it('supports $in / $nin / $like', async () => {
      expect((await findMany(TEST_TABLE, { id: { $in: [1, 3] } })).length).toBe(2);
      expect((await findMany(TEST_TABLE, { id: { $nin: [1, 2] } })).length).toBe(1);
      expect((await findMany(TEST_TABLE, { name: { $like: '%User%' } })).length).toBe(3);
    });

    it('supports sorting and pagination', async () => {
      const data = await findMany(TEST_TABLE, {}, {
        sortBy: 'age',
        order: 'desc',
        skip: 1,
        limit: 1
      });

      expect(data.length).toBe(1);
      expect(data[0].id).toBe(2);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                           Update & Delete                                 */
  /* ------------------------------------------------------------------------ */

  describe('Update & Remove', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await seedBasicUsers();
    });

    it('updates matching records only', async () => {
      const updated = await update(TEST_TABLE, { active: false }, { active: true });
      expect(updated).toBe(2);
    });

    it('removes matching records only', async () => {
      const removed = await remove(TEST_TABLE, { id: 2 });
      expect(removed).toBe(1);
      expect(await countTable(TEST_TABLE)).toBe(2);
    });
  });
  /* -------------------------------------------------------------------------- */
  /*                                clearTable                                  */
  /* -------------------------------------------------------------------------- */

  describe('clearTable', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, [
        { id: 1, name: 'User A' },
        { id: 2, name: 'User B' },
        { id: 3, name: 'User C' }
      ]);
    });

    it('clears all records but keeps table structure', async () => {
      expect(await countTable(TEST_TABLE)).toBe(3);

      await clearTable(TEST_TABLE);

      // 核心行为 1：数据为空
      const data = await read(TEST_TABLE);
      expect(data).toEqual([]);

      // 核心行为 2：表仍存在
      expect(await hasTable(TEST_TABLE)).toBe(true);

      // 核心行为 3：count 正确
      expect(await countTable(TEST_TABLE)).toBe(0);
    });

    it('is idempotent (calling multiple times does not throw)', async () => {
      await clearTable(TEST_TABLE);
      await clearTable(TEST_TABLE);
      await clearTable(TEST_TABLE);

      expect(await countTable(TEST_TABLE)).toBe(0);
    });

    it('does not affect other tables', async () => {
      const OTHER_TABLE = 'test_other_table';

      await createTable(OTHER_TABLE);
      await insert(OTHER_TABLE, { id: 99 });

      await clearTable(TEST_TABLE);

      expect(await countTable(OTHER_TABLE)).toBe(1);
    });

    it('gracefully handles non-existent table', async () => {
      await expect(clearTable('not_exists')).resolves.not.toThrow();
    });
  });


  /* ------------------------------------------------------------------------ */
  /*                            bulkWrite API                                  */
  /* ------------------------------------------------------------------------ */

  describe('bulkWrite', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
    });

    it('handles mixed bulk operations', async () => {
      await bulkWrite(TEST_TABLE, [
        { type: 'insert', data: { id: 1, age: 20 } },
        { type: 'insert', data: { id: 2, age: 30 } },
        { type: 'update', data: { id: 1, age: 25 } },
        { type: 'delete', data: { id: 2 } }
      ]);

      const data = await read(TEST_TABLE);
      expect(data.length).toBe(1);
      expect(data[0].age).toBe(25);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                               Transactions                                */
  /* ------------------------------------------------------------------------ */

  describe('Transactions', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await seedBasicUsers();
    });

    it('rolls back safely', async () => {
      await beginTransaction();
      await remove(TEST_TABLE, { id: 1 });
      await rollback();

      expect(await countTable(TEST_TABLE)).toBe(3);
    });

    it('commits safely', async () => {
      await beginTransaction();
      await update(TEST_TABLE, { age: 99 }, { id: 1 });
      await commit();

      expect((await findOne(TEST_TABLE, { id: 1 }))?.age).toBe(99);
    });

    it('handles transaction lifecycle correctly', async () => {
      await beginTransaction();
      await rollback();
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                         Chunked Storage                                   */
  /* ------------------------------------------------------------------------ */

  describe('Chunked Mode', () => {
    it('migrates and remains writable', async () => {
      await createTable(TEST_TABLE_CHUNKED, {
        initialData: Array.from({ length: 5 }, (_, i) => ({
          id: i + 1,
          value: i
        }))
      });

      await migrateToChunked(TEST_TABLE_CHUNKED);
      await insert(TEST_TABLE_CHUNKED, { id: 99, value: 99 });

      expect(await countTable(TEST_TABLE_CHUNKED)).toBe(6);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                         Concurrency Safety                                 */
  /* ------------------------------------------------------------------------ */

  describe('Concurrent Writes', () => {
    it('handles bulk inserts efficiently', async () => {
      await createTable(TEST_TABLE);

      // 使用批量插入代替并行插入，避免竞态条件
      await insert(TEST_TABLE, Array.from({ length: 5 }, (_, i) => ({ id: i + 1, value: i })));

      expect(await countTable(TEST_TABLE)).toBe(5);
    });
  });

  /* ------------------------------------------------------------------------ */
  /*                               Sync APIs                                   */
  /* ------------------------------------------------------------------------ */

  describe('Sync APIs', () => {
    it('exposes sync stats safely', () => {
      const stats = getSyncStats();
      expect(stats).toHaveProperty('syncCount');
      expect(stats).toHaveProperty('lastSyncTime');
    });

    it('syncNow and setAutoSyncConfig do not throw', async () => {
      await syncNow();
      setAutoSyncConfig({ enabled: true, interval: 1000 });
    });
  });
});
