import fs from 'fs';
import path from 'path';

describe('developer documentation contract', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const readmeEn = fs.readFileSync(path.join(repoRoot, 'README.en.md'), 'utf8');
  const readmeZh = fs.readFileSync(path.join(repoRoot, 'README.zh-CN.md'), 'utf8');
  const qaGuide = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.md'), 'utf8');
  const qaGuideZh = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.zh-CN.md'), 'utf8');

  it('defines explicit release baseline scripts', () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        'qa:baseline:expo-go': expect.any(String),
        'qa:baseline:native-flagship': expect.any(String),
        'qa:baseline:release': expect.any(String),
      })
    );
  });

  it('keeps the English consumer guide aligned with the release baseline and security contract', () => {
    expect(readme).toContain('[简体中文](./README.zh-CN.md)');
    expect(readme).toContain('[Runtime QA Guide](./docs/EXPO_RUNTIME_QA.md)');
    expect(readme).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readme).toContain('npm run qa:baseline:expo-go');
    expect(readme).toContain('npm run qa:baseline:native-flagship');
  });

  it('keeps the English alias page lightweight and linked to the canonical guide', () => {
    expect(readmeEn).toContain('[README.md](./README.md)');
    expect(readmeEn).toContain('[README.zh-CN.md](./README.zh-CN.md)');
    expect(readmeEn).toContain('[docs/EXPO_RUNTIME_QA.md](./docs/EXPO_RUNTIME_QA.md)');
  });

  it('keeps the Chinese consumer guide readable and aligned with the same commands', () => {
    expect(readmeZh).toContain('[English](./README.md)');
    expect(readmeZh).toContain('[运行时 QA 指南](./docs/EXPO_RUNTIME_QA.zh-CN.md)');
    expect(readmeZh).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readmeZh).toContain('npm run qa:baseline:expo-go');
    expect(readmeZh).toContain('npm run qa:baseline:native-flagship');
  });

  it('documents request-aware verdict semantics in both QA guides', () => {
    expect(qaGuide).toContain('not-requested');
    expect(qaGuide).toContain('summary.json');
    expect(qaGuide).toContain('qa:baseline:release');
    expect(qaGuideZh).toContain('not-requested');
    expect(qaGuideZh).toContain('summary.json');
    expect(qaGuideZh).toContain('qa:baseline:release');
  });
});
