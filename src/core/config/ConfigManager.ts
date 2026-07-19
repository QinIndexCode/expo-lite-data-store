import defaultConfig from '../../defaultConfig';
import { LiteStoreConfig, DeepPartial } from '../../types/config';
import logger from '../../utils/logger';
import { assertValidStorageFolderName, pathHelper } from '../../utils/PathHelper';

type LiteStoreExtraConfig = {
  extra?: {
    liteStore?: DeepPartial<LiteStoreConfig>;
  };
};

type ExpoConstantsConfigLike = LiteStoreExtraConfig & {
  getConfig?: () => LiteStoreExtraConfig | null;
  expoConfig?: LiteStoreExtraConfig | null;
  manifest?: LiteStoreExtraConfig | null;
  default?: ExpoConstantsConfigLike;
};

type LiteStoreGlobals = {
  __expoConfig?: LiteStoreExtraConfig;
  expo?: LiteStoreExtraConfig;
  liteStoreConfig?: DeepPartial<LiteStoreConfig>;
};

/** Resolves configuration sources in precedence order while rejecting unsafe property names. */
export class ConfigManager {
  private static readonly UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  private static instance: ConfigManager | null = null;
  private currentConfig: LiteStoreConfig;
  private customConfig: DeepPartial<LiteStoreConfig> = Object.create(null) as DeepPartial<LiteStoreConfig>;

