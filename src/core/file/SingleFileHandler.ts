// src/core/file/SingleFileHandler.ts
// 单文件处理器，用于处理单文件存储模式的文件操作
// 创建于: 2025-11-23
// 最后修改: 2025-12-11

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
      // 使用基类的验证方法
      this.validateArrayData(data);

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      // 重试机制，最多重试3次
      let retries = 3;
      let lastError: any;

      while (retries > 0) {
        try {
          // 原子写入：先写入临时文件，再重命名
          const tempFilePath = `${this.filePath}.tmp`;

          await withTimeout(
            FileSystem.writeAsStringAsync(tempFilePath, content, { encoding: EncodingType.UTF8 }),
            10000,
            `write temp file ${tempFilePath}`
          );

          // 重命名临时文件为目标文件，实现原子写入
          await withTimeout(
            FileSystem.moveAsync({ from: tempFilePath, to: this.filePath }),
            10000,
            `rename temp file to ${this.filePath}`
          );

          // 写入成功后清除缓存
          this.clearFileInfoCache(this.filePath);
          return; // 成功写入，退出重试循环
        } catch (error: any) {
          lastError = error;
          retries--;

          // 如果是文件锁定错误，等待后重试
          if (error.message && (error.message.includes('locked') || error.message.includes('busy'))) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 等待100ms后重试
          } else {
            // 其他错误，直接抛出
            throw error;
          }
        }
      }

      // 重试次数用尽，抛出最后一次错误
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

        // 删除成功后清除缓存
        this.clearFileInfoCache(this.filePath);
      }
    } catch (error) {
      logger.warn(`DELETE_FILE_ERROR: ${this.filePath}:`, error);
    }
  }
}
