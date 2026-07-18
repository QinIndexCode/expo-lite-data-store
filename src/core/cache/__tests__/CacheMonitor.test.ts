import { CacheMonitor } from '../../monitor/CacheMonitor';
import { CacheManager, CacheStrategy } from '../CacheManager';

describe('CacheMonitor', () => {
  let cacheManager: CacheManager;
  let cacheMonitor: CacheMonitor;

  beforeEach(() => {
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 100,
      defaultExpiry: 3600000,
      maxMemoryUsage: 10 * 1024 * 1024,
      memoryThreshold: 0.8,
    });
    cacheMonitor = new CacheMonitor(cacheManager);
  });

  afterEach(() => {
    cacheMonitor.stopMonitoring();
    cacheMonitor.clearHistory();
    cacheMonitor.setEnabled(false);
    cacheManager.cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('monitoring', () => {
    it('records cache statistics', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');
      cacheManager.get('key1');

      cacheMonitor.recordStats();
      const stats = cacheMonitor.getCurrentStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('returns statistics history', () => {
      cacheMonitor.recordStats();
      cacheManager.set('key1', 'value1');
      cacheMonitor.recordStats();

      const history = cacheMonitor.getHistory();
      expect(history.length).toBe(2);
    });

    it('calculates the average cache hit rate', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.get('key1');
      cacheManager.get('key1');
      cacheManager.get('key2');

      cacheMonitor.recordStats();
      const avgHitRate = cacheMonitor.getAverageHitRate();

      expect(avgHitRate).toBeGreaterThan(0);
    });
  });

  describe('health checks', () => {
    it('reports a healthy cache state', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.get('key1');
      cacheManager.get('key1');

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      expect(health.healthy).toBe(true);
      expect(health.issues.length).toBe(0);
    });

    it('flags a low cache hit rate', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.get('key1');
      for (let index = 0; index < 9; index++) {
        cacheManager.get(`missing-${index}`);
      }

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      expect(health.healthy).toBe(false);
      expect(health.issues).toContainEqual(expect.stringContaining('命中率'));
    });

    it('flags high reported memory usage', () => {
      const baseStats = cacheManager.getStats();
      jest.spyOn(cacheManager, 'getStats').mockReturnValue({
        ...baseStats,
        memoryUsage: 9_500,
        maxMemoryUsage: 10_000,
      });

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      expect(health.healthy).toBe(false);
      expect(health.issues).toContainEqual(expect.stringContaining('内存使用率'));
    });
  });

  describe('monitoring controls', () => {
    it('records while monitoring and stops recording after stop', () => {
      jest.useFakeTimers();
      cacheMonitor.startMonitoring(100);
      expect(cacheMonitor.isEnabled()).toBe(true);
      expect(cacheMonitor.getHistory()).toHaveLength(1);

      jest.advanceTimersByTime(100);
      expect(cacheMonitor.getHistory()).toHaveLength(2);

      cacheMonitor.stopMonitoring();
      jest.advanceTimersByTime(100);
      expect(cacheMonitor.isEnabled()).toBe(true);
      expect(cacheMonitor.getHistory()).toHaveLength(2);
    });

    it('enables and disables monitoring', () => {
      cacheMonitor.setEnabled(false);
      expect(cacheMonitor.isEnabled()).toBe(false);

      cacheMonitor.setEnabled(true);
      expect(cacheMonitor.isEnabled()).toBe(true);
    });

    it('clears monitoring history', () => {
      cacheMonitor.recordStats();
      cacheMonitor.recordStats();
      expect(cacheMonitor.getHistory().length).toBe(2);

      cacheMonitor.clearHistory();
      expect(cacheMonitor.getHistory().length).toBe(0);
    });
  });
});
