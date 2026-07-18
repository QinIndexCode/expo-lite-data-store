/**
 * Common options type shared across all API methods.
 */
export type CommonOptions = {
  /** Whether to use encrypted storage (defaults to false) */
  encrypted?: boolean;
  /** Whether biometric authentication is required for access (defaults to false) */
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

/**
 * Returns whether a runtime value is a non-array record suitable for storage.
 */
export const isStorageRecord = (value: unknown): value is StorageRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export type SortOrder = 'asc' | 'desc';

export type SortAlgorithm = 'default' | 'fast' | 'counting' | 'merge' | 'slow';

/** Supports known keys with autocomplete while retaining schemaless record fields. */
export type SortField<T extends object> = Extract<keyof T, string> | (string & {});

/**
 * Filter condition type that supports multiple filtering mechanisms.
 */
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

/**
 * Write result type containing detailed information about a write operation.
 */
export type WriteResult = {
  /** Number of records written or affected in this operation */
  written: number;
  /** Total number of records after the write operation */
  totalAfterWrite: number;
  /** Whether chunked writing was used */
  chunked: boolean;
  /** Number of chunks used (only present for chunked writes) */
  chunks?: number;
};

/**
 * Read options type for configuring data retrieval parameters.
 */
export type ReadOptions<T extends object = StorageRecord> = CommonOptions & {
  /** Number of records to skip */
  skip?: number;
  /** Maximum number of records to read */
  limit?: number;
  /** Filter condition to apply */
  filter?: FilterCondition<T>;
  /** Field or fields to sort by */
  sortBy?: SortField<T> | SortField<T>[];
  /** Sort order(s) corresponding to sortBy fields */
  order?: SortOrder | SortOrder[];
  /** Sorting algorithm to use */
  sortAlgorithm?: SortAlgorithm;
  /** Whether to bypass cache and read directly from disk */
  bypassCache?: boolean;
};

/**
 * Create table options type for configuring table creation parameters.
 */
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
  /** Column definitions with column names as keys and data types as values */
  columns?: Record<string, ColumnDefinition>;
  /** Whether to automatically create intermediate directories */
  intermediates?: boolean;
  /** Chunk size threshold for chunked writing */
  chunkSize?: number;
  /** Initial data to populate the table with */
  initialData?: T[];
  /** Storage mode: single file or chunked */
  mode?: 'single' | 'chunked';
  /** List of fields that require encryption */
  encryptedFields?: string[];
  /** Whether to use full-table encryption */
  encryptFullTable?: boolean;
};

/**
 * Write options type for configuring data writing parameters.
 */
export type WriteOptions = CommonOptions & {
  /** Write mode: append or overwrite existing data */
  mode?: 'append' | 'overwrite';
  /** Whether to force chunked writing */
  forceChunked?: boolean;
  /** Whether to enable full table encryption (mutually exclusive with field-level encryption) */
  encryptFullTable?: boolean;
};

/**
 * Internal write option used while a transaction commits or rolls back.
 */
export type InternalWriteOptions = WriteOptions & {
  directWrite?: boolean;
};

/**
 * Table management options type for table-related operations.
 */
export type TableOptions = CommonOptions;

/**
 * Find options type for configuring findMany operation parameters.
 */
export type FindOptions<T extends object = StorageRecord> = CommonOptions & {
  /** Number of records to skip */
  skip?: number;
  /** Maximum number of records to return */
  limit?: number;
  /** Field or fields to sort by */
  sortBy?: SortField<T> | SortField<T>[];
  /** Sort order(s) corresponding to sortBy fields */
  order?: SortOrder | SortOrder[];
  /** Sorting algorithm to use */
  sortAlgorithm?: SortAlgorithm;
};

/**
 * Table metadata interface containing table information and statistics.
 */
export interface TableMeta {
  /** Storage mode: single file or chunked */
  mode: 'single' | 'chunked';
  /** Number of records in the table */
  count: number;
  /** Total size of the table in bytes */
  size?: number;
  /** Chunk size (only present in chunked mode) */
  chunk?: number;
  /** Last update timestamp in milliseconds */
  updateAt: number;
  /** Whether the table uses encrypted storage */
  encrypted?: boolean;
  /** Whether biometric authentication is required for access */
  requireAuthOnAccess?: boolean;
}

/**
 * Catalog metadata type containing database-wide table information and version.
 */
export type Catalog = {
  /** Metadata for all tables with table names as keys */
  tables: Record<string, TableMeta>;
  /** Catalog version number */
  version: number;
};
