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
    autoSelectHMAC?: boolean;
  };

  /** 性能配置 */
  performance: {
    enableQueryOptimization: boolean;
    maxConcurrentOperations: number; // 推荐范围：3-10，根据设备性能调整
    enableBatchOptimization: boolean;
    memoryWarningThreshold: number;
  };

  /** 缓存配置 */
  cache: {
    maxSize: number;
    defaultExpiry: number;
    cleanupInterval: number;
    memoryWarningThreshold: number;
  };

  /** 监控配置 */
  monitoring: {
    enablePerformanceTracking: boolean; // 暂未完全支持
    enableHealthChecks: boolean; // 启用可提升性能和稳定性
    metricsRetention: number; // 24小时
  };

  /** 自动同步配置 */
  autoSync?: {
    enabled?: boolean;
    interval?: number;
    minItems?: number;
    batchSize?: number;
  };
  
  /** API配置 */
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
