import { StorageError } from '../../types/storageErrorInfc';
import { type StorageRecord } from '../../types/storageTypes';
import { hashHexSync } from '../../utils/cryptoPrimitives';
import logger from '../../utils/logger';
import { type FileInfoCompat, getFileSystem } from '../../utils/fileSystemCompat';

export abstract class FileHandlerBase {
  protected fileInfoCache = new Map<
    string,
    {
      info: FileInfoCompat;
      timestamp: number;
    }
  >();

  protected readonly CACHE_EXPIRY = 5000;

  protected readonly MAX_MEMORY_PER_CHUNK = 50 * 1024 * 1024;

  protected readonly BATCH_SIZE = 100;

  protected validateArrayData(data: unknown): asserts data is StorageRecord[] {
    if (!Array.isArray(data)) {
      throw new StorageError(`DATA_TYPE_ERROR: expected array, received ${typeof data}`, 'FILE_CONTENT_INVALID', {
        details: `Invalid data type: ${typeof data}`,
        suggestion: 'Please provide an array of records',
      });
    }
  }

  protected validateDataItem(item: unknown): item is StorageRecord {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      logger.warn(`skip invalid data item:`, item);
      return false;
    }
    return true;
  }

  protected async computeHash(data: unknown): Promise<string> {
    const content = JSON.stringify(data);
    return hashHexSync(content, 'SHA-256');
  }

  protected async verifyHash(data: unknown, expectedHash: string): Promise<boolean> {
    const actualHash = await this.computeHash(data);
    return actualHash === expectedHash;
  }

  protected async getFileInfo(path: string): Promise<FileInfoCompat> {
    const key = path;
    const cached = this.fileInfoCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      return cached.info;
    }

    try {
      const info = await getFileSystem().getInfoAsync(path);
      this.fileInfoCache.set(key, {
        info,
        timestamp: Date.now(),
      });
      return info;
    } catch (error) {
      this.fileInfoCache.delete(key);
      throw error;
    }
  }

  protected clearFileInfoCache(path?: string): void {
    if (path) {
      this.fileInfoCache.delete(path);
    } else {
      this.fileInfoCache.clear();
    }
  }

  protected formatWriteError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_WRITE_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if you have write permissions and the disk is not full',
    });
  }

  protected formatReadError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_READ_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if the file exists and you have read permissions',
    });
  }

  protected formatDeleteError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_DELETE_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if you have delete permissions',
    });
  }

  public abstract write(data: StorageRecord[]): Promise<void>;

  public abstract read(): Promise<StorageRecord[]>;

  public abstract delete(): Promise<void>;
}
