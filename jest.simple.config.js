// jest.simple.config.js
// Simple Jest configuration for testing non-Expo dependent modules

module.exports = {
    transform: {
        '^.+\.(ts|tsx)$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
        '^.+\.(js|jsx)$': 'babel-jest',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(expo-file-system|expo-constants|expo-crypto|expo-secure-store|@expo|expo-*)/)',
    ],
    testMatch: ['**/__tests__/**/*.(js|ts|tsx)', '**/?(*.)+(spec|test).(js|ts|tsx)'],
    testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testEnvironment: 'node',
    verbose: true,
    moduleNameMapper: {
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // 60秒超时设置
    testTimeout: 60000, // 60秒
    forceExit: true,
    detectOpenHandles: true,
    // 启用并行测试执行
    maxWorkers: '50%', // 使用50%的CPU核心数进行并行测试
    // 启用测试结果缓存
    cache: true,
    // 启用测试分割
    testSequencer: '@jest/test-sequencer',
};