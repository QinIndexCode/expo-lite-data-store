// 测试update功能缓存策略
const { createTable, insert, read, update, findOne } = require('./dist/js/expo-lite-data-store');

async function testUpdateCache() {
  const TABLE_NAME = 'test_update_cache';

  try {
    // 1. 创建表
    console.log('创建表...');
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
        value: 'number',
      },
    });

    // 2. 插入测试数据
    console.log('插入测试数据...');
    await insert(TABLE_NAME, {
      id: 1,
      name: 'Test Item',
      value: 100,
    });

    // 3. 第一次读取，数据应被缓存
    console.log('第一次读取...');
    const data1 = await read(TABLE_NAME);
    console.log('读取结果:', data1);

    // 4. 执行update操作
    console.log('执行update操作...');
    const updatedCount = await update(TABLE_NAME, { value: 200 }, { id: 1 });
    console.log('更新记录数:', updatedCount);

    // 5. 第二次读取，应获取到最新数据（而不是缓存的旧数据）
    console.log('第二次读取...');
    const data2 = await read(TABLE_NAME);
    console.log('读取结果:', data2);

    // 6. 使用findOne查询，也应获取到最新数据
    console.log('使用findOne查询...');
    const item = await findOne(TABLE_NAME, { id: 1 });
    console.log('查询结果:', item);

    // 7. 验证数据是否正确更新
    if (data2[0].value === 200 && item.value === 200) {
      console.log('✅ 测试通过：update操作后缓存被正确更新，读取到最新数据');
    } else {
      console.log('❌ 测试失败：update操作后缓存未被正确更新，读取到旧数据');
      process.exit(1);
    }

    // 8. 短时间内多次update和read操作
    console.log('\n短时间内多次update和read操作测试...');
    for (let i = 0; i < 3; i++) {
      const newValue = 300 + i;
      console.log(`执行第${i + 1}次update，更新value为${newValue}...`);
      await update(TABLE_NAME, { value: newValue }, { id: 1 });

      const data = await read(TABLE_NAME);
      console.log(`读取结果: value=${data[0].value}`);

      if (data[0].value !== newValue) {
        console.log(`❌ 测试失败：第${i + 1}次update后读取到旧数据`);
        process.exit(1);
      }
    }

    console.log('✅ 测试通过：短时间内多次update和read操作，始终返回最新数据');
  } catch (error) {
    console.error('测试过程中发生错误:', error);
    process.exit(1);
  } finally {
    // 清理表
    try {
      const { db } = require('./dist/js/expo-lite-data-store');
      await db.deleteTable(TABLE_NAME);
    } catch (error) {
      // 忽略错误
    }
  }
}

// 运行测试
testUpdateCache();
