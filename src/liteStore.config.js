// liteStore.config.js
module.exports = {
  // 基础配置
  chunkSize: 5 * 1024 * 1024, // 5MB - 分片大小
  storageFolder: "expo-litedatastore",
  sortMethods: "default", // fast, counting, merge, slow
  timeout: 10000, // 10s

  // ==================== 加密配置（完整版） ====================
  encryption: {
    // --- 核心加密参数（新增，强烈推荐显式声明）---
    algorithm: 'AES-CTR',     // 明确声明使用 CTR 模式（支持并行，适合移动端）
    keySize: 256,             // 明确使用 AES-256（最高安全强度）

    // --- HMAC 完整性保护 ---
    hmacAlgorithm: 'SHA-512', // 推荐 SHA-512（抗长度扩展攻击）

    // --- 密钥派生（抗暴力破解）---
    keyIterations: 120_000,   // 2025年推荐值：≥120,000（你原来100k稍低，已升级）

    // --- 字段级加密 ---
    enableFieldLevelEncryption: true,     // 建议开启！对敏感字段更精细保护
    encryptedFields: [                    // 明确列出需要加密的字段
      'password',
      'email',
      'phone',
      'idCard',
      'bankCard',
      'realName',
      'token',
      'refreshToken'
    ],

    // --- 密钥缓存优化 ---
    cacheTimeout: 30_000,     // 30秒后自动清除内存中的 masterKey
    maxCacheSize: 50,         // LRU 缓存最多保留50个派生密钥

    // --- 批量操作 ---
    useBulkOperations: true,  // 保持开启，性能提升 5~10 倍
  },

  // 性能配置
  performance: {
    enableQueryOptimization: true,
    maxConcurrentOperations: 5,
    enableBatchOptimization: true,
    memoryWarningThreshold: 0.8,
  },

  // 缓存配置
  cache: {
    maxSize: 1000,
    defaultExpiry: 3600_000, // 1小时
    enableCompression: false,
    cleanupInterval: 300_000, // 5分钟
  },

  // API配置
  api: {
    rateLimit: {
      enabled: true,
      requestsPerSecond: 20,
      burstCapacity: 40,
    },
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
    }
  },

  // 监控配置
  monitoring: {
    enablePerformanceTracking: true,
    enableHealthChecks: true,
    metricsRetention: 86_400_000, // 24小时
  }
};