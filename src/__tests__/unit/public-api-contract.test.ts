import { StorageErrorCode } from '../../expo-lite-data-store';

describe('public API contract', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('expo-modules-core');
  });

  it('exports StorageErrorCode as runtime constants from the public entrypoint', () => {
    expect(StorageErrorCode.EXPO_MODULE_MISSING).toBe('EXPO_MODULE_MISSING');
    expect(StorageErrorCode.AUTH_ON_ACCESS_UNSUPPORTED).toBe('AUTH_ON_ACCESS_UNSUPPORTED');
  });

  it('does not require expo-modules-core when fileSystemCompat is imported', () => {
    jest.resetModules();
    jest.doMock('expo-modules-core', () => {
      throw new Error('expo-modules-core should not be loaded during import');
    });

    expect(() => require('../../utils/fileSystemCompat')).not.toThrow();
  });
});
