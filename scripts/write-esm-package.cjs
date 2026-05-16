const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const esmOutputDirectory = path.join(repoRoot, 'dist', 'js');
const manifestPath = path.join(esmOutputDirectory, 'package.json');

if (!fs.existsSync(esmOutputDirectory)) {
  throw new Error(`ESM output directory does not exist: ${esmOutputDirectory}`);
}

fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
fs.renameSync(`${manifestPath}.tmp`, manifestPath);
console.log(`Wrote ${path.relative(repoRoot, manifestPath)}.`);
