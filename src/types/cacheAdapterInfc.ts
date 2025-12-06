//src/cache/cacheAdapter.ts
// 缓存适配器接口 / Cache Adapter Interface

//定义缓存适配器接口
export interface ICacheAdapter {
  /**
   *
   *
   *
   *
   * @param key 缓存键 / Cache Key
   * @param value 缓存值 / Cache Value
   * @param options 缓存选项 / Cache Options
   * @returns Promise<void>
   */
  set(key: string, value: any, options?: any): Promise<void>;

  /**
   * 获取缓存值 / Get Cache Value
   * @param key 缓存键 / Cache Key
   * @returns Promise<any>
   */
  get(key: string): Promise<any>;

  /**
   * 删除缓存值 / Delete Cache Value
   * @param key 缓存键 / Cache Key
   * @returns Promise<void>
   */
  delete(key: string): Promise<void>;

  /**
   * 清空缓存 / Clear Cache
   * @returns Promise<void>
   */
  clear(): Promise<void>;
}
