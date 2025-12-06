// src/core/EncryptedStorageAdapter.ts
// 加密存储适配装饰器
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../types/storageTypes';
import {
  decrypt,
  encrypt,
  getMasterKey,
  encryptFields,
  decryptFields,
  encryptBulk,
  decryptBulk,
  encryptFieldsBulk,
  decryptFieldsBulk,
} from '../utils/crypto';
import config from '../liteStore.config';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler } from '../utils/errorHandler';

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

  /**
   * 使用索引进行查询优化
   */
  private queryWithIndex(tableName: string, field: string, value: any): Record<string, any>[] | null {
    const tableIndexes = this.queryIndexes.get(tableName);
    if (!tableIndexes) return null;

    const fieldIndex = tableIndexes.get(field);
    if (!fieldIndex) return null;

    const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return fieldIndex.get(key) || [];
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

        const key = await this.key();
        // 优化：确保数据是数组格式，减少JSON序列化时的类型检查
        const dataToEncrypt = Array.isArray(data) ? data : [data];

        let finalData: Record<string, any>[];

        if (config.encryption.enableFieldLevelEncryption && config.encryption.encryptedFields.length > 0) {
          // 字段级加密
          if (config.encryption.useBulkOperations && dataToEncrypt.length > 1) {
            // 批量字段级加密
            finalData = await encryptFieldsBulk(dataToEncrypt, {
              fields: config.encryption.encryptedFields,
              masterKey: key,
            });
          } else {
            // 单次字段级加密
            const encryptionPromises = dataToEncrypt.map(item =>
              encryptFields(item, {
                fields: config.encryption.encryptedFields,
                masterKey: key,
              })
            );
            finalData = await Promise.all(encryptionPromises);
          }
        } else {
          // 完整数据加密
          if (config.encryption.useBulkOperations && dataToEncrypt.length > 1) {
            // 批量完整加密
            const dataStrings = dataToEncrypt.map(item => JSON.stringify(item));
            const encryptedStrings = await encryptBulk(dataStrings, key);
            finalData = [{ __enc_bulk: encryptedStrings }];
          } else {
            // 单次完整加密
            const encrypted = await encrypt(JSON.stringify(dataToEncrypt), key);
            finalData = [{ __enc: encrypted }];
          }
        }

        return storage.write(tableName, finalData, { mode: 'overwrite', ...options });
      },
      cause =>
        ErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Encryption or storage operation failed',
          'Check if you have write permissions and the encryption key is valid'
        )
    );
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 检查缓存是否有效
        const shouldBypassCache = options?.bypassCache || false;
        const cached = this.cachedData.get(tableName);
        if (!shouldBypassCache && cached && Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }

        const raw = await storage.read(tableName, options);
        if (raw.length === 0) return [];

        const first = raw[0];
        let result: Record<string, any>[] = [];

        if (first?.['__enc']) {
          // 完整数据解密
          const key = await this.key();
          const decryptedData = JSON.parse(await decrypt(first['__enc'], key));
          result = Array.isArray(decryptedData) ? decryptedData : [decryptedData];
        } else if (first?.['__enc_bulk']) {
          // 批量数据解密
          const key = await this.key();
          const decryptedStrings = await decryptBulk(first['__enc_bulk'], key);
          result = decryptedStrings.map(str => JSON.parse(str));
        } else if (config.encryption.enableFieldLevelEncryption && config.encryption.encryptedFields.length > 0) {
          // 字段级解密
          const key = await this.key();
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

        // 更新缓存
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

  async findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 优化：如果只有一个简单条件且有索引，使用索引查询
        if (config.performance.enableQueryOptimization && Object.keys(filter).length === 1) {
          const entry = Object.entries(filter)[0];
          if (!entry) return null;
          const [field, value] = entry;
          if (typeof value !== 'object' || value === null) {
            const indexedResult = this.queryWithIndex(tableName, field, value);
            if (indexedResult && indexedResult.length > 0) {
              const result = indexedResult[0];
              return result || null;
            }
          }
        }

        // 回退到全表扫描
        const data = await this.read(tableName);
        // 在解密后的数据上应用过滤
        const filtered = data.filter(item => {
          for (const [key, value] of Object.entries(filter)) {
            if (item[key as string] !== value) return false;
          }
          return true;
        });
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
    options?: { skip?: number; limit?: number }
  ): Promise<Record<string, any>[]> {
    // 优先使用缓存
    let data = await this.read(tableName);

    // 应用过滤 - 优化性能的过滤逻辑
    if (filter) {
      const filterKeys = Object.keys(filter);

      // 简单过滤优化：如果只有一个简单条件，使用更高效的实现
      if (filterKeys.length === 1) {
        const [key] = filterKeys;
        const value = filter[key as string];

        // 简单值比较
        if (typeof value !== 'object' || value === null) {
          data = data.filter(item => item[key as string] === value);
        } else {
          // 处理操作符
          data = data.filter(item => {
            // 快速路径：常见的比较操作符
            if (value.$eq !== undefined) return item[key as string] === value.$eq;
            if (value.$ne !== undefined) return item[key as string] !== value.$ne;

            // 其他操作符
            for (const [op, opValue] of Object.entries(value)) {
              switch (op) {
                case '$gt':
                  if (!(item[key as string] > (opValue as any))) return false;
                  break;
                case '$gte':
                  if (!(item[key as string] >= (opValue as any))) return false;
                  break;
                case '$lt':
                  if (!(item[key as string] < (opValue as any))) return false;
                  break;
                case '$lte':
                  if (!(item[key as string] <= (opValue as any))) return false;
                  break;
                // 嵌套对象比较
                default:
                  if (item[key as string]?.[op] !== opValue) return false;
                  break;
              }
            }
            return true;
          });
        }
      } else {
        // 多条件过滤
        data = data.filter(item => {
          for (const [key, value] of Object.entries(filter)) {
            if (typeof value === 'object' && value !== null) {
              // 处理比较操作符
              for (const [op, opValue] of Object.entries(value)) {
                switch (op) {
                  case '$gt':
                    if (!(item[key] > (opValue as any))) return false;
                    break;
                  case '$gte':
                    if (!(item[key] >= (opValue as any))) return false;
                    break;
                  case '$lt':
                    if (!(item[key] < (opValue as any))) return false;
                    break;
                  case '$lte':
                    if (!(item[key] <= (opValue as any))) return false;
                    break;
                  case '$eq':
                    if (item[key] !== opValue) return false;
                    break;
                  case '$ne':
                    if (item[key] === opValue) return false;
                    break;
                  // 嵌套对象比较
                  default:
                    if (item[key]?.[op] !== opValue) return false;
                    break;
                }
              }
            } else {
              // 简单值比较
              if (item[key] !== value) return false;
            }
          }
          return true;
        });
      }
    }

    // 应用分页 - 优化：只在需要时进行分页操作
    let result = data;
    if (options?.skip || options?.limit) {
      const start = options?.skip || 0;
      const end = options?.limit ? start + options.limit : undefined;
      result = data.slice(start, end);
    }

    return result;
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

    // 使用配置中的批量操作优化设置
    if (config.performance.enableBatchOptimization) {
      // 优化：小批量操作可以直接在内存中处理
      if (operations.length < 100) {
        // 先读取所有数据
        let data = await this.read(tableName);
        let writtenCount = 0;

        // 预处理：将操作数据标准化为数组
        const processedOps = operations.map(op => ({
          ...op,
          items: Array.isArray(op.data) ? op.data : [op.data],
        }));

        // 优化更新和删除操作：使用Map提高查找效率
        const idToIndex = new Map<string | number, number>();
        data.forEach((item, index) => {
          if (item['id']) {
            idToIndex.set(item['id'], index);
          }
        });

        // 处理所有操作
        for (const op of processedOps) {
          switch (op.type) {
            case 'insert':
              data.push(...op.items);
              writtenCount += op.items.length;
              break;
            case 'update':
              for (const item of op.items) {
                if (item.id && idToIndex.has(item.id)) {
                  const index = idToIndex.get(item.id)!;
                  data[index] = { ...data[index], ...item };
                  writtenCount++;
                }
              }
              break;
            case 'delete':
              // 收集要删除的ID
              const idsToDelete = new Set(op.items.filter(item => item.id).map(item => item.id));
              const initialLength = data.length;

              // 一次性过滤，减少多次数组操作
              data = data.filter(item => !idsToDelete.has(item['id']));
              writtenCount += initialLength - data.length;

              // 更新索引映射
              idToIndex.clear();
              data.forEach((item, index) => {
                if (item['id']) {
                  idToIndex.set(item['id'], index);
                }
              });
              break;
          }
        }

        // 重新加密并写入
        const result = await this.write(tableName, data);

        return {
          ...result,
          written: writtenCount,
          totalAfterWrite: writtenCount + (result.totalAfterWrite - writtenCount),
        };
      }

      // 大数据集分批处理（1000条/批）
      const BATCH_SIZE = 1000;
      let data = await this.read(tableName);
      let writtenCount = 0;

      // 按批次处理操作
      for (let i = 0; i < operations.length; i += BATCH_SIZE) {
        const batchOperations = operations.slice(i, i + BATCH_SIZE);

        // 预处理批量操作
        const insertBatch: Record<string, any>[] = [];
        const updateBatch: Map<string | number, Record<string, any>> = new Map();
        const deleteBatch = new Set<string | number>();

        // 收集操作
        for (const op of batchOperations) {
          const items = Array.isArray(op.data) ? op.data : [op.data];

          switch (op.type) {
            case 'insert':
              insertBatch.push(...items);
              break;
            case 'update':
              for (const item of items) {
                if (item.id) {
                  updateBatch.set(item.id, item);
                }
              }
              break;
            case 'delete':
              for (const item of items) {
                if (item.id) {
                  deleteBatch.add(item.id);
                }
              }
              break;
          }
        }

        // 一次性应用所有删除操作
        const initialLength = data.length;
        data = data.filter(item => !deleteBatch.has(item['id']));
        writtenCount += initialLength - data.length;

        // 一次性应用所有更新操作
        data = data.map(item => {
          if (item['id'] && updateBatch.has(item['id'])) {
            writtenCount++;
            return { ...item, ...updateBatch.get(item['id'])! };
          }
          return item;
        });

        // 一次性应用所有插入操作
        if (insertBatch.length > 0) {
          data.push(...insertBatch);
          writtenCount += insertBatch.length;
        }
      }

      // 重新加密并写入
      const result = await this.write(tableName, data);

      return {
        ...result,
        written: writtenCount,
      };
    } else {
      // 不使用批量优化，逐个处理操作
      let writtenCount = 0;

      for (const operation of operations) {
        let data = await this.read(tableName);
        const items = Array.isArray(operation.data) ? operation.data : [operation.data];

        switch (operation.type) {
          case 'insert':
            // 插入操作
            data.push(...items);
            await this.write(tableName, data);
            writtenCount += items.length;
            break;
          case 'update':
            // 更新操作
            for (const item of items) {
              const index = data.findIndex(d => d['id'] === item['id']);
              if (index !== -1) {
                data[index] = { ...data[index], ...item };
                writtenCount++;
              }
            }
            await this.write(tableName, data);
            break;
          case 'delete':
            // 删除操作
            const initialLength = data.length;
            const idsToDelete = new Set(items.map(item => item['id']));
            data = data.filter(item => !idsToDelete.has(item['id']));
            await this.write(tableName, data);
            writtenCount += initialLength - data.length;
            break;
        }
      }

      return {
        written: writtenCount,
        totalAfterWrite: writtenCount,
        chunked: false,
      };
    }
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

    // 对于加密表，先读取所有数据，在内存中处理，然后重新加密写入
    const data = await this.read(tableName);
    const initialLength = data.length;

    // 优化删除过滤逻辑
    const whereKeys = Object.keys(where);

    // 优化：如果只有一个简单条件，使用更高效的实现
    if (whereKeys.length === 1) {
      const [key] = whereKeys;
      const value = where[key as string];
      const filteredData = data.filter(item => item[key as string] !== value);

      // 重新加密并写入
      await this.write(tableName, filteredData);

      return initialLength - filteredData.length;
    }

    // 多条件过滤
    const filteredData = data.filter(item => {
      // 检查item是否匹配where条件，如果匹配则删除（返回false），否则保留（返回true）
      return !whereKeys.every(whereKey => item[whereKey] === where[whereKey]);
    });

    // 重新加密并写入
    await this.write(tableName, filteredData);

    return initialLength - filteredData.length;
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
}
