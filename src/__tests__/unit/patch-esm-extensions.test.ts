import fs from 'fs';
import os from 'os';
import path from 'path';

describe('patch ESM extensions helper', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/patch-esm-extensions.cjs');

  const createTempDist = () => fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-esm-patch-'));

  it('adds .js to relative ESM import and export specifiers that target built files', () => {
    const distRoot = createTempDist();
    const featureDir = path.join(distRoot, 'feature');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(distRoot, 'index.js'), "export * from './main';\nimport './setup';\n");
    fs.writeFileSync(path.join(distRoot, 'main.js'), "import { util } from './feature/util';\n");
    fs.writeFileSync(path.join(distRoot, 'setup.js'), "import('./feature/util');\n");
    fs.writeFileSync(path.join(featureDir, 'util.js'), 'export const util = 1;\n');

    const patcher = require(scriptPath) as {
      patchEsmExtensions: (distRoot: string) => number;
    };

    expect(patcher.patchEsmExtensions(distRoot)).toBe(3);
    expect(fs.readFileSync(path.join(distRoot, 'index.js'), 'utf8')).toContain("from './main.js'");
    expect(fs.readFileSync(path.join(distRoot, 'index.js'), 'utf8')).toContain("import './setup.js'");
    expect(fs.readFileSync(path.join(distRoot, 'main.js'), 'utf8')).toContain("from './feature/util.js'");
    expect(fs.readFileSync(path.join(distRoot, 'setup.js'), 'utf8')).toContain("import('./feature/util.js')");
  });

  it('does not rewrite package specifiers or already explicit extensions', () => {
    const distRoot = createTempDist();
    fs.writeFileSync(
      path.join(distRoot, 'index.js'),
      "import React from 'react';\nimport data from './data.json';\nexport * from './missing';\n"
    );

    const patcher = require(scriptPath) as {
      patchEsmExtensions: (distRoot: string) => number;
    };

    expect(patcher.patchEsmExtensions(distRoot)).toBe(0);
    expect(fs.readFileSync(path.join(distRoot, 'index.js'), 'utf8')).toBe(
      "import React from 'react';\nimport data from './data.json';\nexport * from './missing';\n"
    );
  });
});
