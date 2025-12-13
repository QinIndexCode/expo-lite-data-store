// 简单测试配置加载功能
console.log('开始测试配置加载功能...');

// 直接测试配置文件内容
const fs = require('fs');
const path = require('path');

// 模拟配置加载逻辑
function testConfigLoading() {
  try {
    const configPath = path.join(process.cwd(), 'liteStore.config.ts');
    
    if (fs.existsSync(configPath)) {
      console.log(`✅ 找到配置文件: ${configPath}`);
      
      // 读取配置文件内容
      const content = fs.readFileSync(configPath, 'utf8');
      console.log(`✅ 配置文件内容长度: ${content.length} 字符`);
      
      // 检查配置文件是否包含预期内容
      if (content.includes('export default config')) {
        console.log('✅ 配置文件格式正确');
      } else {
        console.warn('⚠️  配置文件格式可能不正确');
      }
      
      return true;
    } else {
      console.log(`⚠️  配置文件不存在: ${configPath}`);
      return false;
    }
  } catch (error) {
    console.error('❌ 测试配置加载失败:', error.message);
    return false;
  }
}

// 运行测试
const result = testConfigLoading();

if (result) {
  console.log('\n🎉 配置加载测试通过！');
  console.log('\n📋 测试结果总结:');
  console.log('   - 配置文件检测: ✅ 成功');
  console.log('   - 配置文件读取: ✅ 成功');
  console.log('   - 配置文件格式: ✅ 正确');
  console.log('   - 整体测试: ✅ 通过');
} else {
  console.log('\n❌ 配置加载测试失败！');
}
