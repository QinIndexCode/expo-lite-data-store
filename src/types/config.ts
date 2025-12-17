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
    enableFieldLevelEncryption?: boolean;
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
    /** 自动同步配置 */
    autoSync?: {
      /** 是否启用自动同步 */
      enabled: boolean;
      /** 同步间隔（毫秒） */
      interval: number;
      /** 最小同步项数量 */
      minItems: number;
      /** 批量大小限制 */
      batchSize: number;
    };
  };



  /** 监控配置 */
  monitoring: {
    enablePerformanceTracking: boolean;
    enableHealthChecks: boolean;
    metricsRetention: number;
  };
}
