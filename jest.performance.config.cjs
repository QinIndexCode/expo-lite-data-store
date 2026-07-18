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
  testMatch: ['**/*benchmark.test.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 120000,
  maxWorkers: 1,
  cache: true,
};
