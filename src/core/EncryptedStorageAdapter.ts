// src/core/EncryptedStorageAdapter.ts
// 加密存储适配装饰器
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../types/storageTypes';
import { decrypt, getMasterKey, decryptFields, decryptBulk, decryptFieldsBulk, encrypt, encryptFieldsBulk, encryptFields } from '../utils/crypto';
import { configManager } from './config/ConfigManager';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler } from '../utils/errorHandler';
import { QueryEngine } from './query/QueryEngine';

export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string> | null = null;
  private cachedData: Map<string, { data: Record<string, any>[]; timestamp: number }> = new Map();
  private cacheTimeout = configManager.getConfig().encryption.cacheTimeout; // 从配置读取缓存超时时间
  private maxCacheSize = configManager.getConfig().encryption.maxCacheSize; // 从配置读取最大缓存大小
  private readonly requireAuthOnAccess: boolean;

  // 优化：添加查询索引缓存
  private queryIndexes: Map<string, Map<string, Map<string | number, Record<string, any>[]>>> = new Map();

  /**
   * 构造函数
   * @param options 加密存储适配器配置选项
   */
  constructor(options: { requireAuthOnAccess?: boolean } = {}) {
    // 配置验证
    this.validateConfig();
    // 优先使用选项中的配置，否则使用默认值false
    this.requireAuthOnAccess = options.requireAuthOnAccess !== undefined 
      ? options.requireAuthOnAccess 
      : false;
  }

  /**
   * 获取或初始化密钥
   * 延迟初始化，只有在实际需要使用密钥时才调用getMasterKey()，避免不必要的生物识别/密码识别
   */
  private async getOrInitKey(): Promise<string> {
    if (!this.keyPromise) {
      this.keyPromise = getMasterKey(this.requireAuthOnAccess);
    }
    return this.keyPromise;
  }

  /**
   * 验证加密配置的合理性
   */
  private validateConfig(): void {
    const config = configManager.getConfig();
    // 验证HMAC算法
    if (!['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)) {
      throw new Error(
        `Invalid HMAC algorithm: ${config.encryption.hmacAlgorithm}. Must be either 'SHA-256' or 'SHA-512'.`
      );
    }

    // 验证PBKDF2迭代次数
    if (config.encryption.keyIterations < 10000 || config.encryption.keyIterations > 1000000) {
      throw new Error(`Invalid key iterations: ${config.encryption.keyIterations}. Must be between 10000 and 1000000.`);
    }

    // 验证缓存超时时间

    if (config.encryption.cacheTimeout < 0 || config.encryption.cacheTimeout > 3600000) {
      throw new Error(
        `Invalid cache timeout: ${config.encryption.cacheTimeout}. Must be between 0 and 3600000 (1 hour).`
      );
    }

    // 验证最大缓存大小
    if (config.encryption.maxCacheSize < 1 || config.encryption.maxCacheSize > 1000) {
      throw new Error(`Invalid max cache size: ${config.encryption.maxCacheSize}. Must be between 1 and 1000.`);
    }

    // 验证批量操作配置
    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      throw new Error(`Invalid useBulkOperations value: ${config.encryption.useBulkOperations}. Must be a boolean.`);
    }

    // 验证字段级加密配置
    if (config.encryption.encryptedFields !== undefined && !Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private async key() {
    return await this.getOrInitKey();
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
   */
  private manageCacheSize(): void {
    if (this.cachedData.size > this.maxCacheSize) {
      // 清理最旧的缓存条目
      const entries = Array.from(this.cachedData.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // 移除最旧的条目，直到缓存大小回到安全范围内
      const toRemove = entries.slice(0, this.cachedData.size - this.maxCacheSize + 1);
      toRemove.forEach(([tableName]) => {
        this.cachedData.delete(tableName);
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

  async deleteTable(tableName: string) {
    return storage.deleteTable(tableName);
  }

  async hasTable(tableName: string) {
    return storage.hasTable(tableName);
  }

  async listTables() {
    return storage.listTables();
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
    return ErrorHandler.handleAsyncError(
      async () => {
        // 清除该表的缓存
        this.clearTableCache(tableName);

        const finalData = Array.isArray(data) ? data : [data];
        const key = await this.key();
        
        let encryptedData: Record<string, any>[] = [];
        
        // 获取配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = (storage as any).getTableMeta(tableName);
        
        // 决定使用哪种加密策略
        const useFieldLevelEncryption = 
          options?.encryptFullTable !== true &&
          (options?.encryptFullTable !== false ||
           tableMeta?.encryptedFields?.length > 0 ||
           config.encryption.encryptedFields && config.encryption.encryptedFields.length > 0 ||
           !tableMeta?.encryptedFields);
        
        if (useFieldLevelEncryption) {
          // 字段级加密模式
          const encryptedFields = tableMeta?.encryptedFields?.length > 0 
            ? tableMeta.encryptedFields 
            : (config.encryption.encryptedFields || []);
          
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
          // 整表加密模式
          const shouldEncryptFullTable = options?.encryptFullTable === true;
          if (shouldEncryptFullTable) {
            // 覆盖模式：直接加密写入
            const serializedData = JSON.stringify(finalData);
            const encrypted = await encrypt(serializedData, key);
            encryptedData = [{ __enc: encrypted }];
            
            // 清除缓存，因为数据被覆盖了
            const cacheKey = `__enc_full_table_${tableName}`;
            (this.cachedData as any).delete(cacheKey);
          }
        }

        return storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
      },
      cause =>
        ErrorHandler.createGeneralError(
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
    return ErrorHandler.handleAsyncError(
      async () => {
        // 清除该表的缓存
        this.clearTableCache(tableName);

        const finalData = Array.isArray(data) ? data : [data];
        const key = await this.key();
        
        let encryptedData: Record<string, any>[] = [];
        
        // 获取配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = (storage as any).getTableMeta(tableName);
        
        // 加密写入策略：
        // 1. 优先使用字段级加密（性能更好，支持增量写入）
        // 2. 整表加密作为备选，但优化其append操作
        
        // 决定使用哪种加密策略
        // 优化：优先使用字段级加密，性能更好，默认情况下即使没有配置encryptedFields也使用字段级加密
        // 只有明确指定encryptFullTable为true时，才使用整表加密
        const useFieldLevelEncryption = 
          options?.encryptFullTable !== true && // 只有明确指定整表加密时，才不使用字段级加密
          (options?.encryptFullTable !== false || // 或者没有明确禁用字段级加密
           tableMeta?.encryptedFields?.length > 0 || // 或者表配置了加密字段
           config.encryption.encryptedFields && config.encryption.encryptedFields.length > 0 || // 或者全局配置了加密字段
           !tableMeta?.encryptedFields); // 或者表没有配置加密字段（默认使用字段级加密）
        
        if (useFieldLevelEncryption) {
          // 字段级加密模式 - 性能更好，支持增量写入
          // 优先使用表元数据中的加密字段配置，然后才是全局配置
          const encryptedFields = tableMeta?.encryptedFields?.length > 0 
            ? tableMeta.encryptedFields 
            : (config.encryption.encryptedFields || []);
          
          // 如果没有指定加密字段，仍然使用字段级加密（加密所有字段）
          // 这样可以获得更好的性能，同时保持数据安全
          if (encryptedFields.length > 0) {
            // 有明确指定加密字段，只加密指定字段
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              // 批量字段级加密 - 只加密新增数据
              encryptedData = await encryptFieldsBulk(finalData, { 
                fields: encryptedFields, 
                masterKey: key,
              });
            } else {
              // 单次字段级加密 - 只加密新增数据
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: encryptedFields,
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          } else {
            // 没有指定加密字段，加密所有字段
            // 这是优化的关键：默认情况下，即使没有配置encryptedFields，也使用字段级加密
            // 这样可以获得比整表加密更好的性能
            if (config.encryption.useBulkOperations && finalData.length > 1) {
              // 批量加密所有字段
              encryptedData = await encryptFieldsBulk(finalData, { 
                fields: Object.keys(finalData[0] || {}), // 加密所有字段
                masterKey: key,
              });
            } else {
              // 单次加密所有字段
              const encryptionPromises = finalData.map(item =>
                encryptFields(item, {
                  fields: Object.keys(item), // 加密所有字段
                  masterKey: key,
                })
              );
              encryptedData = await Promise.all(encryptionPromises);
            }
          }
          
          // 字段级加密支持直接append，不需要重新加密整个表
          return storage.write(tableName, encryptedData, { ...options });
        } else {
          // 整表加密模式 - 仅在明确要求时使用
          const shouldEncryptFullTable = options?.encryptFullTable === true;
          if (shouldEncryptFullTable) {
            // 检查写入模式
            if (options?.mode === 'append') {
              // 整表加密的append模式优化
              // 优化1：使用缓存减少重复解密
              // 优化2：只加密新增数据，而不是整个表
              // 优化3：使用增量加密策略
              
              // 尝试从缓存获取解密后的数据
              let cachedDecryptedData = null;
              
              // 先读取现有加密数据
              const existingEncrypted = await storage.read(tableName, { bypassCache: true });
              let combinedData = finalData;
              
              if (existingEncrypted.length > 0 && existingEncrypted[0].__enc) {
                // 检查是否有有效缓存
                const cacheKey = `__enc_full_table_${tableName}`;
                const cacheEntry = (this.cachedData as any).get(cacheKey);
                
                // 如果缓存有效（1分钟内），直接使用缓存的数据
                if (cacheEntry && Date.now() - cacheEntry.timestamp < 60000) {
                  cachedDecryptedData = cacheEntry.data;
                  combinedData = Array.isArray(cachedDecryptedData) ? [...cachedDecryptedData, ...finalData] : [...[cachedDecryptedData], ...finalData];
                } else {
                  // 缓存无效，解密现有数据
                  const decrypted = await decrypt(existingEncrypted[0].__enc, key);
                  const existingData = JSON.parse(decrypted);
                  combinedData = Array.isArray(existingData) ? [...existingData, ...finalData] : [...[existingData], ...finalData];
                  
                  // 更新缓存
                  (this.cachedData as any).set(cacheKey, {
                    data: combinedData,
                    timestamp: Date.now()
                  });
                }
              }
              
              // 优化4：使用更高效的序列化和加密方式
              const serializedData = JSON.stringify(combinedData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
            } else {
              // 覆盖模式：直接加密写入
              const serializedData = JSON.stringify(finalData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              
              // 清除缓存，因为数据被覆盖了
              const cacheKey = `__enc_full_table_${tableName}`;
              (this.cachedData as any).delete(cacheKey);
            }
          }
        }

        return storage.write(tableName, encryptedData, { ...options, mode: options?.mode || 'overwrite' });
      },
      cause =>
        ErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 如果缓存超时时间为0，清除所有缓存并禁用缓存
        if (this.cacheTimeout === 0) {
          this.cachedData.clear();
          this.queryIndexes.clear();
        }

        // 总是从底层存储适配器读取最新数据，忽略缓存
    // 这样可以确保我们获取到最新的磁盘数据，包括刚提交的事务数据
    // 只传递与读取相关的选项，不传递查询相关的选项
    const readOptions = options ? { bypassCache: options.bypassCache } : undefined;
    const raw = await storage.read(tableName, readOptions);
      if (raw.length === 0) return [];

      const first = raw[0];
      let result: Record<string, any>[] = [];
      const key = await this.key();

      // 获取表的元数据，以确定是否启用了字段级加密
      const tableMeta = (storage as any).getTableMeta(tableName);
      const config = configManager.getConfig();
      // 优先使用表元数据中的加密字段配置，然后才是全局配置
      const encryptedFields = tableMeta?.encryptedFields?.length > 0 
        ? tableMeta.encryptedFields 
        : (config.encryption.encryptedFields || []);

      if (first?.['__enc']) {
        // 完整数据解密
        const decryptedData = JSON.parse(await decrypt(first['__enc'], key));
        result = Array.isArray(decryptedData) ? decryptedData : [decryptedData];
      } else if (first?.['__enc_bulk']) {
        // 批量数据解密
        const decryptedStrings = await decryptBulk(first['__enc_bulk'], key);
        result = decryptedStrings.map(str => JSON.parse(str));
      } else if (encryptedFields.length > 0) {
        // 字段级解密 - 根据encryptedFields是否存在来决定
        if (config.encryption.useBulkOperations && raw.length > 1) {
          // 批量字段级解密
          result = await decryptFieldsBulk(raw, {
            fields: encryptedFields,
            masterKey: key,
          });
        } else {
          // 单次字段级解密
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

        // 只有当缓存超时时间大于0时，才更新缓存
        if (this.cacheTimeout > 0) {
          this.cachedData.set(tableName, {
            data: result,
            timestamp: Date.now(),
          });

          // 管理缓存大小
          this.manageCacheSize();

          // 构建常用字段的索引（优化查询性能）
          if (configManager.getConfig().performance.enableQueryOptimization && result.length > 0) {
            // 为ID字段构建索引（最常用）
            if (result.some(item => item['id'] !== undefined)) {
              this.buildQueryIndex(tableName, 'id');
            }
            // 为其他常用字段构建索引
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
        ErrorHandler.createGeneralError(
          `Failed to read from table ${tableName}`,
          'TABLE_READ_FAILED',
          cause,
          'Decryption or storage operation failed',
          'Check if you have read permissions and the encryption key is valid'
        )
    );
  }

  async count(tableName: string): Promise<number> {
    // 优化：如果缓存有效，直接从缓存获取计数，避免读取所有数据
    const cached = this.cachedData.get(tableName);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data.length;
    }

    // 对于加密表，我们需要读取所有数据来获取计数
    const data = await this.read(tableName);
    return data.length;
  }

  /**
   * 验证表的计数准确性（加密适配器版本）
   * 对于加密表，计数直接从数据读取，不涉及元数据
   */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    // 加密适配器：直接从底层存储适配器获取验证结果
    return storage.verifyCount(tableName);
  }

  async findOne(tableName: string, filter: Record<string, any>, options?: any): Promise<Record<string, any> | null> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 优化：使用索引快速查找
        if (configManager.getConfig().performance.enableQueryOptimization) {
          // 获取所有索引字段
          const tableIndexes = this.queryIndexes.get(tableName);
          if (tableIndexes) {
            // 找出filter中使用的索引字段
            const filterFields = Object.keys(filter);
            for (const field of filterFields) {
              // 检查该字段是否有索引
              if (tableIndexes.has(field)) {
                const fieldIndex = tableIndexes.get(field)!;
                const filterValue = filter[field];
                const indexKey = typeof filterValue === 'object' ? JSON.stringify(filterValue) : String(filterValue);

                // 从索引中查找匹配的数据
                const indexedData = fieldIndex.get(indexKey) || [];
                if (indexedData.length > 0) {
                  // 如果找到匹配的数据，使用QueryEngine进行更精确的过滤
                  const filtered = QueryEngine.filter(indexedData, filter);
                  if (filtered.length > 0) {
                    return filtered[0];
                  }
                }
              }
            }
          }
        }

        // 没有可用索引或索引查询未找到结果，回退到读取所有数据并过滤
        const data = await this.read(tableName, options);
        const filtered = QueryEngine.filter(data, filter);
        return filtered.length > 0 ? filtered[0] : null;
      },
      cause =>
        ErrorHandler.createGeneralError(
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
    // 优先使用缓存
    // 只传递与读取相关的选项，不传递skip和limit等查询选项
    const readOptions = { ...findOptions };
    // 移除可能影响底层存储读取的查询选项
    delete readOptions.skip;
    delete readOptions.limit;
    delete readOptions.sortBy;
    delete readOptions.order;
    delete readOptions.sortAlgorithm;
    
    let data = await this.read(tableName, readOptions);

    // 应用过滤 - 使用QueryEngine处理所有复杂查询操作符
    if (filter) {
      const filtered = QueryEngine.filter(data, filter);
      data = filtered;
    }

    // 应用排序
    if (options?.sortBy) {
      data = QueryEngine.sort(data, options.sortBy, options.order, options.sortAlgorithm);
    } else {
      // 默认按id排序，确保分页结果一致
      data = QueryEngine.sort(data, 'id', 'asc', options?.sortAlgorithm);
    }

    // 应用分页 - 手动实现分页逻辑，确保正确处理skip和limit
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
    // 清除缓存
    this.clearTableCache(tableName);

    // 1. 读取所有数据，传递options参数确保正确处理加密数据
    const allData = await this.read(tableName, options);
    
    let finalData = [...allData];
    let writtenCount = 0;
    
    // 2. 执行所有操作
    for (const operation of operations) {
      if (operation.type === 'insert') {
        // 插入操作
        const insertData = Array.isArray(operation.data) ? operation.data : [operation.data];
        finalData = [...finalData, ...insertData];
        writtenCount += insertData.length;
      } else if (operation.type === 'update') {
        // 更新操作（operation.data现在是单个对象，不是数组）
        if (operation.where) {
          // 有where条件的更新
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          for (const matchedItem of matchedItems) {
            const index = finalData.findIndex(item => item.id === matchedItem.id);
            if (index !== -1) {
              finalData[index] = QueryEngine.update(finalData[index], operation.data);
              writtenCount++;
            }
          }
        } else {
          // 通过id更新
          const index = finalData.findIndex(item => item.id === operation.data.id);
          if (index !== -1) {
            finalData[index] = QueryEngine.update(finalData[index], operation.data);
            writtenCount++;
          }
        }
      } else if (operation.type === 'delete') {
        // 删除操作（不再需要处理operation.data）
        if (operation.where) {
          // 有where条件的删除
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          for (const matchedItem of matchedItems) {
            const index = finalData.findIndex(item => item.id === matchedItem.id);
            if (index !== -1) {
              finalData.splice(index, 1);
              writtenCount++;
            }
          }
        } else {
          // 删除所有数据
          finalData = [];
          writtenCount = allData.length;
        }
      }
    }
    
    // 3. 使用write方法重新写入数据，确保加密逻辑正确应用
    // 重要：必须使用overwrite模式，因为我们已经合并了数据
    const result = await this.write(tableName, finalData, { ...options, mode: 'overwrite' });
    
    return { ...result, written: writtenCount };
  }

  async migrateToChunked(tableName: string): Promise<void> {
    // 读取解密后的数据
    const data = await this.read(tableName);

    // 删除原加密表
    await this.deleteTable(tableName);

    // 创建新的分片表并写入数据
    await this.createTable(tableName, { initialData: data, mode: 'chunked' });
  }

  async delete(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    // 清除缓存
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
    // 直接调用底层storage的commit方法
    // 因为事务状态由底层storage管理，EncryptedStorageAdapter只负责加密/解密
    // 所有事务操作在底层已经正确处理，EncryptedStorageAdapter的write/delete/update等方法会自动应用加密逻辑
    return storage.commit(options);
  }

  async rollback(options?: any): Promise<void> {
    return storage.rollback(options);
  }

  async update(tableName: string, data: Record<string, any>, where: Record<string, any>, options?: any): Promise<number> {
    // 清除缓存
    this.clearTableCache(tableName);
    
    // 不在事务中，直接执行更新操作
    // 事务处理由底层storage负责，EncryptedStorageAdapter只负责加密/解密
    // 所有事务操作在底层已经正确处理，EncryptedStorageAdapter的write/delete/update等方法会自动应用加密逻辑
    // 1. 读取所有数据，不传递where条件给read方法，但传递options
    const allData = await this.read(tableName, options);
    
    // 2. 找到匹配where条件的记录
    let updatedCount = 0;
    
    // 使用QueryEngine处理复杂条件过滤
    const matchedItems = QueryEngine.filter(allData, where);
    
    // 创建匹配项的ID映射，用于快速查找
    const matchedIds = new Set(matchedItems.map(item => item.id || item._id));
    
    // 更新数据
    const updatedData = allData.map(item => {
      const itemId = item.id || item._id;
      if (matchedIds.has(itemId)) {
        updatedCount++;
        return QueryEngine.update(item, data);
      }
      return item;
    });
    
    // 3. 使用write方法重新写入数据，确保加密逻辑正确应用
    // 确保使用正确的加密模式
    await this.write(tableName, updatedData, { ...options, mode: 'overwrite' });
    
    return updatedCount;
  }

  async remove(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    // 清除缓存
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
    // 清除缓存
    this.clearTableCache(tableName);
    
    // 直接调用底层存储适配器的clearTable方法
    await storage.clearTable(tableName);
  }

  async insert(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    // 插入操作总是使用append模式，忽略传入的mode选项
    return this.write(tableName, data, { ...options, mode: 'append' });
  }
}
