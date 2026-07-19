import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import {
  isStorageRecord,
  type FilterCondition,
  type FindOptions,
  type ReadOptions,
  type StorageRecord,
} from '../../types/storageTypes';
import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import { CacheManager } from '../cache/CacheManager';
import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { SingleFileHandler } from '../file/SingleFileHandler';
import { assertValidTableName } from '../../utils/tableName';
import { getStableIndexId, IndexManager } from '../index/IndexManager';
import type { TableSchema } from '../meta/MetadataManager';
import { QueryEngine } from '../query/QueryEngine';
import { StorageError } from '../../types/storageErrorInfc';

const MAX_STABLE_READ_ATTEMPTS = 3;

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
    return new SingleFileHandler(filePath, async () =>
      this.metadataManager.getPersisted
        ? await this.metadataManager.getPersisted(tableName)
        : this.metadataManager.get(tableName)
    );
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    assertValidTableName(tableName);
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  private async getLatestTableMetadata(tableName: string): Promise<TableSchema | undefined> {
    const cachedMetadata = this.metadataManager.get(tableName);
    const latestMetadata = this.metadataManager.getLatest
      ? await this.metadataManager.getLatest(tableName)
      : cachedMetadata;

    if (latestMetadata !== cachedMetadata) {
      this.cacheManager.invalidateNamespace(tableName);
      this.indexManager.invalidateTableIndexes(tableName);
    }

    return latestMetadata;
  }

  private async readRepresentation(tableName: string, mode: 'single' | 'chunked'): Promise<StorageRecord[]> {
    if (mode === 'chunked') {
      return withTimeout(this.getChunkedHandler(tableName).readAll(), 10000, `read chunked table ${tableName}`);
    }

    return withTimeout(this.getSingleFile(tableName).read(), 10000, `read single file table ${tableName}`);
  }

  private async readCurrentRepresentation(
    tableName: string,
    initialMode: 'single' | 'chunked'
  ): Promise<StorageRecord[]> {
    try {
      return await this.readRepresentation(tableName, initialMode);
    } catch (error) {
      const latestMetadata = await this.getLatestTableMetadata(tableName);
      if (!latestMetadata) {
        return [];
      }
      if (latestMetadata.mode === initialMode) {
        throw error;
      }

      return this.readRepresentation(tableName, latestMetadata.mode);
    }
  }

  /** Rejects values that JSON cannot represent deterministically in a cache key. */
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

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }

    return Object.keys(value).every(key => {
      const child = (value as Record<string, unknown>)[key];
      return child === undefined || this.isCacheKeySerializable(child, seen);
    });
  }

  private generateCacheKey(options?: ReadOptions<StorageRecord> & { bypassCache?: boolean }): string | undefined {
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
        const sorted = Object.create(null) as Record<string, unknown>;
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
  private cloneRecords(records: StorageRecord[]): StorageRecord[] {
    const cloned: unknown = JSON.parse(JSON.stringify(records)) as unknown;
    if (!Array.isArray(cloned) || !cloned.every(isStorageRecord)) {
      throw StorageErrorHandler.createGeneralError('Stored records could not be cloned safely', 'FILE_CONTENT_INVALID');
    }
    return cloned;
  }

  async read(
    tableName: string,
    options?: ReadOptions<StorageRecord> & { bypassCache?: boolean }
  ): Promise<StorageRecord[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt++) {
          const tableMeta = await this.getLatestTableMetadata(tableName);
          if (!tableMeta) {
            return [];
          }

          const tableIsHighRisk = tableMeta.isHighRisk || false;
          const shouldBypassCache = options?.bypassCache || tableIsHighRisk;
          const serializedOptions = shouldBypassCache ? undefined : this.generateCacheKey(options);
          const cacheKey =
            serializedOptions === undefined
              ? undefined
              : `${tableName}_${this.cacheManager.getNamespaceVersion(tableName)}_${serializedOptions}`;

          if (cacheKey !== undefined) {
            const cachedData = this.cacheManager.get<StorageRecord[]>(cacheKey);
            if (cachedData) {
              const metadataAfterCacheRead = await this.getLatestTableMetadata(tableName);
              if (metadataAfterCacheRead === tableMeta) {
                return this.cloneRecords(cachedData);
              }
              continue;
            }
          }

          let data = await this.readCurrentRepresentation(tableName, tableMeta.mode);
          const metadataAfterPhysicalRead = await this.getLatestTableMetadata(tableName);
          if (metadataAfterPhysicalRead !== tableMeta) {
            continue;
          }

          let indexedIdSet: Set<string | number> | undefined;
          if (options?.filter) {
            if (isStorageRecord(options.filter) && !('$or' in options.filter) && !('$and' in options.filter)) {
              const filterRecord = options.filter as StorageRecord;
              const filterKeys = Object.keys(filterRecord);
              for (const key of filterKeys) {
                if (this.indexManager.hasIndex(tableName, key)) {
                  const value = filterRecord[key];
                  if (typeof value !== 'string' && typeof value !== 'number') {
                    continue;
                  }
                  const indexedIds = this.indexManager.queryIndex(tableName, key, value);
                  indexedIdSet = new Set<string | number>(indexedIds);
                  break;
                }
              }
            }
          }

          if (indexedIdSet) {
            data =
              indexedIdSet.size === 0
                ? []
                : data.filter(item => {
                    const id = getStableIndexId(item);
                    return id !== undefined && indexedIdSet.has(id);
                  });
          }

          if (options?.filter) {
            data = QueryEngine.filter(data, options.filter);
          }

          if (options?.sortBy) {
            const sortAlgorithm = options.sortAlgorithm || configManager.getConfig().sortMethods;
            data = QueryEngine.sort(data, options.sortBy, options.order, sortAlgorithm);
          }

          data = QueryEngine.paginate(data, options?.skip, options?.limit);

          const metadataAfterQuery = await this.getLatestTableMetadata(tableName);
          if (metadataAfterQuery !== tableMeta) {
            continue;
          }

          if (cacheKey !== undefined) {
            this.cacheManager.set(cacheKey, this.cloneRecords(data));
          }

          return data;
        }

        throw new StorageError(`Table '${tableName}' changed repeatedly during read`, 'TABLE_READ_FAILED', {
          details: 'A stable metadata generation could not be observed within the bounded retry limit.',
          suggestion: 'Retry the read after concurrent writes have settled.',
          tableName,
        });
      },
      error => StorageErrorHandler.createFileError('read', `table ${tableName}`, error)
    );
  }

  async findOne(tableName: string, filter: FilterCondition<StorageRecord>): Promise<StorageRecord | null> {
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
    filter?: FilterCondition<StorageRecord>,
    options?: FindOptions<StorageRecord>
  ): Promise<StorageRecord[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        return await this.read(tableName, { filter, ...options });
      },
      error => StorageErrorHandler.createQueryError('find many', tableName, error)
    );
  }
}
