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
    
    describe('Basic Functionality Tests', () => {
        it('should be able to set and get cache items', () => {
            // Test setting cache
            cacheManager.set('test-key', 'test-value');
            
            // Test getting cache
            const result = cacheManager.get('test-key');
            expect(result).toBe('test-value');
        });
        
        it('should be able to delete cache items', () => {
            // Set cache
            cacheManager.set('test-key', 'test-value');
            expect(cacheManager.get('test-key')).toBe('test-value');
            
            // Delete cache
            cacheManager.delete('test-key');
            expect(cacheManager.get('test-key')).toBeUndefined();
        });
        
        it('should be able to check if cache item exists', () => {
            // Set cache
            cacheManager.set('test-key', 'test-value');
            expect(cacheManager.has('test-key')).toBe(true);
            
            // Check non-existent cache
            expect(cacheManager.has('non-existent-key')).toBe(false);
        });
        
        it('should be able to clear cache', () => {
            // Set multiple cache items
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            cacheManager.set('key3', 'value3');
            
            // Clear cache
            cacheManager.clear();
            
            // Check if all cache items are cleared
            expect(cacheManager.get('key1')).toBeUndefined();
            expect(cacheManager.get('key2')).toBeUndefined();
            expect(cacheManager.get('key3')).toBeUndefined();
        });
    });
    
    describe('Cache Strategy Tests', () => {
        it('should evict cache items according to LRU strategy', () => {
            // Create LRU strategy cache manager, disable avalanche protection for testing
            const lruCache = new CacheManager({
                strategy: CacheStrategy.LRU,
                maxSize: 3,
                enableAvalancheProtection: false,
            });
            
            // Set cache items exceeding capacity
            lruCache.set('key1', 'value1');
            lruCache.set('key2', 'value2');
            lruCache.set('key3', 'value3');
            
            // Directly check cache size
            expect(lruCache.getSize()).toBe(3);
            
            // Set 4th cache item, should evict oldest key1
            lruCache.set('key4', 'value4');
            
            // Check results
            expect(lruCache.getSize()).toBe(3);
            expect(lruCache.get('key4')).toBe('value4');
        });
        
        it('should evict cache items according to LFU strategy', () => {
            // Create LFU strategy cache manager
            const lfuCache = new CacheManager({
                strategy: CacheStrategy.LFU,
                maxSize: 3,
            });
            
            // Set cache items
            lfuCache.set('key1', 'value1');
            lfuCache.set('key2', 'value2');
            lfuCache.set('key3', 'value3');
            
            // Access key1 and key3 multiple times
            lfuCache.get('key1');
            lfuCache.get('key1');
            lfuCache.get('key3');
            
            // Set 4th cache item, should evict least frequently used key2
            lfuCache.set('key4', 'value4');
            
            // Check results
            expect(lfuCache.get('key1')).toBe('value1');
            expect(lfuCache.get('key2')).toBeUndefined();
            expect(lfuCache.get('key3')).toBe('value3');
            expect(lfuCache.get('key4')).toBe('value4');
        });
    });
    
    describe('Cache Expiry Tests', () => {
        it('should automatically clear expired cache items', () => {
            // Create cache manager with short expiry time
            const cache = new CacheManager({
                defaultExpiry: 100, // 100ms expiry
            });
            
            // Set cache
            cache.set('test-key', 'test-value');
            expect(cache.get('test-key')).toBe('test-value');
            
            // Wait for cache to expire
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(cache.get('test-key')).toBeUndefined();
                    resolve();
                }, 150);
            });
        });
        
        it('should support custom expiry time', () => {
            // Set cache item with 100ms expiry
            cacheManager.set('short-expiry', 'short-value', 100);
            // Set cache item with 1s expiry
            cacheManager.set('long-expiry', 'long-value', 1000);
            
            // Wait for 150ms
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    // Short expiry cache should be expired
                    expect(cacheManager.get('short-expiry')).toBeUndefined();
                    // Long expiry cache should still be valid
                    expect(cacheManager.get('long-expiry')).toBe('long-value');
                    resolve();
                }, 150);
            });
        });
    });
    
    describe('Cache Statistics Tests', () => {
        it('should correctly record cache statistics', () => {
            // Initial statistics
            const initialStats = cacheManager.getStats();
            expect(initialStats.hits).toBe(0);
            expect(initialStats.misses).toBe(0);
            expect(initialStats.size).toBe(0);
            
            // Set cache
            cacheManager.set('test-key', 'test-value');
            
            // Get cache (hit)
            cacheManager.get('test-key');
            
            // Get non-existent cache (miss)
            cacheManager.get('non-existent-key');
            
            // Check statistics
            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.size).toBe(1);
            expect(stats.reads).toBe(2);
            expect(stats.writes).toBe(1);
        });
    });
    
    describe('Thread Safety Tests', () => {
        it('should support thread-safe getSafe method', async () => {
            // Mock async data fetching function
            const fetchFn = jest.fn().mockResolvedValue('fetched-value');
            
            // Multiple concurrent calls to getSafe
            const promises = [
                cacheManager.getSafe('async-key', fetchFn),
                cacheManager.getSafe('async-key', fetchFn),
                cacheManager.getSafe('async-key', fetchFn),
            ];
            
            // Wait for all promises to complete
            const results = await Promise.all(promises);
            
            // All calls should return the same result
            results.forEach(result => {
                expect(result).toBe('fetched-value');
            });
            
            // fetchFn should only be called once (cache breakdown protection)
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });
    
    describe('Cache Penetration Protection Tests', () => {
        it('should support cache penetration protection', async () => {
            // Mock fetch function that returns null
            const fetchFn = jest.fn().mockResolvedValue(null);
            
            // Get data with penetration protection
            const result = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');
            
            // Should return default value
            expect(result).toBe('default-value');
            
            // Call again, should get from cache without calling fetchFn
            const result2 = await cacheManager.getWithPenetrationProtection('null-key', fetchFn, 'default-value');
            expect(result2).toBe('default-value');
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });
    
    describe('Dirty Data Handling Tests', () => {
        it('should be able to mark and get dirty data', () => {
            // Set cache items
            cacheManager.set('clean-key', 'clean-value');
            cacheManager.set('dirty-key', 'dirty-value', undefined, true);
            
            // Mark clean-key as dirty
            cacheManager.markAsDirty('clean-key');
            
            // Get all dirty data
            const dirtyData = cacheManager.getDirtyData();
            
            // Check results
            expect(dirtyData.size).toBe(2);
            expect(dirtyData.get('clean-key')).toBe('clean-value');
            expect(dirtyData.get('dirty-key')).toBe('dirty-value');
            
            // Mark clean-key as clean
            cacheManager.markAsClean('clean-key');
            
            // Get dirty data again
            const dirtyData2 = cacheManager.getDirtyData();
            expect(dirtyData2.size).toBe(1);
            expect(dirtyData2.get('dirty-key')).toBe('dirty-value');
        });
    });
});
