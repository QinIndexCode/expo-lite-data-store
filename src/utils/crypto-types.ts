/**
 * @module crypto-types
 * @description Shared type definitions for encryption modules
 * @since 2026-04-02
 * @version 1.0.0
 */

/**
 * Interface representing an encrypted payload structure
 */
export interface EncryptedPayload {
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
 * Interface representing a cached key entry with LRU tracking
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
 * Interface representing a single bulk encryption result
 */
export interface BulkEncryptionResult {
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
 * Interface representing field-level encryption configuration
 */
export interface FieldEncryptionConfig {
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
