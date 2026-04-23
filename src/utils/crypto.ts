/**
 * Encryption utility module
 * Expo SDK 54 compliant version (AES-256-CTR + HMAC-SHA512 emulates GCM)
 * Dependencies: expo-crypto (randomness) + @noble/ciphers (encryption) + @noble/hashes (HMAC & hashing)
 *
 * @module crypto
 * @since 2025-11-17
 * @version 2.0.0
 * @changelog
 *   - 2025-11-17: Initial implementation for Expo SDK 54
 *   - 2025-12-09: Fixed Base64 encoding/decoding issues in Expo environment
 *   - 2026-01-20: Migrated from crypto-es to @noble/ciphers and @noble/hashes
 */
import bcrypt from 'bcryptjs';
import logger from './logger';
import { performanceMonitor } from '../core/monitor/PerformanceMonitor';
import { configManager } from '../core/config/ConfigManager';

// Use standard ES module imports
import { ctr } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex } from '@noble/hashes/utils';
import { pbkdf2 as providerPbkdf2, randomBytes as providerRandomBytes, hkdfDerive } from './cryptoProvider';
import { encryptGCM, decryptGCM, encryptGCMBulk, decryptGCMBulk } from './crypto-gcm';
import { CryptoError } from './crypto-errors';
import { loadOptionalExpoModule, loadRequiredExpoModule } from './expoModuleLoader';
import { StorageError } from '../types/storageErrorInfc';

// Re-export for backward compatibility
export { CryptoError };

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
const jsonToBase64 = (obj: any): string => {
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
const base64ToJson = (str: string): any => {
  const bytes = base64ToBytes(str);
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr);
};

/**
 * Interface representing an encrypted payload structure
 *
 * @interface EncryptedPayload
 * @since 2025-11-17
 */
interface EncryptedPayload {
  /** Base64 encoded salt value */
  salt: string;
  /** Base64 encoded initialization vector */
  iv: string;
  /** Base64 encoded ciphertext */
  ciphertext: string;
  /** HMAC-SHA512 signature (Base64, simulates GCM tag) */
  hmac: string;
}

/**
 * 涓诲瘑閽ュ埆鍚? */
const MASTER_KEY_ALIAS = 'expo_litedb_master_key_v2025';

/**
 * 闈?Expo 鐜涓嬬殑鍐呭瓨瀛樺偍鍥為€€
 */
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

  if (isExpoGoEnvironment()) {
    const expoGoIterations = Math.min(configIterations, 20000);
    if (configIterations > 20000) {
      logger.warn(
        `Expo Go detected. Reducing PBKDF2 iterations from ${configIterations} to ${expoGoIterations} for performance.`
      );
    }
    return Math.max(10000, expoGoIterations);
  }

  return Math.max(10000, Math.min(configIterations, 1000000));
};

/**
 * Interface representing a cached key entry with LRU tracking
 *
 * @interface CachedKeyEntry
 * @since 2025-11-17
 */
export interface CachedKeyEntry {
  /** AES encryption key */
  aesKey: Uint8Array;
  /** HMAC verification key */
  hmacKey: Uint8Array;
  /** Number of times this key has been accessed */
  accessCount: number;
  /** Timestamp of last access */
  lastAccessTime: number;
  /** Timestamp of creation */
  createdAt: number;
}

/**
 * Interface representing key cache statistics
 *
 * @interface KeyCacheStats
 * @since 2025-11-17
 */
export interface KeyCacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of cache evictions */
  evictions: number;
  /** Current cache size */
  size: number;
}

/**
 * Smart key cache with LRU eviction policy to avoid memory overflow
 *
 * @class SmartKeyCache
 * @since 2025-11-17
 */
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

/**
 * 鑾峰彇瀵嗛挜缂撳瓨缁熻淇℃伅
 */
export const getKeyCacheStats = (): KeyCacheStats => {
  return keyCache.getStats();
};

/**
 * 鑾峰彇瀵嗛挜缂撳瓨鍛戒腑鐜? */
export const getKeyCacheHitRate = (): number => {
  return keyCache.getHitRate();
};

/**
 * 娓呴櫎瀵嗛挜缂撳瓨锛堢敤浜庣櫥鍑烘垨閲嶇疆锛? */
