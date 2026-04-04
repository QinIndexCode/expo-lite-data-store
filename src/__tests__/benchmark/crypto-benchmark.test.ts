/**
 * Performance benchmark tests for encryption algorithms
 * Compares AES-256-GCM vs AES-256-CTR+HMAC
 */

import { encryptGCM, decryptGCM } from '../../utils/crypto-gcm';
import { encrypt, decrypt } from '../../utils/crypto';
import { configManager } from '../../core/config/ConfigManager';

describe('Crypto Performance Benchmark', () => {
  const TEST_DATA = 'Hello, World! This is a test string for encryption benchmark.';
  const MASTER_KEY = 'test-master-key-for-benchmark';
  const ITERATIONS = 10;

  beforeEach(() => {
    configManager.resetConfig();
  });

  describe('AES-256-GCM Performance', () => {
    it('should encrypt and decrypt with GCM', async () => {
      const encrypted = await encryptGCM(TEST_DATA, MASTER_KEY);
      const decrypted = await decryptGCM(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });

    it('should complete GCM encryption within reasonable time', async () => {
      const start = Date.now();
      for (let i = 0; i < ITERATIONS; i++) {
        await encryptGCM(TEST_DATA, MASTER_KEY);
      }
      const duration = Date.now() - start;
      const avgTime = duration / ITERATIONS;

      // GCM with 600K PBKDF2 iterations takes longer; allow up to 10s in test env
      expect(avgTime).toBeLessThan(10000);

      console.log(`GCM avg encryption time: ${avgTime.toFixed(2)}ms (${ITERATIONS} iterations)`);
    });
  });

  describe('AES-256-CTR+HMAC Performance', () => {
    it('should encrypt and decrypt with CTR when explicitly configured', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);
      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });
  });

  describe('Auto-detect Decryption', () => {
    it('should auto-detect and decrypt GCM payloads', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-GCM' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      // Switch to auto mode - should still decrypt GCM data
      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });

    it('should auto-detect and decrypt CTR payloads', async () => {
      // First encrypt with CTR
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });
      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      // Switch to auto mode - should still decrypt CTR data
      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const decrypted = await decrypt(encrypted, MASTER_KEY);
      expect(decrypted).toBe(TEST_DATA);
    });
  });

  describe('Algorithm Configuration', () => {
    it('should use GCM when algorithm is auto (default)', async () => {
      configManager.resetConfig();
      configManager.updateConfig({ encryption: { algorithm: 'auto' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      // GCM payloads have version field
      const decoded = JSON.parse(atob(encrypted));
      expect(decoded.version).toBe('gcm-v1');
    });

    it('should use GCM when algorithm is AES-GCM', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-GCM' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      const decoded = JSON.parse(atob(encrypted));
      expect(decoded.version).toBe('gcm-v1');
    });

    it('should use CTR when algorithm is AES-CTR', async () => {
      configManager.updateConfig({ encryption: { algorithm: 'AES-CTR' } });

      const encrypted = await encrypt(TEST_DATA, MASTER_KEY);

      // CTR payloads don't have version field
      const decoded = JSON.parse(atob(encrypted));
      expect(decoded.version).toBeUndefined();
      expect(decoded.hmac).toBeDefined();
    });
  });
});
