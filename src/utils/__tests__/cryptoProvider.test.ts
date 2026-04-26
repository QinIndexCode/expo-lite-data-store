import { createHash, createHmac, pbkdf2Sync } from 'node:crypto'
import {
  __resetNativeCryptoForTest,
  hash as providerHash,
  hmac as providerHmac,
  pbkdf2 as providerPbkdf2,
  randomBytes as providerRandomBytes,
  registerNativeCryptoModule,
  useNative,
} from '../../utils/cryptoProvider'

describe('cryptoProvider', () => {
  beforeEach(() => {
    __resetNativeCryptoForTest()
  })

  afterEach(() => {
    __resetNativeCryptoForTest()
  })

  test('randomBytes returns correct length', () => {
    const len = 32
    const bytes = providerRandomBytes(len)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(len)
  })

  test('pbkdf2 matches node crypto (sha256)', () => {
    const password = 'test-password'
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const iterations = 1000
    const dkLen = 64
    const expected = pbkdf2Sync(password, salt, iterations, dkLen, 'sha256')
    const actual = providerPbkdf2(password, salt, iterations, dkLen, 'sha256')
    expect(Buffer.from(actual).toString('hex')).toBe(Buffer.from(expected).toString('hex'))
  })

  test('hmac matches node crypto (sha512)', () => {
    const key = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])
    const actual = providerHmac('hmac-payload', key, 'SHA-512')
    const expected = createHmac('sha512', key).update('hmac-payload').digest()

    expect(Buffer.from(actual).toString('hex')).toBe(expected.toString('hex'))
  })

  test('uses an explicitly registered native crypto module when available', async () => {
    const update = jest.fn()
    const hmacUpdate = jest.fn().mockReturnThis()
    const digest = jest.fn(() => 'native-hash')
    const nativeModule = {
      pbkdf2Sync: jest.fn(
        (_password: string, _salt: Uint8Array, _iterations: number, dkLen: number) =>
          Buffer.from(Array.from({ length: dkLen }, (_, index) => index + 1))
      ),
      randomBytes: jest.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => 255 - index))),
      createHash: jest.fn(() => ({
        update,
        digest,
      })),
      createHmac: jest.fn(() => ({
        update: hmacUpdate,
        digest: jest.fn(() => Buffer.from([5, 4, 3, 2])),
      })),
    }

    expect(registerNativeCryptoModule(nativeModule)).toBe(true)
    expect(useNative()).toBe(true)
    expect(Buffer.from(providerRandomBytes(4))).toEqual(Buffer.from([255, 254, 253, 252]))

    const derived = providerPbkdf2('native-password', new Uint8Array([1, 2, 3]), 2000, 4, 'sha256')
    expect(Buffer.from(derived)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(nativeModule.pbkdf2Sync).toHaveBeenCalledWith('native-password', new Uint8Array([1, 2, 3]), 2000, 4, 'sha256')

    await expect(providerHash('native-data', 'SHA-256')).resolves.toBe('native-hash')
    expect(nativeModule.createHash).toHaveBeenCalledWith('sha256')
    expect(update).toHaveBeenCalledWith('native-data')
    expect(digest).toHaveBeenCalledWith('hex')
    expect(Buffer.from(providerHmac('native-data', new Uint8Array([1, 2, 3]), 'SHA-256'))).toEqual(
      Buffer.from([5, 4, 3, 2])
    )
    expect(nativeModule.createHmac).toHaveBeenCalledWith('sha256', new Uint8Array([1, 2, 3]))
    expect(hmacUpdate).toHaveBeenCalledWith('native-data')
  })

  test('accepts native crypto modules that expose a self-referential default export', () => {
    const nativeModule = {
      pbkdf2Sync: jest.fn(() => Buffer.from([1, 2, 3, 4])),
      randomBytes: jest.fn(() => Buffer.from([9, 8, 7, 6])),
      createHash: jest.fn(() => ({
        update: jest.fn(),
        digest: jest.fn(() => 'default-self'),
      })),
      createHmac: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn(() => Buffer.from([6, 7, 8, 9])),
      })),
    } as {
      default?: unknown
      pbkdf2Sync: jest.Mock
      randomBytes: jest.Mock
      createHash: jest.Mock
      createHmac: jest.Mock
    }
    nativeModule.default = nativeModule

    expect(registerNativeCryptoModule(nativeModule)).toBe(true)
    expect(useNative()).toBe(true)
    expect(Buffer.from(providerRandomBytes(4))).toEqual(Buffer.from([9, 8, 7, 6]))
  })

  test('hash fallback matches node crypto (sha256)', async () => {
    const expected = createHash('sha256').update('fallback-data').digest('hex')
    await expect(providerHash('fallback-data', 'SHA-256')).resolves.toBe(expected)
  })
})
