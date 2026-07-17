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

  it('rejects storage folder traversal without retaining the invalid override', () => {
    const manager = ConfigManager.getInstance();
    const originalFolder = manager.getConfig().storageFolder;

    expect(() => manager.updateConfig({ storageFolder: '../outside' })).toThrow('Invalid storageFolder');
    expect(() => manager.updateConfig({ storageFolder: '%2e%2e' })).toThrow('Invalid storageFolder');
    expect(manager.getConfig().storageFolder).toBe(originalFolder);
  });

  it('does not expose mutable nested configuration state', () => {
    const manager = ConfigManager.getInstance();
    const config = manager.getConfig();
    const encryption = manager.get<{ encryptedFields: string[] }>('encryption')!;

    config.encryption.encryptedFields = ['external-field'];
    encryption.encryptedFields.push('external-field-from-get');

    expect(manager.getConfig().encryption.encryptedFields).not.toContain('external-field');
    expect(manager.getConfig().encryption.encryptedFields).not.toContain('external-field-from-get');
  });

  it('rejects unsafe and inherited configuration lookup paths', () => {
    const manager = ConfigManager.getInstance();

    expect(() => manager.get('__proto__')).toThrow('Invalid configuration key: __proto__');
    expect(() => manager.get('constructor.prototype')).toThrow('Invalid configuration key: constructor');
  });
});
