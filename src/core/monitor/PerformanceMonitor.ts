/**
 * @module PerformanceMonitor
 * @description Performance monitor collecting and reporting application metrics
 * @since 2025-11-28
 * @version 2.1.0
 */
import { configManager } from '../config/ConfigManager';

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: number;
  success: boolean;
  dataSize?: number;
  error?: string;
  group?: string;
  channel?: string;
  profile?: string;
  provider?: string;
}

export interface PerformanceStats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalDuration: number;
  successRate: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  throughputOpsPerSec: number;
}

export interface PerformanceThresholds {
  minSuccessRate: number;
  maxAverageDuration: number;
  maxP95Duration: number;
}

export interface PerformanceMonitorOptions {
  enabled?: boolean;
  sampleRate?: number;
  maxRecords?: number;
  metricsRetention?: number;
  thresholds?: Partial<PerformanceThresholds>;
}

export interface HealthCheckResult {
  timestamp: number;
  healthy: boolean;
  details: {
    performance: {
      averageDuration: number;
      p95Duration: number;
      successRate: number;
      sampleRate: number;
      thresholds: PerformanceThresholds;
    };
    resources: {
      memoryUsage?: number;
      cpuUsage?: number;
    };
    components: {
      cache: boolean;
      storage: boolean;
      encryption: boolean;
    };
  };
  message: string;
}

const DEFAULT_MAX_RECORDS = 1000;
const DEFAULT_SAMPLE_RATE = 0.1;
const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  minSuccessRate: 90,
  maxAverageDuration: 1000,
  maxP95Duration: 3000,
};

