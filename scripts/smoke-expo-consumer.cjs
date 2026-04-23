const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const quoteArg = value => {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
};

const buildCommand = (command, args) => [command, ...args.map(quoteArg)].join(' ');

const run = (command, args, cwd) => {
  execSync(buildCommand(command, args), {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CI: '1',
    },
  });
};

const runJson = (command, args, cwd) => {
  const output = execSync(buildCommand(command, args), {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CI: '1',
    },
  });
  return JSON.parse(output);
};

const readRepoPackage = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

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
  let tarballPath;

  try {
    const packResult = runJson(npmCmd, ['pack', '--json', '--ignore-scripts'], repoRoot);
    tarballPath = path.join(repoRoot, packResult[0].filename);

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
  }
};

main();
