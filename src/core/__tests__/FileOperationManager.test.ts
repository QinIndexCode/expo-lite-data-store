// src/core/__tests__/FileOperationManager.test.ts

import { FileOperationManager } from '../FileOperationManager';
import { MetadataManager } from '../meta/MetadataManager';

describe('FileOperationManager', () => {
  let fileOperationManager: FileOperationManager;
  const testTableName = 'test_file_operation_table';
  const chunkSize = 1024 * 1024; // 1MB

  const metadataManager = new MetadataManager();

  beforeEach(() => {
    // 创建新的 FileOperationManager 实例用于每个测试
    fileOperationManager = new FileOperationManager(chunkSize, metadataManager);
  });

  describe('Basic Functionality Tests', () => {
    it('should be able to create instance', () => {
      expect(fileOperationManager).toBeInstanceOf(FileOperationManager);
    });

    it('should be able to check permissions', async () => {
      // Permission check should execute normally without throwing errors
      await expect(fileOperationManager.checkPermissions()).resolves.not.toThrow();
    });

    it('should be able to clear file info cache', () => {
      // Clearing file info cache should execute normally without throwing errors
      expect(() => fileOperationManager.clearFileInfoCache()).not.toThrow();
      expect(() => fileOperationManager.clearFileInfoCache('test_path')).not.toThrow();
    });
  });

  describe('File Handler Tests', () => {
    it('should be able to get single file handler', () => {
      const singleFileHandler = fileOperationManager.getSingleFileHandler(testTableName);
      expect(singleFileHandler).toBeDefined();
    });

    it('should be able to get chunked file handler', () => {
      const chunkedFileHandler = fileOperationManager.getChunkedFileHandler(testTableName);
      expect(chunkedFileHandler).toBeDefined();
    });

    it('should be able to determine if chunked mode should be used', () => {
      // Small data should not use chunked mode
      const smallData = [{ id: 1, name: 'test' }];
      expect(fileOperationManager.shouldUseChunkedMode(smallData)).toBe(false);

      // Large data should use chunked mode
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `test${i}`,
        data: `large data ${i}`.repeat(1000), // Increase data size
      }));
      expect(fileOperationManager.shouldUseChunkedMode(largeData)).toBe(true);
    });
  });

  describe('File Operation Tests', () => {
    it('should be able to handle single file read and write operations', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      // Write single file data
      await fileOperationManager.writeSingleFile(testTableName, testData);

      // Read single file data
      const result = await fileOperationManager.readSingleFile(testTableName);

      expect(result).toEqual(testData);

      // Clean up test data
      await fileOperationManager.deleteSingleFile(testTableName);
    });

    it('should be able to handle chunked file read and write operations', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      // Write chunked file data
      await fileOperationManager.writeChunkedFile(testTableName, testData);

      // Read chunked file data
      const result = await fileOperationManager.readChunkedFile(testTableName);

      expect(result.length).toBeGreaterThan(0);

      // Clean up test data
      await fileOperationManager.clearChunkedFile(testTableName);
    });
  });

  describe('Edge Case Tests', () => {
    it('should be able to handle empty data', async () => {
      // Write empty data to single file
      await expect(fileOperationManager.writeSingleFile(testTableName, [])).resolves.not.toThrow();

      // Write empty data to chunked file
      await expect(fileOperationManager.writeChunkedFile(testTableName, [])).resolves.not.toThrow();

      // Clean up test data
      await fileOperationManager.deleteSingleFile(testTableName);
      await fileOperationManager.clearChunkedFile(testTableName);
    });
  });
});
