// src/core/config/ConfigManager.ts
// 配置管理器类，支持从多个来源加载配置
// 优先级：程序化配置 > 环境变量 > 自定义配置文件 > 默认配置

import defaultConfig from '../../defaultConfig';
import { LiteStoreConfig, DeepPartial } from '../../types/config';  
import logger from '../../utils/logger';
// 内联基本logger功能，避免Metro bundler导入问题


/**
 * 配置管理器类
 * 支持从多个来源加载配置，具有明确的优先级顺序
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private currentConfig: LiteStoreConfig;
  private customConfig: DeepPartial<LiteStoreConfig> = {};

  /**
   * 私有构造函数，单例模式
   */
  private constructor() {
    // 初始化时加载默认配置
    this.currentConfig = { ...defaultConfig };
    this.loadConfig();
  }

  /**
   * 获取配置管理器实例
   * @returns ConfigManager 单例实例
   */
  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * 加载配置
   * 按优先级顺序加载配置：默认配置 -> 环境变量 -> 自定义配置文件 -> 程序化配置
   */
  private loadConfig(): void {
    // 1. 从默认配置开始
    let mergedConfig: LiteStoreConfig = { ...(defaultConfig as unknown as LiteStoreConfig) };

    // 2. 从环境变量加载配置
    mergedConfig = this.mergeConfigFromEnvironment(mergedConfig);

    // 3. 从自定义配置文件加载配置
    mergedConfig = this.mergeConfigFromFile(mergedConfig);

    // 4. 应用程序化配置
    mergedConfig = this.mergeConfig(mergedConfig, this.customConfig);

    // 更新当前配置
    this.currentConfig = mergedConfig;
    logger.success('Configuration loaded successfully');
  }

  /**
   * 从环境变量加载配置
   * @param baseConfig 基础配置
   * @returns 合并后的配置
   */
  private mergeConfigFromEnvironment(baseConfig: LiteStoreConfig): LiteStoreConfig {
    const envConfig: DeepPartial<LiteStoreConfig> = {};

    // 基础配置
    if (process.env.LITE_STORE_CHUNK_SIZE) {
      envConfig.chunkSize = parseInt(process.env.LITE_STORE_CHUNK_SIZE, 10);
    }
    if (process.env.LITE_STORE_STORAGE_FOLDER) {
      envConfig.storageFolder = process.env.LITE_STORE_STORAGE_FOLDER;
    }
    if (process.env.LITE_STORE_SORT_METHODS) {
      envConfig.sortMethods = process.env.LITE_STORE_SORT_METHODS as any;
    }
    if (process.env.LITE_STORE_TIMEOUT) {
      envConfig.timeout = parseInt(process.env.LITE_STORE_TIMEOUT, 10);
    }

    // 加密配置
    if (process.env.LITE_STORE_ENCRYPTION_KEY_ITERATIONS) {
      envConfig.encryption = envConfig.encryption || {};
      envConfig.encryption.keyIterations = parseInt(process.env.LITE_STORE_ENCRYPTION_KEY_ITERATIONS, 10);
    }

    // 性能配置
    if (process.env.LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS) {
      envConfig.performance = envConfig.performance || {};
      envConfig.performance.maxConcurrentOperations = parseInt(process.env.LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS, 10);
    }
    if (process.env.LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD) {
      envConfig.performance = envConfig.performance || {};
      envConfig.performance.memoryWarningThreshold = parseFloat(process.env.LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD);
    }

    // 缓存配置
    if (process.env.LITE_STORE_CACHE_MAX_SIZE) {
      envConfig.cache = envConfig.cache || {};
      envConfig.cache.maxSize = parseInt(process.env.LITE_STORE_CACHE_MAX_SIZE, 10);
    }
    if (process.env.LITE_STORE_CACHE_DEFAULT_EXPIRY) {
      envConfig.cache = envConfig.cache || {};
      envConfig.cache.defaultExpiry = parseInt(process.env.LITE_STORE_CACHE_DEFAULT_EXPIRY, 10);
    }

    // 自动同步配置
    if (process.env.LITE_STORE_AUTO_SYNC_ENABLED) {
      envConfig.autoSync = envConfig.autoSync || {};
      envConfig.autoSync.enabled = process.env.LITE_STORE_AUTO_SYNC_ENABLED === 'true';
    }
    if (process.env.LITE_STORE_AUTO_SYNC_INTERVAL) {
      envConfig.autoSync = envConfig.autoSync || {};
      envConfig.autoSync.interval = parseInt(process.env.LITE_STORE_AUTO_SYNC_INTERVAL, 10);
    }

    return this.mergeConfig(baseConfig, envConfig);
  }

  /**
   * 从自定义配置文件加载配置
   * @param baseConfig 基础配置
   * @returns 合并后的配置
   */
  private mergeConfigFromFile(baseConfig: LiteStoreConfig): LiteStoreConfig {
    try {
      // 检查是否在React Native/Expo环境中
      const isReactNative = typeof window !== 'undefined' || typeof navigator !== 'undefined';
      
      if (isReactNative) {
        // React Native/Expo环境：
        // 1. 首先尝试从app.json读取配置（推荐方式）
        try {
          // 在Expo环境中，我们可以直接从global.__expoConfig获取配置
          // 这是一个更可靠的方式，因为它直接访问Expo的内部配置
          if (typeof global !== 'undefined') {
            const globalAny = global as any;
            
            if (globalAny.__expoConfig) {
              const expoConfig = globalAny.__expoConfig;
              
              if (expoConfig.extra?.liteStore && typeof expoConfig.extra.liteStore === 'object') {
                const liteStoreConfig = expoConfig.extra.liteStore;
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }
          }
          
          // 2. 尝试使用expo-constants获取配置
          try {
            let Constants = require('expo-constants');
            
            // 如果Constants是一个模块对象，尝试获取其默认导出
            if (typeof Constants === 'object' && Constants && 'default' in Constants && typeof Constants.default === 'object') {
              Constants = Constants.default;
            }
            
            let expoConfig: null | { extra?: { liteStore?: any } } = null;
            
            // 方式1: 使用getConfig()方法（最可靠的方式）
            if (typeof Constants.getConfig === 'function') {
              try {
                expoConfig = Constants.getConfig();
              } catch (getConfigError) {
                // 忽略getConfig()错误
              }
            }
            
            // 方式2: 直接使用Constants的属性
            if (!expoConfig && Constants.expoConfig) {
              // Expo SDK 49及以上
              expoConfig = Constants.expoConfig;
            } else if (!expoConfig && Constants.manifest) {
              // Expo SDK 48及以下
              expoConfig = Constants.manifest;
            }
            
            // 方式3: 尝试访问extra属性直接从Constants获取
            if (!expoConfig && Constants.extra) {
              // 直接从Constants.extra获取liteStore配置
              const liteStoreConfig = Constants.extra?.liteStore;
              if (liteStoreConfig && typeof liteStoreConfig === 'object') {
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }
            
            if (expoConfig) {
              // 从app.json的extra字段中读取配置
              const liteStoreConfig = expoConfig.extra?.liteStore;
              if (liteStoreConfig && typeof liteStoreConfig === 'object') {
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }
          } catch (expoConstantsError) {
            // 忽略expo-constants加载错误
          }
          
          // 3. 尝试直接从global对象获取配置（备选方案）
          if (typeof global !== 'undefined') {
            const globalAny = global as any;
            
            if (globalAny.expo && globalAny.expo.extra?.liteStore) {
              const liteStoreConfig = globalAny.expo.extra?.liteStore;
              if (liteStoreConfig && typeof liteStoreConfig === 'object') {
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }
            
            // 4. 尝试从global.liteStoreConfig获取配置
            if (globalAny.liteStoreConfig) {
              const customConfig = globalAny.liteStoreConfig;
              if (customConfig && typeof customConfig === 'object') {
                logger.info('Configuration loaded from global.liteStoreConfig');
                return this.mergeConfig(baseConfig, customConfig);
              }
            }
          }
        } catch (error) {
          // 忽略配置加载错误，使用默认配置
        }
      }
    } catch (error) {
      // 忽略所有配置文件加载错误，使用默认配置
    }

    return baseConfig;
  }

  /**
   * 合并配置
   * @param baseConfig 基础配置
   * @param newConfig 新配置
   * @returns 合并后的配置
   */
  private mergeConfig<T extends object>(baseConfig: T, newConfig: DeepPartial<T>): T {
    const merged = { ...baseConfig } as T;

    for (const key in newConfig) {
      if (newConfig.hasOwnProperty(key)) {
        const baseValue = merged[key as keyof T];
        const newValue = newConfig[key as keyof T];

        if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue) && typeof baseValue === 'object') {
          // 递归合并对象
          merged[key as keyof T] = this.mergeConfig(
            baseValue as object,
            newValue as DeepPartial<object>
          ) as typeof baseValue;
        } else if (newValue !== undefined) {
          // 只有当 newValue 不是 undefined 时才替换
          merged[key as keyof T] = newValue as typeof baseValue;
        }
      }
    }

    return merged;
  }

  /**
   * 获取当前配置
   * @returns LiteStoreConfig 当前配置
   */
  public getConfig(): LiteStoreConfig {
    return { ...this.currentConfig };
  }

  /**
   * 设置自定义配置
   * @param customConfig 自定义配置
   */
  public setConfig(customConfig: DeepPartial<LiteStoreConfig>): void {
    this.customConfig = { ...customConfig };
    this.loadConfig();
  }

  /**
   * 更新部分配置
   * @param partialConfig 部分配置
   */
  public updateConfig(partialConfig: DeepPartial<LiteStoreConfig>): void {
    this.customConfig = this.mergeConfig(this.customConfig, partialConfig);
    this.loadConfig();
  }

  /**
   * 重置配置到默认值
   */
  public resetConfig(): void {
    this.customConfig = {};
    this.loadConfig();
  }

  /**
   * 获取配置值
   * @param path 配置路径，如 'encryption.encryptedFields'
   * @returns 配置值
   */
  public get<T>(path: string): T | undefined {
    const keys = path.split('.');
    let value: any = this.currentConfig;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value as T;
  }

  /**
   * 设置配置值
   * @param path 配置路径，如 'encryption.encryptedFields'
   * @param value 配置值
   */
  public set(path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop();
    if (!lastKey) return;

    // 检查所有键名，防止原型污染
    const validateKey = (key: string) => {
      // 拒绝特殊键名，防止原型污染
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`Invalid configuration key: ${key}`);
      }
    };

    // 验证所有键名
    keys.forEach(validateKey);
    validateKey(lastKey);

    let config: any = this.customConfig;
    for (const key of keys) {
      if (!config[key]) {
        config[key] = {};
      }
      config = config[key];
    }
    config[lastKey] = value;
    this.loadConfig();
  }
}

// 导出默认配置管理器实例
export const configManager = ConfigManager.getInstance();
