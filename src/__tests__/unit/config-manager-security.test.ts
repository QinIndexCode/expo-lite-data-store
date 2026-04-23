describe('ConfigManager security hardening', () => {
  let ConfigManager: typeof import('../../core/config/ConfigManager').ConfigManager;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../core/config/ConfigManager');
    ConfigManager = mod.ConfigManager;
    ConfigManager.resetInstance();
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  afterEach(() => {
    ConfigManager.resetInstance();
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it('rejects unsafe dotted keys in set()', () => {
    const manager = ConfigManager.getInstance();

    expect(() => manager.set('__proto__.polluted', 'yes')).toThrow('Invalid configuration key: __proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ignores unsafe keys nested inside updateConfig payloads', () => {
    const manager = ConfigManager.getInstance();
    const payload = JSON.parse(
      '{"cache":{"defaultExpiry":42,"__proto__":{"polluted":"yes"}}}'
    ) as Record<string, unknown>;

    manager.updateConfig(payload as never);

    expect(manager.getConfig().cache.defaultExpiry).toBe(42);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
