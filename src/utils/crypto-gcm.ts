import { gcm } from '@noble/ciphers/aes';
import { hkdfBytesSync } from './cryptoPrimitives';
import { hashBytes, pbkdf2, randomBytes } from './cryptoProvider';
import { normalizePbkdf2Iterations } from './cryptoIterations';
import { CryptoError } from './crypto-errors';
import logger from './logger';
import { performanceMonitor } from '../core/monitor/PerformanceMonitor';
import { configManager } from '../core/config/ConfigManager';
import { loadOptionalExpoModule } from './expoModuleLoader';

type ExpoConstantsRuntime = {
  appOwnership?: string;
};

let cachedExpoConstants: ExpoConstantsRuntime | null | undefined;

const getExpoConstants = (): ExpoConstantsRuntime | null => {
  if (cachedExpoConstants === undefined) {
    cachedExpoConstants = loadOptionalExpoModule<ExpoConstantsRuntime>('expo-constants') ?? null;
  }

  return cachedExpoConstants;
};

const isExpoGo = (): boolean => {
  try {
    return getExpoConstants()?.appOwnership === 'expo';
  } catch {
    return false;
  }
};

const getGCMIterations = (): number => {
  const configIterations = configManager.getConfig().encryption.keyIterations;
  const boundedIterations = normalizePbkdf2Iterations(configIterations, 10000);

  if (isExpoGo()) {
    return Math.min(boundedIterations, 20000);
  }

  const minStandaloneIterations = 100000;
  if (boundedIterations < minStandaloneIterations) {
    logger.warn(
      `PBKDF2 iterations below ${minStandaloneIterations} are raised to ${minStandaloneIterations} for GCM in standalone builds.`
    );
  }
  return Math.max(minStandaloneIterations, boundedIterations);
};

/** The minimum PBKDF2 work factor accepted from untrusted payload fields. */
const MIN_PAYLOAD_ITERATIONS = 10000;

/** Key derivation mode recorded on the payload. Absent means 'pbkdf2' (legacy). */
type GCMKdfMode = 'pbkdf2' | 'root-hkdf';

export interface GCMEncryptedPayload {
  /** Base64-encoded salt (16 bytes). */
  salt: string;
  /** Base64-encoded nonce (12 bytes, the GCM standard size). */
  iv: string;
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded authentication tag (16 bytes). */
  tag: string;
  /** Payload version identifier. */
  version: 'gcm-v1';
  /** PBKDF2 iterations used at encryption time; lets decryption match the original work factor. */
  iterations?: number;
  /**
   * Key derivation mode. 'root-hkdf' derives one cached PBKDF2 root key per
   * master key and expands it per record with cheap HKDF; 'pbkdf2' (or an
   * absent field, for legacy payloads) derives the full PBKDF2 per record.
   */
  kdf?: GCMKdfMode;
}

const isGCMEncryptedPayload = (value: unknown): value is GCMEncryptedPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.version === 'gcm-v1' &&
    typeof payload.salt === 'string' &&
    typeof payload.iv === 'string' &&
    typeof payload.ciphertext === 'string' &&
    typeof payload.tag === 'string'
  );
};

const AES_KEY_SIZE = 32;

const GCM_NONCE_SIZE = 12;

const SALT_SIZE = 16;

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Hermes btoa handles a few thousand characters per call efficiently;
  // building one giant latin1 string (multi-megabyte ciphertexts) is slow.
  let output = '';
  const chunkSize = 0x3ffc;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    const chunk = bytes.subarray(offset, end) as unknown as number[];
    output += btoa(String.fromCharCode.apply(null, chunk));
  }
  return output;
};

const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  let binaryString = '';
  const chunkSize = 0x3ffc;
  for (let offset = 0; offset < base64.length; offset += chunkSize) {
    binaryString += atob(base64.substring(offset, Math.min(offset + chunkSize, base64.length)));
  }
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/** Encodes JSON payload text (pure ASCII by construction) to Base64 without TextEncoder copies. */
const jsonToBase64 = (json: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json).toString('base64');
  }
  return btoa(json);
};

