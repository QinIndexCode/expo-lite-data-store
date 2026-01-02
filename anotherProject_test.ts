// test-lite-data-store.ts
// 完整测试 expo-lite-data-store 所有可用 API
// 此文件为实际项目中的测试文件，在此处仅用于展示
// 导入已确认可用的API
import {
  bulkWrite,
  countTable,
  createTable,
  findMany,
  findOne,
  hasTable,
  insert,
  listTables,
  overwrite,
  read,
  remove,
  update,
  verifyCountTable
} from 'expo-lite-data-store';

// 测试表名常量
const TEST_TABLE = 'test_lite_data_store';
const TEST_TABLE_ENCRYPTED = 'test_encrypted_data';
const TEST_TABLE_OVERWRITE = 'test_overwrite_data';
const TEST_TABLE_BULK = 'test_bulk_data';

// 生成唯一请求ID
const generateRequestId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// 日志级别类型
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// 日志上下文接口
interface LogContext {
  testSuite?: string;
  testName?: string;
  apiMethod?: string;
  tableName?: string;
  requestId?: string;
  userId?: string;
  transactionId?: string;
  data?: any;
  expected?: any;
  actual?: any;
  fields?: string[];
  [key: string]: any;
}

// 结构化日志记录器 - 精简版
const structuredLogger = {
  log: (level: LogLevel, message: string, context?: LogContext) => {
    if (level === 'error') {
      // 错误时打印详细的JSON日志
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context: {
          ...context,
          testFile: 'test-lite-data-store.ts',
          environment: __DEV__ ? 'development' : 'production',
        },
      };
      console.error(JSON.stringify(logEntry, null, 2));
    } else {
      // 非错误时只打印简洁信息
      console.log(`${message}`);
    }
  },
  
  info: (message: string, context?: LogContext) => {
    structuredLogger.log('info', message, context);
  },
  
  warn: (message: string, context?: LogContext) => {
    structuredLogger.log('warn', message, context);
  },
  
  error: (message: string, context?: LogContext, error?: Error) => {
    const errorContext = {
      ...context,
      error: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause,
      },
    };
    structuredLogger.log('error', message, errorContext);
  },
  
  debug: (message: string, context?: LogContext) => {
    // 调试日志只在开发环境打印
    if (__DEV__) {
      structuredLogger.log('debug', message, context);
    }
  },
};

// 增强的断言工具
const assert = (condition: boolean, message: string, context?: LogContext) => {
  if (!condition) {
    const error = new Error(message);
    structuredLogger.error('断言失败', {
      ...context,
      errorDetails: {
        assertionMessage: message,
        expected: context?.expected,
        actual: context?.actual,
        fields: context?.fields,
      },
    }, error);
    throw error;
  }
};

// 安全清理单个表 - 只使用已确认可用的API
const cleanupTable = async (tableName: string, options: any = {}) => {
  const requestId = generateRequestId();
  const context = {
    apiMethod: 'cleanupTable',
    tableName,
    requestId,
  };
  
  try {
    structuredLogger.info('开始清理表', { ...context, options });
    
    if (await hasTable(tableName)) {
      const result = await remove(tableName, { where: {}, ...options });
      structuredLogger.info('表清理成功', { ...context, removedCount: result });
    } else {
      structuredLogger.info('表不存在，无需清理', context);
    }
  } catch (error) {
    structuredLogger.error('表清理失败', context, error as Error);
  }
};

// 安全清理所有测试表
const cleanupAllTables = async () => {
  const requestId = generateRequestId();
  structuredLogger.info('开始清理所有测试表', { requestId });
  
  await cleanupTable(TEST_TABLE, { requestId });
  await cleanupTable(TEST_TABLE_ENCRYPTED, { encrypted: true, requestId });
  await cleanupTable(TEST_TABLE_OVERWRITE, { requestId });
  await cleanupTable(TEST_TABLE_BULK, { requestId });
  
  structuredLogger.info('所有测试表清理完成', { requestId });
};

