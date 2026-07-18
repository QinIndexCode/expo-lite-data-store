/**
 * Cache adapter interface
 */
export interface ICacheAdapter {
  /**
   * Set a cache value
   * @param key Cache key
   * @param value Cache value
   * @param options Cache options
   * @returns Promise<void>
   */
  set<T>(key: string, value: T, options?: CacheEntryOptions): Promise<void>;

  /**
   * Get a cached value
   * @param key Cache key
   * @returns The cached value for the requested type, or undefined.
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Delete a cached value
   * @param key Cache key
   * @returns Promise<void>
   */
  delete(key: string): Promise<void>;

  /**
   * Clear all cache
   * @returns Promise<void>
   */
  clear(): Promise<void>;
}

export type CacheEntryOptions = {
  expiry?: number;
  dirty?: boolean;
};
