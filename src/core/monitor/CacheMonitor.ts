import { CacheManager } from '../cache/CacheManager';
import type { CacheStats } from '../cache/CacheManager';

/** Collects bounded cache statistics and reports simple health signals. */
export class CacheMonitor {
  private cacheManager: CacheManager;
  private history: CacheStats[] = [];
  private readonly maxHistoryRecords = 100;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private monitoringIntervalMs = 60000;
  private monitoringRequested = false;
  private enabled = true;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Requests periodic sampling. The timer only runs while monitoring is enabled,
   * so a disabled monitor holds no pending interval.
   */
  startMonitoring(intervalMs: number = 60000): void {
    this.monitoringIntervalMs = intervalMs;
    this.monitoringRequested = true;
    this.syncMonitoringTimer();
  }

  stopMonitoring(): void {
    this.monitoringRequested = false;
    this.syncMonitoringTimer();
  }

  private syncMonitoringTimer(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (!this.monitoringRequested || !this.enabled) {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.recordStats();
    }, this.monitoringIntervalMs);

    this.recordStats();
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

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    this.syncMonitoringTimer();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clearHistory(): void {
    this.history = [];
  }
}
