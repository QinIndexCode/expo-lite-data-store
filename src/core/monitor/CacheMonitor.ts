// src/core/monitor/CacheMonitor.ts
import { CacheManager, CacheStats } from '../cache/CacheManager';

/**
 * 缓存监控器类
 * 用于监控缓存的使用情况和性能
 */
export class CacheMonitor {
  /**
   * 缓存管理器实例
   */
  private cacheManager: CacheManager;

  /**
   * 历史统计记录
   */
  private history: CacheStats[] = [];

  /**
   * 最大保留记录数
   */
  private readonly maxHistoryRecords = 100;

  /**
   * 监控间隔（毫秒）
   */
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * 是否启用监控
   */
  private enabled: boolean = true;

  /**
   * 构造函数
   */
  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * 开始监控
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = setInterval(() => {
      if (this.enabled) {
        this.recordStats();
      }
    }, intervalMs);

    // 立即记录一次
    this.recordStats();
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      // 监控已停止
    }
  }

  /**
   * 记录统计信息
   */
  recordStats(): void {
    const stats = this.cacheManager.getStats();
    this.history.push({ ...stats });

    // 限制历史记录数量
    if (this.history.length > this.maxHistoryRecords) {
      this.history.shift();
    }
  }

  /**
   * 获取当前统计信息
   */
  getCurrentStats(): CacheStats {
    return this.cacheManager.getStats();
  }

  /**
   * 获取历史统计信息
   */
  getHistory(): CacheStats[] {
    return [...this.history];
  }

  /**
   * 获取平均命中率
   */
  getAverageHitRate(): number {
    if (this.history.length === 0) {
      return 0;
    }

    const totalHitRate = this.history.reduce((sum, stats) => sum + stats.hitRate, 0);
    return totalHitRate / this.history.length;
  }

  /**
   * 获取内存使用趋势
   */
  getMemoryUsageTrend(): { timestamp: number; memoryUsage: number }[] {
    return this.history.map((stats, index) => ({
      timestamp: Date.now() - (this.history.length - index) * 60000, // 估算时间戳
      memoryUsage: stats.memoryUsage,
    }));
  }

  /**
   * 检查缓存健康状态
   */
  checkHealth(): {
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const stats = this.getCurrentStats();
    const issues: string[] = [];
    const recommendations: string[] = [];

    // 检查命中率
    if (stats.hitRate < 0.5) {
      issues.push(`缓存命中率较低: ${(stats.hitRate * 100).toFixed(2)}%`);
      recommendations.push('考虑增加缓存大小或调整缓存策略');
    }

    // 检查内存使用
    if (stats.maxMemoryUsage > 0 && stats.memoryUsage > stats.maxMemoryUsage * 0.9) {
      issues.push(`内存使用率较高: ${((stats.memoryUsage / stats.maxMemoryUsage) * 100).toFixed(2)}%`);
      recommendations.push('考虑增加最大内存限制或优化缓存清理策略');
    }

    // 检查淘汰次数
    if (stats.evictions > stats.writes * 0.5) {
      issues.push(`缓存淘汰频繁: ${stats.evictions} 次淘汰，${stats.writes} 次写入`);
      recommendations.push('考虑增加缓存容量');
    }

    return {
      healthy: issues.length === 0,
      issues,
      recommendations,
    };
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
   * 清除历史记录
   */
  clearHistory(): void {
    this.history = [];
  }
}
