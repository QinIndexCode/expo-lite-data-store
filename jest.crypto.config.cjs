// jest.crypto.config.js
// Jest configuration for running crypto security assessment tests

module.exports = {
  transform: {
    '^.+\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
    '^.+\.(js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo-file-system|expo-constants|expo-crypto|expo-secure-store|@expo|expo-*)/)',
  ],
  testMatch: ['**/crypto-security-assessment.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  verbose: true,
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  // 加密测试可能需要更长的超时时间
  testTimeout: 300000, // 5分钟
  forceExit: true,
  detectOpenHandles: true,
  // 加密测试适合串行执行，避免资源竞争
  maxWorkers: 1,
  // 启用测试结果缓存
  cache: true,
};
