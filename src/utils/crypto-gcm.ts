/**
 * AES-256-GCM Encryption Module
 * Compliant with NIST SP 800-38D and OWASP MASVS 2026 standards
 *
 * @module crypto-gcm
 * @since 2026-04-01
 * @version 1.0.0
 */

import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from './byteEncoding';
import { pbkdf2, randomBytes } from './cryptoProvider';
import { CryptoError } from './crypto-errors';
import { performanceMonitor } from '../core/monitor/PerformanceMonitor';
import { configManager } from '../core/config/ConfigManager';
import ExpoConstants from 'expo-constants';

const expoConstantsWithOwnership = ExpoConstants as typeof ExpoConstants & {
  appOwnership?: string;
};

/**
 * Detects if running in Expo Go
 */
const isExpoGo = (): boolean => {
  try {
    return typeof ExpoConstants !== 'undefined' && expoConstantsWithOwnership.appOwnership === 'expo';
  } catch {
    return false;
  }
};

/**
 * Gets iteration count with Expo Go adjustment
 */
const getGCMIterations = (): number => {
  const configIterations = configManager.getConfig().encryption.keyIterations;

  if (isExpoGo()) {
    const reduced = Math.min(configIterations, 20000);
    return Math.max(10000, reduced);
  }

  return Math.max(100000, configIterations);
};

/**
 * GCM encrypted payload structure
 */
export interface GCMEncryptedPayload {
  /** Base64 encoded salt (16 bytes) */
  salt: string;
  /** Base64 encoded nonce (12 bytes, GCM standard) */
  iv: string;
  /** Base64 encoded ciphertext */
  ciphertext: string;
  /** Base64 encoded authentication tag (16 bytes) */
  tag: string;
  /** Version identifier */
  version: 'gcm-v1';
}

/**
 * Key size for AES-256
 */
const AES_KEY_SIZE = 32; // 256 bits = 32 bytes

/**
 * GCM nonce size (recommended 12 bytes)
 */
const GCM_NONCE_SIZE = 12;

/**
 * Salt size for key derivation
 */
const SALT_SIZE = 16;

/**
 * Converts Uint8Array to Base64 string
 */
const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binaryString);
};

/**
 * Converts Base64 string to Uint8Array
 */
const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/**
 * Derives AES key from master key and salt using PBKDF2
 */
const deriveGCMKey = async (masterKey: string, salt: Uint8Array): Promise<Uint8Array> => {
  const iterations = getGCMIterations();

  const masterKeyHash = bytesToHex(sha256(masterKey)).substring(0, 16);
  const saltStr = bytesToBase64(salt);
  const cacheKey = `gcm_${masterKeyHash}_${saltStr}_${iterations}`;

  // Check cache first
  const cached = gcmKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const derivedBytes = pbkdf2(masterKey, salt, iterations, AES_KEY_SIZE, 'sha256');

    // Cache the derived key
    gcmKeyCache.set(cacheKey, derivedBytes);

    return derivedBytes;
  } catch (error) {
    throw new CryptoError('GCM key derivation failed', 'KEY_DERIVE_FAILED', error);
  }
};

/**
 * Simple LRU cache for GCM keys
 */
class GCMKeyCache {
  private cache = new Map<string, Uint8Array>();
  private maxSize = 100;

