// src/api.test.ts
// 测试所有公共API功能
import {
  beginTransaction,
  bulkWrite,
  clearTable,
  commit,
  countTable,
  createTable,
  deleteTable,
  findMany,
  findOne,
  hasTable,
  insert,
  listTables,
  migrateToChunked,
  read,
  remove,
  rollback,
  update
} from './index';

describe('Public API Tests', () => {
  const TEST_TABLE = 'test_api_table';
  const TEST_DATA = [
    { id: 1, name: 'Test User 1', age: 25, active: true },
    { id: 2, name: 'Test User 2', age: 30, active: false },
    { id: 3, name: 'Test User 3', age: 35, active: true }
  ];

  // 测试前清理
  beforeEach(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  // 测试后清理
  afterAll(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  describe('Table Management API', () => {
    it('should create a table successfully', async () => {
      await createTable(TEST_TABLE);
      expect(await hasTable(TEST_TABLE)).toBe(true);
    });

    it('should delete a table successfully', async () => {
      await createTable(TEST_TABLE);
      await deleteTable(TEST_TABLE);
      expect(await hasTable(TEST_TABLE)).toBe(false);
    });

    it('should check if a table exists', async () => {
      expect(await hasTable(TEST_TABLE)).toBe(false);
      await createTable(TEST_TABLE);
      expect(await hasTable(TEST_TABLE)).toBe(true);
    });

    it('should list all tables', async () => {
      await createTable(TEST_TABLE);
      const tables = await listTables();
      expect(tables).toContain(TEST_TABLE);
    });

    it('should create a table with initial data', async () => {
      await createTable(TEST_TABLE, { initialData: TEST_DATA });
      const data = await read(TEST_TABLE);
      expect(data.length).toBe(TEST_DATA.length);
    });
  });

  describe('Data Operation API', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
    });

    it('should insert data successfully', async () => {
      const result = await insert(TEST_TABLE, TEST_DATA);
      expect(result.written).toBe(TEST_DATA.length);
      expect(result.totalAfterWrite).toBe(TEST_DATA.length);
    });

    it('should read all data from table', async () => {
      await insert(TEST_TABLE, TEST_DATA);
      const data = await read(TEST_TABLE);
      expect(data.length).toBe(TEST_DATA.length);
    });

    it('should count table records', async () => {
      await insert(TEST_TABLE, TEST_DATA);
      const count = await countTable(TEST_TABLE);
      expect(count).toBe(TEST_DATA.length);
    });

    it('should clear table data', async () => {
      await insert(TEST_TABLE, TEST_DATA);
      await clearTable(TEST_TABLE);
      const count = await countTable(TEST_TABLE);
      expect(count).toBe(0);
    });
  });

  describe('Query API', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, TEST_DATA);
    });

    it('should find one record by filter', async () => {
      const user = await findOne(TEST_TABLE, { id: 1 });
      expect(user).toBeDefined();
      expect(user?.name).toBe('Test User 1');
    });

    it('should return null when no record matches', async () => {
      const user = await findOne(TEST_TABLE, { id: 999 });
      expect(user).toBeNull();
    });

    it('should find many records by filter', async () => {
      const users = await findMany(TEST_TABLE, { active: true });
      expect(users.length).toBe(2);
      expect(users.every((user: any) => user.active)).toBe(true);
    });

    it('should find many records with skip and limit', async () => {
      const users = await findMany(TEST_TABLE, {}, { skip: 1, limit: 1 });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(2);
    });

    it('should find all records when no filter is provided', async () => {
      const users = await findMany(TEST_TABLE);
      expect(users.length).toBe(TEST_DATA.length);
    });

    it('should find records using greater than operator', async () => {
      const users = await findMany(TEST_TABLE, { age: { $gt: 30 } });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(3);
    });

    it('should find records using less than or equal operator', async () => {
      const users = await findMany(TEST_TABLE, { age: { $lte: 30 } });
      expect(users.length).toBe(2);
      expect(users.every((user: any) => user.age <= 30)).toBe(true);
    });

    it('should find records using IN operator', async () => {
      const users = await findMany(TEST_TABLE, { id: { $in: [1, 3] } });
      expect(users.length).toBe(2);
      expect(users.map((user: any) => user.id)).toEqual(expect.arrayContaining([1, 3]));
    });

    it('should find records using NIN operator', async () => {
      const users = await findMany(TEST_TABLE, { id: { $nin: [1, 2] } });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(3);
    });

    it('should find records using LIKE operator', async () => {
      const users = await findMany(TEST_TABLE, { name: { $like: '%User%' } });
      expect(users.length).toBe(3);
    });

    it('should find records using AND compound query', async () => {
      const users = await findMany(TEST_TABLE, { $and: [{ active: true }, { age: { $gt: 25 } }] });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(3);
    });

    it('should find records using OR compound query', async () => {
      const users = await findMany(TEST_TABLE, { $or: [{ id: 1 }, { id: 3 }] });
      expect(users.length).toBe(2);
      expect(users.map((user: any) => user.id)).toEqual(expect.arrayContaining([1, 3]));
    });

    it('should handle empty filter correctly', async () => {
      const users = await findMany(TEST_TABLE, {});
      expect(users.length).toBe(TEST_DATA.length);
    });
  });

  describe('Update and Delete API', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, TEST_DATA);
    });

    it('should update records successfully', async () => {
      const updatedCount = await update(TEST_TABLE, { age: 40 }, { active: true });
      expect(updatedCount).toBe(2);
      
      const updatedUsers = await findMany(TEST_TABLE, { active: true });
      expect(updatedUsers.every((user: any) => user.age === 40)).toBe(true);
    });

    it('should delete records by filter', async () => {
      const initialCount = await countTable(TEST_TABLE);
      await remove(TEST_TABLE, { active: false });
      const finalCount = await countTable(TEST_TABLE);
      expect(finalCount).toBe(initialCount - 1);
    });

    it('should delete all records when empty filter is provided', async () => {
      await remove(TEST_TABLE, {});
      const count = await countTable(TEST_TABLE);
      expect(count).toBe(0);
    });
  });

  describe('Bulk Write API', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
    });

    it('should perform bulk write operations', async () => {
      const operations: Array<{ type: 'insert' | 'update' | 'delete'; data: Record<string, any> | Record<string, any>[] }> = [
        { type: 'insert', data: { id: 4, name: 'Bulk User 1', age: 20, active: true } },
        { type: 'insert', data: { id: 5, name: 'Bulk User 2', age: 25, active: false } }
      ];
      
      const result = await bulkWrite(TEST_TABLE, operations);
      expect(result.written).toBe(operations.length);
      
      const count = await countTable(TEST_TABLE);
      expect(count).toBe(operations.length);
    });
  });

  describe('Transaction API', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, TEST_DATA);
    });

    it('should commit transaction successfully', async () => {
      await beginTransaction();
      await update(TEST_TABLE, { age: 50 }, { id: 1 });
      await commit();
      
      const user = await findOne(TEST_TABLE, { id: 1 });
      expect(user?.age).toBe(50);
    });

    it('should rollback transaction successfully', async () => {
      const initialAge = (await findOne(TEST_TABLE, { id: 1 }))?.age;
      
      await beginTransaction();
      await update(TEST_TABLE, { age: 60 }, { id: 1 });
      await rollback();
      
      const user = await findOne(TEST_TABLE, { id: 1 });
      expect(user?.age).toBe(initialAge);
    });
  });

  describe('Migration API', () => {
    it('should migrate table to chunked mode', async () => {
      await createTable(TEST_TABLE, { mode: 'single' });
      await insert(TEST_TABLE, TEST_DATA);
      
      await migrateToChunked(TEST_TABLE);
      // 验证迁移成功，这里我们只检查表是否仍然存在
      expect(await hasTable(TEST_TABLE)).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle non-existent table gracefully', async () => {
      // 期望读取不存在的表时返回空数组，而不是抛出错误
      const result = await read('non_existent_table');
      expect(result).toEqual([]);
    });

    it('should handle invalid data types', async () => {
      await createTable(TEST_TABLE);
      // 使用类型断言来测试无效数据类型
      await expect(insert(TEST_TABLE, 'invalid_data' as any)).rejects.toThrow();
    });

    it('should handle duplicate table creation', async () => {
      // 期望创建重复表时返回undefined，而不是抛出错误
      await createTable(TEST_TABLE);
      await expect(createTable(TEST_TABLE)).resolves.not.toThrow();
    });

    it('should handle delete on non-existent table', async () => {
      // 期望删除不存在的表时返回undefined，而不是抛出错误
      await expect(deleteTable('non_existent_table')).resolves.not.toThrow();
    });

    it('should handle large data insertion', async () => {
      await createTable(TEST_TABLE);
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        age: 20 + (i % 50),
        active: i % 2 === 0
      }));
      
      const result = await insert(TEST_TABLE, largeData);
      expect(result.written).toBe(100);
      expect(result.totalAfterWrite).toBe(100);
    });
  });
});
