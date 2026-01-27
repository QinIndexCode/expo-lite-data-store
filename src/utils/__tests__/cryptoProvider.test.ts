import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { randomBytes as providerRandomBytes, pbkdf2 as providerPbkdf2 } from '../../utils/cryptoProvider'

describe('cryptoProvider', () => {
  test('randomBytes returns correct length', () => {
    const len = 32
    const bytes = providerRandomBytes(len)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(len)
  })

  test('pbkdf2 matches noble implementation (sha256)', () => {
    const password = 'test-password'
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const iterations = 1000
    const dkLen = 64
    const expected = noblePbkdf2(sha256, password, salt, { c: iterations, dkLen })
    const actual = providerPbkdf2(password, salt, iterations, dkLen, 'sha256')
    expect(Buffer.from(actual).toString('hex')).toBe(Buffer.from(expected).toString('hex'))
  })
})
