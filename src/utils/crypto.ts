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
import * as ExpoCrypto from 'expo-crypto';
import * as ExpoSecureStore from 'expo-secure-store';
import ExpoConstants from 'expo-constants';
import { pbkdf2 as providerPbkdf2, randomBytes as providerRandomBytes, hkdfDerive } from './cryptoProvider';
import { encryptGCM, decryptGCM, encryptGCMBulk, decryptGCMBulk } from './crypto-gcm';
import { CryptoError } from './crypto-errors';

// Re-export for backward compatibility
export { CryptoError };

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

// Dynamic导入 Expo 模块，避免在非 Expo 环境中崩溃
let Crypto: any;
let SecureStore: any;
let Constants: any;
Crypto = ExpoCrypto;
SecureStore = ExpoSecureStore;
Constants = ExpoConstants;

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
 * 主密钥别名
 */
const MASTER_KEY_ALIAS = 'expo_litedb_master_key_v2025';

/**
 * 非 Expo 环境下的内存存储回退
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
    if (typeof Constants !== 'undefined' && Constants.appOwnership === 'expo') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
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
 * 获取密钥缓存统计信息
 */
export const getKeyCacheStats = (): KeyCacheStats => {
  return keyCache.getStats();
};

/**
 * 获取密钥缓存命中率
 */
export const getKeyCacheHitRate = (): number => {
  return keyCache.getHitRate();
};

/**
 * 清除密钥缓存（用于登出或重置）
 */
export const clearKeyCache = (): void => {
  keyCache.clear();
  rootKeyCache.clear();
};

/**
 * 密钥缓存自动清理间隔（10分钟）
 */
const KEY_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

// Save定时器 ID - 兼容 Node.js 和浏览器环境
// Node.js 中 setInterval 返回 number，浏览器中返回 Timeout 对象
let keyCacheCleanupTimer: number | NodeJS.Timeout | undefined;

/**
 * 初始化密钥缓存自动清理
 */
const initializeKeyCacheCleanup = (): void => {
  // Periodically clean expired key cache (every 10 minutes)
  keyCacheCleanupTimer = setInterval(() => {
    keyCache.cleanup();
  }, KEY_CACHE_CLEANUP_INTERVAL);

  // Clear cache on page unload
  // Explicitly check if window.addEventListener exists，防止React Native环境报错
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
 * 停止密钥缓存清理定时器
 */
export const stopKeyCacheCleanup = (): void => {
  // Clear timer
  if (keyCacheCleanupTimer) {
    clearInterval(keyCacheCleanupTimer);
    keyCacheCleanupTimer = undefined;
  }

  // Clear page unload event listener
  // Explicitly check if window.removeEventListener exists，防止React Native环境报错
  // Use bracket syntax to prevent compiler optimization
  if (typeof window !== 'undefined' && typeof window['removeEventListener'] === 'function') {
    window['removeEventListener']('beforeunload', clearKeyCache);
  }
};

// Initialize时启动自动清理
// But not auto-start in test to avoid Jest open handle detection
// Ensure correct detection in all environments including browser
const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
if (!isTestEnvironment) {
  initializeKeyCacheCleanup();
}

/**
 * Root key cache: stores PBKDF2-derived root keys per masterKey.
 * This is the expensive one-time operation. Once we have the root key,
 * all subsequent per-record key derivations use fast HKDF (~3μs vs ~2s).
 */
const rootKeyCache = new Map<string, Uint8Array>();

/**
 * Derives AES and HMAC keys from master key and salt.
 *
 * Two-tier architecture for performance:
 * 1. PBKDF2 (one-time, slow ~2s): masterKey + fixed_salt → rootKey (64 bytes)
 * 2. HKDF (per-record, fast ~3μs): rootKey + salt → AES+HMAC keys (64 bytes)
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

    // Step 2: Fast HKDF-expand for per-record keys (~3μs)
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
 * 根据数据大小和配置选择HMAC算法
 * 小数据使用SHA-256（更快），大数据使用SHA-512（更安全）
 */
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
  let key;
  const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

  try {
    // Check SecureStore 是否可用
    if (typeof SecureStore !== 'undefined') {
      try {
        // Try to get key with biometric
        key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS, {
          requireAuthentication: requireAuthOnAccess,
          authenticationPrompt: '验证身份访问数据库', // Authenticate to access database
        });

        if (!key) {
          key = await generateMasterKey();
          // Try to store key with biometric
          await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
            requireAuthentication: requireAuthOnAccess,
            authenticationPrompt: '设置加密密钥', // Set encryption key
          });
        }
      } catch (error) {
        logger.warn('Biometric authentication failed, retrying without biometrics:', error);
        try {
          // Biometric failed, fallback to non-biometric
          key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS);

          if (!key) {
            key = await generateMasterKey();
            // Store key without biometric
            await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key);
          }
        } catch (secureStoreError) {
          // SecureStore 完全不可用，回退到内存存储
          logger.warn('SecureStore completely unavailable, using in-memory key storage:', secureStoreError);
          key = inMemoryStore.get(MASTER_KEY_ALIAS);
          if (!key) {
            key = await generateMasterKey();
            inMemoryStore.set(MASTER_KEY_ALIAS, key);
          }
        }
      }
    } else {
      if (!isTestEnvironment) {
        logger.warn('SecureStore not available, using in-memory master key storage');
      }

      // Get key from memory storage
      key = inMemoryStore.get(MASTER_KEY_ALIAS);

      if (!key) {
        key = await generateMasterKey();
        // Store到内存存储
        inMemoryStore.set(MASTER_KEY_ALIAS, key);
      }
    }
  } catch (error) {
    logger.error('Failed to retrieve encryption key:', error);
    // Final fallback: Generate in-memory key
    logger.warn('All key retrieval methods failed, generating in-memory key as last resort');
    key = inMemoryStore.get(MASTER_KEY_ALIAS);
    if (!key) {
      key = await generateMasterKey();
      inMemoryStore.set(MASTER_KEY_ALIAS, key);
    }
  }

  return key;
};

