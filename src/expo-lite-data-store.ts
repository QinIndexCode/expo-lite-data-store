// src/expo-lite-data-store.ts
// Expo Lite Data Store 主要API导出文件
// 提供数据库操作的所有公共接口，包括表管理、数据读写、查询、事务等
// 创建于: 2025-11-19
// 最后修改: 2025-12-17
// 直接导入数据库实例
import { plainStorage, dbManager } from './core/db';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, TableOptions, FindOptions } from './types/storageTypes';
// AutoSyncService 类型用于类型检查

/**
 * 通用参数解析函数，处理向后兼容性
 * @param args API调用参数数组
 * @returns 解析后的参数对象
 */
const parseCommonParams = (
  args: any[]
): {
  encrypted: boolean;
  requireAuthOnAccess: boolean;
  optionsIndex: number;
  isOldFormat: boolean;
} => {
  // 过滤掉undefined参数，只保留实际传递的参数
  const actualArgs = args.filter(arg => arg !== undefined);

  // 检查是否为旧格式：查看倒数第二个参数是否为布尔值
  const lastParam = actualArgs[actualArgs.length - 1];
  const secondLastParam = actualArgs[actualArgs.length - 2];

  if (typeof secondLastParam === 'boolean') {
    // 旧格式：参数顺序为 [tableName, data?, filter?, options?, encrypted, requireAuthOnAccess]
    return {
      encrypted: secondLastParam,
      requireAuthOnAccess: typeof lastParam === 'boolean' ? lastParam : false,
      optionsIndex: actualArgs.length - 3, // options参数在倒数第三个位置
      isOldFormat: true
    };
  } else if (typeof lastParam === 'boolean') {
    // 旧格式：参数顺序为 [tableName, data?, filter?, options?, encrypted]
    return {
      encrypted: lastParam,
      requireAuthOnAccess: false,
      optionsIndex: actualArgs.length - 2, // options参数在倒数第二个位置
      isOldFormat: true
    };
  } else {
    // 新格式：参数顺序为 [tableName, data?, filter?, options]
    return {
      encrypted: false,
      requireAuthOnAccess: false,
      optionsIndex: actualArgs.length - 1, // options参数在最后一个位置
      isOldFormat: false
    };
  }
};

/**
 * 普通存储实例，不支持加密
 */
export { plainStorage };

/**
 * 创建表
 * @param tableName 表名
 * @param options 创建表选项，包含通用选项和表特定选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const createTable = async (
  tableName: string,
  options?: CreateTableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalOptions: CreateTableOptions = {};
  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat) {
    // 新格式：options是对象
    finalOptions = options as CreateTableOptions || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  } else if (typeof options === 'object') {
    // 旧格式，但options参数存在
    finalOptions = options || {};
  }

  // 提取表特定选项，排除通用选项
  const {
    encrypted: _encrypted,
    requireAuthOnAccess: _requireAuthOnAccess,
    ...tableOptions
  } = finalOptions;

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.createTable(tableName, tableOptions);
};

/**
 * 删除表
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const deleteTable = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.deleteTable(tableName);
};

/**
 * 检查表是否存在
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<boolean>
 */
export const hasTable = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<boolean> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.hasTable(tableName);
};

/**
 * 列出所有表
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<string[]>
 */
export const listTables = async (
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<string[]> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams(['', options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.listTables();
};

/**
 * 插入数据
 * @param tableName 表名
 * @param data 要插入的数据
 * @param options 写入选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<WriteResult>
 */
export const insert = async (
  tableName: string,
  data: Record<string, any> | Record<string, any>[],
  options?: WriteOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<WriteResult> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, data, options, encrypted, requireAuthOnAccess]);

  let writeOptions: WriteOptions = {};
  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    writeOptions = options || {};
    finalEncrypted = writeOptions.encrypted || false;
    finalRequireAuth = writeOptions.requireAuthOnAccess || false;
  } else if (typeof options === 'object') {
    // 旧格式，但options参数存在
    writeOptions = options || {};
  }

  // 提取写入特定选项，排除通用选项
  const {
    encrypted: _encrypted,
    requireAuthOnAccess: _requireAuthOnAccess,
    ...finalWriteOptions
  } = writeOptions;

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.write(tableName, data, finalWriteOptions);
};

/**
 * 读取数据
 * @param tableName 表名
 * @param options 读取选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<Record<string, any>[]>
 */
export const read = async (
  tableName: string,
  options?: ReadOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<Record<string, any>[]> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let readOptions: ReadOptions = {};
  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    readOptions = options || {};
    finalEncrypted = readOptions.encrypted || false;
    finalRequireAuth = readOptions.requireAuthOnAccess || false;
  } else if (typeof options === 'object') {
    // 旧格式，但options参数存在
    readOptions = options || {};
  }

  // 提取读取特定选项，排除通用选项
  const {
    encrypted: _encrypted,
    requireAuthOnAccess: _requireAuthOnAccess,
    ...finalReadOptions
  } = readOptions;

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.read(tableName, finalReadOptions);
};

/**
 * 统计表数据行数
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<number>
 */
export const countTable = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<number> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.count(tableName);
};

/**
 * 验证表计数准确性
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<{ metadata: number; actual: number; match: boolean }>
 */
export const verifyCountTable = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<{ metadata: number; actual: number; match: boolean }> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.verifyCount(tableName);
};

/**
 * 查找单条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<Record<string, any> | null>
 */
export const findOne = async (
  tableName: string,
  filter: Record<string, any>,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<Record<string, any> | null> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, filter, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.findOne(tableName, filter);
};

/**
 * 查找多条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @param options 查询选项，包括skip、limit、sortBy、order和sortAlgorithm以及通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<Record<string, any>[]>
 */
