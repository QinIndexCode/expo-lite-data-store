import tseslint from 'typescript-eslint';

const sharedTypeScriptRules = {
  'no-case-declarations': 'off',
  'no-useless-escape': 'off',
  'prefer-const': 'off',
  '@typescript-eslint/no-unsafe-function-type': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  'no-unused-vars': 'off',
  'no-console': 'off',
};

const typeCheckedSafetyRules = {
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'artifacts/**',
      '**/*.d.ts',
      '**/*.js',
      'liteStore.config.ts',
      'test-install/**',
      'NexSyncNew/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...sharedTypeScriptRules,
      ...typeCheckedSafetyRules,
    },
  },
  {
    // Production modules log through the bounded logger adapter; tests and the adapter itself are explicit exceptions.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.spec.ts', 'src/utils/logger.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Root mocks use their dedicated project so unsafe values cannot bypass type-aware rules.
    files: ['__mocks__/**/*.ts', '__mocks__/**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.mocks.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedTypeScriptRules,
      ...typeCheckedSafetyRules,
    },
  }
);
