## 计划内容

1. **检查并清理generateConfig残留**

   * 检查 `package-dev.json`，移除postinstall脚本中的generateConfig调用

   * 检查 `package-env.json`，移除postinstall脚本中的generateConfig调用

   * 删除 `src/utils/configGenerator.ts` 文件

   * 验证 `src/core/db.ts` 中已无ConfigGenerator相关代码

2. **添加全面的配置API测试**

   * 测试简单配置属性修改

   * 测试嵌套配置修改

   * 测试多个配置属性同时修改

   * 测试配置重置功能

   * 测试loadConfig功能

   * 测试配置修改后的数据持久化

   * 测试不同环境下的配置行为

## 具体修改点

### 1. 清理generateConfig残留

**修改package-dev.json**

* 删除第57行的 `postinstall` 脚本

**修改package-env.json**

* 删除第36行的 `postinstall` 脚本

**删除configGenerator.ts**

```bash
rm src/utils/configGenerator.ts
```

**验证db.ts**

* 确认已无ConfigGenerator相关代码

### 2. 添加全面的配置API测试

在 `src/__tests__/api/api.test.ts` 文件中添加以下测试：

```typescript
describe('Config API Tests', () => {
  // 保存原始配置，用于重置测试环境
  let originalConfig: LiteStoreConfig;

  // 测试前保存原始配置
  beforeAll(async () => {
    originalConfig = getConfig();
  });

  // 测试后重置配置
  afterAll(async () => {
    resetConfig();
  });

  it('should set and get a simple config property correctly', async () => {
    // 设置单个配置属性
    setConfig({ cache: { autoSync: { interval: 1000 } } });
    
    // 验证配置已更新
    const config = getConfig();
    expect(config.cache.autoSync.interval).toBe(1000);
  });

  it('should set and get nested config properties correctly', async () => {
    // 设置嵌套配置
    setConfig({
      encryption: {
        keyIterations: 200000,
        hmacAlgorithm: 'SHA-256'
      }
    });
    
    // 验证配置已更新
    const config = getConfig();
    expect(config.encryption.keyIterations).toBe(200000);
    expect(config.encryption.hmacAlgorithm).toBe('SHA-256');
  });

  it('should set multiple config properties at once', async () => {
    // 设置多个配置属性
    setConfig({
      cache: {
        maxSize: 500,
        autoSync: {
          enabled: true,
          interval: 500,
          minItems: 5,
          batchSize: 200
        }
      },
      performance: {
        maxConcurrentOperations: 10,
        enableQueryOptimization: true
      }
    });
    
    // 验证配置已更新
    const config = getConfig();
    expect(config.cache.maxSize).toBe(500);
    expect(config.cache.autoSync.enabled).toBe(true);
    expect(config.cache.autoSync.interval).toBe(500);
    expect(config.cache.autoSync.minItems).toBe(5);
    expect(config.cache.autoSync.batchSize).toBe(200);
    expect(config.performance.maxConcurrentOperations).toBe(10);
    expect(config.performance.enableQueryOptimization).toBe(true);
  });

  it('should reset config to default values', async () => {
    // 先修改配置
    setConfig({ cache: { maxSize: 100 } });
    
    // 重置配置
    resetConfig();
    
    // 验证配置已重置为默认值
    const config = getConfig();
    expect(config.cache.maxSize).toBe(defaultConfig.cache.maxSize);
  });

  it('should load a complete config object using loadConfig', async () => {
    // 创建一个完整的配置对象
    const customConfig: LiteStoreConfig = {
      chunkSize: 10 * 1024 * 1024,
      storageFolder: 'custom-storage',
      sortMethods: 'fast',
      timeout: 15000,
      encryption: {
        algorithm: 'AES-GCM',
        keySize: 256,
        hmacAlgorithm: 'SHA-384',
        keyIterations: 150000,
        enableFieldLevelEncryption: true,
        encryptedFields: ['password', 'email'],
        cacheTimeout: 60000,
        maxCacheSize: 100,
        useBulkOperations: true
      },
      cache: {
        maxSize: 2000,
        defaultExpiry: 7200000,
        enableCompression: true,
        cleanupInterval: 600000,
        memoryWarningThreshold: 0.85,
        autoSync: {
          enabled: true,
          interval: 2000,
          minItems: 2,
          batchSize: 150
        }
      },
      performance: {
        enableQueryOptimization: true,
        maxConcurrentOperations: 8,
        enableBatchOptimization: true,
        memoryWarningThreshold: 0.85
      },
      api: {
        rateLimit: {
          enabled: true,
          requestsPerSecond: 30,
          burstCapacity: 60
        },
        retry: {
          maxAttempts: 5,
          backoffMultiplier: 3
        }
      },
      monitoring: {
        enablePerformanceTracking: true,
        enableHealthChecks: true,
        metricsRetention: 172800000
      }
    };
    
    // 使用loadConfig加载完整配置
    loadConfig(customConfig);
    
    // 验证配置已完全更新
    const config = getConfig();
    expect(config.chunkSize).toBe(customConfig.chunkSize);
    expect(config.storageFolder).toBe(customConfig.storageFolder);
    expect(config.sortMethods).toBe(customConfig.sortMethods);
    expect(config.timeout).toBe(customConfig.timeout);
    expect(config.encryption).toEqual(customConfig.encryption);
    expect(config.cache).toEqual(customConfig.cache);
    expect(config.performance).toEqual(customConfig.performance);
    expect(config.api).toEqual(customConfig.api);
    expect(config.monitoring).toEqual(customConfig.monitoring);
  });

  it('should handle partial config updates correctly', async () => {
    // 设置部分配置
    setConfig({
      cache: { autoSync: { enabled: false } },
      encryption: { enableFieldLevelEncryption: true }
    });
    
    // 验证部分配置已更新，其他配置保持不变
    const config = getConfig();
    expect(config.cache.autoSync.enabled).toBe(false);
    expect(config.encryption.enableFieldLevelEncryption).toBe(true);
    // 验证未修改的配置仍为默认值
    expect(config.chunkSize).toBe(defaultConfig.chunkSize);
  });

  it('should preserve existing config when merging with new values', async () => {
    // 先设置一些配置
    setConfig({
      cache: { maxSize: 1500 },
      performance: { maxConcurrentOperations: 7 }
    });
    
    // 再设置其他配置，验证之前的设置仍然保留
    setConfig({
      cache: { autoSync: { interval: 3000 } },
      api: { rateLimit: { requestsPerSecond: 40 } }
    });
    
    // 验证所有配置都已正确合并
    const config = getConfig();
    expect(config.cache.maxSize).toBe(1500); // 保留之前的设置
    expect(config.cache.autoSync.interval).toBe(3000); // 新设置
    expect(config.performance.maxConcurrentOperations).toBe(7); // 保留之前的设置
    expect(config.api.rateLimit.requestsPerSecond).toBe(40); // 新设置
  });

  it('should handle edge cases in config values', async () => {
    // 测试边界值和特殊情况
    setConfig({
      cache: {
        maxSize: 0, // 最小值
        autoSync: {
          interval: 0, // 最小值
          minItems: 0, // 最小值
          batchSize: 1 // 最小值
        }
      },
      timeout: 1000, // 较小值
      performance: {
        maxConcurrentOperations: 1, // 最小值
        memoryWarningThreshold: 1.0 // 最大值
      }
    });
    
    // 验证边界值被正确设置
    const config = getConfig();
    expect(config.cache.maxSize).toBe(0);
    expect(config.cache.autoSync.interval).toBe(0);
    expect(config.cache.autoSync.minItems).toBe(0);
    expect(config.cache.autoSync.batchSize).toBe(1);
    expect(config.timeout).toBe(1000);
    expect(config.performance.maxConcurrentOperations).toBe(1);
    expect(config.performance.memoryWarningThreshold).toBe(1.0);
  });
});
```

## 预期结果

* 所有generateConfig相关代码被完全清理

* 构建成功，没有编译错误

* 所有配置API测试通过

* 测试覆盖了开发者可能使用的各种配置场景

* 包在安装时不再尝试生成配置文件

* 用户可以通过显式API灵活配置

