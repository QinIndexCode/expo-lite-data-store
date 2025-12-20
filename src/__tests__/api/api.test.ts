// src/__tests__/api/api.test.ts
// 完整的API测试，覆盖所有主要API和使用场景

import {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  read,
  countTable,
  verifyCountTable,
  findOne,
  findMany,
  remove,
  bulkWrite,
  beginTransaction,
  commit,
  rollback,
  migrateToChunked,
  update,
  clearTable
} from '../../expo-lite-data-store';

describe('Complete API Tests', () => {
  const TEST_TABLE_PREFIX = 'api_test_';
  let testTable: string;

  beforeEach(() => {
    testTable = `${TEST_TABLE_PREFIX}${Date.now()}`;
  });

  afterAll(async () => {
    // 清理所有测试表
    const tables = await listTables({});
    for (const table of tables) {
      if (table.startsWith(TEST_TABLE_PREFIX)) {
        await deleteTable(table);
      }
    }
  });

  describe('Table Management APIs', () => {
    it('should create, check, and delete table', async () => {
      // 创建表
      await createTable(testTable);
      expect(await hasTable(testTable)).toBe(true);

      // 删除表
      await deleteTable(testTable);
      expect(await hasTable(testTable)).toBe(false);
    });

    it('should handle listTables with multiple tables', async () => {
      // 创建多个表
      const tableNames = [
        `${TEST_TABLE_PREFIX}table1_${Date.now()}`,
        `${TEST_TABLE_PREFIX}table2_${Date.now()}`,
        `${TEST_TABLE_PREFIX}table3_${Date.now()}`
      ];

      for (const tableName of tableNames) {
        await createTable(tableName);
      }

      // 列出所有表
      const allTables = await listTables({});
      
      // 验证所有创建的表都在列表中
      for (const tableName of tableNames) {
        expect(allTables).toContain(tableName);
      }

      // 清理
      for (const tableName of tableNames) {
        await deleteTable(tableName);
      }
    });

    it('should test clearTable functionality', async () => {
      await createTable(testTable);

      // 插入数据
      await insert(testTable, [
        { id: 1, name: 'Test 1' },
        { id: 2, name: 'Test 2' },
        { id: 3, name: 'Test 3' }
      ]);

      // 验证数据已插入
      let data = await read(testTable);
      expect(data.length).toBe(3);

      // 清空表
      await clearTable(testTable);

      // 验证表已清空但仍然存在
      data = await read(testTable);
      expect(data.length).toBe(0);
      expect(await hasTable(testTable)).toBe(true);

      // 可以继续插入数据
      await insert(testTable, { id: 4, name: 'Test 4' });
      data = await read(testTable);
      expect(data.length).toBe(1);
    });
  });

  describe('Data Write APIs', () => {
    it('should test insert with single and multiple records', async () => {
      await createTable(testTable);

      // 插入单条记录
      const singleResult = await insert(testTable, {
        id: 1,
        name: 'Single Record',
        value: 100
      });
      expect(singleResult.written).toBe(1);
      expect(singleResult.totalAfterWrite).toBe(1);

      // 插入多条记录
      const multipleResult = await insert(testTable, [
        { id: 2, name: 'Multiple 1', value: 200 },
        { id: 3, name: 'Multiple 2', value: 300 }
      ]);
      expect(multipleResult.written).toBe(2);
      expect(multipleResult.totalAfterWrite).toBe(3);
    });

    it('should test bulkWrite with mixed operations', async () => {
      await createTable(testTable);

      // 初始数据
      await insert(testTable, [
        { id: 1, name: 'Initial 1', value: 100 },
        { id: 2, name: 'Initial 2', value: 200 }
      ]);

      // 执行批量操作
      const bulkResult = await bulkWrite(testTable, [
        // 插入新记录
        {
          type: 'insert',
          data: { id: 3, name: 'Bulk Insert', value: 300 }
        },
        // 更新现有记录
        {
          type: 'update',
          data: { value: 150 },
          where: { id: 1 }
        },
        // 删除记录
        {
          type: 'delete',
          data: {},
          where: { id: 2 }
        }
      ]);

      expect(bulkResult.written).toBe(3);

      // 验证结果
      const data = await read(testTable);
      expect(data.length).toBe(2);
      
      const updatedItem = data.find(item => item.id === 1);
      expect(updatedItem?.value).toBe(150);
      
      const deletedItem = data.find(item => item.id === 2);
      expect(deletedItem).toBeUndefined();
      
      const insertedItem = data.find(item => item.id === 3);
      expect(insertedItem).toBeDefined();
    });
  });

  describe('Data Read APIs', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Item 1', category: 'A', value: 100, active: true },
        { id: 2, name: 'Item 2', category: 'B', value: 200, active: false },
        { id: 3, name: 'Item 3', category: 'A', value: 300, active: true },
        { id: 4, name: 'Item 4', category: 'C', value: 400, active: true },
        { id: 5, name: 'Item 5', category: 'B', value: 500, active: false }
      ]);
    });

    it('should test read all data', async () => {
      const data = await read(testTable);
      expect(data.length).toBe(5);
      expect(data[0].id).toBe(1);
      expect(data[4].id).toBe(5);
    });

    it('should test findOne with different conditions', async () => {
      // 按ID查找
      const byId = await findOne(testTable, { where: { id: 3 } });
      expect(byId?.name).toBe('Item 3');
      
      // 按条件查找
      const byCategory = await findOne(testTable, { where: { category: 'B', active: false } });
      expect(byCategory?.id).toBe(2);
      
      // 查找不存在的记录
      const notFound = await findOne(testTable, { where: { id: 100 } });
      expect(notFound).toBeNull();
    });

    it('should test findMany with filtering, sorting, and pagination', async () => {
      // 基本过滤
      const activeItems = await findMany(testTable, { where: { active: true } });
      expect(activeItems.length).toBe(3);
      
      // 过滤+排序
      const sortedItems = await findMany(testTable, {
        where: { active: true },
        sortBy: 'value',
        order: 'desc'
      });
      expect(sortedItems.length).toBe(3);
      expect(sortedItems[0].value).toBe(400);
      expect(sortedItems[2].value).toBe(100);
      
      // 过滤+分页
      const paginatedItems = await findMany(testTable, {
        where: { category: 'A' },
        skip: 1,
        limit: 1
      });
      expect(paginatedItems.length).toBe(1);
      expect(paginatedItems[0].id).toBe(3);
    });

    it('should test countTable functionality', async () => {
      // 基本计数
      const count = await countTable(testTable);
      expect(count).toBe(5);
      
      // 插入更多数据后计数
      await insert(testTable, {
        id: 6,
        name: 'Item 6',
        category: 'A',
        value: 600,
        active: true
      });
      const updatedCount = await countTable(testTable);
      expect(updatedCount).toBe(6);
    });

    it('should test verifyCountTable functionality', async () => {
      const result = await verifyCountTable(testTable);
      expect(result.metadata).toBe(5);
      expect(result.actual).toBe(5);
      expect(result.match).toBe(true);
    });
  });

  describe('Data Update and Delete APIs', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Update Test 1', value: 100, active: true },
        { id: 2, name: 'Update Test 2', value: 200, active: false },
        { id: 3, name: 'Update Test 3', value: 300, active: true }
      ]);
    });

    it('should test update with different conditions', async () => {
      // 更新单条记录
      const singleUpdate = await update(testTable, 
        { value: 150 }, 
        { where: { id: 1 } }
      );
      expect(singleUpdate).toBe(1);
      
      // 验证更新结果
      const updatedItem = await findOne(testTable, { where: { id: 1 } });
      expect(updatedItem?.value).toBe(150);
      
      // 更新多条记录
      const multipleUpdate = await update(testTable, 
        { active: true }, 
        { where: { active: false } }
      );
      expect(multipleUpdate).toBe(1);
      
      // 验证更新结果
      const allActiveItems = await findMany(testTable, { where: { active: true } });
      expect(allActiveItems.length).toBe(3);
    });

    it('should test remove with different conditions', async () => {
      // 删除单条记录
      const singleRemove = await remove(testTable, { where: { id: 1 } });
      expect(singleRemove).toBe(1);
      
      // 验证删除结果
      const remaining = await read(testTable);
      expect(remaining.length).toBe(2);
      
      // 删除多条记录
      const multipleRemove = await remove(testTable, { where: { active: true } });
      expect(multipleRemove).toBe(1);
      
      // 验证最终结果
      const final = await read(testTable);
      expect(final.length).toBe(1);
      expect(final[0].id).toBe(2);
    });
  });

  describe('Transaction APIs', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Transaction Test', balance: 1000 }
      ]);
    });

    it('should test successful transaction', async () => {
      await beginTransaction({});
      
      // 在事务中执行操作
      await update(testTable, { balance: 1500 }, { where: { id: 1 } });
      await insert(testTable, { id: 2, name: 'New Item', balance: 500 });
      
      // 提交事务
      await commit({});
      
      // 验证结果
      const item1 = await findOne(testTable, { where: { id: 1 } });
      const item2 = await findOne(testTable, { where: { id: 2 } });
      
      expect(item1?.balance).toBe(1500);
      expect(item2).toBeDefined();
    });

    it('should test transaction rollback', async () => {
      await beginTransaction({});
      
      // 在事务中执行操作
      await update(testTable, { balance: 1500 }, { where: { id: 1 } });
      await insert(testTable, { id: 2, name: 'Rollback Test', balance: 500 });
      
      // 回滚事务
      await rollback({});
      
      // 验证回滚结果
      const items = await read(testTable);
      expect(items.length).toBe(1);
      expect(items[0].balance).toBe(1000);
    });

    it('should test transaction with complex operations', async () => {
      await beginTransaction({});
      let transactionActive = true;
      
      try {
        // 执行多个操作
        await update(testTable, { balance: 1200 }, { where: { id: 1 } });
        await insert(testTable, { id: 2, name: 'Complex Test', balance: 800 });
        await remove(testTable, { where: { id: 1 } });
        
        // 提交事务
        await commit({});
        transactionActive = false;
        
        // 验证结果 - 这里应该还有1条记录，因为初始数据是1条，删除了1条，添加了1条
        const items = await read(testTable);
        expect(items.length).toBe(1);
        // 验证id为2的记录存在
        const item2 = items.find(item => item.id === 2);
        expect(item2).toBeDefined();
      } catch (error) {
        if (transactionActive) {
          await rollback({});
        }
        throw error;
      }
    });
  });

  describe('Advanced Features', () => {
    it('should test migrateToChunked functionality', async () => {
      await createTable(testTable);
      
      // 插入足够的数据以触发分片
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Large Item ${i + 1}`,
        data: 'x'.repeat(500) // 增加数据大小
      }));
      await insert(testTable, largeData);
      
      // 执行迁移
      await migrateToChunked(testTable);
      
      // 验证数据完整性
      const migratedData = await read(testTable);
      expect(migratedData.length).toBe(100);
      
      // 验证查询仍然有效
      const found = await findOne(testTable, { where: { id: 50 } });
      expect(found?.id).toBe(50);
    });


  });

  describe('Complex Query Scenarios', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Product 1', category: 'Electronics', price: 100, rating: 4.5, tags: ['a', 'b'], active: true },
        { id: 2, name: 'Product 2', category: 'Clothing', price: 50, rating: 3.8, tags: ['b', 'c'], active: true },
        { id: 3, name: 'Product 3', category: 'Electronics', price: 200, rating: 4.2, tags: ['a', 'c'], active: false },
        { id: 4, name: 'Product 4', category: 'Books', price: 20, rating: 4.7, tags: ['d'], active: true },
        { id: 5, name: 'Product 5', category: 'Clothing', price: 80, rating: 3.5, tags: ['a', 'b', 'c'], active: true }
      ]);
    });

    it('should test complex filtering with operators', async () => {
      // 使用比较运算符
      const expensiveItems = await findMany(testTable, {
        where: { price: { $gt: 80 } }
      });
      expect(expensiveItems.length).toBe(2);
      
      // 使用范围运算符
      const mediumRatedItems = await findMany(testTable, {
        where: { rating: { $gte: 4.0, $lte: 4.5 } }
      });
      expect(mediumRatedItems.length).toBe(2);
      
      // 使用数组包含运算符
      const taggedItems = await findMany(testTable, {
        where: { tags: { $in: ['a', 'd'] } }
      });
      expect(taggedItems.length).toBe(4);
    });

    it('should test logical operators in queries', async () => {
      // AND条件
      const electronicsAndActive = await findMany(testTable, {
        where: { $and: [{ category: 'Electronics' }, { active: true }] }
      });
      expect(electronicsAndActive.length).toBe(1);
      
      // OR条件
      const cheapOrHighRated = await findMany(testTable, {
        where: { $or: [{ price: { $lt: 50 } }, { rating: { $gt: 4.5 } }] }
      });
      expect(cheapOrHighRated.length).toBe(1); // 只有Product 4符合条件
      
      // 组合条件
      const complexQuery = await findMany(testTable, {
        where: {
          $and: [
            { active: true },
            {
              $or: [
                { category: 'Clothing' },
                { rating: { $gt: 4.5 } }
              ]
            },
            { price: { $lt: 100 } }
          ]
        }
      });
      expect(complexQuery.length).toBe(3); // Product 2, Product 4, Product 5都符合条件
    });
  });
});
