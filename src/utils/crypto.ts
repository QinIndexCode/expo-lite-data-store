import bcrypt from 'bcryptjs';
import logger from './logger';
import { performanceMonitor } from '../core/monitor/PerformanceMonitor';
import { configManager } from '../core/config/ConfigManager';

// Use standard ES module imports
import { ctr } from '@noble/ciphers/aes';
import {
  hash as providerHash,
  hashBytes as providerHashBytes,
  hmac as providerHmac,
  hkdfDerive,
  pbkdf2 as providerPbkdf2,
  randomBytes as providerRandomBytes,
} from './cryptoProvider';
import { normalizePbkdf2Iterations } from './cryptoIterations';
import { clearGCMKeyCache, encryptGCM, decryptGCM, encryptGCMBulk, decryptGCMBulk } from './crypto-gcm';
import { CryptoError } from './crypto-errors';
import type {
  BulkEncryptionResult,
  CachedKeyEntry,
  EncryptedPayload,
  FieldEncryptionConfig,
  KeyCacheStats,
} from './crypto-types';
import { loadOptionalExpoModule, loadRequiredExpoModule } from './expoModuleLoader';
import { StorageError } from '../types/storageErrorInfc';
import type { StorageRecord } from '../types/storageTypes';

// Re-export for backward compatibility
export { CryptoError };
export type { KeyCacheStats } from './crypto-types';

type ExpoCryptoModule = typeof import('expo-crypto');
type ExpoSecureStoreModule = typeof import('expo-secure-store');
type ExpoConstantsModule = typeof import('expo-constants').default;

/**
 * Converts Uint8Array to Base64 string using Buffer or btoa.
 *
 * @param bytes Uint8Array to convert
 * @returns Base64 encoded string
 */
const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  } else {
    const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binaryString);
  }
};

/**
 * Converts Base64 string to Uint8Array using Buffer or atob.
 *
 * @param base64 Base64 encoded string
 * @returns Uint8Array of decoded bytes
 */
const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
};

// Dynamic Expo module access keeps import-time side effects out of consumer apps
let Crypto: ExpoCryptoModule | undefined;
let SecureStore: ExpoSecureStoreModule | undefined;
let Constants: ExpoConstantsModule | undefined;
let hasLoadedCryptoModule = false;
let hasLoadedSecureStoreModule = false;
let hasLoadedConstantsModule = false;

const getExpoCryptoModule = (): ExpoCryptoModule | undefined => {
  if (!hasLoadedCryptoModule) {
    Crypto = loadOptionalExpoModule<ExpoCryptoModule>('expo-crypto');
    hasLoadedCryptoModule = true;
  }
  return Crypto;
};

const getOptionalSecureStore = (): ExpoSecureStoreModule | undefined => {
  if (!hasLoadedSecureStoreModule) {
    SecureStore = loadOptionalExpoModule<ExpoSecureStoreModule>('expo-secure-store');
    hasLoadedSecureStoreModule = true;
  }
  return SecureStore;
};

const getRequiredSecureStore = (): ExpoSecureStoreModule => {
  const secureStore = getOptionalSecureStore();
  if (secureStore) {
    return secureStore;
  }
  return loadRequiredExpoModule<ExpoSecureStoreModule>('expo-secure-store');
};

const getExpoConstants = (): ExpoConstantsModule | undefined => {
  if (!hasLoadedConstantsModule) {
    Constants = loadOptionalExpoModule<ExpoConstantsModule>('expo-constants');
    hasLoadedConstantsModule = true;
  }
  return Constants;
};

/**
 * Converts Uint8Array to Base64 string using Buffer or btoa.
 *
 * @param bytes Uint8Array to convert
 * @returns Base64 encoded string
 */
const uint8ArrayToBase64 = (arr: Uint8Array): string => {
  return bytesToBase64(arr);
};

/**
 * Converts Base64 string to Uint8Array using secure conversion.
 *
 * @param str Base64 encoded string
 * @returns Uint8Array of decoded bytes
 */
const base64ToUint8Array = (str: string): Uint8Array => {
  return base64ToBytes(str);
};

/**
 * Serializes object to JSON and then encodes to Base64.
 *
 * @param obj Object to serialize
 * @returns Base64 encoded JSON string
 */
const jsonToBase64 = (obj: unknown): string => {
  const jsonStr = JSON.stringify(obj);
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  return bytesToBase64(utf8Bytes);
};

/**
 * Decodes Base64 string to JSON object.
 *
 * @param str Base64 encoded JSON string
 * @returns Deserialized object
 */
const base64ToJson = <T>(str: string): T => {
  const bytes = base64ToBytes(str);
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr) as T;
};

const MASTER_KEY_ALIAS = 'expo_litedb_master_key_v2025';
const AUTH_MASTER_KEY_ALIAS = 'expo_litedb_master_key_auth_v2026';
const CTR_PAYLOAD_VERSION = 'ctr-v2' as const;
let masterKeyGeneration = 0;
let authMasterKeyProvisioning: Promise<void> | null = null;

