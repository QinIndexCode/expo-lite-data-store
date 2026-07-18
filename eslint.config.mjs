import tseslint from 'typescript-eslint';

const sharedTypeScriptRules = {
  'no-case-declarations': 'off',
  'no-useless-escape': 'off',
  'prefer-const': 'off',
  '@typescript-eslint/no-unsafe-function-type': 'off',
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
    rules: sharedTypeScriptRules,
  },
  {
    // Root mocks are intentionally outside tsconfig.json but must obey the same syntax rules.
    files: ['__mocks__/**/*.ts', '__mocks__/**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: sharedTypeScriptRules,
  }
);
