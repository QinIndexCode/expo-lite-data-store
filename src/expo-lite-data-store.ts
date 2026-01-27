/**
 * Expo Lite Data Store Main API Export File
 * Provides all public interfaces for database operations, including table management, data read/write, queries, transactions, etc.
 * 
 * @module expo-lite-data-store
 * @since 2025-11-19
 * @version 1.0.0
 */
import { plainStorage, dbManager } from './core/db';
import { configManager, ConfigManager } from './core/config/ConfigManager';
import { performanceMonitor } from './core/monitor/PerformanceMonitor';
import { getKeyCacheStats, getKeyCacheHitRate } from './utils/crypto';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, TableOptions } from './types/storageTypes';
import type { PerformanceStats, HealthCheckResult } from './core/monitor/PerformanceMonitor';
import type { KeyCacheStats } from './utils/crypto';
import * as CryptoService from './services/CryptoService';

const normalizeSecurity = (opts?: { encrypted?: boolean; requireAuthOnAccess?: boolean }) => {
  const requireAuthOnAccess = opts?.requireAuthOnAccess ?? false;
  const encrypted = opts?.encrypted ?? (requireAuthOnAccess ? true : false);
  return { encrypted, requireAuthOnAccess };
};

/**
 * Plain storage instance, no encryption support
 */
export { plainStorage };

/**
 * Configuration management
 */
export { configManager, ConfigManager };

/**
 * Performance monitoring
 */
export { performanceMonitor };
export type { PerformanceStats, HealthCheckResult };

/**
 * Encryption performance monitoring
 */
export { getKeyCacheStats, getKeyCacheHitRate };
export type { KeyCacheStats };
export { CryptoService };

/**
 * Create table
 * @param tableName Table name
 * @param options Create table options, including common options and table-specific options
 * @returns Promise<void>
 */
export const createTable = async (
  tableName: string,
  options: CreateTableOptions = {}
): Promise<void> => {
  const { encryptedFields = [], encryptFullTable = false, ...tableOptions } = options ?? {};
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.createTable(tableName, { 
    ...tableOptions, 
    encrypted, 
    requireAuthOnAccess, 
    encryptedFields, 
    encryptFullTable 
  });
};

/**
 * Delete table
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const deleteTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.deleteTable(tableName, options);
};

/**
 * Check if table exists
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<boolean>
 */
export const hasTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<boolean> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.hasTable(tableName, options);
};

/**
 * List all tables
 * @param options Operation options, including common options
 * @returns Promise<string[]>
 */
export const listTables = async (
  options: TableOptions = {}
): Promise<string[]> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.listTables(options);
};

/**
 * Insert data (always uses append mode)
 * 
 * 功能定位：专门用于向表中追加新数据，不支持覆盖
 * 
 * 使用场景：
 *   - 初始化数据导入
 *   - 日志记录
 *   - 事件追踪
 *   - 需要保证数据不被覆盖的场景
 * 
 * 与write的区别：
 *   - insert：固定为追加模式，不支持覆盖
 *   - write：支持追加和覆盖两种模式
 * 
 * @param tableName Table name
 * @param data Data to insert (single record or array of records)
 * @param options Write options, including common options
 * @returns Promise<WriteResult> Write result with written bytes, total bytes, and chunking info
 */
export const insert = async (
  tableName: string,
  data: Record<string, any> | Record<string, any>[],
  options: WriteOptions = {}
): Promise<WriteResult> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const { ...finalWriteOptions } = options ?? {};
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.insert(tableName, data, finalWriteOptions);
};

/**
 * Overwrite data (always uses overwrite mode)
 * 
 * 功能定位：专门用于覆盖表中的数据
 * 
 * 使用场景：
 *   - 完全替换表数据
 *   - 数据同步
 *   - 缓存刷新
 *   - 批量数据更新
 *   - 初始化表数据
 * 
 * 与insert的区别：
 *   - insert：追加模式，保留现有数据
 *   - overwrite：覆盖模式，替换所有数据
 * 
 * @param tableName Table name
 * @param data Data to overwrite (single record or array of records)
 * @param options Write options, excluding mode (always uses overwrite mode), and common options
 * @returns Promise<WriteResult> Write result with written bytes, total bytes, and chunking info
 */
