import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 彻底忽略所有不该检查的文件
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
    ],
  },

  // 只检查真正的源码
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // 把所有会卡死你的规则全部关掉！！！
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  }
);
