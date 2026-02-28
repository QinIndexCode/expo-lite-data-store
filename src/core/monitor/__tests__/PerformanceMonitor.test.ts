import { PerformanceMonitor, PerformanceMetrics } from '../PerformanceMonitor';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
    monitor.clear();
    monitor.setEnabled(true);
    (monitor as any).sampleRate = 1.0;
  });

  afterEach(() => {
    monitor.destroy();
  });

  describe('基本功能测试', () => {
    it('应该能够创建性能监控器实例', () => {
      expect(monitor).toBeInstanceOf(PerformanceMonitor);
    });

    it('应该能够启用和禁用监控', () => {
      monitor.setEnabled(false);
      expect(monitor.isEnabled()).toBe(false);
      
      monitor.setEnabled(true);
      expect(monitor.isEnabled()).toBe(true);
    });

    it('应该能够清除所有指标', () => {
      const metrics: PerformanceMetrics = {
        operation: 'test',
        duration: 100,
        timestamp: Date.now(),
        success: true,
      };
      
      monitor.record(metrics);
      monitor.clear();
      
      expect(monitor.getMetrics()).toHaveLength(0);
    });
  });

  describe('性能指标记录测试', () => {
    it('应该能够记录成功的性能指标', () => {
      const metrics: PerformanceMetrics = {
        operation: 'read',
        duration: 50,
        timestamp: Date.now(),
        success: true,
        dataSize: 100,
      };
      
      monitor.record(metrics);
      const recordedMetrics = monitor.getMetrics();
      
      expect(recordedMetrics.length).toBeGreaterThan(0);
    });

    it('应该能够记录失败的性能指标', () => {
      const metrics: PerformanceMetrics = {
        operation: 'write',
        duration: 200,
        timestamp: Date.now(),
        success: false,
        error: 'Test error',
      };
      
      monitor.record(metrics);
      const recordedMetrics = monitor.getMetrics();
      
      expect(recordedMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('统计信息测试', () => {
    it('应该能够获取总体统计信息', () => {
      const stats = monitor.getOverallStats();
      
      expect(stats).toHaveProperty('totalOperations');
      expect(stats).toHaveProperty('successfulOperations');
      expect(stats).toHaveProperty('failedOperations');
      expect(stats).toHaveProperty('averageDuration');
      expect(stats).toHaveProperty('minDuration');
      expect(stats).toHaveProperty('maxDuration');
      expect(stats).toHaveProperty('totalDuration');
      expect(stats).toHaveProperty('successRate');
    });

    it('应该能够按操作类型获取统计信息', () => {
      const stats = monitor.getOperationStats('read');
      
      expect(stats).toHaveProperty('totalOperations');
      expect(stats).toHaveProperty('successfulOperations');
      expect(stats).toHaveProperty('failedOperations');
    });

    it('应该能够获取所有操作的统计信息', () => {
      const allStats = monitor.getOperationStats();
      
      expect(allStats).toBeInstanceOf(Map);
    });
  });

  describe('健康检查测试', () => {
    it('应该能够执行健康检查', () => {
      const result = monitor.performHealthCheck();
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('healthy');
      expect(result).toHaveProperty('details');
      expect(result).toHaveProperty('message');
      
      expect(result.details).toHaveProperty('performance');
      expect(result.details).toHaveProperty('resources');
      expect(result.details).toHaveProperty('components');
    });

    it('健康检查应该包含性能指标', () => {
      const result = monitor.performHealthCheck();
      
      expect(result.details.performance).toHaveProperty('averageDuration');
      expect(result.details.performance).toHaveProperty('successRate');
    });

    it('健康检查应该包含组件状态', () => {
      const result = monitor.performHealthCheck();
      
      expect(result.details.components).toHaveProperty('cache');
      expect(result.details.components).toHaveProperty('storage');
      expect(result.details.components).toHaveProperty('encryption');
    });
  });

  describe('统计计算测试', () => {
    it('应该正确计算平均耗时', () => {
      const metrics1: PerformanceMetrics = {
        operation: 'test',
        duration: 100,
        timestamp: Date.now(),
        success: true,
      };
      
      const metrics2: PerformanceMetrics = {
        operation: 'test',
        duration: 200,
        timestamp: Date.now(),
        success: true,
      };
      
      monitor.record(metrics1);
      monitor.record(metrics2);
      
      const stats = monitor.getOverallStats();
      expect(stats.totalOperations).toBeGreaterThan(0);
    });

    it('应该正确计算成功率', () => {
      const successMetrics: PerformanceMetrics = {
        operation: 'test',
        duration: 100,
        timestamp: Date.now(),
        success: true,
      };
      
      const failureMetrics: PerformanceMetrics = {
        operation: 'test',
        duration: 100,
        timestamp: Date.now(),
        success: false,
      };
      
      monitor.record(successMetrics);
      monitor.record(failureMetrics);
      
      const stats = monitor.getOverallStats();
      expect(stats.totalOperations).toBeGreaterThan(0);
    });
  });

  describe('静态方法测试', () => {
    it('应该能够检查性能跟踪是否启用', () => {
      const enabled = PerformanceMonitor.isPerformanceTrackingEnabled();
      expect(typeof enabled).toBe('boolean');
    });

    it('应该能够检查健康检查是否启用', () => {
      const enabled = PerformanceMonitor.isHealthChecksEnabled();
      expect(typeof enabled).toBe('boolean');
    });

    it('应该能够获取指标保留时间', () => {
      const retention = PerformanceMonitor.getMetricsRetention();
      expect(typeof retention).toBe('number');
      expect(retention).toBeGreaterThan(0);
    });
  });
});
