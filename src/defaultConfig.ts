/**
 * @module defaultConfig
 * @description Default configuration for expo-lite-data-store
 * @since 2025-11-19
 * @version 1.0.0
 */

import { LiteStoreConfig } from './types/config';

export default {
  /**
   * Basic Configuration
   */
  chunkSize: 5 * 1024 * 1024, // 5MB per chunk
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
    algorithm: 'auto' as const,
    keySize: 256,
    hmacAlgorithm: 'SHA-512' as const,
    keyIterations: 600000,
    encryptedFields: ['password', 'email', 'phone'],
    cacheTimeout: 30000,
    maxCacheSize: 100,
    useBulkOperations: true,
    autoSelectHMAC: true,
  },

  performance: {
    enableQueryOptimization: true,
    maxConcurrentOperations: 5, // Recommended range: 3-10, adjust by device performance
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
    enablePerformanceTracking: false, // Not fully supported yet
    enableHealthChecks: true, // Enable to improve performance and stability
    metricsRetention: 86400000, // 24小时
  },

  autoSync: {
    enabled: true,
    interval: 30000,
    minItems: 1,
    batchSize: 100,
  },
} as const satisfies LiteStoreConfig;
