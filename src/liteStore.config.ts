/**
 * LiteStore 配置文件
 * 支持自动合并用户配置和默认配置
 */
import { LiteStoreConfig } from './types/config';

// 默认配置
const defaultConfig: LiteStoreConfig = {
  // 基础配置
  chunkSize: 5 * 1024 * 1024, // 5MB - 分片大小
  storageFolder: 'expo-litedatastore',
  sortMethods: 'default', // fast, counting, merge, slow
  timeout: 10000, // 10s

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

// 深度合并函数
function deepMerge<T>(target: T, source: Partial<T>): T {
  const output = { ...target };

  if (typeof target === 'object' && typeof source === 'object') {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const targetValue = (target as any)[key];
        const sourceValue = (source as any)[key];

        if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
          (output as any)[key] = [...targetValue, ...sourceValue];
        } else if (
          typeof targetValue === 'object' &&
          typeof sourceValue === 'object' &&
          targetValue !== null &&
          sourceValue !== null
        ) {
          (output as any)[key] = deepMerge(targetValue, sourceValue);
        } else {
          (output as any)[key] = sourceValue;
        }
      }
    }
  }

  return output;
}

// 配置存储，用于保存用户修改后的配置
let userModifiedConfig: Partial<LiteStoreConfig> = {};

// 自动加载用户根目录配置文件的函数
async function loadUserConfig() {
  // 仅在 Node.js 环境中执行，浏览器环境跳过
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      // 动态导入 Node.js 模块，避免在浏览器环境中加载失败
      const fs = await import('fs');
      const path = await import('path');
      
      // 构建用户根目录配置文件路径
      const configPath = path.join(process.cwd(), 'liteStore.config.ts');
      
      // 检查配置文件是否存在
      if (fs.existsSync(configPath)) {
        // 动态加载用户配置文件
        // 注意：在 ES 模块中，我们需要使用 dynamic import
        // 但由于 TypeScript 编译后的代码可能是 CommonJS，我们需要兼容处理
        let userConfig;
        try {
          // 首先尝试使用 CommonJS require（适用于编译后的代码）
          if (typeof require !== 'undefined') {
            userConfig = require(configPath);
          } else {
            // 否则尝试使用 ES 模块 dynamic import
            const module = await import(configPath);
            userConfig = module;
          }
          
          // 提取默认导出
          const userConfigData = userConfig.default || userConfig;
          
          if (userConfigData && typeof userConfigData === 'object') {
            // 合并用户配置
            userModifiedConfig = deepMerge(userModifiedConfig, userConfigData);
            console.log('✅ 成功加载用户配置文件:', configPath);
          }
        } catch (e: any) {
          console.warn('⚠️  动态加载配置文件失败，可能是因为配置文件使用了 TypeScript 语法', e.message || String(e));
          // 尝试另一种方式：读取文件内容并解析（仅适用于简单配置）
          try {
            const fileContent = fs.readFileSync(configPath, 'utf8');
            // 简单的配置文件解析，提取默认导出的对象
            const configMatch = fileContent.match(/export\s+default\s+({[\s\S]*?});/);
            if (configMatch && configMatch[1]) {
              const userConfigData = eval(`(${configMatch[1]})`);
              if (userConfigData && typeof userConfigData === 'object') {
                userModifiedConfig = deepMerge(userModifiedConfig, userConfigData);
                console.log('✅ 成功解析用户配置文件:', configPath);
              }
            }
          } catch (parseError: any) {
            console.warn('⚠️  解析配置文件内容失败:', parseError.message || String(parseError));
          }
        }
      }
    } catch (error: any) {
      console.warn('⚠️  加载用户配置文件时发生错误:', error.message || String(error));
      // 继续使用默认配置
    }
  }
}

// 初始化时自动加载用户配置
loadUserConfig();

// 注意：由于 loadUserConfig 是异步的，初始合并会使用默认配置
// 配置会在 loadUserConfig 完成后通过 setConfig 方法更新
const config: LiteStoreConfig = deepMerge(defaultConfig, userModifiedConfig);

// 确保配置在异步加载完成后更新
loadUserConfig().then(() => {
  // 更新配置对象
  Object.assign(config, deepMerge(defaultConfig, userModifiedConfig));
});

/**
 * 设置配置
 * 允许用户在运行时修改配置
 * @param newConfig 新的配置对象
 */
export function setConfig(newConfig: Partial<LiteStoreConfig>): void {
  userModifiedConfig = deepMerge(userModifiedConfig, newConfig);
  // 更新配置对象
  Object.assign(config, deepMerge(defaultConfig, userModifiedConfig));
  console.log('✅ 配置已更新:', JSON.stringify(newConfig, null, 2));
}

/**
 * 获取当前配置
 * @returns LiteStoreConfig 当前配置对象
 */
export function getConfig(): LiteStoreConfig {
  return config;
}

/**
 * 重置配置为默认值
 */
export function resetConfig(): void {
  userModifiedConfig = {};
  // 更新配置对象
  Object.assign(config, defaultConfig);
  console.log('✅ 配置已重置为默认值');
}

export default config;

export { defaultConfig };
