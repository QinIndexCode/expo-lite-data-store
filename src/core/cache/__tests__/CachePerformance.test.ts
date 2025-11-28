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
    
    it('应该能够快速处理大量缓存项', () => {
        const startTime = Date.now();
        const itemCount = 10000;
        
        // 设置大量缓存项
        for (let i = 0; i < itemCount; i++) {
            cacheManager.set(`key-${i}`, `value-${i}`);
        }
        
        const setTime = Date.now() - startTime;
        console.log(`设置 ${itemCount} 个缓存项耗时: ${setTime}ms`);
        expect(setTime).toBeLessThan(1000); // 1秒内完成
        
        // 获取大量缓存项
        const getStartTime = Date.now();
        for (let i = 0; i < itemCount; i++) {
            cacheManager.get(`key-${i}`);
        }
        
        const getTime = Date.now() - getStartTime;
        console.log(`获取 ${itemCount} 个缓存项耗时: ${getTime}ms`);
        expect(getTime).toBeLessThan(500); // 500ms内完成
        
        // 检查缓存大小
        expect(cacheManager.getSize()).toBe(itemCount);
    });
    
    it('应该能够高效处理缓存淘汰', () => {
        const startTime = Date.now();
        const itemCount = 20000; // 超过最大容量
        
        // 设置超过容量的缓存项，触发淘汰
        for (let i = 0; i < itemCount; i++) {
            cacheManager.set(`key-${i}`, `value-${i}`);
        }
        
        const setTime = Date.now() - startTime;
        console.log(`设置 ${itemCount} 个缓存项（含淘汰）耗时: ${setTime}ms`);
        expect(setTime).toBeLessThan(5000); // 5秒内完成
        
        // 检查缓存大小
        expect(cacheManager.getSize()).toBe(10000); // 最大容量
    });
    
    it('应该能够高效处理并发访问', async () => {
        const startTime = Date.now();
        const concurrentCount = 1000;
        const iterations = 10;
        
        // 并发访问缓存
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
        console.log(`并发访问性能: ${operationsPerSecond.toFixed(0)} 操作/秒`);
        expect(operationsPerSecond).toBeGreaterThan(1000); // 至少1000操作/秒
    });
    
    it('应该能够高效处理不同缓存策略', () => {
        // 测试LRU策略性能
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
        console.log(`LRU策略设置10000个缓存项耗时: ${lruTime}ms`);
        
        // 测试LFU策略性能
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
        console.log(`LFU策略设置10000个缓存项耗时: ${lfuTime}ms`);
        
        // 两种策略都应该在合理时间内完成
        expect(lruTime).toBeLessThan(1500);
        expect(lfuTime).toBeLessThan(1500);
    });
});