const quantile = (values: number[], ratio: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const emptyStats = (): PerformanceStats => ({
  totalOperations: 0,
  successfulOperations: 0,
  failedOperations: 0,
  averageDuration: 0,
  minDuration: 0,
  maxDuration: 0,
  totalDuration: 0,
  successRate: 0,
  p50Duration: 0,
  p95Duration: 0,
  p99Duration: 0,
  throughputOpsPerSec: 0,
});

const buildStats = (metrics: PerformanceMetrics[]): PerformanceStats => {
  if (metrics.length === 0) {
    return emptyStats();
  }

  const durations = metrics.map(metric => metric.duration);
  const successfulOperations = metrics.filter(metric => metric.success).length;
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const totalOperations = metrics.length;

  return {
    totalOperations,
    successfulOperations,
    failedOperations: totalOperations - successfulOperations,
    averageDuration: totalDuration / totalOperations,
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
    totalDuration,
    successRate: (successfulOperations / totalOperations) * 100,
    p50Duration: quantile(durations, 0.5),
    p95Duration: quantile(durations, 0.95),
    p99Duration: quantile(durations, 0.99),
    throughputOpsPerSec: totalDuration > 0 ? (totalOperations / totalDuration) * 1000 : 0,
  };
};

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private maxRecords: number;
  private enabled: boolean;
  private metricsRetention: number;
  private sampleRate: number;
  private thresholds: PerformanceThresholds;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.enabled = PerformanceMonitor.isPerformanceTrackingEnabled();
    this.maxRecords = DEFAULT_MAX_RECORDS;
    this.metricsRetention = PerformanceMonitor.getMetricsRetention();
    this.sampleRate = DEFAULT_SAMPLE_RATE;
    this.thresholds = { ...DEFAULT_THRESHOLDS };

    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
      this.startMetricsCleanupTimer();
    }
  }

  configure(options: PerformanceMonitorOptions): void {
    if (typeof options.enabled === 'boolean') {
      this.enabled = options.enabled;
    }

    if (typeof options.sampleRate === 'number') {
      this.sampleRate = Math.max(0, Math.min(1, options.sampleRate));
    }

    if (typeof options.maxRecords === 'number' && Number.isFinite(options.maxRecords)) {
      this.maxRecords = Math.max(1, Math.floor(options.maxRecords));
      if (this.metrics.length > this.maxRecords) {
        this.metrics = this.metrics.slice(this.metrics.length - this.maxRecords);
      }
    }

    if (typeof options.metricsRetention === 'number' && Number.isFinite(options.metricsRetention)) {
      this.metricsRetention = Math.max(0, options.metricsRetention);
    }

    if (options.thresholds) {
      this.thresholds = {
        ...this.thresholds,
        ...options.thresholds,
      };
    }
  }

  resetRuntimeOptions(): void {
    this.enabled = PerformanceMonitor.isPerformanceTrackingEnabled();
    this.maxRecords = DEFAULT_MAX_RECORDS;
    this.metricsRetention = PerformanceMonitor.getMetricsRetention();
    this.sampleRate = DEFAULT_SAMPLE_RATE;
    this.thresholds = { ...DEFAULT_THRESHOLDS };
  }

  record(metrics: PerformanceMetrics): void {
    if (!this.enabled) {
      return;
    }

    if (Math.random() > this.sampleRate) {
      return;
    }

    this.metrics.push(metrics);

    if (this.metrics.length > this.maxRecords) {
      this.metrics.splice(0, this.metrics.length - this.maxRecords);
    }
  }

  getMetrics(filter?: Partial<Pick<PerformanceMetrics, 'operation' | 'group' | 'channel' | 'profile' | 'provider'>>): PerformanceMetrics[] {
    if (!filter) {
      return [...this.metrics];
    }

    return this.metrics.filter(metric => {
      return Object.entries(filter).every(([key, value]) => metric[key as keyof PerformanceMetrics] === value);
    });
  }

  getOperationStats(operation?: string): PerformanceStats | Map<string, PerformanceStats> {
    if (operation) {
      return buildStats(this.metrics.filter(metric => metric.operation === operation));
    }

    const grouped = new Map<string, PerformanceStats>();
    const operations = Array.from(new Set(this.metrics.map(metric => metric.operation)));

    operations.forEach(name => {
      grouped.set(name, buildStats(this.metrics.filter(metric => metric.operation === name)));
    });

    return grouped;
  }

  getGroupStats(group?: string): PerformanceStats | Map<string, PerformanceStats> {
    if (group) {
      return buildStats(this.metrics.filter(metric => metric.group === group));
    }

    const grouped = new Map<string, PerformanceStats>();
    const groups = Array.from(new Set(this.metrics.map(metric => metric.group).filter((value): value is string => Boolean(value))));

    groups.forEach(name => {
      grouped.set(name, buildStats(this.metrics.filter(metric => metric.group === name)));
    });

    return grouped;
  }

  getOverallStats(): PerformanceStats {
    return buildStats(this.metrics);
  }

  getThresholds(): PerformanceThresholds {
    return { ...this.thresholds };
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  private startMetricsCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldMetrics();
    }, 60000);
  }

  stopMetricsCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  destroy(): void {
    this.stopMetricsCleanupTimer();
    this.clear();
    this.resetRuntimeOptions();
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - this.metricsRetention;
    this.metrics = this.metrics.filter(metric => metric.timestamp >= cutoffTime);
  }

  clear(): void {
    this.metrics = [];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  static isPerformanceTrackingEnabled(): boolean {
    return configManager.getConfig().monitoring?.enablePerformanceTracking !== false;
  }

  static isHealthChecksEnabled(): boolean {
    return configManager.getConfig().monitoring?.enableHealthChecks !== false;
  }

  static getMetricsRetention(): number {
    return configManager.getConfig().monitoring?.metricsRetention || 86400000;
  }

  performHealthCheck(): HealthCheckResult {
    if (!PerformanceMonitor.isHealthChecksEnabled()) {
      return {
        timestamp: Date.now(),
        healthy: true,
        details: {
          performance: {
            averageDuration: 0,
            p95Duration: 0,
            successRate: 100,
            sampleRate: this.sampleRate,
            thresholds: this.getThresholds(),
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

    const stats = this.getOverallStats();
    const thresholds = this.getThresholds();
    const performanceHealthy =
      stats.successRate >= thresholds.minSuccessRate
      && stats.averageDuration <= thresholds.maxAverageDuration
      && stats.p95Duration <= thresholds.maxP95Duration;

    const resources = {
      memoryUsage:
        typeof process !== 'undefined' && process.memoryUsage
          ? Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100) / 100
          : undefined,
      cpuUsage: undefined,
    };

    return {
      timestamp: Date.now(),
      healthy: performanceHealthy,
      details: {
        performance: {
          averageDuration: stats.averageDuration,
          p95Duration: stats.p95Duration,
          successRate: stats.successRate,
          sampleRate: this.sampleRate,
          thresholds,
        },
        resources,
        components: {
          cache: true,
          storage: true,
          encryption: true,
        },
      },
      message: performanceHealthy ? 'System is healthy' : 'System health check failed',
    };
  }
}

export const performanceMonitor = new PerformanceMonitor();
