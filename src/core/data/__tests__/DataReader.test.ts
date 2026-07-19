/// <reference path="../../../__tests__/test-globals.d.ts" />

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { FileHandlerBase } from '../../file/FileHandlerBase';
import { IndexManager } from '../../index/IndexManager';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { MetadataManager } from '../../meta/MetadataManager';
import type { StorageRecord } from '../../../types/storageTypes';
import logger from '../../../utils/logger';
import { QueryEngine } from '../../query/QueryEngine';
import { DataReader } from '../DataReader';
import { DataWriter } from '../DataWriter';

const pauseNextSingleFileRead = () => {
  const originalRead = SingleFileHandler.prototype.read;
  let signalReadStarted!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>(resolve => {
    signalReadStarted = resolve;
  });
  const readGate = new Promise<void>(resolve => {
    releaseRead = resolve;
  });
  const readSpy = jest.spyOn(SingleFileHandler.prototype, 'read').mockImplementationOnce(async function (
    this: SingleFileHandler
  ) {
    signalReadStarted();
    await readGate;
    return originalRead.call(this);
  });

  return {
    readStarted,
    release: releaseRead,
    restore: () => readSpy.mockRestore(),
  };
};

describe('DataReader', () => {
  let dataReader: DataReader;
  let metadataManager: MetadataManager;
  let cacheManager: CacheManager;
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    FileHandlerBase.invalidateFileInfoCache();
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

    await metadataManager.waitForLoad();
    metadataManager.delete(testTableName);
    await metadataManager.saveImmediately();
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

    it('does not resurrect orphaned single-file data when metadata is missing', async () => {
      const handler = new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb');
      const testData = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];

      await handler.write(testData);
      metadataManager.delete(testTableName);
      await metadataManager.saveImmediately();

      const result = await dataReader.read(testTableName);

      expect(result).toEqual([]);
      expect(metadataManager.get(testTableName)).toBeUndefined();

      const reloadedMetadata = new MetadataManager();
      const reloadedCache = new CacheManager({ enableAvalancheProtection: false });
      try {
        await reloadedMetadata.waitForLoad();
        const reloadedReader = new DataReader(reloadedMetadata, new IndexManager(reloadedMetadata), reloadedCache);
        await expect(reloadedReader.read(testTableName)).resolves.toEqual([]);
      } finally {
        reloadedCache.cleanup();
        reloadedMetadata.cleanup();
      }
    });

    it('does not inspect corrupted orphan data when metadata is missing', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/test_table.ldb'] =
          JSON.stringify({
            data: [{ id: '1', name: 'Broken' }],
            hash: 'not-a-real-hash',
          });
      }

      metadataManager.delete(testTableName);

      await expect(dataReader.read(testTableName)).resolves.toEqual([]);
      expect(metadataManager.get(testTableName)).toBeUndefined();
    });

    it('reroutes a paused single-file read after another manager commits a chunked migration', async () => {
      const tableName = 'paused_read_chunk_migration_table';
      const writer = new DataWriter(metadataManager, indexManager);
      const secondMetadata = new MetadataManager();
      const secondCache = new CacheManager({ enableAvalancheProtection: false });
      let pausedRead: ReturnType<typeof pauseNextSingleFileRead> | undefined;

      try {
        const records = [{ id: 'preserved-across-migration' }];
        await writer.createTable(tableName, { mode: 'single', initialData: records });
        await secondMetadata.waitForLoad();
        const secondReader = new DataReader(secondMetadata, new IndexManager(secondMetadata), secondCache);
        pausedRead = pauseNextSingleFileRead();

        try {
          const pendingRead = secondReader.read(tableName, { bypassCache: true });
          await pausedRead.readStarted;
          await writer.migrateToChunked(tableName);
          pausedRead.release();

          await expect(pendingRead).resolves.toEqual(records);
          expect(secondMetadata.get(tableName)?.mode).toBe('chunked');
        } finally {
          pausedRead.release();
          pausedRead.restore();
        }
      } finally {
        pausedRead?.release();
        secondCache.cleanup();
        secondMetadata.cleanup();
        await writer.deleteTable(tableName);
      }
    });

    it('invalidates stale record and index caches after another manager writes', async () => {
      const tableName = 'cross_manager_reader_cache_table';
      const writer = new DataWriter(metadataManager, indexManager);
      const secondMetadata = new MetadataManager();
      const secondCache = new CacheManager({ enableAvalancheProtection: false });

      try {
        const initialRecords = [{ id: 'alpha', team: 'alpha' }];
        await writer.createTable(tableName, { mode: 'single', initialData: initialRecords });
        await secondMetadata.waitForLoad();
        const secondIndex = new IndexManager(secondMetadata);
        const secondReader = new DataReader(secondMetadata, secondIndex, secondCache);
        await secondIndex.createIndex(tableName, 'team');
        secondIndex.rebuildIndexes(tableName, initialRecords);
        await secondMetadata.saveImmediately();

        await expect(secondReader.read(tableName, { filter: { team: 'beta' } })).resolves.toEqual([]);
        expect(secondIndex.hasIndex(tableName, 'team')).toBe(true);

        await writer.write(tableName, { id: 'beta', team: 'beta' });

        await expect(secondReader.read(tableName, { filter: { team: 'beta' } })).resolves.toEqual([
          { id: 'beta', team: 'beta' },
        ]);
        expect(secondIndex.hasIndex(tableName, 'team')).toBe(false);
      } finally {
        secondCache.cleanup();
        secondMetadata.cleanup();
        await writer.deleteTable(tableName);
      }
    });

    it('retries a same-mode indexed read when another manager overwrites the table', async () => {
      const tableName = 'cross_manager_same_mode_overwrite_table';
      const writer = new DataWriter(metadataManager, indexManager);
      const secondMetadata = new MetadataManager();
      const secondCache = new CacheManager({ enableAvalancheProtection: false });
      let pausedRead: ReturnType<typeof pauseNextSingleFileRead> | undefined;

      try {
        const initialRecords = [{ id: 'old', team: 'alpha' }];
        await writer.createTable(tableName, { mode: 'single', initialData: initialRecords });
        await secondMetadata.waitForLoad();
        const secondIndex = new IndexManager(secondMetadata);
        const secondReader = new DataReader(secondMetadata, secondIndex, secondCache);
        await secondIndex.createIndex(tableName, 'team');
        secondIndex.rebuildIndexes(tableName, initialRecords);
        await secondMetadata.saveImmediately();
        pausedRead = pauseNextSingleFileRead();

        const pendingRead = secondReader.read(tableName, {
          filter: { team: 'alpha' },
          bypassCache: true,
        });
        await pausedRead.readStarted;
        await writer.write(
          tableName,
          [
            { id: 'old', team: 'beta' },
            { id: 'new', team: 'alpha' },
          ],
          { mode: 'overwrite' }
        );
        pausedRead.release();

        await expect(pendingRead).resolves.toEqual([{ id: 'new', team: 'alpha' }]);
        expect(secondIndex.hasIndex(tableName, 'team')).toBe(false);
      } finally {
        pausedRead?.release();
        pausedRead?.restore();
        secondCache.cleanup();
        secondMetadata.cleanup();
        await writer.deleteTable(tableName);
      }
    });

    it('retries a same-mode indexed read when another manager recreates the table', async () => {
      const tableName = 'cross_manager_same_mode_recreate_table';
      const writer = new DataWriter(metadataManager, indexManager);
      const secondMetadata = new MetadataManager();
      const secondCache = new CacheManager({ enableAvalancheProtection: false });
      let pausedRead: ReturnType<typeof pauseNextSingleFileRead> | undefined;

      try {
        const initialRecords = [{ id: 'old', team: 'alpha' }];
        await writer.createTable(tableName, { mode: 'single', initialData: initialRecords });
        await secondMetadata.waitForLoad();
        const secondIndex = new IndexManager(secondMetadata);
        const secondReader = new DataReader(secondMetadata, secondIndex, secondCache);
        await secondIndex.createIndex(tableName, 'team');
        secondIndex.rebuildIndexes(tableName, initialRecords);
        await secondMetadata.saveImmediately();
        pausedRead = pauseNextSingleFileRead();

        const pendingRead = secondReader.read(tableName, {
          filter: { team: 'alpha' },
          bypassCache: true,
        });
        await pausedRead.readStarted;
        await writer.deleteTable(tableName);
        await writer.createTable(tableName, {
          mode: 'single',
          initialData: [{ id: 'new', team: 'alpha' }],
        });
        pausedRead.release();

        await expect(pendingRead).resolves.toEqual([{ id: 'new', team: 'alpha' }]);
        expect(secondIndex.hasIndex(tableName, 'team')).toBe(false);
      } finally {
        pausedRead?.release();
        pausedRead?.restore();
        secondCache.cleanup();
        secondMetadata.cleanup();
        await writer.deleteTable(tableName);
      }
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
      indexManager.rebuildIndexes(testTableName, records);
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

    it('falls back to full filtering when an indexed field includes a row without id or _id', async () => {
      const records = [{ id: '1', team: 'alpha' }, { team: 'alpha' }, { id: '3', team: 'beta' }];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { id: 'string', team: 'string' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);
      await indexManager.createIndex(testTableName, 'team');
      indexManager.rebuildIndexes(testTableName, records);
      const queryIndexSpy = jest.spyOn(indexManager, 'queryIndex');

      const result = await dataReader.read(testTableName, {
        filter: { team: 'alpha' },
        bypassCache: true,
      });

      expect(indexManager.hasIndex(testTableName, 'team')).toBe(false);
      expect(queryIndexSpy).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: '1', team: 'alpha' }, { team: 'alpha' }]);
    });

    it('narrows indexed results by _id when id is absent', async () => {
      const records = [
        { _id: 'legacy-1', team: 'alpha' },
        { _id: 'legacy-2', team: 'beta' },
      ];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: records.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: { _id: 'string', team: 'string' },
      });
      await new SingleFileHandler('/mock/documents/lite-data-store/test_table.ldb').write(records);
      await indexManager.createIndex(testTableName, 'team');
      indexManager.rebuildIndexes(testTableName, records);
      const queryIndexSpy = jest.spyOn(indexManager, 'queryIndex');

      const result = await dataReader.read(testTableName, {
        filter: { team: 'alpha' },
        bypassCache: true,
      });

      expect(queryIndexSpy).toHaveBeenCalledWith(testTableName, 'team', 'alpha');
      expect(result).toEqual([{ _id: 'legacy-1', team: 'alpha' }]);
    });

    it('skips full-table filtering when an index proves there are no matches', async () => {
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
      await indexManager.createIndex(testTableName, 'team');
      indexManager.rebuildIndexes(testTableName, records);
      const filterSpy = jest.spyOn(QueryEngine, 'filter');

      const result = await dataReader.read(testTableName, {
        filter: { team: 'missing' },
        bypassCache: true,
      });

      expect(result).toEqual([]);
      expect(filterSpy).toHaveBeenCalledWith([], { team: 'missing' });
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
