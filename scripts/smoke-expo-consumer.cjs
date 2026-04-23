const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const requiredBuiltArtifacts = ['dist/js/index.js', 'dist/cjs/index.js', 'dist/types/index.d.ts'];

const needsShell = command => process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command);

const formatCommand = (command, args) => [command, ...args].join(' ');

const createCommandEnv = () => {
  const env = {
    ...process.env,
    CI: '1',
  };

  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;

  return env;
};

const runCommand = (command, args, cwd, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.captureOutput ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: needsShell(command),
    windowsHide: true,
    env: createCommandEnv(),
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const error = new Error(`Command failed (${result.status}): ${formatCommand(command, args)}`);
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }

  return result;
};

const run = (command, args, cwd) => {
  runCommand(command, args, cwd);
};

const runJson = (command, args, cwd) => {
  const result = runCommand(command, args, cwd, {
    captureOutput: true,
  });
  return JSON.parse(result.stdout);
};

const readRepoPackage = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const hasBuiltArtifacts = root =>
  requiredBuiltArtifacts.every(relativePath => fs.existsSync(path.join(root, relativePath)));

const ensureBuiltArtifacts = root => {
  if (!hasBuiltArtifacts(root)) {
    run(npmCmd, ['run', 'build'], root);
  }
};

const packRepoTarball = root => {
  ensureBuiltArtifacts(root);
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-pack-'));
  const packResult = runJson(npmCmd, ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], root);
  const [packMetadata] = packResult;
  const packagedPaths = Array.isArray(packMetadata?.files)
    ? packMetadata.files.map(file => file.path)
    : [];

  if (packagedPaths.length > 0) {
    const missingPackagedArtifacts = requiredBuiltArtifacts.filter(relativePath => !packagedPaths.includes(relativePath));

    if (missingPackagedArtifacts.length > 0) {
      throw new Error(
        `Packed tarball is missing required build artifacts: ${missingPackagedArtifacts.join(', ')}`
      );
    }
  }

  return {
    packDir,
    tarballPath: path.join(packDir, packMetadata.filename),
  };
};

const writeConsumerFiles = consumerDir => {
  const pkg = readRepoPackage();
  const consumerPackageJson = {
    name: 'expo-lite-data-store-smoke',
    version: '1.0.0',
    private: true,
    main: 'node_modules/expo/AppEntry.js',
    scripts: {
      start: 'expo start',
      android: 'expo run:android',
    },
    dependencies: {
      expo: pkg.devDependencies.expo,
      react: pkg.devDependencies.react,
      'react-native': pkg.devDependencies['react-native'],
    },
  };

  fs.writeFileSync(path.join(consumerDir, 'package.json'), `${JSON.stringify(consumerPackageJson, null, 2)}\n`);
  fs.writeFileSync(
    path.join(consumerDir, 'app.json'),
    `${JSON.stringify(
      {
        expo: {
          name: 'expo-lite-data-store-smoke',
          slug: 'expo-lite-data-store-smoke',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(consumerDir, 'App.js'),
    `import React, { useEffect } from 'react';\nimport { Text, View } from 'react-native';\nimport { db } from 'expo-lite-data-store';\n\nexport default function App() {\n  useEffect(() => {\n    void (async () => {\n      await db.init();\n      await db.createTable('smoke_users');\n      await db.insert('smoke_users', { id: '1', name: 'Codex' });\n      const record = await db.findOne('smoke_users', { where: { id: '1' } });\n      console.log('expo-lite-data-store smoke result', record && record.name);\n    })();\n  }, []);\n\n  return (\n    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>\n      <Text>expo-lite-data-store smoke</Text>\n    </View>\n  );\n}\n`
  );
};

const main = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-smoke-'));
  let packDir;
  let tarballPath;

  try {
    const packedRepo = packRepoTarball(repoRoot);
    packDir = packedRepo.packDir;
    tarballPath = packedRepo.tarballPath;

    writeConsumerFiles(tempDir);

    run(npmCmd, ['install'], tempDir);
    run(npmCmd, ['install', tarballPath], tempDir);
    run(npxCmd, ['expo', 'install', 'expo-file-system', 'expo-constants', 'expo-crypto', 'expo-secure-store'], tempDir);
    run(npxCmd, ['expo-doctor'], tempDir);
    run(npxCmd, ['expo', 'export', '--platform', 'android', '--clear'], tempDir);
  } catch (error) {
    console.error(`Expo consumer smoke test failed. Temporary app preserved at: ${tempDir}`);
    throw error;
  } finally {
    if (tarballPath && fs.existsSync(tarballPath)) {
      fs.unlinkSync(tarballPath);
    }
    if (packDir && fs.existsSync(packDir)) {
      fs.rmSync(packDir, { recursive: true, force: true });
    }
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  createCommandEnv,
  ensureBuiltArtifacts,
  hasBuiltArtifacts,
  packRepoTarball,
  requiredBuiltArtifacts,
};
