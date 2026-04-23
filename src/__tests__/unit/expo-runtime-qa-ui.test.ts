import fs from 'fs';
import path from 'path';
const parser = require('@babel/parser');

const { buildRunnerAppSource } = require('../../../scripts/expo-runtime-runner-template.cjs');

const parseSource = (source: string) =>
  parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx'],
  });

describe('expo runtime QA UI template', () => {
  it('renders managed-compatible source with clipboard and native crypto priming hooks', () => {
    const source = buildRunnerAppSource({
      channel: 'managed-compatible',
    });

    expect(() => parseSource(source)).not.toThrow();
    expect(source).toContain("import * as Clipboard from 'expo-clipboard';");
    expect(source).toContain("require('react-native-quick-crypto');");
    expect(source).toContain('registerNativeCryptoModule,');
    expect(source).toContain('registerNativeCryptoModule(nativeCryptoModule)');
    expect(source).toContain('primeNativeCryptoModule();');
    expect(source).toContain('formatClipboardReport(report)');
    expect(source).toContain('const copyResult = async () =>');
  });

  it('keeps single-package source free of managed-compatible extras', () => {
    const source = buildRunnerAppSource({
      channel: 'single-package',
    });

    expect(() => parseSource(source)).not.toThrow();
    expect(source).not.toContain("import * as Clipboard from 'expo-clipboard';");
    expect(source).not.toContain("require('react-native-quick-crypto');");
    expect(source).not.toContain('primeNativeCryptoModule();');
  });

  it('installs managed-compatible peer dependencies and uses unbound deep links for the native dev client', () => {
    const qaScriptPath = path.resolve(__dirname, '../../../scripts/expo-runtime-qa.cjs');
    const qaScript = fs.readFileSync(qaScriptPath, 'utf8');

    expect(qaScript).toContain("'expo-secure-store'");
    expect(qaScript).toContain("'expo-clipboard'");
    expect(qaScript).toContain("'react-native-quick-crypto'");
    expect(qaScript).toContain("'react-native-get-random-values'");
    expect(qaScript).toContain("profile === NATIVE_PROFILE ? null : runtime.packageName");
  });

  it('keeps the native MuMu field-encrypted baseline at 1200 ops/s', () => {
    const templatePath = path.resolve(__dirname, '../../../scripts/expo-runtime-runner-template.cjs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');

    expect(templateSource).toContain("'field-encrypted-5000': 1200");
  });
});
