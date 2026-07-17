/**
 * Expo Lite Data Store Main API Export File
 * Provides all public interfaces for database operations, including table management, data read/write, queries, transactions, etc.
 *
 * @module expo-lite-data-store
 * @since 2025-11-19
 * @version 3.0.0
 */
import { plainStorage, dbManager } from './core/db';
import { configManager, ConfigManager } from './core/config/ConfigManager';
import { performanceMonitor } from './core/monitor/PerformanceMonitor';
import {
  decrypt,
  decryptBulk,
  encrypt,
  encryptBulk,
  generateHash as hash,
  getKeyCacheHitRate,
  getKeyCacheStats,
  resetMasterKey,
} from './utils/crypto';
import type { CommonOptions, CreateTableOptions, ReadOptions, WriteOptions, WriteResult, TableOptions } from './types/storageTypes';
import type { PerformanceStats, HealthCheckResult } from './core/monitor/PerformanceMonitor';
import type { KeyCacheStats } from './utils/crypto';
import { StorageError } from './types/storageErrorInfc';
import * as CryptoService from './core/crypto/CryptoService';

const normalizeSecurity = (opts?: { encrypted?: boolean; requireAuthOnAccess?: boolean }) => {
  const requireAuthOnAccess = opts?.requireAuthOnAccess ?? false;
  // Per-access authentication is meaningful only for encrypted storage. Do not
  // let an explicit encrypted:false silently route this request to plain storage.
  const encrypted = requireAuthOnAccess || opts?.encrypted === true;
  return { encrypted, requireAuthOnAccess };
};

type TransactionSecurity = ReturnType<typeof normalizeSecurity>;
type ResolvedStorageAdapter = ReturnType<typeof resolveStorageAdapter>;

let activeTransactionSecurity: TransactionSecurity | null = null;
const tablePolicyLocks = new Map<string, Promise<void>>();

const hasExplicitSecurityOptions = (options?: CommonOptions): boolean =>
  !!options &&
  (Object.prototype.hasOwnProperty.call(options, 'encrypted') ||
    Object.prototype.hasOwnProperty.call(options, 'requireAuthOnAccess'));

const matchesTransactionSecurity = (left: TransactionSecurity, right: TransactionSecurity): boolean =>
  left.encrypted === right.encrypted && left.requireAuthOnAccess === right.requireAuthOnAccess;

/**
 * A transaction is shared by the underlying storage singleton, so every public
 * operation must use the security facade that opened it. This prevents a later
 * call with omitted or weaker options from queueing plaintext or committing
 * without the required access authentication.
 */
const resolveStorageAdapter = (options?: CommonOptions) => {
  const requestedSecurity = normalizeSecurity(options);
  const security = activeTransactionSecurity ?? requestedSecurity;

  if (
    activeTransactionSecurity &&
    hasExplicitSecurityOptions(options) &&
    !matchesTransactionSecurity(requestedSecurity, activeTransactionSecurity)
  ) {
    throw new Error('Transaction security options must match the active transaction');
  }

  return {
    ...security,
    adapter: dbManager.getDbInstance(security.encrypted, security.requireAuthOnAccess),
  };
};

/**
 * Serializes public operations for one table from policy resolution through the
 * underlying adapter call. This closes the window where a table can become
 * encrypted after a plain caller has already passed its policy check.
 */
const withTablePolicyLock = async <T>(tableName: string, operation: () => Promise<T>): Promise<T> => {
  const previous = tablePolicyLocks.get(tableName);
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve;
  });
  const queued = previous ? previous.then(() => current) : current;
  tablePolicyLocks.set(tableName, queued);

  if (previous) {
    await previous;
  }

  try {
    return await operation();
  } finally {
    releaseCurrent?.();
    if (tablePolicyLocks.get(tableName) === queued) {
      tablePolicyLocks.delete(tableName);
    }
  }
};

type TableMetadataInspector = {
  ensureInitialized?: () => Promise<void>;
  getTableMeta?: (tableName: string) => { encrypted?: boolean; requireAuthOnAccess?: boolean } | undefined;
  listTables?: () => Promise<string[]>;
};