export const overwrite = async (
  tableName: string,
  data: Record<string, any> | Record<string, any>[],
  options: Omit<WriteOptions, 'mode'> = {}
): Promise<WriteResult> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options as any);
  const { ...finalWriteOptions } = options ?? {};
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.overwrite(tableName, data, finalWriteOptions);
};

/**
 * Read all data from table
 * 
 * 功能定位：直接从表中读取所有数据，不处理查询条件、排序和分页
 * 
 * 使用场景：
 *   - 需要获取表中所有数据的场景
 *   - 简单的数据读取操作
 *   - 作为底层API被其他查询方法调用
 *   - 对性能要求较高的场景
 * 
 * 与findMany的区别：
 *   - read：直接调用底层存储读取数据，性能更高，不支持查询条件、排序和分页
 *   - findMany：先读取所有数据，然后在内存中处理查询条件、排序和分页，功能更全面但性能相对较低
 * 
 * @param tableName Table name
 * @param options Read options, including common options
 * @returns Promise<Record<string, any>[]> Array of records
 */
export const read = async (
  tableName: string,
  options: ReadOptions = {}
): Promise<Record<string, any>[]> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  const { ...readOptions } = options ?? {};
  delete readOptions.filter;
  delete readOptions.skip;
  delete readOptions.limit;
  delete readOptions.sortBy;
  delete readOptions.order;
  delete readOptions.sortAlgorithm;
  return adapter.read(tableName, readOptions);
};

/**
 * Count table data rows
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<number>
 */
export const countTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<number> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.count(tableName);
};

/**
 * Verify table count accuracy
 * 
 * 功能定位：数据一致性诊断工具
 * 
 * 使用场景：
 *   - 数据一致性诊断：验证元数据与实际数据是否一致
 *   - 故障排查：诊断数据不一致问题
 *   - 数据修复：自动修复元数据中的计数错误
 *   - 元数据同步：定期检查和维护数据一致性
 * 
 * 与countTable的区别：
 *   - countTable：获取当前记录数（快速，直接从元数据读取）
 *   - verifyCountTable：验证并修复数据一致性（较慢，需要扫描实际数据）
 * 
 * 最佳实践：
 *   - 仅在诊断数据问题时使用
 *   - 定期维护任务中使用（如每天检查一次）
 *   - 不在常规业务流程中使用，以避免性能开销
 * 
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<{ metadata: number; actual: number; match: boolean }> Comparison result with metadata count, actual count, and match status
 */
export const verifyCountTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<{ metadata: number; actual: number; match: boolean }> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.verifyCount(tableName);
};

/**
 * Find a single record that matches the specified criteria.
 * 
 * @param tableName Table name to search in
 * @param options Query options including filter criteria and security settings
 * @param options.where Filter condition to match records against
 * @param options.encrypted Whether to use encrypted storage (defaults to false)
 * @param options.requireAuthOnAccess Whether biometric authentication is required for access (defaults to false)
 * @returns Promise<Record<string, any> | null> Found record or null if no match
 * 
 * @example
 * ```typescript
 * const user = await findOne('users', {
 *   where: { id: '123' },
 *   encrypted: true
 * });
 * ```
 */
export const findOne = async (
  tableName: string,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<Record<string, any> | null> => {
  const { where } = options ?? {};
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findOne(tableName, where, options);
};

/**
 * Find multiple records that match the specified criteria.
 * 
 * @param tableName Table name to search in
 * @param options Query options including filter criteria, pagination, sorting, and security settings
 * @param options.where Filter condition to match records against (defaults to {})
 * @param options.skip Number of records to skip for pagination (defaults to 0)
 * @param options.limit Maximum number of records to return (defaults to unlimited)
 * @param options.sortBy Field or fields to sort by
 * @param options.order Sort order (asc/desc) for each sort field
 * @param options.sortAlgorithm Custom sort algorithm to use
 * @param options.encrypted Whether to use encrypted storage (defaults to false)
 * @param options.requireAuthOnAccess Whether biometric authentication is required for access (defaults to false)
 * @returns Promise<Record<string, any>[]> Array of matching records
 * 
 * @example
 * ```typescript
 * const users = await findMany('users', {
 *   where: { age: { $gt: 18 } },
 *   skip: 10,
 *   limit: 20,
 *   sortBy: 'createdAt',
 *   order: 'desc',
 *   encrypted: true
 * });
 * ```
 */
export const findMany = async (
  tableName: string,
  options?: {
    where?: Record<string, any>,
    skip?: number,
    limit?: number,
    sortBy?: string | string[],
    order?: 'asc' | 'desc' | Array<'asc' | 'desc'>,
    sortAlgorithm?: any,
    encrypted?: boolean,
    requireAuthOnAccess?: boolean
  }
): Promise<Record<string, any>[]> => {
  const { where = {}, skip, limit, sortBy, order, sortAlgorithm } = options ?? {};
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);

  // Extract query-specific options, exclude common options
  const finalFindOptions = {
    skip,
    limit,
    sortBy,
    order,
    sortAlgorithm
  };

  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findMany(tableName, where, finalFindOptions, options);
};

