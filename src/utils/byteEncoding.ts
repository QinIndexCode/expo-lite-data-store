/**
 * @module byteEncoding
 * @description Lightweight byte encoding helpers that avoid pulling browser crypto shims.
 * @since 2026-04-26
 */

const HEX_ALPHABET = '0123456789abcdef';

/**
 * Converts bytes into a lowercase hexadecimal string.
 */
export const bytesToHex = (bytes: Uint8Array): string => {
  let output = '';

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    output += HEX_ALPHABET[byte >>> 4];
    output += HEX_ALPHABET[byte & 0x0f];
  }

  return output;
};
