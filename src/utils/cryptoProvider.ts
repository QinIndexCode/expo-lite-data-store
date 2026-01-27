import ExpoConstants from 'expo-constants'
import * as ExpoCrypto from 'expo-crypto'
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex } from '@noble/hashes/utils'

let nativePBKDF2Sync: any
let nativeRandomBytes: any
let nativeCreateHash: any
let warned = false
let nativeChecked = false
let nativeEnabled = false

const isExpoGo = () => {
  try {
    return typeof ExpoConstants !== 'undefined' && (ExpoConstants as any)?.appOwnership === 'expo'
  } catch {
    return false
  }
}

const devWarnOnce = () => {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true
  if (isDev && isExpoGo() && !warned) {
    warned = true
    console.log('Running in Expo Go. Using fallback JavaScript crypto implementation. For native performance, build a standalone APK/IPA.')
  }
}

const tryLoadNative = () => {
  if (nativeChecked) return nativeEnabled
  if (nativePBKDF2Sync && nativeRandomBytes && nativeCreateHash) {
    nativeChecked = true
    nativeEnabled = true
    return true
  }
  if (isExpoGo()) {
    nativeChecked = true
    nativeEnabled = false
    return false
  }
  try {
    const moduleName = ['react-native-quick-crypto'].join('')
    const reqFn = (global as any).require ?? require
    const qcrypto = reqFn(moduleName)
    nativePBKDF2Sync = qcrypto.pbkdf2Sync
    nativeRandomBytes = qcrypto.randomBytes
    nativeCreateHash = qcrypto.createHash
    nativeChecked = true
    nativeEnabled = true
    return true
  } catch {
    nativeChecked = true
    nativeEnabled = false
    return false
  }
}

export const useNative = () => {
  return tryLoadNative()
}

export const __resetDevWarnForTest = () => {
  warned = false
}

export const pbkdf2 = (password: string, salt: Uint8Array, iterations: number, dkLen: number, digest: 'sha256' | 'sha512'): Uint8Array => {
  devWarnOnce()
  if (useNative()) {
    const buf = nativePBKDF2Sync(password, salt, iterations, dkLen, digest)
    return new Uint8Array(buf)
  }
  const hashFn = digest === 'sha256' ? sha256 : sha512
  const out = noblePbkdf2(hashFn, password, salt, { c: iterations, dkLen })
  return out
}

export const randomBytes = (length: number): Uint8Array => {
  devWarnOnce()
  if (useNative()) {
    const buf = nativeRandomBytes(length)
    return new Uint8Array(buf)
  }
  const getRB =
    (ExpoCrypto as any)?.getRandomBytes ??
    (ExpoCrypto as any)?.default?.getRandomBytes
  if (typeof getRB === 'function') {
    const out = getRB(length)
    if (out instanceof Uint8Array) return out
    if (Array.isArray(out)) return new Uint8Array(out)
    if (out instanceof ArrayBuffer) return new Uint8Array(out)
    if ((out as any)?.buffer instanceof ArrayBuffer) return new Uint8Array((out as any).buffer)
  }
  if (typeof crypto !== 'undefined' && (crypto as any).getRandomValues) {
    return (crypto as any).getRandomValues(new Uint8Array(length))
  }
  const isTestEnvironment = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
  const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  if (!isTestEnvironment && isProduction) {
    throw new Error('Secure random generation not available')
  }
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

export const hash = async (data: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Promise<string> => {
  devWarnOnce()
  if (useNative()) {
    const nativeAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'sha512'
    const hasher = nativeCreateHash(nativeAlgorithm)
    hasher.update(data)
    return hasher.digest('hex')
  }
  const fn = algorithm === 'SHA-256' ? sha256 : sha512
  const encoded = new TextEncoder().encode(data)
  return bytesToHex(fn(encoded))
}
