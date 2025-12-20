// 测试包的完整性
import logger from '../dist/js/logger.js';
logger.info('🔍 测试 expo-lite-db-store 包完整性...\n');

// 测试1: 检查dist目录结构
const fs = require('fs');
const path = require('path');

function checkDir(dir, expected = []) {
  if (!fs.existsSync(dir)) {
    logger.error(`❌ 目录不存在: ${dir}`);
    return false;
  }

  const items = fs.readdirSync(dir);
  logger.info(`✅ 目录存在: ${dir} (${items.length}个文件)`);

  expected.forEach(expectedItem => {
    if (!items.includes(expectedItem)) {
      logger.error(`❌ 缺少文件: ${expectedItem} in ${dir}`);
    } else {
      logger.info(`✅ 文件存在: ${expectedItem}`);
    }
  });

  return true;
}

// 检查构建输出
logger.info('📦 检查构建输出...');
checkDir('dist/js', ['index.js', 'liteStore.config.js']);
checkDir('dist/js/core');
checkDir('dist/js/utils');

// 检查主要文件
logger.info('\n📄 检查主要文件...');
const mainFiles = ['dist/js/index.js', 'src/index.ts', 'package.json'];

mainFiles.forEach(file => {
  if (fs.existsSync(file)) {
    logger.info(`✅ 文件存在: ${file}`);  
  } else {
    logger.error(`❌ 文件缺失: ${file}`);
  }
});

// 检查package.json配置
logger.info('\n📋 检查package.json配置...');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const basicChecks = [
  { key: 'main', expected: 'dist/js/index.js' },
  { key: 'types', expected: 'src/index.ts' },
];

basicChecks.forEach(check => {
  const value = pkg[check.key];
  if (value === check.expected) {
    logger.info(`✅ 配置正确: ${check.key} = "${value}"`);
  } else {
    logger.error(`❌ 配置错误: ${check.key} = "${value}" (期望: "${check.expected}")`);
  }
});

// 检查exports存在
if (pkg.exports) {
  logger.info('✅ Exports配置存在');

  const exportKeys = ['.', './ts', './js'];
  exportKeys.forEach(key => {
    if (pkg.exports[key]) {
      logger.info(`✅ Export路径存在: "${key}"`);
    } else {
      logger.error(`❌ Export路径缺失: "${key}"`);
    }
  });
} else {
  logger.error('❌ Exports配置不存在');
}

// 检查README
logger.info('\n📖 检查README...');
if (fs.existsSync('README.md')) {
  const readme = fs.readFileSync('README.md', 'utf8');
  const keywords = ['排序', 'TypeScript', 'JavaScript', '双版本', 'findMany'];

  keywords.forEach(keyword => {
    if (readme.includes(keyword)) {
      logger.info(`✅ README包含关键词: "${keyword}"`);
    } else {
      logger.error(`❌ README缺少关键词: "${keyword}"`);
    }
  });
} else {
  logger.error('❌ README.md 不存在');
}

logger.info('\n🎉 包完整性检查完成！');
