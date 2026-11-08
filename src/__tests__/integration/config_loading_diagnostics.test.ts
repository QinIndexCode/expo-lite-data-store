/// <reference path="../test-globals.d.ts" />

jest.mock('expo-constants', () => ({
  getConfig: () => {
    throw new Error('getConfig unavailable');
  },
  get expoConfig() {
    throw new Error('expoConfig unavailable');
  },
}));

describe('ConfigManager configuration diagnostics', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__expoConfig');
    Reflect.deleteProperty(globalThis, 'expo');
    Reflect.deleteProperty(globalThis, 'liteStoreConfig');
    jest.restoreAllMocks();
  });

  it('logs debug diagnostics when expo-constants cannot provide a config', async () => {
    const { default: logger } = await import('../../utils/logger');
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    const { default: defaultConfig } = await import('../../defaultConfig');
    const { ConfigManager } = await import('../../core/config/ConfigManager');

    const config = ConfigManager.getInstance().getConfig();

    expect(config.storageFolder).toBe(defaultConfig.storageFolder);
    const messages = debugSpy.mock.calls.map(([message]) => String(message));
    expect(messages.some(message => message.includes('getConfig() unavailable'))).toBe(true);
    expect(messages.some(message => message.includes('expo-constants could not be read'))).toBe(true);
  });
});
