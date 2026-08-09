import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '../cryptoProvider';
import { decryptGCM, encryptGCM, isExpoAesAvailable } from '../crypto-gcm';

jest.mock('expo-crypto', () => {
  const state: { failAes: boolean } = { failAes: false };

  const splitTag = (combined: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } => {
    const tagSize = 16;
    return {
      ciphertext: combined.slice(0, -tagSize),
      tag: combined.slice(-tagSize),
    };
  };

  const aesEncryptAsync = async (plaintext: Uint8Array, key: CryptoKey, options: { nonce: { bytes: Uint8Array } }) => {
    if (state.failAes) {
      throw new Error('simulated native AES failure');
    }
    const combined = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(options.nonce.bytes), tagLength: 128 },
        key,
        new Uint8Array(plaintext)
      )
    );
    const parts = splitTag(combined);
    return {
      ciphertext: async () => parts.ciphertext,
      tag: async () => parts.tag,
    };
  };

  const aesDecryptAsync = async (sealed: unknown, key: CryptoKey) => {
    if (state.failAes) {
      throw new Error('simulated native AES failure');
    }
    const sealedParts = sealed as { iv: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array };
    const combined = new Uint8Array(sealedParts.ciphertext.length + sealedParts.tag.length);
    combined.set(sealedParts.ciphertext);
    combined.set(sealedParts.tag, sealedParts.ciphertext.length);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(sealedParts.iv), tagLength: 128 },
      key,
      combined
    );
    return new Uint8Array(plaintext);
  };

  return {
    get state() {
      return state;
    },
    AESEncryptionKey: class {
      static import(bytes: Uint8Array) {
        return crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'AES-GCM' }, false, [
          'encrypt',
          'decrypt',
        ]);
      }
    },
    AESSealedData: class {
      static fromParts(iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array) {
        return { iv, ciphertext, tag };
      }
    },
    aesEncryptAsync,
    aesDecryptAsync,
  };
});

const MASTER_KEY = 'expo-aes-branch-test-master-key';

const setExpoAesFailure = (failAes: boolean): void => {
  const expoMock = require('expo-crypto') as { state: { failAes: boolean } };
  expoMock.state.failAes = failAes;
};

const buildNoblePayloadBase64 = async (
  plaintext: string,
  masterKey: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  iterations: number
): Promise<string> => {
  const aesKey = pbkdf2(masterKey, salt, iterations, 32, 'sha256');
  const encryptedBytes = gcm(aesKey, nonce).encrypt(new TextEncoder().encode(plaintext));
  const tagSize = 16;
  const payload = {
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(nonce).toString('base64'),
    ciphertext: Buffer.from(encryptedBytes.slice(0, -tagSize)).toString('base64'),
    tag: Buffer.from(encryptedBytes.slice(-tagSize)).toString('base64'),
    version: 'gcm-v1' as const,
    iterations,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

describe('crypto-gcm expo-crypto native AES-GCM backend', () => {
  beforeEach(() => {
    setExpoAesFailure(false);
  });

  it('detects the expo AES backend', () => {
    expect(isExpoAesAvailable()).toBe(true);
  });

  it('round-trips through the expo AES backend', async () => {
    const plaintext = 'native-gcm-roundtrip-payload';
    const encrypted = await encryptGCM(plaintext, MASTER_KEY);
    expect(encrypted).not.toContain(plaintext);
    await expect(decryptGCM(encrypted, MASTER_KEY)).resolves.toBe(plaintext);
  });

  it('falls back to the pure-JS backend when the native call rejects', async () => {
    setExpoAesFailure(true);
    const plaintext = 'native-failure-fallback-payload';
    const encrypted = await encryptGCM(plaintext, MASTER_KEY);
    await expect(decryptGCM(encrypted, MASTER_KEY)).resolves.toBe(plaintext);

    setExpoAesFailure(false);
    await expect(decryptGCM(encrypted, MASTER_KEY)).resolves.toBe(plaintext);
  });

  it('reads a payload written by the pure-JS backend through the expo backend', async () => {
    const plaintext = 'expo-reads-noble-payload';
    const salt = new Uint8Array(16).fill(7);
    const nonce = new Uint8Array(12).fill(3);
    const iterations = 10000;

    const payloadBase64 = await buildNoblePayloadBase64(plaintext, MASTER_KEY, salt, nonce, iterations);
    await expect(decryptGCM(payloadBase64, MASTER_KEY)).resolves.toBe(plaintext);
  });

  it('lets the pure-JS backend read a payload written by the expo backend', async () => {
    const plaintext = 'noble-reads-expo-payload';
    const encrypted = await encryptGCM(plaintext, MASTER_KEY);

    setExpoAesFailure(true);
    await expect(decryptGCM(encrypted, MASTER_KEY)).resolves.toBe(plaintext);
  });

  it('produces tag-separated gcm-v1 payloads with the expected binary field sizes', async () => {
    const plaintext = 'shape-compat-payload';
    const encrypted = await encryptGCM(plaintext, MASTER_KEY);
    const decoded = JSON.parse(Buffer.from(encrypted, 'base64').toString()) as {
      version: string;
      salt: string;
      iv: string;
      ciphertext: string;
      tag: string;
      kdf?: string;
    };
    expect(decoded.version).toBe('gcm-v1');
    expect(decoded.kdf).toBe('root-hkdf');
    expect(Buffer.from(decoded.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(decoded.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(decoded.tag, 'base64')).toHaveLength(16);
    expect(Buffer.from(decoded.ciphertext, 'base64')).toHaveLength(new TextEncoder().encode(plaintext).length);
  });
});
