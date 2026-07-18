import { CacheManager, CacheStrategy } from '../CacheManager';

describe('CacheManager large-input behavior', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 10000,
      defaultExpiry: 3600000,
      enablePenetrationProtection: false,
      enableBreakdownProtection: false,
      enableAvalancheProtection: false,
    });
  });

  afterEach(() => {
    cacheManager.cleanup();
  });

  it('stores and retrieves a large number of cache items', () => {
    const itemCount = 10000;

    for (let i = 0; i < itemCount; i++) {
      cacheManager.set(`key-${i}`, `value-${i}`);
    }

    for (let i = 0; i < itemCount; i++) {
      expect(cacheManager.get(`key-${i}`)).toBe(`value-${i}`);
    }

    expect(cacheManager.getSize()).toBe(itemCount);
  });

  it('evicts old entries when capacity is exceeded', () => {
    const itemCount = 20000;

    for (let i = 0; i < itemCount; i++) {
      cacheManager.set(`key-${i}`, `value-${i}`);
    }

    expect(cacheManager.getSize()).toBe(10000);
    expect(cacheManager.get('key-0')).toBeUndefined();
    expect(cacheManager.get('key-19999')).toBe('value-19999');
  });

  it('keeps concurrent caller writes addressable', async () => {
    const concurrentCount = 1000;
    const iterations = 10;

    const promises: Promise<void>[] = [];
    for (let i = 0; i < concurrentCount; i++) {
      promises.push(
        (async () => {
          for (let j = 0; j < iterations; j++) {
            const key = `concurrent-key-${i}-${j}`;
            cacheManager.set(key, `concurrent-value-${i}-${j}`);
            cacheManager.get(key);
          }
        })()
      );
    }

    await Promise.all(promises);

    expect(cacheManager.getSize()).toBe(concurrentCount * iterations);
    expect(cacheManager.get('concurrent-key-999-9')).toBe('concurrent-value-999-9');
  });

  it('enforces capacity with each cache strategy', () => {
    const lruCache = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 5000,
      enableAvalancheProtection: false,
    });

    const lfuCache = new CacheManager({
      strategy: CacheStrategy.LFU,
      maxSize: 5000,
      enableAvalancheProtection: false,
    });

    try {
      for (let i = 0; i < 10000; i++) {
        lruCache.set(`lru-key-${i}`, `lru-value-${i}`);
        lfuCache.set(`lfu-key-${i}`, `lfu-value-${i}`);
      }

      expect(lruCache.getSize()).toBe(5000);
      expect(lfuCache.getSize()).toBe(5000);
    } finally {
      lruCache.cleanup();
      lfuCache.cleanup();
    }
  });
});
