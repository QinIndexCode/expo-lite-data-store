/** Shared type definitions for encryption modules. */
export interface EncryptedPayload {
  /** Omitted by legacy CTR payloads. */
  version?: 'ctr-v2';
  salt: string;
  iv: string;
  ciphertext: string;
  /** Base64 HMAC that authenticates the encrypted payload. */
  hmac: string;
}

export interface CachedKeyEntry {
  aesKey: Uint8Array;
  hmacKey: Uint8Array;
  accessCount: number;
  lastAccessTime: number;
  createdAt: number;
}

export interface KeyCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export interface BulkEncryptionResult {
  encryptedData: string;
  salt: string;
  iv: string;
  hmac: string;
}

export interface FieldEncryptionConfig {
  fields: string[];
  masterKey: string;
  encryption?: {
    hmacAlgorithm?: 'SHA-256' | 'SHA-512';
    encryptionAlgorithm?: 'AES-CTR' | 'AES-GCM' | 'auto';
    keySize?: 256;
  };
}
