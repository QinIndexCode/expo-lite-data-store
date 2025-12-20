/**
 * 深度Partial类型，使所有嵌套属性都变为可选
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * LiteStore配置类型定义
 */
export interface LiteStoreConfig {
  /** 基础配置 */
  chunkSize: number;
  storageFolder: string;
  sortMethods: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  timeout: number;

  /** 加密配置 */
  encryption: {
    algorithm: 'AES-CTR';
    keySize: 256;
    hmacAlgorithm: 'SHA-256' | 'SHA-512';
    keyIterations: number;
    encryptedFields?: string[];
    cacheTimeout: number;
    maxCacheSize: number;
    useBulkOperations: boolean;
    requireAuthOnAccess?: boolean;
  };

  /** 性能配置 */
  performance: {
    enableQueryOptimization: boolean;
    maxConcurrentOperations: number;
    enableBatchOptimization: boolean;
    memoryWarningThreshold: number;
  };

  /** 缓存配置 */
  cache: {
    maxSize: number;
    defaultExpiry: number;
    enableCompression: boolean;
    cleanupInterval: number;
    memoryWarningThreshold: number;
  };



  /** 监控配置 */
  monitoring: {
    enablePerformanceTracking: boolean;
    enableHealthChecks: boolean;
    metricsRetention: number;
  };

  /** 自动同步配置 */
  autoSync?: {
    enabled?: boolean;
    interval?: number;
    minItems?: number;
    batchSize?: number;
  };
}
