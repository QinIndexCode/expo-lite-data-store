import { StorageError } from '../../types/storageErrorInfc';
import { isStorageRecord, type StorageRecord } from '../../types/storageTypes';
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

  async write(data: StorageRecord[]): Promise<void> {
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
        } catch (error) {
          lastError = error;
          retries--;

          const message = error instanceof Error ? error.message : '';
          if (message.includes('locked') || message.includes('busy')) {
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            throw error;
          }
        }
      }

      throw lastError ?? new Error(`Unable to write ${this.filePath}`);
    } catch (error) {
      throw this.formatWriteError(`FILE_WRITE_ERROR: ${this.filePath}:`, error);
    }
  }

  async read(): Promise<StorageRecord[]> {
    try {
      const info = await super.getFileInfo(this.filePath);
      if (!info.exists) return [];

      const text = await withTimeout(
        getFileSystem().readAsStringAsync(this.filePath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read ${this.filePath} content`
      );
      const parsed: unknown = JSON.parse(text);

      if (!isStorageRecord(parsed)) {
        throw new StorageError('FILE_CONTENT_INVALID: corrupted data', 'CORRUPTED_DATA', {
          details: `File content is not a valid JSON object`,
          suggestion: 'The file may be corrupted, try recreating it',
        });
      }

      const { data, hash } = parsed;
      if (!Array.isArray(data) || !data.every(isStorageRecord) || typeof hash !== 'string') {
        throw new StorageError('FILE_FORMAT_ERROR: missing valid data array or hash field', 'CORRUPTED_DATA', {
          details: `File missing data array or hash field`,
          suggestion: 'The file format is invalid, try recreating it',
        });
      }

      if (!(await this.verifyHash(data, hash))) {
        throw new StorageError(
          'FILE_INTEGRITY_ERROR: data may have been tampered with or corrupted',
          'CORRUPTED_DATA',
          {
            details: `Hash mismatch, data may be tampered with`,
            suggestion: 'The file may be corrupted or tampered with, try recreating it',
          }
        );
      }

      return data;
    } catch (error) {
      logger.warn(`READ_FILE_ERROR: ${this.filePath}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`FILE_CONTENT_INVALID: ${this.filePath}`, 'CORRUPTED_DATA', {
          cause: error,
          details: 'File content is not valid JSON',
          suggestion: 'Restore the file from a known-good backup or recreate the table',
        });
      }
      throw this.formatReadError(`READ_FILE_ERROR: ${this.filePath}`, error);
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
