/** Transaction service managing begin, commit, and rollback operations. */

import { QueryEngine } from '../query/QueryEngine';
import {
  isStorageRecord,
  type BulkOperation,
  type CreateTableOptions,
  type FilterCondition,
  type InternalWriteOptions,
  type ReadOptions,
  type StorageInput,
  type StorageRecord,
  type UpdatePayload,
  type WriteResult,
} from '../../types/storageTypes';
import { StorageError } from '../../types/storageErrorInfc';

const internalDirectWriteOption: unique symbol = Symbol('internalDirectWrite');
const encryptAllFieldsOption: unique symbol = Symbol('encryptAllFields');
const logicalRecordCountOption: unique symbol = Symbol('logicalRecordCount');

/** Package-internal adapter entry point for writes serialized with transaction start. */
export const guardedAutoSyncWrite = Symbol('guardedAutoSyncWrite');

export type InternalDirectWriteOptions = {
  readonly [internalDirectWriteOption]?: true;
};

type DynamicFieldEncryptionOptions = {
  readonly [encryptAllFieldsOption]?: true;
};

type LogicalRecordCountOptions = {
  readonly [logicalRecordCountOption]?: number;
};

/** Adds the unforgeable capability required to bypass transaction staging. */
export function withInternalDirectWrite<T extends object>(options: T): T & InternalDirectWriteOptions {
  return {
    ...options,
    [internalDirectWriteOption]: true,
  };
}

/** Checks the module-private direct-write capability without trusting public properties. */
export function hasInternalDirectWrite(options: unknown): boolean {
  return (
    typeof options === 'object' &&
    options !== null &&
    (options as InternalDirectWriteOptions)[internalDirectWriteOption] === true
  );
}

/** Marks a package-internal table policy as encrypting every record field. */
export function withDynamicFieldEncryption<T extends object>(options: T, enabled: boolean): T {
  if (!enabled) {
    return options;
  }
  return {
    ...options,
    [encryptAllFieldsOption]: true,
  };
}

/** Reads the package-internal dynamic field-encryption marker. */
export function hasDynamicFieldEncryption(options: unknown): boolean {
  return (
    typeof options === 'object' &&
    options !== null &&
    (options as DynamicFieldEncryptionOptions)[encryptAllFieldsOption] === true
  );
}

/** Attaches a decorator's logical row count to the physical storage write. */
export function withLogicalRecordCount<T extends object>(options: T, count: number): T {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new StorageError('Invalid internal logical record count', 'FILE_CONTENT_INVALID', {
      details: `Expected a non-negative safe integer, received: ${count}`,
    });
  }
  return {
    ...options,
    [logicalRecordCountOption]: count,
  };
}

