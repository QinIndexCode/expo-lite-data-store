import fs from 'fs';
import path from 'path';

describe('package exports', () => {
  const packageJsonPath = path.resolve(__dirname, '../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    exports?: Record<string, { types?: string; import?: string; require?: string }>;
  };

  it('maps utils subpaths to concrete built files', () => {
    expect(packageJson.exports?.['./utils/*']).toEqual({
      types: './dist/types/utils/*.d.ts',
      import: './dist/js/utils/*.js',
      require: './dist/cjs/utils/*.js',
    });
  });

  it('resolves the crypto provider subpath through the package export map', () => {
    const resolvedPath = require.resolve('expo-lite-data-store/utils/cryptoProvider');

    expect(resolvedPath).toBe(path.resolve(__dirname, '../../../dist/cjs/utils/cryptoProvider.js'));
  });
});
