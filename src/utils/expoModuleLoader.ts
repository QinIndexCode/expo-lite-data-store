import { StorageError } from '../types/storageErrorInfc';

const PEER_INSTALL_HINT =
  'Install Expo peer dependencies with `npx expo install expo-file-system expo-constants expo-crypto expo-secure-store`.';

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
    // eslint-disable-next-line no-new-func
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
      details: `The package depends on "${moduleName}" at runtime, but it could not be resolved.`,
      suggestion: installHint || PEER_INSTALL_HINT,
    });
  }
  return moduleValue;
};

export const getExpoPeerInstallHint = (): string => PEER_INSTALL_HINT;
