import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

describe('smoke expo consumer helpers', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/smoke-expo-consumer.cjs');
  const temporaryRoots: string[] = [];
  let originalNpmConfigDryRun: string | undefined;
  let originalNpmConfigDryRunUppercase: string | undefined;

  const createTempRepo = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-smoke-helper-'));
    temporaryRoots.push(root);
    return root;
  };

  const writeArtifacts = (root: string) => {
    const artifactPaths = ['dist/js/index.js', 'dist/cjs/index.js', 'dist/types/index.d.ts'];

    for (const relativePath of artifactPaths) {
      const absolutePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, '// built artifact\n');
    }
  };

  beforeEach(() => {
    originalNpmConfigDryRun = process.env.npm_config_dry_run;
    originalNpmConfigDryRunUppercase = process.env.NPM_CONFIG_DRY_RUN;
    jest.resetModules();
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };
    spawnSync.mockReset();
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNpmConfigDryRun === undefined) {
      delete process.env.npm_config_dry_run;
    } else {
      process.env.npm_config_dry_run = originalNpmConfigDryRun;
    }
    if (originalNpmConfigDryRunUppercase === undefined) {
      delete process.env.NPM_CONFIG_DRY_RUN;
    } else {
      process.env.NPM_CONFIG_DRY_RUN = originalNpmConfigDryRunUppercase;
    }
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };

    smokeModule.ensureBuiltArtifacts(tempRoot);

    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('rebuilds when required build artifacts are missing', () => {
    const tempRoot = createTempRepo();
    const smokeModule = require(scriptPath) as {
      ensureBuiltArtifacts: (root: string) => void;
    };
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };

    smokeModule.ensureBuiltArtifacts(tempRoot);

    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['run', 'build']),
      expect.objectContaining({
        cwd: tempRoot,
        shell: false,
      })
    );
  });

  it('wraps Windows batch commands through cmd.exe without using shell mode', () => {
    const smokeModule = require(scriptPath) as {
      resolveCommandInvocation: (
        command: string,
        args: string[],
        platform?: string,
        comspec?: string
      ) => { command: string; args: string[] };
    };

    expect(
      smokeModule.resolveCommandInvocation('npm.cmd', ['run', 'build'], 'win32', 'C:\\Windows\\System32\\cmd.exe')
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', 'npm.cmd', 'run', 'build'],
    });
  });

  it('keeps non-Windows commands unchanged', () => {
    const smokeModule = require(scriptPath) as {
      resolveCommandInvocation: (
        command: string,
        args: string[],
        platform?: string,
        comspec?: string
      ) => { command: string; args: string[] };
    };

    expect(smokeModule.resolveCommandInvocation('npm', ['run', 'build'], 'linux')).toEqual({
      command: 'npm',
      args: ['run', 'build'],
    });
  });

  it('rejects tarballs that omit required build artifacts', () => {
    const tempRoot = createTempRepo();
    writeArtifacts(tempRoot);
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };
    spawnSync.mockReturnValueOnce({
      status: 0,
      stdout:
        'Wrote dist/js/package.json.\n' +
        JSON.stringify([
          {
            filename: 'expo-lite-data-store-2.0.1.tgz',
            files: [{ path: 'README.md' }],
          },
        ]),
      stderr: '',
      error: null,
    });
    const smokeModule = require(scriptPath) as {
      packRepoTarball: (root: string) => string;
    };

    expect(() => smokeModule.packRepoTarball(tempRoot)).toThrow('Packed tarball is missing required build artifacts');
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
  });

  it('cleans managed temporary directories after a successful smoke run', () => {
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };
    const originalMkdtempSync = fs.mkdtempSync;
    const createdDirectories: string[] = [];
    const packagedFiles = ['dist/js/index.js', 'dist/cjs/index.js', 'dist/types/index.d.ts'].map(file => ({
      path: file,
    }));

    jest.spyOn(fs, 'mkdtempSync').mockImplementation(prefix => {
      const directory = originalMkdtempSync(prefix);
      createdDirectories.push(directory);
      return directory;
    });
    spawnSync.mockImplementation((_command: string, args: string[]) => ({
      status: 0,
      stdout: args.includes('pack')
        ? JSON.stringify([{ filename: 'expo-lite-data-store-smoke.tgz', files: packagedFiles }])
        : '',
      stderr: '',
      error: null,
    }));

    const smokeModule = require(scriptPath) as { main: () => void };
    smokeModule.main();

    expect(createdDirectories).toHaveLength(2);
    expect(createdDirectories.every(directory => !fs.existsSync(directory))).toBe(true);
  });

  it('cleans managed temporary directories when packing fails', () => {
    const { spawnSync } = require('child_process') as { spawnSync: jest.Mock };
    const originalMkdtempSync = fs.mkdtempSync;
    const createdDirectories: string[] = [];

    jest.spyOn(fs, 'mkdtempSync').mockImplementation(prefix => {
      const directory = originalMkdtempSync(prefix);
      createdDirectories.push(directory);
      return directory;
    });
    spawnSync.mockImplementation((_command: string, args: string[]) => ({
      status: 0,
      stdout: args.includes('pack') ? 'invalid pack output' : '',
      stderr: '',
      error: null,
    }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const smokeModule = require(scriptPath) as { main: () => void };

    expect(() => smokeModule.main()).toThrow('Command output did not contain a valid JSON payload');
    expect(createdDirectories).toHaveLength(2);
    expect(createdDirectories.every(directory => !fs.existsSync(directory))).toBe(true);
  });
});
