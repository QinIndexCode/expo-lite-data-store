/** Public Expo Lite Data Store API. */
import { plainStorage, dbManager } from './core/db';
import type { IStorageAdapter } from './types/storageAdapterInfc';
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
import { migrateEngine, EngineMigrationService } from './core/service/EngineMigrationService';
export type { MigrateEngineOptions, MigrationResult } from './core/service/EngineMigrationService';

const normalizeSecurity = (opts?: {
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
  encryptFullTable?: boolean;
  encryptedFields?: string[];
}) => {
  const requireAuthOnAccess = opts?.requireAuthOnAccess ?? false;
  // Per-access authentication is meaningful only for encrypted storage. Do not
  // let an explicit encrypted:false or full-table mode silently route this request
  // to plain storage.
  const encrypted =
    requireAuthOnAccess ||
    opts?.encrypted === true ||
    opts?.encryptFullTable === true ||
    (opts?.encryptedFields?.length ?? 0) > 0;
  return { encrypted, requireAuthOnAccess };
};

/**
 * An empty `encryptedFields` list is createTable's "dynamic all-fields" input,
 * not a write-path field policy. On the write paths the empty list resolves to
 * the plain surface (normalizeSecurity treats it as no request) while still
 * carrying `encryptedFields: []` into implicit table metadata, which would
 * persist an encrypted-looking policy for a plaintext payload. Reject it up
 * front unless another option already selects an encrypted surface.
 */
const assertWriteEncryptedFields = (
  tableName: string,
  options?: CommonOptions & { encryptFullTable?: boolean; encryptedFields?: string[] }
): void => {
  if (
    options?.encryptedFields === undefined ||
    options.encryptedFields.length > 0 ||
    options.encrypted === true ||
    options.encryptFullTable === true ||
    options.requireAuthOnAccess === true
  ) {
    return;
  }

  throw new StorageError(
    `Invalid encryptedFields for table '${tableName}': an empty list is a createTable option, not a write option`,
    'FILE_CONTENT_INVALID',
    {
      details:
        'A write with encryptedFields: [] and no other encryption option selects the plaintext surface, so it would persist plaintext while recording an empty encrypted field policy.',
      suggestion:
        'Create the dynamic all-fields table first with createTable(table, { encrypted: true, encryptedFields: [] }), then write with encrypted: true; or pass a non-empty encryptedFields list.',
      tableName,
    }
  );
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
  /** Fields that require encryption for this write (selects the encrypted surface and validates against the persisted table policy). */
  encryptedFields?: string[];
};

let activeTransactionSecurity: TransactionSecurity | null = null;
let activeTransactionAdapter: IStorageAdapter | null = null;
const tablePolicyLocks = new Map<string, Promise<void>>();

const hasExplicitSecurityOptions = (
  options?: CommonOptions & { encryptFullTable?: boolean; encryptedFields?: string[] }
): boolean =>
  !!options &&
  (Object.prototype.hasOwnProperty.call(options, 'encrypted') ||
    Object.prototype.hasOwnProperty.call(options, 'requireAuthOnAccess') ||
    Object.prototype.hasOwnProperty.call(options, 'encryptFullTable') ||
    Object.prototype.hasOwnProperty.call(options, 'encryptedFields'));

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
  getTableMeta?: (tableName: string) =>
    | {
        encrypted?: boolean;
        encryptFullTable?: boolean;
        encryptedFields?: string[];
        requireAuthOnAccess?: boolean;
      }
    | undefined;
  listTables?: () => Promise<string[]>;
};

const getMetadataInspector = (): TableMetadataInspector => {
  const defaultInst = dbManager.getDefaultInstance() as unknown as TableMetadataInspector;
  if (typeof defaultInst?.getTableMeta === 'function') {
    return defaultInst;
  }
  return plainStorage as typeof plainStorage & TableMetadataInspector;
};

