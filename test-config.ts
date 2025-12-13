// 测试配置加载功能
import { getConfig } from './src/index.ts';

console.log('开始测试配置加载功能...');

// 等待一段时间，确保异步配置加载完成
setTimeout(() => {
  const config = getConfig();
  console.log('当前配置:', JSON.stringify(config, null, 2));
  
  // 检查配置是否包含预期的属性
  if (config && config.encryption) {
    console.log('✅ 配置加载成功！');
    console.log('  - 加密算法:', config.encryption.algorithm);
    console.log('  - 密钥大小:', config.encryption.keySize);
    console.log('  - 存储文件夹:', config.storageFolder);
  } else {
    console.error('❌ 配置加载失败！');
  }
}, 1000);
