import { CacheManager, type CacheStats } from '../cache/CacheManager';

export class CacheService {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  set<T>(key: string, data: T, expiry?: number, dirty: boolean = false): void {
    this.cacheManager.set(key, data, expiry, dirty);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.cacheManager.get<T>(key);
  }

  delete(key: string): void {
    this.cacheManager.delete(key);
  }

  clear(): void {
    this.cacheManager.clear();
  }

  has(key: string): boolean {
    return this.cacheManager.has(key);
  }

  markAsDirty(key: string): void {
    this.cacheManager.markAsDirty(key);
  }

  markAsClean(key: string): void {
    this.cacheManager.markAsClean(key);
  }

  markAsCleanBulk(keys: string[]): void {
    keys.forEach(key => {
      this.cacheManager.markAsClean(key);
    });
  }

  getDirtyData(): Map<string, unknown> {
    return this.cacheManager.getDirtyData();
  }

  getStats(): CacheStats {
    return this.cacheManager.getStats();
  }

  getSize(): number {
    return this.cacheManager.getSize();
  }

  async getSafe<T>(key: string, fetchFn: () => Promise<T>, expiry?: number): Promise<T> {
    return this.cacheManager.getSafe<T>(key, fetchFn, expiry);
  }

  async setSafe<T>(key: string, data: T, expiry?: number, dirty: boolean = false): Promise<void> {
    return this.cacheManager.setSafe<T>(key, data, expiry, dirty);
  }

  async getWithPenetrationProtection<T>(
    key: string,
    fetchFn: () => Promise<T>,
    defaultValue: T | null = null,
    expiry?: number
  ): Promise<T | null> {
    return this.cacheManager.getWithPenetrationProtection<T | null>(key, fetchFn, defaultValue, expiry);
  }

  /**
   * Invalidates cache entries associated with a table in constant time.
   */
  clearTableCache(tableName: string): void {
    this.cacheManager.invalidateNamespace(tableName);
  }
}