/**
 * Changes whenever resetMasterKey successfully removes at least one persisted
 * master-key alias. Long-lived adapters use this to discard stale key promises.
 */
export const getMasterKeyGeneration = (): number => masterKeyGeneration;

let inMemoryStore: Map<string, string> = new Map();

/**
 * Detects if the current environment is Expo Go.
 * Expo Go is Expo's preview app, which may have performance limitations.
 *
 * @returns boolean True if running in Expo Go environment
 */
const isExpoGoEnvironment = (): boolean => {
  try {
    const constants = getExpoConstants();
    if (constants?.appOwnership === 'expo') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

const createAuthOnAccessUnsupportedError = (details: string, cause?: unknown): StorageError =>
  new StorageError('requireAuthOnAccess is not supported in the current runtime', 'AUTH_ON_ACCESS_UNSUPPORTED', {
    cause,
    details,
    suggestion:
      'Use encrypted storage without requireAuthOnAccess in Expo Go, or run in a development build / standalone app with biometric support.',
  });

const createAuthOnAccessMigrationRequiredError = (cause?: unknown): StorageError =>
  new StorageError('Strict per-access authentication requires explicit key and data migration', 'MIGRATION_FAILED', {
    cause,
    details:
      'An existing non-authenticated master key was found. It is never reused or silently migrated for requireAuthOnAccess.',
    suggestion:
      'Migrate encrypted data with an explicit application-controlled flow, then reset the legacy master key before enabling requireAuthOnAccess.',
  });

const ensureAuthOnAccessSupported = async (): Promise<ExpoSecureStoreModule> => {
  const secureStore = getRequiredSecureStore();

  if (isExpoGoEnvironment()) {
    throw createAuthOnAccessUnsupportedError(
      'Expo Go does not support SecureStore requireAuthentication, so strict access authentication cannot be enforced.'
    );
  }

  if (typeof secureStore.canUseBiometricAuthentication === 'function') {
    try {
      const canUseBiometricAuthentication = await secureStore.canUseBiometricAuthentication();
      if (!canUseBiometricAuthentication) {
        throw createAuthOnAccessUnsupportedError(
          'Biometric authentication is unavailable on this device or has not been configured.'
        );
      }
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw createAuthOnAccessUnsupportedError(
        'Unable to verify biometric authentication capability for requireAuthOnAccess.',
        error
      );
    }
  }

  return secureStore;
};

/**
 * Gets the number of iterations for PBKDF2 key derivation.
 * Dynamically adjusts based on the environment:
 * - Expo Go: 20,000 iterations (balance of performance and security)
 * - Production: 100,000 iterations (default)
 * - High-performance devices: Up to 120,000 iterations (optional)
 *
 * @returns number Number of iterations to use
 */
const getIterations = (): number => {
  const configIterations = configManager.getConfig().encryption.keyIterations;
  const boundedIterations = normalizePbkdf2Iterations(configIterations, 10000);

  if (isExpoGoEnvironment()) {
    const expoGoIterations = Math.min(boundedIterations, 20000);
    if (configIterations > 20000) {
      logger.warn(
        `Expo Go detected. Reducing PBKDF2 iterations from ${configIterations} to ${expoGoIterations} for performance.`
      );
    }
    return Math.max(10000, expoGoIterations);
  }

  return boundedIterations;
};

/**
 * Creates the strict key once when its SecureStore alias is empty. Each caller
 * still performs its own authenticated read, so key material is not cached.
 */
const provisionAuthMasterKey = async (
  secureStore: ExpoSecureStoreModule,
  authOptions: { requireAuthentication: true; authenticationPrompt: string }
): Promise<void> => {
  if (!authMasterKeyProvisioning) {
    const provisioning = (async () => {
      const existingKey = await secureStore.getItemAsync(AUTH_MASTER_KEY_ALIAS, authOptions);
      if (existingKey) {
        return;
      }

      let legacyKey: string | null;
      try {
        legacyKey = await secureStore.getItemAsync(MASTER_KEY_ALIAS);
      } catch (error) {
        throw createAuthOnAccessMigrationRequiredError(error);
      }

      if (legacyKey) {
        throw createAuthOnAccessMigrationRequiredError();
      }

      const key = await generateMasterKey();
      await secureStore.setItemAsync(AUTH_MASTER_KEY_ALIAS, key, {
        ...authOptions,
        authenticationPrompt: 'Set encryption key',
      });
    })();

    authMasterKeyProvisioning = provisioning;
    try {
      await provisioning;
    } finally {
      if (authMasterKeyProvisioning === provisioning) {
        authMasterKeyProvisioning = null;
      }
    }
    return;
  }

  await authMasterKeyProvisioning;
};

/** Bounded LRU cache for derived keys. */
class SmartKeyCache {
  /** Internal cache storage */
  private cache = new Map<string, CachedKeyEntry>();
  /** Maximum cache size */
  private maxSize: number;
  /** Maximum age for cache entries (milliseconds) */
  private maxAge: number;
  /** Cache statistics */
  private stats: KeyCacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
  };

  /**
   * Creates a new SmartKeyCache instance
   *
   * @constructor
   * @param maxSize Maximum number of entries to store in cache (default: 500)
   * @param maxAge Maximum age for cache entries in milliseconds (default: 1 hour)
   *
   * @example
   * ```typescript
   * const keyCache = new SmartKeyCache(); // Use default values from config
   * ```
   */
  constructor(maxSize?: number, maxAge?: number) {
    const config = configManager.getConfig();
    this.maxSize = maxSize ?? config.encryption.maxCacheSize ?? 100;
    this.maxAge = maxAge ?? config.encryption.cacheTimeout ?? 30 * 60 * 1000;
  }

  /**
   * Sets a key-value pair in the cache, evicting LRU entry if necessary
   *
   * @param key Cache key
   * @param value Cached key entry
   */
  set(key: string, value: CachedKeyEntry): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, value);
    this.stats.size = this.cache.size;
  }

  /**
   * Gets a cached entry by key, updating access statistics
   *
   * @param key Cache key
   * @returns Cached key entry if found, undefined otherwise
   */
  get(key: string): CachedKeyEntry | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessTime = Date.now();
      this.stats.hits++;
      return entry;
    }
    this.stats.misses++;
    return undefined;
  }

  /**
   * Checks if a key exists in the cache
   *
   * @param key Cache key
   * @returns True if key exists, false otherwise
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Clears all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Cleans up expired entries from the cache
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.maxAge) {
        this.cache.delete(key);
      }
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Evicts the least recently used entry from the cache
   */
  private evictLRU(): void {
    let lruKey: string | undefined;
    let lruScore = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      const score = entry.accessCount * (Date.now() - entry.lastAccessTime);
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
    }
  }

  /**
   * Gets the current cache size
   *
   * @returns Current number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Gets the current cache statistics
   *
   * @returns Key cache statistics
   */
  getStats(): KeyCacheStats {
    return { ...this.stats };
  }

  /**
   * Gets the current cache hit rate
   *
   * @returns Cache hit rate as a decimal (0 to 1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }
}

const keyCache = new SmartKeyCache(50, 30 * 60 * 1000);

export const getKeyCacheStats = (): KeyCacheStats => {
  return keyCache.getStats();
};

export const getKeyCacheHitRate = (): number => {
  return keyCache.getHitRate();
};

/** Clears all derived-key caches, including dependent GCM entries. */
export const clearKeyCache = (): void => {
  keyCache.clear();
  rootKeyCache.clear();
  clearGCMKeyCache();
};

