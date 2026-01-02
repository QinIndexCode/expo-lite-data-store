// jest.performance.config.js
// Jest configuration for running performance optimization tests

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
  testMatch: ['**/benchmark.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  verbose: true,
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  // 性能测试可能需要更长的超时时间
  testTimeout: 120000, // 2分钟
  forceExit: true,
  detectOpenHandles: true,
  // 性能测试适合串行执行，避免资源竞争影响测试结果
  maxWorkers: 1,
  // 启用测试结果缓存
  cache: true,
};
