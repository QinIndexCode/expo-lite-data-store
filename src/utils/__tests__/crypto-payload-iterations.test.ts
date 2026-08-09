import { configManager } from '../../core/config/ConfigManager';
import { clearGCMKeyCache } from '../crypto-gcm';
import { clearKeyCache, decrypt, decryptBulk, encrypt, encryptBulk } from '../crypto';
import { CryptoError } from '../crypto-errors';

/**
 * Verifies that encrypted payloads carry their own PBKDF2 work factor so that
 * changing encryption.keyIterations (or a library upgrade that adjusts the
 * default) never makes previously encrypted data permanently undecryptable.
 */

const parsePayload = (serialized: string): Record<string, unknown> => {
  return JSON.parse(Buffer.from(serialized, 'base64').toString('utf8')) as Record<string, unknown>;
};

const stripIterationsField = (serialized: string): string => {
  const payload = parsePayload(serialized);
  delete payload.iterations;
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const tamperIterations = (serialized: string, iterations: number): string => {
  const payload = parsePayload(serialized);
  payload.iterations = iterations;
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

describe('payload-carried PBKDF2 iterations', () => {
  const MASTER_KEY = 'test-master-key-for-iteration-compat';
  const PLAIN = 'payload iterations compatibility plain text';

  beforeEach(() => {
    configManager.resetConfig();
    clearKeyCache();
    clearGCMKeyCache();
  });

  afterAll(() => {
    configManager.resetConfig();
  });

  describe('GCM payload', () => {
    it('stores the used iteration count in the payload', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 150000, algorithm: 'AES-GCM' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const payload = parsePayload(encrypted);
      expect(payload.version).toBe('gcm-v1');
      expect(payload.iterations).toBe(150000);
    });

    it('still decrypts after keyIterations is changed (payload work factor wins)', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 150000, algorithm: 'AES-GCM' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);

      configManager.updateConfig({ encryption: { keyIterations: 10000, algorithm: 'AES-GCM' } });
      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(PLAIN);
    });

    it('decrypts legacy payloads without the iterations field using the current config', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 150000, algorithm: 'AES-GCM' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const legacy = stripIterationsField(encrypted);

      const decrypted = await decrypt(legacy, MASTER_KEY);
      expect(decrypted).toBe(PLAIN);
    });

    it('clamps a tampered payload work factor instead of honoring it verbatim', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 600000, algorithm: 'AES-GCM' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const tampered = tamperIterations(encrypted, 999999999);

      await expect(decrypt(tampered, MASTER_KEY)).rejects.toThrow(CryptoError);
    });

    it('keeps bulk decrypt working when the config changes between writes and reads', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 150000, algorithm: 'AES-GCM' } });
      const bulk = await encryptBulk(['one', 'two', 'three'], MASTER_KEY);

      configManager.updateConfig({ encryption: { keyIterations: 10000, algorithm: 'AES-GCM' } });
      const decrypted = await decryptBulk(bulk, MASTER_KEY);
      expect(decrypted).toEqual(['one', 'two', 'three']);
    });
  });

  describe('CTR payload', () => {
    it('writes the used iterations into each CTR payload', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 90000, algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const payload = parsePayload(encrypted);
      expect(payload.version).toBe('ctr-v2');
      expect(payload.iterations).toBe(90000);
    });

    it('decrypts after keyIterations changed because the payload carries the work factor', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 90000, algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);

      configManager.updateConfig({ encryption: { keyIterations: 20000, algorithm: 'AES-CTR' } });
      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(PLAIN);
    });

    it('decrypts legacy CTR payloads without iterations using the current config', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 90000, algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const legacy = stripIterationsField(encrypted);

      const decrypted = await decrypt(legacy, MASTER_KEY);
      expect(decrypted).toBe(PLAIN);
    });

    it('rejects tampered iterations through HMAC verification', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 600000, algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(PLAIN, MASTER_KEY);
      const tampered = tamperIterations(encrypted, 20000);

      await expect(decrypt(tampered, MASTER_KEY)).rejects.toThrow(CryptoError);
    });

    it('keeps bulk CTR decryption working across a config change', async () => {
      configManager.updateConfig({ encryption: { keyIterations: 90000, algorithm: 'AES-CTR' } });
      const bulk = await encryptBulk(['alpha', 'beta'], MASTER_KEY);

      configManager.updateConfig({ encryption: { keyIterations: 20000, algorithm: 'AES-CTR' } });
      const decrypted = await decryptBulk(bulk, MASTER_KEY);
      expect(decrypted).toEqual(['alpha', 'beta']);
    });
  });
});
