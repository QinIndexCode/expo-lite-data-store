// src/core/data/__tests__/DataReader.test.ts
// DataReader 单元测试

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';

import { IndexManager } from '../../index/IndexManager';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { MetadataManager } from '../../meta/MetadataManager';
import { DataReader } from '../DataReader';

describe('DataReader', () => {
  let dataReader: DataReader;
  let metadataManager: MetadataManager;
  let cacheManager: CacheManager;
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    if ((global as any).__expo_file_system_mock__) {
      (global as any).__expo_file_system_mock__.mockFileSystem = {};
    }

    // 创建新的实例用于每个测试
    metadataManager = new MetadataManager();
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 100,
      defaultExpiry: 3600000,
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
    });
    indexManager = new IndexManager(metadataManager);

    dataReader = new DataReader(metadataManager, indexManager, cacheManager);

    // 清除测试表元数据
    metadataManager.delete(testTableName);
  });

  afterEach(done => {
    // 清理定时器，防止测试挂起
    if (cacheManager) {
      cacheManager.cleanup();
    }
    if (metadataManager) {
      metadataManager.cleanup();
    }
    // 使用 process.nextTick 而不是 setTimeout，避免阻塞
    process.nextTick(() => {
      done();
    });
  });

  describe('read', () => {
    it('should be able to read data from non-existent table, return empty array', async () => {
      const result = await dataReader.read('non_existent_table');
      expect(result).toEqual([]);
    });

    it('should recover single-file data when metadata is missing', async () => {
      const handler = new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb');
      const testData = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];

      await handler.write(testData);
      metadataManager.delete(testTableName);

      const result = await dataReader.read(testTableName);

      expect(result).toEqual(testData);
      expect(metadataManager.get(testTableName)).toMatchObject({
        mode: 'single',
        path: 'test_table.ldb',
        count: 2,
      });
    });

    it('should reject corrupted single-file data when metadata is missing', async () => {
      if ((global as any).__expo_file_system_mock__) {
        (global as any).__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/test_table.ldb'] =
          JSON.stringify({
            data: [{ id: '1', name: 'Broken' }],
            hash: 'not-a-real-hash',
          });
      }

      metadataManager.delete(testTableName);

      await expect(dataReader.read(testTableName)).rejects.toBeDefined();
      expect(metadataManager.get(testTableName)).toBeUndefined();
    });

    it('should be able to read data from existing table', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.read(testTableName);
      expect(result).toEqual([]);
    });

    it('should be able to query data with filter conditions', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Here we simulate data reading, actual data would be read from file system
      // Since we're using mock, it returns empty array
      const result = await dataReader.read(testTableName, {
        filter: { age: { $gt: 18 } },
      });
      expect(result).toEqual([]);
    });

    it('should apply every filter condition after narrowing results with an index', async () => {
      const records = [
        { id: '1', team: 'alpha', active: true },
        { id: '2', team: 'alpha', active: false },
        { id: '3', team: 'beta', active: true },
      ];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { id: 'string', team: 'string', active: 'boolean' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);
      await indexManager.createIndex(testTableName, 'team');
      records.forEach(record => indexManager.addToIndex(testTableName, record));
      const queryIndexSpy = jest.spyOn(indexManager, 'queryIndex');

      try {
        const result = await dataReader.read(testTableName, {
          filter: { team: 'alpha', active: true },
          bypassCache: true,
        });

        expect(queryIndexSpy).toHaveBeenCalledWith(testTableName, 'team', 'alpha');
        expect(result).toEqual([{ id: '1', team: 'alpha', active: true }]);
      } finally {
        queryIndexSpy.mockRestore();
      }
    });

    it('should not cache function filters with each other or with an unfiltered read', async () => {
      const records = [
        { id: '1', team: 'alpha' },
        { id: '2', team: 'beta' },
      ];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { id: 'string', team: 'string' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);

      const alpha = await dataReader.read(testTableName, {
        filter: (item: Record<string, any>) => item.team === 'alpha',
      });
      const beta = await dataReader.read(testTableName, {
        filter: (item: Record<string, any>) => item.team === 'beta',
      });
      const unfiltered = await dataReader.read(testTableName);

      expect(alpha).toEqual([{ id: '1', team: 'alpha' }]);
      expect(beta).toEqual([{ id: '2', team: 'beta' }]);
      expect(unfiltered).toEqual(records);
    });

    it('keeps cached records isolated from callers on cache fill and cache hits', async () => {
      const records = [{ id: '1', profile: { name: 'Alice' } }];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { id: 'string', profile: 'blob' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);

      const initialRead = await dataReader.read(testTableName);
      initialRead[0].profile.name = 'changed-before-cache-hit';
      initialRead.push({ id: '2', profile: { name: 'Injected' } });

      const cachedRead = await dataReader.read(testTableName);
      expect(cachedRead).toEqual(records);
      expect(cachedRead).not.toBe(initialRead);
      expect(cachedRead[0]).not.toBe(initialRead[0]);
      expect(cachedRead[0].profile).not.toBe(initialRead[0].profile);

      cachedRead[0].profile.name = 'changed-from-cache-hit';

      const nextCachedRead = await dataReader.read(testTableName);
      expect(nextCachedRead).toEqual(records);
      expect(nextCachedRead[0]).not.toBe(cachedRead[0]);
      expect(nextCachedRead[0].profile).not.toBe(cachedRead[0].profile);
    });

    it('should be able to query data with pagination', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.read(testTableName, {
        skip: 0,
        limit: 10,
      });
      expect(result).toEqual([]);
    });

    it('should be able to bypass cache when querying data', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.read(testTableName, {
        bypassCache: true,
      });
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should be able to find non-existent record, return null', async () => {
      const result = await dataReader.findOne(testTableName, { id: 'non_existent_id' });
      expect(result).toBeNull();
    });

    it('should be able to find existing record', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.findOne(testTableName, { id: 'test_id' });
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('should be able to find multiple records', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.findMany(testTableName, {
        name: 'test_name',
      });
      expect(result).toEqual([]);
    });

    it('should be able to find multiple records with pagination', async () => {
      // Create table metadata first
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = await dataReader.findMany(
        testTableName,
        {
          name: 'test_name',
        },
        {
          skip: 0,
          limit: 10,
        }
      );
      expect(result).toEqual([]);
    });
  });
});