const KEY_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

let keyCacheCleanupTimer: number | NodeJS.Timeout | undefined;
let keyCacheCleanupInitialized = false;

const initializeKeyCacheCleanup = (): void => {
  keyCacheCleanupTimer = setInterval(() => {
    keyCache.cleanup();
  }, KEY_CACHE_CLEANUP_INTERVAL);

  if (typeof window !== 'undefined') {
    const addEventListener = window['addEventListener'];
    if (typeof addEventListener === 'function') {
      addEventListener.call(window, 'beforeunload', clearKeyCache);
    }
  }
};

export const stopKeyCacheCleanup = (): void => {
  if (keyCacheCleanupTimer) {
    clearInterval(keyCacheCleanupTimer);
    keyCacheCleanupTimer = undefined;
  }

  if (typeof window !== 'undefined' && typeof window['removeEventListener'] === 'function') {
    window['removeEventListener']('beforeunload', clearKeyCache);
  }

  keyCacheCleanupInitialized = false;
};

const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

const ensureKeyCacheCleanupInitialized = (): void => {
  if (isTestEnvironment || keyCacheCleanupInitialized) {
    return;
  }

  initializeKeyCacheCleanup();
  keyCacheCleanupInitialized = true;
};

/** Bounds expensive PBKDF2 root-key derivations per master key. */
const ROOT_KEY_CACHE_MAX_SIZE = 50;
const rootKeyCache = new Map<string, Uint8Array>();

const getRootKeyCacheEntry = (cacheKey: string): Uint8Array | undefined => {
  const cached = rootKeyCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  rootKeyCache.delete(cacheKey);
  rootKeyCache.set(cacheKey, cached);
  return cached;
};

const setRootKeyCacheEntry = (cacheKey: string, rootKey: Uint8Array): void => {
  if (rootKeyCache.has(cacheKey)) {
    rootKeyCache.delete(cacheKey);
  } else if (rootKeyCache.size >= ROOT_KEY_CACHE_MAX_SIZE) {
    const oldestCacheKey = rootKeyCache.keys().next().value as string | undefined;
    if (oldestCacheKey) {
      rootKeyCache.delete(oldestCacheKey);
    }
  }

  rootKeyCache.set(cacheKey, rootKey);
};

