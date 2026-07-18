import type {
  BulkOperation,
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
} from './storageTypes';

export interface IStorageAdapter {
  createTable<T extends object = StorageRecord>(tableName: string, options?: CreateTableOptions<T>): Promise<void>;

  deleteTable(tableName: string, options?: TableOptions): Promise<void>;

  hasTable(tableName: string, options?: TableOptions): Promise<boolean>;

  listTables(options?: TableOptions): Promise<string[]>;

  /** Replaces every record in the table regardless of an input write mode. */
  overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult>;

  /** Appends records regardless of an input write mode. */
  insert<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult>;

  /**
   * Writes with the caller-selected mode. Retained for backward compatibility.
   *
   * @deprecated Use insert for append mode or overwrite for replacement mode.
   */
  write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult>;

  read<T extends object = StorageRecord>(tableName: string, options?: ReadOptions<NonInfer<T>>): Promise<T[]>;

  count(tableName: string): Promise<number>;

  /** Reconciles persisted metadata with the actual record count when they differ. */
  verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }>;

  findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    options?: TableOptions
  ): Promise<T | null>;

  findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    findOptions?: TableOptions
  ): Promise<T[]>;

  bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: TableOptions
  ): Promise<WriteResult>;

  migrateToChunked(tableName: string): Promise<void>;

  update<T extends object = StorageRecord>(
    tableName: string,
    data: UpdatePayload<T>,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number>;

  /** Compatibility alias for delete. */
  remove<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number>;

  clearTable(tableName: string): Promise<void>;

  delete<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number>;

  beginTransaction(options?: TableOptions): Promise<void>;

  commit(options?: TableOptions): Promise<void>;

  rollback(options?: TableOptions): Promise<void>;
}
