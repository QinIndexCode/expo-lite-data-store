/**
 * @module ChunkedFileHandler
 * @description Chunked file handler for large data storage with automatic splitting
 * @since 2025-11-28
 * @version 2.0.0
 */

import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';

const CHUNK_EXT = '.ldb';
const MAX_DEBUG_CONTENT_PREVIEW = 160;

const summarizeDebugText = (text: string): string => {
  if (text.length <= MAX_DEBUG_CONTENT_PREVIEW) {
    return text;
  }

  return `${text.slice(0, MAX_DEBUG_CONTENT_PREVIEW)}...[truncated ${text.length - MAX_DEBUG_CONTENT_PREVIEW} chars]`;
};

/**
 * Chunked file handler for large tables.
 */
export class ChunkedFileHandler extends FileHandlerBase {
  private tableName: string;
  private tableDirPath: string;
  private metadataManager: IMetadataManager;
  private chunkCache = new Map<number, Record<string, any>[]>();
  private readonly maxCacheSize = 10;

  constructor(tableName: string, metadataManager: IMetadataManager) {
    super();
    this.tableName = tableName;
    this.tableDirPath = `${getRootPathSync()}${tableName}/`;
    this.metadataManager = metadataManager;
  }

  private getChunkFilePath(index: number): string {
    return `${this.tableDirPath}${String(index).padStart(6, '0')}${CHUNK_EXT}`;
  }

  async write(data: Record<string, any>[]): Promise<void> {
    try {
      this.validateArrayData(data);

      if (data.length === 0) {
        await this.clear();
        return;
      }

      await this.clear();
      await this.append(data);

      this.metadataManager.update(this.tableName, {
        count: data.length,
        updatedAt: Date.now(),
      });
    } catch (error) {
      throw this.formatWriteError(`write data to table ${this.tableName} failed`, error);
    }
  }

  async read(): Promise<Record<string, any>[]> {
    return this.readAll();
  }

  async delete(): Promise<void> {
    await this.clear();
  }

  async append(data: Record<string, any>[]) {
    try {
      this.validateArrayData(data);
      if (data.length === 0) return;

      await withTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        `create table directory ${this.tableName}`
      );

      this.clearFileInfoCache(this.tableDirPath);

      const currentMeta = this.metadataManager.get(this.tableName) || {
        mode: 'chunked' as const,
        path: this.tableName + '/',
        count: 0,
        chunks: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const chunkSize = configManager.getConfig().chunkSize || 1024 * 1024;
      const chunksToWrite = await this.preprocessData(data, chunkSize);
      const chunkIndex = currentMeta.chunks || 0;
      const parallelLimit = 4;
      const writePromises: Promise<void>[] = [];

      for (let i = 0; i < chunksToWrite.length; i++) {
        const chunkData = chunksToWrite[i];
        const currentIndex = chunkIndex + i;
        writePromises.push(this.writeChunk(currentIndex, chunkData || []));

        if (writePromises.length >= parallelLimit) {
          await Promise.all(writePromises);
          writePromises.length = 0;
        }
      }

      if (writePromises.length > 0) {
        await Promise.all(writePromises);
      }

      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        count: currentMeta.count + data.length,
        chunks: chunkIndex + chunksToWrite.length,
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.error(`append data to table ${this.tableName} failed`, error);
      throw this.formatWriteError(`append data to table ${this.tableName} failed`, error);
    }
  }

  private async preprocessData(data: Record<string, any>[], chunkSize: number): Promise<Record<string, any>[][]> {
    const chunks: Record<string, any>[][] = [];
    let currentChunk: Record<string, any>[] = [];
    let currentSize = 0;
    const encoder = new TextEncoder();
    const overhead = 200;
    const itemSizes: number[] = [];
    const validItems: Record<string, any>[] = [];

    for (const item of data) {
      try {
        if (!this.validateDataItem(item)) {
          continue;
        }

        const itemSize = encoder.encode(JSON.stringify(item)).byteLength + overhead;
        itemSizes.push(itemSize);
        validItems.push(item);
      } catch (err) {
        logger.warn(`skip error data item:`, item, err);
      }
    }

    const sizeStats = {
      min: Math.min(...itemSizes),
      max: Math.max(...itemSizes),
      avg: itemSizes.reduce((sum, size) => sum + size, 0) / itemSizes.length,
    };

    const dynamicChunkSize = Math.min(chunkSize, Math.max(sizeStats.avg * 100, chunkSize * 0.8));

    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const itemSize = itemSizes[i] || 0;

      if (item && itemSize > dynamicChunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentSize = 0;
        }
        chunks.push([item]);
        continue;
      }