/** Parses a Base64 payload without TextDecoder copies (payload JSON is pure ASCII). */
const base64ToJson = (base64: string): unknown => {
  if (typeof Buffer !== 'undefined') {
    return JSON.parse(Buffer.from(base64, 'base64').toString()) as unknown;
  }
  return JSON.parse(atob(base64)) as unknown;
};

/** Static domain-separation salt for the per-master-key PBKDF2 root ("gcm-root-key"). */
const ROOT_SALT_BYTES = new Uint8Array([0x67, 0x63, 0x6d, 0x2d, 0x72, 0x6f, 0x6f, 0x74, 0x2d, 0x6b, 0x65, 0x79]);

const rootKeyCache = new Map<string, Uint8Array>();

const deriveRootGCMKey = async (masterKey: string, iterations: number): Promise<Uint8Array> => {
  const masterKeyDigest = bytesToBase64(hashBytes(masterKey, 'SHA-256'));
  const rootCacheKey = `${masterKeyDigest}:${iterations}`;
  const cachedRoot = rootKeyCache.get(rootCacheKey);
  if (cachedRoot) {
    return cachedRoot;
  }
  const rootKey = pbkdf2(masterKey, ROOT_SALT_BYTES, iterations, 64, 'sha256');
  rootKeyCache.set(rootCacheKey, rootKey);
  return rootKey;
};

const deriveGCMKey = async (
  masterKey: string,
  salt: Uint8Array,
  iterationsOverride?: number,
  kdf: GCMKdfMode = 'root-hkdf'
): Promise<Uint8Array> => {
  const iterations = iterationsOverride ?? getGCMIterations();

  if (kdf === 'root-hkdf') {
    // One PBKDF2 per master key; per-record keys cost one cheap HKDF expansion.
    const rootKey = await deriveRootGCMKey(masterKey, iterations);
    return hkdfBytesSync(rootKey, salt, AES_KEY_SIZE);
  }

  const saltStr = bytesToBase64(salt);
  const masterKeyDigest = bytesToBase64(hashBytes(masterKey, 'SHA-256'));
  const cacheKey = `gcm_${masterKeyDigest}_${saltStr}_${iterations}`;

  const cached = gcmKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const derivedBytes = pbkdf2(masterKey, salt, iterations, AES_KEY_SIZE, 'sha256');

    gcmKeyCache.set(cacheKey, derivedBytes);

    return derivedBytes;
  } catch (error) {
    throw new CryptoError('GCM key derivation failed', 'KEY_DERIVE_FAILED', error);
  }
};

/** Bounded LRU cache for derived GCM keys. */
class GCMKeyCache {
  private cache = new Map<string, Uint8Array>();
  private maxSize = 100;

  get(key: string): Uint8Array | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: Uint8Array): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

const gcmKeyCache = new GCMKeyCache();

// === expo-crypto native AES-256-GCM backend ===
// expo-crypto SDK 56+ provides a native AES-GCM implementation
// (AESEncryptionKey / aesEncryptAsync / aesDecryptAsync). When the host
// runtime supplies it (Expo Go, dev builds, standalone apps), prefer it over
// the pure JavaScript AES from @noble/ciphers. Both backends share the exact
// gcm-v1 payload format (salt / iv / ciphertext / tag), so ciphertexts written
// by one backend can be decrypted by the other.

type ExpoAesEncryptionKey = {
  size?: number;
};

type ExpoAesSealedData = {
  ciphertext(options: { encoding: 'bytes' }): Promise<Uint8Array>;
  tag(encoding: 'bytes'): Promise<Uint8Array>;
};

type ExpoAesEncryptionKeyClass = {
  new (): ExpoAesEncryptionKey;
  import(key: Uint8Array): Promise<ExpoAesEncryptionKey>;
};

