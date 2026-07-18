import { CACHE } from '../constants';
import { configManager } from '../config/ConfigManager';

const EXPIRY_HEAP_REBUILD_MULTIPLIER = 4;
const MIN_EXPIRY_HEAP_SIZE = 64;

export enum CacheStrategy {
  LRU = 'lru', // Least Recently Used
  LFU = 'lfu', // Least Frequently Used
}

export interface CacheItem {
  data: unknown;

  expiry: number;

  accessCount: number;

  lastAccess: number;

  dirty: boolean;

  compressed: boolean;

  originalSize: number;

  key?: string;

  prev?: CacheItem | null;

  next?: CacheItem | null;
}

export interface CacheConfig {
  strategy: CacheStrategy;

  maxSize: number;

  maxMemoryUsage?: number;

  memoryThreshold?: number;

  defaultExpiry: number;

  enablePenetrationProtection: boolean;

  enableBreakdownProtection: boolean;

  enableAvalancheProtection: boolean;

  avalancheRandomExpiry: [number, number];

  enableCompression?: boolean;
}

export interface CacheStats {
  hitRate: number;

  hits: number;

  misses: number;

  size: number;

  maxSize: number;

  evictions: number;

  writes: number;

  reads: number;

  memoryUsage: number;

  maxMemoryUsage: number;
}

export class CacheManager {
  private cache = new Map<string, CacheItem>();

  private lruHead: CacheItem | null = null;
  private lruTail: CacheItem | null = null;

  private lruNodeMap = new Map<string, CacheItem>();

  private lfuFreqMap = new Map<number, Set<string>>();

  private lfuMinFreq = 0;

  private config: CacheConfig;

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

  private mutex = new Map<string, Promise<void>>();

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private expiryHeap: [number, string][] = [];

  private heapPush(expiry: number, key: string): void {
    this.expiryHeap.push([expiry, key]);
    this.heapifyUp(this.expiryHeap.length - 1);
  }

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

  private rebuildExpiryHeapIfNeeded(): void {
    const maxHeapEntries = Math.max(MIN_EXPIRY_HEAP_SIZE, this.cache.size * EXPIRY_HEAP_REBUILD_MULTIPLIER);
    if (this.expiryHeap.length <= maxHeapEntries) {
      return;
    }

    this.expiryHeap = Array.from(this.cache, ([key, item]): [number, string] => [item.expiry, key]);

    for (let index = Math.floor(this.expiryHeap.length / 2) - 1; index >= 0; index--) {
      this.heapifyDown(index);
    }
  }

