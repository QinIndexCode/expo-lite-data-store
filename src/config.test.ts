/**
 * 配置文件可用性测试
 */
import config from './liteStore.config.js';

describe('Configuration Tests', () => {
  test('配置文件应该正确加载', () => {
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  test('chunkSize 配置应该有效', () => {
    expect(config.chunkSize).toBeDefined();
    expect(typeof config.chunkSize).toBe('number');
    expect(config.chunkSize).toBeGreaterThan(0);
    expect(config.chunkSize).toBe(5 * 1024 * 1024); // 5MB
  });

  test('storageFolder 配置应该有效', () => {
    expect(config.storageFolder).toBeDefined();
    expect(typeof config.storageFolder).toBe('string');
    expect(config.storageFolder).toBe('expo-litedatastore');
  });

  test('sortMethods 配置应该有效', () => {
    expect(config.sortMethods).toBeDefined();
    expect(typeof config.sortMethods).toBe('string');
    expect(['default', 'fast', 'counting', 'merge', 'slow']).toContain(config.sortMethods);
  });

  test('timeout 配置应该有效', () => {
    expect(config.timeout).toBeDefined();
    expect(typeof config.timeout).toBe('number');
    expect(config.timeout).toBeGreaterThan(0);
    expect(config.timeout).toBe(10000); // 10s
  });

  test('加密配置应该有效', () => {
    expect(config.encryption).toBeDefined();
    expect(typeof config.encryption.keyIterations).toBe('number');
    expect(config.encryption.keyIterations).toBeGreaterThanOrEqual(10000);
    expect(typeof config.encryption.enableFieldLevelEncryption).toBe('boolean');
    expect(typeof config.encryption.cacheTimeout).toBe('number');
    expect(config.encryption.cacheTimeout).toBeGreaterThan(0);
  });

  test('性能配置应该有效', () => {
    expect(config.performance).toBeDefined();
    expect(typeof config.performance.enableQueryOptimization).toBe('boolean');
    expect(typeof config.performance.maxConcurrentOperations).toBe('number');
    expect(config.performance.maxConcurrentOperations).toBeGreaterThan(0);
    expect(typeof config.performance.memoryWarningThreshold).toBe('number');
    expect(config.performance.memoryWarningThreshold).toBeGreaterThan(0);
    expect(config.performance.memoryWarningThreshold).toBeLessThanOrEqual(1);
  });

  test('缓存配置应该有效', () => {
    expect(config.cache).toBeDefined();
    expect(typeof config.cache.maxSize).toBe('number');
    expect(config.cache.maxSize).toBeGreaterThan(0);
    expect(typeof config.cache.defaultExpiry).toBe('number');
    expect(config.cache.defaultExpiry).toBeGreaterThan(0);
  });

  test('API配置应该有效', () => {
    expect(config.api).toBeDefined();
    expect(config.api.rateLimit).toBeDefined();
    expect(typeof config.api.rateLimit.enabled).toBe('boolean');
    expect(typeof config.api.rateLimit.requestsPerSecond).toBe('number');
    expect(config.api.rateLimit.requestsPerSecond).toBeGreaterThan(0);
  });

  test('监控配置应该有效', () => {
    expect(config.monitoring).toBeDefined();
    expect(typeof config.monitoring.enablePerformanceTracking).toBe('boolean');
    expect(typeof config.monitoring.enableHealthChecks).toBe('boolean');
    expect(typeof config.monitoring.metricsRetention).toBe('number');
    expect(config.monitoring.metricsRetention).toBeGreaterThan(0);
  });

  test('所有配置项都应该有合理的默认值', () => {
    // 确保配置不会导致系统崩溃
    expect(config.chunkSize).toBeLessThanOrEqual(100 * 1024 * 1024); // 不超过100MB
    expect(config.timeout).toBeLessThanOrEqual(300000); // 不超过5分钟
    expect(config.storageFolder).toMatch(/^[a-zA-Z0-9_-]+$/); // 合法文件夹名

    // 新配置的合理性检查
    expect(config.encryption.keyIterations).toBeLessThanOrEqual(1000000); // 不超过100万次
    expect(config.performance.maxConcurrentOperations).toBeLessThanOrEqual(100); // 不超过100并发
    expect(config.cache.maxSize).toBeLessThanOrEqual(10000); // 不超过1万条缓存
    expect(config.api.rateLimit.requestsPerSecond).toBeLessThanOrEqual(1000); // 不超过1000 RPS
  });

  test('配置文件应该与代码中使用的配置兼容', () => {
    // 测试配置在实际代码中的使用
    // 验证加密配置的完整性
    expect(config.encryption.hmacAlgorithm).toBeDefined();
    expect(['SHA-256', 'SHA-512']).toContain(config.encryption.hmacAlgorithm);
    
    expect(config.encryption.useBulkOperations).toBeDefined();
    expect(typeof config.encryption.useBulkOperations).toBe('boolean');
    
    expect(config.encryption.encryptedFields).toBeDefined();
    expect(Array.isArray(config.encryption.encryptedFields)).toBe(true);
    
    expect(config.encryption.maxCacheSize).toBeDefined();
    expect(typeof config.encryption.maxCacheSize).toBe('number');
    
    // 验证API配置的完整性
    expect(config.api.retry).toBeDefined();
    expect(typeof config.api.retry.maxAttempts).toBe('number');
    expect(config.api.retry.maxAttempts).toBeGreaterThan(0);
    
    expect(typeof config.api.retry.backoffMultiplier).toBe('number');
    expect(config.api.retry.backoffMultiplier).toBeGreaterThan(0);
    
    // 验证API限流配置的完整性
    expect(config.api.rateLimit.burstCapacity).toBeDefined();
    expect(typeof config.api.rateLimit.burstCapacity).toBe('number');
    expect(config.api.rateLimit.burstCapacity).toBeGreaterThan(0);
    
    // 验证性能配置的完整性
    expect(config.performance.enableBatchOptimization).toBeDefined();
    expect(typeof config.performance.enableBatchOptimization).toBe('boolean');
    
    // 验证缓存配置的完整性
    expect(config.cache.enableCompression).toBeDefined();
    expect(typeof config.cache.enableCompression).toBe('boolean');
    
    expect(config.cache.cleanupInterval).toBeDefined();
    expect(typeof config.cache.cleanupInterval).toBe('number');
    expect(config.cache.cleanupInterval).toBeGreaterThan(0);
    
    // 验证监控配置的完整性
    expect(config.monitoring.metricsRetention).toBeDefined();
    expect(typeof config.monitoring.metricsRetention).toBe('number');
    expect(config.monitoring.metricsRetention).toBeGreaterThan(0);
  });
});
