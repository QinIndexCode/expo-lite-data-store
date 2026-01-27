jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: 'expo' },
}))

describe('cryptoProvider dev warning in Expo Go', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('logs once in dev when called multiple times', () => {
    const originalDev = (global as any).__DEV__
    ;(global as any).__DEV__ = true
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const { randomBytes, __resetDevWarnForTest } = require('../../utils/cryptoProvider')
    __resetDevWarnForTest()
    randomBytes(8)
    randomBytes(8)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe(
      'Running in Expo Go. Using fallback JavaScript crypto implementation. For native performance, build a standalone APK/IPA.'
    )
    spy.mockRestore()
    ;(global as any).__DEV__ = originalDev
  })
})

describe('crypto iterations in Expo Go', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('reduces PBKDF2 iterations for Expo Go', async () => {
    const pbkdf2Mock = jest.fn(
      (_password: string, _salt: Uint8Array, _iterations: number, _dkLen: number, _digest: 'sha256' | 'sha512') => {
        return new Uint8Array(64)
      }
    )
    const randomBytesMock = (length: number) => new Uint8Array(length)
    jest.doMock('../../utils/cryptoProvider', () => ({
      pbkdf2: pbkdf2Mock,
      randomBytes: randomBytesMock,
    }))

    const { configManager } = require('../../core/config/ConfigManager')
    configManager.updateConfig({ encryption: { keyIterations: 120000 } })

    const { encrypt } = require('../../utils/crypto')
    await encrypt('test', 'master-key')

    expect(pbkdf2Mock).toHaveBeenCalled()
    const iterations = pbkdf2Mock.mock.calls[0][2]
    expect(iterations).toBe(20000)

    configManager.resetConfig()
  })
})
