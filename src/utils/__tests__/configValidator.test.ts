import { ConfigValidator } from '../configValidator';
import type { ConfigValidationResult } from '../configValidator';
import { configManager } from '../../core/config/ConfigManager';

// 保存原始配置，用于测试后恢复
describe('ConfigValidator', () => {
  // 测试前保存原始配置
  const originalConfig = { ...configManager.getConfig() };

  // 测试后恢复原始配置
  afterAll(() => {
    configManager.setConfig(originalConfig);
  });

  test('should validate complete configuration successfully', () => {
    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('should handle missing encryption configuration gracefully', () => {
    // 删除加密配置
    const currentConfig = { ...configManager.getConfig() };
    delete (currentConfig as any).encryption;
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeLessThanOrEqual(3); // 允许少量警告
  });

  test('should handle missing api configuration gracefully', () => {
    // 删除API配置
    const currentConfig = { ...configManager.getConfig() };
    delete (currentConfig as any).api;
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeLessThanOrEqual(3); // 允许少量警告
  });

  test('should handle missing cache configuration gracefully', () => {
    // 删除缓存配置
    const currentConfig = { ...configManager.getConfig() };
    delete (currentConfig as any).cache;
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    // 测试自动修复功能
    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.cache).toBeDefined();
    expect(fixedConfig.cache.maxSize).toBeDefined();
    expect(fixedConfig.cache.defaultExpiry).toBeDefined();
  });

  test('should handle missing performance configuration gracefully', () => {
    // 删除性能配置
    const currentConfig = { ...configManager.getConfig() };
    delete (currentConfig as any).performance;
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    // 测试自动修复功能
    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.performance).toBeDefined();
    expect(fixedConfig.performance.enableQueryOptimization).toBeDefined();
    expect(fixedConfig.performance.maxConcurrentOperations).toBeDefined();
  });

  test('should handle missing monitoring configuration gracefully', () => {
    // 删除监控配置
    const currentConfig = { ...configManager.getConfig() };
    delete (currentConfig as any).monitoring;
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    // 测试自动修复功能
    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.monitoring).toBeDefined();
    expect(fixedConfig.monitoring.enablePerformanceTracking).toBeDefined();
    expect(fixedConfig.monitoring.enableHealthChecks).toBeDefined();
  });

  test('should validate auto-fixed configuration', () => {
    // 测试自动修复功能
    const fixedConfig = ConfigValidator.autoFix();

    // 验证修复后的配置
    expect(fixedConfig).toBeDefined();
    expect(fixedConfig.chunkSize).toBeDefined();
    expect(fixedConfig.storageFolder).toBeDefined();
    expect(fixedConfig.sortMethods).toBeDefined();
    expect(fixedConfig.timeout).toBeDefined();
    expect(fixedConfig.encryption).toBeDefined();
    expect(fixedConfig.performance).toBeDefined();
    expect(fixedConfig.cache).toBeDefined();
    expect(fixedConfig.api).toBeDefined();
    expect(fixedConfig.monitoring).toBeDefined();

    // 验证修复后的配置通过验证
    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('should detect invalid types in configuration', () => {
    // 修改配置为无效类型
    const currentConfig = { ...configManager.getConfig() };
    
    (currentConfig as any).chunkSize = 'invalid';
    (currentConfig as any).storageFolder = 123;
    (currentConfig as any).sortMethods = 456;
    (currentConfig as any).timeout = 'invalid';
    (currentConfig as any).encryption.keyIterations = 'invalid';
    (currentConfig as any).encryption.encryptedFields = 'invalid';
    (currentConfig as any).cache.maxSize = 'invalid';
    (currentConfig as any).performance.maxConcurrentOperations = 'invalid';
    (currentConfig as any).performance.memoryWarningThreshold = 'invalid';
    (currentConfig as any).api.rateLimit.requestsPerSecond = 'invalid';
    (currentConfig as any).api.rateLimit.enabled = 'invalid';
    (currentConfig as any).monitoring.enablePerformanceTracking = 'invalid';
    
    configManager.setConfig(currentConfig);

    // 验证能检测到所有无效类型
    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);

    // 检查一些关键错误
    expect(result.errors).toContain('chunkSize must be a number');
    expect(result.errors).toContain('storageFolder must be a string');
    expect(result.errors).toContain('encryption.keyIterations must be a number');
  });

  test('should auto fix invalid configuration', () => {
    // 测试自动修复功能
    const fixedConfig = ConfigValidator.autoFix();

    // 验证修复后的配置
    expect(typeof fixedConfig.chunkSize).toBe('number');
    expect(fixedConfig.chunkSize).toBe(5 * 1024 * 1024);

    expect(typeof fixedConfig.storageFolder).toBe('string');
    expect(fixedConfig.storageFolder).toBe('expo-litedatastore');

    expect(typeof fixedConfig.sortMethods).toBe('string');
    expect(['default', 'fast', 'counting', 'merge', 'slow']).toContain(fixedConfig.sortMethods);

    expect(typeof fixedConfig.timeout).toBe('number');
    expect(fixedConfig.timeout).toBe(10000);

    expect(typeof fixedConfig.encryption.algorithm).toBe('string');
    expect(fixedConfig.encryption.algorithm).toBe('AES-CTR');

    expect(typeof fixedConfig.encryption.keySize).toBe('number');
    expect(fixedConfig.encryption.keySize).toBe(256);

    expect(typeof fixedConfig.encryption.hmacAlgorithm).toBe('string');
    expect(['SHA-256', 'SHA-512']).toContain(fixedConfig.encryption.hmacAlgorithm);

    expect(Array.isArray(fixedConfig.encryption.encryptedFields)).toBe(true);

    expect(typeof fixedConfig.cache.maxSize).toBe('number');

    expect(typeof fixedConfig.api.rateLimit.requestsPerSecond).toBe('number');

    expect(typeof fixedConfig.monitoring.enablePerformanceTracking).toBe('boolean');
  });

  test('should validate fixed configuration successfully', () => {
    // 获取修复后的配置
    const fixedConfig = ConfigValidator.autoFix();

    // 使用修复后的配置验证
    configManager.setConfig(fixedConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