  private constructor() {
    this.currentConfig = this.sanitizeConfigValue(defaultConfig as LiteStoreConfig);
    this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private createConfigContainer<T extends object>(): T {
    return Object.create(null) as T;
  }

  private isConfigObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private assertConfigObject(value: unknown): asserts value is Record<string, unknown> {
    if (!this.isConfigObject(value)) {
      throw new TypeError('Configuration must be a non-array object.');
    }
  }

  private isUnsafeConfigKey(key: string): boolean {
    return ConfigManager.UNSAFE_CONFIG_KEYS.has(key);
  }

  private assertSafeConfigKey(key: string): void {
    if (this.isUnsafeConfigKey(key)) {
      throw new Error(`Invalid configuration key: ${key}`);
    }
  }

  private parseConfigPath(path: string): string[] {
    const keys = path.split('.');
    if (keys.some(key => key.length === 0)) {
      throw new Error('Configuration path must not contain empty keys.');
    }

    keys.forEach(key => this.assertSafeConfigKey(key));
    return keys;
  }

  private sanitizeConfigValue<T>(value: T): T {
    if (Array.isArray(value)) {
      const values: unknown[] = value;
      return values.map(item => this.sanitizeConfigValue(item)) as T;
    }

    if (this.isConfigObject(value)) {
      const sanitized = this.createConfigContainer<Record<string, unknown>>();
      for (const [key, nestedValue] of Object.entries(value)) {
        if (this.isUnsafeConfigKey(key)) {
          logger.warn(`Ignoring unsafe configuration key during merge: ${key}`);
          continue;
        }
        sanitized[key] = this.sanitizeConfigValue(nestedValue);
      }
      return sanitized as T;
    }

    return value;
  }

  private getGlobalLiteStoreConfig(): LiteStoreGlobals | undefined {
    if (typeof global === 'undefined') {
      return undefined;
    }

    return global as LiteStoreGlobals;
  }

  private extractLiteStoreConfig(
    config: LiteStoreExtraConfig | null | undefined
  ): DeepPartial<LiteStoreConfig> | undefined {
    const liteStoreConfig = config?.extra?.liteStore;
    return this.isConfigObject(liteStoreConfig) ? liteStoreConfig : undefined;
  }

  private loadConfig(): void {
    // Later sources override earlier sources: defaults, environment, Expo/global, then programmatic values.
    let mergedConfig = this.sanitizeConfigValue(defaultConfig as LiteStoreConfig);
    mergedConfig = this.mergeConfigFromEnvironment(mergedConfig);
    mergedConfig = this.mergeConfigFromFile(mergedConfig);
    mergedConfig = this.mergeConfig(mergedConfig, this.customConfig);

    assertValidStorageFolderName(mergedConfig.storageFolder);

    // Update current config and its root together so a rejected configuration
    // cannot leave one singleton pointed at a different directory.
    pathHelper.setStorageFolder(mergedConfig.storageFolder);
    this.currentConfig = mergedConfig;

    logger.success('Configuration loaded successfully');
  }

  private mergeConfigFromEnvironment(baseConfig: LiteStoreConfig): LiteStoreConfig {
    const envConfig: DeepPartial<LiteStoreConfig> = {};

    if (process.env.LITE_STORE_CHUNK_SIZE) {
      envConfig.chunkSize = parseInt(process.env.LITE_STORE_CHUNK_SIZE, 10);
    }
    if (process.env.LITE_STORE_STORAGE_FOLDER) {
      envConfig.storageFolder = process.env.LITE_STORE_STORAGE_FOLDER;
    }
    if (process.env.LITE_STORE_SORT_METHODS) {
      envConfig.sortMethods = process.env.LITE_STORE_SORT_METHODS as LiteStoreConfig['sortMethods'];
    }
    if (process.env.LITE_STORE_TIMEOUT) {
      envConfig.timeout = parseInt(process.env.LITE_STORE_TIMEOUT, 10);
    }

    if (process.env.LITE_STORE_ENCRYPTION_KEY_ITERATIONS) {
      envConfig.encryption = envConfig.encryption || {};
      envConfig.encryption.keyIterations = parseInt(process.env.LITE_STORE_ENCRYPTION_KEY_ITERATIONS, 10);
    }

    if (process.env.LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS) {
      envConfig.performance = envConfig.performance || {};
      envConfig.performance.maxConcurrentOperations = parseInt(
        process.env.LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS,
        10
      );
    }
    if (process.env.LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD) {
      envConfig.performance = envConfig.performance || {};
      envConfig.performance.memoryWarningThreshold = parseFloat(
        process.env.LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD
      );
    }

    if (process.env.LITE_STORE_CACHE_MAX_SIZE) {
      envConfig.cache = envConfig.cache || {};
      envConfig.cache.maxSize = parseInt(process.env.LITE_STORE_CACHE_MAX_SIZE, 10);
    }
    if (process.env.LITE_STORE_CACHE_DEFAULT_EXPIRY) {
      envConfig.cache = envConfig.cache || {};
      envConfig.cache.defaultExpiry = parseInt(process.env.LITE_STORE_CACHE_DEFAULT_EXPIRY, 10);
    }

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

  private mergeConfigFromFile(baseConfig: LiteStoreConfig): LiteStoreConfig {
    try {
      const isReactNative =
        typeof window !== 'undefined' || typeof navigator !== 'undefined' || process.env.NODE_ENV === 'test';

      if (isReactNative) {
        try {
          const globalConfig = this.getGlobalLiteStoreConfig();
          const globalExpoConfig = this.extractLiteStoreConfig(globalConfig?.__expoConfig);
          if (globalExpoConfig) {
            logger.info('Configuration loaded from app.json via expo-constants');
            return this.mergeConfig(baseConfig, globalExpoConfig);
          }

          try {
            let Constants = require('expo-constants') as ExpoConstantsConfigLike;

            if (
              typeof Constants === 'object' &&
              Constants &&
              'default' in Constants &&
              typeof Constants.default === 'object'
            ) {
              Constants = Constants.default;
            }

            let expoConfig: LiteStoreExtraConfig | null = null;

            if (typeof Constants.getConfig === 'function') {
              try {
                expoConfig = Constants.getConfig();
              } catch {
                // An unavailable Expo config is treated as absent.
              }
            }

            if (!expoConfig && Constants.expoConfig) {
              // Expo SDK 49+ exposes expoConfig; older SDKs use manifest.
              expoConfig = Constants.expoConfig;
            } else if (!expoConfig && Constants.manifest) {
              expoConfig = Constants.manifest;
            }

            if (!expoConfig && Constants.extra) {
              const liteStoreConfig = this.extractLiteStoreConfig(Constants);
              if (liteStoreConfig) {
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }

            if (expoConfig) {
              const liteStoreConfig = this.extractLiteStoreConfig(expoConfig);
              if (liteStoreConfig) {
                logger.info('Configuration loaded from app.json via expo-constants');
                return this.mergeConfig(baseConfig, liteStoreConfig);
              }
            }
          } catch {}

          const globalExpoFallback = this.extractLiteStoreConfig(globalConfig?.expo);
          if (globalExpoFallback) {
            logger.info('Configuration loaded from app.json via expo-constants');
            return this.mergeConfig(baseConfig, globalExpoFallback);
          }

          if (this.isConfigObject(globalConfig?.liteStoreConfig)) {
            logger.info('Configuration loaded from global.liteStoreConfig');
            return this.mergeConfig(baseConfig, globalConfig.liteStoreConfig);
          }
        } catch {}
      }
    } catch {}

    return baseConfig;
  }

  private mergeConfig<T extends object>(baseConfig: T, newConfig: DeepPartial<T>): T {
    this.assertConfigObject(newConfig);
    const merged = this.sanitizeConfigValue(baseConfig);

    for (const key of Object.keys(newConfig) as string[]) {
      if (this.isUnsafeConfigKey(key)) {
        logger.warn(`Ignoring unsafe configuration key during merge: ${key}`);
        continue;
      }

      const typedKey = key as keyof T;
      const baseValue = merged[typedKey];
      const newValue = newConfig[typedKey];

      if (this.isConfigObject(baseValue) && newValue !== undefined) {
        if (!this.isConfigObject(newValue)) {
          throw new TypeError(`Configuration section "${key}" must be an object.`);
        }
        merged[typedKey] = this.mergeConfig(baseValue as object, newValue as DeepPartial<object>) as typeof baseValue;
      } else if (newValue !== undefined) {
        merged[typedKey] = this.sanitizeConfigValue(newValue) as typeof baseValue;
      }
    }

    return merged;
  }

  /** Returns a defensive copy that callers cannot use to mutate internal configuration. */
  public getConfig(): LiteStoreConfig {
    return this.sanitizeConfigValue(this.currentConfig);
  }

  private applyCustomConfig(nextConfig: DeepPartial<LiteStoreConfig>): void {
    const previousConfig = this.customConfig;
    this.customConfig = nextConfig;

    try {
      this.loadConfig();
    } catch (error) {
      this.customConfig = previousConfig;
      throw error;
    }
  }

  public setConfig(customConfig: DeepPartial<LiteStoreConfig>): void {
    this.assertConfigObject(customConfig);
    this.applyCustomConfig(this.sanitizeConfigValue(customConfig));
  }

  public updateConfig(partialConfig: DeepPartial<LiteStoreConfig>): void {
    this.assertConfigObject(partialConfig);
    this.applyCustomConfig(this.mergeConfig(this.customConfig, this.sanitizeConfigValue(partialConfig)));
  }

  public resetConfig(): void {
    this.applyCustomConfig(this.createConfigContainer<DeepPartial<LiteStoreConfig>>());
  }

  static resetInstance(): void {
    ConfigManager.instance = null;
  }

  /** Reads a defensive copy from a dot-separated configuration path. */
  public get<T>(path: string): T | undefined {
    const keys = this.parseConfigPath(path);
    let value: unknown = this.currentConfig;

    for (const key of keys) {
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return this.sanitizeConfigValue(value) as T;
  }

  /** Sets a programmatic override at a dot-separated configuration path. */
  public set(path: string, value: unknown): void {
    const keys = this.parseConfigPath(path);
    const lastKey = keys.pop();
    if (!lastKey) {
      throw new Error('Configuration path must contain at least one key.');
    }

    const nextConfig = this.sanitizeConfigValue(this.customConfig) as Record<string, unknown>;
    let config = nextConfig;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(config, key) || !this.isConfigObject(config[key])) {
        Object.defineProperty(config, key, {
          value: this.createConfigContainer<Record<string, unknown>>(),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      config = config[key] as Record<string, unknown>;
    }
    Object.defineProperty(config, lastKey, {
      value: this.sanitizeConfigValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this.applyCustomConfig(nextConfig as DeepPartial<LiteStoreConfig>);
  }
}

export const configManager = ConfigManager.getInstance();
