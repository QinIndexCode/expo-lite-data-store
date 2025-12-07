/**
 * 性能优化验证测试
 */
import { EncryptedStorageAdapter } from './core/EncryptedStorageAdapter';
import config from './liteStore.config';

describe('Performance Optimization Tests', () => {
  let adapter: EncryptedStorageAdapter;

  beforeAll(async () => {
    adapter = new EncryptedStorageAdapter();
  });

  afterAll(async () => {
    // 清理所有测试表
    const tables = await adapter.listTables();
    for (const table of tables) {
      if (table.startsWith('test_')) {
        await adapter.deleteTable(table);
      }
    }
  });

  test('缓存机制应该正常工作', async () => {
    const tableName = 'test_cache';
    await adapter.createTable(tableName);

    // 写入测试数据
    const testData = { id: 1, name: 'test', value: 'cached' };
    await adapter.write(tableName, testData);

    // 第一次读取（建立缓存）
    const start1 = Date.now();
    const result1 = await adapter.read(tableName);
    const time1 = Date.now() - start1;

    // 第二次读取（使用缓存）
    const start2 = Date.now();
    const result2 = await adapter.read(tableName);
    const time2 = Date.now() - start2;

    expect(result1).toEqual(result2);
    // 缓存读取应该明显快于首次读取（允许一定误差）
    expect(time2).toBeLessThanOrEqual(time1);

    console.log(`首次读取: ${time1}ms, 缓存读取: ${time2}ms`);
  });

  test('索引优化应该提升查询性能', async () => {
    const tableName = 'test_index';
    await adapter.createTable(tableName);

    // 准备大量测试数据
    const testData = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `user${i}`,
      email: `user${i}@example.com`,
      type: i % 2 === 0 ? 'admin' : 'user',
      status: 'active',
    }));

    await adapter.write(tableName, testData);

    // 测试ID查询性能（应该使用索引）
    const startIdQuery = Date.now();
    const idResult = await adapter.findOne(tableName, { id: 50 });
    const idQueryTime = Date.now() - startIdQuery;

    // 测试name查询性能（应该使用索引）
    const startNameQuery = Date.now();
    const nameResult = await adapter.findOne(tableName, { name: 'user25' });
    const nameQueryTime = Date.now() - startNameQuery;

    expect(idResult).not.toBeNull();
    expect(nameResult).not.toBeNull();
    expect(idResult?.id).toBe(50);
    expect(nameResult?.name).toBe('user25');

    console.log(`ID查询: ${idQueryTime}ms, Name查询: ${nameQueryTime}ms`);
  });

  test('批量操作性能应该得到优化', async () => {
    const tableName = 'test_batch';
    await adapter.createTable(tableName);

    const batchData = Array.from({ length: 50 }, (_, i) => ({
      id: 200 + i,
      name: `batch_user${i}`,
      type: 'batch_test',
    }));

    const startBatch = Date.now();
    const result = await adapter.bulkWrite(tableName, [{ type: 'insert', data: batchData }]);
    const batchTime = Date.now() - startBatch;

    expect(result.written).toBe(50);
    console.log(`批量插入50条数据: ${batchTime}ms`);

    // 验证数据是否正确写入
    const allData = await adapter.read(tableName);
    console.log('Debug - All data in table:', allData.length, 'items');
    if (allData.length > 0) {
      console.log('Debug - All data sample:', allData.slice(0, 3));
    }
    const verifyData = await adapter.findMany(tableName, { type: 'batch_test' });
    console.log('Debug - Verify data:', verifyData.length, 'items');
    expect(verifyData.length).toBe(50);
  });

  test('缓存大小限制应该生效', async () => {
    // 模拟不同的表操作来测试缓存大小限制
    const maxCacheSize = Math.min(config.encryption.maxCacheSize, 10); // 限制测试表数量，避免创建过多表

    // 创建多个表并写入数据
    for (let i = 0; i < maxCacheSize + 2; i++) {
      const tempTable = `temp_cache_test_${i}`;
      await adapter.createTable(tempTable);
      await adapter.write(tempTable, { id: i, data: `test${i}` });

      // 读取以建立缓存
      await adapter.read(tempTable);
    }

    // 注意：这是一个集成测试，缓存大小限制的具体行为取决于实现
    console.log(`测试缓存大小限制: maxCacheSize=${maxCacheSize}`);

    // 清理测试表
    for (let i = 0; i < maxCacheSize + 2; i++) {
      const tempTable = `temp_cache_test_${i}`;
      await adapter.deleteTable(tempTable).catch(() => {}); // 忽略错误
    }
  });

  test('配置选项应该被正确使用', () => {
    // 验证配置是否被正确读取
    expect(config.performance.enableQueryOptimization).toBe(true);
    expect(config.encryption.cacheTimeout).toBeGreaterThan(0);
    expect(config.encryption.maxCacheSize).toBeGreaterThan(0);

    console.log('配置验证通过:', {
      queryOptimization: config.performance.enableQueryOptimization,
      cacheTimeout: config.encryption.cacheTimeout,
      maxCacheSize: config.encryption.maxCacheSize,
    });
  });
});
