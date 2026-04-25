import { loadRequiredExpoModule } from './expoModuleLoader';

type EncodingTypeShape = {
  UTF8: string;
  Base64?: string;
  Base64WebSafe?: string;
  UTF16?: string;
};

export type ExpoFileSystemCompat = {
  documentDirectory?: string | null;
  EncodingType?: EncodingTypeShape;
  getInfoAsync: (uri: string, options?: Record<string, unknown>) => Promise<any>;
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options?: { encoding?: string }
  ) => Promise<void>;
  readAsStringAsync: (uri: string, options?: { encoding?: string }) => Promise<string>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  moveAsync: (options: { from: string; to: string }) => Promise<void>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
};

type NativeLegacyFileSystemModule = {
  documentDirectory?: string | null;
  getInfoAsync?: ExpoFileSystemCompat['getInfoAsync'];
  makeDirectoryAsync?: ExpoFileSystemCompat['makeDirectoryAsync'];
  writeAsStringAsync?: ExpoFileSystemCompat['writeAsStringAsync'];
  readAsStringAsync?: ExpoFileSystemCompat['readAsStringAsync'];
  deleteAsync?: ExpoFileSystemCompat['deleteAsync'];
  moveAsync?: ExpoFileSystemCompat['moveAsync'];
  readDirectoryAsync?: ExpoFileSystemCompat['readDirectoryAsync'];
};

type NativeModernFileSystemModule = {
  documentDirectory?: string | null;
};

type RequireOptionalNativeModule = <T>(moduleName: string) => T | null;

let cachedFileSystemModule: ExpoFileSystemCompat | null = null;
let cachedModernFileSystemModule: any | null = null;
let cachedRequireOptionalNativeModule: RequireOptionalNativeModule | null | undefined;

const normalizeDirectoryUri = (uri?: string | null): string | null => {
  if (typeof uri !== 'string' || uri.length === 0) {
    return null;
  }

  return uri.endsWith('/') ? uri : `${uri}/`;
};

const createEncodingTypeShape = (): EncodingTypeShape => ({
  UTF8: 'utf8',
  Base64: 'base64',
  Base64WebSafe: 'base64web-safe',
  UTF16: 'utf16',
});

const getRequireOptionalNativeModule = (): RequireOptionalNativeModule | null => {
  if (cachedRequireOptionalNativeModule !== undefined) {
    return cachedRequireOptionalNativeModule;
  }

  try {
    const expoModulesCore = require('expo-modules-core') as {
      requireOptionalNativeModule?: RequireOptionalNativeModule;
    };
    cachedRequireOptionalNativeModule =
      typeof expoModulesCore.requireOptionalNativeModule === 'function'
        ? expoModulesCore.requireOptionalNativeModule
        : null;
  } catch {
    cachedRequireOptionalNativeModule = null;
  }

  return cachedRequireOptionalNativeModule;
};

const hasLegacyFileSystemShape = (
  moduleValue: NativeLegacyFileSystemModule | null | undefined
): moduleValue is Required<
  Pick<
    NativeLegacyFileSystemModule,
    | 'getInfoAsync'
    | 'makeDirectoryAsync'
    | 'writeAsStringAsync'
    | 'readAsStringAsync'
    | 'deleteAsync'
    | 'moveAsync'
    | 'readDirectoryAsync'
  >
> &
  NativeLegacyFileSystemModule => {
  return Boolean(
    moduleValue &&
      typeof moduleValue.getInfoAsync === 'function' &&
      typeof moduleValue.makeDirectoryAsync === 'function' &&
      typeof moduleValue.writeAsStringAsync === 'function' &&
      typeof moduleValue.readAsStringAsync === 'function' &&
      typeof moduleValue.deleteAsync === 'function' &&
      typeof moduleValue.moveAsync === 'function' &&
      typeof moduleValue.readDirectoryAsync === 'function'
  );
};

