/**
 * Metro configuration for React Native
 * https://github.com/facebook/metro
 *
 * Metro bundler configuration to handle @noble/ciphers and @noble/hashes packages
 */
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// 配置resolver.resolveRequest来处理@noble/ciphers和@noble/hashes包的导入
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // 处理@noble/ciphers包的导入
  if (moduleName.startsWith('@noble/ciphers/')) {
    const subModule = moduleName.replace('@noble/ciphers/', '');
    // 返回完整的文件路径，确保Metro能正确解析
    return {
      filePath: require.resolve(`@noble/ciphers/${subModule}`),
      type: 'sourceFile',
    };
  }

  // 处理@noble/hashes包的导入
  if (moduleName.startsWith('@noble/hashes/')) {
    const subModule = moduleName.replace('@noble/hashes/', '');
    // 返回完整的文件路径，确保Metro能正确解析
    return {
      filePath: require.resolve(`@noble/hashes/${subModule}`),
      type: 'sourceFile',
    };
  }

  // 对于其他模块，使用默认解析器
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