type ExpoAesSealedDataClass = {
  new (): ExpoAesSealedData;
  fromParts(iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): ExpoAesSealedData;
};

type ExpoAesRuntime = {
  AESEncryptionKey?: ExpoAesEncryptionKeyClass;
  AESSealedData?: ExpoAesSealedDataClass;
  aesEncryptAsync?: (
    plaintext: Uint8Array,
    key: ExpoAesEncryptionKey,
    options: { nonce: { bytes: Uint8Array } }
  ) => Promise<ExpoAesSealedData>;
  aesDecryptAsync?: (
    sealedData: ExpoAesSealedData,
    key: ExpoAesEncryptionKey,
    options: { output: 'bytes' }
  ) => Promise<string | Uint8Array>;
};

let cachedExpoAesModule: ExpoAesRuntime | null | undefined;
let expoAesFallbackWarned = false;
let importedAesKeyCache: { key: string; encryptionKey: Promise<ExpoAesEncryptionKey> } | undefined;

const isExpoAesRuntime = (value: unknown): value is ExpoAesRuntime => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as ExpoAesRuntime;
  return (
    typeof candidate.AESEncryptionKey === 'function' &&
    typeof candidate.AESEncryptionKey.import === 'function' &&
    typeof candidate.AESSealedData === 'function' &&
    typeof candidate.AESSealedData.fromParts === 'function' &&
    typeof candidate.aesEncryptAsync === 'function' &&
    typeof candidate.aesDecryptAsync === 'function'
  );
};

const getExpoAesModule = (): ExpoAesRuntime | null => {
  if (cachedExpoAesModule === undefined) {
    const moduleValue = loadOptionalExpoModule<unknown>('expo-crypto');
    cachedExpoAesModule = isExpoAesRuntime(moduleValue) ? moduleValue : null;
  }
  return cachedExpoAesModule;
};

const warnExpoAesFallbackOnce = (error: unknown): void => {
  if (expoAesFallbackWarned) {
    return;
  }
  expoAesFallbackWarned = true;
  logger.warn(
    `Expo AES-GCM failed, falling back to JavaScript. ${error instanceof Error ? error.message : String(error)}`
  );
};

const importExpoAesKey = (keyBytes: Uint8Array): Promise<ExpoAesEncryptionKey> | null => {
  const importFn = getExpoAesModule()?.AESEncryptionKey?.import;
  if (!importFn) {
    return null;
  }
  const keyBase64 = bytesToBase64(keyBytes);
  if (importedAesKeyCache && importedAesKeyCache.key === keyBase64) {
    return importedAesKeyCache.encryptionKey;
  }
  const encryptionKey = importFn(keyBytes);
  importedAesKeyCache = { key: keyBase64, encryptionKey };
  return encryptionKey;
};

const encryptExpoAesGcm = async (
  plaintextBytes: Uint8Array,
  keyBytes: Uint8Array,
  nonceBytes: Uint8Array
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array } | null> => {
  const expoAes = getExpoAesModule();
  const encryptionKeyPromise = importExpoAesKey(keyBytes);
  if (!expoAes?.aesEncryptAsync || !encryptionKeyPromise) {
    return null;
  }
  try {
    const encryptionKey = await encryptionKeyPromise;
    const sealedData = await expoAes.aesEncryptAsync(plaintextBytes, encryptionKey, {
      nonce: { bytes: nonceBytes },
    });
    return {
      ciphertext: await sealedData.ciphertext({ encoding: 'bytes' }),
      tag: await sealedData.tag('bytes'),
    };
  } catch (error) {
    warnExpoAesFallbackOnce(error);
    return null;
  }
};

