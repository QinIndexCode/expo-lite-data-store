/**
 * @module config
 * @description Configuration type definitions for LiteStore
 * @since 2025-11-19
 * @version 1.0.0
 */

/**
 * Deep partial type that makes all nested properties optional
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * LiteStore configuration interface
 */
export interface LiteStoreConfig {
  /** Basic configuration */
  chunkSize: number;
  storageFolder: string;
  sortMethods: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  timeout: number;

  /** Encryption configuration */
  encryption: {
    algorithm: 'AES-CTR' | 'AES-GCM' | 'auto';
    keySize: 256;
    hmacAlgorithm: 'SHA-256' | 'SHA-512';
    keyIterations: number;
    encryptedFields?: string[];
    cacheTimeout: number;
    maxCacheSize: number;
    useBulkOperations: boolean;
    autoSelectHMAC?: boolean;
  };

  /** Performance configuration */
  performance: {
    enableQueryOptimization: boolean;
    maxConcurrentOperations: number;
    enableBatchOptimization: boolean;
    memoryWarningThreshold: number;
  };

  /** Cache configuration */
  cache: {
    maxSize: number;
    defaultExpiry: number;
    cleanupInterval: number;
    memoryWarningThreshold: number;
  };

  /** Monitoring configuration */
  monitoring: {
    enablePerformanceTracking: boolean;
    enableHealthChecks: boolean;
    metricsRetention: number;
  };

  /** Auto-sync configuration */
  autoSync?: {
    enabled?: boolean;
    interval?: number;
    minItems?: number;
    batchSize?: number;
  };

  /** API configuration */
  api: {
    rateLimit: {
      enabled: boolean;
      requestsPerSecond: number;
      burstCapacity: number;
    };
    retry: {
      maxAttempts: number;
      backoffMultiplier: number;
    };
  };
}
