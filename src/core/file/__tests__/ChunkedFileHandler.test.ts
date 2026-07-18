/// <reference path="../../../__tests__/test-globals.d.ts" />

import { MetadataManager } from '../../meta/MetadataManager';
import { ChunkedFileHandler } from '../ChunkedFileHandler';
import logger from '../../../utils/logger';
import { configManager } from '../../config/ConfigManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import type { StorageRecord } from '../../../types/storageTypes';

type ChunkedFileHandlerPrivateAccess = {
  writeChunk: (index: number, data: StorageRecord[]) => Promise<void>;
  writeOverwriteJournal: (previousData: StorageRecord[], targetData: StorageRecord[]) => Promise<void>;
  writeAppendJournal: (
    previousCount: number,
    previousChunks: number,
    targetChunkIndices: number[],
    targetData: StorageRecord[]
  ) => Promise<void>;
};

const getChunkedFileHandlerPrivateAccess = (handler: ChunkedFileHandler): ChunkedFileHandlerPrivateAccess =>
  handler as unknown as ChunkedFileHandlerPrivateAccess;

const readMockFileText = (path: string): string => {
  const entry = global.__expo_file_system_mock__.mockFileSystem[path];
  if (typeof entry !== 'string') {
    throw new Error(`Expected a file at ${path}`);
  }
  return entry;
};

