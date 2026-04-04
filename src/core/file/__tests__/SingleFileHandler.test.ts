// src/core/file/__tests__/SingleFileHandler.test.ts

import { SingleFileHandler } from '../SingleFileHandler';

describe('SingleFileHandler', () => {
  let handler: SingleFileHandler;
  const testFilePath = '/mock/documents/test_table.ldb';

  beforeEach(() => {
    handler = new SingleFileHandler(testFilePath);
    if ((global as any).__expo_file_system_mock__) {
      (global as any).__expo_file_system_mock__.mockFileSystem = {};
    }
  });

  afterEach(async () => {
    try {
      await handler.delete();
    } catch {
      // ignore
    }
  });

  describe('write and read', () => {
    it('should write and read data', async () => {
      const testData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('should handle empty data', async () => {
      await handler.write([]);
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('should overwrite existing data', async () => {
      await handler.write([{ id: 1 }]);
      await handler.write([{ id: 2 }]);
      const result = await handler.read();
      expect(result).toEqual([{ id: 2 }]);
    });

    it('should handle large data', async () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
      await handler.write(largeData);
      const result = await handler.read();
      expect(result).toHaveLength(100);
      expect(result[0]).toEqual({ id: 0, value: 'item-0' });
    });
  });

  describe('read edge cases', () => {
    it('should return empty array for non-existent file', async () => {
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('should return empty array for corrupted data', async () => {
      if ((global as any).__expo_file_system_mock__) {
        (global as any).__expo_file_system_mock__.mockFileSystem[testFilePath] = {
          type: 'file',
          content: 'not-valid-json',
        };
      }
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('should return empty array for missing hash', async () => {
      if ((global as any).__expo_file_system_mock__) {
        (global as any).__expo_file_system_mock__.mockFileSystem[testFilePath] = {
          type: 'file',
          content: JSON.stringify({ data: [{ id: 1 }] }),
        };
      }
      const result = await handler.read();
      expect(result).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete file', async () => {
      await handler.write([{ id: 1 }]);
      await handler.delete();
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('should not throw if file does not exist', async () => {
      await expect(handler.delete()).resolves.not.toThrow();
    });
  });

  describe('data integrity', () => {
    it('should verify data hash on read', async () => {
      const testData = [{ id: 1, name: 'Alice' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('should handle special characters in data', async () => {
      const testData = [{ id: 1, name: 'Alice & Bob', desc: '<script>alert("xss")</script>' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('should handle null and undefined values', async () => {
      const testData = [{ id: 1, a: null, b: undefined, c: 0 }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result[0].a).toBeNull();
      expect(result[0].c).toBe(0);
    });
  });
});