  constructor(config: Partial<CacheConfig> = {}) {
    // Default config
    this.config = {
      strategy: CacheStrategy.LRU,
      maxSize: config.maxSize || CacheManager.getDefaultMaxSize(),
      defaultExpiry: config.defaultExpiry || CacheManager.getDefaultExpiry(),
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
      avalancheRandomExpiry: CACHE.AVALANCHE_PROTECTION_RANGE,
      memoryThreshold: config.memoryThreshold || CacheManager.getDefaultMemoryThreshold(),
      enableCompression: config.enableCompression || CacheManager.getDefaultEnableCompression(),
      ...config,
    };
    this.stats.maxSize = this.config.maxSize;
    this.stats.maxMemoryUsage = this.config.maxMemoryUsage || 0;

    // Periodically clean expired cache
    // Timer cleaned by afterEach cleanup() in test
    this.startCleanupTimer();
  }

  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.mutex.clear();
  }

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

  private moveToLRUHead(key: string): void {
    this.removeFromLRU(key);
    const item = this.cache.get(key);
    if (item) {
      this.addToLRUHead(key, item);
    }
  }

  private updateLFU(key: string): void {
    const item = this.cache.get(key);
    if (!item) return;
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
    if (!this.lfuFreqMap.has(newFreq)) {
      this.lfuFreqMap.set(newFreq, new Set());
    }
    this.lfuFreqMap.get(newFreq)?.add(key);
  }

  private removeLFUItem(): string | undefined {
    // Find min frequency set
    const minFreqSet = this.lfuFreqMap.get(this.lfuMinFreq);
    if (!minFreqSet || minFreqSet.size === 0) return undefined;
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

  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    while (this.expiryHeap.length > 0) {
      const top = this.expiryHeap[0];
      if (top[0] >= now) break; // Heap top not expired, rest neither

      this.heapPop();
      const key = top[1];
      const item = this.cache.get(key);

      // May be deleted by other logic, skip
      if (!item) continue;
      // A key can be refreshed before an older heap entry expires. Only the
      // heap entry matching the current item expiry is allowed to evict it.
      if (item.expiry !== top[0]) continue;

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

    this.rebuildExpiryHeapIfNeeded();

    if (removed > 0) {
      this.updateStats();
    }
  }

  private calculateDataSize(data: unknown): number {
    if (data === null || data === undefined) {
      return 0;
    }

    // Approximate: use JSON string length * 2（UTF-16）
    try {
      const jsonStr = JSON.stringify(data);
      return jsonStr.length * 2;
    } catch {
      if (typeof data === 'object') {
        return Object.keys(data).length * 64; // Estimate 64 bytes per property
      }
      return 64;
    }
  }

  private updateStats(): void {
    this.stats.size = this.cache.size;
    this.stats.hitRate = this.stats.reads > 0 ? this.stats.hits / this.stats.reads : 0;
  }

  private calculateExpiry(customExpiry?: number): number {
    const baseExpiry = customExpiry || this.config.defaultExpiry;
    const now = Date.now();
    if (this.config.enableAvalancheProtection && baseExpiry > 1000) {
      const [min, max] = this.config.avalancheRandomExpiry;
      const randomExpiry = Math.random() * (max - min) + min;
      return now + baseExpiry + randomExpiry;
    }

    return now + baseExpiry;
  }

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

  private cleanupByMemoryUsage(): void {
    // If max memory not configured, return directly
    if (!this.config.maxMemoryUsage) {
      return;
    }
    const threshold = this.config.maxMemoryUsage * (this.config.memoryThreshold || 0.8);

    // If memory usage below threshold, return directly
    if (this.stats.memoryUsage <= threshold) {
      return;
    }

    // Target memory usage for cleanup (70% of threshold)
    const targetUsage = this.config.maxMemoryUsage * 0.7;
    while (this.stats.memoryUsage > targetUsage && this.cache.size > 0) {
      this.evictItem(true); // Force eviction for memory cleanup
    }
  }

  private getCacheItem(key: string): CacheItem | undefined {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }
    if (item.expiry < Date.now()) {
      this.delete(key);
      return undefined;
    }
    item.lastAccess = Date.now();

    // Update cache structure by strategy
    if (this.config.strategy === CacheStrategy.LRU) {
      this.moveToLRUHead(key);
    } else if (this.config.strategy === CacheStrategy.LFU) {
      this.updateLFU(key);
    }

    return item;
  }

  private setCacheItem(key: string, data: unknown, expiry?: number, dirty: boolean = false): void {
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
    this.cleanupByMemoryUsage();

    this.rebuildExpiryHeapIfNeeded();

    this.updateStats();
  }

  get<T = unknown>(key: string): T | undefined {
    this.stats.reads++;

    const item = this.getCacheItem(key);
    if (item) {
      this.stats.hits++;
      this.updateStats();
      return item.data as T;
    }

    this.stats.misses++;
    this.updateStats();
    return undefined;
  }

  set<T>(key: string, data: T, expiry?: number, dirty: boolean = false): void {
    this.setCacheItem(key, data, expiry, dirty);
  }

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
      this.rebuildExpiryHeapIfNeeded();
      this.updateStats();
    }
  }

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
    this.stats.memoryUsage = 0;
    this.updateStats();
  }

  markAsDirty(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      item.dirty = true;
    }
  }

  markAsClean(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      item.dirty = false;
    }
  }

  getDirtyData(): Map<string, unknown> {
    const dirtyData = new Map<string, unknown>();
    for (const [key, item] of this.cache.entries()) {
      if (item.dirty) {
        dirtyData.set(key, item.data);
      }
    }
    return dirtyData;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getSize(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.getCacheItem(key) !== undefined;
  }

  private async lock(key: string): Promise<() => void> {
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

  async getSafe<T>(key: string, fetchFn: () => Promise<T>, expiry?: number): Promise<T> {
    // Try to get from cache first
    let data = this.get<T>(key);
    if (data !== undefined) {
      return data;
    }

    // Lock to prevent cache stampede
    const unlock = await this.lock(key);
    try {
      // Re-check cache to prevent duplicate fetch
      data = this.get<T>(key);
      if (data !== undefined) {
        return data;
      }
      data = await fetchFn();
      this.set(key, data, expiry);

      return data;
    } finally {
      unlock();
    }
  }

  async setSafe<T>(key: string, data: T, expiry?: number, dirty: boolean = false): Promise<void> {
    const unlock = await this.lock(key);
    try {
      this.set(key, data, expiry, dirty);
    } finally {
      unlock();
    }
  }

  async getWithPenetrationProtection<T>(
    key: string,
    fetchFn: () => Promise<T>,
    defaultValue: T,
    expiry?: number
  ): Promise<T> {
    if (!this.config.enablePenetrationProtection) {
      return this.getSafe(key, fetchFn, expiry);
    }

    try {
      const data = await this.getSafe(key, fetchFn, expiry);
      if (data === null || data === undefined) {
        // Cache the fallback briefly to avoid repeated misses for the same key.
        this.set(key, defaultValue, expiry || 60000);
        return defaultValue;
      }
      return data;
    } catch {
      return defaultValue;
    }
  }

  static getDefaultMaxSize(): number {
    return configManager.getConfig().cache?.maxSize || CACHE.DEFAULT_MAX_SIZE;
  }

  static getDefaultExpiry(): number {
    return configManager.getConfig().cache?.defaultExpiry || CACHE.DEFAULT_EXPIRY;
  }

  static getDefaultMemoryThreshold(): number {
    return configManager.getConfig().cache?.memoryWarningThreshold || CACHE.MEMORY_THRESHOLD;
  }

  /**
   * @deprecated Cache compression is no longer supported; this compatibility accessor always returns false.
   */
  static getDefaultEnableCompression(): boolean {
    return false;
  }

  static getDefaultCleanupInterval(): number {
    return configManager.getConfig().cache?.cleanupInterval || CACHE.CLEANUP_INTERVAL;
  }
}
