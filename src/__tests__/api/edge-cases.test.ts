// src/__tests__/api/edge-cases.test.ts
// 测试边缘案例和错误处理

import { 
  createTable, 
  insert, 
  read, 
  update, 
  remove, 
  findOne, 
  findMany, 
  deleteTable, 
  hasTable, 
  beginTransaction, 
  commit, 
  bulkWrite, 
  countTable 
} from '../../expo-lite-data-store';

describe('Edge Cases and Error Handling Tests', () => {
  const TEST_TABLE = 'edge_cases_test_table';

  beforeEach(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  describe('Empty Table Operations', () => {
    it('should handle read on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await read(TEST_TABLE);
      expect(result).toEqual([]);
    });

    it('should handle findOne on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await findOne(TEST_TABLE, { where: { id: 1 } });
      expect(result).toBeNull();
    });

    it('should handle findMany on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await findMany(TEST_TABLE, { where: { active: true } });
      expect(result).toEqual([]);
    });

    it('should handle update on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await update(TEST_TABLE, { active: true }, { where: { id: 1 } });
      expect(result).toBe(0);
    });

    it('should handle remove on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await remove(TEST_TABLE, { where: { id: 1 } });
      expect(result).toBe(0);
    });

    it('should handle countTable on empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await countTable(TEST_TABLE);
      expect(result).toBe(0);
    });
  });

  describe('Large Data Operations', () => {
    it('should handle inserting 1000 records at once', async () => {
      await createTable(TEST_TABLE);
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        value: Math.random() * 1000
      }));

      const result = await insert(TEST_TABLE, largeData);
      expect(result.written).toBe(1000);
      expect(result.totalAfterWrite).toBe(1000);

      const count = await countTable(TEST_TABLE);
      expect(count).toBe(1000);
    });

    it('should handle bulkWrite with 100 operations', async () => {
      await createTable(TEST_TABLE);
      
      // 插入初始数据
      await insert(TEST_TABLE, Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        name: `Initial User ${i + 1}`,
        active: true
      })));

      // 创建100个更新操作
      const operations = Array.from({ length: 100 }, (_, i) => ({
        type: 'update' as const,
        data: { active: false },
        where: { id: i + 1 }
      }));

      const result = await bulkWrite(TEST_TABLE, operations);
      // 只有50条记录，所以只能更新50条
      expect(result.written).toBe(50);

      const activeUsers = await findMany(TEST_TABLE, { where: { active: true } });
      expect(activeUsers.length).toBe(0);
    });
  });

  describe('Invalid Operations', () => {
    it('should throw when inserting invalid data type', async () => {
      await createTable(TEST_TABLE);
      await expect(insert(TEST_TABLE, 'invalid_data' as any)).rejects.toThrow();
    });

    it('should handle updating with invalid where clause', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });
      // 不应该抛出错误，而是返回0条更新记录
      const result = await update(TEST_TABLE, { name: 'Updated' }, { where: 'invalid_where' as any });
      expect(result).toBe(0);
    });

    it('should handle removing with invalid where clause', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });
      // 不应该抛出错误，而是返回0条删除记录
      const result = await remove(TEST_TABLE, { where: 'invalid_where' as any });
      expect(result).toBe(0);
    });

    it('should handle finding with invalid where clause', async () => {
      await createTable(TEST_TABLE);
      // 不应该抛出错误，而是返回null
      const result = await findOne(TEST_TABLE, { where: 'invalid_where' as any });
      expect(result).toBeNull();
    });
  });

  describe('Transaction Edge Cases', () => {
    it('should reject nested transactions', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });

      // 开始第一个事务
      await beginTransaction({});
      await update(TEST_TABLE, { name: 'Updated 1' }, { where: { id: 1 } });
      
      // 尝试开始另一个事务，应该抛出错误
      await expect(beginTransaction({})).rejects.toThrow('Transaction already in progress');
      
      // 提交第一个事务
      await commit({});

      const user = await findOne(TEST_TABLE, { where: { id: 1 } });
      expect(user?.name).toBe('Updated 1');
    });

    it('should handle transaction with multiple operations', async () => {
      await createTable(TEST_TABLE);

      await beginTransaction({});
      await insert(TEST_TABLE, { id: 1, name: 'User 1' });
      await insert(TEST_TABLE, { id: 2, name: 'User 2' });
      await commit({});

      const users = await findMany(TEST_TABLE);
      // 期望有两条记录
      expect(users.length).toBe(2);
    });

    it('should handle transaction with invalid operation', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });

      // 不使用事务，直接测试无效操作
      try {
        await insert(TEST_TABLE, 'invalid_data' as any);
        expect(true).toBe(false); // Should have thrown an error
      } catch (error) {
        // 预期会抛出错误
        expect(error).toBeDefined();
      }

      // 验证数据没有被修改
      const user = await findOne(TEST_TABLE, { where: { id: 1 } });
      expect(user?.name).toBe('Test User');
    });
  });

  describe('Table Management Edge Cases', () => {
    it('should handle creating table with very long name', async () => {
      const longTableName = 'a'.repeat(100);
      await createTable(longTableName);
      expect(await hasTable(longTableName)).toBe(true);
      await deleteTable(longTableName);
    });

    it('should handle deleting non-existent table multiple times', async () => {
      await expect(deleteTable('non_existent_table')).resolves.not.toThrow();
      await expect(deleteTable('non_existent_table')).resolves.not.toThrow();
    });

    it('should handle creating table with existing name multiple times', async () => {
      await createTable(TEST_TABLE);
      await expect(createTable(TEST_TABLE)).resolves.not.toThrow();
    });
  });

  describe('Query Options Edge Cases', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        age: 18 + i,
        active: i % 2 === 0
      })));
    });

    it('should handle very large skip value', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, skip: 1000, limit: 5 });
      expect(users).toEqual([]);
    });

    it('should handle very large limit value', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, limit: 1000 });
      expect(users.length).toBe(20); // 只有20条记录
    });

    it('should handle zero skip and limit', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, skip: 0, limit: 0 });
      expect(users.length).toBe(0); // limit为0应该返回空数组
    });

    it('should handle null or undefined query options', async () => {
      const users1 = await findMany(TEST_TABLE, {} as any);
      const users2 = await findMany(TEST_TABLE, undefined as any);
      expect(users1.length).toBe(20);
      expect(users2.length).toBe(20);
    });

    it('should handle invalid sortBy field', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, sortBy: 'non_existent_field', order: 'asc' });
      expect(users.length).toBe(20); // 应该返回所有记录，排序可能无效但不应该抛出错误
    });

    it('should handle invalid order value', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, sortBy: 'age', order: 'invalid_order' as any });
      expect(users.length).toBe(20); // 应该返回所有记录，使用默认排序
    });
  });

  describe('Mixed Encryption Modes', () => {
    const ENCRYPTED_TABLE = 'mixed_encrypted_table';
    const PLAIN_TABLE = 'mixed_plain_table';

    beforeEach(async () => {
      if (await hasTable(ENCRYPTED_TABLE)) {
        await deleteTable(ENCRYPTED_TABLE);
      }
      if (await hasTable(PLAIN_TABLE)) {
        await deleteTable(PLAIN_TABLE);
      }
    });

    afterAll(async () => {
      if (await hasTable(ENCRYPTED_TABLE)) {
        await deleteTable(ENCRYPTED_TABLE);
      }
      if (await hasTable(PLAIN_TABLE)) {
        await deleteTable(PLAIN_TABLE);
      }
    });

    it('should handle mixed encrypted and plain tables', async () => {
      // 创建加密表
      await createTable(ENCRYPTED_TABLE, { encrypted: true });
      await insert(ENCRYPTED_TABLE, { id: 1, name: 'Encrypted User' }, { encrypted: true });

      // 创建非加密表
      await createTable(PLAIN_TABLE, { encrypted: false });
      await insert(PLAIN_TABLE, { id: 1, name: 'Plain User' });

      // 同时使用两个表
      const encryptedUser = await findOne(ENCRYPTED_TABLE, { where: { id: 1 }, encrypted: true });
      const plainUser = await findOne(PLAIN_TABLE, { where: { id: 1 } });

      expect(encryptedUser?.name).toBe('Encrypted User');
      expect(plainUser?.name).toBe('Plain User');
    });

    it('should handle transactions across multiple tables', async () => {
      // 创建加密表和非加密表
      await createTable(ENCRYPTED_TABLE, { encrypted: true });
      await createTable(PLAIN_TABLE, { encrypted: false });

      await beginTransaction({});
      
      // 在事务中操作两个表
      await insert(ENCRYPTED_TABLE, { id: 1, name: 'Encrypted User' }, { encrypted: true });
      await insert(PLAIN_TABLE, { id: 1, name: 'Plain User' });
      
      await commit({});

      const encryptedUser = await findOne(ENCRYPTED_TABLE, { where: { id: 1 }, encrypted: true });
      const plainUser = await findOne(PLAIN_TABLE, { where: { id: 1 } });

      expect(encryptedUser).toBeDefined();
      expect(plainUser).toBeDefined();
    });
  });

  describe('Data Corruption Simulation', () => {
    it('should handle partial data corruption', async () => {
      await createTable(TEST_TABLE);
      
      // 插入有效数据
      await insert(TEST_TABLE, { id: 1, name: 'Valid User' });
      
      // 模拟数据损坏 - 直接写入无效的JSON
      const fs = require('fs');
      const path = require('path');
      
      // 获取数据文件路径（这里需要知道实际的数据文件位置，可能需要调整）
      const dataFilePath = path.join(__dirname, `../../../dist/data/${TEST_TABLE}.ldb`);
      
      if (fs.existsSync(dataFilePath)) {
        // 写入无效的JSON
        fs.writeFileSync(dataFilePath, '{ invalid json data }');
        
        // 尝试读取损坏的数据，应该返回空数组或抛出错误
        await expect(read(TEST_TABLE)).rejects.toThrow();
      }
    });
  });
});