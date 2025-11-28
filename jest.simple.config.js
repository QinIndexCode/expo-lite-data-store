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
        '^expo-file-system$': '<rootDir>/__mocks__/expo-file-system.ts',
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};