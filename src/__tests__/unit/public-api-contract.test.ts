import fs from 'fs';
import path from 'path';

describe('public API contract', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('expo-modules-core');
  });

  it('exports StorageErrorCode as runtime constants from the public entrypoint', () => {
    const { StorageErrorCode } = require('../../expo-lite-data-store');

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

  it('keeps Expo runtime peers behind lazy loaders in import-chain modules', () => {
    const sourceFiles = [
      path.resolve(__dirname, '../../utils/cryptoProvider.ts'),
      path.resolve(__dirname, '../../utils/crypto-gcm.ts'),
      path.resolve(__dirname, '../../core/file/FileHandlerBase.ts'),
    ];

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      expect(source).not.toMatch(/\bfrom\s+['"]expo-(?:constants|crypto)['"]/u);
      expect(source).not.toMatch(/\bimport\s+\*\s+as\s+\w+\s+from\s+['"]expo-(?:constants|crypto)['"]/u);
    }
  });

  it('does not touch the file system when metadata managers are constructed', () => {
    jest.resetModules();
    const fileSystem = require('expo-file-system');
    const getInfoSpy = jest.spyOn(fileSystem, 'getInfoAsync');
    const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync');
    const { MetadataManager } = require('../../core/meta/MetadataManager');

    new MetadataManager();

    expect(getInfoSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
