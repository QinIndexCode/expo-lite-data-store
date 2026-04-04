/**
 * @module CacheManager
 * @description Cache manager with LRU/LFU strategies, compression, and protection mechanisms
 * @since 2025-11-28
 * @version 1.0.0
 */

import { CACHE } from '../constants';
import { configManager } from '../config/ConfigManager';

/**
 * 缓存策略枚举
 */
export enum CacheStrategy {
  LRU = 'lru', // Least Recently Used
  LFU = 'lfu', // Least Frequently Used
}

/**
 * 缓存项接口
 */
export interface CacheItem {
  /**
   * 缓存数据（可能是压缩的）
   */
  data: any;
  /**
   * 过期时间戳（毫秒）
   */
  expiry: number;
  /**
   * 访问次数（用于LFU策略）
   */
  accessCount: number;
  /**
   * 最后访问时间（用于LRU策略）
   */
  lastAccess: number;
  /**
   * 是否为脏数据（需要写入磁盘）
   */
  dirty: boolean;
  /**
   * 是否已压缩
   */
  compressed: boolean;
  /**
   * 压缩前大小（字节）
   */
  originalSize: number;
  /**
   * 缓存键（用于快速访问）
   */
  key?: string;
  /**
   * 前一个节点（用于LRU双向链表）
   */
  prev?: CacheItem | null;
  /**
   * 后一个节点（用于LRU双向链表）
   */
  next?: CacheItem | null;
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  /**
   * 缓存策略
   */
  strategy: CacheStrategy;
  /**
   * 缓存最大容量（项数）
   */
  maxSize: number;
  /**
   * 缓存最大内存使用量（字节）
   */
  maxMemoryUsage?: number;
  /**
   * 内存使用阈值，超过该阈值时触发清理（百分比，0-1）
   */
  memoryThreshold?: number;
  /**
   * 默认过期时间（毫秒）
   */
  defaultExpiry: number;
  /**
   * 是否启用缓存穿透防护
   */
  enablePenetrationProtection: boolean;
  /**
   * 是否启用缓存击穿防护
   */
  enableBreakdownProtection: boolean;
  /**
   * 是否启用缓存雪崩防护
   */
  enableAvalancheProtection: boolean;
  /**
   * 缓存雪崩防护的随机过期时间范围（毫秒）
   */
  avalancheRandomExpiry: [number, number];
  /**
   * 是否启用缓存压缩
   */
  enableCompression?: boolean;
}

/**
 * 缓存统计信息接口
 */
export interface CacheStats {
  /**
   * 缓存命中率
   */
  hitRate: number;
  /**
   * 缓存命中次数
   */
  hits: number;
  /**
   * 缓存未命中次数
   */
  misses: number;
  /**
   * 缓存项数量
   */
  size: number;
  /**
   * 缓存最大容量
   */
  maxSize: number;
  /**
   * 缓存淘汰次数
   */
  evictions: number;
  /**
   * 缓存写入次数
   */
  writes: number;
  /**
   * 缓存读取次数
   */
  reads: number;
  /**
   * 当前内存使用量（字节）
   */
  memoryUsage: number;
  /**
   * 缓存最大内存使用量（字节）
   */
  maxMemoryUsage: number;
}

/**
 * 缓存管理器类
 *
 * 设计模式：单例模式 + 策略模式
 * 用途：管理缓存数据，实现不同的缓存策略和防护措施
 * 优势：
 * - 支持多种缓存策略（LRU/LFU）
 * - 实现了完整的缓存防护措施
 * - 提供了缓存统计信息
 * - 线程安全的缓存操作
 * - 支持缓存一致性维护
 * - 基于内存使用量的智能清理
 */
export class CacheManager {
  /**
   * 缓存数据映射
   */
  private cache = new Map<string, CacheItem>();

  /**
   * LRU双向链表节点
   */
  private lruHead: CacheItem | null = null;
  private lruTail: CacheItem | null = null;

  /**
   * LRU节点映射，用于快速访问节点
   */
  private lruNodeMap = new Map<string, CacheItem>();

  /**
   * LFU频率映射，key为访问次数，value为该频率的所有缓存项
   */
  private lfuFreqMap = new Map<number, Set<string>>();

  /**
   * 当前最小访问频率
   */
  private lfuMinFreq = 0;

  /**
   * 缓存配置
   */
  private config: CacheConfig;

