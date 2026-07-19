import { encryptGCM, decryptGCM } from '../../utils/crypto-gcm';
import { encrypt, decrypt } from '../../utils/crypto';
import { configManager } from '../../core/config/ConfigManager';

const diagnosticsEnabled = process.env.EXPO_LITE_DATA_STORE_TEST_DIAGNOSTICS === '1';

type EncodedPayload = {
  version: string;
  hmac?: string;
};

const decodePayload = (encrypted: string): EncodedPayload => JSON.parse(atob(encrypted)) as unknown as EncodedPayload;

describe('crypto performance benchmark', () => {
  const TEST_DATA = 'Hello, World! This is a test string for encryption benchmark.';
  const MASTER_KEY = 'test-master-key-for-benchmark';
  const ITERATIONS = 10;

  beforeEach(() => {
    configManager.resetConfig();
  });

  describe('AES-256-GCM performance', () => {
    it('encrypts and decrypts with GCM', async () => {
      const encrypted = await encryptGCM(TEST_DATA, MASTER_KEY);
      const decrypted = await decryptGCM(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });

    it('keeps GCM encryption below the benchmark threshold', async () => {
      const start = Date.now();
      for (let i = 0; i < ITERATIONS; i++) {
        await encryptGCM(TEST_DATA, MASTER_KEY);
      }
      const duration = Date.now() - start;
      const avgTime = duration / ITERATIONS;

      // The high PBKDF2 work factor needs a deliberately loose functional-test ceiling.
      expect(avgTime).toBeLessThan(10000);

      if (diagnosticsEnabled) {
        console.log(`GCM avg encryption time: ${avgTime.toFixed(2)}ms (${ITERATIONS} iterations)`);
      }
    });
  });

  describe('AES-256-CTR+HMAC performance', () => {
    it('encrypts and decrypts with CTR when explicitly configured', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);
      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });
  });

  describe('auto-detect decryption', () => {
    it('automatically detects and decrypts GCM payloads', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-GCM' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });

    it('automatically detects and decrypts CTR payloads', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });
  });

  describe('algorithm configuration', () => {
    it('uses GCM when the algorithm is auto', async () => {
      configManager.resetConfig();
      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      const decoded = decodePayload(encrypted);
      expect(decoded.version).toBe('gcm-v1');
    });

    it('uses GCM when the algorithm is AES-GCM', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-GCM' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      const decoded = decodePayload(encrypted);
      expect(decoded.version).toBe('gcm-v1');
    });

    it('uses CTR when the algorithm is AES-CTR', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      // CTR v2 authenticates the payload version and encryption parameters.
      const decoded = decodePayload(encrypted);
      expect(decoded.version).toBe('ctr-v2');
      expect(decoded.hmac).toBeDefined();
    });
  });
});
