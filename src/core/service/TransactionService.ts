/** Transaction service managing begin, commit, and rollback operations. */

import { QueryEngine } from '../query/QueryEngine';
import {
  isStorageRecord,
  type BulkOperation,
  type FilterCondition,
  type InternalWriteOptions,
  type ReadOptions,
  type StorageInput,
  type StorageRecord,
  type UpdatePayload,
  type WriteResult,
} from '../../types/storageTypes';
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
      options?: InternalWriteOptions;
    }
  | {
      tableName: string;
      type: 'delete';
      where: FilterCondition<StorageRecord>;
      options?: InternalWriteOptions;
    }
  | {
      tableName: string;
      type: 'bulkWrite';
      operations: BulkOperation<StorageRecord>[];
      options?: InternalWriteOptions;
    }
  | {
      tableName: string;
      type: 'update';
      data: UpdatePayload<StorageRecord>;
      where: FilterCondition<StorageRecord>;
      options?: InternalWriteOptions;
    };

/** Captures a table's state before its first transaction operation. */
export interface Snapshot {
  tableName: string;
  /** Table contents before the first transaction operation. */
  data: StorageRecord[];
  /** Whether the table existed before the transaction first touched it. */
  existed: boolean;
}

/** Queues table operations and restores snapshots when a transaction fails. */
export class TransactionService {
  private _isInTransaction = false;
  private operations: TransactionOperation[] = [];
  private snapshots: Map<string, Snapshot> = new Map();
  private transactionData = new Map<string, StorageRecord[]>();

  /** Starts a transaction and discards any stale queued state. */
  async beginTransaction(): Promise<void> {
    if (this.isInTransaction()) {
      throw new TransactionError(
        'Transaction already in progress',
        'TRANSACTION_IN_PROGRESS',
        'A transaction is already running. You must commit or rollback the current transaction before starting a new one.',
        'Call commit() or rollback() to end the current transaction first.'
      );
    }
    this._isInTransaction = true;
    this.operations = [];
    this.snapshots.clear();
    this.transactionData.clear();
  }

  /** Commits queued operations, restoring snapshots when a write fails. */
  async commit(
    writeFn: (
      tableName: string,
      data: StorageInput<StorageRecord>,
      options?: InternalWriteOptions
    ) => Promise<WriteResult>,
    deleteFn: (
      tableName: string,
      where: FilterCondition<StorageRecord>,
      options?: InternalWriteOptions
    ) => Promise<number>,
    bulkWriteFn: (
      tableName: string,
      operations: BulkOperation<StorageRecord>[],
      options?: InternalWriteOptions
    ) => Promise<WriteResult>,
    updateFn: (
      tableName: string,
      data: UpdatePayload<StorageRecord>,
      where: FilterCondition<StorageRecord>,
      options?: InternalWriteOptions
    ) => Promise<number>,
    deleteTableFn?: (tableName: string) => Promise<void>,
    finalize?: () => Promise<void>
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to commit a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    try {
      for (const operation of this.operations) {
        switch (operation.type) {
          case 'overwrite':
            await writeFn(operation.tableName, operation.data, {
              ...operation.options,
              mode: 'overwrite',
              directWrite: true,
            });
            break;
          case 'write':
            await writeFn(operation.tableName, operation.data, { ...operation.options, directWrite: true });
            break;
          case 'update':
            await updateFn(operation.tableName, operation.data, operation.where, {
              ...operation.options,
              directWrite: true,
            });
            break;
          case 'delete':
            await deleteFn(operation.tableName, operation.where, { ...operation.options, directWrite: true });
            break;
          case 'bulkWrite':
            await bulkWriteFn(operation.tableName, operation.operations, { ...operation.options, directWrite: true });
            break;
        }
      }

      await finalize?.();
    } catch (error) {
      // Restore snapshots before exposing a failed commit to the caller.
      await this.rollback(writeFn, deleteTableFn);
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
    restoreSnapshots = true
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to rollback a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    try {
      if (restoreSnapshots) {
        // Restore data written before a failed commit. Tables created by the
        // transaction must be removed rather than restored as empty tables.
        for (const [tableName, snapshot] of this.snapshots) {
          if (!snapshot.existed && deleteTableFn) {
            await deleteTableFn(tableName);
          } else if (snapshot.existed) {
            await writeFn(tableName, snapshot.data, { mode: 'overwrite', directWrite: true });
          }
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

  private resetTransactionState(): void {
    this._isInTransaction = false;
    this.operations = [];
    this.snapshots.clear();
    this.transactionData.clear();
  }

  getTransactionData(tableName: string): StorageRecord[] | undefined {
    return this.transactionData.get(tableName);
  }

  setTransactionData(tableName: string, data: StorageRecord[]): void {
    this.transactionData.set(tableName, data);
  }

  /** Saves the first deep snapshot for a table in the active transaction. */
  saveSnapshot(tableName: string, data: StorageRecord[], existed = true): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to save a snapshot, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    if (!this.snapshots.has(tableName)) {
      // Snapshots cannot share mutable record objects with queued operations.
      let snapshotData: StorageRecord[];
      if (typeof structuredClone !== 'undefined') {
        snapshotData = structuredClone(data);
      } else {
        const serialized = JSON.stringify(data);
        const parsed: unknown = serialized === undefined ? undefined : JSON.parse(serialized);
        if (!Array.isArray(parsed) || !parsed.every(isStorageRecord)) {
          throw new TransactionError('Could not create a transaction snapshot', 'SNAPSHOT_FAILED');
        }
        snapshotData = parsed;
      }

      this.snapshots.set(tableName, {
        tableName,
        data: snapshotData,
        existed,
      });
    }
  }

  /** Adds an operation and invalidates its materialized table view. */
  addOperation(operation: TransactionOperation): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to add an operation to a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    this.operations.push(operation);

    this.transactionData.delete(operation.tableName);
  }

  /** Materializes a table view with all queued operations applied. */
  async getCurrentTransactionData(
    tableName: string,
    readFn: (tableName: string, options?: ReadOptions<StorageRecord>) => Promise<StorageRecord[]>
  ): Promise<StorageRecord[]> {
    if (this.transactionData.has(tableName)) {
      return this.transactionData.get(tableName)!;
    }

    let data = await readFn(tableName);

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
    return data;
  }
}
