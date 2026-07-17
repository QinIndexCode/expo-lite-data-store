/**
 * @module ChunkedFileHandler
 * @description Chunked file handler for large data storage with automatic splitting
 * @since 2025-11-28
 * @version 3.0.0
 */

import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';
import { assertValidTableName } from '../../utils/tableName';
import { StorageError } from '../../types/storageErrorInfc';

const CHUNK_EXT = '.ldb';
const OVERWRITE_JOURNAL_EXT = '.overwrite-journal';
const APPEND_JOURNAL_EXT = '.append-journal';

interface OverwriteJournal {
  version: 1;
  tableName: string;
  previousData: Record<string, any>[];
  previousHash: string;
  targetHash: string;
  targetCount: number;
  createdAt: number;
}

interface AppendJournal {
  version: 1;
  tableName: string;
  previousCount: number;
  previousChunks: number;
  targetChunkIndices: number[];
  targetCount: number;
  targetHash: string;
  createdAt: number;
}

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
    assertValidTableName(tableName);
    this.tableName = tableName;
    this.tableDirPath = `${getRootPathSync()}${tableName}/`;
    this.metadataManager = metadataManager;
  }

  private getChunkFilePath(index: number): string {
    return `${this.tableDirPath}${String(index).padStart(6, '0')}${CHUNK_EXT}`;
  }

  private getOverwriteJournalPath(): string {
    return `${getRootPathSync()}${this.tableName}${OVERWRITE_JOURNAL_EXT}`;
  }

  private getAppendJournalPath(): string {
    return `${getRootPathSync()}${this.tableName}${APPEND_JOURNAL_EXT}`;
  }

  async write(data: Record<string, any>[]): Promise<void> {
    this.validateArrayData(data);
    const previousData = await this.readAll();

    await this.writeOverwriteJournal(previousData, data);

    try {
      await this.clear();

      if (data.length > 0) {
        await this.append(data);
      }

      this.metadataManager.update(this.tableName, {
        count: data.length,
        updatedAt: Date.now(),
      });
      await this.persistMetadataIfSupported();

      await this.deleteOverwriteJournal();
    } catch (error) {
      try {
        await this.clear();
        if (previousData.length > 0) {
          await this.append(previousData);
        }
        await this.deleteOverwriteJournal();
      } catch (rollbackError) {
        logger.error(`failed to restore table ${this.tableName} after overwrite failure`, rollbackError);
      }
      throw this.formatWriteError(`write data to table ${this.tableName} failed`, error);
    }
  }

  private async writeOverwriteJournal(
    previousData: Record<string, any>[],
    targetData: Record<string, any>[]
  ): Promise<void> {
    const journalPath = this.getOverwriteJournalPath();
    const tempJournalPath = `${journalPath}.tmp`;
    const journal: OverwriteJournal = {
      version: 1,
      tableName: this.tableName,
      previousData,
      previousHash: await this.computeHash(previousData),
      targetHash: await this.computeHash(targetData),
      targetCount: targetData.length,
      createdAt: Date.now(),
    };
    const content = JSON.stringify({
      journal,
      hash: await this.computeHash(journal),
    });

    await withTimeout(
      getFileSystem().writeAsStringAsync(tempJournalPath, content, { encoding: getEncodingType().UTF8 }),
      10000,
      `write overwrite journal ${journalPath}`
    );
    await withTimeout(
      getFileSystem().moveAsync({ from: tempJournalPath, to: journalPath }),
      10000,
      `publish overwrite journal ${journalPath}`
    );
    this.clearFileInfoCache(journalPath);
  }

  private async readOverwriteJournal(): Promise<OverwriteJournal | null> {
    const journalPath = this.getOverwriteJournalPath();
    const info = await super.getFileInfo(journalPath);
    if (!info.exists) {
      return null;
    }

    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(journalPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read overwrite journal ${journalPath}`
      );
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object' || !parsed.journal || typeof parsed.hash !== 'string') {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      const journal = parsed.journal as Partial<OverwriteJournal>;
      const hash = await this.computeHash(journal);
      if (hash !== parsed.hash) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      if (
        journal.version !== 1 ||
        journal.tableName !== this.tableName ||
        !Array.isArray(journal.previousData) ||
        typeof journal.previousHash !== 'string' ||
        typeof journal.targetHash !== 'string' ||
        typeof journal.targetCount !== 'number'
      ) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      return journal as OverwriteJournal;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ OVERWRITE JOURNAL ${journalPath} FAILED`, error);
    }
  }

  private async deleteOverwriteJournal(): Promise<void> {
    const journalPath = this.getOverwriteJournalPath();
    try {
      await withTimeout(
        getFileSystem().deleteAsync(journalPath, { idempotent: true }),
        10000,
        `delete overwrite journal ${journalPath}`
      );
      this.clearFileInfoCache(journalPath);
    } catch (error) {
      logger.warn(`DELETE OVERWRITE JOURNAL ${journalPath} FAILED`, error);
    }
  }

  private async writeAppendJournal(
    previousCount: number,
    previousChunks: number,
    targetChunkIndices: number[],
    targetData: Record<string, any>[]
  ): Promise<void> {
    const journalPath = this.getAppendJournalPath();
    const tempJournalPath = `${journalPath}.tmp`;
    const journal: AppendJournal = {
      version: 1,
      tableName: this.tableName,
      previousCount,
      previousChunks,
      targetChunkIndices,
      targetCount: targetData.length,
      targetHash: await this.computeHash(targetData),
      createdAt: Date.now(),
    };
    const content = JSON.stringify({
      journal,
      hash: await this.computeHash(journal),
    });

    await withTimeout(
      getFileSystem().writeAsStringAsync(tempJournalPath, content, { encoding: getEncodingType().UTF8 }),
      10000,
      `write append journal ${journalPath}`
    );
    await withTimeout(
      getFileSystem().moveAsync({ from: tempJournalPath, to: journalPath }),
      10000,
      `publish append journal ${journalPath}`
    );
    this.clearFileInfoCache(journalPath);
  }

  private async readAppendJournal(): Promise<AppendJournal | null> {
    const journalPath = this.getAppendJournalPath();
    const info = await super.getFileInfo(journalPath);
    if (!info.exists) {
      return null;
    }

    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(journalPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read append journal ${journalPath}`
      );
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object' || !parsed.journal || typeof parsed.hash !== 'string') {
        throw new StorageError(`APPEND JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      const journal = parsed.journal as Partial<AppendJournal>;
      const hash = await this.computeHash(journal);
      if (hash !== parsed.hash) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      if (
        journal.version !== 1 ||
        journal.tableName !== this.tableName ||
        typeof journal.previousCount !== 'number' ||
        typeof journal.previousChunks !== 'number' ||
        !Array.isArray(journal.targetChunkIndices) ||
        typeof journal.targetCount !== 'number' ||
        typeof journal.targetHash !== 'string'
      ) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      return journal as AppendJournal;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ APPEND JOURNAL ${journalPath} FAILED`, error);
    }
  }

  private async deleteAppendJournal(suppressErrors = false): Promise<void> {
    const journalPath = this.getAppendJournalPath();
    try {
      await withTimeout(
        getFileSystem().deleteAsync(journalPath, { idempotent: true }),
        10000,
        `delete append journal ${journalPath}`
      );
      this.clearFileInfoCache(journalPath);
    } catch (error) {
      logger.warn(`DELETE APPEND JOURNAL ${journalPath} FAILED`, error);
      if (!suppressErrors) {
        throw error;
      }
    }
  }

  private async deleteChunkFiles(indices: number[]): Promise<void> {
    const results = await Promise.allSettled(
      indices.map(async index => {
        const filePath = this.getChunkFilePath(index);
        await withTimeout(
          getFileSystem().deleteAsync(filePath, { idempotent: true }),
          10000,
          `delete appended chunk ${index}`
        );
        this.clearFileInfoCache(filePath);
        this.chunkCache.delete(index);
      })
    );

    const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failedResult) {
      throw new StorageError(`Failed to remove partial chunks for table ${this.tableName}`, 'FILE_DELETE_FAILED', {
        cause: failedResult.reason,
        suggestion: 'Retry the operation so the pending append journal can finish recovery',
      });
    }
  }

  private async recoverPendingAppendJournal(): Promise<void> {
    const journal = await this.readAppendJournal();
    if (!journal) {
      return;
    }

    logger.warn(`Rolling back pending append journal for chunked table ${this.tableName}`);
    await this.deleteChunkFiles(journal.targetChunkIndices);
    this.metadataManager.update(this.tableName, {
      count: journal.previousCount,
      chunks: journal.previousChunks,
      updatedAt: Date.now(),
    });
    await this.persistMetadataIfSupported();
    await this.deleteAppendJournal();
  }

  private async persistMetadataIfSupported(): Promise<void> {
    if (typeof this.metadataManager.saveImmediately === 'function') {
      await this.metadataManager.saveImmediately();
    }
  }

  private async recoverPendingOverwriteJournal(): Promise<void> {
    const journal = await this.readOverwriteJournal();
    if (!journal) {
      return;
    }

    const previousHash = await this.computeHash(journal.previousData);
    if (previousHash !== journal.previousHash) {
      throw new StorageError(
        `OVERWRITE JOURNAL ${this.getOverwriteJournalPath()} CORRUPTED: previous data hash mismatch`,
        'CORRUPTED_DATA'
      );
    }

    let currentData: Record<string, any>[] | null = null;
    try {
      currentData = await this.readAllChunks();
      const currentHash = await this.computeHash(currentData);
      if (currentData.length === journal.targetCount && currentHash === journal.targetHash) {
        await this.deleteOverwriteJournal();
        return;
      }
    } catch (error) {
      logger.warn(`Current chunked table ${this.tableName} is incomplete while overwrite journal is pending`, error);
    }

    logger.warn(`Recovering chunked table ${this.tableName} from pending overwrite journal`);
    await this.clear();
    if (journal.previousData.length > 0) {
      await this.append(journal.previousData);
    }
    await this.deleteOverwriteJournal();
  }

  async read(): Promise<Record<string, any>[]> {
    return this.readAll();
  }

  async delete(): Promise<void> {
    await this.clear();
  }

  async append(data: Record<string, any>[]) {
    const writtenChunkIndices: number[] = [];
    try {
      this.validateArrayData(data);
      if (data.length === 0) return;
      await this.recoverPendingAppendJournal();

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
      const targetChunkIndices = chunksToWrite.map((_, index) => chunkIndex + index);
      await this.writeAppendJournal(currentMeta.count, chunkIndex, targetChunkIndices, data);
      const parallelLimit = 4;

      for (let i = 0; i < chunksToWrite.length; i += parallelLimit) {
        const batch = chunksToWrite.slice(i, i + parallelLimit);
        const results = await Promise.allSettled(
          batch.map((chunkData, batchIndex) => {
            const currentIndex = chunkIndex + i + batchIndex;
            return this.writeChunk(currentIndex, chunkData || []).then(() => currentIndex);
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            writtenChunkIndices.push(result.value);
          }
        }

        const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failedResult) {
          throw failedResult.reason;
        }
      }

      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        count: currentMeta.count + data.length,
        chunks: chunkIndex + chunksToWrite.length,
        updatedAt: Date.now(),
      });
      await this.persistMetadataIfSupported();
      await this.deleteAppendJournal();
    } catch (error) {
      let chunksCleaned = false;
      try {
        await this.deleteChunkFiles(writtenChunkIndices);
        chunksCleaned = true;
      } catch (cleanupError) {
        logger.error(`failed to remove partial chunks for table ${this.tableName}`, cleanupError);
      }
      if (chunksCleaned) {
        await this.deleteAppendJournal(true);
      }
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

    for (let index = 0; index < data.length; index++) {
      const item = data[index];

      if (!this.validateDataItem(item)) {
        throw new StorageError(`Invalid chunk data item at index ${index}`, 'FILE_CONTENT_INVALID');
      }

      try {
        const serialized = JSON.stringify(item);
        if (serialized === undefined) {
          throw new Error('JSON serialization returned undefined');
        }

        const itemSize = encoder.encode(serialized).byteLength + overhead;
        itemSizes.push(itemSize);
        validItems.push(item);
      } catch (error) {
        throw new StorageError(`Chunk data item at index ${index} is not JSON serializable`, 'FILE_CONTENT_INVALID', {
          cause: error,
        });
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
          this.chunkCache.delete(index);
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
    await this.recoverPendingOverwriteJournal();
    await this.recoverPendingAppendJournal();
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

      logger.debug(`Read chunk file ${filePath}, contentLength=${text.length}`);

      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object') {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: not valid JSON object`, 'CORRUPTED_DATA');
      }

      if (!Array.isArray(parsed.data) || parsed.hash === undefined) {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: missing data array or hash field`, 'CORRUPTED_DATA');
      }

      const isValid = await this.verifyHash(parsed.data, parsed.hash);
      if (!isValid) {
        logger.warn(`CHUNK ${filePath} CORRUPTED: hash mismatch`);
        logger.debug(`Expected hash: ${parsed.hash}, Actual hash: ${await this.computeHash(parsed.data)}`);
        throw new StorageError(`CHUNK ${filePath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      return parsed.data;
    } catch (error) {
      logger.error(`ERROR reading chunk file ${filePath}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ CHUNK ${filePath} FAILED`, error);
    }
  }

  clearChunkCache(): void {
    this.chunkCache.clear();
  }

  async readAll(): Promise<Record<string, any>[]> {
    await this.recoverPendingOverwriteJournal();
    await this.recoverPendingAppendJournal();
    return this.readAllChunks();
  }

  private async readAllChunks(): Promise<Record<string, any>[]> {
    const chunkFiles = await this.getChunkFiles();

    if (chunkFiles.length === 0) {
      const expectedChunks = this.metadataManager.get(this.tableName)?.chunks;
      if (expectedChunks && expectedChunks > 0) {
        throw new StorageError(
          `CHUNK SET ${this.tableName} INCOMPLETE: expected ${expectedChunks} chunks but found none`,
          'CORRUPTED_DATA'
        );
      }
      return [];
    }

    const chunkIndices = chunkFiles.map(filePath => {
      const fileName = filePath.split('/').pop() || '';
      return parseInt(fileName.replace(CHUNK_EXT, ''), 10);
    });
    const expectedChunks = this.metadataManager.get(this.tableName)?.chunks;
    const hasContiguousIndices = chunkIndices.every((chunkIndex, position) => chunkIndex === position);
    const matchesMetadata = expectedChunks === undefined || expectedChunks === chunkFiles.length;
    if (!hasContiguousIndices || !matchesMetadata) {
      throw new StorageError(
        `CHUNK SET ${this.tableName} INCOMPLETE: expected ${expectedChunks ?? 'contiguous'} chunks, found indices ${chunkIndices.join(',')}`,
        'CORRUPTED_DATA',
        {
          suggestion: 'Restore the missing chunk files from a known-good backup before reading the table',
        }
      );
    }

    const allChunkData = new Map<number, Record<string, any>[]>();
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
        allChunkData.set(index, cached);
      }
    }

    const parallelLimit = 6;

    for (let i = 0; i < filesToRead.length; i += parallelLimit) {
      const batchFiles = filesToRead.slice(i, i + parallelLimit);

      const batchPromises = batchFiles.map(async filePath => {
        const fileName = filePath.split('/').pop() || '';
        const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
        const data = await this.readChunkFile(filePath);

        if (data.length > 0 && this.chunkCache.size < this.maxCacheSize) {
          this.chunkCache.set(chunkIndex, data);
        }

        return { chunkIndex, data };
      });

      const batchResults = await Promise.all(batchPromises);
      for (const { chunkIndex, data } of batchResults) {
        allChunkData.set(chunkIndex, data);
      }
    }

    return [...allChunkData.entries()].sort(([left], [right]) => left - right).flatMap(([, data]) => data);
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
        const knownChunkCount = this.metadataManager.get(this.tableName)?.chunks ?? 0;
        const probeLimit = Math.max(20, knownChunkCount);
        for (let i = 0; i < probeLimit; i++) {
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
    await this.recoverPendingOverwriteJournal();
    await this.recoverPendingAppendJournal();
    const allChunkFiles = await this.getChunkFiles();
    const rangeChunkFiles = allChunkFiles.filter(filePath => {
      const fileName = filePath.split('/').pop() || '';
      const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      return fileIndex >= startIndex && fileIndex <= endIndex;
    });

    const chunkDataPromises = rangeChunkFiles.map(filePath => this.readChunkFile(filePath));

    const chunkDataArray = await Promise.all(chunkDataPromises);
    return chunkDataArray.flat();
  }

  async clear() {
    try {
      await withTimeout(
        getFileSystem().deleteAsync(this.tableDirPath, { idempotent: true }),
        10000,
        'DELETE TABLE DIRECTORY'
      );

      await withTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        'RECREATE TABLE DIRECTORY'
      );

      this.clearFileInfoCache(this.tableDirPath);
      this.chunkCache.clear();

      this.metadataManager.update(this.tableName, {
        count: 0,
        chunks: 0,
        updatedAt: Date.now(),
      });
      await this.persistMetadataIfSupported();
    } catch (error) {
      logger.error('CLEAR CHUNKED TABLE FAILED', error);
      throw this.formatDeleteError('CLEAR CHUNKED TABLE FAILED', error);
    }
  }
}
