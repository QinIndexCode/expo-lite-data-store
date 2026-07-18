/// <reference path="../test-globals.d.ts" />

describe('db.init requireAuthOnAccess', () => {
  const secureStoreMock = () => global.__expo_secure_store_mock__;

  beforeEach(() => {
    jest.resetModules();
    secureStoreMock().mockStore = {};
    secureStoreMock().canUseBiometricAuthentication = true;
  });

  it('fails during init in Expo Go instead of silently delaying the auth error', async () => {
    const constants = require('expo-constants');
    constants.appOwnership = 'expo';

    const { db } = require('../../expo-lite-data-store');

    await expect(
      db.init({
        encrypted: true,
        requireAuthOnAccess: true,
      })
    ).rejects.toMatchObject({
      code: 'AUTH_ON_ACCESS_UNSUPPORTED',
    });

    expect(secureStoreMock().mockStore).toEqual({});
  });
});
