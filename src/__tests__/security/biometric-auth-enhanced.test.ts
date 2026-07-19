/// <reference path="../test-globals.d.ts" />

type ExpoConstantsRuntime = {
  appOwnership?: string;
};

type CryptoModule = Pick<typeof import('../../utils/crypto'), 'getMasterKey'>;

const getExpoConstants = (): ExpoConstantsRuntime => require('expo-constants') as ExpoConstantsRuntime;

const getCryptoModule = (): CryptoModule => require('../../utils/crypto') as CryptoModule;

describe('requireAuthOnAccess', () => {
  const secureStoreMock = () => global.__expo_secure_store_mock__;

  beforeEach(() => {
    secureStoreMock().mockStore = {};
    secureStoreMock().canUseBiometricAuthentication = true;

    const constants = getExpoConstants();
    constants.appOwnership = 'standalone';
  });

  it('throws AUTH_ON_ACCESS_UNSUPPORTED in Expo Go and does not silently downgrade', async () => {
    const constants = getExpoConstants();
    constants.appOwnership = 'expo';

    const { getMasterKey } = getCryptoModule();

    await expect(getMasterKey(true)).rejects.toMatchObject({
      code: 'AUTH_ON_ACCESS_UNSUPPORTED',
    });
    expect(secureStoreMock().mockStore).toEqual({});
  });

  it('throws AUTH_ON_ACCESS_UNSUPPORTED when biometrics are unavailable', async () => {
    secureStoreMock().canUseBiometricAuthentication = false;

    const { getMasterKey } = getCryptoModule();

    await expect(getMasterKey(true)).rejects.toMatchObject({
      code: 'AUTH_ON_ACCESS_UNSUPPORTED',
    });
    expect(secureStoreMock().mockStore).toEqual({});
  });

  it('still allows encrypted storage when requireAuthOnAccess is false', async () => {
    const { getMasterKey } = getCryptoModule();

    const key = await getMasterKey(false);

    expect(key).toBeTruthy();
    expect(Object.keys(secureStoreMock().mockStore).length).toBeGreaterThanOrEqual(0);
  });
});
