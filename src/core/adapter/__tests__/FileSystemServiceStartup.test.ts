import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';
import { CacheMonitor } from '../../monitor/CacheMonitor';
import { configManager } from '../../config/ConfigManager';

describe('FileSystemStorageAdapter runtime service startup', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let adapter: FileSystemStorageAdapter | null = null;

  beforeEach(() => {
    // initializeRuntime() skips the service block under NODE_ENV=test, so run
    // these assertions as a normal runtime.
    process.env.NODE_ENV = 'development';
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.cleanup();
      adapter = null;
    }
    configManager.resetConfig();
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('does not sample cache statistics when performance tracking is disabled', async () => {
    const setEnabledSpy = jest.spyOn(CacheMonitor.prototype, 'setEnabled');
    const recordStatsSpy = jest.spyOn(CacheMonitor.prototype, 'recordStats');

    adapter = new FileSystemStorageAdapter();
    await adapter.ensureInitialized();

    expect(setEnabledSpy).toHaveBeenCalledWith(false);
    expect(recordStatsSpy).not.toHaveBeenCalled();
  });

  it('starts cache sampling when performance tracking is enabled', async () => {
    configManager.updateConfig({ monitoring: { enablePerformanceTracking: true } });

    const setEnabledSpy = jest.spyOn(CacheMonitor.prototype, 'setEnabled');
    const recordStatsSpy = jest.spyOn(CacheMonitor.prototype, 'recordStats');

    adapter = new FileSystemStorageAdapter();
    await adapter.ensureInitialized();

    expect(setEnabledSpy).toHaveBeenCalledWith(true);
    expect(recordStatsSpy).toHaveBeenCalled();
  });
});
