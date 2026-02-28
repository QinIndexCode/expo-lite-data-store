// src/core/CacheCoordinator.ts
// 缓存协调器，负责缓存键生成、缓存读写和表级缓存清理
// 创建于: 2025-11-28
// 最后修改: 2025-12-11

import { CacheManager } from './cache/CacheManager';

/**
 * 缓存协调器类
 * 负责处理缓存管理相关的功能，包括缓存键生成、缓存读写和表级缓存清理
 * 作为缓存管理的中间层，提供统一的缓存操作接口
 */
export class CacheCoordinator {
  /**
   * 缓存管理器实例
   */
  private cacheManager: CacheManager;

  /**
   * 构造函数
   * @param cacheManager 缓存管理器实例
   */
  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * 生成缓存键
   * 使用稳定的键生成策略，确保相同内容产生相同的键
   * @param tableName 表名
   * @param options 读取选项
   * @returns 生成的缓存键
   */
  generateCacheKey(tableName: string, options?: any): string {
    return `${tableName}_${this.stableStringify(options)}`;
  }

  /**
   * 稳定的对象序列化
   * 对对象属性进行排序，确保相同内容产生相同的字符串
   * @param obj 要序列化的对象
   * @returns 稳定的JSON字符串
   */
  private stableStringify(obj: any): string {
    if (obj === undefined) {
      return 'undefined';
    }
    if (obj === null) {
      return 'null';
    }
    if (typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.stableStringify(item)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(key => `"${key}":${this.stableStringify(obj[key])}`);
    return '{' + pairs.join(',') + '}';
  }

  /**
   * 从缓存中获取数据
   * @param key 缓存键
   * @returns 缓存数据，如果不存在则返回undefined
   */
  getFromCache(key: string): any {
    return this.cacheManager.get(key);
  }

  /**
   * 将数据存入缓存
   * @param key 缓存键
   * @param data 要缓存的数据
   */
  setToCache(key: string, data: any): void {
    this.cacheManager.set(key, data);
  }

  /**
   * 清除与特定表相关的所有缓存条目
   * @param tableName 表名
   */
  clearTableCache(tableName: string): void {
    // 由于我们无法直接遍历CacheManager的内部缓存，
    // 我们需要使用一种策略来清除相关缓存
    // 这里我们使用一个特殊的缓存键来记录所有与该表相关的缓存键
    const tableCacheKeysKey = `${tableName}_cache_keys`;
    const tableCacheKeys = (this.cacheManager.get(tableCacheKeysKey) as string[]) || [];

    // 删除所有相关缓存条目
    for (const key of tableCacheKeys) {
      this.cacheManager.delete(key);
    }

    // 清除缓存键列表
    this.cacheManager.delete(tableCacheKeysKey);
  }

  /**
   * 记录表的缓存键
   * @param tableName 表名
   * @param cacheKey 缓存键
   */
  recordTableCacheKey(tableName: string, cacheKey: string): void {
    const tableCacheKeysKey = `${tableName}_cache_keys`;
    const tableCacheKeys = (this.cacheManager.get(tableCacheKeysKey) as string[]) || [];
    if (!tableCacheKeys.includes(cacheKey)) {
      tableCacheKeys.push(cacheKey);
      this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
    }
  }

  /**
   * 获取缓存管理器实例
   * @returns 缓存管理器实例
   */
  getCacheManager(): CacheManager {
    return this.cacheManager;
  }
}
