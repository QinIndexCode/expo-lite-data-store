import { CacheManager, CacheStrategy } from '../CacheManager';

const tempCacheManagers: CacheManager[] = [];

type CacheManagerPrivateAccess = {
  cleanupExpired: () => void;
  expiryHeap: [number, string][];
};

const getCacheManagerPrivateAccess = (cache: CacheManager): CacheManagerPrivateAccess =>
  cache as unknown as CacheManagerPrivateAccess;

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 10,
      defaultExpiry: 1000,
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
    });
  });

  afterEach(() => {
    cacheManager.cleanup();
    tempCacheManagers.forEach(tempCache => tempCache.cleanup());
    tempCacheManagers.length = 0;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('basic operations', () => {
    it('stores and retrieves cache items', () => {
      cacheManager.set('test-key', 'test-value');

      const result = cacheManager.get('test-key');
      expect(result).toBe('test-value');
    });

    it('deletes cache items', () => {
      cacheManager.set('test-key', 'test-value');
      expect(cacheManager.get('test-key')).toBe('test-value');

      cacheManager.delete('test-key');
      expect(cacheManager.get('test-key')).toBeUndefined();
    });

    it('reports whether a cache item exists', () => {
      cacheManager.set('test-key', 'test-value');
      expect(cacheManager.has('test-key')).toBe(true);

      expect(cacheManager.has('non-existent-key')).toBe(false);
    });

    it('clears cache items', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');
      cacheManager.set('key3', 'value3');

      cacheManager.clear();

      expect(cacheManager.get('key1')).toBeUndefined();
      expect(cacheManager.get('key2')).toBeUndefined();
      expect(cacheManager.get('key3')).toBeUndefined();
    });
  });

  describe('cache strategies', () => {
    it('evicts least-recently-used cache items at capacity', () => {
      const lruCache = new CacheManager({
        strategy: CacheStrategy.LRU,
        maxSize: 3,
        enableAvalancheProtection: false,
      });
      tempCacheManagers.push(lruCache);

      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      expect(lruCache.getSize()).toBe(3);

      lruCache.set('key4', 'value4');

      expect(lruCache.getSize()).toBe(3);
      expect(lruCache.get('key4')).toBe('value4');
    });

    it('evicts least-frequently-used cache items at capacity', () => {
      const lfuCache = new CacheManager({
        strategy: CacheStrategy.LFU,
        maxSize: 3,
      });
      tempCacheManagers.push(lfuCache);

      lfuCache.set('key1', 'value1');
      lfuCache.set('key2', 'value2');
      lfuCache.set('key3', 'value3');

      lfuCache.get('key1');
      lfuCache.get('key1');
      lfuCache.get('key3');

      lfuCache.set('key4', 'value4');

      expect(lfuCache.get('key1')).toBe('value1');
      expect(lfuCache.get('key2')).toBeUndefined();
      expect(lfuCache.get('key3')).toBe('value3');
      expect(lfuCache.get('key4')).toBe('value4');
    });
  });

  describe('cache expiry', () => {
    it('evicts expired cache items', () => {
      jest.useFakeTimers();
      const cache = new CacheManager({
        defaultExpiry: 100,
      });
      tempCacheManagers.push(cache);

      cache.set('test-key', 'test-value');
      expect(cache.get('test-key')).toBe('test-value');

      jest.advanceTimersByTime(150);
      expect(cache.get('test-key')).toBeUndefined();
    });

    it('honors custom cache expiry times', () => {
      jest.useFakeTimers();
      cacheManager.set('short-expiry', 'short-value', 100);
      cacheManager.set('long-expiry', 'long-value', 1000);

      jest.advanceTimersByTime(150);
      expect(cacheManager.get('short-expiry')).toBeUndefined();
      expect(cacheManager.get('long-expiry')).toBe('long-value');
    });

    it('preserves refreshed keys when stale expiry entries are collected', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const cache = new CacheManager({
        defaultExpiry: 10,
        enableAvalancheProtection: false,
      });
      tempCacheManagers.push(cache);

      try {
        nowSpy.mockReturnValue(1000);
        cache.set('refreshed-key', 'old-value', 10);
        nowSpy.mockReturnValue(1005);
        cache.set('refreshed-key', 'new-value', 1000);
        nowSpy.mockReturnValue(1015);

        getCacheManagerPrivateAccess(cache).cleanupExpired();

        expect(cache.get('refreshed-key')).toBe('new-value');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('releases memory when an expired item is read', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const cache = new CacheManager({
        defaultExpiry: 10,
        enableAvalancheProtection: false,
      });
      tempCacheManagers.push(cache);

      try {
        nowSpy.mockReturnValue(1000);
        cache.set('expired-key', { value: 'data' });
        expect(cache.getStats().memoryUsage).toBeGreaterThan(0);

        nowSpy.mockReturnValue(1015);
        expect(cache.get('expired-key')).toBeUndefined();
        expect(cache.getStats()).toMatchObject({ size: 0, memoryUsage: 0 });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('compacts stale expiry entries for frequently refreshed keys', () => {
      const cache = new CacheManager({
        defaultExpiry: 60000,
        enableAvalancheProtection: false,
      });
      tempCacheManagers.push(cache);

      for (let index = 0; index < 200; index++) {
        cache.set('hot-key', index);
      }

      const expiryHeap = getCacheManagerPrivateAccess(cache).expiryHeap;
      expect(expiryHeap.length).toBeLessThanOrEqual(64);
      expect(cache.get('hot-key')).toBe(199);
    });
  });

  describe('cache statistics', () => {
    it('records cache statistics', () => {
      const initialStats = cacheManager.getStats();
      expect(initialStats.hits).toBe(0);
      expect(initialStats.misses).toBe(0);
      expect(initialStats.size).toBe(0);

      cacheManager.set('test-key', 'test-value');

      cacheManager.get('test-key');

      cacheManager.get('non-existent-key');

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
      expect(stats.reads).toBe(2);
      expect(stats.writes).toBe(1);
    });
  });

  describe('concurrent reads', () => {
    it('deduplicates concurrent getSafe reads', async () => {
      const fetchFn = jest.fn().mockResolvedValue('fetched-value');

      const promises = [
        cacheManager.getSafe('async-key', fetchFn),
        cacheManager.getSafe('async-key', fetchFn),
        cacheManager.getSafe('async-key', fetchFn),
      ];

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result).toBe('fetched-value');
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('preserves the per-key queue when cleanup stops the background timer', async () => {
      let resolveFetch!: (value: string) => void;
      let signalFetchStarted!: () => void;
      const fetchStarted = new Promise<void>(resolve => {
        signalFetchStarted = resolve;
      });
      const fetchFn = jest.fn(
        () =>
          new Promise<string>(resolve => {
            signalFetchStarted();
            resolveFetch = resolve;
          })
      );

      const first = cacheManager.getSafe('queued-key', fetchFn);
      const second = cacheManager.getSafe('queued-key', fetchFn);
      cacheManager.cleanup();
      const third = cacheManager.getSafe('queued-key', fetchFn);

      await fetchStarted;
      expect(fetchFn).toHaveBeenCalledTimes(1);

      resolveFetch('queued-value');
      await expect(Promise.all([first, second, third])).resolves.toEqual([
        'queued-value',
        'queued-value',
        'queued-value',
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache penetration protection', () => {
    it('caches fallback values for penetration protection', async () => {
      const fetchFn = jest.fn().mockResolvedValue(null);

      const result = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');

      expect(result).toBe('default-value');

      const result2 = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');
      expect(result2).toBe('default-value');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('dirty data', () => {
    it('marks and retrieves dirty data', () => {
      cacheManager.set('clean-key', 'clean-value');
      cacheManager.set('dirty-key', 'dirty-value', undefined, true);

      cacheManager.markAsDirty('clean-key');

      const dirtyData = cacheManager.getDirtyData();

      expect(dirtyData.size).toBe(2);
      expect(dirtyData.get('clean-key')).toBe('clean-value');
      expect(dirtyData.get('dirty-key')).toBe('dirty-value');

      cacheManager.markAsClean('clean-key');

      const dirtyData2 = cacheManager.getDirtyData();
      expect(dirtyData2.size).toBe(1);
      expect(dirtyData2.get('dirty-key')).toBe('dirty-value');
    });
  });
});
