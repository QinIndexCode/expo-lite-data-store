// src/core/service/__tests__/CacheService.test.ts
import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { CacheService } from '../CacheService';

describe('CacheService', () => {
    let cacheService: CacheService;
    let cacheManager: CacheManager;

    beforeEach(() => {
        cacheManager = new CacheManager({
            strategy: CacheStrategy.LRU,
            maxSize: 100,
            defaultExpiry: 3600000
        });
        cacheService = new CacheService(cacheManager);
    });

    afterEach(() => {
        cacheManager.clear();
        // 使用公共cleanup方法清理定时器和资源
        cacheManager['cleanup']();
    });

    describe('基本缓存操作', () => {
        it('应该能够设置和获取缓存', () => {
            cacheService.set('testKey', 'testValue');
            const result = cacheService.get('testKey');
            expect(result).toBe('testValue');
        });

        it('应该能够检查缓存键是否存在', () => {
            cacheService.set('testKey', 'testValue');
            expect(cacheService.has('testKey')).toBe(true);
            expect(cacheService.has('nonExistentKey')).toBe(false);
        });

        it('应该能够删除缓存', () => {
            cacheService.set('testKey', 'testValue');
            cacheService.delete('testKey');
            expect(cacheService.get('testKey')).toBeUndefined();
        });

        it('应该能够清空所有缓存', () => {
            cacheService.set('key1', 'value1');
            cacheService.set('key2', 'value2');
            cacheService.clear();
            expect(cacheService.get('key1')).toBeUndefined();
            expect(cacheService.get('key2')).toBeUndefined();
        });
    });

    describe('脏数据管理', () => {
        it('应该能够标记缓存项为脏数据', () => {
            cacheService.set('testKey', 'testValue');
            cacheService.markAsDirty('testKey');
            const dirtyData = cacheService.getDirtyData();
            expect(dirtyData.has('testKey')).toBe(true);
        });

        it('应该能够标记缓存项为干净数据', () => {
            cacheService.set('testKey', 'testValue', undefined, true); // 设置为脏数据
            cacheService.markAsClean('testKey');
            const dirtyData = cacheService.getDirtyData();
            expect(dirtyData.has('testKey')).toBe(false);
        });

        it('应该能够获取所有脏数据', () => {
            cacheService.set('key1', 'value1', undefined, true);
            cacheService.set('key2', 'value2', undefined, true);
            cacheService.set('key3', 'value3'); // 干净数据
            
            const dirtyData = cacheService.getDirtyData();
            expect(dirtyData.size).toBe(2);
            expect(dirtyData.has('key1')).toBe(true);
            expect(dirtyData.has('key2')).toBe(true);
            expect(dirtyData.has('key3')).toBe(false);
        });
    });

    describe('缓存统计信息', () => {
        it('应该能够获取缓存大小', () => {
            cacheService.set('key1', 'value1');
            cacheService.set('key2', 'value2');
            
            const size = cacheService.getSize();
            expect(size).toBe(2);
        });

        it('应该能够获取缓存统计信息', () => {
            cacheService.set('key1', 'value1');
            cacheService.get('key1');
            
            const stats = cacheService.getStats();
            expect(stats).toHaveProperty('hits');
            expect(stats).toHaveProperty('misses');
            expect(stats).toHaveProperty('size');
        });
    });

    describe('线程安全操作', () => {
        it('应该能够安全地获取和设置缓存', async () => {
            // 测试getSafe
            const fetchFn = jest.fn().mockResolvedValue('fetchedValue');
            const result = await cacheService.getSafe('testKey', fetchFn);
            expect(result).toBe('fetchedValue');
            expect(fetchFn).toHaveBeenCalledTimes(1);
            
            // 第二次调用应该从缓存获取，不再调用fetchFn
            const result2 = await cacheService.getSafe('testKey', fetchFn);
            expect(result2).toBe('fetchedValue');
            expect(fetchFn).toHaveBeenCalledTimes(1);
            
            // 测试setSafe
            await cacheService.setSafe('safeKey', 'safeValue');
            const safeResult = cacheService.get('safeKey');
            expect(safeResult).toBe('safeValue');
        });
    });

    describe('缓存穿透防护', () => {
        it('应该能够防止缓存穿透', async () => {
            const fetchFn = jest.fn().mockResolvedValue(null);
            const defaultValue = 'default';
            
            // 第一次调用，fetchFn返回null，应该返回默认值
            const result1 = await cacheService.getWithPenetrationProtection('testKey', fetchFn, defaultValue);
            expect(result1).toBe(defaultValue);
            expect(fetchFn).toHaveBeenCalledTimes(1);
            
            // 第二次调用，应该从缓存获取默认值，不再调用fetchFn
            const result2 = await cacheService.getWithPenetrationProtection('testKey', fetchFn, defaultValue);
            expect(result2).toBe(defaultValue);
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('表相关缓存管理', () => {
        it('应该能够记录与表相关的缓存键', () => {
            const tableName = 'testTable';
            const cacheKey1 = 'table:testTable:data';
            const cacheKey2 = 'table:testTable:count';
            
            cacheService.recordTableCacheKey(tableName, cacheKey1);
            cacheService.recordTableCacheKey(tableName, cacheKey2);
            
            // 设置缓存值
            cacheService.set(cacheKey1, [{ id: 1, name: 'Alice' }]);
            cacheService.set(cacheKey2, 1);
            
            expect(cacheService.get(cacheKey1)).toBeDefined();
            expect(cacheService.get(cacheKey2)).toBeDefined();
        });

        it('应该能够清除与特定表相关的所有缓存', () => {
            const tableName = 'testTable';
            const cacheKey1 = 'table:testTable:data';
            const cacheKey2 = 'table:testTable:count';
            const unrelatedKey = 'unrelated:key';
            
            // 记录表相关缓存键
            cacheService.recordTableCacheKey(tableName, cacheKey1);
            cacheService.recordTableCacheKey(tableName, cacheKey2);
            
            // 设置缓存值
            cacheService.set(cacheKey1, [{ id: 1, name: 'Alice' }]);
            cacheService.set(cacheKey2, 1);
            cacheService.set(unrelatedKey, 'unrelatedValue');
            
            // 清除表相关缓存
            cacheService.clearTableCache(tableName);
            
            // 表相关缓存应该被清除
            expect(cacheService.get(cacheKey1)).toBeUndefined();
            expect(cacheService.get(cacheKey2)).toBeUndefined();
            
            // 不相关缓存应该保留
            expect(cacheService.get(unrelatedKey)).toBe('unrelatedValue');
        });
    });
});