/** Reads the decorator-provided logical count without exposing a public option. */
export function getLogicalRecordCount(options: unknown): number | undefined {
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  const count = (options as LogicalRecordCountOptions)[logicalRecordCountOption];
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

/** Carries an internal transaction identity without exposing it in public options. */
export const transactionOwnerOption = Symbol('transactionOwner');

export type TransactionOwnerToken = object;

export type TransactionScopedOptions = {
  [transactionOwnerOption]?: TransactionOwnerToken;
};

/** Internal write policy retained until an implicitly created table is committed. */
export type TransactionWriteOptions = InternalWriteOptions &
  Pick<CreateTableOptions<StorageRecord>, 'encryptedFields'> &
  TransactionScopedOptions &
  InternalDirectWriteOptions;

type TransactionCommitOptions = InternalWriteOptions & InternalDirectWriteOptions;

export function getTransactionOwner(options: unknown): TransactionOwnerToken | undefined {
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  return (options as TransactionScopedOptions)[transactionOwnerOption];
}
/** Reports an invalid transaction lifecycle operation. */
export class TransactionError extends Error {
  code: string;
  details?: string;
  suggestion?: string;

  constructor(message: string, code: string, details?: string, suggestion?: string) {
    super(message);
    this.name = 'TransactionError';
    this.code = code;
    this.details = details;
    this.suggestion = suggestion;
  }
}

export type TransactionOperation =
  | {
      tableName: string;
      type: 'overwrite' | 'write';
      data: StorageRecord[];
      options?: TransactionWriteOptions;
    }
  | {
      tableName: string;
      type: 'delete';
      where: FilterCondition<StorageRecord>;
      options?: TransactionWriteOptions;
    }
  | {
      tableName: string;
      type: 'bulkWrite';
      operations: BulkOperation<StorageRecord>[];
      options?: TransactionWriteOptions;
    }
  | {
      tableName: string;
      type: 'update';
      data: UpdatePayload<StorageRecord>;
      where: FilterCondition<StorageRecord>;
      options?: TransactionWriteOptions;
    };

/** Captures a table's state before its first transaction operation. */
export interface Snapshot {
  tableName: string;
  /** Table contents before the first transaction operation. */
  data: StorageRecord[];
  /** Whether the table existed before the transaction first touched it. */
  existed: boolean;
  /** Persisted logical row count before the transaction first touched the table. */
  logicalRecordCount: number;
}

/** Queues table operations and restores snapshots when a transaction fails. */
export class TransactionService {
  private _isInTransaction = false;
  private operations: TransactionOperation[] = [];
  private snapshots: Map<string, Snapshot> = new Map();
  private transactionData = new Map<string, StorageRecord[]>();
  private transactionOwner: TransactionOwnerToken | undefined;
  private transactionStartTail: Promise<void> = Promise.resolve();

  private async atTransactionStartBoundary<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transactionStartTail;
    let release: () => void = () => undefined;
    this.transactionStartTail = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /** Starts a transaction and discards any stale queued state. */
  async beginTransaction(owner?: TransactionOwnerToken): Promise<void> {
    await this.atTransactionStartBoundary(async () => {
      if (this.isInTransaction()) {
        throw new TransactionError(
          'Transaction already in progress',
          'TRANSACTION_IN_PROGRESS',
          'A transaction is already running. You must commit or rollback the current transaction before starting a new one.',
          'Call commit() or rollback() to end the current transaction first.'
        );
      }
      this._isInTransaction = true;
      this.transactionOwner = owner;
      this.operations = [];
      this.snapshots.clear();
      this.transactionData.clear();
    });
  }

  /** Runs package-internal work only when transaction start can be held until it settles. */
  async runWhenNoTransaction<T>(operation: () => Promise<T>): Promise<T | undefined> {
    return this.atTransactionStartBoundary(async () => {
      if (this.isInTransaction()) {
        return undefined;
      }
      return operation();
    });
  }

  /** Commits queued operations, restoring snapshots when a write fails. */
  async commit(
    writeFn: (
      tableName: string,
      data: StorageInput<StorageRecord>,
      options?: TransactionWriteOptions
    ) => Promise<WriteResult>,
    deleteFn: (
      tableName: string,
      where: FilterCondition<StorageRecord>,
      options?: TransactionCommitOptions
    ) => Promise<number>,
    bulkWriteFn: (
      tableName: string,
      operations: BulkOperation<StorageRecord>[],
      options?: TransactionCommitOptions
    ) => Promise<WriteResult>,
    updateFn: (
      tableName: string,
      data: UpdatePayload<StorageRecord>,
      where: FilterCondition<StorageRecord>,
      options?: TransactionCommitOptions
    ) => Promise<number>,
    deleteTableFn?: (tableName: string) => Promise<void>,
    finalize?: () => Promise<void>,
    owner?: TransactionOwnerToken
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to commit a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }
    this.assertTransactionOwner(owner);

    try {
      for (const operation of this.operations) {
        switch (operation.type) {
          case 'overwrite':
            await writeFn(
              operation.tableName,
              operation.data,
              withInternalDirectWrite({ ...operation.options, mode: 'overwrite' as const })
            );
            break;
          case 'write':
            await writeFn(operation.tableName, operation.data, withInternalDirectWrite({ ...operation.options }));
            break;
          case 'update':
            await updateFn(
              operation.tableName,
              operation.data,
              operation.where,
              withInternalDirectWrite({ ...operation.options })
            );
            break;
          case 'delete':
            await deleteFn(operation.tableName, operation.where, withInternalDirectWrite({ ...operation.options }));
            break;
          case 'bulkWrite':
            await bulkWriteFn(
              operation.tableName,
              operation.operations,
              withInternalDirectWrite({ ...operation.options })
            );
            break;
        }
      }

      await finalize?.();
    } catch (error) {
      // Restore snapshots before exposing a failed commit to the caller.
      try {
        await this.rollback(writeFn, deleteTableFn, true, owner);
      } catch (rollbackError) {
        const describe = (value: unknown): string => (value instanceof Error ? value.message : String(value));
        const failureDetails = `Commit error: ${describe(error)}; rollback error: ${describe(rollbackError)}`;
        throw new TransactionError(
          `Transaction commit failed and rollback could not restore all tables: ${failureDetails}`,
          'TRANSACTION_ROLLBACK_FAILED',
          failureDetails,
          'Inspect the affected tables before retrying the transaction.'
        );
      }
      throw error;
    } finally {
      if (this.isInTransaction()) {
        this.resetTransactionState();
      }
    }
  }

  /** Restores snapshots and ends the active transaction. */
  async rollback(
    writeFn: (
      tableName: string,
      data: StorageInput<StorageRecord>,
      options?: InternalWriteOptions
    ) => Promise<WriteResult>,
    deleteTableFn?: (tableName: string) => Promise<void>,
    restoreSnapshots = true,
    owner?: TransactionOwnerToken
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to rollback a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }
    this.assertTransactionOwner(owner);

    try {
      if (restoreSnapshots) {
        // Restore data written before a failed commit. Tables created by the
        // transaction must be removed rather than restored as empty tables.
        const recoveryFailures: string[] = [];
        const snapshots = Array.from(this.snapshots.entries()).reverse();
        for (const [tableName, snapshot] of snapshots) {
          try {
            if (!snapshot.existed) {
              if (!deleteTableFn) {
                throw new Error('No table deletion handler was provided');
              }
              await deleteTableFn(tableName);
            } else {
              const restoreOptions = withLogicalRecordCount(
                withInternalDirectWrite<InternalWriteOptions & TransactionScopedOptions>({
                  mode: 'overwrite',
                  [transactionOwnerOption]: owner,
                }),
                snapshot.logicalRecordCount
              );
              await writeFn(tableName, snapshot.data, restoreOptions);
            }
          } catch (error) {
            recoveryFailures.push(`${tableName}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (recoveryFailures.length > 0) {
          const failureDetails = recoveryFailures.join('; ');
          throw new TransactionError(
            `Transaction rollback could not restore all tables: ${failureDetails}`,
            'TRANSACTION_ROLLBACK_FAILED',
            failureDetails,
            'Inspect the affected tables before retrying the transaction.'
          );
        }
      }
    } finally {
      this.resetTransactionState();
    }
  }

  getInTransaction(): boolean {
    return this._isInTransaction;
  }

  isInTransaction(): boolean {
    return this.getInTransaction();
  }

  assertTransactionOwner(owner?: TransactionOwnerToken): void {
    if (!this.isInTransaction() || this.transactionOwner === owner) {
      return;
    }

    throw new StorageError('The active transaction belongs to a different storage adapter', 'TRANSACTION_IN_PROGRESS', {
      details: 'Transaction work must use the identity captured when the transaction began.',
      suggestion: 'Commit or roll back with the adapter that started the transaction.',
    });
  }

  private resetTransactionState(): void {
    this._isInTransaction = false;
    this.transactionOwner = undefined;
    this.operations = [];
    this.snapshots.clear();
    this.transactionData.clear();
  }

  /** Creates an independent copy for transaction-owned record data. */
  private cloneRecords(records: StorageRecord[]): StorageRecord[] {
    let cloned: unknown;
    if (typeof structuredClone !== 'undefined') {
      try {
        cloned = structuredClone(records);
      } catch {
        // JSON is the storage boundary fallback for environments without cloneable record values.
      }
    }

    if (cloned === undefined) {
      const serialized = JSON.stringify(records);
      cloned = serialized === undefined ? undefined : (JSON.parse(serialized) as unknown);
    }

    if (!Array.isArray(cloned) || !cloned.every(isStorageRecord)) {
      throw new TransactionError('Could not isolate transaction record data', 'SNAPSHOT_FAILED');
    }
    return cloned;
  }

  private cloneRecord(record: StorageRecord): StorageRecord {
    const [cloned] = this.cloneRecords([record]);
    return cloned;
  }

  private cloneFilter(filter: FilterCondition<StorageRecord>): FilterCondition<StorageRecord> {
    return typeof filter === 'function' ? filter : this.cloneRecord(filter);
  }

  private cloneOptions(options?: TransactionWriteOptions): TransactionWriteOptions | undefined {
    if (!options) {
      return undefined;
    }
    return {
      ...options,
      ...(options.encryptedFields ? { encryptedFields: [...options.encryptedFields] } : {}),
    };
  }

  private cloneBulkOperations(operations: BulkOperation<StorageRecord>[]): BulkOperation<StorageRecord>[] {
    return operations.map(operation => {
      switch (operation.type) {
        case 'insert':
          return {
            ...operation,
            data: Array.isArray(operation.data) ? this.cloneRecords(operation.data) : this.cloneRecord(operation.data),
          };
        case 'update':
          return {
            ...operation,
            data: this.cloneRecord(operation.data),
            where: this.cloneFilter(operation.where),
          };
        case 'delete':
          return {
            ...operation,
            where: this.cloneFilter(operation.where),
          };
      }
    });
  }

  private cloneOperation(operation: TransactionOperation): TransactionOperation {
    const options = this.cloneOptions(operation.options);
    switch (operation.type) {
      case 'overwrite':
      case 'write':
        return { ...operation, data: this.cloneRecords(operation.data), options };
      case 'update':
        return {
          ...operation,
          data: this.cloneRecord(operation.data),
          where: this.cloneFilter(operation.where),
          options,
        };
      case 'delete':
        return { ...operation, where: this.cloneFilter(operation.where), options };
      case 'bulkWrite':
        return { ...operation, operations: this.cloneBulkOperations(operation.operations), options };
    }
  }

  getTransactionData(tableName: string, owner?: TransactionOwnerToken): StorageRecord[] | undefined {
    this.assertTransactionOwner(owner);
    const data = this.transactionData.get(tableName);
    return data ? this.cloneRecords(data) : undefined;
  }

  setTransactionData(tableName: string, data: StorageRecord[], owner?: TransactionOwnerToken): void {
    this.assertTransactionOwner(owner);
    this.transactionData.set(tableName, this.cloneRecords(data));
  }

  /** Saves the first deep snapshot for a table in the active transaction. */
  saveSnapshot(
    tableName: string,
    data: StorageRecord[],
    existed = true,
    owner?: TransactionOwnerToken,
    logicalRecordCount = data.length
  ): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to save a snapshot, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }
    this.assertTransactionOwner(owner);

    if (!Number.isSafeInteger(logicalRecordCount) || logicalRecordCount < 0) {
      throw new TransactionError(
        'Could not capture a valid logical record count for the transaction snapshot',
        'SNAPSHOT_FAILED'
      );
    }

    if (!this.snapshots.has(tableName)) {
      this.snapshots.set(tableName, {
        tableName,
        data: this.cloneRecords(data),
        existed,
        logicalRecordCount,
      });
    }
  }

  /** Adds an operation and invalidates its materialized table view. */
  addOperation(operation: TransactionOperation, owner?: TransactionOwnerToken): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to add an operation to a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }
    this.assertTransactionOwner(owner);

    const copiedOperation = this.cloneOperation(operation);
    this.operations.push(copiedOperation);

    this.transactionData.delete(copiedOperation.tableName);
  }

  /** Materializes a table view with all queued operations applied. */
  async getCurrentTransactionData(
    tableName: string,
    readFn: (tableName: string, options?: ReadOptions<StorageRecord>) => Promise<StorageRecord[]>,
    owner?: TransactionOwnerToken
  ): Promise<StorageRecord[]> {
    this.assertTransactionOwner(owner);
    if (this.transactionData.has(tableName)) {
      return this.cloneRecords(this.transactionData.get(tableName)!);
    }

    let data = this.cloneRecords(await readFn(tableName));

    for (const operation of this.operations) {
      if (operation.tableName !== tableName) {
        continue;
      }

      switch (operation.type) {
        case 'overwrite':
          data = [...operation.data];
          break;
        case 'write':
          if (operation.options?.mode === 'overwrite') {
            data = [...operation.data];
          } else {
            data = [...data, ...operation.data];
          }
          break;
        case 'update':
          const matchedItems = QueryEngine.filter(data, operation.where);
          const matchedItemRefs = new Set(matchedItems);

          data = data.map(item => {
            if (matchedItemRefs.has(item)) {
              return QueryEngine.update(item, operation.data);
            }
            return item;
          });
          break;
        case 'delete':
          data = data.filter(item => QueryEngine.filter([item], operation.where).length === 0);
          break;
        case 'bulkWrite':
          for (const bulkOp of operation.operations) {
            switch (bulkOp.type) {
              case 'insert':
                const insertData = Array.isArray(bulkOp.data) ? bulkOp.data : [bulkOp.data];
                data = [...data, ...insertData];
                break;
              case 'update':
                const bulkMatchedItems = QueryEngine.filter(data, bulkOp.where);
                const bulkMatchedItemRefs = new Set(bulkMatchedItems);

                data = data.map(item => {
                  if (bulkMatchedItemRefs.has(item)) {
                    return QueryEngine.update(item, bulkOp.data);
                  }
                  return item;
                });
                break;
              case 'delete':
                data = data.filter(item => QueryEngine.filter([item], bulkOp.where).length === 0);
                break;
            }
          }
          break;
      }
    }

    this.transactionData.set(tableName, data);
    return this.cloneRecords(data);
  }
}