/**
 * Delete records that match the specified criteria.
 * 
 * @param tableName Table name to delete records from
 * @param options Delete options including filter criteria and security settings
 * @param options.where Filter condition to match records for deletion
 * @param options.encrypted Whether to use encrypted storage (defaults to false)
 * @param options.requireAuthOnAccess Whether biometric authentication is required for access (defaults to false)
 * @returns Promise<number> Number of records deleted
 * 
 * @example
 * ```typescript
 * const deletedCount = await remove('users', {
 *   where: { id: '123' },
 *   encrypted: true
 * });
 * ```
 */
export const remove = async (
  tableName: string,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<number> => {
  const { where } = options ?? {};
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.delete(tableName, where, options);
};

/**
 * Bulk operations
 * 
 * 功能定位：批量执行多个操作（插入、更新、删除）
 * 
 * 使用场景：
 *   - 批量数据导入
 *   - 批量数据更新
 *   - 批量数据删除
 *   - 复杂的数据处理流程
 * 
 * 操作类型说明：
 *   - insert: 插入数据，只需要data参数
 *   - update: 更新数据，需要data和where参数
 *   - delete: 删除数据，只需要where参数
 * 
 * @param tableName Table name
 * @param operations Array of operations, using union types for type safety
 * @param options Operation options, including common options
 * @returns Promise<WriteResult> Write result with written bytes, total bytes, and chunking info
 */
export const bulkWrite = async (
  tableName: string,
  operations: Array<
    | {
        type: 'insert';
        data: Record<string, any> | Record<string, any>[];
      }
    | {
        type: 'update';
        data: Record<string, any>;
        where: Record<string, any>;
      }
    | {
        type: 'delete';
        where: Record<string, any>;
      }
  >,
  options: TableOptions = {}
): Promise<WriteResult> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.bulkWrite(tableName, operations);
};

/**
 * Begin transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const beginTransaction = async (
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.beginTransaction(options);
};

/**
 * Commit transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const commit = async (
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.commit(options);
};

/**
 * Rollback transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const rollback = async (
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.rollback(options);
};

/**
 * Migrate table to chunked mode
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const migrateToChunked = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.migrateToChunked(tableName);
};

/**
 * Update records that match the specified criteria.
 * 
 * @param tableName Table name to update records in
 * @param data Update data to apply to matching records
 * @param options Update options including filter criteria and security settings
 * @param options.where Filter condition to match records for updating
 * @param options.encrypted Whether to use encrypted storage (defaults to false)
 * @param options.requireAuthOnAccess Whether biometric authentication is required for access (defaults to false)
 * @returns Promise<number> Number of records updated
 * 
 * @example
 * ```typescript
 * const updatedCount = await update('users', {
 *   name: 'Updated Name',
 *   email: 'updated@example.com'
 * }, {
 *   where: { id: '123' },
 *   encrypted: true
 * });
 * ```
 */
export const update = async (
  tableName: string,
  data: Record<string, any>,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<number> => {
  const { where } = options ?? {};
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.update(tableName, data, where, options);
};

/**
 * Clear all data from the specified table.
 * 
 * @param tableName Table name to clear
 * @param options Clear options including security settings
 * @param options.encrypted Whether to use encrypted storage (defaults to false)
 * @param options.requireAuthOnAccess Whether biometric authentication is required for access (defaults to false)
 * @returns Promise<void>
 * 
 * @example
 * ```typescript
 * await clearTable('users', {
 *   encrypted: true,
 *   requireAuthOnAccess: true
 * });
 * ```
 */
export const clearTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.clearTable(tableName);
};



// Export types
export type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, CommonOptions, TableOptions, FindOptions, FilterCondition } from './types/storageTypes';

export default {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  overwrite,
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
} as const;