/** Derives per-record AES and HMAC keys from a cached PBKDF2 root key. */
const deriveKey = async (masterKey: string, salt: Uint8Array): Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> => {
  try {
    ensureKeyCacheCleanupInitialized();

    const iterations = getIterations();
    const rootCacheKey = `${iterations}:${bytesToBase64(providerHashBytes(masterKey, 'SHA-256'))}`;
    let rootKey = getRootKeyCacheEntry(rootCacheKey);

    if (!rootKey) {
      const rootSalt = new Uint8Array([0x72, 0x6f, 0x6f, 0x74, 0x2d, 0x6b, 0x65, 0x79]); // "root-key"
      rootKey = providerPbkdf2(masterKey, rootSalt, iterations, 64, 'sha256');
      setRootKeyCacheEntry(rootCacheKey, rootKey);
    }

    const derivedBytes = hkdfDerive(rootKey, salt, 64);

    const aesKey = derivedBytes.slice(0, 32);
    const hmacKey = derivedBytes.slice(32, 64);

    const result = { aesKey, hmacKey };

    const saltStr = bytesToBase64(salt);
    const cacheKey = `${masterKey.slice(0, 16)}_${saltStr}`;
    const cachedEntry = keyCache.get(cacheKey);
    if (!cachedEntry) {
      keyCache.set(cacheKey, {
        aesKey,
        hmacKey,
        accessCount: 1,
        lastAccessTime: Date.now(),
        createdAt: Date.now(),
      });
    } else {
      cachedEntry.accessCount++;
      cachedEntry.lastAccessTime = Date.now();
    }

    return result;
  } catch (error) {
    throw new CryptoError(`Key derivation failed`, 'KEY_DERIVE_FAILED', error);
  }
};

/**
 * Generates secure random bytes through expo-crypto, browser crypto, or the
 * development-only fallback selected by the crypto provider.
 *
 * @param length Number of random bytes to generate.
 * @returns Secure random bytes.
 */
const getSecureRandomBytes = (length: number): Uint8Array => {
  return providerRandomBytes(length);
};

/** Selects the configured HMAC algorithm or an input-size-based default. */
const selectHMACAlgorithm = (dataSize: number): 'SHA-256' | 'SHA-512' => {
  const config = configManager.getConfig();

  if (config.encryption.autoSelectHMAC === false) {
    return config.encryption.hmacAlgorithm;
  }

  if (config.encryption.hmacAlgorithm === 'SHA-256') {
    return 'SHA-256';
  }

  if (config.encryption.hmacAlgorithm === 'SHA-512') {
    return 'SHA-512';
  }

  const dataSizeKB = dataSize / 1024;

  if (isExpoGoEnvironment()) {
    return dataSizeKB < 64 ? 'SHA-256' : 'SHA-512';
  }

  return dataSizeKB < 50 ? 'SHA-256' : 'SHA-512';
};

/**
 * Computes HMAC for the given data using the specified algorithm.
 *
 * @param data Data to compute HMAC for
 * @param hmacKey HMAC key to use
 * @param algorithm HMAC algorithm to use (defaults to auto-selected)
 * @returns Uint8Array of HMAC signature
 */
const computeHMAC = (data: string, hmacKey: Uint8Array, algorithm?: 'SHA-256' | 'SHA-512'): Uint8Array => {
  const selectedAlgorithm = algorithm || selectHMACAlgorithm(data.length);
  return providerHmac(data, hmacKey, selectedAlgorithm);
};

const constantTimeEqual = (left: string, right: string): boolean => {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
};

const getCtrHmacInput = (payload: Pick<EncryptedPayload, 'version' | 'salt' | 'iv' | 'ciphertext'>): string => {
  if (payload.version === CTR_PAYLOAD_VERSION) {
    return JSON.stringify([CTR_PAYLOAD_VERSION, payload.salt, payload.iv, payload.ciphertext]);
  }

  // Legacy payloads authenticated only the ciphertext. Keep reading them for compatibility.
  return payload.ciphertext;
};

/**
 * Encrypts text using AES-CTR with HMAC authentication.
 *
 * @param plainText Plain text to encrypt
 * @param masterKey Master key for encryption
 * @returns Promise<string> Encrypted text in Base64 format
 *
 * @throws CryptoError If encryption fails
 *
 * @example
 * ```typescript
 * const encrypted = await encrypt('secret text', 'master password');
 * ```
 */
export const encrypt = async (plainText: string, masterKey: string): Promise<string> => {
  const algorithm = configManager.getConfig().encryption.algorithm || 'auto';

  // Use GCM for 'auto' or 'AES-GCM' (new data defaults to GCM)
  if (algorithm === 'AES-GCM' || algorithm === 'auto') {
    return encryptGCM(plainText, masterKey);
  }

  // Fallback to CTR+HMAC for explicit 'AES-CTR'
  return encryptCTR(plainText, masterKey);
};

/**
 * Internal CTR+HMAC encryption (kept for backward compatibility)
 */
