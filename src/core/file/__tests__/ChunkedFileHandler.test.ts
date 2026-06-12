// src/core/file/__tests__/ChunkedFileHandler.test.ts

import { MetadataManager } from '../../meta/MetadataManager';
import { ChunkedFileHandler } from '../ChunkedFileHandler';
import logger from '../../../utils/logger';

describe('ChunkedFileHandler', () => {
  let chunkedFileHandler: ChunkedFileHandler;
  const testTableName = 'test_chunked_table';
  const metadataManager = new MetadataManager();

  beforeEach(() => {
    // 清理mock文件系统中的数据
    if ((global as any).__expo_file_system_mock__) {
      (global as any).__expo_file_system_mock__.mockFileSystem = {};
    }

    // 创建新的 ChunkedFileHandler 实例用于每个测试
    chunkedFileHandler = new ChunkedFileHandler(testTableName, metadataManager);
  });

  afterEach(async () => {
    // 清理测试数据
    await chunkedFileHandler.clear();

    // 清理mock文件系统中的数据
    if ((global as any).__expo_file_system_mock__) {
      (global as any).__expo_file_system_mock__.mockFileSystem = {};
    }
  });

  describe('Basic Functionality Tests', () => {
    it('should be able to write and read data', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      // Write data
      await chunkedFileHandler.write(testData);

      // Read data
      const result = await chunkedFileHandler.read();

      expect(result).toEqual(testData);
    });

    it('should be able to append data', async () => {
      const initialData = [{ id: 1, name: 'test1' }];
      const appendData = [
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      // Write initial data
      await chunkedFileHandler.write(initialData);

      // Append data
      await chunkedFileHandler.append(appendData);

      // Read all data
      const result = await chunkedFileHandler.read();

      expect(result).toEqual([...initialData, ...appendData]);
    });

    it('should be able to clear data', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      // Write data
      await chunkedFileHandler.write(testData);

      // Clear data
      await chunkedFileHandler.clear();

      // Read data, should return empty array
      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('should be able to delete data', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      // Write data
      await chunkedFileHandler.write(testData);

      // Delete data
      await chunkedFileHandler.delete();

      // Read data, should return empty array
      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });
  });

  describe('Advanced Functionality Tests', () => {
    it('should be able to read all data', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      // Write data
      await chunkedFileHandler.write(testData);

      // Read all data using readAll
      const result = await chunkedFileHandler.readAll();

      expect(result).toEqual(testData);
    });

    it('should be able to read data from specified chunk range', async () => {
      // Write enough data to ensure multiple chunks are created
      const testData = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `test${i}` }));

      // Write data
      await chunkedFileHandler.write(testData);

      // Read data from specified chunk range
      const result = await chunkedFileHandler.readRange(0, 0);

      // Verify result is not empty
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Edge Case Tests', () => {
    it('should be able to handle empty data', async () => {
      // Write empty data
      await chunkedFileHandler.write([]);

      // Read data, should return empty array
      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('should be able to handle large data write in single operation', async () => {
      // Generate large test data
      const testData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `test${i}`,
        data: `test data ${i}`.repeat(100), // Increase data size to ensure chunking
      }));

      // Write data
      await chunkedFileHandler.write(testData);

      // Read data
      const result = await chunkedFileHandler.readAll();

      // Verify data integrity
      expect(result.length).toBe(testData.length);
      expect(result[0]).toEqual(testData[0]);
      expect(result[result.length - 1]).toEqual(testData[testData.length - 1]);
    });
  });

  describe('Error Handling Tests', () => {
    it('should be able to handle invalid data', async () => {
      // @ts-ignore - Intentionally passing invalid data type
      await expect(chunkedFileHandler.write('invalid data')).rejects.toThrow();
    });

    it('should reject a corrupted chunk instead of silently dropping its records', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = (global as any).__expo_file_system_mock__.mockFileSystem;
      const parsed = JSON.parse(fileSystem[chunkPath]);
      parsed.data[0].name = 'tampered';
      fileSystem[chunkPath] = JSON.stringify(parsed);

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('should not clear corrupted source data when an overwrite cannot take a snapshot', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = (global as any).__expo_file_system_mock__.mockFileSystem;
      fileSystem[chunkPath] = '{corrupted';

      await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toMatchObject({
        code: 'CORRUPTED_DATA',
      });
      expect(fileSystem[chunkPath]).toBe('{corrupted');
    });

    it('should restore previous data when a chunked overwrite fails', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const handler = chunkedFileHandler as any;
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let writeAttempts = 0;
      const writeSpy = jest.spyOn(handler, 'writeChunk').mockImplementation(async (...args: any[]) => {
        writeAttempts++;
        if (writeAttempts === 1) {
          throw new Error('injected chunk write failure');
        }
        return originalWriteChunk(...args);
      });

      await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toThrow();
      writeSpy.mockRestore();

      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('should reject non-serializable records without silently dropping them', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const circular: Record<string, any> = { id: 2 };
      circular.self = circular;

      await expect(chunkedFileHandler.write([circular])).rejects.toThrow();
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('should recover previous data from a pending overwrite journal after an interrupted clear', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      await (chunkedFileHandler as any).writeOverwriteJournal(originalData, replacementData);
      await chunkedFileHandler.clear();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const journalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      const fileSystem = (global as any).__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[journalPath]).toBeUndefined();
    });

    it('should keep completed replacement data when an overwrite journal is left behind', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      await (chunkedFileHandler as any).writeOverwriteJournal(originalData, replacementData);
      await chunkedFileHandler.clear();
      await chunkedFileHandler.append(replacementData);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(replacementData);
    });

    it('should invalidate cached chunks after an overwrite', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);
      await chunkedFileHandler.readAll();

      await chunkedFileHandler.write([{ id: 2, name: 'replacement' }]);

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([{ id: 2, name: 'replacement' }]);
    });

    it('should reject a corrupted overwrite journal instead of guessing recovery state', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const journalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      const fileSystem = (global as any).__expo_file_system_mock__.mockFileSystem;
      fileSystem[journalPath] = '{corrupted';

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });
  });

  describe('Chunk Processing Tests', () => {
    it('should correctly handle chunked write and read operations', async () => {
      // Write multiple batches of data to ensure multiple chunks are created
      const batch1 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `batch1-${i}` }));
      const batch2 = Array.from({ length: 300 }, (_, i) => ({ id: 300 + i, name: `batch2-${i}` }));
      const batch3 = Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: `batch3-${i}` }));

      // Write first batch
      await chunkedFileHandler.write(batch1);

      // Append second batch
      await chunkedFileHandler.append(batch2);

      // Append third batch
      await chunkedFileHandler.append(batch3);

      // Read all data
      const result = await chunkedFileHandler.readAll();

      // Verify data integrity
      expect(result.length).toBe(batch1.length + batch2.length + batch3.length);

      // Verify data order
      expect(result[0]).toEqual(batch1[0]);
      expect(result[300]).toEqual(batch2[0]);
      expect(result[600]).toEqual(batch3[0]);
    });

    it('truncates large chunk debug output', async () => {
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
      const payload = 'x'.repeat(6000);
      let readLog: string | undefined;

      try {
        await chunkedFileHandler.write([{ id: 'large-debug', payload }]);
        await chunkedFileHandler.readAll();

        readLog = debugSpy.mock.calls
          .map(args => String(args[0]))
          .find(message => message.includes('Read chunk file'));
      } finally {
        debugSpy.mockRestore();
      }

      expect(readLog).toBeDefined();
      expect(readLog).toContain('contentLength=');
      expect(readLog).toContain('contentPreview=');
      expect(readLog).toContain('[truncated ');
      expect(readLog).not.toContain(payload);
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