const decryptExpoAesGcm = async (
  ciphertextBytes: Uint8Array,
  tagBytes: Uint8Array,
  keyBytes: Uint8Array,
  nonceBytes: Uint8Array
): Promise<Uint8Array | null> => {
  const expoAes = getExpoAesModule();
  const encryptionKeyPromise = importExpoAesKey(keyBytes);
  if (!expoAes?.aesDecryptAsync || !expoAes.AESSealedData || !encryptionKeyPromise) {
    return null;
  }
  try {
    const encryptionKey = await encryptionKeyPromise;
    const sealedData = expoAes.AESSealedData.fromParts(nonceBytes, ciphertextBytes, tagBytes);
    const decrypted = (await expoAes.aesDecryptAsync(sealedData, encryptionKey, {
      output: 'bytes',
    })) as string | Uint8Array;
    return typeof decrypted === 'string' ? base64ToBytes(decrypted) : new Uint8Array(decrypted);
  } catch (error) {
    warnExpoAesFallbackOnce(error);
    return null;
  }
};

/** Detects whether the native expo-crypto AES-256-GCM backend is available. */
export const isExpoAesAvailable = (): boolean => getExpoAesModule() !== null;

/** Encrypts text with AES-256-GCM and returns a base64 payload. */
export const encryptGCM = async (plainText: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();

  try {
    const saltBytes = randomBytes(SALT_SIZE);
    const nonceBytes = randomBytes(GCM_NONCE_SIZE);

    const iterations = getGCMIterations();
    const aesKey = await deriveGCMKey(masterKey, saltBytes, iterations);

    const plainTextBytes = new TextEncoder().encode(plainText);

    let ciphertextBytes: Uint8Array;
    let tag: Uint8Array;
    const expoResult = await encryptExpoAesGcm(plainTextBytes, aesKey, nonceBytes);
    if (expoResult) {
      ciphertextBytes = expoResult.ciphertext;
      tag = expoResult.tag;
    } else {
      const cipher = gcm(aesKey, nonceBytes);
      const encryptedBytes = cipher.encrypt(plainTextBytes);

      // Noble appends the 128-bit tag to the ciphertext; the payload stores it separately.
      const tagSize = 16;
      ciphertextBytes = encryptedBytes.slice(0, -tagSize);
      tag = encryptedBytes.slice(-tagSize);
    }

    const payload: GCMEncryptedPayload = {
      salt: bytesToBase64(saltBytes),
      iv: bytesToBase64(nonceBytes),
      ciphertext: bytesToBase64(ciphertextBytes),
      tag: bytesToBase64(tag),
      version: 'gcm-v1',
      iterations,
      kdf: 'root-hkdf',
    };

    const result = jsonToBase64(JSON.stringify(payload));

    performanceMonitor.record({
      operation: 'encrypt-gcm',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: plainText.length,
    });

    return result;
  } catch (error) {
    performanceMonitor.record({
      operation: 'encrypt-gcm',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: false,
      dataSize: plainText.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new CryptoError('GCM encryption failed', 'ENCRYPT_FAILED', error);
  }
};

/** Authenticates and decrypts a Base64 AES-256-GCM payload. */
export const decryptGCM = async (encryptedBase64: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();

  try {
    const parsed: unknown = base64ToJson(encryptedBase64);
    if (!isGCMEncryptedPayload(parsed)) {
      throw new CryptoError('Unsupported or invalid GCM payload', 'DECRYPT_FAILED');
    }
    const payload = parsed;

    const saltBytes = base64ToBytes(payload.salt);
    const nonceBytes = base64ToBytes(payload.iv);
    const ciphertextBytes = base64ToBytes(payload.ciphertext);
    const tagBytes = base64ToBytes(payload.tag);

    if (saltBytes.length !== SALT_SIZE || nonceBytes.length !== GCM_NONCE_SIZE || tagBytes.length !== 16) {
      throw new CryptoError('GCM payload has invalid binary field lengths', 'DECRYPT_FAILED');
    }

    const iterations =
      typeof payload.iterations === 'number'
        ? normalizePbkdf2Iterations(payload.iterations, MIN_PAYLOAD_ITERATIONS)
        : getGCMIterations();
    const kdf: GCMKdfMode = payload.kdf === 'root-hkdf' ? 'root-hkdf' : 'pbkdf2';
    const aesKey = await deriveGCMKey(masterKey, saltBytes, iterations, kdf);

    const expoPlainBytes = await decryptExpoAesGcm(ciphertextBytes, tagBytes, aesKey, nonceBytes);
    let plainTextBytes: Uint8Array;
    if (expoPlainBytes) {
      plainTextBytes = expoPlainBytes;
    } else {
      // Noble expects the authentication tag appended to the ciphertext.
      const combinedBytes = new Uint8Array(ciphertextBytes.length + tagBytes.length);
      combinedBytes.set(ciphertextBytes);
      combinedBytes.set(tagBytes, ciphertextBytes.length);

      const cipher = gcm(aesKey, nonceBytes);
      plainTextBytes = cipher.decrypt(combinedBytes);
    }
    const result = new TextDecoder().decode(plainTextBytes);

    performanceMonitor.record({
      operation: 'decrypt-gcm',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: encryptedBase64.length,
    });

    return result;
  } catch (error) {
    performanceMonitor.record({
      operation: 'decrypt-gcm',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: false,
      dataSize: encryptedBase64.length,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('GCM decryption failed (wrong key or corrupted data)', 'DECRYPT_FAILED', error);
  }
};

/** Clears derived GCM keys after logout or key reset. */
export const clearGCMKeyCache = (): void => {
  gcmKeyCache.clear();
  rootKeyCache.clear();
  importedAesKeyCache = undefined;
};

export const getGCMKeyCacheSize = (): number => {
  return gcmKeyCache.size + rootKeyCache.size;
};

/** Encrypts a batch while reusing one derived key and a fresh nonce per item. */
export const encryptGCMBulk = async (plainTexts: string[], masterKey: string): Promise<string[]> => {
  if (plainTexts.length === 0) return [];

  try {
    // Reuse the derivation salt, but generate an independent nonce for every item.
    const saltBytes = randomBytes(SALT_SIZE);
    const iterations = getGCMIterations();
    const aesKey = await deriveGCMKey(masterKey, saltBytes, iterations);

    const results: string[] = [];

    for (const plainText of plainTexts) {
      const nonceBytes = randomBytes(GCM_NONCE_SIZE);
      const plainTextBytes = new TextEncoder().encode(plainText);

      let ciphertextBytes: Uint8Array;
      let tag: Uint8Array;
      const expoResult = await encryptExpoAesGcm(plainTextBytes, aesKey, nonceBytes);
      if (expoResult) {
        ciphertextBytes = expoResult.ciphertext;
        tag = expoResult.tag;
      } else {
        const cipher = gcm(aesKey, nonceBytes);
        const encryptedBytes = cipher.encrypt(plainTextBytes);

        const tagSize = 16;
        ciphertextBytes = encryptedBytes.slice(0, -tagSize);
        tag = encryptedBytes.slice(-tagSize);
      }

      const payload: GCMEncryptedPayload = {
        salt: bytesToBase64(saltBytes),
        iv: bytesToBase64(nonceBytes),
        ciphertext: bytesToBase64(ciphertextBytes),
        tag: bytesToBase64(tag),
        version: 'gcm-v1',
        iterations,
        kdf: 'root-hkdf',
      };

      results.push(jsonToBase64(JSON.stringify(payload)));
    }

    return results;
  } catch (error) {
    throw new CryptoError('GCM bulk encryption failed', 'ENCRYPT_FAILED', error);
  }
};

/** Decrypts a batch of AES-256-GCM payloads. */
export const decryptGCMBulk = async (encryptedTexts: string[], masterKey: string): Promise<string[]> => {
  if (encryptedTexts.length === 0) return [];

  try {
    const decryptPromises = encryptedTexts.map(async encryptedText => {
      return decryptGCM(encryptedText, masterKey);
    });

    return await Promise.all(decryptPromises);
  } catch (error) {
    throw new CryptoError('GCM bulk decryption failed', 'DECRYPT_FAILED', error);
  }
};
