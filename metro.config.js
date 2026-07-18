/**
 * Metro configuration for React Native
 * https://github.com/facebook/metro
 *
 * Metro bundler configuration to handle @noble/ciphers and @noble/hashes packages
 */
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Metro does not resolve these package subpaths consistently across Expo targets.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@noble/ciphers/')) {
    const subModule = moduleName.replace('@noble/ciphers/', '');
    return {
      filePath: require.resolve(`@noble/ciphers/${subModule}`),
      type: 'sourceFile',
    };
  }

  if (moduleName.startsWith('@noble/hashes/')) {
    const subModule = moduleName.replace('@noble/hashes/', '');
    return {
      filePath: require.resolve(`@noble/hashes/${subModule}`),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