const assertTableAccessPolicy = async (tableName: string, security: TransactionSecurity): Promise<void> => {
  const inspector = getMetadataInspector();
  await inspector.ensureInitialized?.();
  const tableMeta = inspector.getTableMeta?.(tableName);

  const requiresEncryption =
    tableMeta?.encrypted === true ||
    tableMeta?.encryptFullTable === true ||
    (tableMeta?.encryptedFields?.length ?? 0) > 0 ||
    tableMeta?.requireAuthOnAccess === true;

  if (requiresEncryption && !security.encrypted) {
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

const RESERVED_ENVELOPE_FIELD_NAMES = ['__enc', '__enc_bulk'] as const;

const findReservedEnvelopeField = (value: object): string | undefined =>
  RESERVED_ENVELOPE_FIELD_NAMES.find(name => Object.prototype.hasOwnProperty.call(value, name));

const rejectReservedEnvelopeField = (name: string): never => {
  throw new StorageError(`Invalid data: '${name}' is a reserved envelope field name`, 'FILE_CONTENT_INVALID', {
    details:
      'Records are read back through the encrypted-envelope detection path, so this field name would make every read of the table fail.',
    suggestion: `Rename the '${name}' field before writing.`,
  });
};

/**
 * Rejects reserved envelope field names at the public write entries, before any
 * storage surface resolves. The encrypted adapter repeats this check, but without
 * it a plain-surface write could store an envelope-looking record that later
 * breaks every encrypted-surface read of the table. Update-operator payloads are
 * covered because operators such as `$set` carry their field names as keys.
 */
const assertNoReservedEnvelopeFields = (data: unknown): void => {
  const candidates: unknown[] = Array.isArray(data) ? data : [data];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') {
      continue;
    }
    const reserved = findReservedEnvelopeField(candidate);
    if (reserved) {
      rejectReservedEnvelopeField(reserved);
    }
    for (const [key, value] of Object.entries(candidate) as [string, unknown][]) {
      if (!key.startsWith('$') || value === null || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const nestedReserved = findReservedEnvelopeField(value);
      if (nestedReserved) {
        rejectReservedEnvelopeField(nestedReserved);
      }
    }
  }
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

  const inspector = getMetadataInspector();
  await inspector.ensureInitialized?.();
  const tableNames = (await inspector.listTables?.()) ?? [];
  assertListAccessPolicy(tableNames, resolved, inspector);

  return resolved;
};

const isAdapterInTransaction = (adapter: IStorageAdapter | null): boolean => {
  const candidate = adapter as unknown as { isInTransaction?: () => boolean } | null;
  return typeof candidate?.isInTransaction === 'function' ? candidate.isInTransaction() : false;
};

const clearTransactionSecurityIfSettled = (operationCompleted: boolean): void => {
  // The transaction may live on a different adapter instance than the default
  // one (the SQLite engine creates separate plain/encrypted instances), so the
  // activity check must target the adapter that opened the transaction.
  const inTx = isAdapterInTransaction(activeTransactionAdapter);
  if (operationCompleted || !inTx) {
    activeTransactionSecurity = null;
    activeTransactionAdapter = null;
  }
};

export { configManager, ConfigManager };
export { performanceMonitor };
export type { PerformanceStats, HealthCheckResult };
export { getKeyCacheStats, getKeyCacheHitRate };
export type { KeyCacheStats };
export { CryptoService };

export const init = async (options: TableOptions = {}): Promise<void> => {
  if (options.engine) {
    configManager.updateConfig({ engine: options.engine });
  }
  // Hydrate the persisted engine marker before any adapter resolution so a
  // migration from a previous launch keeps the SQLite engine active.
  await dbManager.loadPersistedEnginePreference();
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
  if (options.initialData) {
    assertNoReservedEnvelopeFields(options.initialData);
  }
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    return adapter.createTable<T>(tableName, {
      ...options,
      encrypted,
      requireAuthOnAccess,
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
    const inspector = getMetadataInspector();
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
  assertNoReservedEnvelopeFields(data);
  assertWriteEncryptedFields(tableName, options);
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    return adapter.insert<T>(tableName, data, { ...options, encrypted, requireAuthOnAccess });
  });
};

/** Replaces all records in a table. */
export const overwrite = async <T extends object = StorageRecord>(
  tableName: string,
  data: StorageInput<NonInfer<T>>,
  options: Omit<WriteOptions, 'mode'> = {}
): Promise<WriteResult> => {
  assertNoReservedEnvelopeFields(data);
  assertWriteEncryptedFields(tableName, options);
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    return adapter.overwrite<T>(tableName, data, { ...options, encrypted, requireAuthOnAccess });
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
  options: WriteOptions = {}
): Promise<WriteResult> => {
  for (const operation of operations) {
    if (operation.type === 'insert' || operation.type === 'update') {
      assertNoReservedEnvelopeFields(operation.data);
    }
  }
  assertWriteEncryptedFields(tableName, options);
  return runTableOperation(tableName, options, ({ encrypted, requireAuthOnAccess, adapter }) =>
    adapter.bulkWrite<T>(tableName, operations, { ...options, encrypted, requireAuthOnAccess })
  );
};

export const beginTransaction = async (options: TableOptions = {}): Promise<void> => {
  // The SQLite engine instantiates separate plain/encrypted adapters, each
  // with its own TransactionService, so per-adapter guards cannot see each
  // other. Enforce single-transaction semantics at the facade level.
  if (activeTransactionSecurity !== null || isAdapterInTransaction(activeTransactionAdapter)) {
    throw new StorageError('Transaction already in progress', 'TRANSACTION_IN_PROGRESS', {
      details: 'Only one active transaction is supported at a time across all storage surfaces.',
      suggestion: 'Commit or roll back the active transaction before starting a new one.',
    });
  }

  const { encrypted, requireAuthOnAccess } = normalizeSecurity(options);
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  // Mark the transaction surface before awaiting begin so concurrent callers
  // observe the pending transaction instead of opening a second one.
  activeTransactionSecurity = { encrypted, requireAuthOnAccess };
  activeTransactionAdapter = adapter;
  try {
    await adapter.beginTransaction(options);
  } catch (error) {
    activeTransactionSecurity = null;
    activeTransactionAdapter = null;
    throw error;
  }
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
  assertNoReservedEnvelopeFields(data);
  assertWriteEncryptedFields(tableName, options);
  return runTableOperation(tableName, options, async ({ encrypted, requireAuthOnAccess, adapter }) => {
    return adapter.update<T>(tableName, data, options.where, { ...options, encrypted, requireAuthOnAccess });
  });
};

export const clearTable = async (tableName: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, ({ adapter }) => adapter.clearTable(tableName));
};

