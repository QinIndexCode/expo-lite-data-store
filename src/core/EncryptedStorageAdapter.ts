// src/core/EncryptedStorageAdapter.ts
// 加密存储适配装饰器
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../types/storageTypes';
import { decrypt, getMasterKey, decryptFields, decryptBulk, decryptFieldsBulk } from '../utils/crypto';
import config from '../liteStore.config';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler } from '../utils/errorHandler';
import { QueryEngine } from './query/QueryEngine';

export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string>;
  private cachedData: Map<string, { data: Record<string, any>[]; timestamp: number }> = new Map();
  private cacheTimeout = config.encryption.cacheTimeout; // 从配置读取缓存超时时间
  private maxCacheSize = config.encryption.maxCacheSize; // 从配置读取最大缓存大小

  // 优化：添加查询索引缓存
  private queryIndexes: Map<string, Map<string, Map<string | number, Record<string, any>[]>>> = new Map();

  constructor() {
    // 在构造函数中初始化 keyPromise，确保每个实例都使用相同的密钥
    this.keyPromise = getMasterKey();

    // 配置验证
    this.validateConfig();
  }

  /**
   * 验证加密配置的合理性
   */
  private validateConfig(): void {
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
    if (typeof config.encryption.enableFieldLevelEncryption !== 'boolean') {
      throw new Error(
        `Invalid enableFieldLevelEncryption value: ${config.encryption.enableFieldLevelEncryption}. Must be a boolean.`
      );
    }

    if (!Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private async key() {
    return await this.keyPromise;
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

  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 清除该表的缓存
        this.clearTableCache(tableName);

        // 暂时禁用加密，直接写入数据
        const finalData = Array.isArray(data) ? data : [data];

        return storage.write(tableName, finalData, { mode: 'overwrite', ...options });
      },
      cause =>
        ErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions'
        )
    );
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 检查缓存是否有效
        const shouldBypassCache = options?.bypassCache || false; // Default to false to use cache for better performance

        // 如果缓存超时时间为0，清除所有缓存并禁用缓存
        if (this.cacheTimeout === 0) {
          this.cachedData.clear();
          this.queryIndexes.clear();
        }

        const cached = this.cachedData.get(tableName);
        if (!shouldBypassCache && cached && Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }

        // 读取数据时不要传递 options 参数，因为 options 可能包含 filter 选项，而我们需要先解密数据，然后再应用过滤条件
        const raw = await storage.read(tableName);
        if (raw.length === 0) return [];

        const first = raw[0];
        let result: Record<string, any>[] = [];
        const key = await this.key();

        if (first?.['__enc']) {
          // 完整数据解密
          const decryptedData = JSON.parse(await decrypt(first['__enc'], key));
          result = Array.isArray(decryptedData) ? decryptedData : [decryptedData];
        } else if (first?.['__enc_bulk']) {
          // 批量数据解密
          const decryptedStrings = await decryptBulk(first['__enc_bulk'], key);
          result = decryptedStrings.map(str => JSON.parse(str));
        } else if (config.encryption.enableFieldLevelEncryption && config.encryption.encryptedFields.length > 0) {
          // 字段级解密
          if (config.encryption.useBulkOperations && raw.length > 1) {
            // 批量字段级解密
            result = await decryptFieldsBulk(raw, {
              fields: config.encryption.encryptedFields,
              masterKey: key,
            });
          } else {
            // 单次字段级解密
            const decryptionPromises = raw.map(item =>
              decryptFields(item, {
                fields: config.encryption.encryptedFields,
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
          if (config.performance.enableQueryOptimization && result.length > 0) {
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

  async findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 优化：使用索引快速查找
        if (config.performance.enableQueryOptimization) {
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
        const data = await this.read(tableName);
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
    }
  ): Promise<Record<string, any>[]> {
    // 优先使用缓存
    let data = await this.read(tableName);

    // 调试日志：查看读取到的数据
    console.log('Debug - findMany read data:', data.length, 'items');
    if (data.length > 0) {
      console.log('Debug - first item:', data[0]);
    }

    // 应用过滤 - 使用QueryEngine处理所有复杂查询操作符
    if (filter) {
      const filtered = QueryEngine.filter(data, filter);
      console.log('Debug - findMany filter:', filter, 'filtered:', filtered.length, 'items');
      data = filtered;
    }

    // 应用排序
    if (options?.sortBy) {
      data = QueryEngine.sort(data, options.sortBy, options.order, options.sortAlgorithm);
    }

    // 应用分页 - 优化：使用QueryEngine的分页方法
    data = QueryEngine.paginate(data, options?.skip, options?.limit);

    return data;
  }

  async bulkWrite(
    tableName: string,
    operations: Array<{
      type: 'insert' | 'update' | 'delete';
      data: Record<string, any> | Record<string, any>[];
    }>
  ): Promise<WriteResult> {
    // 清除缓存
    this.clearTableCache(tableName);

    // 直接调用底层存储适配器的bulkWrite方法
    const result = await storage.bulkWrite(tableName, operations);

    return result;
  }

  async migrateToChunked(tableName: string): Promise<void> {
    // 读取解密后的数据
    const data = await this.read(tableName);

    // 删除原加密表
    await this.deleteTable(tableName);

    // 创建新的分片表并写入数据
    await this.createTable(tableName, { initialData: data, mode: 'chunked' });
  }

  async delete(tableName: string, where: Record<string, any>): Promise<number> {
    // 清除缓存
    this.clearTableCache(tableName);

    // 直接调用底层存储适配器的delete方法
    const result = await storage.delete(tableName, where);

    return result;
  }

  async beginTransaction(): Promise<void> {
    return storage.beginTransaction();
  }

  async commit(): Promise<void> {
    return storage.commit();
  }

  async rollback(): Promise<void> {
    return storage.rollback();
  }

  async update(tableName: string, data: Record<string, any>, where: Record<string, any>): Promise<number> {
    // 清除缓存
    this.clearTableCache(tableName);
    
    // 直接调用底层存储适配器的update方法
    const result = await storage.update(tableName, data, where);
    
    return result;
  }

  async remove(tableName: string, where: Record<string, any>): Promise<number> {
    // 清除缓存
    this.clearTableCache(tableName);
    
    // 直接调用底层存储适配器的remove方法
    const result = await storage.remove(tableName, where);
    
    return result;
  }

  async clearTable(tableName: string): Promise<void> {
    // 清除缓存
    this.clearTableCache(tableName);
    
    // 直接调用底层存储适配器的clearTable方法
    await storage.clearTable(tableName);
  }
}
