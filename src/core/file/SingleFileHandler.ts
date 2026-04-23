/**
 * @module SingleFileHandler
 * @description Single file handler for small data storage with atomic writes
 * @since 2025-11-28
 * @version 2.0.0
 */

import { StorageError } from '../../types/storageErrorInfc';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import withTimeout from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';

/**
 * Single file handler for smaller tables.
 */
export class SingleFileHandler extends FileHandlerBase {
  constructor(private filePath: string) {
    super();
  }

  async write(data: Record<string, any>[]) {
    try {
      this.validateArrayData(data);

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      let retries = 3;
      let lastError: unknown;

      while (retries > 0) {
        try {
          const tempFilePath = `${this.filePath}.tmp`;

          await withTimeout(
            getFileSystem().writeAsStringAsync(tempFilePath, content, { encoding: getEncodingType().UTF8 }),
            10000,
            `write temp file ${tempFilePath}`
          );

          await withTimeout(
            getFileSystem().moveAsync({ from: tempFilePath, to: this.filePath }),
            10000,
            `rename temp file to ${this.filePath}`
          );

          this.clearFileInfoCache(this.filePath);
          return;
        } catch (error: any) {
          lastError = error;
          retries--;

          if (error?.message && (error.message.includes('locked') || error.message.includes('busy'))) {
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            throw error;
          }
        }
      }

      throw lastError;
    } catch (error) {
      throw this.formatWriteError(`FILE_WRITE_ERROR: ${this.filePath}:`, error);
    }
  }

  async read(): Promise<Record<string, any>[]> {
    try {
      const info = await super.getFileInfo(this.filePath);
      if (!info.exists) return [];

      const text = await withTimeout(
        getFileSystem().readAsStringAsync(this.filePath, { encoding: getEncodingType().UTF8 }),
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
      const info = await super.getFileInfo(this.filePath);
      if (info.exists) {
        await withTimeout(getFileSystem().deleteAsync(this.filePath), 10000, `delete ${this.filePath}`);
        this.clearFileInfoCache(this.filePath);
      }
    } catch (error) {
      logger.warn(`DELETE_FILE_ERROR: ${this.filePath}:`, error);
    }
  }
}
