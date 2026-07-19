import { StorageError } from '../../types/storageErrorInfc';
import { type StorageRecord } from '../../types/storageTypes';
import { hashHexSync } from '../../utils/cryptoPrimitives';
import { type FileInfoCompat, getFileSystem } from '../../utils/fileSystemCompat';
import withTimeout from '../../utils/withTimeout';

export abstract class FileHandlerBase {
  private static readonly PATH_LOCK_TIMEOUT_MS = 30000;
  private static readonly MAX_FILE_INFO_CACHE_SIZE = 1024;
  private static readonly pathOperationTails = new Map<string, Promise<void>>();
  private static readonly fileInfoCache = new Map<
    string,
    {
      info: FileInfoCompat;
      timestamp: number;
    }
  >();

  protected readonly CACHE_EXPIRY = 5000;

  protected async acquirePathLock(path: string): Promise<() => void> {
    const previous = FileHandlerBase.pathOperationTails.get(path) ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseGate = resolve;
    });
    const tail = previous.then(() => gate);
    FileHandlerBase.pathOperationTails.set(path, tail);

    try {
      await withTimeout(previous, FileHandlerBase.PATH_LOCK_TIMEOUT_MS, `acquire file lock ${path}`);
    } catch (error) {
      releaseGate();
      void tail.then(() => {
        if (FileHandlerBase.pathOperationTails.get(path) === tail) {
          FileHandlerBase.pathOperationTails.delete(path);
        }
      });
      throw error;
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseGate();
      if (FileHandlerBase.pathOperationTails.get(path) === tail) {
        FileHandlerBase.pathOperationTails.delete(path);
      }
    };
  }

  protected async runWithPathLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquirePathLock(path);
    try {
      return await operation();
    } finally {
      release();
    }
  }

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
    const cached = FileHandlerBase.fileInfoCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      FileHandlerBase.fileInfoCache.delete(key);
      FileHandlerBase.fileInfoCache.set(key, cached);
      return cached.info;
    }
    FileHandlerBase.fileInfoCache.delete(key);

    try {
      const info = await getFileSystem().getInfoAsync(path);
      if (FileHandlerBase.fileInfoCache.size >= FileHandlerBase.MAX_FILE_INFO_CACHE_SIZE) {
        const oldestKey = FileHandlerBase.fileInfoCache.keys().next();
        if (!oldestKey.done) {
          FileHandlerBase.fileInfoCache.delete(oldestKey.value);
        }
      }
      FileHandlerBase.fileInfoCache.set(key, {
        info,
        timestamp: Date.now(),
      });
      return info;
    } catch (error) {
      FileHandlerBase.fileInfoCache.delete(key);
      throw error;
    }
  }

  static invalidateFileInfoCache(path?: string, includeDescendants = false): void {
    if (!path) {
      FileHandlerBase.fileInfoCache.clear();
      return;
    }

    FileHandlerBase.fileInfoCache.delete(path);
    if (includeDescendants) {
      for (const cachedPath of FileHandlerBase.fileInfoCache.keys()) {
        if (cachedPath.startsWith(path)) {
          FileHandlerBase.fileInfoCache.delete(cachedPath);
        }
      }
    }
  }

  protected clearFileInfoCache(path?: string): void {
    FileHandlerBase.invalidateFileInfoCache(path);
  }

  protected clearFileInfoCacheTree(path: string): void {
    FileHandlerBase.invalidateFileInfoCache(path, true);
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
