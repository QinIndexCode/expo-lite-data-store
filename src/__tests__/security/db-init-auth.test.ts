/// <reference path="../test-globals.d.ts" />

type ExpoConstantsRuntime = {
  appOwnership?: string;
};

type DataStoreModule = Pick<typeof import('../../expo-lite-data-store'), 'db'>;

const getExpoConstants = (): ExpoConstantsRuntime => require('expo-constants') as ExpoConstantsRuntime;

const getDataStoreModule = (): DataStoreModule => require('../../expo-lite-data-store') as DataStoreModule;

describe('db.init requireAuthOnAccess', () => {
  const secureStoreMock = () => global.__expo_secure_store_mock__;

  beforeEach(() => {
    jest.resetModules();
    secureStoreMock().mockStore = {};
    secureStoreMock().canUseBiometricAuthentication = true;
  });

  it('fails during init in Expo Go instead of silently delaying the auth error', async () => {
    const constants = getExpoConstants();
    constants.appOwnership = 'expo';

    const { db } = getDataStoreModule();

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
