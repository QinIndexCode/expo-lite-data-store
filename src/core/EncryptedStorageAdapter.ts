/**
 * @module EncryptedStorageAdapter
 * @description Encrypted storage adapter decorator with field-level encryption
 * @since 2025-11-19
 * @version 2.0.0
 */
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../types/storageTypes';
import {
  decrypt,
  getMasterKey,
  decryptFields,
  decryptBulk,
  decryptFieldsBulk,
  encrypt,
  encryptFieldsBulk,
  encryptFields,
} from '../utils/crypto';
import { configManager } from './config/ConfigManager';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler as StorageErrorHandler } from '../utils/StorageErrorHandler';
import { QueryEngine } from './query/QueryEngine';
export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string> | null = null;
  private cachedData: Map<string, { data: Record<string, any>[]; timestamp: number }> = new Map();
  private cacheTimeout = configManager.getConfig().encryption.cacheTimeout; // Read cache timeout from config
  private maxCacheSize = configManager.getConfig().encryption.maxCacheSize; // Read max cache size from config
  private requireAuthOnAccess: boolean = false;

  // Optimization: Add query index cache
  private queryIndexes: Map<string, Map<string, Map<string | number, Record<string, any>[]>>> = new Map();

  /**
   * 构造函数
   * @param options 加密存储适配器配置选项
   */
  constructor(options?: { requireAuthOnAccess?: boolean }) {
    this.requireAuthOnAccess = options?.requireAuthOnAccess ?? false;
    this.validateConfig();
  }

  /**
   * 获取或初始化密钥
   * 延迟初始化，只有在实际需要使用密钥时才调用getMasterKey()，避免不必要的生物识别/密码识别
   */
  private async getOrInitKey(): Promise<string> {
    if (this.requireAuthOnAccess) {
      return getMasterKey(true);
    }

    if (!this.keyPromise) {
      this.keyPromise = getMasterKey(false);
    }
    return this.keyPromise;
  }

  async ensureInitialized(): Promise<void> {
    if (typeof (storage as any).ensureInitialized === 'function') {
      await (storage as any).ensureInitialized();
    }

    if (this.requireAuthOnAccess) {
      await this.getOrInitKey();
    }
  }

  /**
   * 验证加密配置的合理性
   */
  private validateConfig(): void {
    const config = configManager.getConfig();
    // ValidateHMAC算法
    if (!['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)) {
      throw new Error(
        `Invalid HMAC algorithm: ${config.encryption.hmacAlgorithm}. Must be either 'SHA-256' or 'SHA-512'.`
      );
    }

    // ValidatePBKDF2迭代次数
    if (config.encryption.keyIterations < 10000 || config.encryption.keyIterations > 1000000) {
      throw new Error(`Invalid key iterations: ${config.encryption.keyIterations}. Must be between 10000 and 1000000.`);
    }

    // Validate缓存超时时间

    if (config.encryption.cacheTimeout < 0 || config.encryption.cacheTimeout > 3600000) {
      throw new Error(
        `Invalid cache timeout: ${config.encryption.cacheTimeout}. Must be between 0 and 3600000 (1 hour).`
      );
    }

    // Validate最大缓存大小
    if (config.encryption.maxCacheSize < 1 || config.encryption.maxCacheSize > 1000) {
      throw new Error(`Invalid max cache size: ${config.encryption.maxCacheSize}. Must be between 1 and 1000.`);
    }

    // Validate批量操作配置
    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      throw new Error(`Invalid useBulkOperations value: ${config.encryption.useBulkOperations}. Must be a boolean.`);
    }

    // Validate字段级加密配置
    if (config.encryption.encryptedFields !== undefined && !Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private async key() {
    return await this.getOrInitKey();
  }

  private async getTableMeta(tableName: string) {
    if (typeof (storage as any).ensureInitialized === 'function') {
      await (storage as any).ensureInitialized();
    }
    return (storage as any).getTableMeta(tableName);
  }

  /**
   * 清除特定表的缓存
   */
  private clearTableCache(tableName: string): void {
    this.cachedData.delete(tableName);
    this.queryIndexes.delete(tableName);
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cachedData.clear();
    this.queryIndexes.clear();
  }

  /**
   * 管理缓存大小，防止内存溢出
   * 同时清理对应的查询索引缓存
   */
  private manageCacheSize(): void {
    if (this.cachedData.size > this.maxCacheSize) {
      // Cleanup最旧的缓存条目
      const entries = Array.from(this.cachedData.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // Remove最旧的条目，直到缓存大小回到安全范围内
      const toRemove = entries.slice(0, this.cachedData.size - this.maxCacheSize + 1);
      toRemove.forEach(([tableName]) => {
        this.cachedData.delete(tableName);
        // Also clear corresponding query index
        this.queryIndexes.delete(tableName);
      });
    }
  }

  /**
   * 构建查询索引（优化单字段查询）
   */
  private buildQueryIndex(tableName: string, field: string): void {
    const cached = this.cachedData.get(tableName);
    if (!cached) return;

    const index = new Map<string | number, Record<string, any>[]>();
    for (const item of cached.data) {
      const value = item[field];
      if (value !== undefined && value !== null) {
        const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(item);
      }
    }

    if (!this.queryIndexes.has(tableName)) {
      this.queryIndexes.set(tableName, new Map());
    }
    this.queryIndexes.get(tableName)!.set(field, index);
  }

  async createTable(
    tableName: string,
    options?: CreateTableOptions & {
      columns?: Record<string, string>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
      enableFieldLevelEncryption?: boolean;
      encryptedFields?: string[];
    }
  ) {
    return storage.createTable(tableName, options);
  }

  async deleteTable(tableName: string, _options?: any) {
    return storage.deleteTable(tableName, _options);
  }

  async hasTable(tableName: string, _options?: any) {
    return storage.hasTable(tableName, _options);
  }

  async listTables(_options?: any) {
    return storage.listTables(_options);
  }

  /**
   * 覆盖数据（总是使用覆盖模式）
   * @param tableName 表名
   * @param data 要覆盖的数据
   * @param options 写入选项（mode将被强制设为overwrite）
   * @returns Promise<WriteResult>
   */
  async overwrite(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = Array.isArray(data) ? data : [data];
        const key = await this.key();

        let encryptedData: Record<string, any>[] = [];

        // Get配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Decide which encryption strategy to use
        const useFieldLevelEncryption =
          options?.encryptFullTable !== true &&
          (options?.encryptFullTable !== false ||
            tableMeta?.encryptedFields?.length > 0 ||
            (config.encryption.encryptedFields && config.encryption.encryptedFields.length > 0) ||
            !tableMeta?.encryptedFields);

        if (useFieldLevelEncryption) {
          // Field-level encryption mode
          const encryptedFields =
            tableMeta?.encryptedFields?.length > 0
              ? tableMeta.encryptedFields
              : config.encryption.encryptedFields || [];

          if (encryptedFields.length > 0) {
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              encryptedData = await encryptFieldsBulk(finalData, {
                fields: encryptedFields,
                masterKey: key,
              });
            } else {
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: encryptedFields,
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          } else {
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              encryptedData = await encryptFieldsBulk(finalData, {
                fields: Object.keys(finalData[0] || {}),
                masterKey: key,
              });
            } else {
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: Object.keys(item),
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          }

          return storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
        } else {
          // Full table encryption mode
          const shouldEncryptFullTable = options?.encryptFullTable === true;
          if (shouldEncryptFullTable) {
            // Overwrite mode: Direct encrypted write
            const serializedData = JSON.stringify(finalData);
            const encrypted = await encrypt(serializedData, key);
            encryptedData = [{ __enc: encrypted }];

            // Clear cache because data was overwritten
            const cacheKey = `__enc_full_table_${tableName}`;
            (this.cachedData as any).delete(cacheKey);
          }
        }

        return storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to overwrite table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = Array.isArray(data) ? data : [data];
        const key = await this.key();

        let encryptedData: Record<string, any>[] = [];

        // Get配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Encrypt写入策略：
        // 1. 优先使用字段级加密（性能更好，支持增量写入）
        // 2. 整表加密作为备选，但优化其append操作

        // Decide which encryption strategy to use
        // Optimization: Prefer field-level encryption for better performance，默认情况下即使没有配置encryptedFields也使用字段级加密
        // Only use full-table encryption when encryptFullTable is explicitly true
        // Prefer table metadata encryption config
        const tableEncryptFullTable = tableMeta?.encryptFullTable || false;
        const tableEncrypted = tableMeta?.encrypted || options?.encrypted || false;

        const useFieldLevelEncryption =
          options?.encryptFullTable !== true &&
          !tableEncryptFullTable && // Only skip field-level encryption when full-table is explicitly set
          (tableEncrypted || // If table is encrypted, default to field-level
            options?.encryptFullTable !== false || // Or field-level encryption not explicitly disabled
            tableMeta?.encryptedFields?.length > 0 || // Or table has encrypted fields configured
            (config.encryption.encryptedFields && config.encryption.encryptedFields.length > 0) || // Or global encrypted fields configured
            !tableMeta?.encryptedFields); // Or table has no encrypted fields config (default to field-level)

        if (useFieldLevelEncryption) {
          // Field-level encryption mode - 性能更好，支持增量写入
          // Prefer table metadata encrypted fields over global config
          const encryptedFields =
            tableMeta?.encryptedFields?.length > 0
              ? tableMeta.encryptedFields
              : config.encryption.encryptedFields || [];

          // Without specified fields, still use field-level (encrypt all fields)
          // This gives better performance while maintaining security
          if (encryptedFields.length > 0) {
            // Has specified fields, encrypt only those
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              // Batch field-level encryption - 只加密新增数据
              encryptedData = await encryptFieldsBulk(finalData, {
                fields: encryptedFields,
                masterKey: key,
              });
            } else {
              // Single field-level encryption - 只加密新增数据
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: encryptedFields,
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          } else {
            // No fields specified, encrypt all fields
            // This is the optimization key: by default，即使没有配置encryptedFields，也使用字段级加密
            // This gives better performance than full-table encryption
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              // Batch encrypt all fields
              encryptedData = await encryptFieldsBulk(finalData, {
                fields: Object.keys(finalData[0] || {}), // Encrypt所有字段
                masterKey: key,
              });
            } else {
              // Single encrypt all fields
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: Object.keys(item), // Encrypt所有字段
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          }

          // Field-level encryption supports direct append，不需要重新加密整个表
          // Removeencrypted选项，因为数据已经被加密了，避免重复加密
          const { encrypted, requireAuthOnAccess, ...writeOptions } = options || {};
          return storage.write(tableName, encryptedData, writeOptions);
        } else {
          // Full table encryption mode - 仅在明确要求时使用
          const shouldEncryptFullTable = options?.encryptFullTable === true || tableMeta?.encryptFullTable || false;
          if (shouldEncryptFullTable) {
            // Check写入模式
            if (options?.mode === 'append') {
              // Full-table encryption append mode optimization
              // Optimization 1: Use cache to reduce repeated decryption
              // Optimization 2: Encrypt only new data, not entire table
              // Optimization 3: Use incremental encryption strategy

              // Try to get decrypted data from cache
              let cachedDecryptedData = null;

              // Read existing encrypted data first
              const existingEncrypted = await storage.read(tableName, { bypassCache: true });
              let combinedData = finalData;

              if (existingEncrypted.length > 0 && existingEncrypted[0].__enc) {
                // Check if有有效缓存
                const cacheKey = `__enc_full_table_${tableName}`;
                const cacheEntry = (this.cachedData as any).get(cacheKey);

                // If cache is valid (within 1 min), use cached data
                if (cacheEntry && Date.now() - cacheEntry.timestamp < 60000) {
                  cachedDecryptedData = cacheEntry.data;
                  combinedData = Array.isArray(cachedDecryptedData)
                    ? [...cachedDecryptedData, ...finalData]
                    : [...[cachedDecryptedData], ...finalData];
                } else {
                  // Cache无效，解密现有数据
                  const decrypted = await decrypt(existingEncrypted[0].__enc, key);
                  const existingData = JSON.parse(decrypted);
                  combinedData = Array.isArray(existingData)
                    ? [...existingData, ...finalData]
                    : [...[existingData], ...finalData];

                  // Update缓存
                  (this.cachedData as any).set(cacheKey, {
                    data: combinedData,
                    timestamp: Date.now(),
                  });
                }
              }

              // Optimization 4: Use more efficient serialization and encryption
              const serializedData = JSON.stringify(combinedData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
            } else {
              // Overwrite mode: Direct encrypted write
              const serializedData = JSON.stringify(finalData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];

              // Clear cache because data was overwritten
              const cacheKey = `__enc_full_table_${tableName}`;
              (this.cachedData as any).delete(cacheKey);
            }
          } else {
            // Not explicitly required full-table, check if table needs encryption
            if (tableEncrypted || options?.encrypted) {
              // Table is encrypted, use field-level encryption（默认行为）
              if (config.encryption.useBulkOperations && finalData.length > 1) {
                // Batch field-level encryption - 只加密新增数据
                encryptedData = await encryptFieldsBulk(finalData, {
                  fields: Object.keys(finalData[0] || {}), // Encrypt所有字段
                  masterKey: key,
                });
              } else {
                // Single field-level encryption - 只加密新增数据
                const encryptionPromises = finalData.map(item =>
                  encryptFields(item, {
                    fields: Object.keys(item), // Encrypt所有字段
                    masterKey: key,
                  })
                );
                encryptedData = await Promise.all(encryptionPromises);
              }
            }
          }
        }

        // If encryptedData is empty且表是加密的，说明加密逻辑没有被正确执行
        // This should not happen，如果发生应该抛出错误
        if (encryptedData.length === 0) {
          if (tableEncrypted || options?.encrypted) {
            throw new Error('Encryption logic was not executed for encrypted table');
          }
          encryptedData = finalData;
        }

        // Removeencrypted和requireAuthOnAccess选项，因为数据已经被加密了，避免重复加密
        const { encrypted: encOpt, requireAuthOnAccess: reqAuth, ...finalWriteOptions } = options || {};
        return storage.write(tableName, encryptedData, { ...finalWriteOptions, mode: options?.mode });
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // If cache timeout is 0，清除所有缓存并禁用缓存
        if (this.cacheTimeout === 0) {
          this.cachedData.clear();
          this.queryIndexes.clear();
        }

        // Always read latest data from underlying adapter，忽略缓存
        // Ensures we get latest disk data，包括刚提交的事务数据
        // Only pass read-related options，不传递查询相关的选项
        const readOptions = options ? { bypassCache: options.bypassCache } : undefined;
        const raw = await storage.read(tableName, readOptions);
        if (raw.length === 0) return [];

        const first = raw[0];
        let result: Record<string, any>[] = [];
        const key = await this.key();

        // Get table的元数据，以确定是否启用了字段级加密
        const tableMeta = await this.getTableMeta(tableName);
        const config = configManager.getConfig();
        // Prefer table metadata encrypted fields over global config
        const encryptedFields =
          tableMeta?.encryptedFields?.length > 0 ? tableMeta.encryptedFields : config.encryption.encryptedFields || [];

        if (first?.['__enc']) {
          // Full data decryption
          const decryptedData = JSON.parse(await decrypt(first['__enc'], key));
          result = Array.isArray(decryptedData) ? decryptedData : [decryptedData];
        } else if (first?.['__enc_bulk']) {
          // Batch data decryption
          const decryptedStrings = await decryptBulk(first['__enc_bulk'], key);
          result = decryptedStrings.map(str => JSON.parse(str));
        } else if (encryptedFields.length > 0) {
          // Field-level decryption - 根据encryptedFields是否存在来决定
          if (config.encryption.useBulkOperations && raw.length > 1) {
            // Batch field-level decryption
            result = await decryptFieldsBulk(raw, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            // Single field-level decryption
            const decryptionPromises = raw.map(item =>
              decryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            result = await Promise.all(decryptionPromises);
          }
        } else {
          result = raw;
        }

        // Only when cache timeout is greater than 0，才更新缓存
        if (this.cacheTimeout > 0) {
          this.cachedData.set(tableName, {
            data: result,
            timestamp: Date.now(),
          });

          // Manage cache size
          this.manageCacheSize();

          // Build indexes for common fields（优化查询性能）
          if (configManager.getConfig().performance.enableQueryOptimization && result.length > 0) {
            // Build index for ID field（最常用）
            if (result.some(item => item['id'] !== undefined)) {
              this.buildQueryIndex(tableName, 'id');
            }
            // Build index for other common fields
            const commonFields = ['name', 'email', 'type', 'status'];
            commonFields.forEach(field => {
              if (result.some(item => item[field] !== undefined)) {
                this.buildQueryIndex(tableName, field);
              }
            });
          }
        }

        return result;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to read from table ${tableName}`,
          'TABLE_READ_FAILED',
          cause,
          'Decryption or storage operation failed',
          'Check if you have read permissions and the encryption key is valid'
        )
    );
  }

  async count(tableName: string): Promise<number> {
    // Optimization: Get count from cache if valid, avoid reading all data
    const cached = this.cachedData.get(tableName);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data.length;
    }

    // For encrypted tables, read all data to get count
    const data = await this.read(tableName);
    return data.length;
  }

  /**
   * 验证表的计数准确性（加密适配器版本）
   * 对于加密表，计数直接从数据读取，不涉及元数据
   */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    // Encrypt适配器：直接从底层存储适配器获取验证结果
    return storage.verifyCount(tableName);
  }

  async findOne(tableName: string, filter: Record<string, any>, options?: any): Promise<Record<string, any> | null> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Optimization: Use index for fast lookup
        if (configManager.getConfig().performance.enableQueryOptimization) {
          // Get所有索引字段
          const tableIndexes = this.queryIndexes.get(tableName);
          if (tableIndexes) {
            // Find index fields used in filter
            const filterFields = Object.keys(filter);
            for (const field of filterFields) {
              // Check该字段是否有索引
              if (tableIndexes.has(field)) {
                const fieldIndex = tableIndexes.get(field)!;
                const filterValue = filter[field];
                const indexKey = typeof filterValue === 'object' ? JSON.stringify(filterValue) : String(filterValue);

                // Find matching data from index
                const indexedData = fieldIndex.get(indexKey) || [];
                if (indexedData.length > 0) {
                  // If matches found, use QueryEngine for more precise filtering
                  const filtered = QueryEngine.filter(indexedData, filter);
                  if (filtered.length > 0) {
                    return filtered[0];
                  }
                }
              }
            }
          }
        }

        // No usable index or not found, fallback to read all data
        const data = await this.read(tableName, options);
        const filtered = QueryEngine.filter(data, filter);
        return filtered.length > 0 ? filtered[0] : null;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to findOne in table ${tableName}`,
          'QUERY_FAILED',
          cause,
          'Query operation failed',
          'Check if your query filter is valid and the table exists'
        )
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
      requireAuthOnAccess?: boolean;
    },
    findOptions?: any
  ): Promise<Record<string, any>[]> {
    // Prefer cache
    // Only pass read-related options，不传递skip和limit等查询选项
    const readOptions = { ...findOptions };
    // Remove可能影响底层存储读取的查询选项
    delete readOptions.skip;
    delete readOptions.limit;
    delete readOptions.sortBy;
    delete readOptions.order;
    delete readOptions.sortAlgorithm;

    let data = await this.read(tableName, readOptions);

    // Apply filtering - 使用QueryEngine处理所有复杂查询操作符
    if (filter) {
      const filtered = QueryEngine.filter(data, filter);
      data = filtered;
    }

    // Apply sorting
    if (options?.sortBy) {
      data = QueryEngine.sort(data, options.sortBy, options.order, options.sortAlgorithm);
    } else {
      // Default sort by id, ensure consistent pagination
      data = QueryEngine.sort(data, 'id', 'asc', options?.sortAlgorithm);
    }

    // Apply pagination - 手动实现分页逻辑，确保正确处理skip和limit
    const skip = options?.skip || 0;
    const limit = options?.limit;

    if (limit !== undefined) {
      return data.slice(skip, skip + limit);
    } else {
      return data.slice(skip);
    }
  }

  async bulkWrite(
    tableName: string,
    operations: Array<
      | {
          type: 'insert';
          data: Record<string, any> | Record<string, any>[];
        }
      | {
          type: 'update';
          data: Record<string, any>;
          where: Record<string, any>;
        }
      | {
          type: 'delete';
          where: Record<string, any>;
        }
    >,
    options?: any
  ): Promise<WriteResult> {
    // Clear cache
    this.clearTableCache(tableName);
    if (operations.length > 0 && operations.every(operation => operation.type === 'insert')) {
      const insertItems = operations.flatMap(operation =>
        Array.isArray(operation.data) ? operation.data : [operation.data]
      );
      const result = await this.write(tableName, insertItems, options);
      return {
        ...result,
        written: insertItems.length,
      };
    }

    // 1. 读取所有数据，传递options参数确保正确处理加密数据
    const allData = await this.read(tableName, options);

    let finalData = [...allData];
    let writtenCount = 0;

    // 2. 执行所有操作
    for (const operation of operations) {
      if (operation.type === 'insert') {
        // Insert operation
        const insertData = Array.isArray(operation.data) ? operation.data : [operation.data];
        finalData = [...finalData, ...insertData];
        writtenCount += insertData.length;
      } else if (operation.type === 'update') {
        // Update操作（operation.data现在是单个对象，不是数组）
        if (operation.where) {
          // Update with where condition
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          for (const matchedItem of matchedItems) {
            const index = finalData.findIndex(item => item.id === matchedItem.id);
            if (index !== -1) {
              finalData[index] = QueryEngine.update(finalData[index], operation.data);
              writtenCount++;
            }
          }
        } else {
          // Update by id
          const index = finalData.findIndex(item => item.id === operation.data.id);
          if (index !== -1) {
            finalData[index] = QueryEngine.update(finalData[index], operation.data);
            writtenCount++;
          }
        }
      } else if (operation.type === 'delete') {
        // Delete操作（不再需要处理operation.data）
        if (operation.where) {
          // Delete with where condition
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          for (const matchedItem of matchedItems) {
            const index = finalData.findIndex(item => item.id === matchedItem.id);
            if (index !== -1) {
              finalData.splice(index, 1);
              writtenCount++;
            }
          }
        } else {
          // Delete所有数据
          finalData = [];
          writtenCount = allData.length;
        }
      }
    }

    // 3. 使用write方法重新写入数据，确保加密逻辑正确应用
    // Important: Must use overwrite mode, as data already merged
    const result = await this.write(tableName, finalData, { ...options, mode: 'overwrite' });

    return { ...result, written: writtenCount };
  }

  async migrateToChunked(tableName: string): Promise<void> {
    // Read解密后的数据
    const data = await this.read(tableName);

    // Delete原加密表
    await this.deleteTable(tableName);

    // Create新的分片表并写入数据
    await this.createTable(tableName, { initialData: data, mode: 'chunked' });
  }

  async delete(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    // Clear cache
    this.clearTableCache(tableName);

    // 1. 读取所有数据
    const allData = await this.read(tableName, options);

    // 2. 使用QueryEngine处理复杂条件过滤
    const matchedItems = QueryEngine.filter(allData, where);

    // 3. 过滤掉匹配的记录
    const remainingData = allData.filter(item => {
      const itemId = item.id || item._id;
      return !matchedItems.some(matched => matched.id === itemId || matched._id === itemId);
    });

    // 4. 重新写入数据
    await this.write(tableName, remainingData, { ...options, mode: 'overwrite' });

    return matchedItems.length;
  }

  async beginTransaction(options?: any): Promise<void> {
    return storage.beginTransaction(options);
  }

  async commit(options?: any): Promise<void> {
    // Call underlying storage commit directly
    // Transaction managed by underlying storage, adapter only handles encryption
    // All transaction ops handled at lower level, adapter methods auto-apply encryption
    return storage.commit(options);
  }

  async rollback(options?: any): Promise<void> {
    return storage.rollback(options);
  }

  async update(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    options?: any
  ): Promise<number> {
    // Clear cache
    this.clearTableCache(tableName);

    // Not in transaction, execute update directly
    // Transaction handled by underlying storage, adapter only handles encryption
    // All transaction ops handled at lower level, adapter methods auto-apply encryption
    // 1. 读取所有数据，不传递where条件给read方法，但传递options
    const allData = await this.read(tableName, options);

    // 2. 找到匹配where条件的记录
    let updatedCount = 0;

    // Use QueryEngine for complex condition filtering
    const matchedItems = QueryEngine.filter(allData, where);

    // Create匹配项的ID映射，用于快速查找
    const matchedIds = new Set(matchedItems.map(item => item.id || item._id));

    // Update数据
    const updatedData = allData.map(item => {
      const itemId = item.id || item._id;
      if (matchedIds.has(itemId)) {
        updatedCount++;
        return QueryEngine.update(item, data);
      }
      return item;
    });

    // 3. 使用write方法重新写入数据，确保加密逻辑正确应用
    // Ensure correct encryption mode
    await this.write(tableName, updatedData, { ...options, mode: 'overwrite' });

    return updatedCount;
  }

  async remove(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    // Clear cache
    this.clearTableCache(tableName);

    // 1. 读取所有数据
    const allData = await this.read(tableName, options);

    // 2. 使用QueryEngine处理复杂条件过滤
    const matchedItems = QueryEngine.filter(allData, where);
    const removedCount = matchedItems.length;

    // 3. 过滤掉匹配的记录
    const remainingData = allData.filter(item => !matchedItems.some(matched => matched.id === item.id));

    // 4. 使用write方法重新写入数据，确保加密逻辑正确应用
    await this.write(tableName, remainingData, options);

    return removedCount;
  }

  async clearTable(tableName: string): Promise<void> {
    // Clear cache
    this.clearTableCache(tableName);

    // Call underlying storage adapter clearTable directly
    await storage.clearTable(tableName);
  }

  async insert(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    // Insert operation总是使用append模式，忽略传入的mode选项
    return this.write(tableName, data, { ...options, mode: 'append' });
  }
}
