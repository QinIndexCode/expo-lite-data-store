export type CommonOptions = {
  /** Whether to use encrypted storage. Defaults to false. */
  encrypted?: boolean;
  /** Whether access requires biometric authentication. Defaults to false. */
  requireAuthOnAccess?: boolean;
};

/**
 * Normalized record shape used by the storage implementation after runtime
 * validation. Public APIs remain generic so callers can use named interfaces
 * without requiring an index signature.
 */
export type StorageRecord = Record<string, unknown>;

/**
 * A single record or a collection of records accepted by write operations.
 */
export type StorageInput<T extends object = StorageRecord> = T | T[];

/**
 * Prevents condition arguments from widening a caller-selected record type.
 * This local form keeps emitted declarations compatible with TypeScript versions
 * that predate the intrinsic NoInfer helper.
 */
export type NonInfer<T> = [T][T extends unknown ? 0 : never];

export const isStorageRecord = (value: unknown): value is StorageRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export type SortOrder = 'asc' | 'desc';

export type SortAlgorithm = 'default' | 'fast' | 'counting' | 'merge' | 'slow';

/** Supports known keys with autocomplete while retaining schemaless record fields. */
export type SortField<T extends object> = Extract<keyof T, string> | (string & {});

/** Accepts predicates, partial records, or nested boolean conditions. */
export type FilterCondition<T extends object = StorageRecord> =
  | ((item: T) => boolean)
  | Partial<T>
  | StorageRecord
  | { $or?: FilterCondition<T>[]; $and?: FilterCondition<T>[] };

/**
 * Supported update operators. Plain partial updates remain valid alongside
 * operator payloads such as `{ $inc: { balance: 1 } }`.
 */
export type UpdateOperatorPayload = {
  $inc?: Record<string, number>;
  $set?: StorageRecord;
  $unset?: string[];
  $push?: StorageRecord;
  $pull?: StorageRecord;
  $addToSet?: StorageRecord;
};

export type UpdatePayload<T extends object = StorageRecord> = Partial<T> | UpdateOperatorPayload | StorageRecord;

export type BulkOperation<T extends object = StorageRecord> =
  | {
      type: 'insert';
      data: StorageInput<T>;
    }
  | {
      type: 'update';
      data: UpdatePayload<T>;
      where: FilterCondition<T>;
    }
  | {
      type: 'delete';
      where: FilterCondition<T>;
    };

export type WriteResult = {
  /** Number of records written or affected by this operation. */
  written: number;
  /** Total number of records after the write. */
  totalAfterWrite: number;
  /** Whether the table uses chunked storage. */
  chunked: boolean;
  /** Number of chunks, when chunked storage is used. */
  chunks?: number;
};

export type ReadOptions<T extends object = StorageRecord> = CommonOptions & {
  /** Number of records to skip. */
  skip?: number;
  /** Maximum number of records to read. */
  limit?: number;
  /** Filter condition to apply. */
  filter?: FilterCondition<T>;
  /** Field or fields to sort by. */
  sortBy?: SortField<T> | SortField<T>[];
  /** Sort order corresponding to each requested field. */
  order?: SortOrder | SortOrder[];
  /** Sorting algorithm to use. */
  sortAlgorithm?: SortAlgorithm;
  /** Whether to bypass the read cache. */
  bypassCache?: boolean;
};

export type ColumnDefinition =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'blob'
  | {
      type: 'string' | 'number' | 'boolean' | 'date' | 'blob';
      isHighRisk?: boolean;
    };

export type CreateTableOptions<T extends object = StorageRecord> = CommonOptions & {
  /** Column definitions keyed by column name. */
  columns?: Record<string, ColumnDefinition>;
  /** Whether to create intermediate directories. */
  intermediates?: boolean;
  /** Chunk size threshold in bytes. */
  chunkSize?: number;
  /** Initial records to persist with the table. */
  initialData?: T[];
  /** Physical storage mode. */
  mode?: 'single' | 'chunked';
  /** Fields that require encryption. */
  encryptedFields?: string[];
  /** Whether to encrypt the table as one envelope. */
  encryptFullTable?: boolean;
};

export type WriteOptions = CommonOptions & {
  /** Whether to append or replace existing records. */
  mode?: 'append' | 'overwrite';
  /** Whether to force chunked storage. */
  forceChunked?: boolean;
  /** Whether to encrypt the table as one envelope instead of encrypting fields. */
  encryptFullTable?: boolean;
};

/** Internal alias for write paths that can also carry module-private capabilities. */
export type InternalWriteOptions = WriteOptions;

export type TableOptions = CommonOptions;

export type FindOptions<T extends object = StorageRecord> = CommonOptions & {
  /** Number of records to skip. */
  skip?: number;
  /** Maximum number of records to return. */
  limit?: number;
  /** Field or fields to sort by. */
  sortBy?: SortField<T> | SortField<T>[];
  /** Sort order corresponding to each requested field. */
  order?: SortOrder | SortOrder[];
  /** Sorting algorithm to use. */
  sortAlgorithm?: SortAlgorithm;
};

export interface TableMeta {
  /** Physical storage mode. */
  mode: 'single' | 'chunked';
  /** Number of logical records. */
  count: number;
  /** Total table size in bytes. */
  size?: number;
  /** Chunk size in bytes, when chunked storage is used. */
  chunk?: number;
  /** Last update timestamp in milliseconds. */
  updateAt: number;
  /** Whether the table uses encrypted storage. */
  encrypted?: boolean;
  /** Whether access requires biometric authentication. */
  requireAuthOnAccess?: boolean;
}

export type Catalog = {
  /** Metadata keyed by table name. */
  tables: Record<string, TableMeta>;
  /** Catalog version number. */
  version: number;
};
