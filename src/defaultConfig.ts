/**
 * Default Configuration for expo-lite-data-store
 * This file contains the default configuration values
 */

import { LiteStoreConfig } from './types/config';

export default {
  /**
   * Basic Configuration
   */
  chunkSize: 10 * 1024 * 1024, // 10MB per chunk
  storageFolder: 'lite-data-store',
  sortMethods: 'default' as const,
  timeout: 10000,

  /**
   * API Configuration
   */
  api: {
    rateLimit: { 
      enabled: false,
      requestsPerSecond: 10,
      burstCapacity: 20,
    },
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
    },
  },

  encryption: {
    algorithm: 'AES-CTR' as const,
    keySize: 256,
    hmacAlgorithm: 'SHA-512' as const,
    keyIterations: 5000,
    encryptedFields: ['password', 'email', 'phone'],
    cacheTimeout: 30000,
    maxCacheSize: 50,
    useBulkOperations: true,
    autoSelectHMAC: true,
  },

  performance: {
    enableQueryOptimization: true,
    maxConcurrentOperations: 5, // 推荐范围：3-10，根据设备性能调整
    enableBatchOptimization: true,
    memoryWarningThreshold: 0.8,
  },

  cache: {
    maxSize: 1000,
    defaultExpiry: 3600000,
    cleanupInterval: 300000,
    memoryWarningThreshold: 0.8,
  },

  monitoring: {
    enablePerformanceTracking: false, // 暂未完全支持
    enableHealthChecks: true, // 启用可提升性能和稳定性
    metricsRetention: 86400000, // 24小时
  },

  autoSync: {
    enabled: true,
    interval: 30000,
    minItems: 1,
    batchSize: 100,
  },
} as const satisfies LiteStoreConfig;