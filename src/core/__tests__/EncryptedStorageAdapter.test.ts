// src/core/__tests__/EncryptedStorageAdapter.test.ts
import { EncryptedStorageAdapter } from '../EncryptedStorageAdapter';
import { MetadataManager } from '../meta/MetadataManager';

describe('EncryptedStorageAdapter', () => {
  let adapter: EncryptedStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_encrypted_table';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = new EncryptedStorageAdapter();
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    try {
      await adapter.deleteTable(tableName);
    } catch (e) {
      // 忽略删除错误
    }
    if (metadataManager) {
      metadataManager.cleanup();
    }
  });

  describe('基本操作', () => {
    it('应该能够创建和检查表', async () => {
      const hasTable = await adapter.hasTable(tableName);
      expect(hasTable).toBe(true);
    });

    it('应该能够列出所有表', async () => {
      const tables = await adapter.listTables();
      expect(tables).toContain(tableName);
    });
  });

  describe('数据读写', () => {
    it('应该能够写入和读取加密数据', async () => {
      const testData = { id: 1, name: 'Alice', age: 25 };
      
      // 打印写入数据信息
      console.log(`[Test] 写入单条数据: 数据大小 = ${JSON.stringify(testData).length} 字节`);

      await adapter.overwrite(tableName, testData);
      const result = await adapter.read(tableName);
      
      // 打印读取结果信息
      console.log(`[Test] 读取单条数据: 数据条数 = ${result.length}, 数据大小 = ${JSON.stringify(result).length} 字节`);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(testData);
    });

    it('应该能够写入和读取加密数据数组', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      
      // 打印写入数据信息
      console.log(`[Test] 写入数据数组: 数据条数 = ${testData.length}, 数据大小 = ${JSON.stringify(testData).length} 字节`);

      await adapter.overwrite(tableName, testData);
      const result = await adapter.read(tableName);
      
      // 打印读取结果信息
      console.log(`[Test] 读取数据数组: 数据条数 = ${result.length}, 数据大小 = ${JSON.stringify(result).length} 字节`);

      expect(result.length).toBe(3);
      expect(result).toEqual(testData);
    });
  });

  describe('查询操作', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('应该能够通过findOne查找单条数据', async () => {
      const result = await adapter.findOne(tableName, { id: 1 });
      // 打印查询结果信息
      console.log(`[Test] findOne查询: 结果 = ${JSON.stringify(result)}, 数据大小 = ${JSON.stringify(result).length} 字节`);
      expect(result).toEqual({ id: 1, name: 'Alice', age: 25 });
    });

    it('应该能够通过findMany查找多条数据', async () => {
      const result = await adapter.findMany(tableName, { age: { $gt: 25 } });
      // 打印查询结果信息
      console.log(`[Test] findMany查询: 数据条数 = ${result.length}, 数据大小 = ${JSON.stringify(result).length} 字节`);
      expect(result.length).toBe(2);
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ]);
    });

    it('应该能够通过findMany进行分页', async () => {
      const result = await adapter.findMany(tableName, {}, { skip: 1, limit: 1 });
      // 打印分页查询结果信息
      console.log(`[Test] 分页查询: 数据条数 = ${result.length}, 数据大小 = ${JSON.stringify(result).length} 字节`);
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 2, name: 'Bob', age: 30 });
    });
  });

  describe('计数操作', () => {
    it('应该能够正确计数表中的数据', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];
      
      // 打印写入数据信息
      console.log(`[Test] 写入数据用于计数: 数据条数 = ${testData.length}, 数据大小 = ${JSON.stringify(testData).length} 字节`);

      await adapter.overwrite(tableName, testData);
      const count = await adapter.count(tableName);
      
      // 打印计数结果信息
      console.log(`[Test] 计数结果: 数据条数 = ${count}`);

      expect(count).toBe(2);
    });
  });

  describe('删除操作', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('应该能够根据条件删除数据', async () => {
      // 先获取删除前的数据
      const beforeDeleteData = await adapter.read(tableName);
      console.log(`[Test] 删除前数据: 数据条数 = ${beforeDeleteData.length}, 数据大小 = ${JSON.stringify(beforeDeleteData).length} 字节`);
      
      const deletedCount = await adapter.delete(tableName, { id: 1 });
      console.log(`[Test] 删除操作: 删除条数 = ${deletedCount}`);
      
      const remainingData = await adapter.read(tableName, { bypassCache: true });
      console.log(`[Test] 删除后数据: 数据条数 = ${remainingData.length}, 数据大小 = ${JSON.stringify(remainingData).length} 字节`);
      
      expect(deletedCount).toBe(1);
      expect(remainingData.length).toBe(2);
      expect(remainingData).not.toContainEqual({ id: 1, name: 'Alice', age: 25 });
    });
  });

  describe('批量操作', () => {
    it('应该能够执行批量插入操作', async () => {
      const operations = [
        { type: 'insert' as const, data: { id: 1, name: 'Alice' } },
        { type: 'insert' as const, data: { id: 2, name: 'Bob' } },
      ];
      
      console.log(`[Test] 批量插入: 操作条数 = ${operations.length}`);

      const result = await adapter.bulkWrite(tableName, operations);
      console.log(`[Test] 批量插入结果: 写入条数 = ${result.written}`);
      
      const allData = await adapter.read(tableName, { bypassCache: true });
      console.log(`[Test] 批量插入后数据: 数据条数 = ${allData.length}, 数据大小 = ${JSON.stringify(allData).length} 字节`);
      
      expect(result.written).toBe(2);
      expect(allData.length).toBe(2);
    });

    it('应该能够执行批量更新操作', async () => {
      // 先插入初始数据
      const initialData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];
      await adapter.overwrite(tableName, initialData);
      console.log(`[Test] 批量更新前数据: 数据条数 = ${initialData.length}, 数据大小 = ${JSON.stringify(initialData.length)} 字节`);

      const operations = [
        { type: 'update' as const, data: { age: 26 }, where: { id: 1 } },
        { type: 'update' as const, data: { age: 31 }, where: { id: 2 } },
      ];
      console.log(`[Test] 批量更新: 操作条数 = ${operations.length}`);

      const result = await adapter.bulkWrite(tableName, operations);
      console.log(`[Test] 批量更新结果: 更新条数 = ${result.written}`);

      const updatedData = await adapter.read(tableName, { bypassCache: true });
      console.log(`[Test] 批量更新后数据: 数据条数 = ${updatedData.length}, 数据大小 = ${JSON.stringify(updatedData).length} 字节`);
      
      expect(result.written).toBe(2);
      expect(updatedData[0]?.['age']).toBe(26);
      expect(updatedData[1]?.['age']).toBe(31);
    });

    it('应该能够执行批量删除操作', async () => {
      // 先插入初始数据
      const initialData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];
      await adapter.overwrite(tableName, initialData);
      console.log(`[Test] 批量删除前数据: 数据条数 = ${initialData.length}, 数据大小 = ${JSON.stringify(initialData).length} 字节`);

      const operations = [
        { type: 'delete' as const, where: { id: 1 } },
        { type: 'delete' as const, where: { id: 2 } },
      ];
      console.log(`[Test] 批量删除: 操作条数 = ${operations.length}`);

      const result = await adapter.bulkWrite(tableName, operations);
      console.log(`[Test] 批量删除结果: 删除条数 = ${result.written}`);

      const remainingData = await adapter.read(tableName, { bypassCache: true });
      console.log(`[Test] 批量删除后数据: 数据条数 = ${remainingData.length}, 数据大小 = ${JSON.stringify(remainingData).length} 字节`);
      
      expect(result.written).toBe(2);
      expect(remainingData.length).toBe(1);
      expect(remainingData[0]?.['id']).toBe(3);
    });
  });

  describe('模式迁移', () => {
    it('应该能够迁移到分片模式', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];
      
      console.log(`[Test] 迁移前数据: 数据条数 = ${testData.length}, 数据大小 = ${JSON.stringify(testData).length} 字节`);

      await adapter.overwrite(tableName, testData);
      await adapter.migrateToChunked(tableName);

      const migratedData = await adapter.read(tableName);
      console.log(`[Test] 迁移后数据: 数据条数 = ${migratedData.length}, 数据大小 = ${JSON.stringify(migratedData).length} 字节`);
      
      expect(migratedData).toEqual(testData);
    });
  });
});
