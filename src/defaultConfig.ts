import { LiteStoreConfig } from './types/config';

export default {
  chunkSize: 5 * 1024 * 1024, // 5MB per chunk
  storageFolder: 'lite-data-store',
  sortMethods: 'default' as const,
  timeout: 10000,
  engine: 'file-system' as const,

  api: {
    // Reserved: accepted and validated by the config type, but no runtime path
    // enforces rate limiting, so changing these values has no effect.
    rateLimit: {
      enabled: false,
      requestsPerSecond: 10,
      burstCapacity: 20,
    },
    // Reserved: validated but not consumed at runtime (no retry loop yet).
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
    // Reserved: no runtime consumer reads this key, so toggling it has no effect.
    enableQueryOptimization: true,
    maxConcurrentOperations: 5,
    // Reserved: no runtime consumer reads this key, so toggling it has no effect.
    enableBatchOptimization: true,
    // Reserved: memory warnings use `cache.memoryWarningThreshold`; this key has
    // no runtime consumer, including the LITE_STORE_* environment mapping.
    memoryWarningThreshold: 0.8,
  },

  cache: {
    maxSize: 1000,
    defaultExpiry: 3600000,
    cleanupInterval: 300000,
    memoryWarningThreshold: 0.8,
  },

  monitoring: {
    enablePerformanceTracking: false,
    enableHealthChecks: true,
    metricsRetention: 86400000, // 24h
  },

  autoSync: {
    enabled: false,
    interval: 30000,
    minItems: 1,
    batchSize: 100,
  },
} as const satisfies LiteStoreConfig;
