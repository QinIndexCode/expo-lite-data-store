const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defaultDistRoot = path.join(repoRoot, 'dist', 'js');

const fromSpecifierPattern = /(\bfrom\s*['"])(\.{1,2}\/[^'"]+)(['"])/gu;
const bareImportPattern = /(\bimport\s*['"])(\.{1,2}\/[^'"]+)(['"])/gu;
const dynamicImportPattern = /(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/gu;

const hasExplicitExtension = (specifier) => {
  const lastSegment = specifier.split('/').pop() || '';
  return /\.[A-Za-z0-9]+$/u.test(lastSegment);
};

const resolveRelativeSpecifier = (currentFile, specifier) => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  if (hasExplicitExtension(specifier) || specifier.includes('?') || specifier.includes('#')) {
    return specifier;
  }

  const currentDir = path.dirname(currentFile);
  const absoluteTarget = path.resolve(currentDir, specifier);

  if (fs.existsSync(`${absoluteTarget}.js`)) {
    return `${specifier}.js`;
  }

  if (fs.existsSync(path.join(absoluteTarget, 'index.js'))) {
    return `${specifier.replace(/\/$/u, '')}/index.js`;
  }

  return specifier;
};

const patchSpecifierPattern = (source, currentFile, pattern) =>
  source.replace(pattern, (match, prefix, specifier, suffix) => {
    const patched = resolveRelativeSpecifier(currentFile, specifier);
    return `${prefix}${patched}${suffix}`;
  });

const patchSource = (source, currentFile) => {
  let output = source;
  output = patchSpecifierPattern(output, currentFile, fromSpecifierPattern);
  output = patchSpecifierPattern(output, currentFile, bareImportPattern);
  output = patchSpecifierPattern(output, currentFile, dynamicImportPattern);
  return output;
};

const walkFiles = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolutePath);
    }
  }

  return files;
};

const patchFile = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  const patched = patchSource(source, filePath);

  if (patched !== source) {
    fs.writeFileSync(filePath, patched);
    return true;
  }

  return false;
};

const patchEsmExtensions = (distRoot = defaultDistRoot) => {
  if (!fs.existsSync(distRoot)) {
    throw new Error(`ESM output directory does not exist: ${distRoot}`);
  }

  let patchedCount = 0;
  for (const filePath of walkFiles(distRoot)) {
    if (patchFile(filePath)) {
      patchedCount += 1;
    }
  }

  return patchedCount;
};

if (require.main === module) {
  const patchedCount = patchEsmExtensions(process.argv[2] ? path.resolve(process.argv[2]) : defaultDistRoot);
  console.log(`Patched ${patchedCount} ESM files with explicit relative extensions.`);
}

module.exports = {
  hasExplicitExtension,
  patchEsmExtensions,
  patchSource,
  resolveRelativeSpecifier,
};
