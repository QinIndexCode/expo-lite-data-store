// 测试脚本：使用公共API测试README中描述的所有功能
// 不能直接调用具体实现函数，只能使用暴露的API
const {
  // 表管理
  createTable,
  deleteTable,
  hasTable,
  listTables,
  // 数据操作
  insert,
  read,
  findOne,
  findMany,
  update,
  remove,
  bulkWrite,
  // 事务管理
  beginTransaction,
  commit,
  rollback,
  // 高级功能
  migrateToChunked,
  getSyncStats,
  syncNow,
  setAutoSyncConfig,
} = require('../dist/js/expo-lite-data-store');
import logger from '../dist/js/logger.js';

async function testPublicAPI() {
  logger.info('=== 开始测试公共API ===\n');

  let successCount = 0;
  let totalTests = 0;

  // 测试函数包装器，处理异常和计数
  async function runTest(testName, testFn) {
    totalTests++;
    logger.info(`📋 测试: ${testName}`);
    try {
      await testFn();
      logger.info(`✅ 成功: ${testName}\n`);  
      successCount++;
    } catch (error) {
      logger.error(`❌ 失败: ${testName}`);
      logger.error(`   错误: ${error.message}\n`);
    }
  }

  // 测试表管理功能
  await runTest('创建表', async () => {
    await createTable('test_api', {
      columns: {
        id: 'number',
        name: 'string',
        age: 'number',
        email: 'string',
      },
      initialData: [{ id: 1, name: 'Alice', age: 25, email: 'alice@example.com' }],
    });
  });

  await runTest('检查表是否存在', async () => {
    const exists = await hasTable('test_api');
    if (!exists) throw new Error('表应该存在');
  });

  await runTest('列出所有表', async () => {
    const tables = await listTables();
    if (!tables.includes('test_api')) throw new Error('表应该在列表中');
  });

  // 测试数据操作功能
  await runTest('插入单条数据', async () => {
    await insert('test_api', { id: 2, name: 'Bob', age: 30, email: 'bob@example.com' });
  });

  await runTest('插入多条数据', async () => {
    await insert('test_api', [
      { id: 3, name: 'Charlie', age: 35, email: 'charlie@example.com' },
      { id: 4, name: 'David', age: 40, email: 'david@example.com' },
    ]);
  });

  await runTest('读取所有数据', async () => {
    const data = await read('test_api');
    if (data.length < 4) throw new Error('应该至少有4条数据');
  });

  await runTest('查询单条数据', async () => {
    const user = await findOne('test_api', { id: 1 });
    if (!user || user.name !== 'Alice') throw new Error('未找到预期数据');
  });

  await runTest('查询多条数据', async () => {
    const users = await findMany('test_api', { age: { $gte: 30 } });
    if (users.length < 3) throw new Error('应该返回至少3条数据');
  });

  await runTest('带分页和排序的查询', async () => {
    const users = await findMany(
      'test_api',
      {},
      {
        skip: 1,
        limit: 2,
        sortBy: 'age',
        order: 'desc',
      }
    );
    if (users.length !== 2) throw new Error('应该返回2条数据');
  });

  await runTest('更新数据', async () => {
    await update('test_api', { age: 26 }, { id: 1 });
    const user = await findOne('test_api', { id: 1 });
    if (user.age !== 26) throw new Error('数据更新失败');
  });

  await runTest('删除数据', async () => {
    await remove('test_api', { id: 4 });
    const user = await findOne('test_api', { id: 4 });
    if (user) throw new Error('数据删除失败');
  });

  await runTest('批量操作', async () => {
    await bulkWrite('test_api', [
      { type: 'insert', data: { id: 5, name: 'Eve', age: 28 } },
      { type: 'update', data: { age: 31 }, where: { id: 2 } },
      { type: 'delete', where: { id: 3 } },
    ]);
    const users = await read('test_api');
    if (users.length !== 3) throw new Error('批量操作失败');
  });

  // 测试事务管理
  await runTest('事务提交', async () => {
    await beginTransaction();
    await insert('test_api', { id: 6, name: 'Frank', age: 45 });
    await update('test_api', { age: 27 }, { id: 1 });
    await commit();
    const user = await findOne('test_api', { id: 6 });
    if (!user) throw new Error('事务提交失败');
  });

  await runTest('事务回滚', async () => {
    const initialCount = (await read('test_api')).length;
    await beginTransaction();
    await insert('test_api', { id: 7, name: 'Grace', age: 50 });
    await rollback();
    const finalCount = (await read('test_api')).length;
    if (finalCount !== initialCount) throw new Error('事务回滚失败');
  });

  // 测试高级功能
  await runTest('同步统计', async () => {
    const stats = await getSyncStats();
    if (!stats) throw new Error('获取同步统计失败');
    logger.info(`   同步统计: ${JSON.stringify(stats)}`);
  });

  await runTest('立即同步', async () => {
    await syncNow();
  });

  await runTest('设置自动同步配置', async () => {
    setAutoSyncConfig({
      enabled: true,
      interval: 10000,
      minItems: 5,
      batchSize: 200,
    });
  });

  // 测试模式迁移
  await runTest('模式迁移', async () => {
    // 先创建一个新表用于测试迁移
    await createTable('test_migrate', {
      initialData: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
        value: Math.random(),
      })),
    });
    await migrateToChunked('test_migrate');
    await deleteTable('test_migrate');
  });

  // 清理测试表
  await runTest('删除测试表', async () => {
    await deleteTable('test_api');
    const exists = await hasTable('test_api');
    if (exists) throw new Error('表删除失败');
  });

  // 总结
  logger.info('\n=== 测试总结 ===');
  logger.info(`总测试数: ${totalTests}`);
  logger.info(`成功数: ${successCount}`);
  logger.info(`失败数: ${totalTests - successCount}`);
  logger.info(`成功率: ${((successCount / totalTests) * 100).toFixed(1)}%`);

  if (successCount === totalTests) {
    logger.info('\n🎉 所有API测试通过！README中描述的功能已全部实现。');
    process.exit(0);
  } else {
    logger.error('\n❌ 部分API测试失败！');
    process.exit(1);
  }
}

// 运行测试
testPublicAPI().catch(error => {
  logger.error('\n❌ 测试脚本执行出错:', error);
  process.exit(1);
});