      const fillRatio = (currentSize + itemSize) / dynamicChunkSize;
      if (fillRatio > 0.9 && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      if (currentSize + itemSize > dynamicChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(item as Record<string, any>);
      currentSize += itemSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private async writeChunk(index: number, data: Record<string, any>[]) {
    const filePath = this.getChunkFilePath(index);
    try {
      this.validateArrayData(data);

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      logger.debug(`Writing chunk ${index} to ${filePath}, data length: ${data.length}`);

      let retries = 3;
      let lastError: any;

      while (retries > 0) {
        try {
          const tempFilePath = `${this.tableDirPath}${String(index).padStart(6, '0')}.tmp`;

          logger.debug(`Writing temp file ${tempFilePath}`);

          await withTimeout(
            getFileSystem().writeAsStringAsync(tempFilePath, content, { encoding: getEncodingType().UTF8 }),
            10000,
            `write temp chunk ${index} failed`
          );

          logger.debug(`Renaming temp file ${tempFilePath} to ${filePath}`);

          await withTimeout(
            getFileSystem().moveAsync({ from: tempFilePath, to: filePath }),
            10000,
            `rename temp chunk ${index} to ${filePath}`
          );

          logger.debug(`Written chunk ${index} to ${filePath}`);

          const fileInfo = await getFileSystem().getInfoAsync(filePath);
          logger.debug(`File ${filePath} exists: ${fileInfo.exists}`);

          this.clearFileInfoCache(filePath);
          return;
        } catch (error: any) {
          logger.debug(`Error writing chunk ${index}: ${error?.message}`);
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
      throw this.formatWriteError(`write chunk ${index} failed`, error);
    }
  }

  async preloadChunks(chunkIndices: number[]): Promise<void> {
    const chunkFiles = await this.getChunkFiles();
    const filesToLoad = chunkIndices
      .map(index => {
        const targetFile = chunkFiles.find(filePath => {
          const fileName = filePath.split('/').pop() || '';
          const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
          return fileIndex === index;
        });
        return targetFile;
      })
      .filter((filePath): filePath is string => {
        if (!filePath) return false;
        const fileName = filePath.split('/').pop() || '';
        const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
        return !this.chunkCache.has(fileIndex);
      });

    const parallelLimit = 4;
    for (let i = 0; i < filesToLoad.length; i += parallelLimit) {
      const batch = filesToLoad.slice(i, i + parallelLimit);
      await Promise.all(
        batch.map(async filePath => {
          try {
            const fileName = filePath.split('/').pop() || '';
            const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
            const data = await this.readChunkFile(filePath);
            if (data.length > 0) {
              if (this.chunkCache.size >= this.maxCacheSize) {
                const firstKey = this.chunkCache.keys().next().value;
                if (firstKey !== undefined) {
                  this.chunkCache.delete(firstKey);
                }
              }
              this.chunkCache.set(chunkIndex, data);
            }
          } catch (e) {
            logger.warn(`Preload chunk ${filePath} failed`, e);
          }
        })
      );
    }
  }

  private async readChunkFile(filePath: string): Promise<Record<string, any>[]> {
    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(filePath, { encoding: getEncodingType().UTF8 }),
        10000,
        `READ CHUNK ${filePath} CONTENT`
      );

      logger.debug(
        `Read chunk file ${filePath}, contentLength=${text.length}, contentPreview=${summarizeDebugText(text)}`
      );

      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object') {
        logger.warn(`CHUNK ${filePath} FORMAT_ERROR: not valid JSON object`);
        return [];
      }

      if (!Array.isArray(parsed.data) || parsed.hash === undefined) {
        logger.warn(`CHUNK ${filePath} FORMAT_ERROR: missing data array or hash field`);
        return [];
      }

      const isValid = await this.verifyHash(parsed.data, parsed.hash);
      if (!isValid) {
        logger.warn(`CHUNK ${filePath} CORRUPTED: hash mismatch`);
        logger.debug(`Expected hash: ${parsed.hash}, Actual hash: ${await this.computeHash(parsed.data)}`);
        return [];
      }

      return parsed.data;
    } catch (error) {
      logger.error(`ERROR reading chunk file ${filePath}:`, error);
      return [];
    }
  }

  clearChunkCache(): void {
    this.chunkCache.clear();
  }

  async readAll(): Promise<Record<string, any>[]> {
    const chunkFiles = await this.getChunkFiles();

    if (chunkFiles.length === 0) {
      return [];
    }

    const allChunkData: Record<string, any>[][] = [];
    const filesToRead: string[] = [];
    const cachedIndices: number[] = [];

    for (const filePath of chunkFiles) {
      const fileName = filePath.split('/').pop() || '';
      const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      if (this.chunkCache.has(chunkIndex)) {
        cachedIndices.push(chunkIndex);
      } else {
        filesToRead.push(filePath);
      }
    }

    cachedIndices.sort((a, b) => a - b);
    for (const index of cachedIndices) {
      const cached = this.chunkCache.get(index);
      if (cached) {
        allChunkData.push(cached);
      }
    }

    const parallelLimit = 6;

    for (let i = 0; i < filesToRead.length; i += parallelLimit) {
      const batchFiles = filesToRead.slice(i, i + parallelLimit);

      const batchPromises = batchFiles.map(async filePath => {
        try {
          const fileName = filePath.split('/').pop() || '';
          const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
          const data = await this.readChunkFile(filePath);

          if (data.length > 0 && this.chunkCache.size < this.maxCacheSize) {
            this.chunkCache.set(chunkIndex, data);
          }

          return data;
        } catch (e) {
          logger.warn(`READ CHUNK ${filePath} FAILED`, e);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      allChunkData.push(...batchResults);
    }

    return allChunkData.flat();
  }

  private async getChunkFiles(): Promise<string[]> {
    try {
      let filePaths: string[] = [];

      logger.debug(`Getting chunk files from ${this.tableDirPath}`);

      try {
        const entries = await withTimeout(
          getFileSystem().readDirectoryAsync(this.tableDirPath),
          10000,
          `LIST TABLE DIR ${this.tableDirPath}`
        );

        logger.debug(`Directory entries: ${JSON.stringify(entries)}`);

        filePaths = entries
          .filter((entry: string) => entry.endsWith(CHUNK_EXT))
          .sort()
          .map((entry: string) => `${this.tableDirPath}${entry}`);
      } catch (listError) {
        logger.debug(
          `List directory failed, falling back to file detection: ${listError instanceof Error ? listError.message : 'Unknown error'}`
        );
        for (let i = 0; i < 20; i++) {
          const filePath = this.getChunkFilePath(i);
          try {
            const fileInfo = await super.getFileInfo(filePath);
            logger.debug(`Checking file ${filePath}, exists: ${fileInfo.exists}`);
            if (fileInfo.exists) {
              filePaths.push(filePath);
            }
          } catch {
            continue;
          }
        }
      }

      logger.debug(`Found chunk files: ${JSON.stringify(filePaths)}`);
      return filePaths;
    } catch (e) {
      logger.warn(`GET CHUNK FILES FAILED`, e);
      return [];
    }
  }

  async readRange(startIndex: number, endIndex: number): Promise<Record<string, any>[]> {
    const allChunkFiles = await this.getChunkFiles();
    const rangeChunkFiles = allChunkFiles.filter(filePath => {
      const fileName = filePath.split('/').pop() || '';
      const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      return fileIndex >= startIndex && fileIndex <= endIndex;
    });

    const chunkDataPromises = rangeChunkFiles.map(async filePath => {
      try {
        return await this.readChunkFile(filePath);
      } catch (e) {
        logger.warn(`READ CHUNK ${filePath} FAILED`, e);
        return [];
      }
    });

    const chunkDataArray = await Promise.all(chunkDataPromises);
    return chunkDataArray.flat();
  }

  async clear() {
    try {
      try {
        await withTimeout(
          getFileSystem().deleteAsync(this.tableDirPath, { idempotent: true }),
          10000,
          'DELETE TABLE DIRECTORY'
        );
      } catch (err) {
        logger.warn(`DELETE TABLE DIRECTORY FAILED`, err);
      }

      await withTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        'RECREATE TABLE DIRECTORY'
      );

      this.clearFileInfoCache(this.tableDirPath);

      this.metadataManager.update(this.tableName, {
        count: 0,
        chunks: 0,
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.error('CLEAR CHUNKED TABLE FAILED', error);
      throw this.formatDeleteError('CLEAR CHUNKED TABLE FAILED', error);
    }
  }
}
