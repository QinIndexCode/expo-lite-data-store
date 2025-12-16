/**
 * 配置验证工具
 * 用于验证liteStore.config.js中的配置参数类型和格式
 */
import config from '../liteStore.config';

/**
 * 配置验证结果接口
 */
export interface ConfigValidationResult {
  /**
   * 是否通过验证
   */
  isValid: boolean;
  /**
   * 错误消息列表
   */
  errors: string[];
  /**
   * 警告消息列表
   */
  warnings: string[];
}

/**
 * 配置验证工具类
 */
export class ConfigValidator {
  /**
   * 验证所有配置参数
   * @returns 验证结果
   */
  static validateAll(): ConfigValidationResult {
    const result: ConfigValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // 验证基础配置
    this.validateBasicConfig(result);

    // 验证加密配置
    this.validateEncryptionConfig(result);

    // 验证性能配置
    this.validatePerformanceConfig(result);

    // 验证缓存配置
    this.validateCacheConfig(result);



    // 验证监控配置
    this.validateMonitoringConfig(result);

    return result;
  }

  /**
   * 验证基础配置
   * @param result 验证结果对象
   */
  private static validateBasicConfig(result: ConfigValidationResult): void {
    // 验证chunkSize
    if (config.chunkSize !== undefined) {
      if (typeof config.chunkSize !== 'number') {
        result.errors.push('chunkSize must be a number');
        result.isValid = false;
      } else if (config.chunkSize <= 0) {
        result.errors.push('chunkSize must be greater than 0');
        result.isValid = false;
      }
    }

    // 验证storageFolder
    if (config.storageFolder !== undefined) {
      if (typeof config.storageFolder !== 'string') {
        result.errors.push('storageFolder must be a string');
        result.isValid = false;
      }
    }

    // 验证sortMethods
    if (config.sortMethods !== undefined) {
      if (typeof config.sortMethods !== 'string') {
        result.errors.push('sortMethods must be a string');
        result.isValid = false;
      } else {
        const validSortMethods = ['default', 'fast', 'counting', 'merge', 'slow'];
        if (!validSortMethods.includes(config.sortMethods)) {
          result.warnings.push(`sortMethods should be one of ${validSortMethods.join(', ')}`);
        }
      }
    }

    // 验证timeout
    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number') {
        result.errors.push('timeout must be a number');
        result.isValid = false;
      } else if (config.timeout <= 0) {
        result.errors.push('timeout must be greater than 0');
        result.isValid = false;
      }
    }
  }

  /**
   * 验证加密配置
   * @param result 验证结果对象
   */
  private static validateEncryptionConfig(result: ConfigValidationResult): void {
    const encryption = config.encryption;
    if (encryption) {
      // 验证algorithm
      if (encryption.algorithm !== undefined) {
        if (typeof encryption.algorithm !== 'string') {
          result.errors.push('encryption.algorithm must be a string');
          result.isValid = false;
        } else {
          const validAlgorithms = ['AES-CTR'];
          if (!validAlgorithms.includes(encryption.algorithm)) {
            result.warnings.push(`encryption.algorithm should be one of ${validAlgorithms.join(', ')}`);
          }
        }
      }

      // 验证keySize
      if (encryption.keySize !== undefined) {
        if (typeof encryption.keySize !== 'number') {
          result.errors.push('encryption.keySize must be a number');
          result.isValid = false;
        } else {
          const validKeySizes = [256];
          if (!validKeySizes.includes(encryption.keySize)) {
            result.warnings.push(`encryption.keySize should be one of ${validKeySizes.join(', ')}`);
          }
        }
      }

      // 验证hmacAlgorithm
      if (encryption.hmacAlgorithm !== undefined) {
        if (typeof encryption.hmacAlgorithm !== 'string') {
          result.errors.push('encryption.hmacAlgorithm must be a string');
          result.isValid = false;
        } else {
          const validHmacAlgorithms = ['SHA-256', 'SHA-512'];
          if (!validHmacAlgorithms.includes(encryption.hmacAlgorithm)) {
            result.warnings.push(`encryption.hmacAlgorithm should be one of ${validHmacAlgorithms.join(', ')}`);
          }
        }
      }

      // 验证keyIterations
      if (encryption.keyIterations !== undefined) {
        if (typeof encryption.keyIterations !== 'number') {
          result.errors.push('encryption.keyIterations must be a number');
          result.isValid = false;
        } else if (encryption.keyIterations < 10000 || encryption.keyIterations > 1000000) {
          result.warnings.push(
            'encryption.keyIterations should be between 10000 and 1000000 for optimal security and performance'
          );
        }
      }

      // 验证enableFieldLevelEncryption
      if (encryption.enableFieldLevelEncryption !== undefined) {
        if (typeof encryption.enableFieldLevelEncryption !== 'boolean') {
          result.errors.push('encryption.enableFieldLevelEncryption must be a boolean');
          result.isValid = false;
        }
      }

      // 验证encryptedFields
      if (encryption.encryptedFields !== undefined) {
        if (!Array.isArray(encryption.encryptedFields)) {
          result.errors.push('encryption.encryptedFields must be an array');
          result.isValid = false;
        } else {
          // 验证数组元素是否都是字符串
          for (const field of encryption.encryptedFields) {
            if (typeof field !== 'string') {
              result.errors.push('encryption.encryptedFields must contain only strings');
              result.isValid = false;
              break;
            }
          }
        }
      }

      // 验证cacheTimeout
      if (encryption.cacheTimeout !== undefined) {
        if (typeof encryption.cacheTimeout !== 'number') {
          result.errors.push('encryption.cacheTimeout must be a number');
          result.isValid = false;
        } else if (encryption.cacheTimeout < 0) {
          result.errors.push('encryption.cacheTimeout must be greater than or equal to 0');
          result.isValid = false;
        }
      }

      // 验证maxCacheSize
      if (encryption.maxCacheSize !== undefined) {
        if (typeof encryption.maxCacheSize !== 'number') {
          result.errors.push('encryption.maxCacheSize must be a number');
          result.isValid = false;
        } else if (encryption.maxCacheSize < 0) {
          result.errors.push('encryption.maxCacheSize must be greater than or equal to 0');
          result.isValid = false;
        }
      }

      // 验证useBulkOperations
      if (encryption.useBulkOperations !== undefined) {
        if (typeof encryption.useBulkOperations !== 'boolean') {
          result.errors.push('encryption.useBulkOperations must be a boolean');
          result.isValid = false;
        }
      }
    }
  }

  /**
   * 验证性能配置
   * @param result 验证结果对象
   */
  private static validatePerformanceConfig(result: ConfigValidationResult): void {
    const performance = config.performance;
    if (performance) {
      // 验证enableQueryOptimization
      if (performance.enableQueryOptimization !== undefined) {
        if (typeof performance.enableQueryOptimization !== 'boolean') {
          result.errors.push('performance.enableQueryOptimization must be a boolean');
          result.isValid = false;
        }
      }

      // 验证maxConcurrentOperations
      if (performance.maxConcurrentOperations !== undefined) {
        if (typeof performance.maxConcurrentOperations !== 'number') {
          result.errors.push('performance.maxConcurrentOperations must be a number');
          result.isValid = false;
        } else if (performance.maxConcurrentOperations < 1) {
          result.errors.push('performance.maxConcurrentOperations must be greater than 0');
          result.isValid = false;
        } else if (performance.maxConcurrentOperations > 100) {
          result.warnings.push('performance.maxConcurrentOperations should be less than or equal to 100');
        }
      }

      // 验证enableBatchOptimization
      if (performance.enableBatchOptimization !== undefined) {
        if (typeof performance.enableBatchOptimization !== 'boolean') {
          result.errors.push('performance.enableBatchOptimization must be a boolean');
          result.isValid = false;
        }
      }

      // 验证memoryWarningThreshold
      if (performance.memoryWarningThreshold !== undefined) {
        if (typeof performance.memoryWarningThreshold !== 'number') {
          result.errors.push('performance.memoryWarningThreshold must be a number');
          result.isValid = false;
        } else if (performance.memoryWarningThreshold <= 0 || performance.memoryWarningThreshold > 1) {
          result.errors.push('performance.memoryWarningThreshold must be between 0 and 1');
          result.isValid = false;
        }
      }
    }
  }

  /**
   * 验证缓存配置
   * @param result 验证结果对象
   */
  private static validateCacheConfig(result: ConfigValidationResult): void {
    const cache = config.cache;
    if (cache) {
      // 验证maxSize
      if (cache.maxSize !== undefined) {
        if (typeof cache.maxSize !== 'number') {
          result.errors.push('cache.maxSize must be a number');
          result.isValid = false;
        } else if (cache.maxSize < 0) {
          result.errors.push('cache.maxSize must be greater than or equal to 0');
          result.isValid = false;
        } else if (cache.maxSize > 10000) {
          result.warnings.push('cache.maxSize should be less than or equal to 10000');
        }
      }

      // 验证defaultExpiry
      if (cache.defaultExpiry !== undefined) {
        if (typeof cache.defaultExpiry !== 'number') {
          result.errors.push('cache.defaultExpiry must be a number');
          result.isValid = false;
        } else if (cache.defaultExpiry < 0) {
          result.errors.push('cache.defaultExpiry must be greater than or equal to 0');
          result.isValid = false;
        }
      }

      // 验证enableCompression
      if (cache.enableCompression !== undefined) {
        if (typeof cache.enableCompression !== 'boolean') {
          result.errors.push('cache.enableCompression must be a boolean');
          result.isValid = false;
        }
      }

      // 验证cleanupInterval
      if (cache.cleanupInterval !== undefined) {
        if (typeof cache.cleanupInterval !== 'number') {
          result.errors.push('cache.cleanupInterval must be a number');
          result.isValid = false;
        } else if (cache.cleanupInterval < 0) {
          result.errors.push('cache.cleanupInterval must be greater than or equal to 0');
          result.isValid = false;
        }
      }
    }
  }



  /**
   * 验证监控配置
   * @param result 验证结果对象
   */
  private static validateMonitoringConfig(result: ConfigValidationResult): void {
    const monitoring = config.monitoring;
    if (monitoring) {
      // 验证enablePerformanceTracking
      if (monitoring.enablePerformanceTracking !== undefined) {
        if (typeof monitoring.enablePerformanceTracking !== 'boolean') {
          result.errors.push('monitoring.enablePerformanceTracking must be a boolean');
          result.isValid = false;
        }
      }

      // 验证enableHealthChecks
      if (monitoring.enableHealthChecks !== undefined) {
        if (typeof monitoring.enableHealthChecks !== 'boolean') {
          result.errors.push('monitoring.enableHealthChecks must be a boolean');
          result.isValid = false;
        }
      }

      // 验证metricsRetention
      if (monitoring.metricsRetention !== undefined) {
        if (typeof monitoring.metricsRetention !== 'number') {
          result.errors.push('monitoring.metricsRetention must be a number');
          result.isValid = false;
        } else if (monitoring.metricsRetention < 0) {
          result.errors.push('monitoring.metricsRetention must be greater than or equal to 0');
          result.isValid = false;
        }
      }
    }
  }

  /**
   * 自动修复无效配置
   * @returns 修复后的配置对象
   */
  static autoFix(): any {
    // 直接修改全局配置对象
    // 自动修复基础配置
    this.autoFixBasicConfig(config);

    // 自动修复加密配置
    this.autoFixEncryptionConfig(config);

    // 自动修复性能配置
    this.autoFixPerformanceConfig(config);

    // 自动修复缓存配置
    this.autoFixCacheConfig(config);

    // 自动修复API配置
    this.autoFixApiConfig(config);

    // 自动修复监控配置
    this.autoFixMonitoringConfig(config);

    return config;
  }

  /**
   * 自动修复基础配置
   * @param config 配置对象
   */
  private static autoFixBasicConfig(config: any): void {
    if (typeof config.chunkSize !== 'number' || config.chunkSize <= 0) {
      config.chunkSize = 5 * 1024 * 1024; // 默认5MB
    }

    if (typeof config.storageFolder !== 'string') {
      config.storageFolder = 'expo-litedatastore';
    }

    const validSortMethods = ['default', 'fast', 'counting', 'merge', 'slow'];
    if (typeof config.sortMethods !== 'string' || !validSortMethods.includes(config.sortMethods)) {
      config.sortMethods = 'default';
    }

    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      config.timeout = 10000; // 默认10秒
    }
  }

  /**
   * 自动修复加密配置
   * @param config 配置对象
   */
  private static autoFixEncryptionConfig(config: any): void {
    if (!config.encryption) {
      config.encryption = {};
    }

    if (typeof config.encryption.algorithm !== 'string' || !['AES-CTR'].includes(config.encryption.algorithm)) {
      config.encryption.algorithm = 'AES-CTR';
    }

    if (typeof config.encryption.keySize !== 'number' || config.encryption.keySize !== 256) {
      config.encryption.keySize = 256;
    }

    if (
      typeof config.encryption.hmacAlgorithm !== 'string' ||
      !['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)
    ) {
      config.encryption.hmacAlgorithm = 'SHA-512';
    }

    if (
      typeof config.encryption.keyIterations !== 'number' ||
      config.encryption.keyIterations < 10000 ||
      config.encryption.keyIterations > 1000000
    ) {
      config.encryption.keyIterations = 120000;
    }

    if (typeof config.encryption.enableFieldLevelEncryption !== 'boolean') {
      config.encryption.enableFieldLevelEncryption = true;
    }

    if (!Array.isArray(config.encryption.encryptedFields)) {
      config.encryption.encryptedFields = ['password', 'email', 'phone'];
    }

    if (typeof config.encryption.cacheTimeout !== 'number' || config.encryption.cacheTimeout < 0) {
      config.encryption.cacheTimeout = 30000;
    }

    if (typeof config.encryption.maxCacheSize !== 'number' || config.encryption.maxCacheSize < 0) {
      config.encryption.maxCacheSize = 50;
    }

    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      config.encryption.useBulkOperations = true;
    }
  }

  /**
   * 自动修复性能配置
   * @param config 配置对象
   */
  private static autoFixPerformanceConfig(config: any): void {
    if (!config.performance) {
      config.performance = {};
    }

    if (typeof config.performance.enableQueryOptimization !== 'boolean') {
      config.performance.enableQueryOptimization = true;
    }

    if (
      typeof config.performance.maxConcurrentOperations !== 'number' ||
      config.performance.maxConcurrentOperations < 1
    ) {
      config.performance.maxConcurrentOperations = 5;
    }

    if (typeof config.performance.enableBatchOptimization !== 'boolean') {
      config.performance.enableBatchOptimization = true;
    }

    if (
      typeof config.performance.memoryWarningThreshold !== 'number' ||
      config.performance.memoryWarningThreshold <= 0 ||
      config.performance.memoryWarningThreshold > 1
    ) {
      config.performance.memoryWarningThreshold = 0.8;
    }
  }

  /**
   * 自动修复缓存配置
   * @param config 配置对象
   */
  private static autoFixCacheConfig(config: any): void {
    if (!config.cache) {
      config.cache = {};
    }

    if (typeof config.cache.maxSize !== 'number' || config.cache.maxSize < 0 || config.cache.maxSize > 10000) {
      config.cache.maxSize = 1000;
    }

    if (typeof config.cache.defaultExpiry !== 'number' || config.cache.defaultExpiry < 0) {
      config.cache.defaultExpiry = 3600000; // 默认1小时
    }

    if (typeof config.cache.enableCompression !== 'boolean') {
      config.cache.enableCompression = false;
    }

    if (typeof config.cache.cleanupInterval !== 'number' || config.cache.cleanupInterval < 0) {
      config.cache.cleanupInterval = 300000; // 默认5分钟
    }
  }

  /**
   * 自动修复API配置
   * @param config 配置对象
   */
  private static autoFixApiConfig(config: any): void {
    if (!config.api) {
      config.api = {};
    }

    if (!config.api.rateLimit) {
      config.api.rateLimit = {};
    }

    if (typeof config.api.rateLimit.enabled !== 'boolean') {
      config.api.rateLimit.enabled = true;
    }

    if (
      typeof config.api.rateLimit.requestsPerSecond !== 'number' ||
      config.api.rateLimit.requestsPerSecond < 1 ||
      config.api.rateLimit.requestsPerSecond > 1000
    ) {
      config.api.rateLimit.requestsPerSecond = 20;
    }

    if (typeof config.api.rateLimit.burstCapacity !== 'number' || config.api.rateLimit.burstCapacity < 1) {
      config.api.rateLimit.burstCapacity = 40;
    }

    if (!config.api.retry) {
      config.api.retry = {};
    }

    if (typeof config.api.retry.maxAttempts !== 'number' || config.api.retry.maxAttempts < 1) {
      config.api.retry.maxAttempts = 3;
    }

    if (typeof config.api.retry.backoffMultiplier !== 'number' || config.api.retry.backoffMultiplier < 1) {
      config.api.retry.backoffMultiplier = 2;
    }
  }

  /**
   * 自动修复监控配置
   * @param config 配置对象
   */
  private static autoFixMonitoringConfig(config: any): void {
    if (!config.monitoring) {
      config.monitoring = {};
    }

    if (typeof config.monitoring.enablePerformanceTracking !== 'boolean') {
      config.monitoring.enablePerformanceTracking = true;
    }

    if (typeof config.monitoring.enableHealthChecks !== 'boolean') {
      config.monitoring.enableHealthChecks = true;
    }

    if (typeof config.monitoring.metricsRetention !== 'number' || config.monitoring.metricsRetention < 0) {
      config.monitoring.metricsRetention = 86400000; // 默认24小时
    }
  }
}

/**
 * 导出默认配置验证结果
 */
export const configValidationResult = ConfigValidator.validateAll();

/**
 * 导出修复后的配置
 */
export const fixedConfig = ConfigValidator.autoFix();