const encryptCTR = async (plainText: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();
  try {
    const saltBytes = getSecureRandomBytes(16);
    const ivBytes = getSecureRandomBytes(16);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);

    const saltStr = uint8ArrayToBase64(saltBytes);
    const ivStr = uint8ArrayToBase64(ivBytes);

    const plainTextBytes = new TextEncoder().encode(plainText);
    const cipher = ctr(aesKey, ivBytes);
    const ciphertextBytes = cipher.encrypt(plainTextBytes);
    const ciphertextBase64 = bytesToBase64(ciphertextBytes);

    const payload: EncryptedPayload = {
      version: CTR_PAYLOAD_VERSION,
      salt: saltStr,
      iv: ivStr,
      ciphertext: ciphertextBase64,
      hmac: '',
    };
    const hmacBytes = computeHMAC(getCtrHmacInput(payload), hmacKey);
    payload.hmac = bytesToBase64(hmacBytes);

    const result = jsonToBase64(payload);

    performanceMonitor.record({
      operation: 'encrypt',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: plainText.length,
    });

    return result;
  } catch (error) {
    performanceMonitor.record({
      operation: 'encrypt',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: false,
      dataSize: plainText.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new CryptoError('Encryption failed', 'ENCRYPT_FAILED', error);
  }
};

/**
 * Decrypts text using AES-CTR with HMAC authentication.
 *
 * @param encryptedBase64 Encrypted text in Base64 format
 * @param masterKey Master key for decryption
 * @returns Promise<string> Decrypted plain text
 *
 * @throws CryptoError If decryption fails or HMAC verification fails
 *
 * @example
 * ```typescript
 * const decrypted = await decrypt(encryptedText, 'master password');
 * ```
 */
export const decrypt = async (encryptedBase64: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();
  try {
    // Auto-detect encryption version by parsing the payload
    const jsonBytes = base64ToBytes(encryptedBase64);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(jsonStr);

    // Check if this is a GCM payload
    if (payload && payload.version === 'gcm-v1') {
      const result = await decryptGCM(encryptedBase64, masterKey);
      performanceMonitor.record({
        operation: 'decrypt',
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        success: true,
        dataSize: encryptedBase64.length,
      });
      return result;
    }

    // Fallback to CTR+HMAC decryption
    return decryptCTR(encryptedBase64, masterKey);
  } catch (error) {
    performanceMonitor.record({
      operation: 'decrypt',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: false,
      dataSize: encryptedBase64.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new CryptoError('Decryption failed (wrong key or corrupted data)', 'DECRYPT_FAILED', error);
  }
};

/**
 * Internal CTR+HMAC decryption (kept for backward compatibility)
 */
const decryptCTR = async (encryptedBase64: string, masterKey: string): Promise<string> => {
  try {
    const payload: EncryptedPayload = base64ToJson(encryptedBase64);

    if (
      !payload ||
      typeof payload.salt !== 'string' ||
      typeof payload.iv !== 'string' ||
      typeof payload.ciphertext !== 'string' ||
      typeof payload.hmac !== 'string' ||
      (payload.version !== undefined && payload.version !== CTR_PAYLOAD_VERSION)
    ) {
      throw new CryptoError('Unsupported or invalid CTR payload', 'DECRYPT_FAILED');
    }

    const saltUint8Array = base64ToUint8Array(payload.salt);
    const ivBytes = base64ToUint8Array(payload.iv);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

    const computedHmacBytes = computeHMAC(getCtrHmacInput(payload), hmacKey);
    const computedHmacBase64 = bytesToBase64(computedHmacBytes);

    if (!constantTimeEqual(computedHmacBase64, payload.hmac)) {
      throw new CryptoError('HMAC mismatch: data tampered or wrong key', 'HMAC_MISMATCH');
    }

    const ciphertextBytes = base64ToBytes(payload.ciphertext);
    const cipher = ctr(aesKey, ivBytes);
    const plainTextBytes = cipher.decrypt(ciphertextBytes);
    return new TextDecoder().decode(plainTextBytes);
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('Decryption failed (wrong key or corrupted data)', 'DECRYPT_FAILED', error);
  }
};

/**
 * Gets the encryption master key from secure storage, or from the test-only
 * in-memory fallback when no secure store is available.
 *
 * @param requireAuthOnAccess Whether biometric authentication is required for each access.
 * @returns The master encryption key.
 * @throws CryptoError when key retrieval or generation fails.
 */
export const getMasterKey = async (requireAuthOnAccess: boolean = false): Promise<string> => {
  const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  ensureKeyCacheCleanupInitialized();

  try {
    if (requireAuthOnAccess) {
      const secureStore = await ensureAuthOnAccessSupported();
      const authOptions = {
        requireAuthentication: true as const,
        authenticationPrompt: 'Authenticate to access database',
      };
      let key = await secureStore.getItemAsync(AUTH_MASTER_KEY_ALIAS, authOptions);

      if (!key) {
        await provisionAuthMasterKey(secureStore, authOptions);
        key = await secureStore.getItemAsync(AUTH_MASTER_KEY_ALIAS, authOptions);
        if (!key) {
          throw new CryptoError('Strict master key was not persisted after provisioning', 'KEY_DERIVE_FAILED');
        }
      }

      return key;
    }

    const secureStore = getOptionalSecureStore();
    if (secureStore) {
      try {
        let key = await secureStore.getItemAsync(MASTER_KEY_ALIAS);

        if (!key) {
          key = await generateMasterKey();
          await secureStore.setItemAsync(MASTER_KEY_ALIAS, key);
        }

        return key;
      } catch (secureStoreError) {
        if (!isTestEnvironment) {
          throw new CryptoError(
            'SecureStore unavailable; refusing non-persistent master key fallback',
            'KEY_DERIVE_FAILED',
            secureStoreError
          );
        }
        logger.warn(
          'SecureStore unavailable in test environment, using in-memory key storage fallback:',
          secureStoreError
        );
      }
    } else if (!isTestEnvironment) {
      throw new CryptoError(
        'SecureStore not available; refusing non-persistent master key fallback',
        'KEY_DERIVE_FAILED'
      );
    }

    let key = inMemoryStore.get(MASTER_KEY_ALIAS);
    if (!key) {
      key = await generateMasterKey();
      inMemoryStore.set(MASTER_KEY_ALIAS, key);
    }

    return key;
  } catch (error) {
    if (requireAuthOnAccess) {
      throw error;
    }

    logger.error('Failed to retrieve encryption key:', error);
    if (!isTestEnvironment) {
      throw error;
    }

    logger.warn('All key retrieval methods failed in test environment, generating in-memory key as last resort');

    let key = inMemoryStore.get(MASTER_KEY_ALIAS);
    if (!key) {
      key = await generateMasterKey();
      inMemoryStore.set(MASTER_KEY_ALIAS, key);
    }

    return key;
  }
};

// resetMasterKey for logout/reset
export const resetMasterKey = async (): Promise<void> => {
  let removedKeyMaterial = false;

  try {
    const secureStore = getOptionalSecureStore();
    if (secureStore) {
      const deletions = await Promise.allSettled([
        secureStore.deleteItemAsync(MASTER_KEY_ALIAS),
        secureStore.deleteItemAsync(AUTH_MASTER_KEY_ALIAS),
      ]);
      removedKeyMaterial = deletions.some(result => result.status === 'fulfilled');

      const failedDeletion = deletions.find(result => result.status === 'rejected');
      if (failedDeletion?.status === 'rejected') {
        throw new CryptoError('Failed to reset all persisted master keys', 'KEY_DERIVE_FAILED', failedDeletion.reason);
      }
    } else {
      const removedNormalKey = inMemoryStore.delete(MASTER_KEY_ALIAS);
      const removedAuthKey = inMemoryStore.delete(AUTH_MASTER_KEY_ALIAS);
      removedKeyMaterial = removedNormalKey || removedAuthKey;
    }
  } finally {
    clearKeyCache();
    if (removedKeyMaterial) {
      masterKeyGeneration++;
    }
  }
};

/** Warms a small set of derived keys for the next encryption operations. */
export const precomputeCommonKeys = async (): Promise<void> => {
  try {
    const masterKey = await getMasterKey();
    if (!masterKey) {
      logger.warn('Master key not available, skipping key precomputation');
      return;
    }

    const commonSalts = [getSecureRandomBytes(16), getSecureRandomBytes(16), getSecureRandomBytes(16)];

    logger.info(`Precomputing ${commonSalts.length} common keys for better performance`);

    await Promise.all(commonSalts.map(salt => deriveKey(masterKey, salt)));

    logger.info('Key precomputation completed');
  } catch (error) {
    logger.warn('Failed to precompute common keys:', error);
  }
};

/** Generates a new 256-bit master key. */
export const generateMasterKey = async (): Promise<string> => {
  try {
    const bytes = getSecureRandomBytes(32);
    return uint8ArrayToBase64(bytes);
  } catch (error) {
    logger.error('Failed to generate secure random bytes:', error);
    const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (!isTestEnvironment) {
      throw new CryptoError('Secure random generation not available', 'KEY_DERIVE_FAILED', error);
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return uint8ArrayToBase64(bytes);
  }
};

/** Hashes a password with bcrypt. */
export const hashPassword = async (password: string, saltRounds: number = 12): Promise<string> => {
  try {
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    throw new CryptoError('Password hashing failed', 'HASH_FAILED', error);
  }
};

/** Verifies a password against a bcrypt hash. */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    throw new CryptoError('Password verification failed', 'VERIFY_FAILED', error);
  }
};

export const generateSalt = async (rounds: number = 12): Promise<string> => {
  try {
    return await bcrypt.genSalt(rounds);
  } catch (error) {
    throw new CryptoError('Salt generation failed', 'HASH_FAILED', error);
  }
};

/** Encrypts a batch of plaintext values using the configured algorithm. */
export const encryptBulk = async (plainTexts: string[], masterKey: string): Promise<string[]> => {
  if (plainTexts.length === 0) return [];

  const algorithm = configManager.getConfig().encryption.algorithm || 'auto';

  if (algorithm === 'AES-GCM' || algorithm === 'auto') {
    return encryptGCMBulk(plainTexts, masterKey);
  }

  return encryptBulkCTR(plainTexts, masterKey);
};

/**
 * Internal CTR+HMAC bulk encryption (kept for backward compatibility)
 */
const encryptBulkCTR = async (plainTexts: string[], masterKey: string): Promise<string[]> => {
  if (plainTexts.length === 0) return [];

  try {
    const saltBytes = getSecureRandomBytes(16);
    const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);
    const saltStr = uint8ArrayToBase64(saltBytes);
    const encryptedResults: BulkEncryptionResult[] = [];

    for (const plainText of plainTexts) {
      const ivBytes = getSecureRandomBytes(16);
      const ivStr = uint8ArrayToBase64(ivBytes);
      const plainTextBytes = new TextEncoder().encode(plainText);
      const cipher = ctr(aesKey, ivBytes);
      const ciphertextBytes = cipher.encrypt(plainTextBytes);
      const ciphertextBase64 = bytesToBase64(ciphertextBytes);
      const payload: EncryptedPayload = {
        version: CTR_PAYLOAD_VERSION,
        salt: saltStr,
        iv: ivStr,
        ciphertext: ciphertextBase64,
        hmac: '',
      };
      payload.hmac = bytesToBase64(computeHMAC(getCtrHmacInput(payload), hmacKey));

      encryptedResults.push({
        encryptedData: ciphertextBase64,
        salt: saltStr,
        iv: ivStr,
        hmac: payload.hmac,
      });
    }

    return encryptedResults.map(result => {
      const payload: EncryptedPayload = {
        version: CTR_PAYLOAD_VERSION,
        salt: result.salt,
        iv: result.iv,
        ciphertext: result.encryptedData,
        hmac: result.hmac,
      };
      return jsonToBase64(payload);
    });
  } catch (error) {
    throw new CryptoError('Bulk encryption failed', 'ENCRYPT_FAILED', error);
  }
};

/** Decrypts a batch of ciphertext values and detects GCM payloads. */
export const decryptBulk = async (encryptedTexts: string[], masterKey: string): Promise<string[]> => {
  if (encryptedTexts.length === 0) return [];

  // GCM payloads are self-identifying; legacy payloads use CTR.
  try {
    const jsonBytes = base64ToBytes(encryptedTexts[0]);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const firstPayload = JSON.parse(jsonStr);

    if (firstPayload && firstPayload.version === 'gcm-v1') {
      return decryptGCMBulk(encryptedTexts, masterKey);
    }
  } catch {}

  return decryptBulkCTR(encryptedTexts, masterKey);
};

/**
 * Internal CTR+HMAC bulk decryption (kept for backward compatibility)
 */
const decryptBulkCTR = async (encryptedTexts: string[], masterKey: string): Promise<string[]> => {
  if (encryptedTexts.length === 0) return [];

  try {
    const decryptPromises = encryptedTexts.map(async encryptedText => {
      const payload: EncryptedPayload = base64ToJson(encryptedText);

      if (
        !payload ||
        typeof payload.salt !== 'string' ||
        typeof payload.iv !== 'string' ||
        typeof payload.ciphertext !== 'string' ||
        typeof payload.hmac !== 'string' ||
        (payload.version !== undefined && payload.version !== CTR_PAYLOAD_VERSION)
      ) {
        throw new CryptoError('Unsupported or invalid CTR payload', 'DECRYPT_FAILED');
      }

      const saltUint8Array = base64ToUint8Array(payload.salt);
      const ivBytes = base64ToUint8Array(payload.iv);

      const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

      const computedHmacBytes = computeHMAC(getCtrHmacInput(payload), hmacKey);
      const computedHmacBase64 = bytesToBase64(computedHmacBytes);

      if (!constantTimeEqual(computedHmacBase64, payload.hmac)) {
        throw new CryptoError('HMAC mismatch: data tampered or wrong key', 'HMAC_MISMATCH');
      }

      const ciphertextBytes = base64ToBytes(payload.ciphertext);
      const cipher = ctr(aesKey, ivBytes);
      const plainTextBytes = cipher.decrypt(ciphertextBytes);
      return new TextDecoder().decode(plainTextBytes);
    });

    return await Promise.all(decryptPromises);
  } catch (error) {
    throw new CryptoError('Bulk decryption failed', 'DECRYPT_FAILED', error);
  }
};

/** Generates a SHA-256 or SHA-512 digest. */
export const generateHash = async (data: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Promise<string> => {
  try {
    ensureKeyCacheCleanupInitialized();

    const crypto = getExpoCryptoModule();
    if (crypto?.digestStringAsync) {
      switch (algorithm) {
        case 'SHA-256':
          return await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, data);
        case 'SHA-512':
          return await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA512, data);
        default:
          throw new CryptoError(`Unsupported hash algorithm: ${algorithm}`, 'HASH_FAILED');
      }
    } else {
      logger.warn('Expo Crypto not available, using JavaScript hashing fallback');
      return providerHash(data, algorithm);
    }
  } catch (error) {
    throw new CryptoError('Hash generation failed', 'HASH_FAILED', error);
  }
};

