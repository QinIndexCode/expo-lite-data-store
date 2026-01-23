// src/core/config/__tests__/ConfigManager.test.ts
// 配置管理器测试

import { ConfigManager } from '../ConfigManager';
import defaultConfig from '../../../defaultConfig';

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  // 删除生成的配置文件，确保测试使用默认配置
  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    
    // 可能的配置文件路径
    const configPaths = [
      path.join(process.cwd(), 'liteStore.config.ts'),
      path.join(process.cwd(), 'liteStore.config.js'),
      path.join(process.cwd(), 'litedatastore.config.ts'),
      path.join(process.cwd(), 'litedatastore.config.js'),
      path.join(process.cwd(), 'config', 'liteStore.config.ts'),
      path.join(process.cwd(), 'config', 'liteStore.config.js')
    ];
    
    // 删除所有可能的配置文件
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
    
    // 重置配置管理器实例
    jest.resetModules();
    // 重新获取配置管理器实例
    configManager = ConfigManager.getInstance();
  });

  describe('基本功能', () => {
    it('应该能够获取默认配置', () => {
      const config = configManager.getConfig();
      expect(config).toEqual(defaultConfig);
    });

    it('应该能够获取配置值', () => {
      const chunkSize = configManager.get<number>('chunkSize');
      expect(chunkSize).toBe(defaultConfig.chunkSize);

      const encryptionAlgorithm = configManager.get<string>('encryption.algorithm');
      expect(encryptionAlgorithm).toBe(defaultConfig.encryption.algorithm);

      const nonExistentConfig = configManager.get<string>('nonExistentConfig');
      expect(nonExistentConfig).toBeUndefined();
    });
  });

  describe('程序化配置', () => {
    it('应该能够设置自定义配置', () => {
      const customConfig = {
        chunkSize: 10 * 1024 * 1024,
        storageFolder: 'custom-storage',
        encryption: {
          algorithm: 'AES-CTR' as const,
          keySize: 256 as const
        }
      };

      configManager.setConfig(customConfig);
      const config = configManager.getConfig();

      expect(config.chunkSize).toBe(customConfig.chunkSize);
      expect(config.storageFolder).toBe(customConfig.storageFolder);
      expect(config.encryption.algorithm).toBe(customConfig.encryption.algorithm);
      expect(config.encryption.keySize).toBe(customConfig.encryption.keySize);
      // 其他配置应该保持默认值
      expect(config.encryption.hmacAlgorithm).toBe(defaultConfig.encryption.hmacAlgorithm);
    });

    it('应该能够更新部分配置', () => {
      configManager.updateConfig({ chunkSize: 2 * 1024 * 1024 });
      let config = configManager.getConfig();
      expect(config.chunkSize).toBe(2 * 1024 * 1024);

      // 再次更新配置
      configManager.updateConfig({ encryption: { keyIterations: 150000 } });
      config = configManager.getConfig();
      expect(config.encryption.keyIterations).toBe(150000);
      // chunkSize 应该保持之前的值
      expect(config.chunkSize).toBe(2 * 1024 * 1024);
    });

    it('应该能够重置配置到默认值', () => {
      configManager.setConfig({ chunkSize: 10 * 1024 * 1024 });
      let config = configManager.getConfig();
      expect(config.chunkSize).toBe(10 * 1024 * 1024);

      configManager.resetConfig();
      config = configManager.getConfig();
      expect(config.chunkSize).toBe(defaultConfig.chunkSize);
    });
  });

  describe('配置路径访问', () => {
    it('应该能够通过路径设置配置值', () => {
      configManager.set('storageFolder', 'new-storage-folder');
      let config = configManager.getConfig();
      expect(config.storageFolder).toBe('new-storage-folder');

      configManager.set('encryption.encryptedFields', ['password', 'email']);
      config = configManager.getConfig();
      expect(config.encryption.encryptedFields).toEqual(['password', 'email']);

      configManager.set('performance.enableQueryOptimization', false);
      config = configManager.getConfig();
      expect(config.performance.enableQueryOptimization).toBe(false);
    });

    it('应该能够处理嵌套路径', () => {
      configManager.set('cache.memoryWarningThreshold', 0.7);
      const config = configManager.getConfig();
      expect(config.cache.memoryWarningThreshold).toBe(0.7);
    });
  });

  describe('配置合并', () => {
    it('应该正确合并嵌套配置', () => {
      const customConfig = {
        encryption: {
          algorithm: 'AES-CTR' as const,
          keyIterations: 150000
        }
      };

      configManager.setConfig(customConfig);
      const config = configManager.getConfig();

      // 只修改了指定的配置，其他配置保持默认值
      expect(config.encryption.algorithm).toBe(customConfig.encryption.algorithm);
      expect(config.encryption.keyIterations).toBe(customConfig.encryption.keyIterations);
      expect(config.encryption.keySize).toBe(defaultConfig.encryption.keySize);
      expect(config.encryption.hmacAlgorithm).toBe(defaultConfig.encryption.hmacAlgorithm);
    });
  });
});
