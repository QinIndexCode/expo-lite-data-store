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

// 使用正常的ES模块导入
import { ctr } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { bytesToHex } from '@noble/hashes/utils';

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
// 动态导入 Expo 模块，避免在非 Expo 环境中崩溃
let Crypto: any;
let SecureStore: any;
let Constants: any;

// 尝试导入 Expo 模块
try {
  // 仅在 Expo 环境中导入这些模块
  Crypto = require('expo-crypto');
  SecureStore = require('expo-secure-store');
  Constants = require('expo-constants');
} catch (error) {
  logger.warn('Expo modules not available, running in non-Expo environment');
  // 在非 Expo 环境中，我们将使用 Node.js crypto 模块或内置方法进行随机数生成
  // 对于 SecureStore，我们将使用内存存储作为回退
}

/**
 * Converts Uint8Array to Base64 string using secure conversion.
 * 
 * @param arr Uint8Array to convert
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
 * Encryption error class for handling crypto-related errors
 * 
 * @class CryptoError
 * @extends Error
 * @since 2025-11-17
 */
export class CryptoError extends Error {
  /**
   * Error code indicating the type of crypto error
   */
  public code:
    | 'ENCRYPT_FAILED'
    | 'DECRYPT_FAILED'
    | 'KEY_DERIVE_FAILED'
    | 'HMAC_MISMATCH'
    | 'HASH_FAILED'
    | 'VERIFY_FAILED';

  /**
   * Creates a new CryptoError instance
   * 
   * @constructor
   * @param message Error message
   * @param code Error code
   * @param error Original error object (optional)
   * 
   * @example
   * ```typescript
   * throw new CryptoError('Encryption failed', 'ENCRYPT_FAILED', originalError);
   * ```
   */
  constructor(
    message: string,
    code:
      | 'ENCRYPT_FAILED'
      | 'DECRYPT_FAILED'
      | 'KEY_DERIVE_FAILED'
      | 'HMAC_MISMATCH'
      | 'HASH_FAILED'
      | 'VERIFY_FAILED',
    error?: unknown
  ) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    if (error) {
      this.message += `:\n${error}`;
    }
  }
}

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
  } catch (error) {
    return false;
  }
  return false;
};

/**
 * Gets the number of iterations for PBKDF2 key derivation.
 * Dynamically adjusts based on the environment:
 * - Expo Go: 60,000 iterations (balance of performance and security)
 * - Production: 100,000 iterations (default)
 * - High-performance devices: Up to 120,000 iterations (optional)
 * 
 * @returns number Number of iterations to use
 */
const getIterations = (): number => {
  const configIterations = configManager.getConfig().encryption.keyIterations;
  
  if (isExpoGoEnvironment()) {
    const expoGoIterations = Math.min(configIterations, 60000);
    if (configIterations > 60000) {
      logger.warn(`Expo Go环境检测到，降低PBKDF2迭代次数从${configIterations}到${expoGoIterations}以优化性能`);
    }
    return Math.max(10000, expoGoIterations);
  }
  
  return Math.max(10000, Math.min(configIterations, 1000000));
};

/**
 * 密钥大小（256位）
 */
