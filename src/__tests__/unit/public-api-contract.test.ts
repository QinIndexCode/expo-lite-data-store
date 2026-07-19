import fs from 'fs';
import path from 'path';

type PublicApiRuntime = Record<string, unknown> & {
  StorageErrorCode: {
    EXPO_MODULE_MISSING: string;
    AUTH_ON_ACCESS_UNSUPPORTED: string;
  };
};

type ExpoFileSystemModule = Pick<typeof import('expo-file-system'), 'getInfoAsync' | 'writeAsStringAsync'>;
type MetadataManagerModule = Pick<typeof import('../../core/meta/MetadataManager'), 'MetadataManager'>;

const loadRuntimeModule = (modulePath: string): unknown => require(modulePath) as unknown;

const loadPublicApiRuntime = (): PublicApiRuntime =>
  require('../../expo-lite-data-store') as unknown as PublicApiRuntime;

const loadExpoFileSystem = (): ExpoFileSystemModule => require('expo-file-system') as unknown as ExpoFileSystemModule;

const loadMetadataManagerModule = (): MetadataManagerModule =>
  require('../../core/meta/MetadataManager') as unknown as MetadataManagerModule;

describe('public API contract', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('expo-modules-core');
  });

  it('exports StorageErrorCode as runtime constants from the public entrypoint', () => {
    const { StorageErrorCode } = loadPublicApiRuntime();

    expect(StorageErrorCode.EXPO_MODULE_MISSING).toBe('EXPO_MODULE_MISSING');
    expect(StorageErrorCode.AUTH_ON_ACCESS_UNSUPPORTED).toBe('AUTH_ON_ACCESS_UNSUPPORTED');
  });

  it('does not expose the raw plain storage adapter from the public entrypoint', () => {
    const publicApi = loadPublicApiRuntime();

    expect(publicApi).not.toHaveProperty('plainStorage');
  });

  it('does not require expo-modules-core when fileSystemCompat is imported', () => {
    jest.resetModules();
    jest.doMock('expo-modules-core', () => {
      throw new Error('expo-modules-core should not be loaded during import');
    });

    expect(() => {
      void loadRuntimeModule('../../utils/fileSystemCompat');
    }).not.toThrow();
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
    const fileSystem = loadExpoFileSystem();
    const getInfoSpy = jest.spyOn(fileSystem, 'getInfoAsync');
    const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync');
    const { MetadataManager } = loadMetadataManagerModule();

    new MetadataManager();

    expect(getInfoSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
