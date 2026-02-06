// src/core/cache/__tests__/CachePerformance.test.ts
// CacheManager 性能测试

import { CacheManager, CacheStrategy } from '../CacheManager';

describe('CacheManager Performance', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    // 创建新的CacheManager实例用于每个测试
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 10000,
      defaultExpiry: 3600000,
      enablePenetrationProtection: false,
      enableBreakdownProtection: false,
      enableAvalancheProtection: false,
    });
  });

  afterEach(done => {
    // 清理定时器，防止测试挂起
    if (cacheManager) {
      cacheManager.cleanup();
    }
    // 使用 process.nextTick 而不是 setTimeout，避免阻塞
    process.nextTick(() => {
      done();
    });
  });

  it('should be able to quickly handle large number of cache items', () => {
    const startTime = Date.now();
    const itemCount = 10000;

    // Set large number of cache items
    for (let i = 0; i < itemCount; i++) {
      cacheManager.set(`key-${i}`, `value-${i}`);
    }

    const setTime = Date.now() - startTime;
    expect(setTime).toBeLessThan(1000); // Complete within 1 second

    // Get large number of cache items
    const getStartTime = Date.now();
    for (let i = 0; i < itemCount; i++) {
      cacheManager.get(`key-${i}`);
    }

    const getTime = Date.now() - getStartTime;
    expect(getTime).toBeLessThan(500); // Complete within 500ms

    // Check cache size
    expect(cacheManager.getSize()).toBe(itemCount);
  });

  it('should be able to efficiently handle cache eviction', () => {
    const startTime = Date.now();
    const itemCount = 20000; // Exceed maximum capacity

    // Set cache items exceeding capacity, triggering eviction
    for (let i = 0; i < itemCount; i++) {
      cacheManager.set(`key-${i}`, `value-${i}`);
    }

    const setTime = Date.now() - startTime;
    expect(setTime).toBeLessThan(5000); // Complete within 5 seconds

    // Check cache size
    expect(cacheManager.getSize()).toBe(10000); // Maximum capacity
  });

  it('should be able to efficiently handle concurrent access', async () => {
    const startTime = Date.now();
    const concurrentCount = 1000;
    const iterations = 10;

    // Concurrent access to cache
    const promises = [];
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

    const totalTime = Date.now() - startTime;
    const operationsPerSecond = (concurrentCount * iterations * 2) / (totalTime / 1000);
    expect(operationsPerSecond).toBeGreaterThan(1000); // At least 1000 operations/second
  });

  it('should be able to efficiently handle different cache strategies', () => {
    // Test LRU strategy performance
    const lruCache = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 5000,
      enableAvalancheProtection: false,
    });

    const lruStartTime = Date.now();
    for (let i = 0; i < 10000; i++) {
      lruCache.set(`lru-key-${i}`, `lru-value-${i}`);
    }
    const lruTime = Date.now() - lruStartTime;

    // Test LFU strategy performance
    const lfuCache = new CacheManager({
      strategy: CacheStrategy.LFU,
      maxSize: 5000,
      enableAvalancheProtection: false,
    });

    const lfuStartTime = Date.now();
    for (let i = 0; i < 10000; i++) {
      lfuCache.set(`lfu-key-${i}`, `lfu-value-${i}`);
    }
    const lfuTime = Date.now() - lfuStartTime;

    // Both strategies should complete within reasonable time
    expect(lruTime).toBeLessThan(1500);
    expect(lfuTime).toBeLessThan(1500);

    // 清理临时创建的 CacheManager 实例
    lruCache.cleanup();
    lfuCache.cleanup();
  });
});
