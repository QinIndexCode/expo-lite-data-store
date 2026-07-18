import { createHash, pbkdf2Sync } from 'node:crypto';
import { ctr } from '@noble/ciphers/aes';
import { configManager } from '../../core/config/ConfigManager';
import { clearGCMKeyCache, decryptGCM, encryptGCM, getGCMKeyCacheSize } from '../crypto-gcm';
import {
  __resetNativeCryptoForTest,
  hkdfDerive,
  hmac as providerHmac,
  pbkdf2 as providerPbkdf2,
  registerNativeCryptoModule,
} from '../cryptoProvider';
import {
  clearKeyCache,
  decrypt,
  decryptFields,
  decryptFieldsBulk,
  encrypt,
  encryptFields,
  encryptFieldsBulk,
  getMasterKey,
  getMasterKeyGeneration,
  resetMasterKey,
} from '../crypto';
import { normalizePbkdf2Iterations } from '../cryptoIterations';
import logger from '../logger';

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

type SecureStoreOptions = {
  authenticationPrompt?: string;
  requireAuthentication?: boolean;
};

type SecureStoreMock = {
  deleteItemAsync: (key: string, options?: SecureStoreOptions) => Promise<void>;
  getItemAsync: (key: string, options?: SecureStoreOptions) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: SecureStoreOptions) => Promise<void>;
};

const getSecureStoreMock = (): SecureStoreMock => require('expo-secure-store') as SecureStoreMock;

const createLegacyCtrPayload = (plainText: string, masterKey: string): string => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const iv = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
  const rootSalt = new Uint8Array([0x72, 0x6f, 0x6f, 0x74, 0x2d, 0x6b, 0x65, 0x79]);
  const iterations = Math.max(10000, Math.min(configManager.getConfig().encryption.keyIterations, 1000000));
  const rootKey = providerPbkdf2(masterKey, rootSalt, iterations, 64, 'sha256');
  const derived = hkdfDerive(rootKey, salt, 64);
  const ciphertext = ctr(derived.slice(0, 32), iv).encrypt(new TextEncoder().encode(plainText));
  const ciphertextBase64 = bytesToBase64(ciphertext);
  const hmac = providerHmac(ciphertextBase64, derived.slice(32, 64), 'SHA-512');

  return Buffer.from(
    JSON.stringify({
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: ciphertextBase64,
      hmac: bytesToBase64(hmac),
    })
  ).toString('base64');
};

