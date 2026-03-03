
import { ConfigManager } from '../../core/config/ConfigManager';

// Mock expo-constants
jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder'
      }
    }
  },
  manifest: {
    extra: {
      liteStore: {
        chunkSize: 999999,
        storageFolder: 'mock-folder'
      }
    }
  }
}));

describe('ConfigManager Integration with Expo Constants', () => {
  beforeEach(() => {
    ConfigManager.getInstance().resetConfig();
  });

  it('should load configuration from expo-constants', () => {
    const config = ConfigManager.getInstance().getConfig();
    
    // Verify it picked up values from the mock
    expect(config.chunkSize).toBe(999999);
    expect(config.storageFolder).toBe('mock-folder');
  });

  it('should prioritize global.__expoConfig if available', () => {
    // Inject global config
    const originalExpoConfig = (global as any).__expoConfig;
    (global as any).__expoConfig = {
      extra: {
        liteStore: {
          chunkSize: 888888
        }
      }
    };

    ConfigManager.getInstance().resetConfig();
    const config = ConfigManager.getInstance().getConfig();
    
    expect(config.chunkSize).toBe(888888);

    // Cleanup
    if (originalExpoConfig) {
      (global as any).__expoConfig = originalExpoConfig;
    } else {
      delete (global as any).__expoConfig;
    }
  });
});
