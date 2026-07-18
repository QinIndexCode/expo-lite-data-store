import childProcess from 'child_process';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const getCommentTrivia = (content: string): string[] => {
  const sourceFile = ts.createSourceFile('comment-trivia.ts', content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const comments = new Map<string, string>();
  const collectComment = (pos: number, end: number): void => {
    comments.set(`${pos}:${end}`, content.slice(pos, end));
  };

  const visit = (node: ts.Node): void => {
    ts.forEachLeadingCommentRange(content, node.getFullStart(), collectComment);
    ts.forEachTrailingCommentRange(content, node.getEnd(), collectComment);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return Array.from(comments.values());
};

describe('developer documentation contract', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    version: string;
    scripts: Record<string, string>;
    homepage?: string;
  };
  const githubBlobBase = 'https://github.com/QinIndexCode/expo-lite-data-store/blob/main';
  const readmeEntry = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const readmeEn = fs.readFileSync(path.join(repoRoot, 'README.en.md'), 'utf8');
  const readmeZh = fs.readFileSync(path.join(repoRoot, 'README.zh-CN.md'), 'utf8');
  const contributingIndex = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  const contributing = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.en.md'), 'utf8');
  const contributingZh = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.zh-CN.md'), 'utf8');
  const securityIndex = fs.readFileSync(path.join(repoRoot, 'SECURITY.md'), 'utf8');
  const security = fs.readFileSync(path.join(repoRoot, 'SECURITY.en.md'), 'utf8');
  const securityZh = fs.readFileSync(path.join(repoRoot, 'SECURITY.zh-CN.md'), 'utf8');
  const apiIndex = fs.readFileSync(path.join(repoRoot, 'docs/API.md'), 'utf8');
  const apiGuide = fs.readFileSync(path.join(repoRoot, 'docs/API.en.md'), 'utf8');
  const apiGuideZh = fs.readFileSync(path.join(repoRoot, 'docs/API.zh-CN.md'), 'utf8');
  const qaIndex = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.md'), 'utf8');
  const qaGuide = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.en.md'), 'utf8');
  const qaGuideZh = fs.readFileSync(path.join(repoRoot, 'docs/EXPO_RUNTIME_QA.zh-CN.md'), 'utf8');
  const commentSpecificationIndex = fs.readFileSync(path.join(repoRoot, 'docs/COMMENT_SPECIFICATION.md'), 'utf8');
  const commentSpecification = fs.readFileSync(path.join(repoRoot, 'docs/COMMENT_SPECIFICATION.en.md'), 'utf8');
  const commentSpecificationZh = fs.readFileSync(path.join(repoRoot, 'docs/COMMENT_SPECIFICATION.zh-CN.md'), 'utf8');
  const updateLog = fs.readFileSync(path.join(repoRoot, 'docs/updatelog.en.md'), 'utf8');
  const updateLogZh = fs.readFileSync(path.join(repoRoot, 'docs/updatelog.zh-CN.md'), 'utf8');
  const bugTemplate = fs.readFileSync(path.join(repoRoot, '.github/ISSUE_TEMPLATE/bug_report.md'), 'utf8');
  const bugTemplateZh = fs.readFileSync(path.join(repoRoot, '.github/ISSUE_TEMPLATE/bug_report.zh-CN.md'), 'utf8');
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
    .filter(file => file.endsWith('.md'))
    .filter(file => !file.startsWith('.trae/'));
  const formalEnglishDocs = [
    'README.en.md',
    'CONTRIBUTING.en.md',
    'SECURITY.en.md',
    'docs/API.en.md',
    'docs/ARCHITECTURE.en.md',
    'docs/CHANGELOG.en.md',
    'docs/CI_CD.en.md',
    'docs/EXPO_RUNTIME_QA.en.md',
    'docs/updatelog.en.md',
    'docs/COMMENT_SPECIFICATION.en.md',
  ];
  const allowedPlainMarkdown = new Set([
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/API.md',
    'docs/ARCHITECTURE.md',
    'docs/CHANGELOG.md',
    'docs/CI_CD.md',
    'docs/EXPO_RUNTIME_QA.md',
    'docs/updatelog.md',
    'docs/COMMENT_SPECIFICATION.md',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/bug_report.zh-CN.md',
  ]);

  it('defines explicit release baseline scripts', () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        'qa:baseline:expo-go': expect.any(String),
        'qa:baseline:native-flagship': expect.any(String),
        'qa:baseline:release': expect.any(String),
      })
    );
  });

  it('collects comments after template interpolations', () => {
    const fixture = [
      'const label = `value ${1}`; // \u4e2d\u6587\u884c\u5185\u6ce8\u91ca',
      '/** \u4e2d\u6587\u5757\u6ce8\u91ca */',
      'const result = label;',
    ].join('\n');

    expect(getCommentTrivia(fixture)).toEqual([
      '// \u4e2d\u6587\u884c\u5185\u6ce8\u91ca',
      '/** \u4e2d\u6587\u5757\u6ce8\u91ca */',
    ]);
  });

  it('links the comment guides and rejects stale source markers and production file headers', () => {
    expect(commentSpecificationIndex).toContain('[COMMENT_SPECIFICATION.en.md](./COMMENT_SPECIFICATION.en.md)');
    expect(commentSpecificationIndex).toContain('[COMMENT_SPECIFICATION.zh-CN.md](./COMMENT_SPECIFICATION.zh-CN.md)');
    expect(commentSpecification).toContain('[Simplified Chinese](./COMMENT_SPECIFICATION.zh-CN.md)');
    expect(commentSpecificationZh).toContain('[English](./COMMENT_SPECIFICATION.en.md)');

    const staleHeaderMarker =
      /@(?:since|version|changelog)\b|\bCreated(?:\s+(?:on\s+)?\d{4}[-/]\d{1,2}[-/]\d{1,2}|\s*:)|\bLast\s+modified(?:\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}|\s*:)/i;
    const sourceFiles = Array.from(new Set([...trackedMarkdown, ...untrackedMarkdown])).filter(
      file => file.startsWith('src/') && file.endsWith('.ts') && fs.existsSync(path.join(repoRoot, file))
    );
    const productionSourceFiles = sourceFiles.filter(
      file => !file.startsWith('src/__tests__/') && !file.includes('/__tests__/')
    );

    for (const file of sourceFiles) {
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      for (const comment of getCommentTrivia(content)) {
        expect(comment).not.toMatch(staleHeaderMarker);
      }
    }

    for (const file of productionSourceFiles) {
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/^\uFEFF/, '');
      const openingComment = content.match(/^\s*\/\*\*[\s\S]*?\*\//)?.[0] ?? '';

      expect(openingComment).not.toMatch(/@(?:module|description)\b/i);
    }
  });

  it('keeps TypeScript comment trivia in English', () => {
    const typeScriptFiles = Array.from(new Set([...trackedMarkdown, ...untrackedMarkdown])).filter(
      file =>
        (file.startsWith('src/') || file.startsWith('__mocks__/')) &&
        (file.endsWith('.ts') || file.endsWith('.tsx')) &&
        fs.existsSync(path.join(repoRoot, file))
    );
    const cjkComment = /[\p{Script=Han}]/u;

    for (const file of typeScriptFiles) {
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');

      for (const comment of getCommentTrivia(content)) {
        expect(comment).not.toMatch(cjkComment);
      }
    }
  });

  it('keeps formal user-facing docs on explicit .en.md and .zh-CN.md filenames', () => {
    const trackedSet = new Set(markdownInventory);
    for (const file of formalEnglishDocs) {
      expect(trackedSet.has(file)).toBe(true);
      expect(trackedSet.has(file.replace(/\.en\.md$/, '.zh-CN.md'))).toBe(true);
    }

    for (const file of markdownInventory) {
      if (file.endsWith('.en.md') || file.endsWith('.zh-CN.md')) {
        continue;
      }

      expect(allowedPlainMarkdown.has(file)).toBe(true);
    }
  });

  it('keeps README.md as a concise package entry page with canonical guide links', () => {
    expect(packageJson.homepage).toContain('github.com/QinIndexCode/expo-lite-data-store');
    expect(readmeEntry).toContain('package introduction and documentation index');
    expect(readmeEntry).toContain(`${githubBlobBase}/README.en.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/README.zh-CN.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/docs/API.en.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/docs/API.zh-CN.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/docs/EXPO_RUNTIME_QA.en.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/CONTRIBUTING.en.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/SECURITY.en.md`);
    expect(readmeEntry).toContain(`${githubBlobBase}/LICENSE.txt`);
    expect(readmeEntry).toContain(
      'npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store'
    );
  });

  it('keeps the English consumer guide aligned with the release baseline and developer links', () => {
    expect(packageJson.homepage).toContain('github.com/QinIndexCode/expo-lite-data-store');
    expect(readmeEn).toContain(`${githubBlobBase}/README.md`);
    expect(readmeEn).toContain(`${githubBlobBase}/README.zh-CN.md`);
    expect(readmeEn).toContain(`${githubBlobBase}/docs/EXPO_RUNTIME_QA.en.md`);
    expect(readmeEn).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readmeEn).toContain('EXPO_MODULE_MISSING');
    expect(readmeEn).toContain('app.json');
    expect(readmeEn).toContain('configManager.updateConfig');
    expect(readmeEn).toContain('performanceMonitor');
    expect(readmeEn).toContain('$like');
    expect(readmeEn).toContain('$inc');
    expect(readmeEn).toContain('npm run qa:baseline:expo-go');
    expect(readmeEn).toContain('npm run qa:baseline:native-flagship');
    expect(readmeEn).toContain('not support `npm install expo-lite-data-store` as a standalone installation step');
    expect(readmeEn).toContain(`${githubBlobBase}/CONTRIBUTING.en.md`);
    expect(readmeEn).toContain(`${githubBlobBase}/SECURITY.en.md`);
    expect(readmeEn).toContain(`${githubBlobBase}/LICENSE.txt`);
  });

  it('keeps the Chinese consumer guide readable and aligned with the same commands', () => {
    expect(readmeZh).toContain('[README 入口](./README.md)');
    expect(readmeZh).toContain('[English](./README.en.md)');
    expect(readmeZh).toContain('(./docs/EXPO_RUNTIME_QA.zh-CN.md)');
    expect(readmeZh).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(readmeZh).toContain('EXPO_MODULE_MISSING');
    expect(readmeZh).toContain('app.json');
    expect(readmeZh).toContain('configManager.updateConfig');
    expect(readmeZh).toContain('performanceMonitor');
    expect(readmeZh).toContain('$like');
    expect(readmeZh).toContain('$inc');
    expect(readmeZh).toContain('npm run qa:baseline:expo-go');
    expect(readmeZh).toContain('npm run qa:baseline:native-flagship');
    expect(readmeZh).toContain('不支持把 `npm install expo-lite-data-store` 当作唯一安装步骤');
    expect(readmeZh).toContain('(./README.en.md)');
    expect(readmeZh).toContain('(./CONTRIBUTING.zh-CN.md)');
    expect(readmeZh).toContain('(./SECURITY.zh-CN.md)');
  });

  it('keeps plain index pages pointing at the formal language-specific documents', () => {
    expect(contributingIndex).toContain('[CONTRIBUTING.en.md](./CONTRIBUTING.en.md)');
    expect(contributingIndex).toContain('[CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)');
    expect(securityIndex).toContain('[SECURITY.en.md](./SECURITY.en.md)');
    expect(securityIndex).toContain('[SECURITY.zh-CN.md](./SECURITY.zh-CN.md)');
    expect(apiIndex).toContain('[API.en.md](./API.en.md)');
    expect(apiIndex).toContain('[API.zh-CN.md](./API.zh-CN.md)');
    expect(qaIndex).toContain('[EXPO_RUNTIME_QA.en.md](./EXPO_RUNTIME_QA.en.md)');
    expect(qaIndex).toContain('[EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)');
  });

  it('keeps the API guides explicit about the supported install contract and missing module errors', () => {
    expect(apiGuide).toContain('not a supported setup');
    expect(apiGuide).toContain('EXPO_MODULE_MISSING');
    expect(apiGuide).toContain('WriteResult');
    expect(apiGuide).toContain('configManager');
    expect(apiGuide).toContain('performanceMonitor');
    expect(apiGuide).toContain('app.json');
    expect(apiGuide).toContain('$like');
    expect(apiGuide).toContain('$inc');
    expect(apiGuide).toContain(
      'npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store'
    );
    expect(apiGuideZh).toContain('不属于受支持的安装方式');
    expect(apiGuideZh).toContain('EXPO_MODULE_MISSING');
    expect(apiGuideZh).toContain('WriteResult');
    expect(apiGuideZh).toContain('configManager');
    expect(apiGuideZh).toContain('performanceMonitor');
    expect(apiGuideZh).toContain('app.json');
    expect(apiGuideZh).toContain('$like');
    expect(apiGuideZh).toContain('$inc');
    expect(apiGuideZh).toContain(
      'npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store'
    );
    expect(apiGuide).toContain('[README.en.md](../README.en.md)');
    expect(apiGuideZh).toContain('[English](./API.en.md)');
  });

  it('documents the v3 strict table-listing boundary and public type exports', () => {
    const strictListCall = /listTables\s*\(\{\s*encrypted:\s*true,\s*requireAuthOnAccess:\s*true\s*\}\)/;
    const publicTypeExports = [
      'PerformanceStats',
      'HealthCheckResult',
      'KeyCacheStats',
      'FindOneOptions',
      'FindManyOptions',
      'UpdateOptions',
      'BulkOperation',
      'StorageInput',
      'StorageRecord',
      'UpdatePayload',
    ];

    for (const guide of [apiGuide, apiGuideZh]) {
      expect(guide).toContain('PERMISSION_DENIED');
      expect(guide).toMatch(strictListCall);
      for (const typeName of publicTypeExports) {
        expect(guide).toContain(typeName);
      }
    }
  });

  it('documents request-aware verdict semantics in both QA guides', () => {
    expect(qaGuide).toContain('not-requested');
    expect(qaGuide).toContain('summary.json');
    expect(qaGuide).toContain('qa:baseline:release');
    expect(qaGuide).toContain('[README.en.md](../README.en.md)');
    expect(qaGuideZh).toContain('not-requested');
    expect(qaGuideZh).toContain('summary.json');
    expect(qaGuideZh).toContain('qa:baseline:release');
    expect(qaGuideZh).toContain('[English](./EXPO_RUNTIME_QA.en.md)');
  });

  it('documents bounded QA artifact retention in both guides', () => {
    expect(qaGuide).toMatch(/512\s*KiB/);
    expect(qaGuide).toContain('three newest completed timestamped runs');
    expect(qaGuide).toContain('--artifacts-dir');
    expect(qaGuide).toContain('never automatically pruned');
    expect(qaGuideZh).toMatch(/512\s*KiB/);
    expect(qaGuideZh).toContain('最新 3 个已完成运行');
    expect(qaGuideZh).toContain('--artifacts-dir');
    expect(qaGuideZh).toContain('不会自动清理');
  });

  it('keeps contributing and security policies bilingual and repository-specific', () => {
    expect(contributing).toContain('npm run smoke:expo-consumer');
    expect(contributing).toContain('qa:baseline:expo-go');
    expect(contributing).toContain('Formal English guides use the `.en.md` filename.');
    expect(contributing).toContain('Bare `.md` files are repository indexes or internal maintenance documents');
    expect(contributingZh).toContain('npm run smoke:expo-consumer');
    expect(contributingZh).toContain('qa:baseline:expo-go');
    expect(contributingZh).toContain('正式英文文档使用 `.en.md`');
    expect(contributingZh).toContain('裸 `.md` 文件只作为仓库索引页或内部维护文档');
    expect(security).toContain('qinindexcode@gmail.com');
    expect(security).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(security).toContain('[Contributing Guide](./CONTRIBUTING.en.md)');
    expect(securityZh).toContain('qinindexcode@gmail.com');
    expect(securityZh).toContain('AUTH_ON_ACCESS_UNSUPPORTED');
    expect(securityZh).toContain('[English](./SECURITY.en.md)');

    for (const policy of [securityIndex, security, securityZh]) {
      expect(policy).toContain('`3.0.x`');
      expect(policy).toContain('`< 3.0.0`');
    }
  });

  it('records the current v3 release in both update logs', () => {
    for (const updateLogContent of [updateLog, updateLogZh]) {
      expect(updateLogContent).toMatch(/2026-07-18[^\r\n]*v3\.0\.0/);
    }
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