// 表管理测试套件（只使用已确认可用的API）
export async function testTableManagement() {
  const requestId = generateRequestId();
  const context = {
    testSuite: 'TableManagement',
    requestId,
  };
  
  try {
    // 1. 测试 hasTable - 检查表是否存在
    const tableExists = await hasTable(TEST_TABLE);
    assert(!tableExists, '初始状态下表应该不存在', {
      ...context,
      testName: 'hasTable',
      apiMethod: 'hasTable',
      tableName: TEST_TABLE,
      expected: false,
      actual: tableExists,
      operation: '检查初始表状态',
    });
    console.log('✅ hasTable API 测试成功');
    
    // 2. 测试 createTable - 创建表
    await createTable(TEST_TABLE);
    const tableExistsAfterCreate = await hasTable(TEST_TABLE);
    assert(tableExistsAfterCreate, '创建表后表应该存在', {
      ...context,
      testName: 'createTable',
      apiMethod: 'createTable',
      tableName: TEST_TABLE,
      expected: true,
      actual: tableExistsAfterCreate,
      operation: '检查创建后表状态',
    });
    console.log('✅ createTable API 测试成功');
    
    // 3. 测试 listTables - 获取所有表名
    const tables = await listTables();
    assert(Array.isArray(tables), 'listTables 应该返回数组', {
      ...context,
      testName: 'listTables',
      apiMethod: 'listTables',
      expected: 'Array',
      actual: typeof tables,
      operation: '检查返回类型',
    });
    
    assert(tables.includes(TEST_TABLE), '创建的表应该在列表中', {
      ...context,
      testName: 'listTables',
      apiMethod: 'listTables',
      expected: TEST_TABLE,
      actual: tables,
      operation: '检查表是否在列表中',
      fields: ['tableNames'],
    });
    console.log('✅ listTables API 测试成功');
    
    // 4. 测试 countTable - 获取表记录数
    const count = await countTable(TEST_TABLE);
    assert(count === 0, '新表记录数应该是0', {
      ...context,
      testName: 'countTable',
      apiMethod: 'countTable',
      tableName: TEST_TABLE,
      expected: 0,
      actual: count,
      operation: '检查新表记录数',
      fields: ['count'],
    });
    console.log('✅ countTable API 测试成功');
    
    // 5. 测试 verifyCountTable - 验证表计数准确性
    const verifyResult = await verifyCountTable(TEST_TABLE);
    assert(verifyResult.metadata === verifyResult.actual, '计数应该匹配', {
      ...context,
      testName: 'verifyCountTable',
      apiMethod: 'verifyCountTable',
      tableName: TEST_TABLE,
      expected: verifyResult.metadata,
      actual: verifyResult.actual,
      operation: '验证计数匹配',
      fields: ['metadataCount', 'actualCount'],
    });
    
    assert(verifyResult.match, '计数应该一致', {
      ...context,
      testName: 'verifyCountTable',
      apiMethod: 'verifyCountTable',
      tableName: TEST_TABLE,
      expected: true,
      actual: verifyResult.match,
      operation: '验证计数一致性',
      fields: ['match'],
    });
    console.log('✅ verifyCountTable API 测试成功');
    return true;
  } catch (error) {
    structuredLogger.error('表管理 API 测试失败', context, error as Error);
    return false;
  }
}

