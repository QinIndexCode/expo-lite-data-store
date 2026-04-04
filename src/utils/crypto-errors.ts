/**
 * @module crypto-errors
 * @description Shared error definitions for encryption modules
 * @since 2026-04-02
 * @version 1.0.0
 */

/**
 * Encryption error class for handling crypto-related errors
 */
export class CryptoError extends Error {
  public code:
    | 'ENCRYPT_FAILED'
    | 'DECRYPT_FAILED'
    | 'KEY_DERIVE_FAILED'
    | 'HMAC_MISMATCH'
    | 'HASH_FAILED'
    | 'VERIFY_FAILED';

  constructor(
    message: string,
    code: 'ENCRYPT_FAILED' | 'DECRYPT_FAILED' | 'KEY_DERIVE_FAILED' | 'HMAC_MISMATCH' | 'HASH_FAILED' | 'VERIFY_FAILED',
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
