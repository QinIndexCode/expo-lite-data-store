import type { TableSchema } from '../core/meta/MetadataManager';
import type { TransactionOwnerToken } from '../core/service/TransactionService';
import type { IStorageAdapter } from './storageAdapterInfc';
import type { TableOptions } from './storageTypes';

/**
 * Backing engine contract consumed by decorators such as the encrypted
 * adapter. A concrete engine owns the physical persistence layer (file
 * system or SQLite) while decorators implement cross-cutting concerns like
 * field-level encryption.
 *
 * The engine surface intentionally includes a few implementation methods
 * beyond {@link IStorageAdapter} (table metadata lookup, logical record
 * count publishing and transaction ownership) so decorators can share one
 * code path regardless of the backing store.
 */
export interface IStorageEngine extends IStorageAdapter {
  /** Opens the backing store and completes any one-time setup. */
  ensureInitialized(): Promise<void>;

  /** Returns the persisted schema for a table, if it exists. */
  getTableMeta(tableName: string): TableSchema | undefined;

  /**
   * Publishes a decorator-level logical record count (for example after a
   * full-table encrypted write collapses many rows into one envelope).
   * @internal
   */
  setLogicalRecordCount(tableName: string, count: number, options?: TableOptions): Promise<void>;

  /** Reconciles persisted metadata with the actual record count when they differ. */
  verifyCount(tableName: string, options?: TableOptions): Promise<{ metadata: number; actual: number; match: boolean }>;

  /** Same surface as the public adapter, extended for transaction-scoped cleanup. */
  clearTable(tableName: string, options?: TableOptions): Promise<void>;

  /** Same surface as the public adapter, extended for transaction-scoped migration. */
  migrateToChunked(tableName: string, options?: TableOptions): Promise<void>;

  /** Asserts that the active transaction belongs to the given owner. */
  assertTransactionOwner(owner: TransactionOwnerToken): void;

  /** Reports whether a transaction is currently in progress. */
  isInTransaction(): boolean;

  /** Commits the active transaction, running the decorator finalizer inside the same commit. */
  commit(options?: TableOptions, finalize?: () => Promise<void>): Promise<void>;

  /** Releases engine resources (closes the database, etc.). Optional. */
  cleanup?(): Promise<void>;
}
