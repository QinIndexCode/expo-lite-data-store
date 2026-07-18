import { configManager } from '../core/config/ConfigManager';
import defaultConfig from '../defaultConfig';
import type { DeepPartial, LiteStoreConfig } from '../types/config';
import { isValidStorageFolderName } from './PathHelper';

type ConfigDraft = DeepPartial<LiteStoreConfig>;

const VALID_SORT_METHODS = ['default', 'fast', 'counting', 'merge', 'slow'] as const;
const VALID_ENCRYPTION_ALGORITHMS = ['auto', 'AES-GCM', 'AES-CTR'] as const;
const VALID_HMAC_ALGORITHMS = ['SHA-256', 'SHA-512'] as const;

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigValidator {
  static validateAll(): ConfigValidationResult {
    const result: ConfigValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    const config = configManager.getConfig();

    this.validateBasicConfig(config, result);
    this.validateEncryptionConfig(config, result);
    this.validatePerformanceConfig(config, result);
    this.validateCacheConfig(config, result);
    this.validateApiConfig(config, result);
    this.validateAutoSyncConfig(config, result);
    this.validateMonitoringConfig(config, result);

    return result;
  }

  private static validateBasicConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    if (config.chunkSize !== undefined) {
      if (typeof config.chunkSize !== 'number') {
        result.errors.push('chunkSize must be a number');
        result.isValid = false;
      } else if (config.chunkSize <= 0) {
        result.errors.push('chunkSize must be greater than 0');
        result.isValid = false;
      }
    }

    if (config.storageFolder !== undefined) {
      if (!isValidStorageFolderName(config.storageFolder)) {
        result.errors.push('storageFolder must be one non-empty directory name without path separators or traversal');
        result.isValid = false;
      }
    }

    if (config.sortMethods !== undefined) {
      if (typeof config.sortMethods !== 'string') {
        result.errors.push('sortMethods must be a string');
        result.isValid = false;
      } else {
        if (!VALID_SORT_METHODS.includes(config.sortMethods)) {
          result.warnings.push(`sortMethods should be one of ${VALID_SORT_METHODS.join(', ')}`);
        }
      }
    }

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

  private static validateEncryptionConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const encryption = config.encryption;
    if (encryption) {
      if (encryption.algorithm !== undefined) {
        if (typeof encryption.algorithm !== 'string') {
          result.errors.push('encryption.algorithm must be a string');
          result.isValid = false;
        } else {
          if (!VALID_ENCRYPTION_ALGORITHMS.includes(encryption.algorithm)) {
            result.warnings.push(`encryption.algorithm should be one of ${VALID_ENCRYPTION_ALGORITHMS.join(', ')}`);
          }
        }
      }

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

      if (encryption.hmacAlgorithm !== undefined) {
        if (typeof encryption.hmacAlgorithm !== 'string') {
          result.errors.push('encryption.hmacAlgorithm must be a string');
          result.isValid = false;
        } else {
          if (!VALID_HMAC_ALGORITHMS.includes(encryption.hmacAlgorithm)) {
            result.warnings.push(`encryption.hmacAlgorithm should be one of ${VALID_HMAC_ALGORITHMS.join(', ')}`);
          }
        }
      }

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

      if (encryption.encryptedFields !== undefined) {
        if (!Array.isArray(encryption.encryptedFields)) {
          result.errors.push('encryption.encryptedFields must be an array');
          result.isValid = false;
        } else {
          for (const field of encryption.encryptedFields) {
            if (typeof field !== 'string') {
              result.errors.push('encryption.encryptedFields must contain only strings');
              result.isValid = false;
              break;
            }
          }
        }
      }

      if (encryption.cacheTimeout !== undefined) {
        if (typeof encryption.cacheTimeout !== 'number') {
          result.errors.push('encryption.cacheTimeout must be a number');
          result.isValid = false;
        } else if (encryption.cacheTimeout < 0) {
          result.errors.push('encryption.cacheTimeout must be greater than or equal to 0');
          result.isValid = false;
        }
      }

      if (encryption.maxCacheSize !== undefined) {
        if (typeof encryption.maxCacheSize !== 'number') {
          result.errors.push('encryption.maxCacheSize must be a number');
          result.isValid = false;
        } else if (encryption.maxCacheSize < 0) {
          result.errors.push('encryption.maxCacheSize must be greater than or equal to 0');
          result.isValid = false;
        }
      }

      if (encryption.useBulkOperations !== undefined) {
        if (typeof encryption.useBulkOperations !== 'boolean') {
          result.errors.push('encryption.useBulkOperations must be a boolean');
          result.isValid = false;
        }
      }
    }
  }

  private static validatePerformanceConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const performance = config.performance;
    if (performance) {
      if (performance.enableQueryOptimization !== undefined) {
        if (typeof performance.enableQueryOptimization !== 'boolean') {
          result.errors.push('performance.enableQueryOptimization must be a boolean');
          result.isValid = false;
        }
      }

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

      if (performance.enableBatchOptimization !== undefined) {
        if (typeof performance.enableBatchOptimization !== 'boolean') {
          result.errors.push('performance.enableBatchOptimization must be a boolean');
          result.isValid = false;
        }
      }

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

  private static validateCacheConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const cache = config.cache;
    if (cache) {
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

      if (cache.defaultExpiry !== undefined) {
        if (typeof cache.defaultExpiry !== 'number') {
          result.errors.push('cache.defaultExpiry must be a number');
          result.isValid = false;
        } else if (cache.defaultExpiry < 0) {
          result.errors.push('cache.defaultExpiry must be greater than or equal to 0');
          result.isValid = false;
        }
      }

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

  private static validateApiConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const rateLimit = config.api?.rateLimit;
    if (rateLimit) {
      if (rateLimit.enabled !== undefined && typeof rateLimit.enabled !== 'boolean') {
        result.errors.push('api.rateLimit.enabled must be a boolean');
        result.isValid = false;
      }

      if (rateLimit.requestsPerSecond !== undefined) {
        if (typeof rateLimit.requestsPerSecond !== 'number') {
          result.errors.push('api.rateLimit.requestsPerSecond must be a number');
          result.isValid = false;
        } else if (rateLimit.requestsPerSecond < 1) {
          result.errors.push('api.rateLimit.requestsPerSecond must be greater than 0');
          result.isValid = false;
        } else if (rateLimit.requestsPerSecond > 1000) {
          result.warnings.push('api.rateLimit.requestsPerSecond should be less than or equal to 1000');
        }
      }

      if (rateLimit.burstCapacity !== undefined) {
        if (typeof rateLimit.burstCapacity !== 'number') {
          result.errors.push('api.rateLimit.burstCapacity must be a number');
          result.isValid = false;
        } else if (rateLimit.burstCapacity < 1) {
          result.errors.push('api.rateLimit.burstCapacity must be greater than 0');
          result.isValid = false;
        }
      }
    }

    const retry = config.api?.retry;
    if (retry) {
      if (retry.maxAttempts !== undefined) {
        if (typeof retry.maxAttempts !== 'number') {
          result.errors.push('api.retry.maxAttempts must be a number');
          result.isValid = false;
        } else if (retry.maxAttempts < 1) {
          result.errors.push('api.retry.maxAttempts must be greater than 0');
          result.isValid = false;
        }
      }

      if (retry.backoffMultiplier !== undefined) {
        if (typeof retry.backoffMultiplier !== 'number') {
          result.errors.push('api.retry.backoffMultiplier must be a number');
          result.isValid = false;
        } else if (retry.backoffMultiplier < 1) {
          result.errors.push('api.retry.backoffMultiplier must be greater than or equal to 1');
          result.isValid = false;
        }
      }
    }
  }

  private static validateAutoSyncConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const autoSync = config.autoSync;
    if (!autoSync) {
      return;
    }

    if (autoSync.enabled !== undefined && typeof autoSync.enabled !== 'boolean') {
      result.errors.push('autoSync.enabled must be a boolean');
      result.isValid = false;
    }

    if (autoSync.interval !== undefined) {
      if (typeof autoSync.interval !== 'number') {
        result.errors.push('autoSync.interval must be a number');
        result.isValid = false;
      } else if (autoSync.interval <= 0) {
        result.errors.push('autoSync.interval must be greater than 0');
        result.isValid = false;
      }
    }

    if (autoSync.minItems !== undefined) {
      if (typeof autoSync.minItems !== 'number') {
        result.errors.push('autoSync.minItems must be a number');
        result.isValid = false;
      } else if (autoSync.minItems < 0) {
        result.errors.push('autoSync.minItems must be greater than or equal to 0');
        result.isValid = false;
      }
    }

    if (autoSync.batchSize !== undefined) {
      if (typeof autoSync.batchSize !== 'number') {
        result.errors.push('autoSync.batchSize must be a number');
        result.isValid = false;
      } else if (autoSync.batchSize < 1) {
        result.errors.push('autoSync.batchSize must be greater than 0');
        result.isValid = false;
      }
    }
  }

  private static validateMonitoringConfig(config: ConfigDraft, result: ConfigValidationResult): void {
    const monitoring = config.monitoring;
    if (monitoring) {
      if (monitoring.enablePerformanceTracking !== undefined) {
        if (typeof monitoring.enablePerformanceTracking !== 'boolean') {
          result.errors.push('monitoring.enablePerformanceTracking must be a boolean');
          result.isValid = false;
        }
      }

      if (monitoring.enableHealthChecks !== undefined) {
        if (typeof monitoring.enableHealthChecks !== 'boolean') {
          result.errors.push('monitoring.enableHealthChecks must be a boolean');
          result.isValid = false;
        }
      }

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

  /** Replaces invalid current configuration values with defaults and persists the result. */
  static autoFix(): LiteStoreConfig {
    const config: ConfigDraft = configManager.getConfig();

    this.autoFixBasicConfig(config);
    this.autoFixEncryptionConfig(config);
    this.autoFixPerformanceConfig(config);
    this.autoFixCacheConfig(config);
    this.autoFixApiConfig(config);
    this.autoFixAutoSyncConfig(config);
    this.autoFixMonitoringConfig(config);

    configManager.setConfig(config);

    return configManager.getConfig();
  }

  private static autoFixBasicConfig(config: ConfigDraft): void {
    if (typeof config.chunkSize !== 'number' || config.chunkSize <= 0) {
      config.chunkSize = defaultConfig.chunkSize;
    }

    if (!isValidStorageFolderName(config.storageFolder)) {
      config.storageFolder = defaultConfig.storageFolder;
    }

    if (typeof config.sortMethods !== 'string' || !VALID_SORT_METHODS.includes(config.sortMethods)) {
      config.sortMethods = defaultConfig.sortMethods;
    }

    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      config.timeout = defaultConfig.timeout;
    }
  }

  private static autoFixEncryptionConfig(config: ConfigDraft): void {
    if (!config.encryption) {
      config.encryption = {};
    }

    if (
      typeof config.encryption.algorithm !== 'string' ||
      !VALID_ENCRYPTION_ALGORITHMS.includes(config.encryption.algorithm)
    ) {
      config.encryption.algorithm = defaultConfig.encryption.algorithm;
    }

    if (typeof config.encryption.keySize !== 'number' || config.encryption.keySize !== 256) {
      config.encryption.keySize = defaultConfig.encryption.keySize;
    }

    if (
      typeof config.encryption.hmacAlgorithm !== 'string' ||
      !VALID_HMAC_ALGORITHMS.includes(config.encryption.hmacAlgorithm)
    ) {
      config.encryption.hmacAlgorithm = defaultConfig.encryption.hmacAlgorithm;
    }

    if (
      typeof config.encryption.keyIterations !== 'number' ||
      config.encryption.keyIterations < 10000 ||
      config.encryption.keyIterations > 1000000
    ) {
      config.encryption.keyIterations = defaultConfig.encryption.keyIterations;
    }

    if (
      !Array.isArray(config.encryption.encryptedFields) ||
      config.encryption.encryptedFields.some(field => typeof field !== 'string')
    ) {
      config.encryption.encryptedFields = [...defaultConfig.encryption.encryptedFields];
    }

    if (typeof config.encryption.cacheTimeout !== 'number' || config.encryption.cacheTimeout < 0) {
      config.encryption.cacheTimeout = defaultConfig.encryption.cacheTimeout;
    }

    if (typeof config.encryption.maxCacheSize !== 'number' || config.encryption.maxCacheSize < 0) {
      config.encryption.maxCacheSize = defaultConfig.encryption.maxCacheSize;
    }

    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      config.encryption.useBulkOperations = defaultConfig.encryption.useBulkOperations;
    }
  }

  private static autoFixPerformanceConfig(config: ConfigDraft): void {
    if (!config.performance) {
      config.performance = {};
    }

    if (typeof config.performance.enableQueryOptimization !== 'boolean') {
      config.performance.enableQueryOptimization = defaultConfig.performance.enableQueryOptimization;
    }

    if (
      typeof config.performance.maxConcurrentOperations !== 'number' ||
      config.performance.maxConcurrentOperations < 1
    ) {
      config.performance.maxConcurrentOperations = defaultConfig.performance.maxConcurrentOperations;
    }

    if (typeof config.performance.enableBatchOptimization !== 'boolean') {
      config.performance.enableBatchOptimization = defaultConfig.performance.enableBatchOptimization;
    }

    if (
      typeof config.performance.memoryWarningThreshold !== 'number' ||
      config.performance.memoryWarningThreshold <= 0 ||
      config.performance.memoryWarningThreshold > 1
    ) {
      config.performance.memoryWarningThreshold = defaultConfig.performance.memoryWarningThreshold;
    }
  }

  private static autoFixCacheConfig(config: ConfigDraft): void {
    if (!config.cache) {
      config.cache = {};
    }

    if (typeof config.cache.maxSize !== 'number' || config.cache.maxSize < 0 || config.cache.maxSize > 10000) {
      config.cache.maxSize = defaultConfig.cache.maxSize;
    }

    if (typeof config.cache.defaultExpiry !== 'number' || config.cache.defaultExpiry < 0) {
      config.cache.defaultExpiry = defaultConfig.cache.defaultExpiry;
    }

    if (typeof config.cache.cleanupInterval !== 'number' || config.cache.cleanupInterval < 0) {
      config.cache.cleanupInterval = defaultConfig.cache.cleanupInterval;
    }
  }

  private static autoFixApiConfig(config: ConfigDraft): void {
    if (!config.api) {
      config.api = {};
    }

    if (!config.api.rateLimit) {
      config.api.rateLimit = {};
    }

    if (typeof config.api.rateLimit.enabled !== 'boolean') {
      config.api.rateLimit.enabled = defaultConfig.api.rateLimit.enabled;
    }

    if (
      typeof config.api.rateLimit.requestsPerSecond !== 'number' ||
      config.api.rateLimit.requestsPerSecond < 1 ||
      config.api.rateLimit.requestsPerSecond > 1000
    ) {
      config.api.rateLimit.requestsPerSecond = defaultConfig.api.rateLimit.requestsPerSecond;
    }

    if (typeof config.api.rateLimit.burstCapacity !== 'number' || config.api.rateLimit.burstCapacity < 1) {
      config.api.rateLimit.burstCapacity = defaultConfig.api.rateLimit.burstCapacity;
    }

    if (!config.api.retry) {
      config.api.retry = {};
    }

    if (typeof config.api.retry.maxAttempts !== 'number' || config.api.retry.maxAttempts < 1) {
      config.api.retry.maxAttempts = defaultConfig.api.retry.maxAttempts;
    }

    if (typeof config.api.retry.backoffMultiplier !== 'number' || config.api.retry.backoffMultiplier < 1) {
      config.api.retry.backoffMultiplier = defaultConfig.api.retry.backoffMultiplier;
    }
  }

  private static autoFixAutoSyncConfig(config: ConfigDraft): void {
    if (!config.autoSync) {
      config.autoSync = {};
    }

    if (typeof config.autoSync.enabled !== 'boolean') {
      config.autoSync.enabled = defaultConfig.autoSync.enabled;
    }

    if (typeof config.autoSync.interval !== 'number' || config.autoSync.interval <= 0) {
      config.autoSync.interval = defaultConfig.autoSync.interval;
    }

    if (typeof config.autoSync.minItems !== 'number' || config.autoSync.minItems < 0) {
      config.autoSync.minItems = defaultConfig.autoSync.minItems;
    }

    if (typeof config.autoSync.batchSize !== 'number' || config.autoSync.batchSize < 1) {
      config.autoSync.batchSize = defaultConfig.autoSync.batchSize;
    }
  }

  private static autoFixMonitoringConfig(config: ConfigDraft): void {
    if (!config.monitoring) {
      config.monitoring = {};
    }

    if (typeof config.monitoring.enablePerformanceTracking !== 'boolean') {
      config.monitoring.enablePerformanceTracking = defaultConfig.monitoring.enablePerformanceTracking;
    }

    if (typeof config.monitoring.enableHealthChecks !== 'boolean') {
      config.monitoring.enableHealthChecks = defaultConfig.monitoring.enableHealthChecks;
    }

    if (typeof config.monitoring.metricsRetention !== 'number' || config.monitoring.metricsRetention < 0) {
      config.monitoring.metricsRetention = defaultConfig.monitoring.metricsRetention;
    }
  }
}

export const configValidationResult = ConfigValidator.validateAll();
export const fixedConfig = ConfigValidator.autoFix();
