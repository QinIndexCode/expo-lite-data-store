// Mock expo-constants before any imports
jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder',
      },
    },
  },
  manifest: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder',
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

  it('should load configuration from expo-constants', () => {
    const config = ConfigManager.getInstance().getConfig();

    // Verify it picked up values from the mock
    expect(config.chunkSize).toBe(999999);
    expect(config.storageFolder).toBe('mock-folder');
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
});
