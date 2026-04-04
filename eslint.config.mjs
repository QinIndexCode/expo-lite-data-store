import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore all files that should not be checked
  {
    ignores: [
      'dist/**',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.js',
      '__mocks__/**',
      'jest.*.js',
      'liteStore.config.ts',
      'test-install/**',
      'NexSyncNew/**',
    ],
  },

  // Only check actual source files
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
      // Disable rules that cause issues
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  }
);
