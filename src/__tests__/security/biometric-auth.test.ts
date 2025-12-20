// src/__tests__/security/biometric-auth.test.ts
// 生物识别验证测试

import { createTable, insert, findOne, update, remove, deleteTable, hasTable } from '../../expo-lite-data-store';
import logger from '../../utils/logger';
// 模拟 expo-secure-store
const mockGetItemAsync = jest.fn((_key, options: any) => {
  // 当 requireAuthentication 为 true 时，模拟认证过程
  if (options?.requireAuthentication) {
    // 记录调用，用于测试断言
    logger.info(`SecureStore.getItemAsync called with requireAuthentication: ${options.requireAuthentication}`);
  }
  return Promise.resolve('mock-encrypted-key');
});
const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);
const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: any, options: any) => mockGetItemAsync(key, options),
  setItemAsync: (key: any, value: any, options: any) => mockSetItemAsync(key, value, options),
  deleteItemAsync: (key: any) => mockDeleteItemAsync(key),
}));

// 不直接模拟 expo-local-authentication，而是在测试中处理它可能不存在的情况
// 因为这个模块是可选依赖，可能在某些环境中不可用

describe('Biometric Authentication Tests', () => {
  const BIOMETRIC_TABLE = 'biometric_auth_table';
  const TEST_DATA = [
    { id: 1, name: 'Biometric User 1', age: 25, active: true },
    { id: 2, name: 'Biometric User 2', age: 30, active: false },
  ];

  beforeEach(async () => {
    if (await hasTable(BIOMETRIC_TABLE)) {
      await deleteTable(BIOMETRIC_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(BIOMETRIC_TABLE)) {
      await deleteTable(BIOMETRIC_TABLE);
    }
  });

  describe('Require Auth On Access Tests', () => {
    it('should create table with requireAuthOnAccess option', async () => {
      await createTable(BIOMETRIC_TABLE, {
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(await hasTable(BIOMETRIC_TABLE)).toBe(true);
    });

    it('should support basic CRUD operations with requireAuthOnAccess', async () => {
      // 创建表
      await createTable(BIOMETRIC_TABLE, {
        encrypted: true,
        requireAuthOnAccess: true
      });
      
      // 插入数据
      await insert(BIOMETRIC_TABLE, TEST_DATA, {
        encrypted: true,
        requireAuthOnAccess: true
      });
      
      // 查找单条数据
      const findResult = await findOne(BIOMETRIC_TABLE, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(findResult).toBeDefined();
      expect(findResult?.id).toBe(1);
      
      // 更新数据
      const updateCount = await update(BIOMETRIC_TABLE, { age: 26 }, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(updateCount).toBe(1);
      
      // 验证更新结果
      const updatedResult = await findOne(BIOMETRIC_TABLE, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(updatedResult?.age).toBe(26);
      
      // 删除数据
      const removeCount = await remove(BIOMETRIC_TABLE, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(removeCount).toBe(1);
      
      // 验证删除结果
      const deletedResult = await findOne(BIOMETRIC_TABLE, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: true
      });
      expect(deletedResult).toBeNull();
    });

    it('should work with requireAuthOnAccess false option', async () => {
      // 创建表
      await createTable(BIOMETRIC_TABLE, {
        encrypted: true,
        requireAuthOnAccess: false
      });
      
      // 插入数据
      await insert(BIOMETRIC_TABLE, TEST_DATA, {
        encrypted: true,
        requireAuthOnAccess: false
      });
      
      // 查找数据
      const result = await findOne(BIOMETRIC_TABLE, {
        where: { id: 1 },
        encrypted: true,
        requireAuthOnAccess: false
      });
      
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
    });
  });

  describe('Biometric Auth Basic Functionality', () => {
    it('should support basic operations with different requireAuthOnAccess settings', async () => {
      // 测试 requireAuthOnAccess: true
      await createTable(`${BIOMETRIC_TABLE}_auth`, {
        encrypted: true,
        requireAuthOnAccess: true
      });
      
      // 测试 requireAuthOnAccess: false
      await createTable(`${BIOMETRIC_TABLE}_no_auth`, {
        encrypted: true,
        requireAuthOnAccess: false
      });
      
      // 验证两个表都创建成功
      expect(await hasTable(`${BIOMETRIC_TABLE}_auth`)).toBe(true);
      expect(await hasTable(`${BIOMETRIC_TABLE}_no_auth`)).toBe(true);
    });
  });
});
