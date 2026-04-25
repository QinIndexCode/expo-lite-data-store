import { StorageError } from '../types/storageErrorInfc';

const REQUIRED_EXPO_INSTALL_PACKAGES = [
  'expo-lite-data-store',
  'expo-file-system',
  'expo-constants',
  'expo-crypto',
  'expo-secure-store',
] as const;

export const normalizeExpoRuntimePackageName = (moduleName: string): string => {
  switch (moduleName) {
    case 'expo-file-system/legacy':
      return 'expo-file-system';
    default:
      return moduleName;
  }
};

export const getSupportedExpoInstallCommand = (additionalPackages: string[] = []): string => {
  const seenPackages = new Set<string>();
  const packages = [...REQUIRED_EXPO_INSTALL_PACKAGES, ...additionalPackages]
    .map(item => normalizeExpoRuntimePackageName(item))
    .filter(item => {
      if (seenPackages.has(item)) {
        return false;
      }
      seenPackages.add(item);
      return true;
    });

  return `npx expo install ${packages.join(' ')}`;
};

export const buildExpoPeerInstallHint = (moduleName?: string): string => {
  const missingPackage = moduleName ? normalizeExpoRuntimePackageName(moduleName) : null;
  const baseCommand = getSupportedExpoInstallCommand();
  const parts = [
    missingPackage ? `Missing Expo runtime package: "${missingPackage}".` : null,
    `Supported install command: \`${baseCommand}\`.`,
    '`npm install expo-lite-data-store` alone is not a supported installation flow for this library.',
    'Install the Expo runtime packages in the consumer application so their native versions stay aligned with the app Expo SDK.',
  ].filter(Boolean);

  return parts.join(' ');
};

const buildExpoModuleMissingDetails = (moduleName: string): string => {
  const missingPackage = normalizeExpoRuntimePackageName(moduleName);
  if (missingPackage === moduleName) {
    return `The package depends on "${moduleName}" at runtime, but the host Expo application could not resolve it.`;
  }

  return `The package depends on "${moduleName}" at runtime. That entry point is provided by the consumer package "${missingPackage}", but the host Expo application could not resolve it.`;
};

type RuntimeRequire = (moduleName: string) => unknown;

const loadBundledExpoPeer = (moduleName: string): unknown => {
  try {
    switch (moduleName) {
      case 'expo-constants':
        return require('expo-constants');
      case 'expo-crypto':
        return require('expo-crypto');
      case 'expo-secure-store':
        return require('expo-secure-store');
      case 'expo-file-system':
        return require('expo-file-system');
      case 'expo-file-system/legacy':
        return require('expo-file-system/legacy');
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
};

const normalizeModule = <T>(moduleValue: T | { default?: T }): T => {
  if (moduleValue && typeof moduleValue === 'object' && 'default' in moduleValue) {
    const defaultValue = (moduleValue as { default?: T }).default;
    if (defaultValue) {
      return defaultValue;
    }
  }
  return moduleValue as T;
};

const getRuntimeRequire = (): RuntimeRequire | undefined => {
  if (typeof module !== 'undefined' && module && typeof module.require === 'function') {
    return module.require.bind(module);
  }

  if (typeof globalThis !== 'undefined') {
    const maybeRequire = (globalThis as { require?: RuntimeRequire }).require;
    if (typeof maybeRequire === 'function') {
      return maybeRequire;
    }
  }

  try {
    // Hermes/Metro can resolve peers here even when direct dynamic require(moduleName) is unsupported.
    const runtimeRequire = Function('return require')() as RuntimeRequire;
    if (typeof runtimeRequire === 'function') {
      return runtimeRequire;
    }
  } catch {}

  return undefined;
};

export const loadOptionalExpoModule = <T>(moduleName: string): T | undefined => {
  try {
    const bundledModule = loadBundledExpoPeer(moduleName);
    if (bundledModule) {
      return normalizeModule<T>(bundledModule);
    }

    const runtimeRequire = getRuntimeRequire();
    const moduleValue = runtimeRequire ? runtimeRequire(moduleName) : undefined;
    if (!moduleValue) {
      return undefined;
    }
    return normalizeModule<T>(moduleValue);
  } catch {
    return undefined;
  }
};

export const loadRequiredExpoModule = <T>(moduleName: string, installHint?: string): T => {
  const moduleValue = loadOptionalExpoModule<T>(moduleName);
  if (!moduleValue) {
    throw new StorageError(`Required Expo module "${moduleName}" is missing`, 'EXPO_MODULE_MISSING', {
      details: buildExpoModuleMissingDetails(moduleName),
      suggestion: installHint || buildExpoPeerInstallHint(moduleName),
    });
  }
  return moduleValue;
};

export const getExpoPeerInstallHint = (moduleName?: string): string => buildExpoPeerInstallHint(moduleName);
