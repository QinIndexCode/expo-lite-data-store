/**
 * @module DataReader
 * @description Data reader handling file system read and data processing
 * @since 2025-11-28
 * @version 1.0.0
 */

import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import type { ReadOptions } from '../../types/storageTypes';
import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import { CacheManager } from '../cache/CacheManager';
import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { SingleFileHandler } from '../file/SingleFileHandler';
import { IndexManager } from '../index/IndexManager';
import { QueryEngine } from '../query/QueryEngine';

export class DataReader {
  private indexManager: IndexManager;
  private metadataManager: IMetadataManager;
  private cacheManager: CacheManager;

  constructor(metadataManager: IMetadataManager, indexManager: IndexManager, cacheManager: CacheManager) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
    this.cacheManager = cacheManager;
  }

  private getSingleFile(tableName: string): SingleFileHandler {
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  private async recoverMissingTableMetadata(tableName: string) {
    const rootPath = getRootPathSync();
    const fileSystem = getFileSystem();
    const singleFilePath = `${rootPath}${tableName}.ldb`;
    const singleInfo = await fileSystem.getInfoAsync(singleFilePath);

    if (singleInfo.exists) {
      const rawContent = await withTimeout(
        fileSystem.readAsStringAsync(singleFilePath),
        10000,
        `recover single file metadata ${tableName}`
      );
      const parsed = JSON.parse(rawContent);
      if (!parsed || !Array.isArray(parsed.data) || parsed.hash === undefined) {
        return undefined;
      }

      const recoveredData = await withTimeout(
        this.getSingleFile(tableName).read(),
        10000,
        `recover single file table ${tableName}`
      );
      if (parsed.data.length > 0 && recoveredData.length === 0) {
        return undefined;
      }

      this.metadataManager.update(tableName, {
        mode: 'single',
        path: `${tableName}.ldb`,
        count: recoveredData.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
      });

      return this.metadataManager.get(tableName);
    }

    const chunkedDirPath = `${rootPath}${tableName}/`;
    const chunkedInfo = await fileSystem.getInfoAsync(chunkedDirPath);
    if (!chunkedInfo.exists) {
      return undefined;
    }

    const chunkEntries = await withTimeout(
      fileSystem.readDirectoryAsync(chunkedDirPath),
      10000,
      `recover chunked metadata ${tableName}`
    );
    const chunkFiles = chunkEntries.filter(entry => entry.endsWith('.ldb')).sort();
    if (chunkFiles.length === 0) {
      return undefined;
    }

    const recoveredData = await withTimeout(
      this.getChunkedHandler(tableName).readAll(),
      10000,
      `recover chunked table ${tableName}`
    );
    if (recoveredData.length === 0) {
      return undefined;
    }

    this.metadataManager.update(tableName, {
      mode: 'chunked',
      path: `${tableName}/`,
      count: recoveredData.length,
      chunks: chunkFiles.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      columns: {},
    });

    return this.metadataManager.get(tableName);
  }

  /**
   * Generate stable cache key regardless of property order
   */
  private generateCacheKey(options?: ReadOptions & { bypassCache?: boolean }): string {
    if (!options) {
      return '{}';
    }

    const plainOptions = options as Record<string, any>;

    const sortKeys = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sortKeys);
      const sorted: Record<string, any> = {};
      for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortKeys(obj[key]);
      }
      return sorted;
    };

    return JSON.stringify(sortKeys(plainOptions));
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const tableMeta = this.metadataManager.get(tableName) ?? (await this.recoverMissingTableMetadata(tableName));
        if (!tableMeta) {
          return [];
        }

        const tableIsHighRisk = tableMeta.isHighRisk || false;
        const shouldBypassCache = options?.bypassCache || tableIsHighRisk;

        let data: Record<string, any>[] = [];
        let useIndex = false;
        let indexedIds: string[] | number[] = [];

        if (!shouldBypassCache) {
          const cacheKey = `${tableName}_${this.generateCacheKey(options)}`;
          const cachedData = this.cacheManager.get(cacheKey);
          if (cachedData) {
            return cachedData;
          }
        }

        if (options?.filter) {
          if (
            typeof options.filter === 'object' &&
            options.filter !== null &&
            !('$or' in options.filter) &&
            !('$and' in options.filter)
          ) {
            const filterKeys = Object.keys(options.filter);
            for (const key of filterKeys) {
              if (this.indexManager.hasIndex(tableName, key)) {
                const value = (options.filter as Record<string, any>)[key];
                indexedIds = this.indexManager.queryIndex(tableName, key, value) as string[] | number[];
                useIndex = indexedIds.length > 0;
                break;
              }
            }
          }
        }

        if (tableMeta.mode === 'chunked') {
          const handler = this.getChunkedHandler(tableName);
          data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
        } else {
          const handler = this.getSingleFile(tableName);
          data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
        }

        if (useIndex) {
          data = data.filter(item => {
            const id = item['id'];
            if (typeof id === 'string') {
              return (indexedIds as string[]).includes(id);
            } else if (typeof id === 'number') {
              return (indexedIds as number[]).includes(id);
            }
            return false;
          });
        } else if (options?.filter) {
          data = QueryEngine.filter(data, options.filter);
        }

        if (options?.sortBy) {
          const sortAlgorithm = options.sortAlgorithm || configManager.getConfig().sortMethods;
          data = QueryEngine.sort(data, options.sortBy, options.order, sortAlgorithm);
        }

        data = QueryEngine.paginate(data, options?.skip, options?.limit);

        if (!shouldBypassCache) {
          const cacheKey = `${tableName}_${this.generateCacheKey(options)}`;
          this.cacheManager.set(cacheKey, data);

          const tableCacheKeysKey = `${tableName}_cache_keys`;
          const tableCacheKeys = (this.cacheManager.get(tableCacheKeysKey) as string[]) || [];
          if (!tableCacheKeys.includes(cacheKey)) {
            tableCacheKeys.push(cacheKey);
            this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
          }
        }

        return data;
      },
      error => StorageErrorHandler.createFileError('read', `table ${tableName}`, error)
    );
  }

  async findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const results = await this.read(tableName, { filter, limit: 1 });
        return results.length > 0 ? results[0] : null;
      },
      error => StorageErrorHandler.createQueryError('find one', tableName, error)
    );
  }

  async findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: {
      skip?: number;
      limit?: number;
      sortBy?: string | string[];
      order?: 'asc' | 'desc' | ('asc' | 'desc')[];
      sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
    }
  ): Promise<Record<string, any>[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        return await this.read(tableName, { filter, ...options });
      },
      error => StorageErrorHandler.createQueryError('find many', tableName, error)
    );
  }
}
