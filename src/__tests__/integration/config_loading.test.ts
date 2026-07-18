/// <reference path="../test-globals.d.ts" />

import { CacheManager } from '../../core/cache/CacheManager';
import { AutoSyncService } from '../../core/service/AutoSyncService';

type AdapterRuntimeAccess = {
  autoSyncService: AutoSyncService;
  cacheManager: CacheManager;
  dataWriter: {
    chunkSize: number;
    maxConcurrentOperations: number;
  };
};

const getAdapterRuntimeAccess = (adapter: object): AdapterRuntimeAccess => adapter as unknown as AdapterRuntimeAccess;

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder',
        performance: {
          maxConcurrentOperations: 11,
        },
        autoSync: {
          enabled: false,
          interval: 12000,
          minItems: 3,
          batchSize: 55,
        },
      },
    },
  },
  manifest: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder',
        performance: {
          maxConcurrentOperations: 11,
        },
        autoSync: {
          enabled: false,
          interval: 12000,
          minItems: 3,
          batchSize: 55,
        },
      },
    },
  },
}));

describe('ConfigManager Integration with Expo Constants', () => {
  let ConfigManager: typeof import('../../core/config/ConfigManager').ConfigManager;

  beforeEach(async () => {
    // Reset modules to ensure mock is applied before ConfigManager is loaded
    jest.resetModules();
    const mod = await import('../../core/config/ConfigManager');
    ConfigManager = mod.ConfigManager;
  });

  afterEach(async () => {
    const { AutoSyncService } = await import('../../core/service/AutoSyncService');
    await AutoSyncService.cleanupInstance();
    ConfigManager.resetInstance();
    Reflect.deleteProperty(globalThis, '__expoConfig');
    Reflect.deleteProperty(globalThis, 'expo');
    Reflect.deleteProperty(globalThis, 'liteStoreConfig');
  });

  it('loads configuration from Expo Constants', () => {
    const config = ConfigManager.getInstance().getConfig();

    expect(config.chunkSize).toBe(999999);
    expect(config.storageFolder).toBe('mock-folder');
    expect(config.performance.maxConcurrentOperations).toBe(11);
    expect(config.autoSync).toMatchObject({
      enabled: false,
      interval: 12000,
      minItems: 3,
      batchSize: 55,
    });
  });

  it('prioritizes global Expo configuration', async () => {
    global.__expoConfig = {
      extra: {
        liteStore: {
          chunkSize: 888888,
        },
      },
    };

    jest.resetModules();
    const mod = await import('../../core/config/ConfigManager');
    const FreshConfigManager = mod.ConfigManager;

    const config = FreshConfigManager.getInstance().getConfig();

    expect(config.chunkSize).toBe(888888);
  });

  it('propagates Expo configuration to adapter runtime consumers', async () => {
    const { FileSystemStorageAdapter } = await import('../../core/adapter/FileSystemStorageAdapter');

    const adapter = new FileSystemStorageAdapter();

    try {
      const { autoSyncService, dataWriter } = getAdapterRuntimeAccess(adapter);

      expect(dataWriter.chunkSize).toBe(999999);
      expect(dataWriter.maxConcurrentOperations).toBe(11);
      expect(autoSyncService.getConfig()).toMatchObject({
        enabled: false,
        interval: 12000,
        minItems: 3,
        batchSize: 55,
      });
    } finally {
      await adapter.cleanup();
    }
  });
});