const assertTableAccessPolicy = async (tableName: string, security: TransactionSecurity): Promise<void> => {
  const inspector = plainStorage as typeof plainStorage & TableMetadataInspector;
  await inspector.ensureInitialized?.();
  const tableMeta = inspector.getTableMeta?.(tableName);

  if (tableMeta?.encrypted === true && !security.encrypted) {
    throw new StorageError(
      `Table '${tableName}' requires encrypted storage access`,
      'PERMISSION_DENIED',
      {
        details: 'The table is encrypted and cannot be accessed through the plain storage facade.',
        suggestion: 'Repeat the operation with encrypted: true.',
        tableName,
      }
    );
  }

  if (tableMeta?.requireAuthOnAccess === true && !security.requireAuthOnAccess) {
    throw new StorageError(
      `Table '${tableName}' requires strict access authentication`,
      'PERMISSION_DENIED',
      {
        details: 'The table is bound to the requireAuthOnAccess key scope.',
        suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
        tableName,
      }
    );
  }
};

const resolveTableStorageAdapter = async (tableName: string, options?: CommonOptions) => {
  const resolved = resolveStorageAdapter(options);
  await assertTableAccessPolicy(tableName, resolved);
  return resolved;
};

const runTableOperation = async <T>(
  tableName: string,
  options: CommonOptions | undefined,
  operation: (resolved: ResolvedStorageAdapter) => Promise<T>
): Promise<T> => withTablePolicyLock(tableName, async () => operation(await resolveTableStorageAdapter(tableName, options)));

const assertListAccessPolicy = (
  tableNames: string[],
  security: TransactionSecurity,
  inspector: TableMetadataInspector
): void => {
  if (security.requireAuthOnAccess) {
    return;
  }

  const hasStrictTable = tableNames.some(tableName => inspector.getTableMeta?.(tableName)?.requireAuthOnAccess === true);
  if (hasStrictTable) {
    throw new StorageError('Listing tables requires strict access authentication', 'PERMISSION_DENIED', {
      details: 'At least one table is bound to the requireAuthOnAccess key scope.',
      suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
    });
  }
};

const resolveListStorageAdapter = async (options?: CommonOptions) => {
  const resolved = resolveStorageAdapter(options);
  if (resolved.requireAuthOnAccess) {
    return resolved;
  }

  const inspector = plainStorage as typeof plainStorage & TableMetadataInspector;
  await inspector.ensureInitialized?.();
  const tableNames = (await inspector.listTables?.()) ?? [];
  assertListAccessPolicy(tableNames, resolved, inspector);

  return resolved;
};

const clearTransactionSecurityIfSettled = (operationCompleted: boolean): void => {
  if (operationCompleted || !plainStorage.isInTransaction()) {
    activeTransactionSecurity = null;
  }
};

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

export const init = async (options: TableOptions = {}): Promise<void> => {
  const { adapter: baseAdapter } = resolveStorageAdapter(options);
  const adapter = baseAdapter as typeof baseAdapter & { ensureInitialized?: () => Promise<void> };

  if (typeof adapter.ensureInitialized === 'function') {
    await adapter.ensureInitialized();
    return;
  }

  await adapter.listTables?.(options);
};

/**
 * Create table
 * @param tableName Table name
 * @param options Create table options, including common options and table-specific options
 * @returns Promise<void>
 */
export const createTable = async (tableName: string, options: CreateTableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    const { encryptedFields = [], encryptFullTable = false, ...tableOptions } = options ?? {};
    return adapter.createTable(tableName, {
      ...tableOptions,
      encrypted,
      requireAuthOnAccess,
      encryptedFields,
      encryptFullTable,
    });
  });
};

/**
 * Delete table
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const deleteTable = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.deleteTable(tableName, options));
};

/**
 * Check if table exists
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<boolean>
 */
export const hasTable = async (tableName: string, options: TableOptions = {}): Promise<boolean> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.hasTable(tableName, options));
};

/**
 * List all tables
 * @param options Operation options, including common options
 * @returns Promise<string[]>
 */
