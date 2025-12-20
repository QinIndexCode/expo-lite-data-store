// src/core/service/CacheService.ts
// 缓存服务，负责管理数据缓存
// 创建于: 2025-11-28
// 最后修改: 2025-12-11
import { CacheManager } from '../cache/CacheManager';

/**
 * 缓存服务类
 * 提供统一的缓存操作接口，封装了 CacheManager 的功能
 * 负责管理数据缓存，包括缓存的读写、删除、清理和统计等
 */
export class CacheService {
  private cacheManager: CacheManager;

  /**
   * 构造函数
   * @param cacheManager 缓存管理器实例
   */
  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * 设置缓存
   */
  set(key: string, data: any, expiry?: number, dirty: boolean = false): void {
    this.cacheManager.set(key, data, expiry, dirty);
  }

  /**
   * 获取缓存
   */
  get(key: string): any {
    return this.cacheManager.get(key);
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.cacheManager.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cacheManager.clear();
  }

  /**
   * 检查缓存键是否存在
   */
  has(key: string): boolean {
    return this.cacheManager.has(key);
  }

  /**
   * 标记缓存项为脏数据
   */
  markAsDirty(key: string): void {
    this.cacheManager.markAsDirty(key);
  }

  /**
   * 标记缓存项为干净数据
   */
  markAsClean(key: string): void {
    this.cacheManager.markAsClean(key);
  }

  /**
   * 批量标记缓存项为干净数据
   */
  markAsCleanBulk(keys: string[]): void {
    keys.forEach(key => {
      this.cacheManager.markAsClean(key);
    });
  }

  /**
   * 获取所有脏数据
   */
  getDirtyData(): Map<string, any> {
    return this.cacheManager.getDirtyData();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): any {
    return this.cacheManager.getStats();
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.cacheManager.getSize();
  }

  /**
   * 线程安全的获取缓存数据
   */
  async getSafe(key: string, fetchFn: () => Promise<any>, expiry?: number): Promise<any> {
    return this.cacheManager.getSafe(key, fetchFn, expiry);
  }

  /**
   * 线程安全的设置缓存数据
   */
  async setSafe(key: string, data: any, expiry?: number, dirty: boolean = false): Promise<void> {
    return this.cacheManager.setSafe(key, data, expiry, dirty);
  }

  /**
   * 缓存穿透防护
   */
  async getWithPenetrationProtection(
    key: string,
    fetchFn: () => Promise<any>,
    defaultValue: any = null,
    expiry?: number
  ): Promise<any> {
    return this.cacheManager.getWithPenetrationProtection(key, fetchFn, defaultValue, expiry);
  }

  /**
   * 清除与特定表相关的所有缓存
   */
  clearTableCache(tableName: string): void {
    // 使用特殊的缓存键来记录所有与该表相关的缓存键
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
   * 记录与表相关的缓存键
   */
  recordTableCacheKey(tableName: string, cacheKey: string): void {
    const tableCacheKeysKey = `${tableName}_cache_keys`;
    const tableCacheKeys = (this.cacheManager.get(tableCacheKeysKey) as string[]) || [];

    if (!tableCacheKeys.includes(cacheKey)) {
      tableCacheKeys.push(cacheKey);
      this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
    }
  }
}