const FIELD_VALUE_PREFIX = '__expo_lite_data_store_field_v1__:';
const UNSAFE_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

const assertSafeFieldNames = (fields: string[], code: 'ENCRYPT_FAILED' | 'DECRYPT_FAILED'): void => {
  for (const field of fields) {
    if (UNSAFE_FIELD_NAMES.has(field)) {
      throw new CryptoError(`Unsafe field name for field encryption: ${field}`, code);
    }
  }
};

const serializeFieldValue = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new CryptoError('Field values must be JSON-serializable', 'ENCRYPT_FAILED');
  }

  return `${FIELD_VALUE_PREFIX}${serialized}`;
};

const deserializeFieldValue = (value: string): unknown => {
  if (value.startsWith(FIELD_VALUE_PREFIX)) {
    try {
      return JSON.parse(value.slice(FIELD_VALUE_PREFIX.length));
    } catch (error) {
      throw new CryptoError('Field encryption payload is invalid', 'DECRYPT_FAILED', error);
    }
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Encrypts configured record fields while preserving their serialized types. */
export const encryptFields = async (
  data: StorageRecord,
  fieldConfig: FieldEncryptionConfig
): Promise<StorageRecord> => {
  assertSafeFieldNames(fieldConfig.fields, 'ENCRYPT_FAILED');
  const result = { ...data };

  const fieldsToEncrypt = fieldConfig.fields.filter(field => result[field] !== undefined && result[field] !== null);
  const valuesToEncrypt = fieldsToEncrypt.map(field => serializeFieldValue(result[field]));
  if (valuesToEncrypt.length > 0) {
    const encryptedValues = await encryptBulk(valuesToEncrypt, fieldConfig.masterKey);
    encryptedValues.forEach((enc, idx) => {
      const field = fieldsToEncrypt[idx];
      result[field] = enc;
    });
  }
  return result;
};
/** Decrypts configured record fields and restores their serialized types. */
export const decryptFields = async (
  data: StorageRecord,
  fieldConfig: FieldEncryptionConfig
): Promise<StorageRecord> => {
  assertSafeFieldNames(fieldConfig.fields, 'DECRYPT_FAILED');
  const result = { ...data };
  const fieldsToDecrypt = fieldConfig.fields.filter(
    field => result[field] !== undefined && result[field] !== null && typeof result[field] === 'string'
  );

  if (fieldsToDecrypt.length === 0) return result;

  const decryptPromises = fieldsToDecrypt.map(async field => {
    const encryptedValue = result[field] as string;
    const decryptedStr = await decrypt(encryptedValue, fieldConfig.masterKey);
    result[field] = deserializeFieldValue(decryptedStr);
  });

  await Promise.all(decryptPromises);
  return result;
};
/** Encrypts configured fields across records with one bulk operation per field. */
export const encryptFieldsBulk = async (
  dataArray: StorageRecord[],
  fieldConfig: FieldEncryptionConfig
): Promise<StorageRecord[]> => {
  assertSafeFieldNames(fieldConfig.fields, 'ENCRYPT_FAILED');
  if (dataArray.length === 0) return dataArray;

  const fieldValues: Record<string, string[]> = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null)
      .map(serializeFieldValue);
  });

  const encryptionPromises: Promise<void>[] = [];
  const encryptedValues: Record<string, string[]> = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    encryptionPromises.push(
      encryptBulk(values, fieldConfig.masterKey).then(encrypted => {
        encryptedValues[field] = encrypted;
      })
    );
  }

  await Promise.all(encryptionPromises);

  const fieldOffsets: Record<string, number> = {};
  return dataArray.map(item => {
    const result = { ...item };
    fieldConfig.fields.forEach(field => {
      if (item[field] !== undefined && item[field] !== null) {
        const fieldIndex = fieldOffsets[field] ?? 0;
        fieldOffsets[field] = fieldIndex + 1;
        const encryptedValue = encryptedValues[field]?.[fieldIndex];
        if (encryptedValue !== undefined) {
          result[field] = encryptedValue;
        }
      }
    });
    return result;
  });
};