describe('field encryption failure handling', () => {
  afterEach(() => {
    configManager.resetConfig();
    clearKeyCache();
    clearGCMKeyCache();
    __resetNativeCryptoForTest();
  });

  it('rejects an undecryptable field instead of returning it as normal data', async () => {
    await expect(
      decryptFields(
        { id: 1, secret: 'not-valid-ciphertext' },
        {
          fields: ['secret'],
          masterKey: 'test-master-key',
        }
      )
    ).rejects.toBeDefined();
  });

  it('preserves JSON-looking strings through single and bulk field encryption round trips', async () => {
    const fieldConfig = {
      fields: ['booleanLike', 'numberLike', 'nullLike'],
      masterKey: 'field-literal-round-trip-master-key',
    };
    const record = {
      id: 'literal-values',
      booleanLike: 'true',
      numberLike: '123',
      nullLike: 'null',
    };

    const encryptedRecord = await encryptFields(record, fieldConfig);
    await expect(decryptFields(encryptedRecord, fieldConfig)).resolves.toEqual(record);

    const encryptedRecords = await encryptFieldsBulk([record], fieldConfig);
    await expect(decryptFieldsBulk(encryptedRecords, fieldConfig)).resolves.toEqual([record]);
  });

  it('rejects unsafe field names with operation-specific crypto errors', async () => {
    const unsafeFieldConfig = {
      fields: ['__proto__'],
      masterKey: 'unsafe-field-name-master-key',
    };
    const record = { id: 'unsafe-field', secret: 'value' };

    await expect(encryptFields(record, unsafeFieldConfig)).rejects.toMatchObject({
      name: 'CryptoError',
      code: 'ENCRYPT_FAILED',
    });
    await expect(encryptFieldsBulk([record], unsafeFieldConfig)).rejects.toMatchObject({
      name: 'CryptoError',
      code: 'ENCRYPT_FAILED',
    });
    await expect(decryptFields(record, unsafeFieldConfig)).rejects.toMatchObject({
      name: 'CryptoError',
      code: 'DECRYPT_FAILED',
    });
    await expect(decryptFieldsBulk([record], unsafeFieldConfig)).rejects.toMatchObject({
      name: 'CryptoError',
      code: 'DECRYPT_FAILED',
    });
  });

  it('refuses an in-memory master key fallback outside tests', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const secureStore = getSecureStoreMock();
    const originalGetItemAsync = secureStore.getItemAsync;
    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    secureStore.getItemAsync = jest.fn().mockRejectedValueOnce(new Error('secure store down'));

    process.env.NODE_ENV = 'production';
    try {
      await expect(getMasterKey(false)).rejects.toMatchObject({ code: 'KEY_DERIVE_FAILED' });
    } finally {
      if (originalNodeEnv === undefined) {
        Reflect.deleteProperty(process.env, 'NODE_ENV');
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      secureStore.getItemAsync = originalGetItemAsync;
      loggerErrorSpy.mockRestore();
    }
  });

  it('binds CTR integrity to the salt and IV while retaining legacy payload reads', async () => {
    configManager.updateConfig({ encryption: { algorithm: 'AES-CTR', keyIterations: 10000 } });
    const masterKey = 'ctr-integrity-test-master-key';
    const encrypted = await encrypt('integrity-check', masterKey);
    const payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    const iv = Buffer.from(payload.iv, 'base64');
    iv[0] ^= 1;
    payload.iv = iv.toString('base64');
    const tampered = Buffer.from(JSON.stringify(payload)).toString('base64');

    await expect(decrypt(tampered, masterKey)).rejects.toBeDefined();
    await expect(decrypt(createLegacyCtrPayload('legacy-compatible', masterKey), masterKey)).resolves.toBe(
      'legacy-compatible'
    );
  });

  it('does not reuse an unauthenticated legacy key for strict access', async () => {
    const secureStore = getSecureStoreMock();
    const constants = require('expo-constants');
    const originalGetItemAsync = secureStore.getItemAsync;
    const originalSetItemAsync = secureStore.setItemAsync;
    const originalDeleteItemAsync = secureStore.deleteItemAsync;
    const originalAppOwnership = constants.appOwnership;
    const values = new Map<string, string>([['expo_litedb_master_key_v2025', 'legacy-key']]);
    const getItemAsync = jest.fn(async (key: string) => values.get(key) ?? null);
    const setItemAsync = jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    });
    const deleteItemAsync = jest.fn(async (key: string) => {
      values.delete(key);
    });

    constants.appOwnership = 'standalone';
    secureStore.getItemAsync = getItemAsync;
    secureStore.setItemAsync = setItemAsync;
    secureStore.deleteItemAsync = deleteItemAsync;

    try {
      await expect(getMasterKey(true)).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
      expect(getItemAsync).toHaveBeenCalledWith(
        'expo_litedb_master_key_auth_v2026',
        expect.objectContaining({ requireAuthentication: true })
      );
      expect(setItemAsync).not.toHaveBeenCalled();
    } finally {
      secureStore.getItemAsync = originalGetItemAsync;
      secureStore.setItemAsync = originalSetItemAsync;
      secureStore.deleteItemAsync = originalDeleteItemAsync;
      constants.appOwnership = originalAppOwnership;
    }
  });

  it('serializes first strict master-key provisioning without caching the resolved key', async () => {
    const secureStore = getSecureStoreMock();
    const constants = require('expo-constants');
    const originalGetItemAsync = secureStore.getItemAsync;
    const originalSetItemAsync = secureStore.setItemAsync;
    const originalAppOwnership = constants.appOwnership;
    const values = new Map<string, string>();
    let releaseSet: () => void = () => undefined;
    const setGate = new Promise<void>(resolve => {
      releaseSet = resolve;
    });
    let signalSetStarted: () => void = () => undefined;
    const setStarted = new Promise<void>(resolve => {
      signalSetStarted = resolve;
    });
    const getItemAsync = jest.fn(async (key: string) => values.get(key) ?? null);
    const setItemAsync = jest.fn(async (key: string, value: string) => {
      signalSetStarted();
      await setGate;
      values.set(key, value);
    });

    constants.appOwnership = 'standalone';
    secureStore.getItemAsync = getItemAsync;
    secureStore.setItemAsync = setItemAsync;

    try {
      const firstKey = getMasterKey(true);
      await setStarted;
      const secondKey = getMasterKey(true);
      await Promise.resolve();

      expect(setItemAsync).toHaveBeenCalledTimes(1);

      releaseSet();
      const [firstResolvedKey, secondResolvedKey] = await Promise.all([firstKey, secondKey]);
      expect(firstResolvedKey).toBe(secondResolvedKey);
      expect(firstResolvedKey).toBe(values.get('expo_litedb_master_key_auth_v2026'));
      expect(setItemAsync).toHaveBeenCalledTimes(1);
      expect(getItemAsync).toHaveBeenCalledWith(
        'expo_litedb_master_key_auth_v2026',
        expect.objectContaining({ requireAuthentication: true })
      );
    } finally {
      releaseSet();
      secureStore.getItemAsync = originalGetItemAsync;
      secureStore.setItemAsync = originalSetItemAsync;
      constants.appOwnership = originalAppOwnership;
    }
  });

  it('removes both master-key aliases and advances the adapter invalidation generation', async () => {
    const secureStore = getSecureStoreMock();
    const originalDeleteItemAsync = secureStore.deleteItemAsync;
    const values = new Map<string, string>([
      ['expo_litedb_master_key_v2025', 'regular-key'],
      ['expo_litedb_master_key_auth_v2026', 'strict-key'],
    ]);
    const deleteItemAsync = jest.fn(async (key: string) => {
      values.delete(key);
    });
    secureStore.deleteItemAsync = deleteItemAsync;
    const generationBeforeReset = getMasterKeyGeneration();

    try {
      await resetMasterKey();

      expect(deleteItemAsync).toHaveBeenCalledWith('expo_litedb_master_key_v2025');
      expect(deleteItemAsync).toHaveBeenCalledWith('expo_litedb_master_key_auth_v2026');
      expect(values.size).toBe(0);
      expect(getMasterKeyGeneration()).toBe(generationBeforeReset + 1);
    } finally {
      secureStore.deleteItemAsync = originalDeleteItemAsync;
    }
  });

  it('does not report a partial SecureStore master-key reset as successful', async () => {
    const secureStore = getSecureStoreMock();
    const originalDeleteItemAsync = secureStore.deleteItemAsync;
    const deleteItemAsync = jest.fn(async (key: string) => {
      if (key === 'expo_litedb_master_key_auth_v2026') {
        throw new Error('strict key delete failed');
      }
    });
    secureStore.deleteItemAsync = deleteItemAsync;

    try {
      await expect(resetMasterKey()).rejects.toMatchObject({ code: 'KEY_DERIVE_FAILED' });
      expect(deleteItemAsync).toHaveBeenCalledWith('expo_litedb_master_key_v2025');
      expect(deleteItemAsync).toHaveBeenCalledWith('expo_litedb_master_key_auth_v2026');
    } finally {
      secureStore.deleteItemAsync = originalDeleteItemAsync;
    }
  });

  it('clears GCM-derived keys when the general key cache is cleared', async () => {
    await encryptGCM('cache-clear', 'gcm-cache-clear-master-key');
    expect(getGCMKeyCacheSize()).toBeGreaterThan(0);

    clearKeyCache();

    expect(getGCMKeyCacheSize()).toBe(0);
  });

  it('separates GCM key-cache entries for master keys with the same prefix', async () => {
    configManager.updateConfig({ encryption: { keyIterations: 100000 } });
    __resetNativeCryptoForTest();
    registerNativeCryptoModule({
      pbkdf2Sync: (
        password: string,
        salt: Uint8Array,
        iterations: number,
        dkLen: number,
        digest: 'sha256' | 'sha512'
      ) => pbkdf2Sync(password, salt, iterations, dkLen, digest),
      randomBytes: (length: number) => Buffer.alloc(length, 7),
      createHash: (algorithm: 'sha256' | 'sha512') => createHash(algorithm),
    });

    const firstMasterKey = '0123456789abcdef-first-master-key';
    const secondMasterKey = '0123456789abcdef-second-master-key';
    await encryptGCM('first', firstMasterKey);
    const encrypted = await encryptGCM('second', secondMasterKey);
    clearGCMKeyCache();

    await expect(decryptGCM(encrypted, secondMasterKey)).resolves.toBe('second');
    await expect(decryptGCM(encrypted, firstMasterKey)).rejects.toBeDefined();
  });

  it('bounds invalid and excessive PBKDF2 configuration values before key derivation', () => {
    expect(normalizePbkdf2Iterations(Number.MAX_SAFE_INTEGER, 10000)).toBe(1000000);
    expect(normalizePbkdf2Iterations(Number.NaN, 10000)).toBe(10000);
  });

  it('bounds the CTR root-key cache and evicts the least recently used key', async () => {
    const nativePbkdf2 = jest.fn((password: string, _salt: Uint8Array, _iterations: number, dkLen: number) =>
      new Uint8Array(dkLen).fill(password.length)
    );
    configManager.updateConfig({ encryption: { algorithm: 'AES-CTR', keyIterations: 10000 } });
    registerNativeCryptoModule({
      pbkdf2Sync: nativePbkdf2,
      randomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index),
      createHash: (algorithm: 'sha256' | 'sha512') => createHash(algorithm),
    });

    for (let index = 0; index < 51; index++) {
      await encrypt('cache-boundary', `root-key-${index}`);
    }
    await encrypt('cache-boundary', 'root-key-0');

    expect(nativePbkdf2).toHaveBeenCalledTimes(52);
  });
});
