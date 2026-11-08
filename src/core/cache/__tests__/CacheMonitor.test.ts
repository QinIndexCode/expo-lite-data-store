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

    it('does not run a timer while monitoring is disabled', () => {
      jest.useFakeTimers();
      cacheMonitor.setEnabled(false);
      cacheMonitor.startMonitoring(100);

      expect(cacheMonitor.getHistory()).toHaveLength(0);
      jest.advanceTimersByTime(300);
      expect(cacheMonitor.getHistory()).toHaveLength(0);

      cacheMonitor.setEnabled(true);
      expect(cacheMonitor.getHistory()).toHaveLength(1);
      jest.advanceTimersByTime(100);
      expect(cacheMonitor.getHistory()).toHaveLength(2);
    });

    it('stops the timer when disabled and restarts it when re-enabled', () => {
      jest.useFakeTimers();
      cacheMonitor.startMonitoring(100);
      expect(cacheMonitor.getHistory()).toHaveLength(1);

      jest.advanceTimersByTime(100);
      expect(cacheMonitor.getHistory()).toHaveLength(2);

      cacheMonitor.setEnabled(false);
      jest.advanceTimersByTime(300);
      expect(cacheMonitor.getHistory()).toHaveLength(2);

      cacheMonitor.setEnabled(true);
      expect(cacheMonitor.getHistory()).toHaveLength(3);
      jest.advanceTimersByTime(100);
      expect(cacheMonitor.getHistory()).toHaveLength(4);
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
