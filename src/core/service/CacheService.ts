import { CacheManager, type CacheStats } from '../cache/CacheManager';

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? value : [];

/**
 * Typed facade around CacheManager.
 */
export class CacheService {
  private cacheManager: CacheManager;

  /**
   * Creates a cache facade for the supplied manager.
   */
  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Stores a value in the cache.
   */
  set<T>(key: string, data: T, expiry?: number, dirty: boolean = false): void {
    this.cacheManager.set(key, data, expiry, dirty);
  }

  /**
   * Reads a value from the cache.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.cacheManager.get<T>(key);
  }

  /**
   * Removes a cached value.
   */
  delete(key: string): void {
    this.cacheManager.delete(key);
  }

  /**
   * Clears all cached values.
   */
  clear(): void {
    this.cacheManager.clear();
  }

  /**
   * Checks whether a cache key exists.
   */
  has(key: string): boolean {
    return this.cacheManager.has(key);
  }

  /**
   * Marks a cache entry as dirty.
   */
  markAsDirty(key: string): void {
    this.cacheManager.markAsDirty(key);
  }

  /**
   * Marks a cache entry as clean.
   */
  markAsClean(key: string): void {
    this.cacheManager.markAsClean(key);
  }

  /**
   * Marks several cache entries as clean.
   */
  markAsCleanBulk(keys: string[]): void {
    keys.forEach(key => {
      this.cacheManager.markAsClean(key);
    });
  }

  /**
   * Returns all dirty cache values.
   */
  getDirtyData(): Map<string, unknown> {
    return this.cacheManager.getDirtyData();
  }

  /**
   * Returns current cache statistics.
   */
  getStats(): CacheStats {
    return this.cacheManager.getStats();
  }

  /**
   * Returns the number of cached entries.
   */
  getSize(): number {
    return this.cacheManager.getSize();
  }

  /**
   * Reads or fetches a value under the manager lock.
   */
  async getSafe<T>(key: string, fetchFn: () => Promise<T>, expiry?: number): Promise<T> {
    return this.cacheManager.getSafe<T>(key, fetchFn, expiry);
  }

  /**
   * Stores a value under the manager lock.
   */
  async setSafe<T>(key: string, data: T, expiry?: number, dirty: boolean = false): Promise<void> {
    return this.cacheManager.setSafe<T>(key, data, expiry, dirty);
  }

  /**
   * Fetches a value with cache-penetration protection.
   */
  async getWithPenetrationProtection<T>(
    key: string,
    fetchFn: () => Promise<T>,
    defaultValue: T | null = null,
    expiry?: number
  ): Promise<T | null> {
    return this.cacheManager.getWithPenetrationProtection<T | null>(key, fetchFn, defaultValue, expiry);
  }

  /**
   * Clears cache entries associated with a table.
   */
  clearTableCache(tableName: string): void {
    // Use special cache key to track all cache keys for this table
    const tableCacheKeysKey = `${tableName}_cache_keys`;
    const tableCacheKeys = getStringArray(this.cacheManager.get(tableCacheKeysKey));

    for (const key of tableCacheKeys) {
      this.cacheManager.delete(key);
    }

    this.cacheManager.delete(tableCacheKeysKey);
  }

  /**
   * Records a cache key associated with a table.
   */
  recordTableCacheKey(tableName: string, cacheKey: string): void {
    const tableCacheKeysKey = `${tableName}_cache_keys`;
    const tableCacheKeys = getStringArray(this.cacheManager.get(tableCacheKeysKey));

    if (!tableCacheKeys.includes(cacheKey)) {
      tableCacheKeys.push(cacheKey);
      this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
    }
  }
}
