import { ConfigManager } from '../ConfigManager';
import defaultConfig from '../../../defaultConfig';

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    ConfigManager.resetInstance();
    configManager = ConfigManager.getInstance();
  });

  afterEach(() => {
    configManager.resetConfig();
    ConfigManager.resetInstance();
  });

  describe('basic configuration', () => {
    it('returns the default configuration', () => {
      const config = configManager.getConfig();
      expect(config).toEqual(defaultConfig);
    });

    it('gets values by configuration path', () => {
      const chunkSize = configManager.get<number>('chunkSize');
      expect(chunkSize).toBe(defaultConfig.chunkSize);

      const encryptionAlgorithm = configManager.get<string>('encryption.algorithm');
      expect(encryptionAlgorithm).toBe(defaultConfig.encryption.algorithm);

      const nonExistentConfig = configManager.get<string>('nonExistentConfig');
      expect(nonExistentConfig).toBeUndefined();
    });
  });

  describe('programmatic configuration', () => {
    it('sets custom configuration values', () => {
      const customConfig = {
        chunkSize: 10 * 1024 * 1024,
        storageFolder: 'custom-storage',
        encryption: {
          algorithm: 'AES-CTR' as const,
          keySize: 256 as const,
        },
      };

      configManager.setConfig(customConfig);
      const config = configManager.getConfig();

      expect(config.chunkSize).toBe(customConfig.chunkSize);
      expect(config.storageFolder).toBe(customConfig.storageFolder);
      expect(config.encryption.algorithm).toBe(customConfig.encryption.algorithm);
      expect(config.encryption.keySize).toBe(customConfig.encryption.keySize);
      expect(config.encryption.hmacAlgorithm).toBe(defaultConfig.encryption.hmacAlgorithm);
    });

    it('updates partial configuration without replacing prior values', () => {
      configManager.updateConfig({ chunkSize: 2 * 1024 * 1024 });
      let config = configManager.getConfig();
      expect(config.chunkSize).toBe(2 * 1024 * 1024);

      configManager.updateConfig({ encryption: { keyIterations: 150000 } });
      config = configManager.getConfig();
      expect(config.encryption.keyIterations).toBe(150000);
      expect(config.chunkSize).toBe(2 * 1024 * 1024);
    });

    it('resets configuration to defaults', () => {
      configManager.setConfig({ chunkSize: 10 * 1024 * 1024 });
      let config = configManager.getConfig();
      expect(config.chunkSize).toBe(10 * 1024 * 1024);

      configManager.resetConfig();
      config = configManager.getConfig();
      expect(config.chunkSize).toBe(defaultConfig.chunkSize);
    });
  });

  describe('configuration paths', () => {
    it('sets values by configuration path', () => {
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

    it('sets nested configuration paths', () => {
      configManager.set('cache.memoryWarningThreshold', 0.7);
      const config = configManager.getConfig();
      expect(config.cache.memoryWarningThreshold).toBe(0.7);
    });
  });

  describe('configuration merging', () => {
    it('merges nested configuration while retaining defaults', () => {
      const customConfig = {
        encryption: {
          algorithm: 'AES-CTR' as const,
          keyIterations: 150000,
        },
      };

      configManager.setConfig(customConfig);
      const config = configManager.getConfig();

      expect(config.encryption.algorithm).toBe(customConfig.encryption.algorithm);
      expect(config.encryption.keyIterations).toBe(customConfig.encryption.keyIterations);
      expect(config.encryption.keySize).toBe(defaultConfig.encryption.keySize);
      expect(config.encryption.hmacAlgorithm).toBe(defaultConfig.encryption.hmacAlgorithm);
    });
  });

  describe('change subscriptions', () => {
    it('notifies subscribers when configuration lands via set() and setConfig()', () => {
      const listener = jest.fn();
      const unsubscribe = configManager.subscribe(listener);

      configManager.set('chunkSize', 10 * 1024 * 1024);
      expect(listener).toHaveBeenCalledTimes(1);

      configManager.setConfig({ chunkSize: 20 * 1024 * 1024 });
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
    });

    it('stops notifying once unsubscribed', () => {
      const listener = jest.fn();
      const unsubscribe = configManager.subscribe(listener);
      unsubscribe();
      unsubscribe();

      configManager.set('chunkSize', 10 * 1024 * 1024);
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies subscribers on resetConfig()', () => {
      const listener = jest.fn();
      const unsubscribe = configManager.subscribe(listener);

      configManager.resetConfig();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('does not notify when the applied configuration is rejected', () => {
      const listener = jest.fn();
      const unsubscribe = configManager.subscribe(listener);

      expect(() => configManager.set('storageFolder', 'nested/folder')).toThrow();

      expect(listener).not.toHaveBeenCalled();
      expect(configManager.get<string>('storageFolder')).toBe(defaultConfig.storageFolder);
      unsubscribe();
    });

    it('keeps reaching live subscribers after resetInstance()', () => {
      const listener = jest.fn();
      const unsubscribe = configManager.subscribe(listener);

      ConfigManager.resetInstance();
      const freshManager = ConfigManager.getInstance();
      freshManager.set('chunkSize', 7 * 1024 * 1024);

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });
  });
});