  get(key: string): Uint8Array | undefined {
    const value = this.cache.get(key);
    if (value) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: Uint8Array): void {
    if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
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

/**
 * Encrypts text using AES-256-GCM
 *
 * @param plainText Plain text to encrypt
 * @param masterKey Master key for encryption
 * @returns Promise<string> Encrypted text in Base64 format
 *
 * @throws CryptoError If encryption fails
 *
 * @example
 * ```typescript
 * const encrypted = await encryptGCM('secret text', 'master password');
 * ```
 */
export const encryptGCM = async (plainText: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();

  try {
    // Generate random salt and nonce
    const saltBytes = randomBytes(SALT_SIZE);
    const nonceBytes = randomBytes(GCM_NONCE_SIZE);

    // Derive AES key
    const aesKey = await deriveGCMKey(masterKey, saltBytes);

    // Encrypt using AES-256-GCM
    const plainTextBytes = new TextEncoder().encode(plainText);
    const cipher = gcm(aesKey, nonceBytes);
    const ciphertextBytes = cipher.encrypt(plainTextBytes);

    // GCM produces ciphertext with tag appended (last 16 bytes)
    // Split ciphertext and tag
    const tagSize = 16; // 128-bit tag
    const actualCiphertext = ciphertextBytes.slice(0, -tagSize);
    const tag = ciphertextBytes.slice(-tagSize);

    // Build payload
    const payload: GCMEncryptedPayload = {
      salt: bytesToBase64(saltBytes),
      iv: bytesToBase64(nonceBytes),
      ciphertext: bytesToBase64(actualCiphertext),
      tag: bytesToBase64(tag),
      version: 'gcm-v1',
    };

    // Serialize to JSON then Base64
    const jsonStr = JSON.stringify(payload);
    const result = bytesToBase64(new TextEncoder().encode(jsonStr));

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

/**
 * Decrypts text using AES-256-GCM
 *
 * @param encryptedBase64 Encrypted text in Base64 format
 * @param masterKey Master key for decryption
 * @returns Promise<string> Decrypted plain text
 *
 * @throws CryptoError If decryption fails or authentication fails
 *
 * @example
 * ```typescript
 * const decrypted = await decryptGCM(encryptedText, 'master password');
 * ```
 */
export const decryptGCM = async (encryptedBase64: string, masterKey: string): Promise<string> => {
  const startTime = Date.now();

  try {
    // Parse payload
    const jsonBytes = base64ToBytes(encryptedBase64);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const payload: GCMEncryptedPayload = JSON.parse(jsonStr);

    // Verify version
    if (payload.version !== 'gcm-v1') {
      throw new Error(`Unsupported GCM version: ${payload.version}`);
    }

    // Convert from Base64
    const saltBytes = base64ToBytes(payload.salt);
    const nonceBytes = base64ToBytes(payload.iv);
    const ciphertextBytes = base64ToBytes(payload.ciphertext);
    const tagBytes = base64ToBytes(payload.tag);

    // Derive AES key
    const aesKey = await deriveGCMKey(masterKey, saltBytes);

    // Combine ciphertext and tag for GCM decryption
    const combinedBytes = new Uint8Array(ciphertextBytes.length + tagBytes.length);
    combinedBytes.set(ciphertextBytes);
    combinedBytes.set(tagBytes, ciphertextBytes.length);

    // Decrypt using AES-256-GCM
    const cipher = gcm(aesKey, nonceBytes);
    const plainTextBytes = cipher.decrypt(combinedBytes);
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

/**
 * Clears the GCM key cache (useful for logout or reset)
 */
export const clearGCMKeyCache = (): void => {
  gcmKeyCache.clear();
};

/**
 * Gets GCM key cache size
 */
export const getGCMKeyCacheSize = (): number => {
  return gcmKeyCache.size;
};

/**
 * Bulk encrypt multiple texts using AES-256-GCM
 * Reuses key derivation for better performance
 *
 * @param plainTexts Array of plain texts to encrypt
 * @param masterKey Master key for encryption
 * @returns Promise<string[]> Array of encrypted texts
 */
export const encryptGCMBulk = async (plainTexts: string[], masterKey: string): Promise<string[]> => {
  if (plainTexts.length === 0) return [];

  try {
    // Generate single salt and nonce for all items (for bulk operations)
    const saltBytes = randomBytes(SALT_SIZE);
    const aesKey = await deriveGCMKey(masterKey, saltBytes);

    const results: string[] = [];

    for (const plainText of plainTexts) {
      const nonceBytes = randomBytes(GCM_NONCE_SIZE);
      const plainTextBytes = new TextEncoder().encode(plainText);

      const cipher = gcm(aesKey, nonceBytes);
      const ciphertextBytes = cipher.encrypt(plainTextBytes);

      const tagSize = 16;
      const actualCiphertext = ciphertextBytes.slice(0, -tagSize);
      const tag = ciphertextBytes.slice(-tagSize);

      const payload: GCMEncryptedPayload = {
        salt: bytesToBase64(saltBytes),
        iv: bytesToBase64(nonceBytes),
        ciphertext: bytesToBase64(actualCiphertext),
        tag: bytesToBase64(tag),
        version: 'gcm-v1',
      };

      results.push(bytesToBase64(new TextEncoder().encode(JSON.stringify(payload))));
    }

    return results;
  } catch (error) {
    throw new CryptoError('GCM bulk encryption failed', 'ENCRYPT_FAILED', error);
  }
};

/**
 * Bulk decrypt multiple texts using AES-256-GCM
 *
 * @param encryptedTexts Array of encrypted texts
 * @param masterKey Master key for decryption
 * @returns Promise<string[]> Array of decrypted texts
 */
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
