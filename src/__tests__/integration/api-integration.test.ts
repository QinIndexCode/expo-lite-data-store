// src/__tests__/integration/api-integration.test.ts
// 全面的API集成测试

import { 
  createTable, 
  insert, 
  findOne, 
  findMany, 
  update, 
  remove, 
  deleteTable, 
  hasTable, 
  beginTransaction, 
  commit, 
  rollback, 
  bulkWrite, 
  countTable, 
  read 
} from '../../expo-lite-data-store';

describe('API Integration Tests', () => {
  const INTEGRATION_TABLE = 'api_integration_test_table';
  
  beforeEach(async () => {
    if (await hasTable(INTEGRATION_TABLE)) {
      await deleteTable(INTEGRATION_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(INTEGRATION_TABLE)) {
      await deleteTable(INTEGRATION_TABLE);
    }
  });

  describe('Comprehensive CRUD Integration', () => {
    it('should handle complete CRUD lifecycle with complex queries', async () => {
      // 1. 创建表
      await createTable(INTEGRATION_TABLE);
      
      // 2. 插入多条数据
      const initialData = [
        { id: 1, name: 'Product 1', category: 'Electronics', price: 100, stock: 50, active: true },
        { id: 2, name: 'Product 2', category: 'Clothing', price: 50, stock: 100, active: true },
        { id: 3, name: 'Product 3', category: 'Electronics', price: 200, stock: 25, active: false },
        { id: 4, name: 'Product 4', category: 'Books', price: 20, stock: 200, active: true },
        { id: 5, name: 'Product 5', category: 'Clothing', price: 80, stock: 75, active: true },
      ];
      
      const insertResult = await insert(INTEGRATION_TABLE, initialData);
      expect(insertResult.written).toBe(initialData.length);
      expect(insertResult.totalAfterWrite).toBe(initialData.length);
      
      // 3. 复杂查询：查找 Electronics 类别且价格 > 50 的产品
      const electronicsExpensive = await findMany(INTEGRATION_TABLE, {
        where: { 
          $and: [
            { category: 'Electronics' },
            { price: { $gt: 50 } }
          ]
        },
        sortBy: 'price',
        order: 'desc'
      });
      
      expect(electronicsExpensive.length).toBe(2);
      expect(electronicsExpensive[0].price).toBe(200); // Product 3
      expect(electronicsExpensive[1].price).toBe(100); // Product 1
      
      // 4. 更新：将所有 Electronics 类别的产品价格提高 10%
      const updateResult = await update(INTEGRATION_TABLE, 
        { $inc: { price: 10 } }, // 使用增量更新
        { where: { category: 'Electronics' } }
      );
      
      expect(updateResult).toBe(2);
      
      // 验证更新结果
      const updatedProduct3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(updatedProduct3?.price).toBe(210); // 200 + 10
      
      // 5. 删除：删除库存 < 50 的产品
      const deleteResult = await remove(INTEGRATION_TABLE, {
        where: { stock: { $lt: 50 } }
      });
      
      expect(deleteResult).toBe(1); // 只有 Product 3 库存为 25
      
      // 验证删除结果
      const remainingCount = await countTable(INTEGRATION_TABLE);
      expect(remainingCount).toBe(4);
      
      const deletedProduct = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(deletedProduct).toBeNull();
      
      // 6. 读取所有剩余数据
      const remainingData = await read(INTEGRATION_TABLE);
      expect(remainingData.length).toBe(4);
    });
  });

  describe('Advanced BulkWrite Integration', () => {
    it('should handle mixed bulk operations with complex conditions', async () => {
      await createTable(INTEGRATION_TABLE);
      
      // 插入初始数据
      const initialData = [
        { id: 1, name: 'User 1', role: 'admin', active: true, score: 100 },
        { id: 2, name: 'User 2', role: 'user', active: true, score: 50 },
        { id: 3, name: 'User 3', role: 'user', active: false, score: 75 },
        { id: 4, name: 'User 4', role: 'user', active: true, score: 90 },
      ];
      
      await insert(INTEGRATION_TABLE, initialData);
      
      // 创建复杂的批量操作：混合插入、更新和删除
      const operations = [
        // 插入新用户
        {
          type: 'insert' as const,
          data: { id: 5, name: 'User 5', role: 'user', active: true, score: 85 }
        },
        {
          type: 'insert' as const,
          data: { id: 6, name: 'User 6', role: 'moderator', active: true, score: 95 }
        },
        // 更新：将所有 admin 角色的分数提高 20
        {
          type: 'update' as const,
          data: { $inc: { score: 20 } },
          where: { role: 'admin' }
        },
        // 更新：将分数 > 80 的用户角色改为 premium
        {
          type: 'update' as const,
          data: { role: 'premium' },
          where: { score: { $gt: 80 } }
        },
        // 删除：不活跃的用户
        {
          type: 'delete' as const,
          where: { active: false }
        },
        // 更新：将特定用户标记为不活跃
        {
          type: 'update' as const,
          data: { active: false },
          where: { id: 2 }
        }
      ];
      
      await bulkWrite(INTEGRATION_TABLE, operations);
      
      // 验证批量操作结果
      const finalCount = await countTable(INTEGRATION_TABLE);
      expect(finalCount).toBe(5); // 初始4 + 插入2 - 删除1 = 5
      
      // 验证插入结果
      const user5 = await findOne(INTEGRATION_TABLE, { where: { id: 5 } });
      const user6 = await findOne(INTEGRATION_TABLE, { where: { id: 6 } });
      expect(user5).toBeDefined();
      expect(user6).toBeDefined();
      
      // 验证更新结果
      const adminUser = await findOne(INTEGRATION_TABLE, { where: { role: 'admin' } });
      expect(adminUser).toBeNull(); // 应该已经被改为 premium
      
      const premiumUsers = await findMany(INTEGRATION_TABLE, { where: { role: 'premium' } });
      expect(premiumUsers.length).toBeGreaterThan(0);
      
      // 验证删除结果
      const inactiveUsers = await findMany(INTEGRATION_TABLE, { where: { active: false } });
      expect(inactiveUsers.length).toBe(1); // 只有 User 2 被标记为不活跃
      
      const deletedUser3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(deletedUser3).toBeNull(); // 应该已经被删除
    });

    it('should handle bulkWrite with array data for insert', async () => {
      await createTable(INTEGRATION_TABLE);
      
      const bulkInsertData = [
        { id: 1, name: 'Bulk User 1', group: 'A' },
        { id: 2, name: 'Bulk User 2', group: 'B' },
        { id: 3, name: 'Bulk User 3', group: 'A' },
      ];
      
      const operations = [
        {
          type: 'insert' as const,
          data: bulkInsertData // 直接插入数组
        }
      ];
      
      const result = await bulkWrite(INTEGRATION_TABLE, operations);
      expect(result.written).toBe(3); // 插入了3条记录
      
      const count = await countTable(INTEGRATION_TABLE);
      expect(count).toBe(3);
    });
  });

  describe('Transaction Integration Tests', () => {
    it('should handle complex transactions with multiple operations', async () => {
      await createTable(INTEGRATION_TABLE);
      
      // 插入初始数据
      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'Account 1', balance: 1000, status: 'active' },
        { id: 2, name: 'Account 2', balance: 500, status: 'active' },
        { id: 3, name: 'Account 3', balance: 2000, status: 'inactive' },
      ]);
      
      // 模拟转账事务：从账户1转200到账户2
      await beginTransaction({});
      let transactionActive = true;
      
      try {
        // 1. 检查账户1余额是否足够
        const account1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
        if (account1?.balance < 200) {
          throw new Error('Insufficient balance');
        }
        
        // 2. 扣除账户1的余额
        await update(INTEGRATION_TABLE, 
          { $inc: { balance: -200 } }, 
          { where: { id: 1 } }
        );
        
        // 3. 增加账户2的余额
        await update(INTEGRATION_TABLE, 
          { $inc: { balance: 200 } }, 
          { where: { id: 2 } }
        );
        
        // 4. 激活账户3
        await update(INTEGRATION_TABLE, 
          { status: 'active' }, 
          { where: { id: 3 } }
        );
        
        // 5. 插入一条交易记录
        await insert(INTEGRATION_TABLE, {
          id: 4, 
          type: 'transaction', 
          from: 1, 
          to: 2, 
          amount: 200,
          timestamp: Date.now()
        });
        
        // 提交事务
        await commit({});
        transactionActive = false;
        
        // 验证事务结果
        const updatedAccount1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
        const updatedAccount2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });
        const updatedAccount3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
        const transaction = await findOne(INTEGRATION_TABLE, { where: { id: 4 } });
        
        expect(updatedAccount1?.balance).toBe(800); // 1000 - 200
        expect(updatedAccount2?.balance).toBe(700); // 500 + 200
        expect(updatedAccount3?.status).toBe('active');
        expect(transaction).toBeDefined();
        expect(transaction?.amount).toBe(200);
        
      } catch (error) {
        if (transactionActive) {
          await rollback({});
        }
        throw error;
      }
    });

    it('should rollback complex transactions correctly', async () => {
      await createTable(INTEGRATION_TABLE);
      
      // 插入初始数据
      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'Critical Data 1', value: 100 },
        { id: 2, name: 'Critical Data 2', value: 200 },
      ]);
      
      const initialData1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
      const initialData2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });
      
      // 开始事务
      await beginTransaction({});
      let transactionActive = true;
      
      try {
        // 更新第一条数据
        await update(INTEGRATION_TABLE, { value: 150 }, { where: { id: 1 } });
        
        // 故意抛出错误
        throw new Error('Test rollback');
        
        // 下面的操作不应该执行
        await update(INTEGRATION_TABLE, { value: 250 }, { where: { id: 2 } });
        
        await commit({});
        transactionActive = false;
        
      } catch (error) {
        // 回滚事务
        if (transactionActive) {
          await rollback({});
        }
      }
      
      // 验证事务回滚
      const rolledBackData1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
      const rolledBackData2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });
      
      expect(rolledBackData1?.value).toBe(initialData1?.value); // 应该保持初始值
      expect(rolledBackData2?.value).toBe(initialData2?.value); // 应该保持初始值
    });
  });

  describe('Query Engine Integration Tests', () => {
    it('should handle complex nested queries with multiple operators', async () => {
      await createTable(INTEGRATION_TABLE);
      
      // 插入测试数据
      const testData = [
        { id: 1, name: 'Item 1', tags: ['A', 'B'], rating: 4.5, price: 100, available: true },
        { id: 2, name: 'Item 2', tags: ['B', 'C'], rating: 3.8, price: 150, available: true },
        { id: 3, name: 'Item 3', tags: ['A', 'C', 'D'], rating: 4.2, price: 200, available: false },
        { id: 4, name: 'Item 4', tags: ['B'], rating: 4.7, price: 50, available: true },
        { id: 5, name: 'Item 5', tags: ['A', 'B', 'C'], rating: 3.5, price: 120, available: true },
      ];
      
      await insert(INTEGRATION_TABLE, testData);
      
      // 复杂查询：
      // (tags包含A AND rating > 4.0) OR (price < 100 AND available = true) AND NOT (tags包含D)
      const complexQueryResult = await findMany(INTEGRATION_TABLE, {
        where: {
          $and: [
            {
              $or: [
                { $and: [{ tags: { $in: ['A'] } }, { rating: { $gt: 4.0 } }] },
                { $and: [{ price: { $lt: 100 } }, { available: true }] }
              ]
            },
            { tags: { $nin: ['D'] } }
          ]
        },
        sortBy: ['rating', 'price'],
        order: ['desc', 'asc']
      });
      
      // 预期结果：
      // Item 4: tags包含B, rating 4.7, price 50, available true (匹配 price < 100 AND available = true)
      // Item 1: tags包含A, rating 4.5, price 100, available true (匹配 tags包含A AND rating > 4.0)
      // Item 3: tags包含D，应该被排除
      expect(complexQueryResult.length).toBe(2);
      expect(complexQueryResult[0].id).toBe(4); // Item 4, rating 4.7
      expect(complexQueryResult[1].id).toBe(1); // Item 1, rating 4.5
    });

    it('should handle array operations with complex conditions', async () => {
      await createTable(INTEGRATION_TABLE);
      
      // 插入包含数组字段的测试数据
      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'User 1', roles: ['admin', 'editor'], permissions: [1, 2, 3], active: true },
        { id: 2, name: 'User 2', roles: ['editor', 'viewer'], permissions: [2, 3], active: true },
        { id: 3, name: 'User 3', roles: ['viewer'], permissions: [3], active: false },
        { id: 4, name: 'User 4', roles: ['admin', 'viewer'], permissions: [1, 3], active: true },
        { id: 5, name: 'User 5', roles: [], permissions: [], active: true },
      ]);
      
      // 查询：roles包含admin OR permissions包含2，且active=true
      const arrayQueryResult = await findMany(INTEGRATION_TABLE, {
        where: {
          $and: [
            {
              $or: [
                { roles: { $in: ['admin'] } },
                { permissions: { $in: [2] } }
              ]
            },
            { active: true }
          ]
        }
      });
      
      expect(arrayQueryResult.length).toBe(3); // User 1, User 2, User 4
      
      // 查询：roles为空数组的用户
      const emptyArrayResult = await findMany(INTEGRATION_TABLE, {
        where: { roles: [] }
      });
      
      expect(emptyArrayResult.length).toBe(1); // User 5
    });
  });
});
