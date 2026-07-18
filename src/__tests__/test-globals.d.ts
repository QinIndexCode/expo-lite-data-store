export {};

type MockFileSystemEntry = string | { __type: 'directory' };

declare global {
  interface GlobalThis {
    __DEV__?: boolean;
  }

  var __DEV__: boolean | undefined;
  var __expo_file_system_mock__: {
    mockFileSystem: Record<string, MockFileSystemEntry>;
  };
  var __expo_secure_store_mock__: {
    mockStore: Record<string, string>;
    canUseBiometricAuthentication: boolean;
  };
  var __expoConfig:
    | {
        extra?: {
          liteStore?: Record<string, unknown>;
        };
      }
    | undefined;
  var expo:
    | {
        extra?: {
          liteStore?: Record<string, unknown>;
        };
      }
    | undefined;
  var liteStoreConfig: Record<string, unknown> | undefined;
}