export const listTables = async (options: TableOptions = {}): Promise<string[]> => {
  const resolved = await resolveListStorageAdapter(options);
  const tableNames = await resolved.adapter.listTables(options);
  if (!resolved.requireAuthOnAccess) {
    const inspector = plainStorage as typeof plainStorage & TableMetadataInspector;
    await inspector.ensureInitialized?.();
    assertListAccessPolicy(tableNames, resolved, inspector);
  }
  return tableNames;
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
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { ...finalWriteOptions } = options ?? {};
    return adapter.insert(tableName, data, finalWriteOptions);
  });
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
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { ...finalWriteOptions } = options ?? {};
    return adapter.overwrite(tableName, data, finalWriteOptions);
  });
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
export const read = async (tableName: string, options: ReadOptions = {}): Promise<Record<string, any>[]> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { ...readOptions } = options ?? {};
    delete readOptions.filter;
    delete readOptions.skip;
    delete readOptions.limit;
    delete readOptions.sortBy;
    delete readOptions.order;
    delete readOptions.sortAlgorithm;
    return adapter.read(tableName, readOptions);
  });
};

/**
 * Count table data rows
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<number>
 */
export const countTable = async (tableName: string, options: TableOptions = {}): Promise<number> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.count(tableName));
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
  return runTableOperation(tableName, options, ({ adapter }) => adapter.verifyCount(tableName));
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
  options: { where: Record<string, any>; encrypted?: boolean; requireAuthOnAccess?: boolean }
): Promise<Record<string, any> | null> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { where } = options ?? {};
    return adapter.findOne(tableName, where, options);
  });
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
    where?: Record<string, any>;
    skip?: number;
    limit?: number;
    sortBy?: string | string[];
    order?: 'asc' | 'desc' | Array<'asc' | 'desc'>;
    sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
    encrypted?: boolean;
    requireAuthOnAccess?: boolean;
  }
): Promise<Record<string, any>[]> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { where = {}, skip, limit, sortBy, order, sortAlgorithm } = options ?? {};

    // Extract query-specific options, exclude common options
    const finalFindOptions = {
      skip,
      limit,
      sortBy,
      order,
      sortAlgorithm,
    };

    return adapter.findMany(tableName, where, finalFindOptions, options);
  });
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
  options: { where: Record<string, any>; encrypted?: boolean; requireAuthOnAccess?: boolean }
): Promise<number> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { where } = options ?? {};
    return adapter.delete(tableName, where, options);
  });
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
  return runTableOperation(tableName, options, ({ adapter }) => adapter.bulkWrite(tableName, operations));
};

/**
 * Begin transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const beginTransaction = async (options: TableOptions = {}): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  await adapter.beginTransaction(options);
  activeTransactionSecurity = { encrypted, requireAuthOnAccess };
};

/**
 * Commit transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const commit = async (options: TableOptions = {}): Promise<void> => {
  const { adapter } = resolveStorageAdapter(options);
  let operationCompleted = false;

  try {
    await adapter.commit(options);
    operationCompleted = true;
  } finally {
    clearTransactionSecurityIfSettled(operationCompleted);
  }
};

/**
 * Rollback transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const rollback = async (options: TableOptions = {}): Promise<void> => {
  const { adapter } = resolveStorageAdapter(options);
  let operationCompleted = false;

  try {
    await adapter.rollback(options);
    operationCompleted = true;
  } finally {
    clearTransactionSecurityIfSettled(operationCompleted);
  }
};

/**
 * Migrate table to chunked mode
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const migrateToChunked = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.migrateToChunked(tableName));
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
  options: { where: Record<string, any>; encrypted?: boolean; requireAuthOnAccess?: boolean }
): Promise<number> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { where } = options ?? {};
    return adapter.update(tableName, data, where, options);
  });
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
export const clearTable = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.clearTable(tableName));
};

export const db = {
  init,
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

// Export types
export type {
  CreateTableOptions,
  ReadOptions,
  WriteOptions,
  WriteResult,
  CommonOptions,
  TableOptions,
  FindOptions,
  FilterCondition,
} from './types/storageTypes';

export { StorageError } from './types/storageErrorInfc';
export { StorageErrorCode } from './types/storageErrorCode';
export type { LiteStoreConfig, DeepPartial } from './types/config';
export { CryptoError } from './utils/crypto-errors';
export { encrypt, decrypt, encryptBulk, decryptBulk, hash, resetMasterKey };

export default {
  init,
  db,
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
  encrypt,
  decrypt,
  encryptBulk,
  decryptBulk,
  hash,
  resetMasterKey,
} as const;
