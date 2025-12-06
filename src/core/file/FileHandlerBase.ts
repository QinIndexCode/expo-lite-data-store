// src/core/file/FileHandlerBase.ts
import * as Crypto from 'expo-crypto';
import { StorageError } from '../../types/storageErrorInfc';

/**
 * 文件处理器抽象基类，包含公共方法
 */
export abstract class FileHandlerBase {
  /**
   * 文件信息缓存
   */
  protected fileInfoCache = new Map<
    string,
    {
      info: any;
      timestamp: number;
    }
  >();

  /**
   * 缓存过期时间（毫秒）
   */
  protected readonly CACHE_EXPIRY = 5000; // 5秒

  /**
   * 内存使用监控阈值（字节）
   */
  protected readonly MAX_MEMORY_PER_CHUNK = 50 * 1024 * 1024; // 50MB per chunk

  /**
   * 批量处理大小
   */
  protected readonly BATCH_SIZE = 100; // 每批次处理100条数据

  /**
   * 验证数据是否为数组
   */
  protected validateArrayData(data: any): asserts data is Record<string, any>[] {
    if (!Array.isArray(data)) {
      throw new StorageError(`DATA_TYPE_ERROR: expected array, received ${typeof data}`, 'FILE_CONTENT_INVALID', {
        details: `Invalid data type: ${typeof data}`,
        suggestion: 'Please provide an array of records',
      });
    }
  }

  /**
   * 验证单个数据项是否为对象
   */
  protected validateDataItem(item: any): boolean {
    if (typeof item !== 'object' || item === null) {
      console.warn(`skip invalid data item:`, item);
      return false;
    }
    return true;
  }

  /**
   * 计算数据的哈希值
   */
  protected async computeHash(data: any): Promise<string> {
    const content = JSON.stringify(data);
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
  }

  /**
   * 验证数据的哈希值
   */
  protected async verifyHash(data: any, expectedHash: string): Promise<boolean> {
    const actualHash = await this.computeHash(data);
    return actualHash === expectedHash;
  }

  /**
   * 获取文件信息，优先从缓存中获取
   */
  protected async getFileInfo(path: string): Promise<any> {
    const key = path;
    const cached = this.fileInfoCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      return cached.info;
    }

    try {
      const FileSystem = await import('expo-file-system');
      const info = await FileSystem.getInfoAsync(path);
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

  /**
   * 清除文件信息缓存
   */
  protected clearFileInfoCache(path?: any): void {
    if (path) {
      const key = typeof path === 'string' ? path : path.name;
      this.fileInfoCache.delete(key);
    } else {
      this.fileInfoCache.clear();
    }
  }

  /**
   * 格式化文件写入错误
   */
  protected formatWriteError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_WRITE_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if you have write permissions and the disk is not full',
    });
  }

  /**
   * 格式化文件读取错误
   */
  protected formatReadError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_READ_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if the file exists and you have read permissions',
    });
  }

  /**
   * 格式化文件删除错误
   */
  protected formatDeleteError(message: string, cause?: unknown): StorageError {
    return new StorageError(message, 'FILE_DELETE_FAILED', {
      cause,
      details: message,
      suggestion: 'Check if you have delete permissions',
    });
  }

  /**
   * 抽象方法：写入数据
   */
  public abstract write(data: Record<string, any>[]): Promise<void>;

  /**
   * 抽象方法：读取数据
   */
  public abstract read(): Promise<Record<string, any>[]>;

  /**
   * 抽象方法：删除数据
   */
  public abstract delete(): Promise<void>;
}
