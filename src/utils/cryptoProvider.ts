/**
 * @module cryptoProvider
 * @description Cryptographic primitives provider with Expo Go compatibility
 * @since 2025-11-17
 * @version 2.0.0
 */

import ExpoConstants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import { bytesToHex, hexToBytes } from './byteEncoding';
import { hashBytesSync, hashHexSync, hkdfBytesSync, hmacBytesSync, pbkdf2BytesSync } from './cryptoPrimitives';
import logger from './logger';

type BinaryLike = ArrayBuffer | ArrayBufferView | ArrayLike<number>;
type NativeHashAlgorithm = 'sha256' | 'sha512';
type NativeDigest = 'sha256' | 'sha512';
type GlobalRequire = (moduleName: string) => unknown;

type NativeHashInstance = {
  update(data: string | Uint8Array): NativeHashInstance;
  digest(encoding?: 'hex'): string | BinaryLike;
};

type NativeHmacInstance = {
  update(data: string | Uint8Array): NativeHmacInstance;
  digest(encoding?: 'hex'): string | BinaryLike;
};

type NativeCryptoModule = {
  pbkdf2Sync?: (
    password: string,
    salt: Uint8Array,
    iterations: number,
    dkLen: number,
    digest: NativeDigest
  ) => BinaryLike;
  randomBytes?: (length: number) => BinaryLike;
  createHash?: (algorithm: NativeHashAlgorithm) => NativeHashInstance;
  createHmac?: (algorithm: NativeHashAlgorithm, key: Uint8Array) => NativeHmacInstance;
};

let nativePBKDF2Sync: NativeCryptoModule['pbkdf2Sync'];
let nativeRandomBytes: NativeCryptoModule['randomBytes'];
let nativeCreateHash: NativeCryptoModule['createHash'];
let nativeCreateHmac: NativeCryptoModule['createHmac'];
let warned = false;
let nativeChecked = false;
let nativeEnabled = false;
const NATIVE_CRYPTO_GLOBAL_KEY = '__expoLiteDataStoreNativeCrypto';

const expoConstantsWithOwnership = ExpoConstants as typeof ExpoConstants & {
  appOwnership?: string;
};
const expoCryptoWithFallback = ExpoCrypto as typeof ExpoCrypto & {
  default?: typeof ExpoCrypto;
};

const toUint8Array = (value: BinaryLike): Uint8Array => {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
};

const getGlobalScope = (): Record<string, unknown> | undefined => {
  if (typeof globalThis !== 'undefined') {
    return globalThis as Record<string, unknown>;
  }
  if (typeof global !== 'undefined') {
    return global as Record<string, unknown>;
  }
  return undefined;
};

const normalizeNativeCryptoModule = (moduleValue: unknown): NativeCryptoModule | undefined => {
  if (moduleValue && typeof moduleValue === 'object' && 'default' in moduleValue) {
    const defaultValue = (moduleValue as { default?: unknown }).default;
    if (defaultValue && defaultValue !== moduleValue && typeof defaultValue === 'object') {
      return defaultValue as NativeCryptoModule;
    }
  }
  if (!moduleValue || typeof moduleValue !== 'object') {
    return undefined;
  }
  return moduleValue as NativeCryptoModule;
};

const hasNativeCryptoPrimitives = (
  moduleValue: NativeCryptoModule | undefined
): moduleValue is NativeCryptoModule & Required<Pick<NativeCryptoModule, 'pbkdf2Sync' | 'randomBytes' | 'createHash'>> =>
  !!moduleValue &&
  typeof moduleValue.pbkdf2Sync === 'function' &&
  typeof moduleValue.randomBytes === 'function' &&
  typeof moduleValue.createHash === 'function';

const applyNativeCryptoModule = (moduleValue: unknown): boolean => {
  const normalizedModule = normalizeNativeCryptoModule(moduleValue);
  if (!hasNativeCryptoPrimitives(normalizedModule)) {
    return false;
  }

  nativePBKDF2Sync = normalizedModule.pbkdf2Sync;
  nativeRandomBytes = normalizedModule.randomBytes;
  nativeCreateHash = normalizedModule.createHash;
  nativeCreateHmac = normalizedModule.createHmac;
  nativeChecked = true;
  nativeEnabled = true;
  return true;
};

const getRegisteredNativeCryptoModule = (): unknown => {
  const globalScope = getGlobalScope();
  return globalScope ? globalScope[NATIVE_CRYPTO_GLOBAL_KEY] : undefined;
};

const isExpoGo = () => {
  try {
    return typeof ExpoConstants !== 'undefined' && expoConstantsWithOwnership.appOwnership === 'expo';
  } catch {
    return false;
  }
};

const devWarnOnce = () => {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;
  if (isDev && isExpoGo() && !warned) {
    warned = true;
    logger.warn(
      'Expo Go detected. Using JavaScript crypto fallback. Build a standalone APK/IPA for native performance.'
    );
  }
};

export const registerNativeCryptoModule = (moduleValue: unknown): boolean => {
  const normalizedModule = normalizeNativeCryptoModule(moduleValue);
  if (!hasNativeCryptoPrimitives(normalizedModule)) {
    return false;
  }

  const globalScope = getGlobalScope();
  if (globalScope) {
    globalScope[NATIVE_CRYPTO_GLOBAL_KEY] = normalizedModule;
  }

  return applyNativeCryptoModule(normalizedModule);
};