// resetMasterKey for logout/reset
export const resetMasterKey = async (): Promise<void> => {
  try {
    if (typeof SecureStore !== 'undefined') {
      await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS);
    } else {
      // SecureStore 不可用，清除内存存储
      inMemoryStore.delete(MASTER_KEY_ALIAS);
    }
  } catch (error) {
    logger.warn('Failed to reset master key:', error);
    // Ensure in-memory key cache is cleared
    inMemoryStore.delete(MASTER_KEY_ALIAS);
  }
  // Clear key cache
  clearKeyCache();
};

/**
 * 预计算常用密钥，减少首次加密时的密钥派生时间
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

    // Parallel预计算所有密钥
    await Promise.all(commonSalts.map(salt => deriveKey(masterKey, salt)));

    logger.info('Key precomputation completed');
  } catch (error) {
    logger.warn('Failed to precompute common keys:', error);
  }
};

/**
 * 生成主密钥（32 字节随机）
 * @returns 主密钥
 */
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

// ==================== bcrypt 密码哈希功能 ====================

/**
 * 生成密码哈希
 * @param password 原始密码
 * @param saltRounds 盐值轮数（默认12轮）
 * @returns 密码哈希
 */
export const hashPassword = async (password: string, saltRounds: number = 12): Promise<string> => {
  try {
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    throw new CryptoError('Password hashing failed', 'HASH_FAILED', error);
  }
};

/**
 * 验证密码哈希
 * @param password 原始密码
 * @param hash 密码哈希
 * @returns 是否匹配
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    throw new CryptoError('Password verification failed', 'VERIFY_FAILED', error);
  }
};

/**
 * 生成随机盐值
 * @param rounds 盐值轮数
 * @returns 随机盐值
 */
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
 * 批量加密多个文本（重用密钥派生）
 * @param plainTexts 要加密的明文数组
 * @param masterKey 主密钥
 * @returns Promise<string[]> 加密后的文本数组
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
 * 批量解密多个文本
 * @param encryptedTexts 要解密的密文数组
 * @param masterKey 主密钥
 * @returns Promise<string[]> 解密后的明文数组
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

// ==================== 通用哈希功能 ====================

/**
 * 生成数据哈希
 * @param data 要哈希的数据
 * @param algorithm 哈希算法（默认SHA-512）
 * @returns Promise<string> 哈希值（十六进制）
 */
export const generateHash = async (data: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Promise<string> => {
  try {
    // Check Crypto 是否可用（Expo 环境）
    if (typeof Crypto !== 'undefined' && Crypto.digestStringAsync) {
      switch (algorithm) {
        case 'SHA-256':
          return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
        case 'SHA-512':
          return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA512, data);
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
 * 字段级加密
 * @param data 要加密的对象
 * @param config 加密配置
 * @returns Promise<Record<string, any>> 字段级加密后的对象
 */
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
 * 字段级解密
 * @param data 要解密的对象
 * @param config 解密配置
 * @returns Promise<Record<string, any>> 字段级解密后的对象
 */
export const decryptFields = async (
  data: Record<string, any>,
  fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>> => {
  const result = { ...data };
  const fieldsToDecrypt = fieldConfig.fields.filter(
    field => result[field] !== undefined && result[field] !== null && typeof result[field] === 'string'
  );

  if (fieldsToDecrypt.length === 0) return result;

  // 1. 批量处理所有加密字段
  const decryptPromises = fieldsToDecrypt.map(async field => {
    try {
      const encryptedValue = result[field] as string;

      // 2. 使用现有的解密函数（它会利用缓存）
      const decryptedStr = await decrypt(encryptedValue, fieldConfig.masterKey);

      // 3. 类型恢复逻辑保持不变
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
 * 批量字段级加密
 * @param dataArray 要加密的对象数组
 * @param fieldConfig 加密配置
 * @returns Promise<Record<string, any>[]> 批量字段级加密后的对象数组
 */
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
 * 批量字段级解密
 * @param dataArray 要解密的对象数组
 * @param config 解密配置
 * @returns Promise<Record<string, any>[]> 批量字段级解密后的对象数组
 */
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