  /**
   * 缓存统计信息
   */
  private stats: CacheStats = {
    hitRate: 0,
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: 0,
    evictions: 0,
    writes: 0,
    reads: 0,
    memoryUsage: 0,
    maxMemoryUsage: 0,
  };

  /**
   * 互斥锁，用于保证线程安全
   */
  private mutex = new Map<string, Promise<void>>();

  /**
   * 清理定时器引用
   */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 最小堆：按过期时间排序，用于 O(log n) 过期检测
   * 存储 [expiry, key] 对
   */
  private expiryHeap: [number, string][] = [];

  /**
   * 将元素插入最小堆
   */
  private heapPush(expiry: number, key: string): void {
    this.expiryHeap.push([expiry, key]);
    this.heapifyUp(this.expiryHeap.length - 1);
  }

  /**
   * 从最小堆中弹出最小元素
   */
  private heapPop(): [number, string] | undefined {
    if (this.expiryHeap.length === 0) return undefined;
    if (this.expiryHeap.length === 1) return this.expiryHeap.pop();

    const min = this.expiryHeap[0];
    this.expiryHeap[0] = this.expiryHeap.pop()!;
    this.heapifyDown(0);
    return min;
  }

  private heapifyUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.expiryHeap[parent][0] <= this.expiryHeap[idx][0]) break;
      [this.expiryHeap[parent], this.expiryHeap[idx]] = [this.expiryHeap[idx], this.expiryHeap[parent]];
      idx = parent;
    }
  }

  private heapifyDown(idx: number): void {
    const n = this.expiryHeap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.expiryHeap[left][0] < this.expiryHeap[smallest][0]) smallest = left;
      if (right < n && this.expiryHeap[right][0] < this.expiryHeap[smallest][0]) smallest = right;
      if (smallest === idx) break;
      [this.expiryHeap[smallest], this.expiryHeap[idx]] = [this.expiryHeap[idx], this.expiryHeap[smallest]];
      idx = smallest;
    }
  }

  /**
   * 构造函数
   *
   * @param config 缓存配置
   */
  constructor(config: Partial<CacheConfig> = {}) {
    // Default config
    this.config = {
      strategy: CacheStrategy.LRU,
      maxSize: config.maxSize || CacheManager.getDefaultMaxSize(),
      defaultExpiry: config.defaultExpiry || CacheManager.getDefaultExpiry(),
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
      avalancheRandomExpiry: CACHE.AVALANCHE_PROTECTION_RANGE, // 0-5分钟
      memoryThreshold: config.memoryThreshold || CacheManager.getDefaultMemoryThreshold(),
      enableCompression: config.enableCompression || CacheManager.getDefaultEnableCompression(),
      ...config,
    };

    // Initialize统计信息
    this.stats.maxSize = this.config.maxSize;
    this.stats.maxMemoryUsage = this.config.maxMemoryUsage || 0;

    // Periodically clean expired cache
    // Timer cleaned by afterEach cleanup() in test
    this.startCleanupTimer();
  }

  /**
   * 清理资源，停止定时器和锁
   */
  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cleanup所有锁
    this.mutex.clear();
  }

  /**
   * 将节点添加到LRU链表头部
   * @param key 缓存键
   * @param item 缓存项
   */
  private addToLRUHead(key: string, item: CacheItem): void {
    item.key = key;
    item.prev = null;
    item.next = this.lruHead;

    if (this.lruHead) {
      this.lruHead.prev = item;
    }
    this.lruHead = item;

    if (!this.lruTail) {
      this.lruTail = item;
    }

    this.lruNodeMap.set(key, item);
  }

  /**
   * 从LRU链表中移除节点
   * @param key 缓存键
   */
  private removeFromLRU(key: string): void {
    const item = this.lruNodeMap.get(key);
    if (!item) return;

    if (item.prev) {
      item.prev.next = item.next || null;
    } else {
      this.lruHead = item.next || null;
    }

    if (item.next) {
      item.next.prev = item.prev || null;
    } else {
      this.lruTail = item.prev || null;
    }

    this.lruNodeMap.delete(key);
  }

  /**
   * 将节点移动到LRU链表头部
   * @param key 缓存键
   */
  private moveToLRUHead(key: string): void {
    this.removeFromLRU(key);
    const item = this.cache.get(key);
    if (item) {
      this.addToLRUHead(key, item);
    }
  }

  /**
   * 更新LFU频率
   * @param key 缓存键
   */
  private updateLFU(key: string): void {
    const item = this.cache.get(key);
    if (!item) return;

    // Remove旧频率
    const oldFreq = item.accessCount;
    const oldFreqSet = this.lfuFreqMap.get(oldFreq);
    if (oldFreqSet) {
      oldFreqSet.delete(key);
      if (oldFreqSet.size === 0) {
        this.lfuFreqMap.delete(oldFreq);
        // If current is min freq, update min freq
        if (oldFreq === this.lfuMinFreq) {
          this.lfuMinFreq++;
        }
      }
    }

    // Increase access count
    item.accessCount++;
    const newFreq = item.accessCount;

    // Add到新频率
    if (!this.lfuFreqMap.has(newFreq)) {
      this.lfuFreqMap.set(newFreq, new Set());
    }
    this.lfuFreqMap.get(newFreq)?.add(key);
  }

  /**
   * 从LFU中移除项
   * @returns 被移除的缓存键
   */
  private removeLFUItem(): string | undefined {
    // Find min frequency set
    const minFreqSet = this.lfuFreqMap.get(this.lfuMinFreq);
    if (!minFreqSet || minFreqSet.size === 0) return undefined;

    // Remove第一个元素
    const keyResult = minFreqSet.values().next();
    if (keyResult.done) return undefined;

    const key = keyResult.value;
    if (key) {
      minFreqSet.delete(key);

      // If set empty, delete frequency
      if (minFreqSet.size === 0) {
        this.lfuFreqMap.delete(this.lfuMinFreq);
      }
    }

    return key;
  }

  /**
   * 启动定期清理过期缓存的定时器
   */
  private startCleanupTimer(): void {
    // If timer exists, clean first
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    // Use cleanup interval from config
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, CacheManager.getDefaultCleanupInterval());
  }

  /**
   * 清理过期缓存
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;

    // Use min heap for fast expiry detection：O(k log n) 其中 k 是过期项数量
    while (this.expiryHeap.length > 0) {
      const top = this.expiryHeap[0];
      if (top[0] >= now) break; // Heap top not expired, rest neither

      this.heapPop(); // Remove堆顶
      const key = top[1];
      const item = this.cache.get(key);

      // May be deleted by other logic, skip
      if (!item) continue;

      const itemSize = this.calculateDataSize(item.data);
      this.stats.memoryUsage -= itemSize;

      if (this.config.strategy === CacheStrategy.LRU) {
        this.removeFromLRU(key);
      } else if (this.config.strategy === CacheStrategy.LFU) {
        const freq = item.accessCount;
        const freqSet = this.lfuFreqMap.get(freq);
        if (freqSet) {
          freqSet.delete(key);
          if (freqSet.size === 0) {
            this.lfuFreqMap.delete(freq);
            if (freq === this.lfuMinFreq) {
              this.lfuMinFreq++;
            }
          }
        }
      }

      this.cache.delete(key);
      removed++;
    }

    if (removed > 0) {
      this.updateStats();
    }
  }

  /**
   * 计算数据大小（字节）
   * @param data 要计算大小的数据
   * @returns 数据大小（字节）
   */
  private calculateDataSize(data: any): number {
    if (data === null || data === undefined) {
      return 0;
    }

    // Approximate: use JSON string length * 2（UTF-16）
    // 10-100x faster than recursive，误差约 5-15%
    try {
      const jsonStr = JSON.stringify(data);
      return jsonStr.length * 2;
    } catch {
      // Loop引用等无法序列化的情况，返回固定估算值
      if (typeof data === 'object') {
        return Object.keys(data).length * 64; // Estimate 64 bytes per property
      }
      return 64;
    }
  }

  /**
   * 更新缓存统计信息
   */
  private updateStats(): void {
    this.stats.size = this.cache.size;
    this.stats.hitRate = this.stats.reads > 0 ? this.stats.hits / this.stats.reads : 0;
  }

  /**
   * 计算缓存过期时间
   *
   * @param customExpiry 自定义过期时间（毫秒）
   * @returns 计算后的过期时间戳
   */
  private calculateExpiry(customExpiry?: number): number {
    const baseExpiry = customExpiry || this.config.defaultExpiry;
    const now = Date.now();

    // If cache avalanche protection enabled且过期时间较长（>1秒），添加随机过期时间
    if (this.config.enableAvalancheProtection && baseExpiry > 1000) {
      const [min, max] = this.config.avalancheRandomExpiry;
      const randomExpiry = Math.random() * (max - min) + min;
      return now + baseExpiry + randomExpiry;
    }

    return now + baseExpiry;
  }

  /**
   * 根据缓存策略淘汰缓存项
   * @param force 是否强制淘汰（用于内存清理，即使缓存未满也淘汰）
   */
  private evictItem(force: boolean = false): void {
    // If not forced eviction and cache not full, return
    if (!force && this.cache.size <= this.config.maxSize) {
      return;
    }

    // If cache empty, cannot evict
    if (this.cache.size === 0) {
      return;
    }

    let evictKey: string | undefined;

    switch (this.config.strategy) {
      case CacheStrategy.LRU:
        // Remove oldest item from LRU list tail
        if (this.lruTail && this.lruTail.key) {
          evictKey = this.lruTail.key;
          this.removeFromLRU(evictKey);
        }
        break;
      case CacheStrategy.LFU:
        // Remove min frequency item from LFU
        evictKey = this.removeLFUItem();
        break;
    }

    if (evictKey) {
      const item = this.cache.get(evictKey);
      if (item) {
        const itemSize = this.calculateDataSize(item.data);
        this.stats.memoryUsage -= itemSize;
      }
      this.cache.delete(evictKey);
      this.stats.evictions++;
      this.updateStats();
    }
  }

  /**
   * 根据内存使用量清理缓存
   */
  private cleanupByMemoryUsage(): void {
    // If max memory not configured, return directly
    if (!this.config.maxMemoryUsage) {
      return;
    }

    // Calculate内存使用阈值
    const threshold = this.config.maxMemoryUsage * (this.config.memoryThreshold || 0.8);

    // If memory usage below threshold, return directly
    if (this.stats.memoryUsage <= threshold) {
      return;
    }

    // Target memory usage for cleanup (70% of threshold)
    const targetUsage = this.config.maxMemoryUsage * 0.7;

    // Start清理，直到达到目标使用量或缓存为空
    while (this.stats.memoryUsage > targetUsage && this.cache.size > 0) {
      this.evictItem(true); // Force eviction for memory cleanup
    }
  }

  /**
   * 获取缓存项
   *
   * @param key 缓存键
   * @returns 缓存项，如果不存在或已过期则返回undefined
   */
  private getCacheItem(key: string): CacheItem | undefined {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }

    // Check if过期
    if (item.expiry < Date.now()) {
      this.cache.delete(key);
      // Remove from LRU or LFU
      if (this.config.strategy === CacheStrategy.LRU) {
        this.removeFromLRU(key);
      } else if (this.config.strategy === CacheStrategy.LFU) {
        this.updateLFU(key); // This removes old frequency
      }
      this.updateStats();
      return undefined;
    }

    // Update访问信息
    item.lastAccess = Date.now();

    // Update cache structure by strategy
    if (this.config.strategy === CacheStrategy.LRU) {
      this.moveToLRUHead(key);
    } else if (this.config.strategy === CacheStrategy.LFU) {
      this.updateLFU(key);
    }

    return item;
  }

  /**
   * 设置缓存项
   *
   * @param key 缓存键
   * @param data 缓存数据
   * @param expiry 自定义过期时间（毫秒）
   * @param dirty 是否为脏数据
   */
  private setCacheItem(key: string, data: any, expiry?: number, dirty: boolean = false): void {
    const now = Date.now();
    const originalDataSize = this.calculateDataSize(data);

    // If key exists, remove old item and subtract size
    if (this.cache.has(key)) {
      const oldItem = this.cache.get(key);
      if (oldItem) {
        const oldSize = oldItem.compressed ? this.calculateDataSize(oldItem.data) : oldItem.originalSize;
        this.stats.memoryUsage -= oldSize;
      }

      if (this.config.strategy === CacheStrategy.LRU) {
        this.removeFromLRU(key);
      } else if (this.config.strategy === CacheStrategy.LFU) {
        const oldItem = this.cache.get(key);
        if (oldItem) {
          const oldFreq = oldItem.accessCount;
          const oldFreqSet = this.lfuFreqMap.get(oldFreq);
          if (oldFreqSet) {
            oldFreqSet.delete(key);
            if (oldFreqSet.size === 0) {
              this.lfuFreqMap.delete(oldFreq);
              if (oldFreq === this.lfuMinFreq) {
                this.lfuMinFreq++;
              }
            }
          }
        }
      }
    }

    const processedData = data;
    const compressed = false;

    // Calculate the final data size
    const finalDataSize = originalDataSize;

    const cacheItem: CacheItem = {
      data: processedData,
      expiry: this.calculateExpiry(expiry),
      accessCount: 1,
      lastAccess: now,
      dirty,
      compressed,
      originalSize: originalDataSize,
    };

    this.cache.set(key, cacheItem);
    this.stats.writes++;

    // Add expiry to min heap for fast cleanup
    this.heapPush(cacheItem.expiry, key);

    // Add新数据的大小
    this.stats.memoryUsage += finalDataSize;

    // Update cache structure by strategy
    if (this.config.strategy === CacheStrategy.LRU) {
      this.addToLRUHead(key, cacheItem);
    } else if (this.config.strategy === CacheStrategy.LFU) {
      // New item access frequency is 1
      if (!this.lfuFreqMap.has(1)) {
        this.lfuFreqMap.set(1, new Set());
      }
      this.lfuFreqMap.get(1)?.add(key);
      this.lfuMinFreq = 1;
    }

    // If cache full, evict old item
    this.evictItem();

    // Check内存使用量，如果超过阈值则清理
    this.cleanupByMemoryUsage();

    this.updateStats();
  }

  /**
   * 获取缓存数据
   *
   * @param key 缓存键
   * @returns 缓存数据，如果不存在或已过期则返回undefined
   */
  get(key: string): any {
    this.stats.reads++;

    const item = this.getCacheItem(key);
    if (item) {
      this.stats.hits++;
      this.updateStats();
      return item.data;
    }

    this.stats.misses++;
    this.updateStats();
    return undefined;
  }

  /**
   * 设置缓存数据
   *
   * @param key 缓存键
   * @param data 缓存数据
   * @param expiry 自定义过期时间（毫秒）
   * @param dirty 是否为脏数据
   */
  set(key: string, data: any, expiry?: number, dirty: boolean = false): void {
    this.setCacheItem(key, data, expiry, dirty);
  }

  /**
   * 删除缓存数据
   *
   * @param key 缓存键
   */
  delete(key: string): void {
    if (this.cache.has(key)) {
      // Subtract size of item to delete
      const item = this.cache.get(key);
      if (item) {
        const itemSize = this.calculateDataSize(item.data);
        this.stats.memoryUsage -= itemSize;
      }

      // Remove from LRU or LFU
      if (this.config.strategy === CacheStrategy.LRU) {
        this.removeFromLRU(key);
      } else if (this.config.strategy === CacheStrategy.LFU) {
        const item = this.cache.get(key);
        if (item) {
          const freq = item.accessCount;
          const freqSet = this.lfuFreqMap.get(freq);
          if (freqSet) {
            freqSet.delete(key);
            if (freqSet.size === 0) {
              this.lfuFreqMap.delete(freq);
              if (freq === this.lfuMinFreq) {
                this.lfuMinFreq++;
              }
            }
          }
        }
      }
      this.cache.delete(key);
      this.updateStats();
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.expiryHeap = [];
    // Clear LRU data structures
    this.lruHead = null;
    this.lruTail = null;
    this.lruNodeMap.clear();
    // Clear LFU data structures
    this.lfuFreqMap.clear();
    this.lfuMinFreq = 0;
    // Reset内存使用量
    this.stats.memoryUsage = 0;
    this.updateStats();
  }

  /**
   * 标记缓存项为脏数据
   *
   * @param key 缓存键
   */
  markAsDirty(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      item.dirty = true;
    }
  }

  /**
   * 标记缓存项为干净数据
   *
   * @param key 缓存键
   */
  markAsClean(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      item.dirty = false;
    }
  }

  /**
   * 获取所有脏数据
   *
   * @returns 脏数据映射，键为缓存键，值为缓存数据
   */
  getDirtyData(): Map<string, any> {
    const dirtyData = new Map<string, any>();
    for (const [key, item] of this.cache.entries()) {
      if (item.dirty) {
        dirtyData.set(key, item.data);
      }
    }
    return dirtyData;
  }

  /**
   * 获取缓存统计信息
   *
   * @returns 缓存统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 获取缓存大小
   *
   * @returns 缓存项数量
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * 检查缓存键是否存在
   *
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.getCacheItem(key) !== undefined;
  }

  /**
   * 加锁，用于保证线程安全
   *
   * @param key 锁键
   * @returns 解锁函数
   */
  private async lock(key: string): Promise<() => void> {
    // Wait之前的锁释放
    while (this.mutex.has(key)) {
      await this.mutex.get(key);
    }

    let resolve: () => void;
    const promise = new Promise<void>(res => {
      resolve = res;
    });

    this.mutex.set(key, promise);

    return () => {
      resolve!();
      this.mutex.delete(key);
    };
  }

  /**
   * 线程安全的获取缓存数据
   *
   * @param key 缓存键
   * @param fetchFn 获取数据的函数（当缓存不存在时调用）
   * @param expiry 自定义过期时间（毫秒）
   * @returns 缓存数据
   */
  async getSafe(key: string, fetchFn: () => Promise<any>, expiry?: number): Promise<any> {
    // Try to get from cache first
    let data = this.get(key);
    if (data !== undefined) {
      return data;
    }

    // Lock to prevent cache stampede
    const unlock = await this.lock(key);
    try {
      // Re-check cache to prevent duplicate fetch
      data = this.get(key);
      if (data !== undefined) {
        return data;
      }

      // Get数据
      data = await fetchFn();

      // Set缓存
      this.set(key, data, expiry);

      return data;
    } finally {
      unlock();
    }
  }

  /**
   * 线程安全的设置缓存数据
   *
   * @param key 缓存键
   * @param data 缓存数据
   * @param expiry 自定义过期时间（毫秒）
   * @param dirty 是否为脏数据
   */
  async setSafe(key: string, data: any, expiry?: number, dirty: boolean = false): Promise<void> {
    const unlock = await this.lock(key);
    try {
      this.set(key, data, expiry, dirty);
    } finally {
      unlock();
    }
  }

  /**
   * 缓存穿透防护：获取缓存数据，如果不存在则返回默认值
   *
   * @param key 缓存键
   * @param fetchFn 获取数据的函数
   * @param defaultValue 默认值
   * @param expiry 自定义过期时间（毫秒）
   * @returns 缓存数据或默认值
   */
  async getWithPenetrationProtection(
    key: string,
    fetchFn: () => Promise<any>,
    defaultValue: any = null,
    expiry?: number
  ): Promise<any> {
    if (!this.config.enablePenetrationProtection) {
      return this.getSafe(key, fetchFn, expiry);
    }

    try {
      const data = await this.getSafe(key, fetchFn, expiry);
      if (data === null || data === undefined) {
        // Cache穿透防护：将默认值存入缓存
        this.set(key, defaultValue, expiry || 60000); // Cache1分钟
        return defaultValue;
      }
      return data;
    } catch (error) {
      // Cache穿透防护：发生错误时返回默认值
      return defaultValue;
    }
  }

  /**
   * 从配置文件获取默认缓存最大大小
   * @returns 默认缓存最大大小
   */
  static getDefaultMaxSize(): number {
    return configManager.getConfig().cache?.maxSize || CACHE.DEFAULT_MAX_SIZE;
  }

  /**
   * 从配置文件获取默认缓存过期时间
   * @returns 默认缓存过期时间（毫秒）
   */
  static getDefaultExpiry(): number {
    return configManager.getConfig().cache?.defaultExpiry || CACHE.DEFAULT_EXPIRY;
  }

  /**
   * 从配置文件获取默认内存使用阈值
   * @returns 默认内存使用阈值（0-1之间的小数）
   */
  static getDefaultMemoryThreshold(): number {
    return configManager.getConfig().cache?.memoryWarningThreshold || CACHE.MEMORY_THRESHOLD;
  }

  /**
   * 从配置文件获取是否启用缓存压缩
   * @returns 是否启用缓存压缩
   * @deprecated 缓存压缩功能已弃用，始终返回false
   */
  static getDefaultEnableCompression(): boolean {
    return false; // Cache压缩功能已弃用
  }

  /**
   * 从配置文件获取默认缓存清理间隔
   * @returns 默认缓存清理间隔（毫秒）
   */
  static getDefaultCleanupInterval(): number {
    return configManager.getConfig().cache?.cleanupInterval || CACHE.CLEANUP_INTERVAL;
  }
}