const tryLoadNative = () => {
  if (nativeChecked) return nativeEnabled;
  if (nativePBKDF2Sync && nativeRandomBytes && nativeCreateHash) {
    nativeChecked = true;
    nativeEnabled = true;
    return true;
  }
  if (applyNativeCryptoModule(getRegisteredNativeCryptoModule())) {
    return true;
  }
  if (isExpoGo()) {
    nativeChecked = true;
    nativeEnabled = false;
    return false;
  }
  const reqFn = (typeof getGlobalScope()?.require === 'function' ? getGlobalScope()?.require : require) as GlobalRequire;
  try {
    const moduleName = ['react-native-quick-crypto'].join('');
    const qcrypto = reqFn(moduleName);
    if (registerNativeCryptoModule(qcrypto)) {
      return true;
    }
  } catch {
    // Fall through to alternate native providers.
  }

  try {
    const nodeCrypto = reqFn('node:crypto');
    if (registerNativeCryptoModule(nodeCrypto)) {
      return true;
    }
  } catch {
    // Ignore Node crypto loading errors and continue to the JS fallback.
  }

  if (!warned) {
    warned = true;
    logger.warn(
      'Native crypto module not found. Using JavaScript fallback. Install react-native-quick-crypto for better performance.'
    );
  }
  nativeChecked = true;
  nativeEnabled = false;
  return false;
};

export const useNative = () => {
  return tryLoadNative();
};

export const __resetDevWarnForTest = () => {
  warned = false;
};

export const __resetNativeCryptoForTest = () => {
  nativePBKDF2Sync = undefined;
  nativeRandomBytes = undefined;
  nativeCreateHash = undefined;
  nativeCreateHmac = undefined;
  nativeChecked = false;
  nativeEnabled = false;
  const globalScope = getGlobalScope();
  if (globalScope && NATIVE_CRYPTO_GLOBAL_KEY in globalScope) {
    try {
      delete globalScope[NATIVE_CRYPTO_GLOBAL_KEY];
    } catch {
      globalScope[NATIVE_CRYPTO_GLOBAL_KEY] = undefined;
    }
  }
};

export const pbkdf2 = (
  password: string,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
  digest: 'sha256' | 'sha512'
): Uint8Array => {
  devWarnOnce();
  if (useNative()) {
    const pbkdf2Sync = nativePBKDF2Sync;
    if (!pbkdf2Sync) {
      throw new Error('Native PBKDF2 is unavailable after native crypto initialization');
    }
    const buf = pbkdf2Sync(password, salt, iterations, dkLen, digest);
    return toUint8Array(buf);
  }
  return pbkdf2BytesSync(password, salt, iterations, dkLen, digest);
};

/**
 * HKDF key derivation (extract + expand) for fast per-record key derivation.
 * This is orders of magnitude faster than PBKDF2 (~3μs vs ~2s).
 *
 * @param ikm Input keying material (already high-entropy, e.g. from PBKDF2)
 * @param salt Salt for key derivation
 * @param dkLen Desired output key length
 * @returns Derived key material
 */
export const hkdfDerive = (ikm: Uint8Array, salt: Uint8Array, dkLen: number): Uint8Array => {
  return hkdfBytesSync(ikm, salt, dkLen);
};

export const randomBytes = (length: number): Uint8Array => {
  devWarnOnce();
  if (useNative()) {
    const randomBytesFn = nativeRandomBytes;
    if (!randomBytesFn) {
      throw new Error('Native randomBytes is unavailable after native crypto initialization');
    }
    const buf = randomBytesFn(length);
    return toUint8Array(buf);
  }
  const getRB = expoCryptoWithFallback.getRandomBytes ?? expoCryptoWithFallback.default?.getRandomBytes;
  if (typeof getRB === 'function') {
    const out = getRB(length);
    return toUint8Array(out);
  }
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }
  const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  if (!isTestEnvironment && isProduction) {
    throw new Error('Secure random generation not available');
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};

export const hash = async (data: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Promise<string> => {
  devWarnOnce();
  if (useNative()) {
    const nativeAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'sha512';
    const createHash = nativeCreateHash;
    if (!createHash) {
      throw new Error('Native createHash is unavailable after native crypto initialization');
    }
    const hasher = createHash(nativeAlgorithm);
    hasher.update(data);
    const digestResult = hasher.digest('hex');
    return typeof digestResult === 'string' ? digestResult : bytesToHex(toUint8Array(digestResult));
  }
  return hashHexSync(data, algorithm);
};

export const hmac = (
  data: string | Uint8Array,
  key: Uint8Array,
  algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'
): Uint8Array => {
  devWarnOnce();
  if (useNative()) {
    const createHmac = nativeCreateHmac;
    if (createHmac) {
      const nativeAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'sha512';
      const digestResult = createHmac(nativeAlgorithm, key).update(data).digest('hex');
      return typeof digestResult === 'string' ? hexToBytes(digestResult) : toUint8Array(digestResult);
    }
  }
  return hmacBytesSync(data, key, algorithm);
};

export const hashBytes = (data: string | Uint8Array, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Uint8Array =>
  hashBytesSync(data, algorithm);
