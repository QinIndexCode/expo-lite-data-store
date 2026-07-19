import fs from 'fs';
import path from 'path';

type PackageRuntimeExports = Record<string, unknown>;

describe('package exports', () => {
  const packageJsonPath = path.resolve(__dirname, '../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    exports?: Record<string, { types?: string; import?: string; require?: string }>;
    scripts?: Record<string, string>;
  };

  it('maps utils subpaths to concrete built files', () => {
    expect(packageJson.exports?.['./utils/*']).toEqual({
      types: './dist/types/utils/*.d.ts',
      import: './dist/js/utils/*.js',
      require: './dist/cjs/utils/*.js',
    });
  });

  it('does not expose core implementation files through package subpaths', () => {
    expect(packageJson.exports).not.toHaveProperty('./dist/js/*');
    expect(packageJson.exports).not.toHaveProperty('./dist/cjs/*');
    expect(packageJson.scripts?.['publish:force']).not.toContain('--ignore-scripts');
  });

  it('resolves the crypto provider subpath through the package export map', () => {
    const resolvedPath = require.resolve('expo-lite-data-store/utils/cryptoProvider');

    expect(resolvedPath).toBe(path.resolve(__dirname, '../../../dist/cjs/utils/cryptoProvider.js'));
  });

  it('does not expose plainStorage from the built package runtime or types entrypoints', () => {
    const publicApi = require('expo-lite-data-store') as unknown as PackageRuntimeExports;
    const declarationPath = path.resolve(__dirname, '../../../dist/types/expo-lite-data-store.d.ts');

    expect(publicApi).not.toHaveProperty('plainStorage');
    expect(fs.readFileSync(declarationPath, 'utf8')).not.toMatch(/\bplainStorage\b/u);
  });
});