export const clearKeyCache = (): void => {
  keyCache.clear();
  rootKeyCache.clear();
};

/**
 * 瀵嗛挜缂撳瓨鑷姩娓呯悊闂撮殧锛?0鍒嗛挓锛? */
const KEY_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

// Save瀹氭椂鍣?ID - 鍏煎 Node.js 鍜屾祻瑙堝櫒鐜
// Node.js 涓?setInterval 杩斿洖 number锛屾祻瑙堝櫒涓繑鍥?Timeout 瀵硅薄
let keyCacheCleanupTimer: number | NodeJS.Timeout | undefined;
let keyCacheCleanupInitialized = false;

/**
 * 鍒濆鍖栧瘑閽ョ紦瀛樿嚜鍔ㄦ竻鐞? */
const initializeKeyCacheCleanup = (): void => {
  // Periodically clean expired key cache (every 10 minutes)
  keyCacheCleanupTimer = setInterval(() => {
    keyCache.cleanup();
  }, KEY_CACHE_CLEANUP_INTERVAL);

  // Clear cache on page unload
  // Explicitly check if window.addEventListener exists锛岄槻姝eact Native鐜鎶ラ敊
  // Use complex check to prevent compiler optimization
  if (typeof window !== 'undefined') {
    // In React Native, window exists but addEventListener does not
    // Use typeof check to ensure method exists
    const addEventListener = window['addEventListener'];
    if (typeof addEventListener === 'function') {
      addEventListener.call(window, 'beforeunload', clearKeyCache);
    }
  }
};

/**
 * 鍋滄瀵嗛挜缂撳瓨娓呯悊瀹氭椂鍣? */
export const stopKeyCacheCleanup = (): void => {
  // Clear timer
  if (keyCacheCleanupTimer) {
    clearInterval(keyCacheCleanupTimer);
    keyCacheCleanupTimer = undefined;
  }

  // Clear page unload event listener
  // Explicitly check if window.removeEventListener exists锛岄槻姝eact Native鐜鎶ラ敊
  // Use bracket syntax to prevent compiler optimization
  if (typeof window !== 'undefined' && typeof window['removeEventListener'] === 'function') {
    window['removeEventListener']('beforeunload', clearKeyCache);
  }

  keyCacheCleanupInitialized = false;
};

// Initialize鏃跺惎鍔ㄨ嚜鍔ㄦ竻鐞?// But not auto-start in test to avoid Jest open handle detection
// Ensure correct detection in all environments including browser
const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

const ensureKeyCacheCleanupInitialized = (): void => {
  if (isTestEnvironment || keyCacheCleanupInitialized) {
    return;
  }

  initializeKeyCacheCleanup();
  keyCacheCleanupInitialized = true;
};

/**
 * Root key cache: stores PBKDF2-derived root keys per masterKey.
 * This is the expensive one-time operation. Once we have the root key,
 * all subsequent per-record key derivations use fast HKDF (~3渭s vs ~2s).
 */
const rootKeyCache = new Map<string, Uint8Array>();

/**
 * Derives AES and HMAC keys from master key and salt.
 *
 * Two-tier architecture for performance:
 * 1. PBKDF2 (one-time, slow ~2s): masterKey + fixed_salt 鈫?rootKey (64 bytes)
 * 2. HKDF (per-record, fast ~3渭s): rootKey + salt 鈫?AES+HMAC keys (64 bytes)
 *
 * This eliminates the ~2s stall on every unique salt in Expo Go.
 *
 * @param masterKey Master key for derivation
 * @param salt Salt for key derivation
 * @returns Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> Derived AES and HMAC keys
 *
 * @throws CryptoError If key derivation fails
 */
