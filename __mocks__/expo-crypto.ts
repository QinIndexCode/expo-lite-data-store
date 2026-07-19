enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
  SHA512 = 'SHA-512',
  MD5 = 'MD5',
}

const getRandomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

const digestStringAsync = async (
  _algorithm: CryptoDigestAlgorithm,
  data: string,
  _options?: { encoding?: 'utf8' | 'base64' | 'hex' }
): Promise<string> => {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  let hash = 0;
  for (const byte of dataBytes) {
    hash = (hash << 5) - hash + byte;
    hash = hash & hash; // Bitwise coercion keeps the accumulator within signed 32-bit range.
  }
  return Math.abs(hash).toString(16).padStart(32, '0');
};

const digest = async (_algorithm: CryptoDigestAlgorithm, data: Uint8Array): Promise<Uint8Array> => {
  let hash = 0;
  for (const byte of data) {
    hash = (hash << 5) - hash + byte;
    hash = hash & hash; // Bitwise coercion keeps the accumulator within signed 32-bit range.
  }
  const hashBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hashBytes[i] = (hash >> (i * 8)) & 0xff;
  }
  return hashBytes;
};

const randomUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const expoCryptoMock = {
  CryptoDigestAlgorithm,
  getRandomBytes,
  digestStringAsync,
  digest,
  randomUUID,
};

module.exports = Object.assign(expoCryptoMock, { default: expoCryptoMock });
