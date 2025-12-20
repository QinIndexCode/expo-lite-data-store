// src/core/cache/__tests__/UpdateCacheTest.test.ts
// 测试update功能是否会被缓存影响

import { createTable, insert, read, update, findOne, deleteTable } from '../../../expo-lite-data-store';

describe('Update Cache Test', () => {
  const TABLE_NAME = 'test_update_cache';

  beforeEach(async () => {
    // 确保表不存在
    try {
      await deleteTable(TABLE_NAME);
    } catch (error) {
      // 表不存在，忽略错误
    }

    // 创建表
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
        value: 'number',
      },
    });
  });

  afterEach(async () => {
    // 清理表
    try {
      await deleteTable(TABLE_NAME);
    } catch (error) {
      // 表不存在，忽略错误
    }
  });

  test('update操作后应立即清除相关缓存，确保读取到最新数据', async () => {
    // 1. 插入测试数据
    await insert(TABLE_NAME, {
      id: 1,
      name: 'Test Item',
      value: 100,
    });

    // 2. 第一次读取，数据应被缓存
    const data1 = await read(TABLE_NAME);
    expect(data1.length).toBe(1);
    expect(data1[0].value).toBe(100);

    // 3. 执行update操作
    const updatedCount = await update(TABLE_NAME, { value: 200 }, { where: { id: 1 } });
    expect(updatedCount).toBe(1);

    // 4. 第二次读取，应获取到最新数据（而不是缓存的旧数据）
    const data2 = await read(TABLE_NAME);
    expect(data2.length).toBe(1);
    expect(data2[0].value).toBe(200); // 这里可能会失败，因为缓存没有被清除

    // 5. 使用findOne查询，也应获取到最新数据
    const item = await findOne(TABLE_NAME, { where: { id: 1 } });
    expect(item).not.toBeNull();
    expect(item?.value).toBe(200);
  });

  test('短时间内多次update和read操作，应始终返回最新数据', async () => {
    // 1. 插入测试数据
    await insert(TABLE_NAME, {
      id: 2,
      name: 'Test Item 2',
      value: 50,
    });

    // 2. 执行多次update和read操作
    for (let i = 0; i < 5; i++) {
      const newValue = 60 + i;

      // 执行update
      const updatedCount = await update(TABLE_NAME, { value: newValue }, { where: { id: 2 } });
      expect(updatedCount).toBe(1);

      // 立即读取，应获取到最新值
      const data = await read(TABLE_NAME);
      expect(data[0].value).toBe(newValue);

      // 使用findOne查询，也应获取到最新值
      const item = await findOne(TABLE_NAME, { where: { id: 2 } });
      expect(item?.value).toBe(newValue);
    }
  });

  test('update操作后，不同查询条件的缓存应不受影响', async () => {
    // 1. 插入多条测试数据
    await insert(TABLE_NAME, [
      { id: 3, name: 'Item A', value: 10 },
      { id: 4, name: 'Item B', value: 20 },
      { id: 5, name: 'Item C', value: 30 },
    ]);

    // 2. 使用不同条件查询，建立不同的缓存
    await read(TABLE_NAME); // 建立完整数据的缓存
    await findOne(TABLE_NAME, { where: { name: 'Item A' } }); // 建立Item A的缓存
    await findOne(TABLE_NAME, { where: { name: 'Item B' } }); // 建立Item B的缓存

    // 3. 更新其中一条数据
    await update(TABLE_NAME, { value: 100 }, { where: { id: 3 } });

    // 4. 验证所有查询都返回最新数据
    const allData2 = await read(TABLE_NAME);
    expect(allData2.find(item => item.id === 3)?.value).toBe(100);

    const itemA2 = await findOne(TABLE_NAME, { where: { name: 'Item A' } });
    expect(itemA2?.value).toBe(100);

    // 验证其他数据不受影响
    const itemB2 = await findOne(TABLE_NAME, { where: { name: 'Item B' } });
    expect(itemB2?.value).toBe(20);
  });
});