export const createIndex = async (
  tableName: string,
  field: string,
  options: TableOptions & { unique?: boolean } = {}
): Promise<void> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    if (typeof adapter.createIndex === 'function') {
      await adapter.createIndex(tableName, field, options.unique);
    }
  });
};

export const dropIndex = async (tableName: string, field: string, options: TableOptions = {}): Promise<void> => {
  return runTableOperation(tableName, options, async ({ adapter }) => {
    if (typeof adapter.dropIndex === 'function') {
      await adapter.dropIndex(tableName, field);
    }
  });
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
  createIndex,
  dropIndex,
  migrateEngine,
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
  ColumnDefinition,
  SortOrder,
  SortAlgorithm,
  SortField,
  TableMeta,
  Catalog,
} from './types/storageTypes';

export type { IStorageAdapter } from './types/storageAdapterInfc';
export type { IStorageEngine } from './types/storageEngineInfc';

export { StorageError } from './types/storageErrorInfc';
export { StorageErrorCode } from './types/storageErrorCode';
export { TransactionError } from './core/service/TransactionService';
export type { LiteStoreConfig, DeepPartial } from './types/config';
export { CryptoError } from './utils/crypto-errors';
export { encrypt, decrypt, encryptBulk, decryptBulk, hash, resetMasterKey };
export { migrateEngine, EngineMigrationService };

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
  createIndex,
  dropIndex,
  migrateEngine,
} as const;
