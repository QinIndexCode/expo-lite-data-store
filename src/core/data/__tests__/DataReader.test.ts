/// <reference path="../../../__tests__/test-globals.d.ts" />

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { IndexManager } from '../../index/IndexManager';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { MetadataManager } from '../../meta/MetadataManager';
import type { StorageRecord } from '../../../types/storageTypes';
import logger from '../../../utils/logger';
import { DataReader } from '../DataReader';

describe('DataReader', () => {
  let dataReader: DataReader;
  let metadataManager: MetadataManager;
  let cacheManager: CacheManager;
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }

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

    metadataManager.delete(testTableName);
  });

  afterEach(() => {
    if (cacheManager) {
      cacheManager.cleanup();
    }
    if (metadataManager) {
      metadataManager.cleanup();
    }
    jest.restoreAllMocks();
  });

  describe('read', () => {
    it('returns an empty array for a nonexistent table', async () => {
      const result = await dataReader.read('non_existent_table');
      expect(result).toEqual([]);
    });

    it('recovers single-file data when metadata is missing', async () => {
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

    it('rejects corrupted single-file data when metadata is missing', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/test_table.ldb'] =
          JSON.stringify({
            data: [{ id: '1', name: 'Broken' }],
            hash: 'not-a-real-hash',
          });
      }

      metadataManager.delete(testTableName);

      await expect(dataReader.read(testTableName)).rejects.toBeDefined();
      expect(metadataManager.get(testTableName)).toBeUndefined();
    });

    it('reads data from an existing table', async () => {
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

    it('filters data with query conditions', async () => {
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

      const result = await dataReader.read(testTableName, {
        filter: { age: { $gt: 18 } },
      });
      expect(result).toEqual([]);
    });

    it('applies every filter condition after narrowing results with an index', async () => {
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

    it('does not share cached results between function filters and unfiltered reads', async () => {
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
        filter: (item: StorageRecord) => item.team === 'alpha',
      });
      const beta = await dataReader.read(testTableName, {
        filter: (item: StorageRecord) => item.team === 'beta',
      });
      const unfiltered = await dataReader.read(testTableName);

      expect(alpha).toEqual([{ id: '1', team: 'alpha' }]);
      expect(beta).toEqual([{ id: '2', team: 'beta' }]);
      expect(unfiltered).toEqual(records);
    });

    it('keeps cached records isolated from callers on cache fill and cache hits', async () => {
      type ProfileRecord = { id: string; profile: { name: string } };
      const records: ProfileRecord[] = [{ id: '1', profile: { name: 'Alice' } }];
      const readProfileRecords = async (): Promise<ProfileRecord[]> =>
        (await dataReader.read(testTableName)) as unknown as ProfileRecord[];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { id: 'string', profile: 'blob' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);

      const initialRead = await readProfileRecords();
      initialRead[0].profile.name = 'changed-before-cache-hit';
      initialRead.push({ id: '2', profile: { name: 'Injected' } });

      const cachedRead = await readProfileRecords();
      expect(cachedRead).toEqual(records);
      expect(cachedRead).not.toBe(initialRead);
      expect(cachedRead[0]).not.toBe(initialRead[0]);
      expect(cachedRead[0].profile).not.toBe(initialRead[0].profile);

      cachedRead[0].profile.name = 'changed-from-cache-hit';

      const nextCachedRead = await readProfileRecords();
      expect(nextCachedRead).toEqual(records);
      expect(nextCachedRead[0]).not.toBe(cachedRead[0]);
      expect(nextCachedRead[0].profile).not.toBe(cachedRead[0].profile);
    });

    it('paginates queried data', async () => {
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

    it('bypasses cached data for a query', async () => {
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
    it('returns null for a nonexistent record', async () => {
      const result = await dataReader.findOne(testTableName, { id: 'non_existent_id' });
      expect(result).toBeNull();
    });

    it('finds an existing record', async () => {
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
    it('finds multiple records', async () => {
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

    it('paginates multiple matching records', async () => {
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
