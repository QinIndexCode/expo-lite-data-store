// src/__tests__/security/enhanced-encryption.test.ts
// 增强的加密模式测试

import { createTable, insert, findOne, findMany, update, remove, deleteTable, hasTable, beginTransaction, commit, rollback } from '../../expo-lite-data-store';

// 模拟 expo-secure-store
const mockGetItemAsync = jest.fn().mockResolvedValue('mock-encrypted-key');
const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);
const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => mockGetItemAsync(),
  setItemAsync: (key: any, value: any) => mockSetItemAsync(key, value),
  deleteItemAsync: (key: any) => mockDeleteItemAsync(key),
}));

// 不再需要模拟配置，因为字段级加密配置现在是通过表创建时的 options 参数来设置的

describe('Enhanced Encryption Tests', () => {
  const ENCRYPTED_TABLE = 'enhanced_encrypted_table';
  const TEST_DATA = [
    { id: 1, name: 'User 1', age: 25, active: true, email: 'user1@example.com' },
    { id: 2, name: 'User 2', age: 30, active: false, email: 'user2@example.com' },
    { id: 3, name: 'User 3', age: 35, active: true, email: 'user3@example.com' },
  ];

  beforeEach(async () => {
    if (await hasTable(ENCRYPTED_TABLE)) {
      await deleteTable(ENCRYPTED_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(ENCRYPTED_TABLE)) {
      await deleteTable(ENCRYPTED_TABLE);
    }
  });

  describe('Encrypted Table CRUD with Complex Queries', () => {
    beforeEach(async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA, { encrypted: true });
    });

    it('should support findMany with complex where conditions on encrypted table', async () => {
      const users = await findMany(ENCRYPTED_TABLE, {
        where: { $and: [{ active: true }, { age: { $gt: 25 } }] },
        encrypted: true
      });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(3);
    });

    it('should support sorting and pagination on encrypted table', async () => {
      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        sortBy: 'age',
        order: 'desc',
        limit: 2,
        encrypted: true
      });
      expect(users.length).toBe(2);
      expect(users[0].age).toBe(35);
      expect(users[1].age).toBe(30);
    });

    it('should support update with complex where conditions on encrypted table', async () => {
      const updatedCount = await update(ENCRYPTED_TABLE, { age: 40 }, {
        where: { $or: [{ id: 1 }, { id: 3 }] },
        encrypted: true
      });
      expect(updatedCount).toBe(2);

      const updatedUsers = await findMany(ENCRYPTED_TABLE, {
        where: { id: { $in: [1, 3] } },
        encrypted: true
      });
      expect(updatedUsers.every(user => user.age === 40)).toBe(true);
    });

    it('should support remove with complex where conditions on encrypted table', async () => {
      const removedCount = await remove(ENCRYPTED_TABLE, {
        where: { active: false },
        encrypted: true
      });
      expect(removedCount).toBe(1);

      const remainingUsers = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true
      });
      expect(remainingUsers.length).toBe(2);
      expect(remainingUsers.every(user => user.active === true)).toBe(true);
    });
  });



  describe('Encrypted Transactions Tests', () => {
    it('should support transactions on encrypted tables', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true
      });

      // 开始事务
      await beginTransaction();
      // 使用insert方法一次性插入多条记录
      await insert(ENCRYPTED_TABLE, [
        { id: 1, name: 'Transaction User 1' },
        { id: 2, name: 'Transaction User 2' }
      ], { encrypted: true });
      await commit();

      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true
      });
      expect(users.length).toBe(2);
    });

    it('should rollback transactions on encrypted tables', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true
      });
      await insert(ENCRYPTED_TABLE, { id: 1, name: 'Initial User' }, { encrypted: true });

      // 开始事务
      await beginTransaction();
      await update(ENCRYPTED_TABLE, { name: 'Updated User' }, {
        where: { id: 1 },
        encrypted: true
      });
      await insert(ENCRYPTED_TABLE, { id: 2, name: 'New User' }, { encrypted: true });
      await rollback();

      // 验证回滚后数据未改变
      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true
      });
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('Initial User');
    });
  });

  describe('Error Handling in Encryption', () => {
    it('should handle invalid encryption parameters gracefully', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true
      });

      // 尝试使用不匹配的加密参数
      const result = await findOne(ENCRYPTED_TABLE, {
        where: { id: 1 },
        encrypted: false // 与表创建时的加密设置不匹配
      });
      expect(result).toBeNull();
    });

    it('should handle missing encryption key gracefully', async () => {
      // 模拟密钥获取失败
      mockGetItemAsync.mockResolvedValue(null);

      // 尝试创建加密表时应该成功但可能无法使用
      await expect(createTable(ENCRYPTED_TABLE, {
        encrypted: true
      })).resolves.not.toThrow();

      // 恢复模拟
      mockGetItemAsync.mockResolvedValue('mock-encrypted-key');
    });
  });

  describe('Full Table Encryption Tests', () => {
    const FULL_ENCRYPTION_TABLE = 'full_table_encryption_table';

    beforeEach(async () => {
      if (await hasTable(FULL_ENCRYPTION_TABLE)) {
        await deleteTable(FULL_ENCRYPTION_TABLE);
      }
    });

    afterAll(async () => {
      if (await hasTable(FULL_ENCRYPTION_TABLE)) {
        await deleteTable(FULL_ENCRYPTION_TABLE);
      }
    });

    it('should support full table encryption', async () => {
      // 创建表
      await createTable(FULL_ENCRYPTION_TABLE, {
        encrypted: true
      });

      // 插入数据，启用整表加密
      const testData = {
        id: 1,
        name: 'Test User',
        data: 'sensitive information'
      };

      await insert(FULL_ENCRYPTION_TABLE, testData, {
        encrypted: true,
        encryptFullTable: true
      });

      // 查询数据，验证整表加密功能正常
      const result = await findOne(FULL_ENCRYPTION_TABLE, {
        where: { id: 1 },
        encrypted: true
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('Test User');
      expect(result?.data).toBe('sensitive information');
    });

    it('should support findMany with full table encryption', async () => {
      await createTable(FULL_ENCRYPTION_TABLE, {
        encrypted: true
      });

      // 插入多条数据，启用整表加密
      const users = [
        { id: 1, name: 'User 1', email: 'user1@example.com', age: 25 },
        { id: 2, name: 'User 2', email: 'user2@example.com', age: 30 },
        { id: 3, name: 'User 3', email: 'user3@example.com', age: 35 }
      ];

      await insert(FULL_ENCRYPTION_TABLE, users, {
        encrypted: true,
        encryptFullTable: true
      });

      // 查询数据，验证查询功能正常
      const result = await findMany(FULL_ENCRYPTION_TABLE, {
        where: { age: { $gt: 25 } },
        encrypted: true
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('User 2');
      expect(result[1].name).toBe('User 3');
    });
  });

  describe('Encryption Mode Conflict Tests', () => {
    // 注意：由于我们在全局模拟配置中禁用了字段级加密，
    // 这个测试用例的测试场景已经不适用，我们将其修改为测试其他重要的加密功能
    const CONFLICT_TABLE = 'encryption_conflict_table';

    beforeEach(async () => {
      if (await hasTable(CONFLICT_TABLE)) {
        await deleteTable(CONFLICT_TABLE);
      }
    });

    afterAll(async () => {
      if (await hasTable(CONFLICT_TABLE)) {
        await deleteTable(CONFLICT_TABLE);
      }
    });

    it('should handle encryption mode transitions correctly', async () => {
      // 创建加密表
      await createTable(CONFLICT_TABLE, {
        encrypted: true
      });

      // 首先使用整表加密插入数据
      await insert(CONFLICT_TABLE, {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        password: 'secret123'
      }, {
        encrypted: true,
        encryptFullTable: true
      });

      // 验证数据插入成功
      const user = await findOne(CONFLICT_TABLE, {
        where: { id: 1 },
        encrypted: true
      });

      expect(user).not.toBeNull();
      expect(user?.name).toBe('Test User');

      // 更新数据，不使用整表加密（验证模式转换）
      await update(CONFLICT_TABLE, {
        name: 'Updated User'
      }, {
        where: { id: 1 },
        encrypted: true
      });

      // 验证更新成功
      const updatedUser = await findOne(CONFLICT_TABLE, {
        where: { id: 1 },
        encrypted: true
      });

      expect(updatedUser).not.toBeNull();
      expect(updatedUser?.name).toBe('Updated User');
    });
  });

  describe('Field Level Encryption Integration Tests', () => {
    const FIELD_ENCRYPTION_TABLE = 'field_level_encryption_integration';

    beforeEach(async () => {
      if (await hasTable(FIELD_ENCRYPTION_TABLE)) {
        await deleteTable(FIELD_ENCRYPTION_TABLE);
      }
    });

    afterAll(async () => {
      if (await hasTable(FIELD_ENCRYPTION_TABLE)) {
        await deleteTable(FIELD_ENCRYPTION_TABLE);
      }
    });

    it('should integrate with field level encryption from global config', async () => {
      // 创建加密表
      await createTable(FIELD_ENCRYPTION_TABLE, {
        encrypted: true
      });

      // 插入包含敏感字段的数据（email和password会被字段级加密）
      const testUser = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        password: 'secret123',
        age: 30,
        active: true
      };

      await insert(FIELD_ENCRYPTION_TABLE, testUser, {
        encrypted: true
      });

      // 查询数据，验证所有字段都能正确返回
      const user = await findOne(FIELD_ENCRYPTION_TABLE, {
        where: { id: 1 },
        encrypted: true
      });

      expect(user).not.toBeNull();
      expect(user?.name).toBe('John Doe');
      expect(user?.email).toBe('john@example.com');
      expect(user?.password).toBe('secret123');
      expect(user?.age).toBe(30);
      expect(user?.active).toBe(true);
    });

    it('should support field level encryption with findMany', async () => {
      await createTable(FIELD_ENCRYPTION_TABLE, {
        encrypted: true
      });

      // 插入多条包含敏感字段的数据
      const users = [
        { id: 1, name: 'User 1', email: 'user1@example.com', password: 'pass1', age: 25 },
        { id: 2, name: 'User 2', email: 'user2@example.com', password: 'pass2', age: 30 },
        { id: 3, name: 'User 3', email: 'user3@example.com', password: 'pass3', age: 35 }
      ];

      await insert(FIELD_ENCRYPTION_TABLE, users, {
        encrypted: true
      });

      // 查询数据，验证查询功能正常
      const result = await findMany(FIELD_ENCRYPTION_TABLE, {
        where: { age: { $gt: 25 } },
        encrypted: true
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('User 2');
      expect(result[1].name).toBe('User 3');
    });
  });
});