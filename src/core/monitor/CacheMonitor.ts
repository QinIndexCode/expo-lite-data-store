import { CacheManager } from '../cache/CacheManager';
import type { CacheStats } from '../cache/CacheManager';

/** Collects bounded cache statistics and reports simple health signals. */
export class CacheMonitor {
  private cacheManager: CacheManager;
  private history: CacheStats[] = [];
  private readonly maxHistoryRecords = 100;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private enabled = true;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = setInterval(() => {
      if (this.enabled) {
        this.recordStats();
      }
    }, intervalMs);

    this.recordStats();
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  recordStats(): void {
    const stats = this.cacheManager.getStats();
    this.history.push({ ...stats });

    if (this.history.length > this.maxHistoryRecords) {
      this.history.shift();
    }
  }

  getCurrentStats(): CacheStats {
    return this.cacheManager.getStats();
  }

  getHistory(): CacheStats[] {
    return [...this.history];
  }

  getAverageHitRate(): number {
    if (this.history.length === 0) {
      return 0;
    }

    const totalHitRate = this.history.reduce((sum, stats) => sum + stats.hitRate, 0);
    return totalHitRate / this.history.length;
  }

  getMemoryUsageTrend(): { timestamp: number; memoryUsage: number }[] {
    return this.history.map((stats, index) => ({
      // CacheStats has no timestamp, so these values are relative estimates rather than event times.
      timestamp: Date.now() - (this.history.length - index) * 60000,
      memoryUsage: stats.memoryUsage,
    }));
  }

  checkHealth(): {
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const stats = this.getCurrentStats();
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (stats.hitRate < 0.5) {
      issues.push(`缓存命中率较低: ${(stats.hitRate * 100).toFixed(2)}%`);
      recommendations.push('考虑增加缓存大小或调整缓存策略');
    }

    if (stats.maxMemoryUsage > 0 && stats.memoryUsage > stats.maxMemoryUsage * 0.9) {
      issues.push(`内存使用率较高: ${((stats.memoryUsage / stats.maxMemoryUsage) * 100).toFixed(2)}%`);
      recommendations.push('考虑增加最大内存限制或优化缓存清理策略');
    }

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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clearHistory(): void {
    this.history = [];
  }
}
