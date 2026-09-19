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

  public cause?: unknown;

  constructor(
    message: string,
    code: 'ENCRYPT_FAILED' | 'DECRYPT_FAILED' | 'KEY_DERIVE_FAILED' | 'HMAC_MISMATCH' | 'HASH_FAILED' | 'VERIFY_FAILED',
    error?: unknown
  ) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    if (error !== undefined) {
      this.cause = error;
      const detail = error instanceof Error ? error.name : 'Unknown error';
      this.message += ` (${detail})`;
    }
  }
}
