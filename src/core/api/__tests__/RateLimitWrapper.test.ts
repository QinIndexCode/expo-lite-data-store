import { configManager } from '../../config/ConfigManager';
import { RateLimitWrapper } from '../RateLimitWrapper';

describe('RateLimitWrapper', () => {
  afterEach(() => {
    configManager.resetConfig();
  });

  it('honors the global api.rateLimit config when options are omitted', () => {
    configManager.updateConfig({ api: { rateLimit: { enabled: false } } });
    const disabled = new RateLimitWrapper();
    expect(disabled.checkRateLimit('config-client', 100000).allowed).toBe(true);

    configManager.updateConfig({
      api: { rateLimit: { enabled: true, requestsPerSecond: 1, burstCapacity: 1 } },
    });
    const limited = new RateLimitWrapper();
    expect(limited.checkRateLimit('config-client', 1).allowed).toBe(true);
    expect(limited.checkRateLimit('config-client', 1).allowed).toBe(false);
  });

  it('prefers explicit options over the global config', () => {
    configManager.updateConfig({ api: { rateLimit: { enabled: true } } });
    const wrapper = new RateLimitWrapper({ enabled: false });
    expect(wrapper.checkRateLimit('explicit-client', 100000).allowed).toBe(true);
  });
});