/** Decrypts configured fields across records with one bulk operation per field. */
export const decryptFieldsBulk = async (
  dataArray: StorageRecord[],
  fieldConfig: FieldEncryptionConfig
): Promise<StorageRecord[]> => {
  assertSafeFieldNames(fieldConfig.fields, 'DECRYPT_FAILED');
  if (dataArray.length === 0) return dataArray;

  const fieldValues: Record<string, string[]> = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null && typeof value === 'string');
  });

  const decryptionPromises: Promise<void>[] = [];
  const decryptedValues: Record<string, unknown[]> = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    decryptionPromises.push(
      decryptBulk(values, fieldConfig.masterKey).then(decrypted => {
        decryptedValues[field] = decrypted.map(deserializeFieldValue);
      })
    );
  }

  await Promise.all(decryptionPromises);

  const fieldOffsets: Record<string, number> = {};
  return dataArray.map(item => {
    const result = { ...item };

    fieldConfig.fields.forEach(field => {
      if (item[field] !== undefined && item[field] !== null && typeof item[field] === 'string') {
        const fieldIndex = fieldOffsets[field] ?? 0;
        fieldOffsets[field] = fieldIndex + 1;
        const decryptedValue = decryptedValues[field]?.[fieldIndex];
        if (decryptedValue !== undefined) {
          result[field] = decryptedValue;
        }
      }
    });

    return result;
  });
};
