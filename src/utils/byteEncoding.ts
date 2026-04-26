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

/**
 * Converts a hexadecimal string into bytes.
 */
export const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex input must have an even length');
  }

  const output = new Uint8Array(hex.length / 2);

  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex byte at offset ${index}`);
    }
    output[index / 2] = byte;
  }

  return output;
};
