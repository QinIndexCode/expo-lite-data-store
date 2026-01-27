import { pbkdf2 as providerPbkdf2, randomBytes as providerRandomBytes, hash as providerHash } from '../utils/cryptoProvider'

export const deriveKey = async (
  masterKey: string,
  salt: Uint8Array,
  iterations: number,
  dkLen: number = 64,
  digest: 'sha256' | 'sha512' = 'sha256'
): Promise<Uint8Array> => {
  return providerPbkdf2(masterKey, salt, iterations, dkLen, digest)
}

export const randomBytes = (length: number): Uint8Array => {
  return providerRandomBytes(length)
}

export const hash = async (data: string, algorithm: 'SHA-256' | 'SHA-512' = 'SHA-512'): Promise<string> => {
  return providerHash(data, algorithm)
}
