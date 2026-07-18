/// <reference path="../../__tests__/test-globals.d.ts" />

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: 'expo' },
}));

type RuntimeLogger = {
  warn: (message: string, ...args: unknown[]) => void;
};

const getRuntimeLogger = (): RuntimeLogger => {
  const loggerModule = require('../../utils/logger') as RuntimeLogger & { default?: RuntimeLogger };
  return loggerModule.default ?? loggerModule;
};

describe('cryptoProvider dev warning in Expo Go', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('logs one Expo Go fallback warning when random bytes are requested repeatedly in development', () => {
    const runtimeGlobal = globalThis as typeof globalThis & { __DEV__?: boolean };
    const originalDev = runtimeGlobal.__DEV__;
    runtimeGlobal.__DEV__ = true;
    const warningSpy = jest.spyOn(getRuntimeLogger(), 'warn').mockImplementation(() => undefined);

    try {
      const { randomBytes, __resetDevWarnForTest } = require('../../utils/cryptoProvider');
      __resetDevWarnForTest();
      randomBytes(8);
      randomBytes(8);

      expect(warningSpy).toHaveBeenCalledTimes(1);
      expect(warningSpy.mock.calls[0][0]).toBe(
        'Expo Go detected. Using JavaScript crypto fallback. Build a standalone APK/IPA for native performance.'
      );
    } finally {
      warningSpy.mockRestore();
      runtimeGlobal.__DEV__ = originalDev;
    }
  });
});

describe('crypto iterations in Expo Go', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reduces PBKDF2 iterations for Expo Go when AES-CTR is configured', async () => {
    const pbkdf2Mock = jest.fn(
      (_password: string, _salt: Uint8Array, _iterations: number, dkLen: number, _digest: 'sha256' | 'sha512') => {
        return new Uint8Array(dkLen);
      }
    );
    const randomBytesMock = (length: number) => new Uint8Array(length);
    const hkdfDeriveMock = (_ikm: Uint8Array, _salt: Uint8Array, dkLen: number) => new Uint8Array(dkLen);
    const hmacMock = (_data: string | Uint8Array, _key: Uint8Array) => new Uint8Array(32);
    const hashBytesMock = (_data: string | Uint8Array, _algorithm: 'SHA-256' | 'SHA-512') => new Uint8Array(32);
    jest.doMock('../../utils/cryptoProvider', () => ({
      pbkdf2: pbkdf2Mock,
      randomBytes: randomBytesMock,
      hkdfDerive: hkdfDeriveMock,
      hmac: hmacMock,
      hashBytes: hashBytesMock,
    }));

    const { configManager } = require('../../core/config/ConfigManager');
    const warningSpy = jest.spyOn(getRuntimeLogger(), 'warn').mockImplementation(() => undefined);

    try {
      configManager.updateConfig({
        encryption: { keyIterations: 120000, algorithm: 'AES-CTR' },
      });

      const { encrypt } = require('../../utils/crypto');
      await encrypt('test', 'master-key');

      expect(pbkdf2Mock).toHaveBeenCalled();
      expect(pbkdf2Mock.mock.calls[0][2]).toBe(20000);
    } finally {
      configManager.resetConfig();
      warningSpy.mockRestore();
    }
  });

  it('bounds PBKDF2 iterations for Expo Go when AES-GCM is configured', async () => {
    const pbkdf2Mock = jest.fn(
      (_password: string, _salt: Uint8Array, _iterations: number, dkLen: number, _digest: 'sha256' | 'sha512') => {
        return new Uint8Array(dkLen);
      }
    );
    const randomBytesMock = (length: number) => new Uint8Array(length);
    const hkdfDeriveMock = (_ikm: Uint8Array, _salt: Uint8Array, dkLen: number) => new Uint8Array(dkLen);
    const hmacMock = (_data: string | Uint8Array, _key: Uint8Array) => new Uint8Array(32);
    const hashBytesMock = (_data: string | Uint8Array, _algorithm: 'SHA-256' | 'SHA-512') => new Uint8Array(32);
    jest.doMock('../../utils/cryptoProvider', () => ({
      pbkdf2: pbkdf2Mock,
      randomBytes: randomBytesMock,
      hkdfDerive: hkdfDeriveMock,
      hmac: hmacMock,
      hashBytes: hashBytesMock,
    }));

    const { configManager } = require('../../core/config/ConfigManager');

    try {
      configManager.updateConfig({
        encryption: { keyIterations: 120000, algorithm: 'AES-GCM' },
      });

      const { encrypt } = require('../../utils/crypto');
      await encrypt('test', 'master-key');

      expect(pbkdf2Mock).toHaveBeenCalled();
      expect(pbkdf2Mock.mock.calls[0][2]).toBeLessThanOrEqual(20000);
      expect(pbkdf2Mock.mock.calls[0][2]).toBeGreaterThanOrEqual(10000);
    } finally {
      configManager.resetConfig();
    }
  });
});
