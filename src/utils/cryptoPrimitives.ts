import { sha256, sha512 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex } from './byteEncoding';

type HashAlgorithm = 'SHA-256' | 'SHA-512';
type NativeDigest = 'sha256' | 'sha512';

const SHA256_OUTPUT_LENGTH = 32;

const resolveHashAlgorithm = (algorithm: HashAlgorithm | NativeDigest): HashAlgorithm =>
  algorithm === 'sha256' || algorithm === 'SHA-256' ? 'SHA-256' : 'SHA-512';

const toBytes = (data: string | Uint8Array): Uint8Array =>
  typeof data === 'string' ? new TextEncoder().encode(data) : data;

export const hashBytesSync = (data: string | Uint8Array, algorithm: HashAlgorithm = 'SHA-512'): Uint8Array =>
  resolveHashAlgorithm(algorithm) === 'SHA-256' ? sha256(toBytes(data)) : sha512(toBytes(data));

export const hashHexSync = (data: string | Uint8Array, algorithm: HashAlgorithm = 'SHA-512'): string =>
  bytesToHex(hashBytesSync(data, algorithm));

export const hmacBytesSync = (
  data: string | Uint8Array,
  key: Uint8Array,
  algorithm: HashAlgorithm = 'SHA-512'
): Uint8Array =>
  resolveHashAlgorithm(algorithm) === 'SHA-256'
    ? hmac(sha256, toBytes(key), toBytes(data))
    : hmac(sha512, toBytes(key), toBytes(data));

export const pbkdf2BytesSync = (
  password: string,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
  digest: NativeDigest
): Uint8Array =>
  pbkdf2(resolveHashAlgorithm(digest) === 'SHA-256' ? sha256 : sha512, new TextEncoder().encode(password), salt, {
    c: iterations,
    dkLen,
  });

export const hkdfBytesSync = (ikm: Uint8Array, salt: Uint8Array, dkLen: number): Uint8Array => {
  const effectiveSalt = salt.length > 0 ? salt : new Uint8Array(SHA256_OUTPUT_LENGTH);
  return hkdf(sha256, ikm, effectiveSalt, undefined, dkLen);
};