describe('ChunkedFileHandler', () => {
  let chunkedFileHandler: ChunkedFileHandler;
  const testTableName = 'test_chunked_table';
  const metadataManager = new MetadataManager();

  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    configManager.resetConfig();
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }

    chunkedFileHandler = new ChunkedFileHandler(testTableName, metadataManager);
  });

  afterEach(async () => {
    await chunkedFileHandler.clear();

    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
    configManager.resetConfig();
    jest.restoreAllMocks();
  });

  describe('basic behavior', () => {
    it('writes and reads records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual(testData);
    });

    it('appends records after existing data', async () => {
      const initialData = [{ id: 1, name: 'test1' }];
      const appendData = [
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      await chunkedFileHandler.write(initialData);

      await chunkedFileHandler.append(appendData);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([...initialData, ...appendData]);
    });

    it('clears persisted records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      await chunkedFileHandler.clear();

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('deletes persisted records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      await chunkedFileHandler.delete();

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });
  });

  describe('multi-chunk reads', () => {
    it('reads all records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readAll();

      expect(result).toEqual(testData);
    });

    it('reads a requested chunk range', async () => {
      // This fixture spans multiple chunks so the range boundary is exercised.
      const testData = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `test${i}` }));

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readRange(0, 0);

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('edge cases', () => {
    it('accepts an empty record set', async () => {
      await chunkedFileHandler.write([]);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('writes a large record set in one operation', async () => {
      // The payload size forces chunking without making the fixture unbounded.
      const testData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `test${i}`,
        data: `test data ${i}`.repeat(100),
      }));

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readAll();

      expect(result.length).toBe(testData.length);
      expect(result[0]).toEqual(testData[0]);
      expect(result[result.length - 1]).toEqual(testData[testData.length - 1]);
    });
  });

  describe('failure handling', () => {
    it('rejects a non-record write payload', async () => {
      const invalidData: unknown = 'invalid data';

      await expect(chunkedFileHandler.write(invalidData as StorageRecord[])).rejects.toThrow();
    });

    it('rejects a corrupted chunk instead of silently dropping its records', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const parsed = JSON.parse(readMockFileText(chunkPath));
      parsed.data[0].name = 'tampered';
      fileSystem[chunkPath] = JSON.stringify(parsed);

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('does not clear corrupted source data when an overwrite cannot take a snapshot', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[chunkPath] = '{corrupted';

      await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toMatchObject({
        code: 'CORRUPTED_DATA',
      });
      expect(fileSystem[chunkPath]).toBe('{corrupted');
    });

    it('restores previous data when a chunked overwrite fails', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let writeAttempts = 0;
      const writeSpy = jest
        .spyOn(handler, 'writeChunk')
        .mockImplementation(async (...args: Parameters<typeof handler.writeChunk>) => {
          writeAttempts++;
          if (writeAttempts === 1) {
            throw new Error('injected chunk write failure');
          }
          return originalWriteChunk(...args);
        });

      try {
        await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toThrow();
      } finally {
        writeSpy.mockRestore();
      }

      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('rejects non-serializable records without silently dropping them', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const circular: StorageRecord = { id: 2 };
      circular.self = circular;

      await expect(chunkedFileHandler.write([circular])).rejects.toThrow();
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('recovers previous data from a pending overwrite journal after an interrupted clear', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      await getChunkedFileHandlerPrivateAccess(chunkedFileHandler).writeOverwriteJournal(originalData, replacementData);
      await chunkedFileHandler.clear();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const journalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[journalPath]).toBeUndefined();
    });

    it('keeps completed replacement data when an overwrite journal is left behind', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      await getChunkedFileHandlerPrivateAccess(chunkedFileHandler).writeOverwriteJournal(originalData, replacementData);
      await chunkedFileHandler.clear();
      await chunkedFileHandler.append(replacementData);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(replacementData);
    });

    it('invalidates cached chunks after an overwrite', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);
      await chunkedFileHandler.readAll();

      await chunkedFileHandler.write([{ id: 2, name: 'replacement' }]);

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([{ id: 2, name: 'replacement' }]);
    });

    it('rejects a corrupted overwrite journal instead of guessing recovery state', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const journalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[journalPath] = '{corrupted';

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rolls back partial append chunks when a later chunk write fails', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      const originalData = [{ id: 1, name: 'original' }];
      const appendData = [
        { id: 2, payload: 'x'.repeat(300) },
        { id: 3, payload: 'y'.repeat(300) },
      ];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let appendWriteAttempts = 0;
      const writeSpy = jest
        .spyOn(handler, 'writeChunk')
        .mockImplementation(async (...args: Parameters<typeof handler.writeChunk>) => {
          appendWriteAttempts++;
          if (appendWriteAttempts === 2) {
            throw new Error('injected append chunk failure');
          }
          return originalWriteChunk(...args);
        });

      try {
        await expect(chunkedFileHandler.append(appendData)).rejects.toThrow();
      } finally {
        writeSpy.mockRestore();
      }

      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000002.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });

    it('rolls back completed append chunks when metadata was not committed before restart', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const appendData = [{ id: 2, name: 'interrupted' }];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await handler.writeAppendJournal(1, 1, [1], appendData);
      await handler.writeChunk(1, appendData);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });

    it('rejects a chunk set with a missing middle chunk', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      await chunkedFileHandler.write([
        { id: 1, payload: 'x'.repeat(300) },
        { id: 2, payload: 'y'.repeat(300) },
        { id: 3, payload: 'z'.repeat(300) },
      ]);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      delete fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb'];

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });
  });

  describe('chunk processing', () => {
    it('preserves record order across writes and appends', async () => {
      const batch1 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `batch1-${i}` }));
      const batch2 = Array.from({ length: 300 }, (_, i) => ({ id: 300 + i, name: `batch2-${i}` }));
      const batch3 = Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: `batch3-${i}` }));

      await chunkedFileHandler.write(batch1);
      await chunkedFileHandler.append(batch2);
      await chunkedFileHandler.append(batch3);

      const result = await chunkedFileHandler.readAll();

      expect(result.length).toBe(batch1.length + batch2.length + batch3.length);
      expect(result[0]).toEqual(batch1[0]);
      expect(result[300]).toEqual(batch2[0]);
      expect(result[600]).toEqual(batch3[0]);
    });

    it('does not include stored record content in chunk debug output', async () => {
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
      const payload = 'x'.repeat(6000);
      let readLog: string | undefined;

      try {
        await chunkedFileHandler.write([{ id: 'large-debug', payload }]);
        await chunkedFileHandler.readAll();

        readLog = debugSpy.mock.calls.map(args => String(args[0])).find(message => message.includes('Read chunk file'));
      } finally {
        debugSpy.mockRestore();
      }

      expect(readLog).toBeDefined();
      expect(readLog).toContain('contentLength=');
      expect(readLog).not.toContain('contentPreview=');
      expect(readLog).not.toContain(payload);
    });

    it('persists append metadata before deleting the recovery journal', async () => {
      await chunkedFileHandler.write([{ id: 1 }]);

      const events: string[] = [];
      const originalSave = metadataManager.saveImmediately.bind(metadataManager);
      const saveSpy = jest.spyOn(metadataManager, 'saveImmediately').mockImplementation(async () => {
        events.push('metadata');
        await originalSave();
      });
      const fileSystem = getFileSystem();
      const originalDelete = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri.endsWith('.append-journal')) {
          events.push('journal');
        }
        await originalDelete(uri, options);
      });

      try {
        await chunkedFileHandler.append([{ id: 2 }]);
      } finally {
        saveSpy.mockRestore();
        deleteSpy.mockRestore();
      }

      expect(events).toContain('metadata');
      expect(events).toContain('journal');
      expect(events.indexOf('metadata')).toBeLessThan(events.indexOf('journal'));
    });

    it('preserves chunk order when a later chunk is preloaded', async () => {
      await chunkedFileHandler.write([{ id: 1 }]);
      await chunkedFileHandler.append([{ id: 2 }]);
      await chunkedFileHandler.append([{ id: 3 }]);

      await chunkedFileHandler.preloadChunks([1]);

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
  });
});
