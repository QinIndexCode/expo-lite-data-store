/**
 * LiteStore 配置文件
 * 用于自定义 LiteStore 的行为
 *
 * 如何使用：
 * 1. 在应用入口文件中导入此配置
 * 2. 使用 setConfig 方法将配置应用到 LiteStore
 *
 * 示例：
 * import { setConfig } from 'expo-lite-data-store';
 * import liteStoreConfig from './liteStore.config';
 *
 * // 在应用启动时设置配置
 * setConfig(liteStoreConfig);
 */
import { LiteStoreConfig } from './node_modules/expo-lite-data-store/dist/types/types/config';

const config: LiteStoreConfig = {
  // 基础配置
  chunkSize: 5 * 1024 * 1024, // 5MB - 分片大小
  storageFolder: 'expo-litedatastore',
  sortMethods: 'default', // fast, counting, merge, slow
  timeout: 10000, // 10s

  // ==================== 加密配置（完整版） ====================
  encryption: {
    // --- 核心加密参数（新增，强烈推荐显式声明）---
    algorithm: 'AES-CTR', // 明确声明使用 CTR 模式（支持并行，适合移动端）
    keySize: 256, // 明确使用 AES-256（最高安全强度）

    // --- HMAC 完整性保护 ---
    hmacAlgorithm: 'SHA-512', // 推荐 SHA-512（抗长度扩展攻击）

    // --- 密钥派生（抗暴力破解）---
    keyIterations: 120_000, // 2025年推荐值：≥120,000

    // --- 字段级加密 ---
    enableFieldLevelEncryption: false, // 暂时禁用，使用完整数据加密
    encryptedFields: [
      // 明确列出需要加密的字段
      'password',
      'email',
      'phone',
      'idCard',
      'bankCard',
      'realName',
      'token',
      'refreshToken',
    ],

    // --- 密钥缓存优化 ---
    cacheTimeout: 30_000, // 30秒后自动清除内存中的 masterKey
    maxCacheSize: 50, // LRU 缓存最多保留50个派生密钥

    // --- 批量操作 ---
    useBulkOperations: true, // 保持开启，性能提升 5~10 倍
  },

  // 性能配置
  performance: {
    enableQueryOptimization: true, // 建议开启！查询优化（索引）
    maxConcurrentOperations: 5, // 最大并发操作数（建议根据设备性能调整）
    enableBatchOptimization: true, // 建议开启！批量操作优化（批量写入/删除）
    memoryWarningThreshold: 0.8, // 80% 内存使用触发警告（建议根据设备性能调整）
  },

  // 缓存配置
  cache: {
    maxSize: 1000,
    defaultExpiry: 3600_000, // 1小时
    enableCompression: false, // 启用缓存数据压缩（建议根据设备性能调整）
    cleanupInterval: 300_000, // 5分钟
    memoryWarningThreshold: 0.8, // 80% 内存使用触发警告
    // 自动同步配置
    autoSync: {
      enabled: true, // 启用自动同步
      interval: 5000, // 5秒同步一次
      minItems: 1, // 至少1个脏项才同步
      batchSize: 100, // 每次最多同步100个项目
    },
  },

  // API配置
  api: {
    rateLimit: {
      enabled: true, // 建议开启！API 速率限制（防止滥用）
      requestsPerSecond: 20, // 建议根据实际场景调整（20-50之间）
      burstCapacity: 40, // 建议根据实际场景调整（40-80之间）
    },
    retry: {
      maxAttempts: 3, // 最大重试次数（建议根据实际场景调整）
      backoffMultiplier: 2, // 建议根据实际场景调整（2-4之间）
    },
  },

  // 监控配置
  monitoring: {
    enablePerformanceTracking: true, // 建议开启！性能跟踪（监控查询性能）
    enableHealthChecks: true, // 建议开启！健康检查（监控数据库状态）
    metricsRetention: 86_400_000, // 24小时
  },
};

export default config;
