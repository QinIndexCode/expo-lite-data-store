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
  engine?: 'file-system' | 'sqlite' | 'auto';

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
    /** Reserved: no runtime consumer reads this key, so it currently has no effect. */
    enableQueryOptimization: boolean;
    maxConcurrentOperations: number;
    /** Reserved: no runtime consumer reads this key, so it currently has no effect. */
    enableBatchOptimization: boolean;
    /**
     * Reserved: memory warnings use `cache.memoryWarningThreshold`. This key has
     * no runtime consumer, so it currently has no effect.
     */
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
    /** Reserved: no runtime path enforces rate limiting, so these values currently have no effect. */
    rateLimit: {
      enabled: boolean;
      requestsPerSecond: number;
      burstCapacity: number;
    };
    /**
     * Reserved retry policy. Not yet consumed by the runtime: no automatic
     * retries are performed, so changing these values currently has no effect
     * on API traffic.
     */
    retry: {
      maxAttempts: number;
      backoffMultiplier: number;
    };
  };
}
