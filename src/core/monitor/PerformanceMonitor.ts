// src/core/monitor/PerformanceMonitor.ts
/**
 * 性能监控器
 * 用于收集和统计应用程序的性能指标
 */
import { configManager } from '../config/ConfigManager';
/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
  /**
   * 操作类型
   */
  operation: string;
  /**
   * 操作耗时（毫秒）
   */
  duration: number;
  /**
   * 操作时间戳
   */
  timestamp: number;
  /**
   * 操作是否成功
   */
  success: boolean;
  /**
   * 操作数据量（如记录数）
   */
  dataSize?: number;
  /**
   * 错误信息（如果失败）
   */
  error?: string;
}

/**
 * 健康检查结果接口
 */
export interface HealthCheckResult {
  /**
   * 健康检查时间戳
   */
  timestamp: number;
  /**
   * 系统是否健康
   */
  healthy: boolean;
  /**
   * 健康状态详情
   */
  details: {
    /**
     * 性能指标状态
     */
    performance: {
      averageDuration: number;
      successRate: number;
    };
    /**
     * 系统资源状态
     */
    resources: {
      memoryUsage?: number;
      cpuUsage?: number;
    };
    /**
     * 组件状态
     */
    components: {
      cache: boolean;
      storage: boolean;
      encryption: boolean;
    };
  };
  /**
   * 健康检查消息
   */
  message: string;
}

/**
 * 性能统计信息
 */
export interface PerformanceStats {
  /**
   * 操作总数
   */
  totalOperations: number;
  /**
   * 成功操作数
   */
  successfulOperations: number;
  /**
   * 失败操作数
   */
  failedOperations: number;
  /**
   * 平均耗时（毫秒）
   */
  averageDuration: number;
  /**
   * 最小耗时（毫秒）
   */
  minDuration: number;
  /**
   * 最大耗时（毫秒）
   */
  maxDuration: number;
  /**
   * 总耗时（毫秒）
   */
  totalDuration: number;
  /**
   * 成功率（百分比）
   */
  successRate: number;
}

/**
 * 性能监控器类
 * 用于收集和统计性能指标
 */
export class PerformanceMonitor {
  /**
   * 性能指标历史记录（保留最近配置的记录数）
   */
  private metrics: PerformanceMetrics[] = [];

  /**
   * 最大保留记录数
   */
  private maxRecords: number;

  /**
   * 操作统计（按操作类型分组）
   */
  private operationStats = new Map<string, PerformanceStats>();

  /**
   * 是否启用监控
   */
  private enabled: boolean;

  /**
   * 指标保留时间（毫秒）
   */
  private metricsRetention: number;

  /**
   * 采样率（0-1之间），用于减少性能监控开销
   * 默认10%采样率，减少90%的指标收集开销
   */
  private sampleRate: number;

