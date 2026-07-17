/**
 * @module DataReader
 * @description Data reader handling file system read and data processing
 * @since 2025-11-28
 * @version 3.0.0
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
import { assertValidTableName } from '../../utils/tableName';
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
    assertValidTableName(tableName);
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    assertValidTableName(tableName);
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
  private isCacheKeySerializable(value: unknown, seen = new WeakSet<object>()): boolean {
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') {
      return true;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value);
    }

    if (typeof value !== 'object') {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.every(item => item !== undefined && this.isCacheKeySerializable(item, seen));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }

    return Object.keys(value).every(key => {
      const child = (value as Record<string, unknown>)[key];
      return child === undefined || this.isCacheKeySerializable(child, seen);
    });
  }

  private generateCacheKey(options?: ReadOptions & { bypassCache?: boolean }): string | undefined {
    if (!options) {
      return '{}';
    }

    try {
      if (!this.isCacheKeySerializable(options)) {
        return undefined;
      }

      const sortKeys = (obj: unknown): unknown => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(sortKeys);
        const sorted: Record<string, unknown> = Object.create(null);
        for (const key of Object.keys(obj).sort()) {
          const value = (obj as Record<string, unknown>)[key];
          if (value !== undefined) {
            sorted[key] = sortKeys(value);
          }
        }
        return sorted;
      };

      return JSON.stringify(sortKeys(options));
    } catch {
      return undefined;
    }
  }

  /**
   * Records originate from JSON-backed storage, so a JSON clone preserves the
   * public data contract while keeping cache-owned state private.
   */
  private cloneRecords(records: Record<string, any>[]): Record<string, any>[] {
    return JSON.parse(JSON.stringify(records)) as Record<string, any>[];
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
        const serializedOptions = shouldBypassCache ? undefined : this.generateCacheKey(options);
        const cacheKey = serializedOptions === undefined ? undefined : `${tableName}_${serializedOptions}`;

        let data: Record<string, any>[] = [];
        let indexedIdSet: Set<string | number> | undefined;

        if (cacheKey !== undefined) {
          const cachedData = this.cacheManager.get(cacheKey);
          if (cachedData) {
            return this.cloneRecords(cachedData as Record<string, any>[]);
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
                const indexedIds = this.indexManager.queryIndex(tableName, key, value);
                if (indexedIds.length > 0) {
                  indexedIdSet = new Set<string | number>(indexedIds);
                }
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

        if (indexedIdSet) {
          data = data.filter(item => indexedIdSet.has(item['id']));
        }

        if (options?.filter) {
          data = QueryEngine.filter(data, options.filter);
        }

        if (options?.sortBy) {
          const sortAlgorithm = options.sortAlgorithm || configManager.getConfig().sortMethods;
          data = QueryEngine.sort(data, options.sortBy, options.order, sortAlgorithm);
        }

        data = QueryEngine.paginate(data, options?.skip, options?.limit);

        if (cacheKey !== undefined) {
          this.cacheManager.set(cacheKey, this.cloneRecords(data));

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
