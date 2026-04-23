// Mock expo-constants before any imports
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
    AutoSyncService.cleanupInstance();
    ConfigManager.resetInstance();
    delete (global as any).__expoConfig;
    delete (global as any).expo;
    delete (global as any).liteStoreConfig;
  });

  it('should load configuration from expo-constants', () => {
    const config = ConfigManager.getInstance().getConfig();

    // Verify it picked up values from the mock
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

  it('should prioritize global.__expoConfig if available', async () => {
    // Inject global config
    const originalExpoConfig = (global as any).__expoConfig;
    (global as any).__expoConfig = {
      extra: {
        liteStore: {
          chunkSize: 888888,
        },
      },
    };

    // Reset and reload to pick up global config
    jest.resetModules();
    const mod = await import('../../core/config/ConfigManager');
    const FreshConfigManager = mod.ConfigManager;

    const config = FreshConfigManager.getInstance().getConfig();

    expect(config.chunkSize).toBe(888888);

    // Cleanup
    if (originalExpoConfig) {
      (global as any).__expoConfig = originalExpoConfig;
    } else {
      delete (global as any).__expoConfig;
    }
  });

  it('should propagate Expo config into adapter runtime consumers', async () => {
    const { FileSystemStorageAdapter } = await import('../../core/adapter/FileSystemStorageAdapter');

    const adapter = new FileSystemStorageAdapter();
    const dataWriter = (adapter as any).dataWriter;
    const autoSyncService = (adapter as any).autoSyncService;

    expect(dataWriter.chunkSize).toBe(999999);
    expect(dataWriter.maxConcurrentOperations).toBe(11);
    expect(autoSyncService.getConfig()).toMatchObject({
      enabled: false,
      interval: 12000,
      minItems: 3,
      batchSize: 55,
    });

    const cacheManager = (adapter as any).cacheManager;
    if (cacheManager && typeof cacheManager.cleanup === 'function') {
      cacheManager.cleanup();
    }
  });
});
