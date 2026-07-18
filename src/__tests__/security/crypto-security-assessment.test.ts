import { configManager } from '../../core/config/ConfigManager';
import { decrypt, encrypt, getMasterKey } from '../../utils/crypto';

describe('crypto security properties', () => {
  let masterKey: string;

  beforeAll(async () => {
    masterKey = await getMasterKey();
  });

  beforeEach(() => {
    configManager.resetConfig();
  });

  it('uses the configured HMAC algorithm and minimum key-derivation work factor', () => {
    const config = configManager.getConfig();

    expect(config.encryption.hmacAlgorithm).toBe('SHA-512');
    expect(config.encryption.keyIterations).toBeGreaterThanOrEqual(50_000);
  });

  it('rejects tampered ciphertext', async () => {
    const original = 'sensitive integrity test data';
    const encrypted = await encrypt(original, masterKey);
    const tampered = `${encrypted.slice(0, -20)}TAMPERED${encrypted.slice(-12)}`;

    await expect(decrypt(tampered, masterKey)).rejects.toThrow();
  });

  it('uses fresh ciphertext for equivalent plaintext', async () => {
    const plaintext = 'identical plaintext';
    const first = await encrypt(plaintext, masterKey);
    const second = await encrypt(plaintext, masterKey);

    expect(first).not.toBe(second);
  });
});
