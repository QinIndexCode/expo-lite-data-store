import { ConfigManager } from '../../config/ConfigManager';
import { PerformanceMonitor, performanceMonitor, type PerformanceMetrics } from '../PerformanceMonitor';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
    monitor.clear();
    monitor.configure({
      enabled: true,
      sampleRate: 1,
      maxRecords: 100,
      thresholds: {
        minSuccessRate: 95,
        maxAverageDuration: 500,
        maxP95Duration: 1000,
      },
    });
  });

  afterEach(() => {
    monitor.destroy();
    // Restore configuration-derived defaults so runtime-toggle tests never leak state.
    // getInstance() (not the module export) keeps this correct after resetInstance().
    ConfigManager.getInstance().resetConfig();
  });

  const createMetric = (overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics => ({
    operation: 'read',
    duration: 50,
    timestamp: Date.now(),
    success: true,
    group: 'functional',
    profile: 'expo-go-js',
    ...overrides,
  });

  it('records metrics when enabled', () => {
    monitor.record(createMetric());
    expect(monitor.getMetrics()).toHaveLength(1);
  });

  it('filters metrics by operation and group', () => {
    monitor.record(createMetric({ operation: 'read', group: 'functional' }));
    monitor.record(createMetric({ operation: 'write', group: 'concurrency' }));

    expect(monitor.getMetrics({ operation: 'read' })).toHaveLength(1);
    expect(monitor.getMetrics({ group: 'concurrency' })).toHaveLength(1);
  });

  it('calculates operation stats with percentiles and throughput', () => {
    monitor.record(createMetric({ operation: 'write', duration: 10 }));
    monitor.record(createMetric({ operation: 'write', duration: 20 }));
    monitor.record(createMetric({ operation: 'write', duration: 40 }));

    const stats = monitor.getOperationStats('write');
    if (stats instanceof Map) {
      throw new Error('Expected getOperationStats(operation) to return PerformanceStats');
    }

    expect(stats.totalOperations).toBe(3);
    expect(stats.averageDuration).toBeCloseTo(70 / 3, 5);
    expect(stats.p50Duration).toBe(20);
    expect(stats.p95Duration).toBe(40);
    expect(stats.p99Duration).toBe(40);
    expect(stats.throughputOpsPerSec).toBeGreaterThan(0);
  });

  it('calculates group stats', () => {
    monitor.record(createMetric({ group: 'functional', duration: 20 }));
    monitor.record(createMetric({ group: 'functional', duration: 30 }));
    monitor.record(createMetric({ group: 'large-file', duration: 500 }));

    const stats = monitor.getGroupStats('functional');
    if (stats instanceof Map) {
      throw new Error('Expected getGroupStats(group) to return PerformanceStats');
    }

    expect(stats.totalOperations).toBe(2);
    expect(stats.averageDuration).toBe(25);
  });

  it('honors sample rate changes', () => {
    monitor.clear();
    monitor.configure({ sampleRate: 0 });
    monitor.record(createMetric());
    expect(monitor.getMetrics()).toHaveLength(0);
  });

  it('enforces max record retention', () => {
    monitor.clear();
    monitor.configure({ maxRecords: 2 });

    monitor.record(createMetric({ duration: 10 }));
    monitor.record(createMetric({ duration: 20 }));
    monitor.record(createMetric({ duration: 30 }));

    const metrics = monitor.getMetrics();
    expect(metrics).toHaveLength(2);
    expect(metrics.map(metric => metric.duration)).toEqual([20, 30]);
  });

  it('reports unhealthy health checks when thresholds are exceeded', () => {
    monitor.record(createMetric({ duration: 800 }));
    monitor.record(createMetric({ duration: 900 }));
    monitor.record(createMetric({ duration: 1200, success: false }));

    const result = monitor.performHealthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details.performance.averageDuration).toBeGreaterThan(500);
    expect(result.details.performance.p95Duration).toBe(1200);
    expect(result.details.performance.thresholds.maxAverageDuration).toBe(500);
  });

  it('does not report a performance failure without samples', () => {
    const result = monitor.performHealthCheck();

    expect(result.healthy).toBe(true);
    expect(result.details.performance.successRate).toBe(0);
    expect(result.message).toContain('No performance samples are available');
  });

  it('resets runtime options to defaults', () => {
    monitor.configure({
      enabled: false,
      sampleRate: 1,
      maxRecords: 10,
      thresholds: {
        minSuccessRate: 50,
      },
    });

    monitor.resetRuntimeOptions();

    expect(typeof monitor.isEnabled()).toBe('boolean');
    expect(monitor.getSampleRate()).toBe(0.1);
    expect(monitor.getThresholds().minSuccessRate).toBe(90);
  });

  it('follows runtime toggles of monitoring.enablePerformanceTracking', () => {
    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);

    const runtimeMonitor = new PerformanceMonitor();
    expect(runtimeMonitor.isEnabled()).toBe(false);

    // No explicit enabled override here, so configuration stays authoritative.
    runtimeMonitor.configure({ sampleRate: 1, maxRecords: 10 });
    runtimeMonitor.record(createMetric());
    expect(runtimeMonitor.getMetrics()).toHaveLength(0);

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', true);
    expect(runtimeMonitor.isEnabled()).toBe(true);
    // Deterministic: a callback falling back to resetRuntimeOptions() would restore 0.1.
    expect(runtimeMonitor.getSampleRate()).toBe(1);
    runtimeMonitor.record(createMetric());
    expect(runtimeMonitor.getMetrics()).toHaveLength(1);

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);
    expect(runtimeMonitor.isEnabled()).toBe(false);
    runtimeMonitor.record(createMetric());
    expect(runtimeMonitor.getMetrics()).toHaveLength(1);

    runtimeMonitor.destroy();
  });

  it('keeps configure() options when a configuration notification arrives', () => {
    monitor.clear();
    monitor.configure({ sampleRate: 1, maxRecords: 5 });

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', true);
    expect(monitor.isEnabled()).toBe(true);

    // Narrow refresh regression lock: the notification must not fall back to
    // resetRuntimeOptions(), which would restore sampleRate 0.1 and default thresholds.
    expect(monitor.getSampleRate()).toBe(1);
    expect(monitor.getThresholds()).toEqual({
      minSuccessRate: 95,
      maxAverageDuration: 500,
      maxP95Duration: 1000,
    });

    for (let index = 1; index <= 7; index += 1) {
      monitor.record(createMetric({ duration: index * 10 }));
    }

    // maxRecords stays at the configured 5 instead of the 1000 runtime default.
    expect(monitor.getMetrics().map(metric => metric.duration)).toEqual([30, 40, 50, 60, 70]);
  });

  it('keeps an explicit setEnabled(true) when configuration changes land', () => {
    monitor.setEnabled(true);

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);
    expect(monitor.isEnabled()).toBe(true);

    ConfigManager.getInstance().set('chunkSize', 10 * 1024 * 1024);
    expect(monitor.isEnabled()).toBe(true);
  });

  it('keeps an explicit configure({enabled:false}) when configuration enables tracking', () => {
    monitor.configure({ enabled: false });

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', true);
    expect(monitor.isEnabled()).toBe(false);

    ConfigManager.getInstance().set('chunkSize', 10 * 1024 * 1024);
    expect(monitor.isEnabled()).toBe(false);
  });

  it('stops following configuration changes after destroy()', () => {
    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);

    const runtimeMonitor = new PerformanceMonitor();
    expect(runtimeMonitor.isEnabled()).toBe(false);

    runtimeMonitor.destroy();

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', true);
    expect(runtimeMonitor.isEnabled()).toBe(false);

    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);
  });

  it('flips performanceMonitor state when a fresh instance set() lands after resetInstance()', () => {
    ConfigManager.getInstance().set('monitoring.enablePerformanceTracking', false);
    expect(performanceMonitor.isEnabled()).toBe(false);

    ConfigManager.resetInstance();
    const freshManager = ConfigManager.getInstance();

    freshManager.set('monitoring.enablePerformanceTracking', true);
    expect(performanceMonitor.isEnabled()).toBe(true);

    freshManager.set('monitoring.enablePerformanceTracking', false);
    expect(performanceMonitor.isEnabled()).toBe(false);
  });
});
