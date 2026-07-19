import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { CacheService } from '../CacheService';

describe('CacheService', () => {
  let cacheService: CacheService;
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 100,
      defaultExpiry: 3600000,
    });
    cacheService = new CacheService(cacheManager);
  });

  afterEach(() => {
    cacheManager.clear();
    cacheManager.cleanup();
  });

  describe('basic cache operations', () => {
    it('sets and gets a cache value', () => {
      cacheService.set('testKey', 'testValue');
      const result = cacheService.get('testKey');
      expect(result).toBe('testValue');
    });

    it('reports whether a cache key exists', () => {
      cacheService.set('testKey', 'testValue');
      expect(cacheService.has('testKey')).toBe(true);
      expect(cacheService.has('nonExistentKey')).toBe(false);
    });

    it('deletes a cache value', () => {
      cacheService.set('testKey', 'testValue');
      cacheService.delete('testKey');
      expect(cacheService.get('testKey')).toBeUndefined();
    });

    it('clears all cache values', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      cacheService.clear();
      expect(cacheService.get('key1')).toBeUndefined();
      expect(cacheService.get('key2')).toBeUndefined();
    });
  });

  describe('dirty data', () => {
    it('marks a cache entry dirty', () => {
      cacheService.set('testKey', 'testValue');
      cacheService.markAsDirty('testKey');
      const dirtyData = cacheService.getDirtyData();
      expect(dirtyData.has('testKey')).toBe(true);
    });

    it('marks a cache entry clean', () => {
      cacheService.set('testKey', 'testValue', undefined, true);
      cacheService.markAsClean('testKey');
      const dirtyData = cacheService.getDirtyData();
      expect(dirtyData.has('testKey')).toBe(false);
    });

    it('returns all dirty cache entries', () => {
      cacheService.set('key1', 'value1', undefined, true);
      cacheService.set('key2', 'value2', undefined, true);
      cacheService.set('key3', 'value3');

      const dirtyData = cacheService.getDirtyData();
      expect(dirtyData.size).toBe(2);
      expect(dirtyData.has('key1')).toBe(true);
      expect(dirtyData.has('key2')).toBe(true);
      expect(dirtyData.has('key3')).toBe(false);
    });
  });

  describe('cache statistics', () => {
    it('reports cache size', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');

      const size = cacheService.getSize();
      expect(size).toBe(2);
    });

    it('reports cache statistics', () => {
      cacheService.set('key1', 'value1');
      cacheService.get('key1');

      const stats = cacheService.getStats();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('size');
    });
  });

  describe('safe cache operations', () => {
    it('gets and sets values through safe operations', async () => {
      const fetchFn = jest.fn().mockResolvedValue('fetchedValue');
      const result = await cacheService.getSafe('testKey', fetchFn);
      expect(result).toBe('fetchedValue');
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const result2 = await cacheService.getSafe('testKey', fetchFn);
      expect(result2).toBe('fetchedValue');
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await cacheService.setSafe('safeKey', 'safeValue');
      const safeResult = cacheService.get('safeKey');
      expect(safeResult).toBe('safeValue');
    });
  });

  describe('cache penetration protection', () => {
    it('caches the fallback for a missing value', async () => {
      const fetchFn = jest.fn().mockResolvedValue(null);
      const defaultValue = 'default';

      const result1 = await cacheService.getWithPenetrationProtection('testKey', fetchFn, defaultValue);
      expect(result1).toBe(defaultValue);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const result2 = await cacheService.getWithPenetrationProtection('testKey', fetchFn, defaultValue);
      expect(result2).toBe(defaultValue);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('table cache generations', () => {
    it('invalidates one table without clearing unrelated cache entries', () => {
      const tableName = 'testTable';
      const unrelatedKey = 'unrelated:key';
      const firstVersion = cacheManager.getNamespaceVersion(tableName);
      const firstCacheKey = `${tableName}_${firstVersion}_{}`;

      cacheService.set(firstCacheKey, [{ id: 1, name: 'Alice' }]);
      cacheService.set(unrelatedKey, 'unrelatedValue');

      cacheService.clearTableCache(tableName);

      const secondVersion = cacheManager.getNamespaceVersion(tableName);
      expect(secondVersion).not.toBe(firstVersion);
      expect(cacheService.get(`${tableName}_${secondVersion}_{}`)).toBeUndefined();
      expect(cacheService.get(unrelatedKey)).toBe('unrelatedValue');
    });

    it('keeps repeated table invalidations within the cache entry budget', () => {
      const tableName = 'boundedTable';

      for (let index = 0; index < 250; index++) {
        const version = cacheManager.getNamespaceVersion(tableName);
        cacheService.set(`${tableName}_${version}_${index}`, index);
        cacheService.clearTableCache(tableName);
      }

      expect(cacheManager.getSize()).toBeLessThanOrEqual(100);
      expect(cacheService.get(`${tableName}_cache_keys`)).toBeUndefined();
    });
  });
});
