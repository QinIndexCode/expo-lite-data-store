import {
  buildExpoPeerInstallHint,
  getExpoPeerInstallHint,
  getSupportedExpoInstallCommand,
  normalizeExpoRuntimePackageName,
} from '../../utils/expoModuleLoader';

describe('expo module loader install guidance', () => {
  it('normalizes Expo runtime entry points to installable package names', () => {
    expect(normalizeExpoRuntimePackageName('expo-file-system/legacy')).toBe('expo-file-system');
    expect(normalizeExpoRuntimePackageName('expo-secure-store')).toBe('expo-secure-store');
  });

  it('publishes the supported install command for consumer apps', () => {
    expect(getSupportedExpoInstallCommand()).toBe(
      'npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store'
    );
  });

  it('builds a missing-module hint that points back to the documented install contract', () => {
    const hint = buildExpoPeerInstallHint('expo-file-system/legacy');

    expect(hint).toContain('Missing Expo runtime package: "expo-file-system".');
    expect(hint).toContain(
      '`npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`'
    );
    expect(hint).toContain('`npm install expo-lite-data-store` alone is not a supported installation flow');
  });

  it('keeps the generic exported install hint aligned with the same guidance', () => {
    const hint = getExpoPeerInstallHint('expo-secure-store');

    expect(hint).toContain('expo-secure-store');
    expect(hint).toContain('consumer application');
  });
});
