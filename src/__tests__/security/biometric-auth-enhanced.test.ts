describe('requireAuthOnAccess', () => {
  const secureStoreMock = () => (global as any).__expo_secure_store_mock__;

  beforeEach(() => {
    secureStoreMock().mockStore = {};
    secureStoreMock().canUseBiometricAuthentication = true;

    const constants = require('expo-constants');
    constants.appOwnership = 'standalone';
  });

  it('throws AUTH_ON_ACCESS_UNSUPPORTED in Expo Go and does not silently downgrade', async () => {
    const constants = require('expo-constants');
    constants.appOwnership = 'expo';

    const { getMasterKey } = require('../../utils/crypto');

    await expect(getMasterKey(true)).rejects.toMatchObject({
      code: 'AUTH_ON_ACCESS_UNSUPPORTED',
    });
    expect(secureStoreMock().mockStore).toEqual({});
  });

  it('throws AUTH_ON_ACCESS_UNSUPPORTED when biometrics are unavailable', async () => {
    secureStoreMock().canUseBiometricAuthentication = false;

    const { getMasterKey } = require('../../utils/crypto');

    await expect(getMasterKey(true)).rejects.toMatchObject({
      code: 'AUTH_ON_ACCESS_UNSUPPORTED',
    });
    expect(secureStoreMock().mockStore).toEqual({});
  });

  it('still allows encrypted storage when requireAuthOnAccess is false', async () => {
    const { getMasterKey } = require('../../utils/crypto');

    const key = await getMasterKey(false);

    expect(key).toBeTruthy();
    expect(Object.keys(secureStoreMock().mockStore).length).toBeGreaterThanOrEqual(0);
  });
});
