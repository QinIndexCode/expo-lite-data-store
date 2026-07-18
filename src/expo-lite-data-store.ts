/** Public Expo Lite Data Store API. */
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
import type {
  BulkOperation,
  CommonOptions,
  CreateTableOptions,
  FilterCondition,
  FindOptions,
  NonInfer,
  ReadOptions,
  StorageInput,
  StorageRecord,
  TableOptions,
  UpdatePayload,
  WriteOptions,
  WriteResult,
} from './types/storageTypes';
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

export type FindOneOptions<T extends object = StorageRecord> = CommonOptions & {
  where: FilterCondition<NonInfer<T>>;
};

export type FindManyOptions<T extends object = StorageRecord> = FindOptions<NonInfer<T>> & {
  where?: FilterCondition<NonInfer<T>>;
};

export type UpdateOptions<T extends object = StorageRecord> = CommonOptions & {
  where: FilterCondition<NonInfer<T>>;
};

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
    throw new StorageError(`Table '${tableName}' requires encrypted storage access`, 'PERMISSION_DENIED', {
      details: 'The table is encrypted and cannot be accessed through the plain storage facade.',
      suggestion: 'Repeat the operation with encrypted: true.',
      tableName,
    });
  }

  if (tableMeta?.requireAuthOnAccess === true && !security.requireAuthOnAccess) {
    throw new StorageError(`Table '${tableName}' requires strict access authentication`, 'PERMISSION_DENIED', {
      details: 'The table is bound to the requireAuthOnAccess key scope.',
      suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
      tableName,
    });
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
): Promise<T> =>
  withTablePolicyLock(tableName, async () => operation(await resolveTableStorageAdapter(tableName, options)));

const assertListAccessPolicy = (
  tableNames: string[],
  security: TransactionSecurity,
  inspector: TableMetadataInspector
): void => {
  if (security.requireAuthOnAccess) {
    return;
  }

  const hasStrictTable = tableNames.some(
    tableName => inspector.getTableMeta?.(tableName)?.requireAuthOnAccess === true
  );
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

export { configManager, ConfigManager };
export { performanceMonitor };
export type { PerformanceStats, HealthCheckResult };
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

export const createTable = async <T extends object = StorageRecord>(
  tableName: string,
  options: CreateTableOptions<NonInfer<T>> = {}
): Promise<void> => {
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    const { encryptedFields = [], encryptFullTable = false, ...tableOptions } = options ?? {};
    return adapter.createTable<T>(tableName, {
      ...tableOptions,
      encrypted,
      requireAuthOnAccess,
      encryptedFields,
      encryptFullTable,
    });
  });
};

export const deleteTable = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.deleteTable(tableName, options));
};

export const hasTable = async (tableName: string, options: TableOptions = {}): Promise<boolean> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.hasTable(tableName, options));
};

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

/** Appends records without replacing existing table contents. */
export const insert = async <T extends object = StorageRecord>(
  tableName: string,
  data: StorageInput<NonInfer<T>>,
  options: WriteOptions = {}
): Promise<WriteResult> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    return adapter.insert<T>(tableName, data, options);
  });
};

/** Replaces all records in a table. */
export const overwrite = async <T extends object = StorageRecord>(
  tableName: string,
  data: StorageInput<NonInfer<T>>,
  options: Omit<WriteOptions, 'mode'> = {}
): Promise<WriteResult> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    return adapter.overwrite<T>(tableName, data, options);
  });
};

/** Reads all records and ignores query-specific options. */
export const read = async <T extends object = StorageRecord>(
  tableName: string,
  options: ReadOptions<NonInfer<T>> = {}
): Promise<T[]> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const {
      filter: _filter,
      skip: _skip,
      limit: _limit,
      sortBy: _sortBy,
      order: _order,
      sortAlgorithm: _sortAlgorithm,
      ...readOptions
    } = options;
    return adapter.read<T>(tableName, readOptions);
  });
};

export const countTable = async (tableName: string, options: TableOptions = {}): Promise<number> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.count(tableName));
};

/** Reconciles metadata count with stored records and returns both values. */
export const verifyCountTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<{ metadata: number; actual: number; match: boolean }> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.verifyCount(tableName));
};

/** Returns the first record matching the supplied filter. */
export const findOne = async <T extends object = StorageRecord>(
  tableName: string,
  options: FindOneOptions<T>
): Promise<T | null> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    return adapter.findOne<T>(tableName, options.where, options);
  });
};

/** Returns records matching an optional filter, with sorting and pagination. */
export const findMany = async <T extends object = StorageRecord>(
  tableName: string,
  options?: FindManyOptions<T>
): Promise<T[]> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    const { where = {}, skip, limit, sortBy, order, sortAlgorithm } = options ?? {};

    // Adapters receive query controls separately from security options.
    const finalFindOptions = {
      skip,
      limit,
      sortBy,
      order,
      sortAlgorithm,
    };

    return adapter.findMany<T>(tableName, where, finalFindOptions, options);
  });
};

/** Deletes every record matching the supplied filter. */
export const remove = async <T extends object = StorageRecord>(
  tableName: string,
  options: FindOneOptions<T>
): Promise<number> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    return adapter.delete<T>(tableName, options.where, options);
  });
};

/** Applies typed insert, update, and delete operations as one write. */
export const bulkWrite = async <T extends object = StorageRecord>(
  tableName: string,
  operations: BulkOperation<NonInfer<T>>[],
  options: TableOptions = {}
): Promise<WriteResult> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.bulkWrite<T>(tableName, operations, options));
};

export const beginTransaction = async (options: TableOptions = {}): Promise<void> => {
  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  await adapter.beginTransaction(options);
  activeTransactionSecurity = { encrypted, requireAuthOnAccess };
};

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

export const migrateToChunked = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.migrateToChunked(tableName));
};

/** Updates every record matching the supplied filter. */
export const update = async <T extends object = StorageRecord>(
  tableName: string,
  data: UpdatePayload<NonInfer<T>>,
  options: UpdateOptions<T>
): Promise<number> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    return adapter.update<T>(tableName, data, options.where, options);
  });
};

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

export type {
  CreateTableOptions,
  ReadOptions,
  WriteOptions,
  WriteResult,
  CommonOptions,
  TableOptions,
  FindOptions,
  FilterCondition,
  BulkOperation,
  StorageInput,
  StorageRecord,
  UpdatePayload,
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
