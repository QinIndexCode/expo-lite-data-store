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

  private namespaceVersions = new Map<string, number>();

  private namespaceVersionCounter = 0;

  private allocateNamespaceVersion(namespace: string): number {
    if (this.namespaceVersionCounter >= Number.MAX_SAFE_INTEGER) {
      this.clear();
      this.namespaceVersionCounter = 0;
    }

    if (this.namespaceVersions.has(namespace)) {
      this.namespaceVersions.delete(namespace);
    } else if (this.namespaceVersions.size >= this.config.maxSize) {
      const oldestNamespace = this.namespaceVersions.keys().next();
      if (!oldestNamespace.done) {
        this.namespaceVersions.delete(oldestNamespace.value);
      }
    }

    const version = ++this.namespaceVersionCounter;
    this.namespaceVersions.set(namespace, version);
    return version;
  }

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

    this.startCleanupTimer();
  }

  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
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
        if (oldFreq === this.lfuMinFreq) {
          this.lfuMinFreq++;
        }
      }
    }

    item.accessCount++;
    const newFreq = item.accessCount;
    if (!this.lfuFreqMap.has(newFreq)) {
      this.lfuFreqMap.set(newFreq, new Set());
    }
    this.lfuFreqMap.get(newFreq)?.add(key);
  }

  private removeLFUItem(): string | undefined {
    const minFreqSet = this.lfuFreqMap.get(this.lfuMinFreq);
    if (!minFreqSet || minFreqSet.size === 0) return undefined;
    const keyResult = minFreqSet.values().next();
    if (keyResult.done) return undefined;

    const key = keyResult.value;
    if (key) {
      minFreqSet.delete(key);

      if (minFreqSet.size === 0) {
        this.lfuFreqMap.delete(this.lfuMinFreq);
      }
    }

    return key;
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
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

      if (!item) continue;
      // A key can be refreshed before an older heap entry expires. Only the
      // heap entry matching the current item expiry is allowed to evict it.
      if (item.expiry !== top[0]) continue;

      const itemSize = this.getCacheItemSize(item);
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

    // JSON length times two is a bounded approximation of UTF-16 storage.
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

  private getCacheItemSize(item: CacheItem): number {
    return item.compressed ? this.calculateDataSize(item.data) : item.originalSize;
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
    if (!force && this.cache.size <= this.config.maxSize) {
      return;
    }

    if (this.cache.size === 0) {
      return;
    }

    let evictKey: string | undefined;

    switch (this.config.strategy) {
      case CacheStrategy.LRU:
        if (this.lruTail && this.lruTail.key) {
          evictKey = this.lruTail.key;
          this.removeFromLRU(evictKey);
        }
        break;
      case CacheStrategy.LFU:
        evictKey = this.removeLFUItem();
        break;
    }

    if (evictKey) {
      const item = this.cache.get(evictKey);
      if (item) {
        const itemSize = this.getCacheItemSize(item);
        this.stats.memoryUsage -= itemSize;
      }
      this.cache.delete(evictKey);
      this.stats.evictions++;
      this.updateStats();
    }
  }

  private cleanupByMemoryUsage(): void {
    if (!this.config.maxMemoryUsage) {
      return;
    }
    const threshold = this.config.maxMemoryUsage * (this.config.memoryThreshold || 0.8);

    if (this.stats.memoryUsage <= threshold) {
      return;
    }

    // Evict below the trigger point to avoid cleanup thrashing near the threshold.
    const targetUsage = this.config.maxMemoryUsage * 0.7;
    while (this.stats.memoryUsage > targetUsage && this.cache.size > 0) {
      this.evictItem(true);
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

    this.heapPush(cacheItem.expiry, key);
    this.stats.memoryUsage += finalDataSize;

    if (this.config.strategy === CacheStrategy.LRU) {
      this.addToLRUHead(key, cacheItem);
    } else if (this.config.strategy === CacheStrategy.LFU) {
      if (!this.lfuFreqMap.has(1)) {
        this.lfuFreqMap.set(1, new Set());
      }
      this.lfuFreqMap.get(1)?.add(key);
      this.lfuMinFreq = 1;
    }

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
      const item = this.cache.get(key);
      if (item) {
        const itemSize = this.getCacheItemSize(item);
        this.stats.memoryUsage -= itemSize;
      }

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
    this.namespaceVersions.clear();
    this.lruHead = null;
    this.lruTail = null;
    this.lruNodeMap.clear();
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

  /** Returns the current generation for a bounded cache namespace. */
  getNamespaceVersion(namespace: string): number {
    return this.namespaceVersions.get(namespace) ?? this.allocateNamespaceVersion(namespace);
  }

  /** Makes every existing key in a namespace unreachable without scanning the cache. */
  invalidateNamespace(namespace: string): number {
    // Remove the legacy tracking entry once; new reads never recreate it.
    this.delete(`${namespace}_cache_keys`);
    return this.allocateNamespaceVersion(namespace);
  }

  has(key: string): boolean {
    return this.getCacheItem(key) !== undefined;
  }

  private async lock(key: string): Promise<() => void> {
    const previousTail = this.mutex.get(key) ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseGate = resolve;
    });
    const currentTail = previousTail.then(() => gate);

    this.mutex.set(key, currentTail);
    await previousTail;

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseGate();
      if (this.mutex.get(key) === currentTail) {
        this.mutex.delete(key);
      }
    };
  }

  async getSafe<T>(key: string, fetchFn: () => Promise<T>, expiry?: number): Promise<T> {
    let data = this.get<T>(key);
    if (data !== undefined) {
      return data;
    }

    const unlock = await this.lock(key);
    try {
      // Recheck under the lock so concurrent callers do not duplicate the fetch.
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
