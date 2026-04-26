import * as CryptoJS from 'crypto-js';
import { bytesToHex, hexToBytes } from './byteEncoding';

type HashAlgorithm = 'SHA-256' | 'SHA-512';
type NativeDigest = 'sha256' | 'sha512';
type WordArrayLike = CryptoJS.lib.WordArray;

const SHA256_OUTPUT_LENGTH = 32;

const resolveHashAlgorithm = (algorithm: HashAlgorithm | NativeDigest): HashAlgorithm =>
  algorithm === 'sha256' || algorithm === 'SHA-256' ? 'SHA-256' : 'SHA-512';

const toWordArray = (data: string | Uint8Array): WordArrayLike =>
  typeof data === 'string' ? CryptoJS.enc.Utf8.parse(data) : CryptoJS.enc.Hex.parse(bytesToHex(data));

const fromWordArray = (wordArray: WordArrayLike): Uint8Array =>
  Uint8Array.from(hexToBytes(CryptoJS.enc.Hex.stringify(wordArray)));

const resolveHasher = (algorithm: HashAlgorithm | NativeDigest): typeof CryptoJS.algo.SHA256 | typeof CryptoJS.algo.SHA512 =>
  resolveHashAlgorithm(algorithm) === 'SHA-256' ? CryptoJS.algo.SHA256 : CryptoJS.algo.SHA512;

export const hashBytesSync = (data: string | Uint8Array, algorithm: HashAlgorithm = 'SHA-512'): Uint8Array => {
  const message = toWordArray(data);
  const digest =
    resolveHashAlgorithm(algorithm) === 'SHA-256' ? CryptoJS.SHA256(message) : CryptoJS.SHA512(message);
  return fromWordArray(digest);
};

export const hashHexSync = (data: string | Uint8Array, algorithm: HashAlgorithm = 'SHA-512'): string =>
  bytesToHex(hashBytesSync(data, algorithm));

export const hmacBytesSync = (
  data: string | Uint8Array,
  key: Uint8Array,
  algorithm: HashAlgorithm = 'SHA-512'
): Uint8Array => {
  const message = toWordArray(data);
  const secret = toWordArray(key);
  const digest =
    resolveHashAlgorithm(algorithm) === 'SHA-256'
      ? CryptoJS.HmacSHA256(message, secret)
      : CryptoJS.HmacSHA512(message, secret);
  return fromWordArray(digest);
};

export const pbkdf2BytesSync = (
  password: string,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
  digest: NativeDigest
): Uint8Array => {
  const derived = CryptoJS.PBKDF2(password, toWordArray(salt), {
    keySize: Math.ceil(dkLen / 4),
    iterations,
    hasher: resolveHasher(digest),
  });

  return fromWordArray(derived).slice(0, dkLen);
};

export const hkdfBytesSync = (ikm: Uint8Array, salt: Uint8Array, dkLen: number): Uint8Array => {
  const effectiveSalt = salt.length > 0 ? salt : new Uint8Array(SHA256_OUTPUT_LENGTH);
  const prk = hmacBytesSync(ikm, effectiveSalt, 'SHA-256');
  const blockCount = Math.ceil(dkLen / SHA256_OUTPUT_LENGTH);
  const okm = new Uint8Array(blockCount * SHA256_OUTPUT_LENGTH);
  let previousBlock: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const material = new Uint8Array(previousBlock.length + 1);
    material.set(previousBlock, 0);
    material[material.length - 1] = blockIndex + 1;
    previousBlock = hmacBytesSync(material, prk, 'SHA-256');
    okm.set(previousBlock, blockIndex * SHA256_OUTPUT_LENGTH);
  }

  return Uint8Array.from(okm.slice(0, dkLen));
};