  /**
   * 构造函数
   */
  constructor() {
    // 从配置文件获取监控参数
    this.enabled = PerformanceMonitor.isPerformanceTrackingEnabled();
    this.maxRecords = 1000; // 默认保留1000条记录
    this.metricsRetention = PerformanceMonitor.getMetricsRetention();
    this.sampleRate = 0.1; // 默认10%采样率，减少90%的指标收集开销

    // 定期清理旧指标（在测试环境中禁用，避免 Jest open handle 提示）
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
      this.startMetricsCleanupTimer();
    }
  }

  /**
   * 记录性能指标
   * @param metrics 性能指标
   */
  record(metrics: PerformanceMetrics): void {
    if (!this.enabled) {
      return;
    }

    // 采样策略：只记录部分性能指标，减少90%的指标收集开销
    if (Math.random() > this.sampleRate) {
      return;
    }

    // 添加到历史记录
    this.metrics.push(metrics);

    // 限制记录数量
    if (this.metrics.length > this.maxRecords) {
      this.metrics.shift();
    }

    // 更新操作统计
    this.updateOperationStats(metrics);
  }

  /**
   * 更新操作统计
   */
  private updateOperationStats(metrics: PerformanceMetrics): void {
    const stats = this.operationStats.get(metrics.operation) || {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      totalDuration: 0,
      successRate: 0,
    };

    stats.totalOperations++;
    if (metrics.success) {
      stats.successfulOperations++;
    } else {
      stats.failedOperations++;
    }

    stats.totalDuration += metrics.duration;
    stats.averageDuration = stats.totalDuration / stats.totalOperations;
    stats.minDuration = Math.min(stats.minDuration, metrics.duration);
    stats.maxDuration = Math.max(stats.maxDuration, metrics.duration);
    stats.successRate = (stats.successfulOperations / stats.totalOperations) * 100;

    this.operationStats.set(metrics.operation, stats);
  }

  /**
   * 获取所有性能指标
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * 获取操作统计信息
   */
  getOperationStats(operation?: string): PerformanceStats | Map<string, PerformanceStats> {
    if (operation) {
      return (
        this.operationStats.get(operation) || {
          totalOperations: 0,
          successfulOperations: 0,
          failedOperations: 0,
          averageDuration: 0,
          minDuration: 0,
          maxDuration: 0,
          totalDuration: 0,
          successRate: 0,
        }
      );
    }
    return new Map(this.operationStats);
  }

  /**
   * 获取总体统计信息
   */
  getOverallStats(): PerformanceStats {
    const allMetrics = this.metrics;
    if (allMetrics.length === 0) {
      return {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalDuration: 0,
        successRate: 0,
      };
    }

    const successful = allMetrics.filter(m => m.success).length;
    const totalDuration = allMetrics.reduce((sum, m) => sum + m.duration, 0);
    const durations = allMetrics.map(m => m.duration);

    return {
      totalOperations: allMetrics.length,
      successfulOperations: successful,
      failedOperations: allMetrics.length - successful,
      averageDuration: totalDuration / allMetrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      totalDuration,
      successRate: (successful / allMetrics.length) * 100,
    };
  }

  /**
   * 定期清理旧指标
   */
  private startMetricsCleanupTimer(): void {
    const cleanupInterval = 60000; // 每分钟清理一次
    setInterval(() => {
      this.cleanupOldMetrics();
    }, cleanupInterval);
  }

  /**
   * 清理超过保留时间的旧指标
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    const cutoffTime = now - this.metricsRetention;

    // 过滤掉超过保留时间的指标
    this.metrics = this.metrics.filter(metric => metric.timestamp >= cutoffTime);

    // 如果清理后指标数量减少，重新计算操作统计
    this.recalculateOperationStats();
  }

  /**
   * 重新计算操作统计
   */
  private recalculateOperationStats(): void {
    // 清除旧统计
    this.operationStats.clear();

    // 重新计算所有指标的统计
    for (const metric of this.metrics) {
      this.updateOperationStats(metric);
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = [];
    this.operationStats.clear();
  }

  /**
   * 启用/禁用监控
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 是否启用监控
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 从配置文件获取是否启用性能跟踪
   * @returns 是否启用性能跟踪
   */
  static isPerformanceTrackingEnabled(): boolean {
    return configManager.getConfig().monitoring?.enablePerformanceTracking !== false;
  }

  /**
   * 从配置文件获取是否启用健康检查
   * @returns 是否启用健康检查
   */
  static isHealthChecksEnabled(): boolean {
    return configManager.getConfig().monitoring?.enableHealthChecks !== false;
  }

  /**
   * 从配置文件获取指标保留时间
   * @returns 指标保留时间（毫秒）
   */
  static getMetricsRetention(): number {
    return configManager.getConfig().monitoring?.metricsRetention || 86400000; // 默认24小时
  }

  /**
   * 执行健康检查
   * @returns 健康检查结果
   */
  performHealthCheck(): HealthCheckResult {
    // Check if health checks are enabled in config
    if (!PerformanceMonitor.isHealthChecksEnabled()) {
      return {
        timestamp: Date.now(),
        healthy: true,
        details: {
          performance: {
            averageDuration: 0,
            successRate: 100,
          },
          resources: {},
          components: {
            cache: true,
            storage: true,
            encryption: true,
          },
        },
        message: 'Health checks are disabled in configuration',
      };
    }

    // Get overall performance stats
    const stats = this.getOverallStats();

    // Basic health checks
    const healthy = {
      performance: stats.successRate >= 90 && stats.averageDuration < 1000, // 90% success rate and <1s average duration
      components: true, // Assume components are healthy for now
    };

    // Check system resources if available
    const resources = {
      memoryUsage:
        typeof process !== 'undefined' && process.memoryUsage
          ? Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100) / 100
          : undefined,
      cpuUsage: undefined, // CPU usage is complex to calculate in Node.js
    };

    const isHealthy = healthy.performance && healthy.components;

    return {
      timestamp: Date.now(),
      healthy: isHealthy,
      details: {
        performance: {
          averageDuration: stats.averageDuration,
          successRate: stats.successRate,
        },
        resources: resources,
        components: {
          cache: true,
          storage: true,
          encryption: true,
        },
      },
      message: isHealthy ? 'System is healthy' : 'System health check failed',
    };
  }
}

/**
 * 全局性能监控器实例
 */
export const performanceMonitor = new PerformanceMonitor();
