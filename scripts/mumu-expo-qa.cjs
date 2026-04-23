const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const skillScript = path.join(codexHome, 'skills', 'mumu-expo-qa', 'scripts', 'mumu_expo_qa.py');
const pythonCmd = process.env.PYTHON || 'python';

const main = () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node ./scripts/mumu-expo-qa.cjs <mumu-subcommand> [args...]');
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(pythonCmd, [skillScript, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = typeof result.status === 'number' ? result.status : 1;
};

main();
