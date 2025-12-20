// src/__tests__/security/biometric-auth-enhanced.test.ts
// 增强的生物识别认证测试

import { createTable, insert, findOne, findMany, update, remove, deleteTable, hasTable, beginTransaction, commit, rollback } from '../../expo-lite-data-store';

// 模拟 expo-secure-store
const mockGetItemAsync = jest.fn().mockResolvedValue('mock-encrypted-key');
const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);
const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => mockGetItemAsync(),
  setItemAsync: jest.fn((key, value) => mockSetItemAsync(key, value)),
  deleteItemAsync: jest.fn((key) => mockDeleteItemAsync(key)),
}));




describe('Enhanced Biometric Authentication Tests', () => {
  const ENCRYPTED_TABLE = 'biometric_encrypted_table';
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

  describe('Biometric Authentication with requireAuthOnAccess', () => {
    it('should support createTable with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(await hasTable(ENCRYPTED_TABLE, { encrypted: true, requireAuthOnAccess: true })).toBe(true);
      await deleteTable(ENCRYPTED_TABLE, { encrypted: true, requireAuthOnAccess: true });
    });

    it('should support insert with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      const result = await insert(ENCRYPTED_TABLE, TEST_DATA[0], { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      // WriteResult包含written属性表示写入的字节数，成功写入应该大于0
      expect(result.written).toBeGreaterThan(0);
    });

    it('should support findOne with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      const user = await findOne(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(user).not.toBeNull();
      expect(user?.id).toBe(1);
    });

    it('should support findMany with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      const users = await findMany(ENCRYPTED_TABLE, { 
        where: { active: true }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(users.length).toBe(2);
    });

    it('should support update with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA[0], { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      const result = await update(ENCRYPTED_TABLE, 
        { age: 26 }, 
        { 
          where: { id: 1 }, 
          encrypted: true, 
          requireAuthOnAccess: true 
        }
      );
      expect(result).toBe(1);
      const updatedUser = await findOne(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(updatedUser?.age).toBe(26);
    });

    it('should support remove with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      const result = await remove(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(result).toBe(1);
      const users = await findMany(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(users.length).toBe(2);
    });

    it('should support transactions with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      
      // 开始事务
      await beginTransaction({ encrypted: true, requireAuthOnAccess: true });
      
      // 在事务中执行操作
      await insert(ENCRYPTED_TABLE, TEST_DATA[0], { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await update(ENCRYPTED_TABLE, 
        { age: 26 }, 
        { 
          where: { id: 1 }, 
          encrypted: true, 
          requireAuthOnAccess: true 
        }
      );
      
      // 提交事务
      await commit({ encrypted: true, requireAuthOnAccess: true });
      
      // 验证结果
      const user = await findOne(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(user?.age).toBe(26);
    });

    it('should support rollback with requireAuthOnAccess true', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA[0], { 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      
      // 开始事务
      await beginTransaction({ encrypted: true, requireAuthOnAccess: true });
      
      // 在事务中执行操作
      await update(ENCRYPTED_TABLE, 
        { age: 99 }, 
        { 
          where: { id: 1 }, 
          encrypted: true, 
          requireAuthOnAccess: true 
        }
      );
      
      // 回滚事务
      await rollback({ encrypted: true, requireAuthOnAccess: true });
      
      // 验证结果
      const user = await findOne(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: true 
      });
      expect(user?.age).toBe(25); // 应该保持原始值
    });

    it('should work correctly when requireAuthOnAccess is false', async () => {
      await createTable(ENCRYPTED_TABLE, { 
        encrypted: true, 
        requireAuthOnAccess: false 
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA[0], { 
        encrypted: true, 
        requireAuthOnAccess: false 
      });
      const user = await findOne(ENCRYPTED_TABLE, { 
        where: { id: 1 }, 
        encrypted: true, 
        requireAuthOnAccess: false 
      });
      expect(user).not.toBeNull();
      expect(user?.id).toBe(1);
    });
  });
});
