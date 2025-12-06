// __mocks__/expo-crypto.ts
// Mock implementation for expo-crypto

// Mock CryptoDigestAlgorithm enum
enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
  SHA512 = 'SHA-512',
  MD5 = 'MD5',
}

// Mock getRandomBytes function
const getRandomBytes = (size: number): Uint8Array => {
  // Generate random bytes for testing
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

// Mock digestStringAsync function
const digestStringAsync = async (
  algorithm: CryptoDigestAlgorithm,
  data: string,
  options?: { encoding?: 'utf8' | 'base64' | 'hex' }
): Promise<string> => {
  // Simple mock implementation that returns a deterministic hash for testing
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  let hash = 0;
  for (const byte of dataBytes) {
    hash = (hash << 5) - hash + byte;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(32, '0');
};

// Mock digest function
const digest = async (algorithm: CryptoDigestAlgorithm, data: Uint8Array): Promise<Uint8Array> => {
  // Simple mock implementation that returns a deterministic hash for testing
  let hash = 0;
  for (const byte of data) {
    hash = (hash << 5) - hash + byte;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hashBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hashBytes[i] = (hash >> (i * 8)) & 0xff;
  }
  return hashBytes;
};

// Mock randomUUID function
const randomUUID = (): string => {
  // Generate a simple mock UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Export all mock functions using CommonJS syntax
module.exports = {
  CryptoDigestAlgorithm,
  getRandomBytes,
  digestStringAsync,
  digest,
  randomUUID,
};

// Also export as named exports for TypeScript compatibility
module.exports.default = module.exports;