export const findMany = async (
  tableName: string,
  filter?: Record<string, any>,
  options?: FindOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<Record<string, any>[]> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, filter, options, encrypted, requireAuthOnAccess]);

  let findOptions: FindOptions = {};
  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    findOptions = options || {};
    finalEncrypted = findOptions.encrypted || false;
    finalRequireAuth = findOptions.requireAuthOnAccess || false;
  } else if (typeof options === 'object') {
    // 旧格式，但options参数存在
    findOptions = options || {};
  }

  // 提取查询特定选项，排除通用选项
  const {
    encrypted: _encrypted,
    requireAuthOnAccess: _requireAuthOnAccess,
    ...finalFindOptions
  } = findOptions;

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.findMany(tableName, filter, finalFindOptions);
};

/**
 * 删除数据
 * @param tableName 表名
 * @param where 删除条件
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<number>
 */
export const remove = async (
  tableName: string,
  where: Record<string, any>,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<number> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, where, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.delete(tableName, where);
};

/**
 * 批量操作
 * @param tableName 表名
 * @param operations 操作数组
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<WriteResult>
 */
export const bulkWrite = async (
  tableName: string,
  operations: Array<{
    type: 'insert' | 'update' | 'delete';
    data: Record<string, any> | Record<string, any>[];
    where?: Record<string, any>;
  }>,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<WriteResult> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, operations, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.bulkWrite(tableName, operations);
};

/**
 * 开始事务
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const beginTransaction = async (
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams(['', options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.beginTransaction();
};

/**
 * 提交事务
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const commit = async (
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams(['', options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.commit();
};

/**
 * 回滚事务
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const rollback = async (
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams(['', options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.rollback();
};

/**
 * 迁移表到分片模式
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const migrateToChunked = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.migrateToChunked(tableName);
};

/**
 * 更新匹配的数据
 * @param tableName 表名
 * @param data 要更新的数据
 * @param where 更新条件，只支持基本的相等匹配
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<number> 更新的记录数
 */
export const update = async (
  tableName: string,
  data: Record<string, any>,
  where: Record<string, any>,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<number> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, data, where, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.update(tableName, data, where);
};

/**
 * 清空表数据
 * @param tableName 表名
 * @param options 操作选项，包含通用选项
 * @param encrypted 是否启用加密存储（旧格式）
 * @param requireAuthOnAccess 是否需要生物识别验证（旧格式）
 * @returns Promise<void>
 */
export const clearTable = async (
  tableName: string,
  options?: TableOptions | boolean,
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
): Promise<void> => {
  // 使用通用参数解析函数处理向后兼容性
  const params = parseCommonParams([tableName, options, encrypted, requireAuthOnAccess]);

  let finalEncrypted = params.encrypted;
  let finalRequireAuth = params.requireAuthOnAccess;

  if (!params.isOldFormat && typeof options === 'object') {
    // 新格式：options是对象
    const finalOptions = options || {};
    finalEncrypted = finalOptions.encrypted || false;
    finalRequireAuth = finalOptions.requireAuthOnAccess || false;
  }

  const adapter = dbManager.getDbInstance(finalEncrypted, finalRequireAuth);
  return adapter.clearTable(tableName);
};

// 自动同步相关类型定义

/**
 * 同步统计信息
 */
export interface SyncStats {
  /** 同步次数 */
  syncCount: number;
  /** 总共同步的项目数 */
  totalItemsSynced: number;
  /** 上次同步时间戳 */
  lastSyncTime: number;
  /** 平均同步时间（毫秒） */
  avgSyncTime: number;
}

/**
 * 自动同步配置
 */
export interface AutoSyncConfig {
  /** 是否启用自动同步 */
  enabled: boolean;
  /** 同步间隔（毫秒） */
  interval: number;
  /** 最小同步项目数 */
  minItems: number;
  /** 每次同步的批量大小 */
  batchSize: number;
}

/**
 * 获取同步统计信息
 * @returns SyncStats 同步统计信息
 */
export function getSyncStats(): SyncStats {
  // 获取真实的同步统计信息
  const storageAdapter = plainStorage as any;
  if (storageAdapter.autoSyncService && typeof storageAdapter.autoSyncService.getStats === 'function') {
    return storageAdapter.autoSyncService.getStats();
  }

  // 如果无法获取真实统计信息，返回默认值
  return {
    syncCount: 0,
    totalItemsSynced: 0,
    lastSyncTime: Date.now(),
    avgSyncTime: 0,
  };
}

/**
 * 立即触发同步
 * @returns Promise<void>
 */
export async function syncNow(): Promise<void> {
  // 触发真实的同步操作
  const storageAdapter = plainStorage as any;
  if (storageAdapter.autoSyncService && typeof storageAdapter.autoSyncService.sync === 'function') {
    await storageAdapter.autoSyncService.sync();
  }
}

/**
 * 设置自动同步配置
 * @param config 自动同步配置
 */
export function setAutoSyncConfig(config: Partial<AutoSyncConfig>): void {
  // 更新真实的同步配置
  const storageAdapter = plainStorage as any;
  if (storageAdapter.autoSyncService && typeof storageAdapter.autoSyncService.updateConfig === 'function') {
    storageAdapter.autoSyncService.updateConfig(config);
  }
}

// 导出类型
export type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, CommonOptions, TableOptions, FindOptions, FilterCondition } from './types/storageTypes.js';

export default {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  read,
  countTable,
  verifyCountTable,
  findOne,
  findMany,
  remove,
  bulkWrite,
  beginTransaction,
  commit,
  rollback,
  migrateToChunked,
  clearTable,
  update,
  // 自动同步相关方法
  getSyncStats,
  syncNow,
  setAutoSyncConfig,
} as const;
