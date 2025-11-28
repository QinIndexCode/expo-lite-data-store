// jest.config.js
module.exports = {
    preset: 'jest-expo',
    transform: {
        '^.+\.(ts|tsx)$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },
    testMatch: ['**/__tests__/**/*.(js|ts|tsx)', '**/?(*.)+(spec|test).(js|ts|tsx)'],
    testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/index.ts',
    ],
    coverageDirectory: './coverage',
    coverageReporters: ['json', 'lcov', 'text', 'clover'],
    setupFiles: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'node',
    verbose: true,
};