const deriveKey = async (masterKey: string, salt: Uint8Array): Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> => {
  try {
    ensureKeyCacheCleanupInitialized();

    // Step 1: Get or derive root key (PBKDF2, one-time per masterKey)
    const masterKeyHash = bytesToHex(sha256(masterKey));
    let rootKey = rootKeyCache.get(masterKeyHash);

    if (!rootKey) {
      // First time: expensive PBKDF2 operation (~2s in Expo Go with 20K iterations)
      // Use a fixed salt for root key derivation (root key is only used as HKDF input)
      const rootSalt = new Uint8Array([0x72, 0x6f, 0x6f, 0x74, 0x2d, 0x6b, 0x65, 0x79]); // "root-key"
      const iterations = getIterations();
      rootKey = providerPbkdf2(masterKey, rootSalt, iterations, 64, 'sha256');
      rootKeyCache.set(masterKeyHash, rootKey);
    }

    // Step 2: Fast HKDF-expand for per-record keys (~3渭s)
    const derivedBytes = hkdfDerive(rootKey, salt, 64);

    // Split derived key: first 32 bytes for AES, last 32 bytes for HMAC
    const aesKey = derivedBytes.slice(0, 32);
    const hmacKey = derivedBytes.slice(32, 64);

    const result = { aesKey, hmacKey };

    // Also cache in the LRU keyCache for stats tracking
    const saltStr = bytesToBase64(salt);
    const cacheKey = `${masterKeyHash.substring(0, 16)}_${saltStr}`;
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
 * Generates secure random bytes using the most secure available method.
 * Falls back to less secure methods if secure options are unavailable.
 *
 * @param length Number of random bytes to generate
 * @returns Uint8Array of secure random bytes
 *
 * @description
 * - Uses expo-crypto if available
 * - Falls back to crypto.getRandomValues in browser environments
 * - Uses Math.random as last resort (insecure, only for development)
 */
const getSecureRandomBytes = (length: number): Uint8Array => {
  return providerRandomBytes(length);
};

/**
 * 鏍规嵁鏁版嵁澶у皬鍜岄厤缃€夋嫨HMAC绠楁硶
 * 灏忔暟鎹娇鐢⊿HA-256锛堟洿蹇級锛屽ぇ鏁版嵁浣跨敤SHA-512锛堟洿瀹夊叏锛? */
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

  const hashFn = selectedAlgorithm === 'SHA-256' ? sha256 : sha512;
  return hmac(hashFn, hmacKey, data);
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

    const hmacBytes = computeHMAC(ciphertextBase64, hmacKey);
    const hmacBase64 = bytesToBase64(hmacBytes);

    const payload: EncryptedPayload = {
      salt: saltStr,
      iv: ivStr,
      ciphertext: ciphertextBase64,
      hmac: hmacBase64,
    };

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

    const saltUint8Array = base64ToUint8Array(payload.salt);
    const ivBytes = base64ToUint8Array(payload.iv);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

    const computedHmacBytes = computeHMAC(payload.ciphertext, hmacKey);
    const computedHmacBase64 = bytesToBase64(computedHmacBytes);

    if (computedHmacBase64 !== payload.hmac) {
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
 * Gets the master key for encryption operations.
 *
 * @param requireAuthOnAccess Whether biometric authentication is required for each access (defaults to false)
 * @returns Promise<string> Master encryption key
 *
 * @throws CryptoError If master key retrieval or generation fails
 *
 * @description
 * - Uses expo-secure-store if available
 * - Falls back to in-memory storage if secure storage is unavailable
 * - Supports biometric authentication when required
 */
export const getMasterKey = async (requireAuthOnAccess: boolean = false): Promise<string> => {
  const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  ensureKeyCacheCleanupInitialized();

  try {
    if (requireAuthOnAccess) {
      const secureStore = await ensureAuthOnAccessSupported();
      let key = await secureStore.getItemAsync(MASTER_KEY_ALIAS, {
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to access database',
      });

      if (!key) {
        key = await generateMasterKey();
        await secureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
          requireAuthentication: true,
          authenticationPrompt: 'Set encryption key',
        });
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
        logger.warn('SecureStore unavailable, using in-memory key storage fallback:', secureStoreError);
      }
    } else if (!isTestEnvironment) {
      logger.warn('SecureStore not available, using in-memory master key storage');
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
    logger.warn('All key retrieval methods failed, generating in-memory key as last resort');

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
  try {
    const secureStore = getOptionalSecureStore();
    if (secureStore) {
      await secureStore.deleteItemAsync(MASTER_KEY_ALIAS);
    } else {
      inMemoryStore.delete(MASTER_KEY_ALIAS);
    }
  } catch (error) {
    logger.warn('Failed to reset master key:', error);
    inMemoryStore.delete(MASTER_KEY_ALIAS);
  }

  clearKeyCache();
};

/**
 * 棰勮绠楀父鐢ㄥ瘑閽ワ紝鍑忓皯棣栨鍔犲瘑鏃剁殑瀵嗛挜娲剧敓鏃堕棿
 *
 * @returns Promise<void>
 */
export const precomputeCommonKeys = async (): Promise<void> => {
  try {
    const masterKey = await getMasterKey();
    if (!masterKey) {
      logger.warn('Master key not available, skipping key precomputation');
      return;
    }

    // Pre-compute 3 common keys
    const commonSalts = [getSecureRandomBytes(16), getSecureRandomBytes(16), getSecureRandomBytes(16)];

    logger.info(`Precomputing ${commonSalts.length} common keys for better performance`);

    // Parallel棰勮绠楁墍鏈夊瘑閽?    await Promise.all(commonSalts.map(salt => deriveKey(masterKey, salt)));

    logger.info('Key precomputation completed');
  } catch (error) {
    logger.warn('Failed to precompute common keys:', error);
  }
};

/**
 * 鐢熸垚涓诲瘑閽ワ紙32 瀛楄妭闅忔満锛? * @returns 涓诲瘑閽? */
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

// ==================== bcrypt 瀵嗙爜鍝堝笇鍔熻兘 ====================

/**
 * 鐢熸垚瀵嗙爜鍝堝笇
 * @param password 鍘熷瀵嗙爜
 * @param saltRounds 鐩愬€艰疆鏁帮紙榛樿12杞級
 * @returns 瀵嗙爜鍝堝笇
 */
export const hashPassword = async (password: string, saltRounds: number = 12): Promise<string> => {
  try {
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    throw new CryptoError('Password hashing failed', 'HASH_FAILED', error);
  }
};

/**
 * 楠岃瘉瀵嗙爜鍝堝笇
 * @param password 鍘熷瀵嗙爜
 * @param hash 瀵嗙爜鍝堝笇
 * @returns 鏄惁鍖归厤
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    throw new CryptoError('Password verification failed', 'VERIFY_FAILED', error);
  }
};

/**
 * 鐢熸垚闅忔満鐩愬€? * @param rounds 鐩愬€艰疆鏁? * @returns 闅忔満鐩愬€? */
export const generateSalt = async (rounds: number = 12): Promise<string> => {
  try {
    return await bcrypt.genSalt(rounds);
  } catch (error) {
    throw new CryptoError('Salt generation failed', 'HASH_FAILED', error);
  }
};

/**
 * Interface representing a single bulk encryption result
 *
 * @interface BulkEncryptionResult
 * @since 2025-11-17
 */
interface BulkEncryptionResult {
  /** Encrypted data in Base64 format */
  encryptedData: string;
  /** Salt used for key derivation in Base64 format */
  salt: string;
  /** Initialization vector in Base64 format */
  iv: string;
  /** HMAC signature in Base64 format */
  hmac: string;
}

/**
 * 鎵归噺鍔犲瘑澶氫釜鏂囨湰锛堥噸鐢ㄥ瘑閽ユ淳鐢燂級
 * @param plainTexts 瑕佸姞瀵嗙殑鏄庢枃鏁扮粍
 * @param masterKey 涓诲瘑閽? * @returns Promise<string[]> 鍔犲瘑鍚庣殑鏂囨湰鏁扮粍
 */
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
      const hmacBytes = computeHMAC(ciphertextBase64, hmacKey);
      const hmacBase64 = bytesToBase64(hmacBytes);

      encryptedResults.push({
        encryptedData: ciphertextBase64,
        salt: saltStr,
        iv: ivStr,
        hmac: hmacBase64,
      });
    }

    return encryptedResults.map(result => {
      const payload: EncryptedPayload = {
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

/**
 * 鎵归噺瑙ｅ瘑澶氫釜鏂囨湰
 * @param encryptedTexts 瑕佽В瀵嗙殑瀵嗘枃鏁扮粍
 * @param masterKey 涓诲瘑閽? * @returns Promise<string[]> 瑙ｅ瘑鍚庣殑鏄庢枃鏁扮粍
 */
export const decryptBulk = async (encryptedTexts: string[], masterKey: string): Promise<string[]> => {
  if (encryptedTexts.length === 0) return [];

  // Auto-detect: check first item to determine algorithm
  try {
    const jsonBytes = base64ToBytes(encryptedTexts[0]);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const firstPayload = JSON.parse(jsonStr);

    if (firstPayload && firstPayload.version === 'gcm-v1') {
      return decryptGCMBulk(encryptedTexts, masterKey);
    }
  } catch {
    // If parsing fails, fall through to CTR decryption
  }

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
      const saltUint8Array = base64ToUint8Array(payload.salt);
      const ivBytes = base64ToUint8Array(payload.iv);

      const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

      const computedHmacBytes = computeHMAC(payload.ciphertext, hmacKey);
      const computedHmacBase64 = bytesToBase64(computedHmacBytes);

      if (computedHmacBase64 !== payload.hmac) {
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

// ==================== 閫氱敤鍝堝笇鍔熻兘 ====================

/**
 * 鐢熸垚鏁版嵁鍝堝笇
 * @param data 瑕佸搱甯岀殑鏁版嵁
 * @param algorithm 鍝堝笇绠楁硶锛堥粯璁HA-512锛? * @returns Promise<string> 鍝堝笇鍊硷紙鍗佸叚杩涘埗锛? */
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
      // Fallback for non-Expo, using @noble/hashes
      logger.warn('Expo Crypto not available, using @noble/hashes for hashing');
      const hashFn = algorithm === 'SHA-256' ? sha256 : sha512;
      return bytesToHex(hashFn(data));
    }
  } catch (error) {
    throw new CryptoError('Hash generation failed', 'HASH_FAILED', error);
  }
};

/**
 * Interface representing field-level encryption configuration
 *
 * @interface FieldEncryptionConfig
 * @since 2025-11-17
 */
interface FieldEncryptionConfig {
  /** List of fields to encrypt */
  fields: string[];
  /** Master key for encryption (32 bytes) */
  masterKey: string;
  /** Encryption configuration options */
  encryption?: {
    /** HMAC algorithm to use (default: auto-select based on data size) */
    hmacAlgorithm?: 'SHA-256' | 'SHA-512';
    /** Encryption algorithm to use (default: AES-CTR) */
    encryptionAlgorithm?: 'AES-CTR';
    /** Key size in bits (default: 256) */
    keySize?: 256;
  };
}

/**
 * 瀛楁绾у姞瀵? * @param data 瑕佸姞瀵嗙殑瀵硅薄
 * @param config 鍔犲瘑閰嶇疆
 * @returns Promise<Record<string, any>> 瀛楁绾у姞瀵嗗悗鐨勫璞? */
export const encryptFields = async (
  data: Record<string, any>,
  fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>> => {
  const result = { ...data };

  // Only encrypt fields requiring encryption
  const fieldsToEncrypt = fieldConfig.fields.filter(field => result[field] !== undefined && result[field] !== null);

  const valuesToEncrypt = fieldsToEncrypt.map(field => {
    const value = typeof result[field] === 'string' ? result[field] : JSON.stringify(result[field]);
    return value as string;
  });
  if (valuesToEncrypt.length > 0) {
    const encryptedValues = await encryptBulk(valuesToEncrypt, fieldConfig.masterKey);
    encryptedValues.forEach((enc, idx) => {
      const field = fieldsToEncrypt[idx];
      result[field] = enc;
    });
  }
  return result;
};
/**
 * 瀛楁绾цВ瀵? * @param data 瑕佽В瀵嗙殑瀵硅薄
 * @param config 瑙ｅ瘑閰嶇疆
 * @returns Promise<Record<string, any>> 瀛楁绾цВ瀵嗗悗鐨勫璞? */
export const decryptFields = async (
  data: Record<string, any>,
  fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>> => {
  const result = { ...data };
  const fieldsToDecrypt = fieldConfig.fields.filter(
    field => result[field] !== undefined && result[field] !== null && typeof result[field] === 'string'
  );

  if (fieldsToDecrypt.length === 0) return result;

  // 1. Batch process all encrypted fields
  const decryptPromises = fieldsToDecrypt.map(async field => {
    try {
      const encryptedValue = result[field] as string;

      // 2. Reuse the existing decrypt function so key caches still apply
      const decryptedStr = await decrypt(encryptedValue, fieldConfig.masterKey);

      // 3. 绫诲瀷鎭㈠閫昏緫淇濇寔涓嶅彉
      if (/^[\{\[]/.test(decryptedStr.trim())) {
        result[field] = JSON.parse(decryptedStr);
      } else {
        const trimmed = decryptedStr.trim();
        if (/^true$/i.test(trimmed)) result[field] = true;
        else if (/^false$/i.test(trimmed)) result[field] = false;
        else if (/^null$/i.test(trimmed)) result[field] = null;
        else if (/^[-+]?\d*\.?\d+([eE][-+]?\d+)?$/.test(trimmed) && !trimmed.startsWith('+0')) {
          if (decryptedStr.includes('+') && !decryptedStr.startsWith('+0')) {
            result[field] = decryptedStr;
          } else {
            result[field] = Number(decryptedStr);
          }
        } else {
          result[field] = decryptedStr;
        }
      }
    } catch (error) {
      logger.warn(`Failed to decrypt field ${field}:`, error);
      // Keep original encrypted value, don not throw error
    }
  });

  await Promise.all(decryptPromises);
  return result;
};
/**
 * 鎵归噺瀛楁绾у姞瀵? * @param dataArray 瑕佸姞瀵嗙殑瀵硅薄鏁扮粍
 * @param fieldConfig 鍔犲瘑閰嶇疆
 * @returns Promise<Record<string, any>[]> 鎵归噺瀛楁绾у姞瀵嗗悗鐨勫璞℃暟缁? */
export const encryptFieldsBulk = async (
  dataArray: Record<string, any>[],
  fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>[]> => {
  if (dataArray.length === 0) return dataArray;

  // Collect values for all fields requiring encryption
  const fieldValues: { [field: string]: string[] } = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null)
      .map(value => JSON.stringify(value));
  });

  // Batch encrypt each field value
  const encryptionPromises: Promise<void>[] = [];
  const encryptedValues: { [field: string]: string[] } = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    encryptionPromises.push(
      encryptBulk(values, fieldConfig.masterKey).then(encrypted => {
        encryptedValues[field] = encrypted;
      })
    );
  }

  // Use Promise.allSettled for better fault tolerance
  await Promise.allSettled(encryptionPromises);

  // Rebuild result array
  return dataArray.map((item, index) => {
    const result = { ...item };
    fieldConfig.fields.forEach(field => {
      if (item[field] !== undefined && item[field] !== null) {
        const fieldIndex = dataArray.slice(0, index).filter(i => i[field] !== undefined && i[field] !== null).length;
        if (encryptedValues[field] && encryptedValues[field][fieldIndex]) {
          result[field] = encryptedValues[field][fieldIndex];
        }
      }
    });
    return result;
  });
};

/**
 * 鎵归噺瀛楁绾цВ瀵? * @param dataArray 瑕佽В瀵嗙殑瀵硅薄鏁扮粍
 * @param config 瑙ｅ瘑閰嶇疆
 * @returns Promise<Record<string, any>[]> 鎵归噺瀛楁绾цВ瀵嗗悗鐨勫璞℃暟缁? */
export const decryptFieldsBulk = async (
  dataArray: Record<string, any>[],
  fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>[]> => {
  if (dataArray.length === 0) return dataArray;

  // Collect values for all fields requiring decryption
  const fieldValues: { [field: string]: string[] } = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null && typeof value === 'string');
  });

  // Batch decrypt each field value
  const decryptionPromises: Promise<void>[] = [];
  const decryptedValues: { [field: string]: any[] } = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    decryptionPromises.push(
      decryptBulk(values, fieldConfig.masterKey).then(decrypted => {
        decryptedValues[field] = decrypted.map(val => {
          try {
            // Try to parse JSON
            return JSON.parse(val);
          } catch {
            return val; // If not JSON, keep original value
          }
        });
      })
    );
  }

  await Promise.all(decryptionPromises);

  // Rebuild result array
  return dataArray.map((item, index) => {
    const result = { ...item };

    fieldConfig.fields.forEach(field => {
      if (item[field] !== undefined && item[field] !== null && typeof item[field] === 'string') {
        const fieldIndex =
          dataArray
            .slice(0, index + 1)
            .filter(i => i[field] !== undefined && i[field] !== null && typeof i[field] === 'string').length - 1;

        if (decryptedValues[field] && decryptedValues[field][fieldIndex] !== undefined) {
          result[field] = decryptedValues[field][fieldIndex];
        }
      }
    });

    return result;
  });
};
