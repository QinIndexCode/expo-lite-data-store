// src/core/data/__tests__/DataWriter.test.ts
// DataWriter 单元测试

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { FileOperationManager } from '../../FileOperationManager';
import { ChunkedFileHandler } from '../../file/ChunkedFileHandler';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { IndexManager } from '../../index/IndexManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { getRootPathSync } from '../../../utils/ROOTPath';
import logger from '../../../utils/logger';
import { DataWriter } from '../DataWriter';

const mockPendingSingleFileRead = () => {
  let resolveRead!: (data: Record<string, any>[]) => void;
  let signalReadStarted!: () => void;
  const pendingRead = new Promise<Record<string, any>[]>(resolve => {
    resolveRead = resolve;
  });
  const readStarted = new Promise<void>(resolve => {
    signalReadStarted = resolve;
  });
  const readSpy = jest.spyOn(SingleFileHandler.prototype, 'read').mockImplementation(() => {
    signalReadStarted();
    return pendingRead;
  });

  return {
    readStarted,
    resolveRead,
    restore: () => readSpy.mockRestore(),
    getCallCount: () => readSpy.mock.calls.length,
  };
};

describe('DataWriter', () => {
  let dataWriter: DataWriter;
  let metadataManager: MetadataManager;
  let cacheManager: CacheManager;
  let indexManager: IndexManager;
  let fileOperationManager: FileOperationManager;
  const testTableName = 'test_table';

  beforeEach(() => {
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
    fileOperationManager = new FileOperationManager(8 * 1024 * 1024, metadataManager);

    dataWriter = new DataWriter(metadataManager, indexManager, fileOperationManager);

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

  describe('createTable', () => {
    it('should be able to create new table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
        ],
      });

      // Check if table was created successfully
      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('single');
      expect(tableMeta?.count).toBe(2);
    });

    it('should be able to create chunked table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'chunked',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Check if table was created successfully
      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('chunked');
    });
  });

  describe('write', () => {
    it('should be able to write data to existing table', async () => {
      // Create table first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Write data
      const result = await dataWriter.write(testTableName, {
        id: '1',
        name: 'test',
        age: 20,
      });

      // Check write result
      expect(result).toBeDefined();
      expect(result.written).toBe(1);
      expect(result.totalAfterWrite).toBe(1);
    });

    it('should be able to batch write data to existing table', async () => {
      // Create table first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Batch write data
      const result = await dataWriter.write(testTableName, [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
        { id: '3', name: 'test3', age: 30 },
      ]);

      // Check write result
      expect(result).toBeDefined();
      expect(result.written).toBe(3);
      expect(result.totalAfterWrite).toBe(3);
    });

    it('should serialize concurrent writes to the same table without losing records', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const writeResults = await Promise.all(
        Array.from({ length: 25 }).map((_, index) =>
          dataWriter.write(testTableName, {
            id: `concurrent-${index}`,
            name: `user-${index}`,
            age: index,
          })
        )
      );

      expect(writeResults.every(result => result.written === 1)).toBe(true);

      const verified = await dataWriter.verifyCount(testTableName);
      expect(verified).toEqual({
        metadata: 25,
        actual: 25,
        match: true,
      });

      const count = await dataWriter.count(testTableName);
      expect(count).toBe(25);
    });

    it('should append to a chunked table without reading the entire table first', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'chunked',
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const readAllSpy = jest.spyOn(ChunkedFileHandler.prototype, 'readAll');

      try {
        const result = await dataWriter.write(testTableName, { id: '1', name: 'test' });

        expect(result).toMatchObject({
          written: 1,
          totalAfterWrite: 1,
          chunked: true,
        });
        expect(readAllSpy).not.toHaveBeenCalled();
      } finally {
        readAllSpy.mockRestore();
      }
    });

    it('honors forceChunked by converting a single-file table under the write lock', async () => {
      const forceChunkedTable = 'force_chunked_table';
      await dataWriter.createTable(forceChunkedTable, {
        mode: 'single',
        initialData: [{ id: '1', name: 'before-migration' }],
      });

      try {
        const result = await dataWriter.write(
          forceChunkedTable,
          { id: '2', name: 'after-migration' },
          { forceChunked: true }
        );

        expect(result).toMatchObject({
          written: 1,
          totalAfterWrite: 2,
          chunked: true,
        });
        expect(metadataManager.get(forceChunkedTable)).toMatchObject({
          mode: 'chunked',
          path: `${forceChunkedTable}/`,
          count: 2,
        });
        await expect(new ChunkedFileHandler(forceChunkedTable, metadataManager).readAll()).resolves.toEqual([
          { id: '1', name: 'before-migration' },
          { id: '2', name: 'after-migration' },
        ]);
      } finally {
        await dataWriter.deleteTable(forceChunkedTable);
      }
    });

    it('does not publish a forced migration when source-file cleanup fails', async () => {
      const tableName = 'force_chunked_cleanup_failure_table';
      const rootPath = getRootPathSync();
      const sourceFilePath = `${rootPath}${tableName}.ldb`;
      const fileSystem = getFileSystem();

      await dataWriter.createTable(tableName, {
        mode: 'single',
        initialData: [{ id: 'source', value: 'still-authoritative' }],
      });

      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === sourceFilePath) {
          throw new Error('simulated source cleanup failure');
        }
        await deleteAsync(path, options);
      });

      try {
        await expect(dataWriter.write(tableName, { id: 'new', value: 'not-published' }, { forceChunked: true })).rejects.toMatchObject({
          code: 'FILE_WRITE_FAILED',
        });
        expect(metadataManager.get(tableName)).toMatchObject({ mode: 'single', count: 1 });
        await expect(new SingleFileHandler(sourceFilePath).read()).resolves.toEqual([
          { id: 'source', value: 'still-authoritative' },
        ]);
      } finally {
        deleteSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('delete', () => {
    it('should be able to delete data from table', async () => {
      // Create table and write data first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
          { id: '3', name: 'test3', age: 30 },
        ],
      });

      // Delete data
      const result = await dataWriter.delete(testTableName, { age: { $gt: 25 } });

      // Check delete result
      expect(result).toBe(1);
    });

    it('should be able to delete all matching data', async () => {
      // Create table and write data first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
          { id: '3', name: 'test3', age: 30 },
        ],
      });

      // Delete all data
      const result = await dataWriter.delete(testTableName, {});

      // Check delete result
      expect(result).toBe(3);
    });
  });

  describe('count', () => {
    it('should be able to get table record count', async () => {
      // Create table and write data first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
        ],
      });

      // Get table record count
      const count = await dataWriter.count(testTableName);

      // Check result
      expect(count).toBe(2);
    });

    it('should return metadata count before its background validation completes', async () => {
      const records = [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
      ];
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: { id: 'string', name: 'string', age: 'number' },
        initialData: records,
      });

      const pendingRead = mockPendingSingleFileRead();

      try {
        const countPromise = dataWriter.count(testTableName);
        await pendingRead.readStarted;

        let countResult: number | undefined;
        void countPromise.then(result => {
          countResult = result;
        });
        await Promise.resolve();

        expect(countResult).toBe(2);

        const validations = (dataWriter as unknown as { countValidationInFlight: Map<string, Promise<void>> })
          .countValidationInFlight;
        const validation = validations.get(testTableName);
        expect(validation).toBeDefined();

        pendingRead.resolveRead(records);
        await validation;
        await expect(countPromise).resolves.toBe(2);
      } finally {
        pendingRead.resolveRead(records);
        pendingRead.restore();
      }
    });

    it('should deduplicate concurrent background count validations per table', async () => {
      const records = [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
      ];
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: { id: 'string', name: 'string', age: 'number' },
        initialData: records,
      });

      const pendingRead = mockPendingSingleFileRead();

      try {
        const countPromises = [
          dataWriter.count(testTableName),
          dataWriter.count(testTableName),
          dataWriter.count(testTableName),
        ];
        await pendingRead.readStarted;

        expect(pendingRead.getCallCount()).toBe(1);
        await expect(Promise.all(countPromises)).resolves.toEqual([2, 2, 2]);

        const validations = (dataWriter as unknown as { countValidationInFlight: Map<string, Promise<void>> })
          .countValidationInFlight;
        const validation = validations.get(testTableName);
        expect(validation).toBeDefined();

        pendingRead.resolveRead(records);
        await validation;
      } finally {
        pendingRead.resolveRead(records);
        pendingRead.restore();
      }
    });

    it('should be able to get record count for non-existent table, return 0', async () => {
      // Get record count for non-existent table
      const count = await dataWriter.count('non_existent_table');

      // Check result
      expect(count).toBe(0);
    });
  });

  describe('verifyCount', () => {
    it('should return metadata and actual counts separately and repair metadata drift', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      await dataWriter.write(testTableName, [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      metadataManager.update(testTableName, { count: 99 });

      const result = await dataWriter.verifyCount(testTableName);

      expect(result).toEqual({
        metadata: 99,
        actual: 2,
        match: false,
      });
      expect(metadataManager.count(testTableName)).toBe(2);
    });
  });

  describe('deleteTable', () => {
    it('should be able to delete existing table', async () => {
      // Create table first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Delete table
      await dataWriter.deleteTable(testTableName);

      // Check if table was deleted successfully
      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeUndefined();
    });

    it('should be able to safely delete non-existent table', async () => {
      // Directly delete non-existent table, should not throw error
      await expect(dataWriter.deleteTable('non_existent_table')).resolves.not.toThrow();
    });

    it('keeps metadata and the authoritative table when stale migration cleanup fails', async () => {
      const tableName = 'delete_cleanup_failure_table';
      const rootPath = getRootPathSync();
      const staleSingleFilePath = `${rootPath}${tableName}.ldb`;
      const fileSystem = getFileSystem();

      await dataWriter.createTable(tableName, {
        mode: 'chunked',
        initialData: [{ id: 'current', value: 'authoritative' }],
      });
      await new SingleFileHandler(staleSingleFilePath).write([{ id: 'stale', value: 'residual' }]);

      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === staleSingleFilePath) {
          throw new Error('simulated stale-file cleanup failure');
        }
        await deleteAsync(path, options);
      });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      try {
        await expect(dataWriter.deleteTable(tableName)).rejects.toMatchObject({ code: 'TABLE_DELETE_FAILED' });
        expect(metadataManager.get(tableName)).toMatchObject({ mode: 'chunked', count: 1 });
        await expect(new ChunkedFileHandler(tableName, metadataManager).readAll()).resolves.toEqual([
          { id: 'current', value: 'authoritative' },
        ]);
        await expect(fileSystem.getInfoAsync(staleSingleFilePath)).resolves.toMatchObject({ exists: true });
      } finally {
        errorSpy.mockRestore();
        deleteSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('purges pending chunk journals so deleted data cannot reappear after a same-name recreation', async () => {
      const tableName = 'delete_journal_cleanup_table';
      const rootPath = getRootPathSync();
      const journalPaths = [
        `${rootPath}${tableName}.overwrite-journal`,
        `${rootPath}${tableName}.overwrite-journal.tmp`,
        `${rootPath}${tableName}.append-journal`,
        `${rootPath}${tableName}.append-journal.tmp`,
      ];
      const handler = new ChunkedFileHandler(tableName, metadataManager);

      await dataWriter.createTable(tableName, {
        mode: 'chunked',
        initialData: [{ id: 'deleted', value: 'old-data' }],
      });
      await (handler as any).writeOverwriteJournal([{ id: 'deleted', value: 'old-data' }], [{ id: 'next' }]);

      try {
        await dataWriter.deleteTable(tableName);

        for (const journalPath of journalPaths) {
          await expect(getFileSystem().getInfoAsync(journalPath)).resolves.toMatchObject({ exists: false });
        }

        await dataWriter.createTable(tableName, {
          mode: 'chunked',
          initialData: [{ id: 'replacement', value: 'new-data' }],
        });
        await expect(new ChunkedFileHandler(tableName, metadataManager).readAll()).resolves.toEqual([
          { id: 'replacement', value: 'new-data' },
        ]);
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('hasTable', () => {
    it('should be able to check existing table, return true', async () => {
      // Create table first
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      // Check if table exists
      const result = await dataWriter.hasTable(testTableName);

      // Check result
      expect(result).toBe(true);
    });

    it('should be able to check non-existent table, return false', async () => {
      // Check non-existent table
      const result = await dataWriter.hasTable('non_existent_table');

      // Check result
      expect(result).toBe(false);
    });
  });
});
