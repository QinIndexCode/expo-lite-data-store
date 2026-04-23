import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

describe('smoke expo consumer helpers', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/smoke-expo-consumer.cjs');

  const createTempRepo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-smoke-helper-'));

  const writeArtifacts = (root: string) => {
    const artifactPaths = ['dist/js/index.js', 'dist/cjs/index.js', 'dist/types/index.d.ts'];

    for (const relativePath of artifactPaths) {
      const absolutePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, '// built artifact\n');
    }
  };

  beforeEach(() => {
    jest.resetModules();
    const { execSync } = require('child_process') as { execSync: jest.Mock };
    execSync.mockReset();
  });

  it('detects when required build artifacts are missing', () => {
    const tempRoot = createTempRepo();
    const smokeModule = require(scriptPath) as {
      hasBuiltArtifacts: (root: string) => boolean;
    };

    expect(smokeModule.hasBuiltArtifacts(tempRoot)).toBe(false);
  });

  it('does not rebuild when required build artifacts already exist', () => {
    const tempRoot = createTempRepo();
    writeArtifacts(tempRoot);
    const smokeModule = require(scriptPath) as {
      ensureBuiltArtifacts: (root: string) => void;
    };
    const { execSync } = require('child_process') as { execSync: jest.Mock };

    smokeModule.ensureBuiltArtifacts(tempRoot);

    expect(execSync).not.toHaveBeenCalled();
  });

  it('rebuilds when required build artifacts are missing', () => {
    const tempRoot = createTempRepo();
    const smokeModule = require(scriptPath) as {
      ensureBuiltArtifacts: (root: string) => void;
    };
    const { execSync } = require('child_process') as { execSync: jest.Mock };

    smokeModule.ensureBuiltArtifacts(tempRoot);

    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('npm.cmd run build'), expect.any(Object));
  });

  it('rejects tarballs that omit required build artifacts', () => {
    const tempRoot = createTempRepo();
    writeArtifacts(tempRoot);
    const { execSync } = require('child_process') as { execSync: jest.Mock };
    execSync.mockReturnValueOnce(
      JSON.stringify([
        {
          filename: 'expo-lite-data-store-2.0.0.tgz',
          files: [{ path: 'README.md' }],
        },
      ])
    );
    const smokeModule = require(scriptPath) as {
      packRepoTarball: (root: string) => string;
    };

    expect(() => smokeModule.packRepoTarball(tempRoot)).toThrow(
      'Packed tarball is missing required build artifacts'
    );
  });

  it('removes inherited npm dry-run flags from child command environments', () => {
    process.env.npm_config_dry_run = 'true';
    process.env.NPM_CONFIG_DRY_RUN = 'true';
    const smokeModule = require(scriptPath) as {
      createCommandEnv: () => NodeJS.ProcessEnv;
    };

    const commandEnv = smokeModule.createCommandEnv();

    expect(commandEnv.npm_config_dry_run).toBeUndefined();
    expect(commandEnv.NPM_CONFIG_DRY_RUN).toBeUndefined();

    delete process.env.npm_config_dry_run;
    delete process.env.NPM_CONFIG_DRY_RUN;
  });
});
