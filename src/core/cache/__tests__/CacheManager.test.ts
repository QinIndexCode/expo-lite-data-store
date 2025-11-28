// src/core/cache/__tests__/CacheManager.test.ts
// CacheManager 单元测试

import { CacheManager, CacheStrategy } from '../CacheManager';

describe('CacheManager', () => {
    let cacheManager: CacheManager;
    
    beforeEach(() => {
        // 创建新的CacheManager实例用于每个测试
        cacheManager = new CacheManager({
            strategy: CacheStrategy.LRU,
            maxSize: 10,
            defaultExpiry: 1000,
            enablePenetrationProtection: true,
            enableBreakdownProtection: true,
            enableAvalancheProtection: true,
        });
    });
    
    describe('基本功能测试', () => {
        it('应该能够设置和获取缓存项', () => {
            // 测试设置缓存
            cacheManager.set('test-key', 'test-value');
            
            // 测试获取缓存
            const result = cacheManager.get('test-key');
            expect(result).toBe('test-value');
        });
        
        it('应该能够删除缓存项', () => {
            // 设置缓存
            cacheManager.set('test-key', 'test-value');
            expect(cacheManager.get('test-key')).toBe('test-value');
            
            // 删除缓存
            cacheManager.delete('test-key');
            expect(cacheManager.get('test-key')).toBeUndefined();
        });
        
        it('应该能够检查缓存项是否存在', () => {
            // 设置缓存
            cacheManager.set('test-key', 'test-value');
            expect(cacheManager.has('test-key')).toBe(true);
            
            // 检查不存在的缓存
            expect(cacheManager.has('non-existent-key')).toBe(false);
        });
        
        it('应该能够清空缓存', () => {
            // 设置多个缓存项
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            cacheManager.set('key3', 'value3');
            
            // 清空缓存
            cacheManager.clear();
            
            // 检查所有缓存项是否被清空
            expect(cacheManager.get('key1')).toBeUndefined();
            expect(cacheManager.get('key2')).toBeUndefined();
            expect(cacheManager.get('key3')).toBeUndefined();
        });
    });
    
    describe('缓存策略测试', () => {
        it('应该根据LRU策略淘汰缓存项', () => {
            // 创建LRU策略的缓存管理器，禁用雪崩防护以便测试
            const lruCache = new CacheManager({
                strategy: CacheStrategy.LRU,
                maxSize: 3,
                enableAvalancheProtection: false,
            });
            
            // 设置超过容量的缓存项
            lruCache.set('key1', 'value1');
            lruCache.set('key2', 'value2');
            lruCache.set('key3', 'value3');
            
            // 直接检查缓存大小
            expect(lruCache.getSize()).toBe(3);
            
            // 设置第4个缓存项，应该淘汰最早的key1
            lruCache.set('key4', 'value4');
            
            // 检查结果
            expect(lruCache.getSize()).toBe(3);
            expect(lruCache.get('key4')).toBe('value4');
        });
        
        it('应该根据LFU策略淘汰缓存项', () => {
            // 创建LFU策略的缓存管理器
            const lfuCache = new CacheManager({
                strategy: CacheStrategy.LFU,
                maxSize: 3,
            });
            
            // 设置缓存项
            lfuCache.set('key1', 'value1');
            lfuCache.set('key2', 'value2');
            lfuCache.set('key3', 'value3');
            
            // 多次访问key1和key3
            lfuCache.get('key1');
            lfuCache.get('key1');
            lfuCache.get('key3');
            
            // 设置第4个缓存项，应该淘汰访问次数最少的key2
            lfuCache.set('key4', 'value4');
            
            // 检查结果
            expect(lfuCache.get('key1')).toBe('value1');
            expect(lfuCache.get('key2')).toBeUndefined();
            expect(lfuCache.get('key3')).toBe('value3');
            expect(lfuCache.get('key4')).toBe('value4');
        });
    });
    
    describe('缓存过期测试', () => {
        it('应该自动清除过期的缓存项', () => {
            // 创建短过期时间的缓存管理器
            const cache = new CacheManager({
                defaultExpiry: 100, // 100毫秒过期
            });
            
            // 设置缓存
            cache.set('test-key', 'test-value');
            expect(cache.get('test-key')).toBe('test-value');
            
            // 等待缓存过期
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(cache.get('test-key')).toBeUndefined();
                    resolve();
                }, 150);
            });
        });
        
        it('应该支持自定义过期时间', () => {
            // 设置100毫秒过期的缓存项
            cacheManager.set('short-expiry', 'short-value', 100);
            // 设置1秒过期的缓存项
            cacheManager.set('long-expiry', 'long-value', 1000);
            
            // 等待150毫秒
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    // 短过期时间的缓存应该已过期
                    expect(cacheManager.get('short-expiry')).toBeUndefined();
                    // 长过期时间的缓存应该仍然有效
                    expect(cacheManager.get('long-expiry')).toBe('long-value');
                    resolve();
                }, 150);
            });
        });
    });
    
    describe('缓存统计测试', () => {
        it('应该正确记录缓存统计信息', () => {
            // 初始统计信息
            const initialStats = cacheManager.getStats();
            expect(initialStats.hits).toBe(0);
            expect(initialStats.misses).toBe(0);
            expect(initialStats.size).toBe(0);
            
            // 设置缓存
            cacheManager.set('test-key', 'test-value');
            
            // 获取缓存（命中）
            cacheManager.get('test-key');
            
            // 获取不存在的缓存（未命中）
            cacheManager.get('non-existent-key');
            
            // 检查统计信息
            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.size).toBe(1);
            expect(stats.reads).toBe(2);
            expect(stats.writes).toBe(1);
        });
    });
    
    describe('线程安全测试', () => {
        it('应该支持线程安全的getSafe方法', async () => {
            // 模拟异步获取数据的函数
            const fetchFn = jest.fn().mockResolvedValue('fetched-value');
            
            // 多次并发调用getSafe
            const promises = [
                cacheManager.getSafe('async-key', fetchFn),
                cacheManager.getSafe('async-key', fetchFn),
                cacheManager.getSafe('async-key', fetchFn),
            ];
            
            // 等待所有promise完成
            const results = await Promise.all(promises);
            
            // 所有调用应该返回相同的结果
            results.forEach(result => {
                expect(result).toBe('fetched-value');
            });
            
            // fetchFn应该只被调用一次（缓存击穿防护）
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });
    
    describe('缓存穿透防护测试', () => {
        it('应该支持缓存穿透防护', async () => {
            // 模拟返回null的获取函数
            const fetchFn = jest.fn().mockResolvedValue(null);
            
            // 使用缓存穿透防护获取数据
            const result = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');
            
            // 应该返回默认值
            expect(result).toBe('default-value');
            
            // 再次调用，应该从缓存获取，不再调用fetchFn
            const result2 = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');
            expect(result2).toBe('default-value');
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });
    
    describe('脏数据处理测试', () => {
        it('应该能够标记和获取脏数据', () => {
            // 设置缓存项
            cacheManager.set('clean-key', 'clean-value');
            cacheManager.set('dirty-key', 'dirty-value', undefined, true);
            
            // 标记clean-key为脏数据
            cacheManager.markAsDirty('clean-key');
            
            // 获取所有脏数据
            const dirtyData = cacheManager.getDirtyData();
            
            // 检查结果
            expect(dirtyData.size).toBe(2);
            expect(dirtyData.get('clean-key')).toBe('clean-value');
            expect(dirtyData.get('dirty-key')).toBe('dirty-value');
            
            // 标记clean-key为干净数据
            cacheManager.markAsClean('clean-key');
            
            // 再次获取脏数据
            const dirtyData2 = cacheManager.getDirtyData();
            expect(dirtyData2.size).toBe(1);
            expect(dirtyData2.get('dirty-key')).toBe('dirty-value');
        });
    });
});
