// src/expo-lite-data-store.ts
// Expo Lite Data Store 主要API导出文件
// 提供数据库操作的所有公共接口，包括表管理、数据读写、查询、事务等
// 创建于: 2025-11-19
// 最后修改: 2025-12-16
// 直接导入数据库实例
import { plainStorage, dbManager } from './core/db';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from './types/storageTypes';
// AutoSyncService 类型用于类型检查

/**
 * 普通存储实例，不支持加密
 */
export { plainStorage };

/**
 * 创建表
 * @param tableName 表名
 * @param options 创建表选项
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const createTable = async (
  tableName: string,
  options?: CreateTableOptions & {
    columns?: Record<string, string>;
    initialData?: Record<string, any>[];
    mode?: 'single' | 'chunked';
  },
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.createTable(tableName, options);
};

/**
 * 删除表
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const deleteTable = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.deleteTable(tableName);
};

/**
 * 检查表是否存在
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<boolean>
 */
export const hasTable = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<boolean> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.hasTable(tableName);
};

/**
 * 列出所有表
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<string[]>
 */
export const listTables = async (
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<string[]> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.listTables();
};

/**
 * 插入数据
 * @param tableName 表名
 * @param data 要插入的数据
 * @param options 写入选项
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<WriteResult>
 */
export const insert = async (
  tableName: string,
  data: Record<string, any> | Record<string, any>[],
  options?: WriteOptions,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<WriteResult> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.write(tableName, data, options);
};

/**
 * 读取数据
 * @param tableName 表名
 * @param options 读取选项
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<Record<string, any>[]>
 */
export const read = async (
  tableName: string,
  options?: ReadOptions,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<Record<string, any>[]> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.read(tableName, options);
};

/**
 * 统计表数据行数
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<number>
 */
export const countTable = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<number> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.count(tableName);
};

/**
 * 验证表计数准确性
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<{ metadata: number; actual: number; match: boolean }>
 */
export const verifyCountTable = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<{ metadata: number; actual: number; match: boolean }> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.verifyCount(tableName);
};

/**
 * 查找单条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<Record<string, any> | null>
 */
export const findOne = async (
  tableName: string,
  filter: Record<string, any>,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<Record<string, any> | null> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findOne(tableName, filter);
};

/**
 * 查找多条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @param options 查询选项，包括skip、limit、sortBy、order和sortAlgorithm
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<Record<string, any>[]>
 */
export const findMany = async (
  tableName: string,
  filter?: Record<string, any>,
  options?: {
    skip?: number;
    limit?: number;
    sortBy?: string | string[];
    order?: 'asc' | 'desc' | ('asc' | 'desc')[];
    sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  },
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<Record<string, any>[]> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findMany(tableName, filter, options);
};

/**
 * 删除数据
 * @param tableName 表名
 * @param where 删除条件
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<number>
 */
export const remove = async (
  tableName: string,
  where: Record<string, any>,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<number> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.delete(tableName, where);
};

/**
 * 批量操作
 * @param tableName 表名
 * @param operations 操作数组
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<WriteResult>
 */
export const bulkWrite = async (
  tableName: string,
  operations: Array<{
    type: 'insert' | 'update' | 'delete';
    data: Record<string, any> | Record<string, any>[];
  }>,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<WriteResult> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.bulkWrite(tableName, operations);
};

/**
 * 开始事务
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const beginTransaction = async (
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.beginTransaction();
};

/**
 * 提交事务
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const commit = async (
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.commit();
};

/**
 * 回滚事务
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const rollback = async (
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.rollback();
};

/**
 * 迁移表到分片模式
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const migrateToChunked = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.migrateToChunked(tableName);
};

/**
 * 更新匹配的数据
 * @param tableName 表名
 * @param data 要更新的数据
 * @param where 更新条件，只支持基本的相等匹配
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<number> 更新的记录数
 */
export const update = async (
  tableName: string,
  data: Record<string, any>,
  where: Record<string, any>,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<number> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.update(tableName, data, where);
};

/**
 * 清空表数据
 * @param tableName 表名
 * @param encrypted 是否启用加密存储，默认为 false
 * @param requireAuthOnAccess 是否需要生物识别验证，默认为 false
 * @returns Promise<void>
 */
export const clearTable = async (
  tableName: string,
  encrypted: boolean = false,
  requireAuthOnAccess: boolean = false
): Promise<void> => {
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
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
export type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from './types/storageTypes.js';

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
