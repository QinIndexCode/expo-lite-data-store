// src/expo-lite-data-store.ts
// Expo Lite Data Store 主要API导出文件
// 提供数据库操作的所有公共接口，包括表管理、数据读写、查询、事务等
// 创建于: 2025-11-19
// 最后修改: 2025-12-12
// 直接导入数据库实例
import { db, plainStorage } from './core/db';
// AutoSyncService 类型用于类型检查

/**
 * 数据库实例，支持加密存储
 */
export { db };

/**
 * 普通存储实例，不支持加密
 */
export { plainStorage };

/**
 * 创建表
 * @param tableName 表名
 * @param options 创建表选项
 * @returns Promise<void>
 */
export const createTable = db.createTable.bind(db);

/**
 * 删除表
 * @param tableName 表名
 * @returns Promise<void>
 */
export const deleteTable = db.deleteTable.bind(db);

/**
 * 检查表是否存在
 * @param tableName 表名
 * @returns Promise<boolean>
 */
export const hasTable = db.hasTable.bind(db);

/**
 * 列出所有表
 * @returns Promise<string[]>
 */
export const listTables = db.listTables.bind(db);

/**
 * 插入数据
 * @param tableName 表名
 * @param data 要插入的数据
 * @param options 写入选项
 * @returns Promise<WriteResult>
 */
export const insert = db.write.bind(db);

/**
 * 读取数据
 * @param tableName 表名
 * @param options 读取选项
 * @returns Promise<Record<string, any>[]>
 */
export const read = db.read.bind(db);

/**
 * 统计表数据行数
 * @param tableName 表名
 * @returns Promise<number>
 */
export const countTable = db.count.bind(db);

/**
 * 验证表计数准确性
 * @param tableName 表名
 * @returns Promise<{ metadata: number; actual: number; match: boolean }>
 */
export const verifyCountTable = db.verifyCount.bind(db);

/**
 * 查找单条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @returns Promise<Record<string, any> | null>
 */
export const findOne = db.findOne.bind(db);

/**
 * 查找多条记录
 * @param tableName 表名
 * @param filter 过滤条件
 * @param options 查询选项，包括skip、limit、sortBy、order和sortAlgorithm
 * @returns Promise<Record<string, any>[]>
 */
export const findMany = (
  tableName: string,
  filter?: Record<string, any>,
  options?: {
    skip?: number;
    limit?: number;
    sortBy?: string | string[];
    order?: 'asc' | 'desc' | ('asc' | 'desc')[];
    sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  }
) => db.findMany(tableName, filter, options);

/**
 * 删除数据
 * @param tableName 表名
 * @param where 删除条件
 * @returns Promise<number>
 */
export const remove = db.delete.bind(db);

/**
 * 批量操作
 * @param tableName 表名
 * @param operations 操作数组
 * @returns Promise<WriteResult>
 */
export const bulkWrite = db.bulkWrite.bind(db);

/**
 * 开始事务
 * @returns Promise<void>
 */
export const beginTransaction = db.beginTransaction.bind(db);

/**
 * 提交事务
 * @returns Promise<void>
 */
export const commit = db.commit.bind(db);

/**
 * 回滚事务
 * @returns Promise<void>
 */
export const rollback = db.rollback.bind(db);

/**
 * 迁移表到分片模式
 * @param tableName 表名
 * @returns Promise<void>
 */
export const migrateToChunked = db.migrateToChunked.bind(db);

/**
 * 更新匹配的数据
 * @param tableName 表名
 * @param data 要更新的数据
 * @param where 更新条件，只支持基本的相等匹配
 * @returns Promise<number> 更新的记录数
 */
export const update = db.update.bind(db);

/**
 * 清空表数据
 * @param tableName 表名
 * @returns Promise<void>
 */
export const clearTable = db.clearTable.bind(db);

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
  const storageAdapter = db as any;
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
  const storageAdapter = db as any;
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
  const storageAdapter = db as any;
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
