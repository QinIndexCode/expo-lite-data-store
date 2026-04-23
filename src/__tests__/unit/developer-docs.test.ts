import childProcess from 'child_process';
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
  const apiGuide = fs.readFileSync(path.join(repoRoot, 'docs/API.md'), 'utf8');
  const apiGuideZh = fs.readFileSync(path.join(repoRoot, 'docs/API.zh-CN.md'), 'utf8');
  const qaGuide = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.md'), 'utf8');
  const qaGuideZh = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.zh-CN.md'), 'utf8');
  const security = fs.readFileSync(path.join(repoRoot, 'SECURITY.md'), 'utf8');
  const securityZh = fs.readFileSync(path.join(repoRoot, 'SECURITY.zh-CN.md'), 'utf8');
  const contributing = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  const contributingZh = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.zh-CN.md'), 'utf8');
  const bugTemplate = fs.readFileSync(path.join(repoRoot, '.github/ISSUE_TEMPLATE/bug_report.md'), 'utf8');
  const bugTemplateZh = fs.readFileSync(
    path.join(repoRoot, '.github/ISSUE_TEMPLATE/bug_report.zh-CN.md'),
    'utf8'
  );
  const trackedMarkdown = childProcess
    .execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    .split(/\r?\n/)
    .filter(Boolean);
  const untrackedMarkdown = childProcess
    .execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    .split(/\r?\n/)
    .filter(Boolean);
  const markdownInventory = Array.from(new Set([...trackedMarkdown, ...untrackedMarkdown]))
    .filter((file) => file.endsWith('.md'))
    .filter((file) => !file.startsWith('.trae/'));

  it('defines explicit release baseline scripts', () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        'qa:baseline:expo-go': expect.any(String),
        'qa:baseline:native-flagship': expect.any(String),
        'qa:baseline:release': expect.any(String),
      })
    );
  });

  it('keeps canonical markdown files paired with Simplified Chinese counterparts outside excluded folders', () => {
    const trackedSet = new Set(markdownInventory);
    const canonicalDocs = markdownInventory.filter(
      (file) => !file.endsWith('.zh-CN.md') && !file.endsWith('.en.md')
    );

    for (const file of canonicalDocs) {
      expect(trackedSet.has(file.replace(/\.md$/, '.zh-CN.md'))).toBe(true);
    }

    for (const file of markdownInventory.filter((entry) => entry.endsWith('.en.md'))) {
      expect(trackedSet.has(file.replace(/\.en\.md$/, '.md'))).toBe(true);
    }
  });

  it('keeps the English consumer guide aligned with the release baseline and developer links', () => {
    expect(readme).toContain('(./README.zh-CN.md)');
    expect(readme).toContain('(./docs/EXPO_RUNTIME_QA.md)');
    expect(readme).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readme).toContain('EXPO_MODULE_MISSING');
    expect(readme).toContain('npm run qa:baseline:expo-go');
    expect(readme).toContain('npm run qa:baseline:native-flagship');
    expect(readme).toContain('not support `npm install expo-lite-data-store` as a standalone installation step');
    expect(readme).toContain('(./CONTRIBUTING.md)');
    expect(readme).toContain('(./SECURITY.md)');
  });

  it('keeps the English alias page lightweight and linked to the canonical guide set', () => {
    expect(readmeEn).toContain('[README.md](./README.md)');
    expect(readmeEn).toContain('[README.zh-CN.md](./README.zh-CN.md)');
    expect(readmeEn).toContain('[docs/EXPO_RUNTIME_QA.md](./docs/EXPO_RUNTIME_QA.md)');
    expect(readmeEn).toContain('[CONTRIBUTING.md](./CONTRIBUTING.md)');
    expect(readmeEn).toContain('[SECURITY.md](./SECURITY.md)');
  });

  it('keeps the Chinese consumer guide readable and aligned with the same commands', () => {
    expect(readmeZh).toContain('[English](./README.md)');
    expect(readmeZh).toContain('(./docs/EXPO_RUNTIME_QA.zh-CN.md)');
    expect(readmeZh).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readmeZh).toContain('EXPO_MODULE_MISSING');
    expect(readmeZh).toContain('npm run qa:baseline:expo-go');
    expect(readmeZh).toContain('npm run qa:baseline:native-flagship');
    expect(readmeZh).toContain('不支持把 `npm install expo-lite-data-store` 当作唯一安装步骤');
    expect(readmeZh).toContain('(./CONTRIBUTING.zh-CN.md)');
    expect(readmeZh).toContain('(./SECURITY.zh-CN.md)');
  });

  it('keeps the API guides explicit about the supported install contract and missing module errors', () => {
    expect(apiGuide).toContain('not a supported setup');
    expect(apiGuide).toContain('EXPO_MODULE_MISSING');
    expect(apiGuide).toContain('npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store');
    expect(apiGuideZh).toContain('不属于受支持的安装方式');
    expect(apiGuideZh).toContain('EXPO_MODULE_MISSING');
    expect(apiGuideZh).toContain('npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store');
  });

  it('documents request-aware verdict semantics in both QA guides', () => {
    expect(qaGuide).toContain('not-requested');
    expect(qaGuide).toContain('summary.json');
    expect(qaGuide).toContain('qa:baseline:release');
    expect(qaGuideZh).toContain('not-requested');
    expect(qaGuideZh).toContain('summary.json');
    expect(qaGuideZh).toContain('qa:baseline:release');
  });

  it('keeps contributing and security policies bilingual and repository-specific', () => {
    expect(contributing).toContain('npm run smoke:expo-consumer');
    expect(contributing).toContain('qa:baseline:expo-go');
    expect(contributingZh).toContain('npm run smoke:expo-consumer');
    expect(contributingZh).toContain('qa:baseline:expo-go');
    expect(security).toContain('qinindexcode@gmail.com');
    expect(security).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(securityZh).toContain('qinindexcode@gmail.com');
    expect(securityZh).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
  });

  it('keeps bug report templates aligned with Expo runtime triage needs', () => {
    expect(bugTemplate).toContain('summary.json');
    expect(bugTemplate).toContain('react-native-quick-crypto');
    expect(bugTemplateZh).toContain('summary.json');
    expect(bugTemplateZh).toContain('react-native-quick-crypto');
  });

  it('does not leak historical package names into current markdown docs', () => {
    const historicalNamePattern = /\b(?:expo-liteDB-store|expo-lite-db-store|LiteDBStore|LiteDB Store)\b/i;

    for (const file of markdownInventory) {
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(content).not.toMatch(historicalNamePattern);
    }
  });
});
