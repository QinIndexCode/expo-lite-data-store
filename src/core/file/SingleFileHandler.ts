/**
 * @module SingleFileHandler
 * @description Single file handler for small data storage with atomic writes
 * @since 2025-11-28
 * @version 1.0.0
 */

import * as FileSystem from 'expo-file-system';
import { FileInfo, EncodingType } from 'expo-file-system';
import { StorageError } from '../../types/storageErrorInfc';
import withTimeout from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';

/**
 * 单文件处理器类
 * 处理单文件存储模式的文件操作，包括数据的写入、读取和删除
 * 继承自FileHandlerBase，实现了单文件存储的核心逻辑
 */
export class SingleFileHandler extends FileHandlerBase {
  constructor(private filePath: string) {
    super();
  }

  async write(data: Record<string, any>[]) {
    try {
      // Use base class validation method
      this.validateArrayData(data);

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      // Retry机制，最多重试3次
      let retries = 3;
      let lastError: any;

      while (retries > 0) {
        try {
          // Atomic write: Write to temp file, then rename
          const tempFilePath = `${this.filePath}.tmp`;

          await withTimeout(
            FileSystem.writeAsStringAsync(tempFilePath, content, { encoding: EncodingType.UTF8 }),
            10000,
            `write temp file ${tempFilePath}`
          );

          // Rename temp file to target for atomic write
          await withTimeout(
            FileSystem.moveAsync({ from: tempFilePath, to: this.filePath }),
            10000,
            `rename temp file to ${this.filePath}`
          );

          // Write success后清除缓存
          this.clearFileInfoCache(this.filePath);
          return; // Succeed写入，退出重试循环
        } catch (error: any) {
          lastError = error;
          retries--;

          // If file locked error, wait and retry
          if (error.message && (error.message.includes('locked') || error.message.includes('busy'))) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait100ms后重试
          } else {
            // Other errors, throw directly
            throw error;
          }
        }
      }

      // Retry次数用尽，抛出最后一次错误
      throw lastError;
    } catch (error) {
      throw this.formatWriteError(`FILE_WRITE_ERROR: ${this.filePath}:`, error);
    }
  }

  async read(): Promise<Record<string, any>[]> {
    try {
      const info: FileInfo = await super.getFileInfo(this.filePath);
      if (!info.exists) return [];

      const text = await withTimeout(
        FileSystem.readAsStringAsync(this.filePath, { encoding: FileSystem.EncodingType.UTF8 }),
        10000,
        `read ${this.filePath} content`
      );
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object') {
        throw new StorageError('FILE_CONTENT_INVALID: corrupted data', 'CORRUPTED_DATA', {
          details: `File content is not a valid JSON object`,
          suggestion: 'The file may be corrupted, try recreating it',
        });
      }

      if (!Array.isArray(parsed.data) || parsed.hash === undefined) {
        throw new StorageError('FILE_FORMAT_ERROR: missing valid data array or hash field', 'CORRUPTED_DATA', {
          details: `File missing data array or hash field`,
          suggestion: 'The file format is invalid, try recreating it',
        });
      }

      if (!(await this.verifyHash(parsed.data, parsed.hash))) {
        throw new StorageError(
          'FILE_INTEGRITY_ERROR: data may have been tampered with or corrupted',
          'CORRUPTED_DATA',
          {
            details: `Hash mismatch, data may be tampered with`,
            suggestion: 'The file may be corrupted or tampered with, try recreating it',
          }
        );
      }

      return parsed.data;
    } catch (error) {
      logger.warn(`READ_FILE_ERROR: ${this.filePath}:`, error);
      return [];
    }
  }

  async delete() {
    try {
      const info: FileInfo = await super.getFileInfo(this.filePath);
      if (info.exists) {
        await withTimeout(FileSystem.deleteAsync(this.filePath), 10000, `delete ${this.filePath}`);

        // Delete success后清除缓存
        this.clearFileInfoCache(this.filePath);
      }
    } catch (error) {
      logger.warn(`DELETE_FILE_ERROR: ${this.filePath}:`, error);
    }
  }
}
