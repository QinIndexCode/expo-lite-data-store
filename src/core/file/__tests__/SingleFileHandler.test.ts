/// <reference path="../../../__tests__/test-globals.d.ts" />

import { SingleFileHandler } from '../SingleFileHandler';
import logger from '../../../utils/logger';

describe('SingleFileHandler', () => {
  let handler: SingleFileHandler;
  const testFilePath = '/mock/documents/test_table.ldb';

  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    handler = new SingleFileHandler(testFilePath);
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
  });

  afterEach(async () => {
    try {
      await handler.delete();
    } catch {
      // Best-effort cleanup prevents a prior failure from masking the test result.
    } finally {
      jest.restoreAllMocks();
    }
  });

  describe('write and read', () => {
    it('writes and reads data', async () => {
      const testData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('writes and reads an empty record set', async () => {
      await handler.write([]);
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('overwrites existing data', async () => {
      await handler.write([{ id: 1 }]);
      await handler.write([{ id: 2 }]);
      const result = await handler.read();
      expect(result).toEqual([{ id: 2 }]);
    });

    it('writes and reads a large record set', async () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
      await handler.write(largeData);
      const result = await handler.read();
      expect(result).toHaveLength(100);
      expect(result[0]).toEqual({ id: 0, value: 'item-0' });
    });
  });

  describe('read edge cases', () => {
    it('returns an empty array for a nonexistent file', async () => {
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('rejects corrupted data instead of treating it as an empty table', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem[testFilePath] = 'not-valid-json';
      }
      await expect(handler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rejects data with a missing integrity hash', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem[testFilePath] = JSON.stringify({ data: [{ id: 1 }] });
      }
      await expect(handler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });
  });

  describe('delete', () => {
    it('deletes a file', async () => {
      await handler.write([{ id: 1 }]);
      await handler.delete();
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('does not throw when the file does not exist', async () => {
      await expect(handler.delete()).resolves.not.toThrow();
    });
  });

  describe('data integrity', () => {
    it('verifies the data hash on read', async () => {
      const testData = [{ id: 1, name: 'Alice' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('preserves special characters in data', async () => {
      const testData = [{ id: 1, name: 'Alice & Bob', desc: '<script>alert("xss")</script>' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('writes records containing null and undefined values', async () => {
      const testData = [{ id: 1, a: null, b: undefined, c: 0 }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result[0].a).toBeNull();
      expect(result[0].c).toBe(0);
    });
  });
});