// 数据操作测试套件
export async function testDataOperations() {
  const requestId = generateRequestId();
  const context = {
    testSuite: 'DataOperations',
    requestId,
  };
  
  try {
    // 准备测试表
    if (!await hasTable(TEST_TABLE)) {
      await createTable(TEST_TABLE);
    }
    await remove(TEST_TABLE, { where: {} });
    
    // 1. 测试 insert - 插入单条数据
    const testData = {
      id: 1,
      name: '测试数据1',
      value: '值1',
      count: 100,
      isActive: true
    };
    
    const insertResult1 = await insert(TEST_TABLE, testData);
    assert(insertResult1.written === 1, '应该插入1条数据', {
      ...context,
      testName: 'insertSingle',
      apiMethod: 'insert',
      tableName: TEST_TABLE,
      expected: 1,
      actual: insertResult1.written,
      operation: '插入单条数据',
      fields: ['written'],
    });
    
    assert(insertResult1.totalAfterWrite === 1, '插入后总数据应该是1条', {
      ...context,
      testName: 'insertSingle',
      apiMethod: 'insert',
      tableName: TEST_TABLE,
      expected: 1,
      actual: insertResult1.totalAfterWrite,
      operation: '检查插入后总记录数',
      fields: ['totalAfterWrite'],
    });
    console.log('✅ insert API 测试成功 (单条插入)');
    
    // 2. 测试 insert - 插入多条数据
    const multipleTestData = [
      {
        id: 2,
        name: '测试数据2',
        value: '值2',
        count: 200,
        isActive: false
      },
      {
        id: 3,
        name: '测试数据3',
        value: '值3',
        count: 300,
        isActive: true
      }
    ];
    
    const insertResult2 = await insert(TEST_TABLE, multipleTestData);
    assert(insertResult2.written === 2, '应该插入2条数据', {
      ...context,
      testName: 'insertMultiple',
      apiMethod: 'insert',
      tableName: TEST_TABLE,
      expected: 2,
      actual: insertResult2.written,
      operation: '插入多条数据',
      fields: ['written'],
    });
    
    assert(insertResult2.totalAfterWrite === 3, '插入后总数据应该是3条', {
      ...context,
      testName: 'insertMultiple',
      apiMethod: 'insert',
      tableName: TEST_TABLE,
      expected: 3,
      actual: insertResult2.totalAfterWrite,
      operation: '检查插入多条后总记录数',
      fields: ['totalAfterWrite'],
    });
    console.log('✅ insert API 测试成功 (多条插入)');
    
    // 3. 测试 findOne - 查询单条数据
    const findOneResult = await findOne(TEST_TABLE, {
      where: { id: 1 }
    });
    
    assert(findOneResult !== null, '应该找到数据', {
      ...context,
      testName: 'findOne',
      apiMethod: 'findOne',
      tableName: TEST_TABLE,
      expected: '非空对象',
      actual: findOneResult,
      operation: '查询单条数据',
      query: { id: 1 },
    });
    
    assert(findOneResult!.id === 1, 'ID应该是1', {
      ...context,
      testName: 'findOne',
      apiMethod: 'findOne',
      tableName: TEST_TABLE,
      expected: 1,
      actual: findOneResult!.id,
      operation: '验证ID字段',
      fields: ['id'],
    });
    
    assert(findOneResult!.name === '测试数据1', '名称应该匹配', {
      ...context,
      testName: 'findOne',
      apiMethod: 'findOne',
      tableName: TEST_TABLE,
      expected: '测试数据1',
      actual: findOneResult!.name,
      operation: '验证name字段',
      fields: ['name'],
    });
    console.log('✅ findOne API 测试成功');
    
    // 4. 测试 findMany - 查询所有数据
    const findAllResult = await findMany(TEST_TABLE, {
      where: {}
    });
    
    assert(findAllResult.length === 3, '应该返回3条数据', {
      ...context,
      testName: 'findAll',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 3,
      actual: findAllResult.length,
      operation: '查询所有数据',
      query: {},
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (查询所有数据)');
    
    // 5. 测试 findMany - 查询带条件的数据
    const findWhereResult = await findMany(TEST_TABLE, {
      where: { isActive: true }
    });
    
    assert(findWhereResult.length === 2, '应该返回2条活跃数据', {
      ...context,
      testName: 'findWhere',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 2,
      actual: findWhereResult.length,
      operation: '查询带条件数据',
      query: { isActive: true },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (查询带条件数据)');
    
    // 6. 测试 findMany - 使用$gt操作符
    const gtResult = await findMany(TEST_TABLE, {
      where: { count: { $gt: 150 } }
    });
    
    assert(gtResult.length === 2, '应该返回2条count>150的数据', {
      ...context,
      testName: 'findGt',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 2,
      actual: gtResult.length,
      operation: '使用$gt操作符查询',
      query: { count: { $gt: 150 } },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (使用$gt操作符)');
    
    // 7. 测试 findMany - 使用$lt操作符
    const ltResult = await findMany(TEST_TABLE, {
      where: { count: { $lt: 250 } }
    });
    
    assert(ltResult.length === 2, '应该返回2条count<250的数据', {
      ...context,
      testName: 'findLt',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 2,
      actual: ltResult.length,
      operation: '使用$lt操作符查询',
      query: { count: { $lt: 250 } },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (使用$lt操作符)');
    
    // 8. 测试 findMany - 使用$eq操作符
    const eqResult = await findMany(TEST_TABLE, {
      where: { id: { $eq: 1 } }
    });
    
    assert(eqResult.length === 1, '应该返回1条id=1的数据', {
      ...context,
      testName: 'findEq',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 1,
      actual: eqResult.length,
      operation: '使用$eq操作符查询',
      query: { id: { $eq: 1 } },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (使用$eq操作符)');
    
    // 9. 测试 findMany - 使用$and操作符
    const andResult = await findMany(TEST_TABLE, {
      where: { $and: [{ isActive: true }, { count: { $gt: 100 } }] }
    });
    
    assert(andResult.length === 1, '应该返回1条同时满足两个条件的数据', {
      ...context,
      testName: 'findAnd',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 1,
      actual: andResult.length,
      operation: '使用$and操作符查询',
      query: { $and: [{ isActive: true }, { count: { $gt: 100 } }] },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (使用$and操作符)');
    
    // 10. 测试 findMany - 使用$or操作符
    const orResult = await findMany(TEST_TABLE, {
      where: { $or: [{ id: 1 }, { isActive: false }] }
    });
    
    assert(orResult.length === 2, '应该返回2条满足任一条件的数据', {
      ...context,
      testName: 'findOr',
      apiMethod: 'findMany',
      tableName: TEST_TABLE,
      expected: 2,
      actual: orResult.length,
      operation: '使用$or操作符查询',
      query: { $or: [{ id: 1 }, { isActive: false }] },
      fields: ['resultLength'],
    });
    console.log('✅ findMany API 测试成功 (使用$or操作符)');
    
    // 11. 测试 update - 更新数据
    const updateData = { value: '更新后的值', count: 999 };
    const updateResult = await update(TEST_TABLE, 
      updateData, 
      { where: { id: 1 } }
    );
    
    assert(updateResult === 1, '应该更新1条数据', {
      ...context,
      testName: 'update',
      apiMethod: 'update',
      tableName: TEST_TABLE,
      expected: 1,
      actual: updateResult,
      operation: '更新数据',
      data: updateData,
      query: { where: { id: 1 } },
      fields: ['updatedCount'],
    });
    
    // 验证更新结果
    const updatedData = await findOne(TEST_TABLE, { where: { id: 1 } });
    assert(updatedData!.value === '更新后的值', '值应该被更新', {
      ...context,
      testName: 'update',
      apiMethod: 'update',
      tableName: TEST_TABLE,
      expected: '更新后的值',
      actual: updatedData!.value,
      operation: '验证更新结果',
      fields: ['value'],
    });
    
    assert(updatedData!.count === 999, 'count应该被更新为999', {
      ...context,
      testName: 'update',
      apiMethod: 'update',
      tableName: TEST_TABLE,
      expected: 999,
      actual: updatedData!.count,
      operation: '验证count字段更新',
      fields: ['count'],
    });
    console.log('✅ update API 测试成功');
    
    // 12. 测试 remove - 删除单条数据
    const removeResult1 = await remove(TEST_TABLE, { where: { id: 2 } });
    assert(removeResult1 === 1, '应该删除1条数据', {
      ...context,
      testName: 'removeSingle',
      apiMethod: 'remove',
      tableName: TEST_TABLE,
      expected: 1,
      actual: removeResult1,
      operation: '删除单条数据',
      query: { where: { id: 2 } },
      fields: ['removedCount'],
    });
    
    // 验证删除结果
    const countAfterRemove = await countTable(TEST_TABLE);
    assert(countAfterRemove === 2, '删除后表记录数应该是2', {
      ...context,
      testName: 'removeSingle',
      apiMethod: 'remove',
      tableName: TEST_TABLE,
      expected: 2,
      actual: countAfterRemove,
      operation: '检查删除后总记录数',
      fields: ['totalCount'],
    });
    console.log('✅ remove API 测试成功 (删除单条数据)');
    
    // 13. 测试 remove - 删除多条数据
    const removeResult2 = await remove(TEST_TABLE, { where: { isActive: true } });
    assert(removeResult2 === 2, '应该删除2条数据', {
      ...context,
      testName: 'removeMultiple',
      apiMethod: 'remove',
      tableName: TEST_TABLE,
      expected: 2,
      actual: removeResult2,
      operation: '删除多条数据',
      query: { where: { isActive: true } },
      fields: ['removedCount'],
    });
    
    // 验证删除结果
    const countAfterRemove2 = await countTable(TEST_TABLE);
    assert(countAfterRemove2 === 0, '删除后表应该为空', {
      ...context,
      testName: 'removeMultiple',
      apiMethod: 'remove',
      tableName: TEST_TABLE,
      expected: 0,
      actual: countAfterRemove2,
      operation: '检查删除多条后总记录数',
      fields: ['totalCount'],
    });
    console.log('✅ remove API 测试成功 (删除多条数据)');
    return true;
  } catch (error) {
    structuredLogger.error('数据操作 API 测试失败', context, error as Error);
    return false;
  }
}

// 高级功能测试套件
export async function testAdvancedFeatures() {
  const requestId = generateRequestId();
  const context = {
    testSuite: 'AdvancedFeatures',
    requestId,
  };
  
  try {
    // 1. 测试 overwrite - 覆盖表数据
    
    // 准备测试表
    if (!await hasTable(TEST_TABLE_OVERWRITE)) {
      await createTable(TEST_TABLE_OVERWRITE);
    }
    await remove(TEST_TABLE_OVERWRITE, { where: {} });
    
    // 先插入一些数据
    await insert(TEST_TABLE_OVERWRITE, { id: 1, name: '旧数据' });
    const countBeforeOverwrite = await countTable(TEST_TABLE_OVERWRITE);
    assert(countBeforeOverwrite === 1, '覆盖前表记录数应该是1', {
      ...context,
      testName: 'overwrite',
      apiMethod: 'overwrite',
      tableName: TEST_TABLE_OVERWRITE,
      expected: 1,
      actual: countBeforeOverwrite,
      operation: '检查覆盖前记录数',
      fields: ['totalCount'],
    });
    
    // 执行覆盖
    const overwriteData = {
      id: 2,
      name: '新数据',
      value: '覆盖值'
    };
    
    await overwrite(TEST_TABLE_OVERWRITE, overwriteData);
    const countAfterOverwrite = await countTable(TEST_TABLE_OVERWRITE);
    assert(countAfterOverwrite === 1, '覆盖后表记录数应该是1', {
      ...context,
      testName: 'overwrite',
      apiMethod: 'overwrite',
      tableName: TEST_TABLE_OVERWRITE,
      expected: 1,
      actual: countAfterOverwrite,
      operation: '检查覆盖后记录数',
      fields: ['totalCount'],
    });
    
    // 验证覆盖结果
    const overwrittenData = await findOne(TEST_TABLE_OVERWRITE, { where: {} });
    assert(overwrittenData!.id === 2, 'ID应该是新的', {
      ...context,
      testName: 'overwrite',
      apiMethod: 'overwrite',
      tableName: TEST_TABLE_OVERWRITE,
      expected: 2,
      actual: overwrittenData!.id,
      operation: '验证ID字段覆盖',
      fields: ['id'],
    });
    
    assert(overwrittenData!.name === '新数据', '名称应该是新的', {
      ...context,
      testName: 'overwrite',
      apiMethod: 'overwrite',
      tableName: TEST_TABLE_OVERWRITE,
      expected: '新数据',
      actual: overwrittenData!.name,
      operation: '验证name字段覆盖',
      fields: ['name'],
    });
    console.log('✅ overwrite API 测试成功');
    
    // 2. 测试 bulkWrite - 批量操作
    
    // 准备测试表
    if (!await hasTable(TEST_TABLE_BULK)) {
      await createTable(TEST_TABLE_BULK);
    }
    await remove(TEST_TABLE_BULK, { where: {} });
    
    // 批量插入
    // 定义批量操作项的类型，确保与 bulkWrite 要求一致
    interface BulkInsertOperation {
      type: 'insert';
      data: Record<string, any>;
    }

    const bulkOperations: BulkInsertOperation[] = [
      { type: 'insert', data: { id: 1, name: '批量数据1', value: 100 } },
      { type: 'insert', data: { id: 2, name: '批量数据2', value: 200 } },
      { type: 'insert', data: { id: 3, name: '批量数据3', value: 300 } }
    ];

    await bulkWrite(TEST_TABLE_BULK, bulkOperations);
    const countAfterBulk = await countTable(TEST_TABLE_BULK);
    assert(countAfterBulk === 3, '批量插入后表记录数应该是3', {
      ...context,
      testName: 'bulkWrite',
      apiMethod: 'bulkWrite',
      tableName: TEST_TABLE_BULK,
      expected: 3,
      actual: countAfterBulk,
      operation: '检查批量插入后记录数',
      fields: ['totalCount'],
    });
    console.log('✅ bulkWrite API 测试成功');
    
    // 3. 测试 read - 读取数据（findMany的别名）
    const readResult = await read(TEST_TABLE_BULK, {
      filter: { value: { $gt: 150 } }
    });
    assert(readResult.length === 2, 'read API 应该返回2条数据', {
      ...context,
      testName: 'read',
      apiMethod: 'read',
      tableName: TEST_TABLE_BULK,
      expected: 2,
      actual: readResult.length,
      operation: '使用read API查询',
      query: { value: { $gt: 150 } },
      fields: ['resultLength'],
    });
    console.log('✅ read API 测试成功');
    return true;
  } catch (error) {
    structuredLogger.error('高级功能 API 测试失败', context, error as Error);
    return false;
  }
}

// 加密功能测试套件
export async function testEncryptedData() {
  const requestId = generateRequestId();
  const context = {
    testSuite: 'EncryptedData',
    requestId,
  };
  
  try {
    // 准备测试表
    if (!await hasTable(TEST_TABLE_ENCRYPTED)) {
      await createTable(TEST_TABLE_ENCRYPTED);
    }
    await remove(TEST_TABLE_ENCRYPTED, { where: {}, encrypted: true });
    
    // 插入加密数据
    const sensitiveData = {
      id: 1,
      sensitiveData: '这是敏感数据',
      password: 'secure_password_123',
      userInfo: '用户信息'
    };
    
    await insert(TEST_TABLE_ENCRYPTED, sensitiveData, { encrypted: true });
    console.log('✅ 加密数据 insert API 测试成功');
    
    // 查询加密数据
    const encryptedData = await findOne(TEST_TABLE_ENCRYPTED, {
      where: { id: 1 },
      encrypted: true
    });
    
    assert(encryptedData !== null, '应该找到加密数据', {
      ...context,
      testName: 'findEncrypted',
      apiMethod: 'findOne',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: '非空对象',
      actual: encryptedData,
      operation: '查询加密数据',
      query: { id: 1 },
    });
    
    assert(encryptedData!.sensitiveData === '这是敏感数据', '敏感数据应该匹配', {
      ...context,
      testName: 'findEncrypted',
      apiMethod: 'findOne',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: '这是敏感数据',
      actual: encryptedData!.sensitiveData,
      operation: '验证敏感数据',
      fields: ['sensitiveData'],
    });
    
    assert(encryptedData!.password === 'secure_password_123', '密码应该匹配', {
      ...context,
      testName: 'findEncrypted',
      apiMethod: 'findOne',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: 'secure_password_123',
      actual: encryptedData!.password,
      operation: '验证密码字段',
      fields: ['password'],
    });
    console.log('✅ 加密数据 findOne API 测试成功');
    
    // 更新加密数据
    const updateData = {
      sensitiveData: '更新后的敏感数据', 
      password: 'new_secure_password'
    };
    
    await update(TEST_TABLE_ENCRYPTED, updateData, { where: { id: 1 }, encrypted: true });
    
    // 验证更新结果
    const updatedEncryptedData = await findOne(TEST_TABLE_ENCRYPTED, {
      where: { id: 1 },
      encrypted: true
    });
    
    assert(updatedEncryptedData!.sensitiveData === '更新后的敏感数据', '敏感数据应该被更新', {
      ...context,
      testName: 'updateEncrypted',
      apiMethod: 'update',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: '更新后的敏感数据',
      actual: updatedEncryptedData!.sensitiveData,
      operation: '验证更新后的敏感数据',
      fields: ['sensitiveData'],
    });
    
    assert(updatedEncryptedData!.password === 'new_secure_password', '密码应该被更新', {
      ...context,
      testName: 'updateEncrypted',
      apiMethod: 'update',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: 'new_secure_password',
      actual: updatedEncryptedData!.password,
      operation: '验证更新后的密码',
      fields: ['password'],
    });
    console.log('✅ 加密数据 update API 测试成功');
    
    // 删除加密数据
    const removeResult = await remove(TEST_TABLE_ENCRYPTED, { where: { id: 1 }, encrypted: true });
    assert(removeResult === 1, '应该删除1条加密数据', {
      ...context,
      testName: 'removeEncrypted',
      apiMethod: 'remove',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: 1,
      actual: removeResult,
      operation: '删除加密数据',
      query: { where: { id: 1 } },
      fields: ['removedCount'],
    });
    
    // 验证删除结果
    const countAfterRemove = await countTable(TEST_TABLE_ENCRYPTED, { encrypted: true });
    assert(countAfterRemove === 0, '加密表应该为空', {
      ...context,
      testName: 'removeEncrypted',
      apiMethod: 'remove',
      tableName: TEST_TABLE_ENCRYPTED,
      expected: 0,
      actual: countAfterRemove,
      operation: '检查删除后加密表记录数',
      fields: ['totalCount'],
    });
    console.log('✅ 加密数据 remove API 测试成功');
    return true;
  } catch (error) {
    structuredLogger.error('加密数据功能测试失败', context, error as Error);
    return false;
  }
}

// 主测试函数 - 运行所有测试套件
export async function runAllTests() {
  const requestId = generateRequestId();
  const context = {
    testSuite: 'AllTests',
    requestId,
    startTime: new Date().toISOString(),
  };
  
  console.log('=== expo-lite-data-store 测试套件启动 ===');
  
  // 测试前清理
  await cleanupAllTables();
  
  // 测试结果
  const results = {
    tableManagement: await testTableManagement(),
    dataOperations: await testDataOperations(),
    advancedFeatures: await testAdvancedFeatures(),
    encryptedData: await testEncryptedData()
  };
  
  // 测试后清理
  await cleanupAllTables();
  
  // 输出测试结果
  const endTime = new Date().toISOString();
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(result => result).length;
  const passRate = (passedTests / totalTests) * 100;
  
  console.log('\n=== 测试结果汇总 ===');
  console.log(`总测试数: ${totalTests} | 通过: ${passedTests} | 失败: ${totalTests - passedTests}`);
  console.log(`通过率: ${passRate.toFixed(2)}%`);
  console.log('=== 测试套件完成 ===');
  
  // 只在测试失败时打印详细结果
  const failedTests = Object.entries(results).filter(([_, passed]) => !passed);
  if (failedTests.length > 0) {
    console.log('\n=== 失败测试详情 ===');
    failedTests.forEach(([testName, _]) => {
      console.log(`❌ ${testName} 测试失败`);
    });
  }
  
  return {
    ...context,
    endTime,
    duration: new Date(endTime).getTime() - new Date(context.startTime).getTime(),
    totalTests,
    passedTests,
    failedTests: totalTests - passedTests,
    passRate,
    results,
  };
}

// 默认导出
export default runAllTests;