import { ConfigValidator } from '../configValidator';
import type { ConfigValidationResult } from '../configValidator';
import { configManager } from '../../core/config/ConfigManager';
import type { LiteStoreConfig } from '../../types/config';

describe('ConfigValidator', () => {
  const originalConfig = structuredClone(configManager.getConfig());

  afterEach(() => {
    configManager.setConfig(structuredClone(originalConfig));
  });

  it('accepts the complete default configuration', () => {
    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a configuration without encryption overrides', () => {
    const { encryption: _encryption, ...currentConfig } = configManager.getConfig();
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a configuration without API overrides', () => {
    const { api: _api, ...currentConfig } = configManager.getConfig();
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a configuration without cache overrides and restores cache defaults', () => {
    const { cache: _cache, ...currentConfig } = configManager.getConfig();
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.cache).toBeDefined();
    expect(fixedConfig.cache.maxSize).toBeDefined();
    expect(fixedConfig.cache.defaultExpiry).toBeDefined();
  });

  it('accepts a configuration without performance overrides and restores defaults', () => {
    const { performance: _performance, ...currentConfig } = configManager.getConfig();
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.performance).toBeDefined();
    expect(fixedConfig.performance.enableQueryOptimization).toBeDefined();
    expect(fixedConfig.performance.maxConcurrentOperations).toBeDefined();
  });

  it('accepts a configuration without monitoring overrides and restores defaults', () => {
    const { monitoring: _monitoring, ...currentConfig } = configManager.getConfig();
    configManager.setConfig(currentConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);

    const fixedConfig = ConfigValidator.autoFix();
    expect(fixedConfig.monitoring).toBeDefined();
    expect(fixedConfig.monitoring.enablePerformanceTracking).toBeDefined();
    expect(fixedConfig.monitoring.enableHealthChecks).toBeDefined();
  });

  it('produces a complete valid configuration when auto-fixing defaults', () => {
    const fixedConfig = ConfigValidator.autoFix();

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

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports invalid API and auto-sync values with other invalid configuration types', () => {
    const config = configManager.getConfig();
    const invalidConfig = {
      ...config,
      chunkSize: 'invalid',
      storageFolder: 123,
      sortMethods: 456,
      timeout: 'invalid',
      encryption: {
        ...config.encryption,
        keyIterations: 'invalid',
        encryptedFields: 'invalid',
      },
      cache: {
        ...config.cache,
        maxSize: 'invalid',
      },
      performance: {
        ...config.performance,
        maxConcurrentOperations: 'invalid',
        memoryWarningThreshold: 'invalid',
      },
      api: {
        ...config.api,
        rateLimit: {
          ...config.api.rateLimit,
          requestsPerSecond: 'invalid',
          enabled: 'invalid',
        },
        retry: {
          ...config.api.retry,
          maxAttempts: 'invalid',
          backoffMultiplier: 0,
        },
      },
      autoSync: {
        ...config.autoSync,
        enabled: 'invalid',
        interval: 0,
        minItems: 'invalid',
        batchSize: 0,
      },
      monitoring: {
        ...config.monitoring,
        enablePerformanceTracking: 'invalid',
      },
    };

    const getConfigSpy = jest
      .spyOn(configManager, 'getConfig')
      .mockReturnValue(invalidConfig as unknown as LiteStoreConfig);
    try {
      const result: ConfigValidationResult = ConfigValidator.validateAll();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      expect(result.errors).toContain('chunkSize must be a number');
      expect(result.errors).toContain(
        'storageFolder must be one non-empty directory name without path separators or traversal'
      );
      expect(result.errors).toContain('encryption.keyIterations must be a number');
      expect(result.errors).toContain('api.rateLimit.requestsPerSecond must be a number');
      expect(result.errors).toContain('api.retry.maxAttempts must be a number');
      expect(result.errors).toContain('autoSync.enabled must be a boolean');
    } finally {
      getConfigSpy.mockRestore();
    }
  });

  it('restores invalid configuration values to supported defaults', () => {
    const fixedConfig = ConfigValidator.autoFix();

    expect(typeof fixedConfig.chunkSize).toBe('number');
    expect(fixedConfig.chunkSize).toBe(5 * 1024 * 1024);

    expect(typeof fixedConfig.storageFolder).toBe('string');
    expect(fixedConfig.storageFolder).toBe('lite-data-store');

    expect(typeof fixedConfig.sortMethods).toBe('string');
    expect(['default', 'fast', 'counting', 'merge', 'slow']).toContain(fixedConfig.sortMethods);

    expect(typeof fixedConfig.timeout).toBe('number');
    expect(fixedConfig.timeout).toBe(10000);

    expect(typeof fixedConfig.encryption.algorithm).toBe('string');
    expect(fixedConfig.encryption.algorithm).toBe('auto');

    expect(typeof fixedConfig.encryption.keySize).toBe('number');
    expect(fixedConfig.encryption.keySize).toBe(256);

    expect(typeof fixedConfig.encryption.hmacAlgorithm).toBe('string');
    expect(['SHA-256', 'SHA-512']).toContain(fixedConfig.encryption.hmacAlgorithm);

    expect(Array.isArray(fixedConfig.encryption.encryptedFields)).toBe(true);

    expect(typeof fixedConfig.cache.maxSize).toBe('number');

    expect(typeof fixedConfig.api.rateLimit.requestsPerSecond).toBe('number');
    expect(typeof fixedConfig.api.retry.maxAttempts).toBe('number');
    const autoSync = fixedConfig.autoSync;
    expect(autoSync).toBeDefined();
    if (!autoSync) {
      throw new Error('autoSync defaults were not restored');
    }
    expect(typeof autoSync.enabled).toBe('boolean');
    expect(typeof autoSync.interval).toBe('number');

    expect(typeof fixedConfig.monitoring.enablePerformanceTracking).toBe('boolean');
  });

  it('accepts an auto-fixed configuration after it is applied', () => {
    const fixedConfig = ConfigValidator.autoFix();

    configManager.setConfig(fixedConfig);

    const result: ConfigValidationResult = ConfigValidator.validateAll();
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
