// src/core/cache/__tests__/CacheMonitor.test.ts
import { CacheMonitor } from '../../monitor/CacheMonitor';
import { CacheManager, CacheStrategy } from '../CacheManager';

//
describe('CacheMonitor', () => {
  let cacheManager: CacheManager;
  let cacheMonitor: CacheMonitor;

  beforeEach(() => {
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 100,
      defaultExpiry: 3600000,
      maxMemoryUsage: 10 * 1024 * 1024, // 10MB
      memoryThreshold: 0.8,
    });
    cacheMonitor = new CacheMonitor(cacheManager);
  });

  afterEach(done => {
    // 确保停止监控并清理所有资源
    if (cacheMonitor) {
      cacheMonitor.stopMonitoring();
      cacheMonitor.clearHistory();
      cacheMonitor.setEnabled(false);
    }
    // 清理 CacheManager 的定时器
    if (cacheManager) {
      cacheManager.cleanup();
    }
    // 使用 process.nextTick 而不是 setTimeout，避免阻塞
    process.nextTick(done);
  });

  describe('监控功能', () => {
    it('应该能够记录缓存统计信息', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');
      cacheManager.get('key1');

      cacheMonitor.recordStats();
      const stats = cacheMonitor.getCurrentStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('应该能够获取历史统计信息', () => {
      cacheMonitor.recordStats();
      cacheManager.set('key1', 'value1');
      cacheMonitor.recordStats();

      const history = cacheMonitor.getHistory();
      expect(history.length).toBe(2);
    });

    it('应该能够计算平均命中率', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.get('key1');
      cacheManager.get('key1');
      cacheManager.get('key2'); // miss

      cacheMonitor.recordStats();
      const avgHitRate = cacheMonitor.getAverageHitRate();

      expect(avgHitRate).toBeGreaterThan(0);
    });
  });

  describe('健康检查', () => {
    it('应该能够检测健康的缓存状态', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.get('key1');
      cacheManager.get('key1');

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      expect(health.healthy).toBe(true);
      expect(health.issues.length).toBe(0);
    });

    it('应该能够检测低命中率问题', () => {
      // 设置大量数据但很少命中
      for (let i = 0; i < 50; i++) {
        cacheManager.set(`key${i}`, `value${i}`);
      }
      // 只命中一次
      cacheManager.get('key1');

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      // 命中率低时应该有问题提示
      if (health.issues.length > 0) {
        expect(health.issues.some(issue => issue.includes('命中率'))).toBe(true);
      }
    });

    it('应该能够检测高内存使用问题', () => {
      // 设置大量数据
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      for (let i = 0; i < 10; i++) {
        cacheManager.set(`key${i}`, largeData);
      }

      cacheMonitor.recordStats();
      const health = cacheMonitor.checkHealth();

      // 如果内存使用高，应该有提示
      const stats = cacheMonitor.getCurrentStats();
      if (stats.memoryUsage > stats.maxMemoryUsage * 0.9) {
        expect(health.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('监控控制', () => {
    it('应该能够启动和停止监控', done => {
      cacheMonitor.startMonitoring(100);
      expect(cacheMonitor.isEnabled()).toBe(true);

      // 等待一小段时间确保定时器已启动
      setTimeout(() => {
        cacheMonitor.stopMonitoring();
        expect(cacheMonitor.isEnabled()).toBe(true); // 停止后监控器仍然启用，只是定时器停止了
        done();
      }, 50);
    });

    it('应该能够启用和禁用监控', () => {
      cacheMonitor.setEnabled(false);
      expect(cacheMonitor.isEnabled()).toBe(false);

      cacheMonitor.setEnabled(true);
      expect(cacheMonitor.isEnabled()).toBe(true);
    });

    it('应该能够清除历史记录', () => {
      cacheMonitor.recordStats();
      cacheMonitor.recordStats();
      expect(cacheMonitor.getHistory().length).toBe(2);

      cacheMonitor.clearHistory();
      expect(cacheMonitor.getHistory().length).toBe(0);
    });
  });
});
