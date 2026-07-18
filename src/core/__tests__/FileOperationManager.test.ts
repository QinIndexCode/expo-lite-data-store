import { FileOperationManager } from '../FileOperationManager';
import { MetadataManager } from '../meta/MetadataManager';

describe('FileOperationManager', () => {
  let fileOperationManager: FileOperationManager;
  const testTableName = 'test_file_operation_table';
  const chunkSize = 1024 * 1024;

  const metadataManager = new MetadataManager();

  beforeEach(() => {
    fileOperationManager = new FileOperationManager(chunkSize, metadataManager);
  });

  describe('basic operations', () => {
    it('creates an instance', () => {
      expect(fileOperationManager).toBeInstanceOf(FileOperationManager);
    });

    it('checks file-system permissions', async () => {
      await expect(fileOperationManager.checkPermissions()).resolves.not.toThrow();
    });

    it('clears the file-info cache', () => {
      expect(() => fileOperationManager.clearFileInfoCache()).not.toThrow();
      expect(() => fileOperationManager.clearFileInfoCache('test_path')).not.toThrow();
    });
  });

  describe('file handlers', () => {
    it('returns a single-file handler', () => {
      const singleFileHandler = fileOperationManager.getSingleFileHandler(testTableName);
      expect(singleFileHandler).toBeDefined();
    });

    it('returns a chunked-file handler', () => {
      const chunkedFileHandler = fileOperationManager.getChunkedFileHandler(testTableName);
      expect(chunkedFileHandler).toBeDefined();
    });

    it('rejects path-like table names before creating handlers or deleting directories', async () => {
      expect(() => fileOperationManager.getSingleFileHandler('../outside')).toThrow('Invalid table name');
      await expect(fileOperationManager.deleteDirectory('../outside')).rejects.toMatchObject({
        code: 'TABLE_NAME_INVALID',
      });
    });

    it('rejects the case-insensitive metadata table name', () => {
      expect(() => fileOperationManager.getSingleFileHandler('META')).toThrow('reserved for internal storage');
    });

    it('selects chunked storage for data above the threshold', () => {
      const smallData = [{ id: 1, name: 'test' }];
      expect(fileOperationManager.shouldUseChunkedMode(smallData)).toBe(false);

      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `test${i}`,
        data: `large data ${i}`.repeat(1000),
      }));
      expect(fileOperationManager.shouldUseChunkedMode(largeData)).toBe(true);
    });
  });

  describe('file operations', () => {
    it('writes and reads single-file records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await fileOperationManager.writeSingleFile(testTableName, testData);

      const result = await fileOperationManager.readSingleFile(testTableName);

      expect(result).toEqual(testData);

      await fileOperationManager.deleteSingleFile(testTableName);
    });

    it('writes and reads chunked records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await fileOperationManager.writeChunkedFile(testTableName, testData);

      const result = await fileOperationManager.readChunkedFile(testTableName);

      expect(result.length).toBeGreaterThan(0);

      await fileOperationManager.clearChunkedFile(testTableName);
    });
  });

  describe('edge cases', () => {
    it('writes empty records', async () => {
      await expect(fileOperationManager.writeSingleFile(testTableName, [])).resolves.not.toThrow();

      await expect(fileOperationManager.writeChunkedFile(testTableName, [])).resolves.not.toThrow();

      await fileOperationManager.deleteSingleFile(testTableName);
      await fileOperationManager.clearChunkedFile(testTableName);
    });
  });
});
