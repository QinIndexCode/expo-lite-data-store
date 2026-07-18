import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { FileOperationManager } from '../../FileOperationManager';
import { ChunkedFileHandler } from '../../file/ChunkedFileHandler';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { IndexManager } from '../../index/IndexManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { getRootPathSync } from '../../../utils/ROOTPath';
import logger from '../../../utils/logger';
import type { StorageRecord } from '../../../types/storageTypes';
import { DataWriter } from '../DataWriter';

type DataWriterPrivateAccess = {
  countValidationInFlight: Map<string, Promise<void>>;
};

type ChunkedFileHandlerPrivateAccess = {
  writeOverwriteJournal: (previousData: StorageRecord[], targetData: StorageRecord[]) => Promise<void>;
};

const getDataWriterPrivateAccess = (writer: DataWriter): DataWriterPrivateAccess =>
  writer as unknown as DataWriterPrivateAccess;

const getChunkedFileHandlerPrivateAccess = (handler: ChunkedFileHandler): ChunkedFileHandlerPrivateAccess =>
  handler as unknown as ChunkedFileHandlerPrivateAccess;

const mockPendingSingleFileRead = () => {
  let resolveRead!: (data: StorageRecord[]) => void;
  let signalReadStarted!: () => void;
  const pendingRead = new Promise<StorageRecord[]>(resolve => {
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

    metadataManager.delete(testTableName);
  });

  afterEach(() => {
    cacheManager.cleanup();
    metadataManager.cleanup();
  });

  describe('createTable', () => {
    it('creates a new table', async () => {
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

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('single');
      expect(tableMeta?.count).toBe(2);
    });

    it('creates a chunked table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'chunked',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('chunked');
    });
  });

  describe('write', () => {
    it('writes data to an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.write(testTableName, {
        id: '1',
        name: 'test',
        age: 20,
      });

      expect(result).toBeDefined();
      expect(result.written).toBe(1);
      expect(result.totalAfterWrite).toBe(1);
    });

    it('batch writes data to an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.write(testTableName, [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
        { id: '3', name: 'test3', age: 30 },
      ]);

      expect(result).toBeDefined();
      expect(result.written).toBe(3);
      expect(result.totalAfterWrite).toBe(3);
    });

    it('serializes concurrent writes to the same table without losing records', async () => {
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

    it('appends to a chunked table without reading the entire table first', async () => {
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
        await expect(
          dataWriter.write(tableName, { id: 'new', value: 'not-published' }, { forceChunked: true })
        ).rejects.toMatchObject({
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
    it('deletes matching data from a table', async () => {
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

      const result = await dataWriter.delete(testTableName, { age: { $gt: 25 } });

      expect(result).toBe(1);
    });

    it('deletes all matching data', async () => {
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

      const result = await dataWriter.delete(testTableName, {});

      expect(result).toBe(3);
    });
  });

  describe('count', () => {
    it('returns a table record count', async () => {
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

      const count = await dataWriter.count(testTableName);

      expect(count).toBe(2);
    });

    it('returns the metadata count before background validation completes', async () => {
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

        const validations = getDataWriterPrivateAccess(dataWriter).countValidationInFlight;
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

    it('deduplicates concurrent background count validations per table', async () => {
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

        const validations = getDataWriterPrivateAccess(dataWriter).countValidationInFlight;
        const validation = validations.get(testTableName);
        expect(validation).toBeDefined();

        pendingRead.resolveRead(records);
        await validation;
      } finally {
        pendingRead.resolveRead(records);
        pendingRead.restore();
      }
    });

    it('returns zero records for a nonexistent table', async () => {
      const count = await dataWriter.count('non_existent_table');

      expect(count).toBe(0);
    });
  });

  describe('verifyCount', () => {
    it('returns metadata and actual counts separately and repairs metadata drift', async () => {
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
    it('deletes an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      await dataWriter.deleteTable(testTableName);

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeUndefined();
    });

    it('does not throw when deleting a nonexistent table', async () => {
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
      await getChunkedFileHandlerPrivateAccess(handler).writeOverwriteJournal(
        [{ id: 'deleted', value: 'old-data' }],
        [{ id: 'next' }]
      );

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
    it('returns true for an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.hasTable(testTableName);

      expect(result).toBe(true);
    });

    it('returns false for a nonexistent table', async () => {
      const result = await dataWriter.hasTable('non_existent_table');

      expect(result).toBe(false);
    });
  });
});
