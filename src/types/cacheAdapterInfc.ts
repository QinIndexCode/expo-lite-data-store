/**
 * @module cacheAdapterInfc
 * @description Cache adapter interface definition
 * @since 2025-11-19
 * @version 1.0.0
 */

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
  set(key: string, value: any, options?: any): Promise<void>;

  /**
   * Get a cached value
   * @param key Cache key
   * @returns Promise<any>
   */
  get(key: string): Promise<any>;

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
