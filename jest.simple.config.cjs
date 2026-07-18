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
    'node_modules/(?!(expo-file-system|expo-constants|expo-crypto|expo-secure-store|@expo|expo-.*|expo-modules-core)/)',
  ],
  testMatch: ['**/?(*.)+(spec|test).(js|ts|tsx)'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts', '\\.d\\.ts$'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 60000,
  maxWorkers: '50%',
  cache: true,
  testSequencer: '@jest/test-sequencer',
};
