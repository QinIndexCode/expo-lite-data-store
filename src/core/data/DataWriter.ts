/**
 * @module DataWriter
 * @description Data writer handling insert, overwrite, update, and delete operations
 * @since 2025-11-19
 * @version 1.0.0
 */
import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { StorageError } from '../../types/storageErrorInfc';
import type { CreateTableOptions, WriteOptions, WriteResult } from '../../types/storageTypes';
import { ErrorHandler as StorageErrorHandler } from '../../utils/StorageErrorHandler';
import { getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import logger from '../../utils/logger';

import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { SingleFileHandler } from '../file/SingleFileHandler';
import { FileOperationManager } from '../FileOperationManager';
import { IndexManager } from '../index/IndexManager';
import type { ColumnSchema } from '../meta/MetadataManager';
import { QueryEngine } from '../query/QueryEngine';
export class DataWriter {
  private chunkSize: number;
  private indexManager: IndexManager;
  private metadataManager: IMetadataManager;
  private fileOperationManager: FileOperationManager;
  private countValidationCache = new Map<string, { lastCheckTime: number; isAccurate: boolean }>();
  private readonly VALIDATION_INTERVAL = 5 * 60 * 1000;
  private readonly MAX_VALIDATION_CACHE_SIZE = 100;
  private readonly LOCK_TIMEOUT = 30 * 1000;
  private operationLocks = new Map<string, Promise<void>>();
  private activeOperations = 0;
  private readonly maxConcurrentOperations: number;
  private operationQueue: Array<() => void> = [];

  constructor(
    metadataManager: IMetadataManager,
    indexManager: IndexManager,
    fileOperationManager: FileOperationManager
  ) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
    this.fileOperationManager = fileOperationManager;
    this.chunkSize = configManager.getConfig().chunkSize;
    this.maxConcurrentOperations = configManager.getConfig().performance.maxConcurrentOperations || 5;
  }

  private static readonly supportedColumnTypes: ColumnSchema[string][] = [
    'string',
    'number',
    'boolean',
    'date',
    'blob',
  ];

  private normalizeColumnSchema(
    columns?: Record<string, string | { type: string; isHighRisk?: boolean }>
  ): ColumnSchema {
    const schema: ColumnSchema = {};
    if (!columns) return schema;

    for (const [column, definition] of Object.entries(columns)) {
      let type: string;
      let isHighRisk = false;

      if (typeof definition === 'string') {
        type = definition;
      } else {
        type = definition.type;
        isHighRisk = definition.isHighRisk || false;
      }

      if (!DataWriter.supportedColumnTypes.includes(type as any)) {
        throw StorageErrorHandler.createGeneralError(
          `Unsupported column type: ${column}: ${type}`,
          'TABLE_COLUMN_INVALID',
          undefined,
          `Column '${column}' has an unsupported type '${type}'`,
          'Please use one of the supported types: string, number, boolean, date, blob'
        );
      }

      if (isHighRisk) {
        schema[column] = {
          type: type as 'string' | 'number' | 'boolean' | 'date' | 'blob',
          isHighRisk,
        };
      } else {
        schema[column] = type as ColumnSchema[string];
      }
    }
    return schema;
  }

  private getSingleFile(tableName: string): SingleFileHandler {
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  private shouldUseChunkedMode(data: Record<string, any>[]): boolean {
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
    return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
  }

  /**
   * Acquire operation lock for a table to serialize concurrent operations
   */
  private createLockTimeoutError(tableName: string): StorageError {
    return StorageErrorHandler.createGeneralError(
      `Lock acquisition timeout for table: ${tableName}`,
      'LOCK_TIMEOUT',
      undefined,
      `Failed to acquire lock within ${this.LOCK_TIMEOUT / 1000} seconds`,
      'This may indicate a deadlock or long-running operation. Please try again.'
    );
  }

  private releaseOperationSlot(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);

    if (this.operationQueue.length > 0 && this.activeOperations < this.maxConcurrentOperations) {
      const nextOperation = this.operationQueue.shift();
      if (nextOperation) {
        nextOperation();
      }
    }
  }

  private async acquireLock(tableName: string): Promise<() => void> {
    if (this.activeOperations >= this.maxConcurrentOperations) {
      await new Promise<void>(resolve => {
        this.operationQueue.push(resolve);
      });
    }

    const previousLock = this.operationLocks.get(tableName);

    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      resolveLock = resolve;
    });

    this.operationLocks.set(tableName, lockPromise);

    if (previousLock) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          previousLock,
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(this.createLockTimeoutError(tableName));
            }, this.LOCK_TIMEOUT);
          }),
        ]);
      } catch (error) {
        resolveLock!();
        if (this.operationLocks.get(tableName) === lockPromise) {
          this.operationLocks.delete(tableName);
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    this.activeOperations++;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      resolveLock!();
      if (this.operationLocks.get(tableName) === lockPromise) {
        this.operationLocks.delete(tableName);
      }
      this.releaseOperationSlot();
    };
  }

  async createTable(
    tableName: string,
    options: CreateTableOptions & {
      columns?: Record<string, string | { type: string; isHighRisk?: boolean }>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {}
  ): Promise<void> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        if (!tableName?.trim()) {
          throw StorageErrorHandler.createGeneralError(
            'Table name cannot be empty',
            'TABLE_NAME_INVALID',
            undefined,
            'Table name must be a non-empty string',
            'Please provide a valid table name'
          );
        }

        const releaseLock = await this.acquireLock(tableName);

        try {
          if (this.metadataManager.get(tableName)) {
            return;
          }

          await this.fileOperationManager.checkPermissions();

          const { columns = {}, initialData = [], mode = 'single' } = options;

          const actualMode = mode === 'chunked' || this.shouldUseChunkedMode(initialData) ? 'chunked' : 'single';

          if (actualMode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await withTimeout(handler.append(initialData), 10000, `create chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            await withTimeout(handler.write(initialData), 10000, `create single file table ${tableName}`);
          }

          this.metadataManager.update(tableName, {
            mode: actualMode,
            path: actualMode === 'chunked' ? `${tableName}/` : `${tableName}.ldb`,
            count: initialData.length,
            chunks: actualMode === 'chunked' ? 1 : 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            columns: this.normalizeColumnSchema(columns),
            isHighRisk: options.isHighRisk || false,
            highRiskFields: options.highRiskFields || [],
            encryptedFields: options.encryptedFields || [],
            encrypted: options.encrypted || false,
            encryptFullTable: options.encryptFullTable || false,
          });
        } finally {
          releaseLock();
        }
      },
      error => {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
          logger.error('[DataWriter.createTable] failed:', {
            tableName,
            options,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        return StorageErrorHandler.createTableError('create', tableName, error);
      }
    );
  }

  async deleteTable(tableName: string): Promise<void> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const releaseLock = await this.acquireLock(tableName);

        try {
          const tableMeta = this.metadataManager.get(tableName);

          if (tableMeta?.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await withTimeout(handler.clear(), 10000, `delete chunked table ${tableName}`);
          } else {
            await withTimeout(
              Promise.allSettled([
                this.getSingleFile(tableName).delete(),
                getFileSystem().deleteAsync(`${getRootPathSync()}${tableName}`, { idempotent: true }),
              ]),
              10000,
              `delete table ${tableName}`
            );
          }

          this.indexManager.clearTableIndexes(tableName);
          this.metadataManager.delete(tableName);
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createTableError('delete', tableName, error)
    );
  }

  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const items = Array.isArray(data) ? data : [data];

        if (items.length === 0 && options?.mode !== 'overwrite') {
          return await this.handleEmptyData(tableName);
        }

        if (items.length > 0) {
          this.validateWriteData(items);
        }

        await this.ensureTableExists(tableName);

        const releaseLock = await this.acquireLock(tableName);

        try {
          await this.fileOperationManager.checkPermissions();

          const tableMeta = this.metadataManager.get(tableName);

          const writeResult = await this.executeWriteOperation(tableName, items, options, tableMeta);

          await this.updateIndexes(tableName, items, options?.mode === 'overwrite');

          await this.updateTableMetadata(tableName, writeResult.final.length);

          return {
            written: items.length,
            totalAfterWrite: writeResult.final.length,
            chunked: writeResult.isChunked,
          };
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createFileError('write', `table ${tableName}`, error)
    );
  }

  private async handleEmptyData(tableName: string): Promise<WriteResult> {
    return {
      written: 0,
      totalAfterWrite: await this.count(tableName),
      chunked: false,
    };
  }

  private async ensureTableExists(tableName: string): Promise<void> {
    if (!(await this.hasTable(tableName))) {
      await this.createTable(tableName);
    }
  }

  private async executeWriteOperation(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean },
    tableMeta?: any
  ): Promise<{ final: Record<string, any>[]; isChunked: boolean }> {
    let final: Record<string, any>[];
    let isChunked = false;

    if (tableMeta?.mode === 'chunked') {
      final = await this.writeToChunkedTable(tableName, items, options);
      isChunked = true;
    } else {
      final = await this.writeToSingleFileTable(tableName, items, options);
    }

    return { final, isChunked };
  }

  private async writeToChunkedTable(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<Record<string, any>[]> {
    const handler = this.getChunkedHandler(tableName);
    let final: Record<string, any>[];

    if (options?.mode === 'overwrite') {
      await withTimeout(handler.write(items), 10000, `write to chunked table ${tableName}`);
      final = items;
    } else {
      final = [...(await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`)), ...items];
      await withTimeout(handler.append(items), 10000, `append to chunked table ${tableName}`);
    }

    return final;
  }

  private async writeToSingleFileTable(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<Record<string, any>[]> {
    const handler = this.getSingleFile(tableName);

    const existing =
      options?.mode === 'overwrite'
        ? []
        : await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);

    const final = options?.mode === 'overwrite' ? items : [...existing, ...items];

    await withTimeout(handler.write(final), 10000, `write to single file table ${tableName}`);

    return final;
  }

  private async updateIndexes(tableName: string, items: Record<string, any>[], isOverwrite: boolean): Promise<void> {
    try {
      if (isOverwrite) {
        this.indexManager.clearTableIndexes(tableName);
        this.indexManager.rebuildIndexes(
          tableName,
          items.filter(item => item.id !== undefined)
        );
      } else {
        for (const item of items) {
          if (item.id !== undefined) {
            this.indexManager.addToIndex(tableName, item);
          }
        }
      }
    } catch (error) {
      logger.error(`[DataWriter.updateIndexes] Failed to update indexes for table ${tableName}:`, error);
      if (isOverwrite) {
        logger.warn(`[DataWriter.updateIndexes] Reverting to full index rebuild for table ${tableName}`);
        this.indexManager.clearTableIndexes(tableName);
      }
    }
  }

  private async updateTableMetadata(tableName: string, newCount: number): Promise<void> {
    this.metadataManager.update(tableName, {
      count: newCount,
      updatedAt: Date.now(),
    });
  }

  private validateWriteData(data: Record<string, any>[]): void {
    StorageErrorHandler.handleSyncError(
      () => {
        if (!Array.isArray(data)) {
          throw StorageErrorHandler.createGeneralError(
            'Invalid data format',
            'FILE_CONTENT_INVALID',
            undefined,
            `Expected array of records, received ${typeof data}`,
            'Please provide an array of records or a single record'
          );
        }

        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          if (typeof item !== 'object' || item === null) {
            throw StorageErrorHandler.createGeneralError(
              `Invalid data item at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              `Expected object, received ${typeof item}`,
              'Please provide valid objects for all items'
            );
          }

          if (Object.keys(item).length === 0) {
            throw StorageErrorHandler.createGeneralError(
              `Empty object at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              'Object must contain at least one field',
              'Please provide objects with valid fields'
            );
          }

          const hasValidValue = Object.values(item).some(value => value !== undefined);
          if (!hasValidValue) {
            throw StorageErrorHandler.createGeneralError(
              `Invalid object at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              'Object must contain at least one valid (non-undefined) value',
              'Please provide objects with valid values for at least one field'
            );
          }

          for (const [key, value] of Object.entries(item)) {
            if (value === undefined) {
              throw StorageErrorHandler.createGeneralError(
                `Undefined value for field '${key}' at index ${i}`,
                'FILE_CONTENT_INVALID',
                undefined,
                'Fields cannot have undefined values',
                'Please provide valid values for all fields'
              );
            }
          }
        }
      },
      error => error as StorageError
    );
  }

  async hasTable(tableName: string): Promise<boolean> {
    return this.metadataManager.get(tableName) !== undefined;
  }

  async count(tableName: string): Promise<number> {
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      return 0;
    }

    const metadataCount = this.metadataManager.count(tableName);
    await this.validateCountAsync(tableName);

    return metadataCount;
  }

  /**
   * Async count validation (non-blocking, lazy strategy)
   */
  private async validateCountAsync(tableName: string): Promise<void> {
    const validationInfo = this.countValidationCache.get(tableName);
    const now = Date.now();

    if (validationInfo && now - validationInfo.lastCheckTime < this.VALIDATION_INTERVAL) {
      return;
    }

    try {
      const tableMeta = this.metadataManager.get(tableName);
      if (!tableMeta) return;

      if (now - tableMeta.updatedAt > 24 * 60 * 60 * 1000) {
        this.countValidationCache.set(tableName, { lastCheckTime: now, isAccurate: true });
        return;
      }

      const actualCount = await this.getActualCount(tableName);
      const metadataCount = this.metadataManager.count(tableName);

      this.countValidationCache.set(tableName, {
        lastCheckTime: now,
        isAccurate: actualCount === metadataCount,
      });

      this.cleanupValidationCache();

      if (actualCount !== metadataCount) {
        logger.warn(
          `[DataWriter] Count mismatch detected for table '${tableName}': ` +
            `metadata=${metadataCount}, actual=${actualCount}. Auto-correcting...`
        );
        this.metadataManager.update(tableName, {
          count: actualCount,
          updatedAt: now,
        });
      }
    } catch (error) {
      logger.error(`[DataWriter] Failed to validate count for table '${tableName}':`, error);
    }
  }

  private cleanupValidationCache(): void {
    if (this.countValidationCache.size > this.MAX_VALIDATION_CACHE_SIZE) {
      const entries = Array.from(this.countValidationCache.entries());
      entries.sort((a, b) => a[1].lastCheckTime - b[1].lastCheckTime);
      const toRemove = entries.slice(0, this.countValidationCache.size - this.MAX_VALIDATION_CACHE_SIZE + 1);
      toRemove.forEach(([key]) => {
        this.countValidationCache.delete(key);
      });
    }
  }

  private async getActualCount(tableName: string): Promise<number> {
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) return 0;

    try {
      let data: Record<string, any>[];
      if (tableMeta.mode === 'chunked') {
        const handler = this.getChunkedHandler(tableName);
        data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
      } else {
        const handler = this.getSingleFile(tableName);
        data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
      }
      return data.length;
    } catch (error) {
      return this.metadataManager.count(tableName);
    }
  }

  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const metadataCount = this.metadataManager.count(tableName);
    const actualCount = await this.getActualCount(tableName);
    const match = metadataCount === actualCount;

    if (!match) {
      this.metadataManager.update(tableName, {
        count: actualCount,
        updatedAt: Date.now(),
      });
    }

    return { metadata: metadataCount, actual: actualCount, match };
  }

  async delete(tableName: string, where: Record<string, any>): Promise<number> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        await this.fileOperationManager.checkPermissions();

        const tableMeta = this.metadataManager.get(tableName);
        if (!tableMeta) {
          return 0;
        }

        const releaseLock = await this.acquireLock(tableName);

        try {
          let data: Record<string, any>[];
          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
          }

          const filteredData = data.filter(item => {
            return !QueryEngine.filter([item], where).length;
          });

          const deletedCount = data.length - filteredData.length;

          if (deletedCount === 0) {
            return 0;
          }

          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await withTimeout(handler.write(filteredData), 10000, `write to chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            await withTimeout(handler.write(filteredData), 10000, `write to single file table ${tableName}`);
          }

          try {
            this.indexManager.clearTableIndexes(tableName);
            for (const item of filteredData) {
              if (item.id !== undefined) {
                this.indexManager.addToIndex(tableName, item);
              }
            }
          } catch (error) {
            logger.error(`[DataWriter.delete] Failed to update indexes for table ${tableName}:`, error);
            this.indexManager.clearTableIndexes(tableName);
          }

          this.metadataManager.update(tableName, {
            count: filteredData.length,
            updatedAt: Date.now(),
          });

          return deletedCount;
        } finally {
          releaseLock();
        }
      },
      error => StorageErrorHandler.createFileError('delete from', `table ${tableName}`, error)
    );
  }
}
