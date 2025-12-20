// src/core/data/DataReader.ts
// 数据读取器，负责从文件系统读取和处理数据
// 创建于: 2025-11-28
// 最后修改: 2025-12-11

import config from '../../liteStore.config';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import type { ReadOptions } from '../../types/storageTypes';
import { ErrorHandler } from '../../utils/errorHandler';
import ROOT from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import { CacheManager } from '../cache/CacheManager';
import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { SingleFileHandler } from '../file/SingleFileHandler';
import { IndexManager } from '../index/IndexManager';
import { QueryEngine } from '../query/QueryEngine';

/**
 * 数据读取器
 * 负责从文件系统读取数据并应用过滤、排序和分页
 */
export class DataReader {
  /** 索引管理器 */
  private indexManager: IndexManager;
  /** 元数据管理器 */
  private metadataManager: IMetadataManager;
  /** 缓存管理器 */
  private cacheManager: CacheManager;

  /**
   * 构造函数
   * @param metadataManager 元数据管理器
   * @param indexManager 索引管理器
   * @param cacheManager 缓存管理器
   */
  constructor(metadataManager: IMetadataManager, indexManager: IndexManager, cacheManager: CacheManager) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
    this.cacheManager = cacheManager;
  }

  /**
   * 获取单文件处理器
   * @param tableName 表名
   * @returns SingleFileHandler 单文件处理器
   */
  private getSingleFile(tableName: string): SingleFileHandler {
    // 直接使用根路径和表名构造完整文件路径，避免依赖全局 File 构造函数
    const filePath = `${ROOT}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  /**
   * 获取分片文件处理器
   * @param tableName 表名
   * @returns ChunkedFileHandler 分片文件处理器
   */
  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  /**
   * 生成稳定的缓存键，确保相同的查询选项生成相同的键，无论属性顺序如何
   * @param options 查询选项
   * @returns 稳定的缓存键字符串
   */
  private generateCacheKey(options?: ReadOptions & { bypassCache?: boolean }): string {
    if (!options) {
      return '{}';
    }

    // 将选项转换为普通对象，避免TypeScript类型检查问题
    const plainOptions = options as Record<string, any>;
    
    // 将选项转换为稳定的JSON字符串，通过排序键来确保顺序一致
    const sortedOptions = Object.keys(plainOptions).sort().reduce((result: any, key) => {
      const value = plainOptions[key];
      // 递归处理嵌套对象
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // 处理嵌套对象
        const nestedPlainObj = value as Record<string, any>;
        result[key] = Object.keys(nestedPlainObj).sort().reduce((nestedResult: any, nestedKey) => {
          nestedResult[nestedKey] = nestedPlainObj[nestedKey];
          return nestedResult;
        }, {});
      } else {
        result[key] = value;
      }
      return result;
    }, {});

    return JSON.stringify(sortedOptions);
  }

  /**
   * 读取表数据
   * @param tableName 表名
   * @param options 读取选项
   * @returns Promise<Record<string, any>[]> 读取的数据数组
   */
  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 获取表元数据
        const tableMeta = this.metadataManager.get(tableName);
        if (!tableMeta) {
          // 表不存在，返回空数组
          return [];
        }

        // 检查是否需要绕过缓存
        const tableIsHighRisk = tableMeta.isHighRisk || false;
        const shouldBypassCache = options?.bypassCache || tableIsHighRisk;

        let data: Record<string, any>[] = [];
        let useIndex = false;
        let indexedIds: string[] | number[] = [];

        // 如果不需要绕过缓存，尝试从缓存中获取数据
        if (!shouldBypassCache) {
          // 生成缓存键：确保相同的查询选项生成相同的键，无论顺序如何
          const cacheKey = `${tableName}_${this.generateCacheKey(options)}`;

          // 尝试从缓存中获取数据
          const cachedData = this.cacheManager.get(cacheKey);
          if (cachedData) {
            return cachedData;
          }
        }

        // 检查是否可以使用索引
        if (options?.filter) {
          // 只有当filter是对象匹配形式时，才尝试使用索引
          if (
            typeof options.filter === 'object' &&
            options.filter !== null &&
            !('$or' in options.filter) &&
            !('$and' in options.filter)
          ) {
            const filterKeys = Object.keys(options.filter);
            // 查找是否有带索引的字段
            for (const key of filterKeys) {
              if (this.indexManager.hasIndex(tableName, key)) {
                // 使用索引查询
                const value = (options.filter as Record<string, any>)[key];
                indexedIds = this.indexManager.queryIndex(tableName, key, value) as string[] | number[];
                useIndex = indexedIds.length > 0;
                break;
              }
            }
          }
        }

        // 读取数据
        if (tableMeta.mode === 'chunked') {
          const handler = this.getChunkedHandler(tableName);
          data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
        } else {
          const handler = this.getSingleFile(tableName);
          data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
        }

        // 应用过滤
        if (useIndex) {
          // 使用索引过滤，只返回匹配索引的数据
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
          // 不使用索引，应用完整过滤条件
          data = QueryEngine.filter(data, options.filter);
        }

        // 应用排序
        if (options?.sortBy) {
          // 使用配置中的sortMethods作为默认排序算法
          const sortAlgorithm = options.sortAlgorithm || config.sortMethods;
          data = QueryEngine.sort(data, options.sortBy, options.order, sortAlgorithm);
        }

        // 应用分页
        data = QueryEngine.paginate(data, options?.skip, options?.limit);

        // 只有非高危数据才存入缓存
        if (!shouldBypassCache) {
          // 生成缓存键：使用与获取缓存时相同的方法，确保一致性
          const cacheKey = `${tableName}_${this.generateCacheKey(options)}`;

          // 将结果存入缓存
          this.cacheManager.set(cacheKey, data);

          // 记录该缓存键到表的缓存键列表中
          const tableCacheKeysKey = `${tableName}_cache_keys`;
          const tableCacheKeys = (this.cacheManager.get(tableCacheKeysKey) as string[]) || [];
          if (!tableCacheKeys.includes(cacheKey)) {
            tableCacheKeys.push(cacheKey);
            this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
          }
        }

        return data;
      },
      error => ErrorHandler.createFileError('read', `table ${tableName}`, error)
    );
  }

  /**
   * 查找单条记录
   * @param tableName 表名
   * @param filter 过滤条件
   * @returns Promise<Record<string, any> | null> 找到的记录或null
   */
  async findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 优化findOne性能，直接使用read方法的分页功能
        const results = await this.read(tableName, { filter, limit: 1 });
        const result = results.length > 0 ? results[0] : null;
        return result;
      },
      error => ErrorHandler.createQueryError('find one', tableName, error)
    );
  }

  /**
   * 查找多条记录
   * @param tableName 表名
   * @param filter 过滤条件
   * @param options 查询选项
   * @returns Promise<Record<string, any>[]> 找到的记录数组
   */
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
    return ErrorHandler.handleAsyncError(
      async () => {
        // 直接复用read方法，确保两种模式都能正确处理
        return await this.read(tableName, { filter, ...options });
      },
      error => ErrorHandler.createQueryError('find many', tableName, error)
    );
  }
}
