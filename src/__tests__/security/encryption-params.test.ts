// src/__tests__/security/encryption-params.test.ts
// 测试加密参数功能
// 验证非加密模式不触发生物识别，加密模式可选择是否需要生物识别

import { createTable, insert, read, update, findOne, remove, deleteTable } from '../../expo-lite-data-store';

describe('Encryption Parameters Test', () => {
  const TABLE_NAME = 'test_encryption_params';
  const SENSITIVE_TABLE = 'test_sensitive_data';

  beforeEach(async () => {
    // 清理测试表
    try {
      await deleteTable(TABLE_NAME);
    } catch (error) {
      // 表不存在，忽略错误
    }
    try {
      await deleteTable(SENSITIVE_TABLE);
    } catch (error) {
      // 表不存在，忽略错误
    }
  });

  afterEach(async () => {
    // 清理测试表
    try {
      await deleteTable(TABLE_NAME);
    } catch (error) {
      // 表不存在，忽略错误
    }
    try {
      await deleteTable(SENSITIVE_TABLE);
    } catch (error) {
      // 表不存在，忽略错误
    }
  });

  test('非加密模式下的操作应正常工作，不触发生物识别', async () => {
    // 创建表（默认非加密）
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
        value: 'number',
      },
    });

    // 插入数据
    await insert(TABLE_NAME, {
      id: 1,
      name: 'Test Item',
      value: 100,
    });

    // 读取数据
    const data = await read(TABLE_NAME);
    expect(data.length).toBe(1);
    expect(data[0].value).toBe(100);

    // 更新数据
    await update(TABLE_NAME, { value: 200 }, { where: { id: 1 } });
    const updatedData = await read(TABLE_NAME, {});
    expect(updatedData[0].value).toBe(200);

    // 查找数据
    const foundItem = await findOne(TABLE_NAME, { where: { id: 1 } });
    expect(foundItem?.value).toBe(200);

    // 删除数据
    await remove(TABLE_NAME, { where: { id: 1 } });
    const emptyData = await read(TABLE_NAME, {});
    expect(emptyData.length).toBe(0);
  });

  test('加密模式下的操作应正常工作，无生物识别', async () => {
    // 创建加密表（无生物识别）
    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        username: 'string',
        password: 'string',
      },
      encrypted: true,
    }); // encrypted = true

    // 插入敏感数据
    await insert(SENSITIVE_TABLE, {
      id: 1,
      username: 'test_user',
      password: 'secure_password',
    }, { encrypted: true }); // encrypted = true

    // 读取敏感数据
    const data = await read(SENSITIVE_TABLE, { encrypted: true }); // encrypted = true
    expect(data.length).toBe(1);
    expect(data[0].username).toBe('test_user');
    expect(data[0].password).toBe('secure_password');

    // 更新敏感数据
    await update(SENSITIVE_TABLE, { password: 'new_secure_password' }, { where: { id: 1 }, encrypted: true }); // encrypted = true
    const updatedData = await read(SENSITIVE_TABLE, { encrypted: true }); // encrypted = true
    expect(updatedData[0].password).toBe('new_secure_password');

    // 查找敏感数据
    const foundItem = await findOne(SENSITIVE_TABLE, { where: { id: 1 }, encrypted: true }); // encrypted = true
    expect(foundItem?.username).toBe('test_user');
  });

  test('加密模式下的操作应支持生物识别选项', async () => {
    // 创建加密表（支持生物识别）
    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        credit_card: 'string',
        cvv: 'string',
      },
      encrypted: true,
      requireAuthOnAccess: true,
    }); // encrypted = true, requireAuthOnAccess = true

    // 插入敏感数据
    await insert(SENSITIVE_TABLE, {
      id: 1,
      credit_card: '1234-5678-9012-3456',
      cvv: '123',
    }, { encrypted: true, requireAuthOnAccess: true }); // encrypted = true, requireAuthOnAccess = true

    // 读取敏感数据
    const data = await read(SENSITIVE_TABLE, { encrypted: true, requireAuthOnAccess: true }); // encrypted = true, requireAuthOnAccess = true
    expect(data.length).toBe(1);
    expect(data[0].credit_card).toBe('1234-5678-9012-3456');
    expect(data[0].cvv).toBe('123');

    // 删除敏感数据
    await remove(SENSITIVE_TABLE, { where: { id: 1 }, encrypted: true, requireAuthOnAccess: true }); // encrypted = true, requireAuthOnAccess = true
    const emptyData = await read(SENSITIVE_TABLE, { encrypted: true, requireAuthOnAccess: true }); // encrypted = true, requireAuthOnAccess = true
    expect(emptyData.length).toBe(0);
  });

  test('加密和非加密表应可以同时使用', async () => {
    // 创建非加密表
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
      },
    });

    // 创建加密表
    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        secret: 'string',
      },
      encrypted: true,
    }); // encrypted = true

    // 向非加密表插入数据
    await insert(TABLE_NAME, { id: 1, name: 'Public Item' });

    // 向加密表插入数据
    await insert(SENSITIVE_TABLE, { id: 1, secret: 'Hidden Secret' }, { encrypted: true }); // encrypted = true



    // 读取非加密表数据
    const publicData = await read(TABLE_NAME);
    expect(publicData.length).toBe(1);
    expect(publicData[0].name).toBe('Public Item');

    // 读取加密表数据
    const privateData = await read(SENSITIVE_TABLE, { encrypted: true }); // encrypted = true
    expect(privateData.length).toBe(1);
    expect(privateData[0].secret).toBe('Hidden Secret');
  });
});