const loadNativeLegacyFileSystemModule = (): ExpoFileSystemCompat | null => {
  try {
    const requireOptionalNativeModule = getRequireOptionalNativeModule();
    if (!requireOptionalNativeModule) {
      return null;
    }

    const nativeModule = requireOptionalNativeModule<NativeLegacyFileSystemModule>('ExponentFileSystem');
    if (!hasLegacyFileSystemShape(nativeModule)) {
      return null;
    }

    return {
      documentDirectory: normalizeDirectoryUri(nativeModule.documentDirectory),
      EncodingType: createEncodingTypeShape(),
      getInfoAsync: (uri, options = {}) => nativeModule.getInfoAsync(uri, options),
      makeDirectoryAsync: (uri, options = {}) => nativeModule.makeDirectoryAsync(uri, options),
      writeAsStringAsync: (uri, contents, options = {}) =>
        nativeModule.writeAsStringAsync(uri, contents, options),
      readAsStringAsync: (uri, options = {}) => nativeModule.readAsStringAsync(uri, options),
      deleteAsync: (uri, options = {}) => nativeModule.deleteAsync(uri, options),
      moveAsync: options => nativeModule.moveAsync(options),
      readDirectoryAsync: uri => nativeModule.readDirectoryAsync(uri),
    };
  } catch {
    return null;
  }
};

const loadFileSystemModule = (): ExpoFileSystemCompat => {
  if (cachedFileSystemModule) {
    return cachedFileSystemModule;
  }

  const nativeModule = loadNativeLegacyFileSystemModule();
  if (nativeModule) {
    cachedFileSystemModule = nativeModule;
    return cachedFileSystemModule;
  }

  try {
    cachedFileSystemModule = loadRequiredExpoModule<ExpoFileSystemCompat>('expo-file-system/legacy');
  } catch {
    cachedFileSystemModule = loadRequiredExpoModule<ExpoFileSystemCompat>('expo-file-system');
  }

  return cachedFileSystemModule;
};

const loadModernFileSystemModule = (): any | null => {
  if (cachedModernFileSystemModule !== null) {
    return cachedModernFileSystemModule;
  }

  try {
    const requireOptionalNativeModule = getRequireOptionalNativeModule();
    if (!requireOptionalNativeModule) {
      return null;
    }

    const nativeModernModule = requireOptionalNativeModule<NativeModernFileSystemModule>('FileSystem');
    if (nativeModernModule) {
      cachedModernFileSystemModule = {
        documentDirectory: normalizeDirectoryUri(nativeModernModule.documentDirectory),
      };
      return cachedModernFileSystemModule;
    }
  } catch {
    // Ignore native module lookup errors and fall back to the package implementation.
  }

  try {
    cachedModernFileSystemModule = loadRequiredExpoModule<any>('expo-file-system');
  } catch {
    cachedModernFileSystemModule = undefined;
  }

  return cachedModernFileSystemModule || null;
};

export const getFileSystem = (): ExpoFileSystemCompat => loadFileSystemModule();

export const getEncodingType = (): EncodingTypeShape => {
  return getFileSystem().EncodingType || createEncodingTypeShape();
};

export const getDocumentDirectory = (): string => {
  const modernDocumentDirectory = loadModernFileSystemModule()?.Paths?.document?.uri;
  if (typeof modernDocumentDirectory === 'string' && modernDocumentDirectory.length > 0) {
    return modernDocumentDirectory.endsWith('/') ? modernDocumentDirectory : `${modernDocumentDirectory}/`;
  }

  const nativeDocumentDirectory = loadModernFileSystemModule()?.documentDirectory;
  if (typeof nativeDocumentDirectory === 'string' && nativeDocumentDirectory.length > 0) {
    return nativeDocumentDirectory.endsWith('/')
      ? nativeDocumentDirectory
      : `${nativeDocumentDirectory}/`;
  }

  return getFileSystem().documentDirectory || '/mock/documents/';
};
