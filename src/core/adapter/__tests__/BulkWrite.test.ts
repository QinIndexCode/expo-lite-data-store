// src/core/adapter/__tests__/BulkWrite.test.ts
import { MetadataManager } from '../../meta/MetadataManager';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';

describe('FileSystemStorageAdapter - BulkWrite', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_bulk_write';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    console.log('[BulkWrite.test] afterEach: 开始清理');
    try {
      await adapter.deleteTable(tableName);
    } catch (e) {
      // 忽略删除错误
    }
    // 清理资源，防止测试挂起
    if (adapter && typeof (adapter as any).cleanup === 'function') {
      console.log('[BulkWrite.test] afterEach: 清理 FileSystemStorageAdapter');
      (adapter as any).cleanup();
    }
    if (metadataManager) {
      console.log('[BulkWrite.test] afterEach: 清理 MetadataManager');
      metadataManager.cleanup();
    }
    console.log('[BulkWrite.test] afterEach: 清理完成');
  });

  describe('批量插入操作', () => {
    it('应该能够批量插入多条数据', async () => {
      const operations = [
        { type: 'insert' as const, data: { id: 1, name: 'Alice' } },
        { type: 'insert' as const, data: { id: 2, name: 'Bob' } },
        { type: 'insert' as const, data: { id: 3, name: 'Charlie' } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3);
      expect(result.totalAfterWrite).toBe(3);

      const allData = await adapter.read(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.find((d: any) => d.id === 1)?.name).toBe('Alice');
    });

    it('应该能够批量插入数组数据', async () => {
      const operations = [
        {
          type: 'insert' as const,
          data: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);
      const allData = await adapter.read(tableName, { bypassCache: true });
      expect(allData.length).toBe(2);
    });
  });

  describe('批量更新操作', () => {
    beforeEach(async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 32, active: false },
      ]);
    });

    it('应该能够批量更新多条数据', async () => {
      const operations = [
        { type: 'update' as const, data: { id: 1, age: 26 } },
        { type: 'update' as const, data: { id: 2, age: 31 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const data1 = await adapter.findOne(tableName, { id: 1 });
      const data2 = await adapter.findOne(tableName, { id: 2 });

      expect(data1?.age).toBe(26);
      expect(data2?.age).toBe(31);
      expect(data1?.name).toBe('Alice'); // 其他字段保持不变
    });

    it('应该能够使用where条件批量更新多条数据', async () => {
      const operations = [
        { 
          type: 'update' as const, 
          data: { age: 40 }, 
          where: { active: true } 
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3); // 3个active=true的用户

      const activeUsers = await adapter.findMany(tableName, { active: true });
      expect(activeUsers.every((user: any) => user.age === 40)).toBe(true);
    });

    it('应该能够使用复杂where条件批量更新数据', async () => {
      const operations = [
        { 
          type: 'update' as const, 
          data: { name: 'Updated' }, 
          where: { $and: [{ age: { $gt: 25 } }, { active: false }] } 
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2); // Charlie和Eve符合条件

      const updatedUsers = await adapter.findMany(tableName, { name: 'Updated' });
      expect(updatedUsers.length).toBe(2);
      expect(updatedUsers.every((user: any) => user.age > 25 && user.active === false)).toBe(true);
    });

    it('应该能够更新不存在的记录而不报错', async () => {
      const operations = [{ type: 'update' as const, data: { id: 999, age: 99 } }];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(0);
    });
  });

  describe('批量删除操作', () => {
    beforeEach(async () => {
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 32, active: false },
      ]);
    });

    it('应该能够批量删除多条数据', async () => {
      const operations = [
        { type: 'delete' as const, data: { id: 1 } },
        { type: 'delete' as const, data: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const allData = await adapter.read(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.every((item: any) => item.id !== 1 && item.id !== 2)).toBe(true);
    });

    it('应该能够使用where条件批量删除多条数据', async () => {
      const operations = [
        { 
          type: 'delete' as const, 
          data: {}, 
          where: { active: false } 
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2); // 2个active=false的用户

      const allData = await adapter.read(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.every((item: any) => item.active === true)).toBe(true);
    });

    it('应该能够使用复杂where条件批量删除数据', async () => {
      const operations = [
        { 
          type: 'delete' as const, 
          data: {}, 
          where: { $or: [{ age: { $lt: 27 } }, { age: { $gt: 33 } }] } 
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2); // Alice(25)和Charlie(35)符合条件

      const remainingData = await adapter.read(tableName, { bypassCache: true });
      expect(remainingData.length).toBe(3);
      expect(remainingData.every((user: any) => user.age >= 27 && user.age <= 33)).toBe(true);
    });

    it('应该能够使用多条件组合删除数据', async () => {
      const operations = [
        { 
          type: 'delete' as const, 
          data: {}, 
          where: { $and: [{ name: 'Alice' }, { active: true }] } 
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(1); // Alice符合条件

      const remainingData = await adapter.read(tableName, { bypassCache: true });
      expect(remainingData.length).toBe(4);
      expect(remainingData.every((item: any) => item.name !== 'Alice')).toBe(true);
    });
  });

  describe('混合操作', () => {
    it('应该能够执行插入、更新、删除的混合操作', async () => {
      // 先插入一些初始数据
      await adapter.write(tableName, [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ]);

      const operations = [
        { type: 'insert' as const, data: { id: 3, name: 'Charlie', age: 35 } },
        { type: 'update' as const, data: { id: 1, age: 26 } },
        { type: 'delete' as const, data: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3);

      const allData = await adapter.read(tableName, { bypassCache: true });
      expect(allData.length).toBe(2);

      const alice = allData.find((d: any) => d.id === 1);
      const charlie = allData.find((d: any) => d.id === 3);

      expect(alice?.age).toBe(26);
      expect(charlie?.name).toBe('Charlie');
    });
  });

  describe('性能测试', () => {
    it('批量操作应该比单个操作更高效', async () => {
      const largeDataSet = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
        age: 20 + i,
      }));

      // 批量插入
      const startTime = Date.now();
      const operations = largeDataSet.map(item => ({
        type: 'insert' as const,
        data: item,
      }));
      await adapter.bulkWrite(tableName, operations);
      const bulkTime = Date.now() - startTime;

      // 清空表
      await adapter.deleteTable(tableName);
      await adapter.createTable(tableName);

      // 单个插入
      const startTime2 = Date.now();
      for (const item of largeDataSet) {
        await adapter.write(tableName, item);
      }
      const singleTime = Date.now() - startTime2;

      // 批量操作应该明显更快（至少快30%）
      expect(bulkTime).toBeLessThan(singleTime * 0.7);
    });
  });
});