const KEY_SIZE = 256 / 32;

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
   * const keyCache = new SmartKeyCache(100, 30 * 60 * 1000); // 100 entries, 30 minutes max age
   * ```
   */
  constructor(maxSize = 500, maxAge = 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
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

const keyCache = new SmartKeyCache(
  configManager.getConfig().encryption.maxCacheSize || 100,
  configManager.getConfig().encryption.cacheTimeout || 30 * 60 * 1000
);

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
};

/**
 * 密钥缓存自动清理间隔（10分钟）
 */
const KEY_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

// 保存定时器 ID - 兼容 Node.js 和浏览器环境
// Node.js 中 setInterval 返回 number，浏览器中返回 Timeout 对象
let keyCacheCleanupTimer: number | NodeJS.Timeout | undefined;

/**
 * 初始化密钥缓存自动清理
 */
const initializeKeyCacheCleanup = (): void => {
  // 定期清理过期密钥缓存（10分钟一次）
  keyCacheCleanupTimer = setInterval(() => {
    keyCache.cleanup();
  }, KEY_CACHE_CLEANUP_INTERVAL);

  // 页面卸载时清理缓存 //确保
  // 显式检查window.addEventListener是否存在，防止React Native环境报错
  // 使用更复杂的检查模式确保编译器不会优化掉
  if (typeof window !== 'undefined') {
    // 在React Native中，window存在但addEventListener不存在
    // 使用typeof检查确保方法存在
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
  // 清除定时器
  if (keyCacheCleanupTimer) {
    clearInterval(keyCacheCleanupTimer);
    keyCacheCleanupTimer = undefined;
  }

  // 清除页面卸载事件监听器
  // 显式检查window.removeEventListener是否存在，防止React Native环境报错
  // 使用括号语法确保编译器不会优化掉检查
  if (typeof window !== 'undefined' && typeof window['removeEventListener'] === 'function') {
    window['removeEventListener']('beforeunload', clearKeyCache);
  }
};

// 初始化时启动自动清理
// 但不在测试环境中自动启动，避免 Jest 检测到开放句柄
// 确保在所有环境中都能正确判断，包括浏览器环境
const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
if (!isTestEnvironment) {
  initializeKeyCacheCleanup();
}

/**
 * Derives AES and HMAC keys from master key and salt using PBKDF2 with SHA512.
 * 
 * @param masterKey Master key for derivation
 * @param salt Salt for key derivation
 * @returns Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> Derived AES and HMAC keys
 * 
 * @throws CryptoError If key derivation fails
 */
const deriveKey = async (masterKey: string, salt: Uint8Array): Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> => {
  try {
    const iterations = getIterations();
    
    const masterKeyHash = bytesToHex(sha256(masterKey)).substring(0, 16);
    const saltStr = bytesToBase64(salt);
    const cacheKey = `${masterKeyHash}_${saltStr}_${iterations}`;

    const cachedEntry = keyCache.get(cacheKey);
    if (cachedEntry) {
      return {
        aesKey: cachedEntry.aesKey,
        hmacKey: cachedEntry.hmacKey,
      };
    }

    const startTime = Date.now();
    
    // 使用@noble/hashes的pbkdf2实现，生成64字节密钥（32字节用于AES，32字节用于HMAC）
    const derivedBytes = pbkdf2(sha512, masterKey, salt, {
      c: iterations,
      dkLen: 64, // 64字节 = 32字节AES密钥 + 32字节HMAC密钥
    });

    const duration = Date.now() - startTime;
    if (duration > 2000) {
      logger.warn(`PBKDF2 key derivation took ${duration}ms (iterations=${iterations}), consider reducing iterations for better performance`);
    }

    // 拆分派生密钥：前32字节用于AES，后32字节用于HMAC
    const aesKey = derivedBytes.slice(0, 32);
    const hmacKey = derivedBytes.slice(32, 64);

    const result = {
      aesKey,
      hmacKey,
    };

    keyCache.set(cacheKey, {
      aesKey: result.aesKey,
      hmacKey: result.hmacKey,
      accessCount: 1,
      lastAccessTime: Date.now(),
      createdAt: Date.now(),
    });

    return result;
  } catch (error) {
    throw new CryptoError(
      `Key derivation failed with iterations=${getIterations()} and keySize=${KEY_SIZE * 2}`,
      'KEY_DERIVE_FAILED',
      error
    );
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
  if (typeof Crypto !== 'undefined' && Crypto.getRandomBytes) {
    return Crypto.getRandomBytes(length);
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // 浏览器环境使用crypto.getRandomValues
    return crypto.getRandomValues(new Uint8Array(length));
  } else {
    logger.warn('Secure random generation not available, falling back to insecure Math.random');
    // 不安全的回退方案，仅用于非生产环境
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }
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
    return dataSizeKB < 10 ? 'SHA-256' : 'SHA-512';
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
  const startTime = Date.now();
  try {
    const saltBytes = getSecureRandomBytes(16);
    const ivBytes = getSecureRandomBytes(16);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);

    // 将 Uint8Array 转换为 Base64 字符串
    const saltStr = uint8ArrayToBase64(saltBytes);
    const ivStr = uint8ArrayToBase64(ivBytes);

    // 使用@noble/ciphers的AES-CTR模式加密
    const plainTextBytes = new TextEncoder().encode(plainText);
    const cipher = ctr(aesKey, ivBytes);
    const ciphertextBytes = cipher.encrypt(plainTextBytes);
    const ciphertextBase64 = bytesToBase64(ciphertextBytes);

    // HMAC 校验（模拟 GCM tag）- 使用智能算法选择
    const hmacBytes = computeHMAC(ciphertextBase64, hmacKey);
    const hmacBase64 = bytesToBase64(hmacBytes);

    // 组装 payload（Base64 安全存储）
    const payload: EncryptedPayload = {
      salt: saltStr,
      iv: ivStr,
      ciphertext: ciphertextBase64,
      hmac: hmacBase64,
    };

    // 修正：使用 jsonToBase64 安全序列化和 Base64 编码
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
    // 使用新的base64ToJson函数解析payload
    const payload: EncryptedPayload = base64ToJson(encryptedBase64);

    const saltUint8Array = base64ToUint8Array(payload.salt);
    const ivBytes = base64ToUint8Array(payload.iv);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

    // 计算HMAC并验证
    const computedHmacBytes = computeHMAC(payload.ciphertext, hmacKey);
    const computedHmacBase64 = bytesToBase64(computedHmacBytes);

    if (computedHmacBase64 !== payload.hmac) {
      throw new CryptoError('HMAC mismatch: data tampered or wrong key', 'HMAC_MISMATCH');
    }

    // 使用@noble/ciphers的AES-CTR模式解密
    const ciphertextBytes = base64ToBytes(payload.ciphertext);
    const cipher = ctr(aesKey, ivBytes);
    const plainTextBytes = cipher.decrypt(ciphertextBytes);
    const result = new TextDecoder().decode(plainTextBytes);
    
    performanceMonitor.record({
      operation: 'decrypt',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: encryptedBase64.length,
    });
    
    return result;
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
  
  try {
    // 检查 SecureStore 是否可用
    if (typeof SecureStore !== 'undefined') {
      try {
        // 尝试使用生物识别获取密钥
        key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS, {
          requireAuthentication: requireAuthOnAccess,
          authenticationPrompt: '验证身份访问数据库', // Authenticate to access database
        });
        
        if (!key) {
          key = await generateMasterKey();
          // 尝试使用生物识别存储密钥
          await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
            requireAuthentication: requireAuthOnAccess,
            authenticationPrompt: '设置加密密钥', // Set encryption key
          });
        }
      } catch (error) {
        logger.warn('生物识别验证失败，尝试不使用生物识别:', error);
        // 生物识别失败，回退到不使用生物识别的方式
        // 不使用生物识别获取密钥
        key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS);
        
        if (!key) {
          key = await generateMasterKey();
          // 不使用生物识别存储密钥
          await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key);
        }
      }
    } else {
      // SecureStore 不可用，使用内存存储作为回退
      logger.warn('SecureStore not available, using in-memory store');
      
      // 从内存存储获取密钥
      key = inMemoryStore.get(MASTER_KEY_ALIAS);
      
      if (!key) {
        key = await generateMasterKey();
        // 存储到内存存储
        inMemoryStore.set(MASTER_KEY_ALIAS, key);
      }
    }
  } catch (error) {
    logger.error('获取加密密钥失败:', error);
    throw new CryptoError(
      '无法获取或生成加密密钥',
      'KEY_DERIVE_FAILED',
      error
    );
  }

  return key;
};

// resetMasterKey 重置主密钥（登出/重置用）
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
    // 确保无论如何都清除内存中的密钥缓存
    inMemoryStore.delete(MASTER_KEY_ALIAS);
  }
  // 清除密钥缓存
  clearKeyCache();
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
    logger.error('Failed to generate secure random bytes, falling back to insecure generation:', error);
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

  try {
    const saltBytes = getSecureRandomBytes(16);

    const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);
    const saltStr = uint8ArrayToBase64(saltBytes);

    const encryptedResults: BulkEncryptionResult[] = [];

    for (const plainText of plainTexts) {
      const ivBytes = getSecureRandomBytes(16);
      const ivStr = uint8ArrayToBase64(ivBytes);

      // 使用@noble/ciphers的AES-CTR模式加密
      const plainTextBytes = new TextEncoder().encode(plainText);
      const cipher = ctr(aesKey, ivBytes);
      const ciphertextBytes = cipher.encrypt(plainTextBytes);
      const ciphertextBase64 = bytesToBase64(ciphertextBytes);

      // 计算HMAC
      const hmacBytes = computeHMAC(ciphertextBase64, hmacKey);
      const hmacBase64 = bytesToBase64(hmacBytes);

      encryptedResults.push({
        encryptedData: ciphertextBase64,
        salt: saltStr,
        iv: ivStr,
        hmac: hmacBase64,
      });
    }

    // 组装最终结果
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

  try {
    // 可以并行处理解密操作
    const decryptPromises = encryptedTexts.map(async encryptedText => {
      // 使用新的base64ToJson函数安全解析payload
      const payload: EncryptedPayload = base64ToJson(encryptedText);

      // 安全转换salt和iv
      const saltUint8Array = base64ToUint8Array(payload.salt);
      const ivBytes = base64ToUint8Array(payload.iv);

      const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

      // 计算HMAC并验证
      const computedHmacBytes = computeHMAC(payload.ciphertext, hmacKey);
      const computedHmacBase64 = bytesToBase64(computedHmacBytes);

      if (computedHmacBase64 !== payload.hmac) {
        throw new CryptoError('HMAC mismatch: data tampered or wrong key', 'HMAC_MISMATCH');
      }

      // 使用@noble/ciphers的AES-CTR模式解密
      const ciphertextBytes = base64ToBytes(payload.ciphertext);
      const cipher = ctr(aesKey, ivBytes);
      const plainTextBytes = cipher.decrypt(ciphertextBytes);
      return new TextDecoder().decode(plainTextBytes);
    });

    // 并行执行所有解密操作
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
    // 检查 Crypto 是否可用（Expo 环境）
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
      // 非 Expo 环境下的回退方案，使用 @noble/hashes
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

  const promises = fieldConfig.fields.map(async field => {
    if (result[field] === undefined || result[field] === null) {
      return;
    }

    const valueToEncrypt =
      typeof result[field] === 'string'
        ? result[field] // 字符串直接加密（不加引号）
        : JSON.stringify(result[field]); // 对象、数字等才序列化

    result[field] = await encrypt(valueToEncrypt, fieldConfig.masterKey);
  });

  await Promise.all(promises);
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
      logger.warn(`字段 ${field} 解密失败:`, error);
      // 保留原始加密值，不抛出错误
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

  // 为所有字段收集需要加密的值
  const fieldValues: { [field: string]: string[] } = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null)
      .map(value => JSON.stringify(value));
  });

  // 批量加密每个字段的值
  const encryptionPromises: Promise<void>[] = [];
  const encryptedValues: { [field: string]: string[] } = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    encryptionPromises.push(
      encryptBulk(values, fieldConfig.masterKey).then(encrypted => {
        encryptedValues[field] = encrypted;
      })
    );
  }

  await Promise.all(encryptionPromises);

  // 重建结果数组
  return dataArray.map((item, index) => {
    const result = { ...item };
    fieldConfig.fields.forEach(field => {
      if (item[field] !== undefined && item[field] !== null) {
        const fieldIndex =
          dataArray.slice(0, index).filter(i => i[field] !== undefined && i[field] !== null).length;
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

  // 为所有字段收集需要解密的值
  const fieldValues: { [field: string]: string[] } = {};

  fieldConfig.fields.forEach(field => {
    fieldValues[field] = dataArray
      .map(item => item[field])
      .filter(value => value !== undefined && value !== null && typeof value === 'string');
  });

  // 批量解密每个字段的值
  const decryptionPromises: Promise<void>[] = [];
  const decryptedValues: { [field: string]: any[] } = {};

  for (const [field, values] of Object.entries(fieldValues)) {
    decryptionPromises.push(
      decryptBulk(values, fieldConfig.masterKey).then(decrypted => {
        decryptedValues[field] = decrypted.map(val => {
          try {
            // 尝试解析JSON
            return JSON.parse(val);
          } catch {
            return val; // 如果不是JSON，保持原值
          }
        });
      })
    );
  }

  await Promise.all(decryptionPromises);

  // 重建结果数组
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
