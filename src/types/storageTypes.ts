/**
 * Storage Types Definition File
 * Contains type definitions for filter conditions, read/write options, and metadata structures.
 * 
 * @module storageTypes
 * @since 2025-11-19
 * @version 1.0.0
 */

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
 * Filter condition type that supports multiple filtering mechanisms.
 */
export type FilterCondition =
  | ((item: Record<string, any>) => boolean) // Function-based filter
  | Partial<Record<string, any>> // Partial object matching
  | { $or?: FilterCondition[]; $and?: FilterCondition[] }; // Composite conditions (AND/OR)

/**
 * Write result type containing detailed information about a write operation.
 */
export type WriteResult = {
  /** Number of bytes written in this operation */
  written: number;
  /** Total number of bytes after the write operation */
  totalAfterWrite: number;
  /** Whether chunked writing was used */
  chunked: boolean;
  /** Number of chunks used (only present for chunked writes) */
  chunks?: number;
};

/**
 * Read options type for configuring data retrieval parameters.
 */
export type ReadOptions = CommonOptions & {
  /** Number of records to skip */
  skip?: number;
  /** Maximum number of records to read */
  limit?: number;
  /** Filter condition to apply */
  filter?: FilterCondition;
  /** Field or fields to sort by */
  sortBy?: string | string[];
  /** Sort order(s) corresponding to sortBy fields */
  order?: 'asc' | 'desc' | ('asc' | 'desc')[];
  /** Sorting algorithm to use */
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  /** Whether to bypass cache and read directly from disk */
  bypassCache?: boolean;
};

/**
 * Create table options type for configuring table creation parameters.
 */
export type CreateTableOptions = CommonOptions & {
  /** Column definitions with column names as keys and data types as values */
  columns?: Record<string, string>;
  /** Whether to automatically create intermediate directories */
  intermediates?: boolean;
  /** Chunk size threshold for chunked writing */
  chunkSize?: number;
  /** Initial data to populate the table with */
  initialData?: Record<string, any>[];
  /** Storage mode: single file or chunked */
  mode?: 'single' | 'chunked';
  /** List of fields that require encryption */
  encryptedFields?: string[];
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
 * Table management options type for table-related operations.
 */
export type TableOptions = CommonOptions;

/**
 * Find options type for configuring findMany operation parameters.
 */
export type FindOptions = CommonOptions & {
  /** Number of records to skip */
  skip?: number;
  /** Maximum number of records to return */
  limit?: number;
  /** Field or fields to sort by */
  sortBy?: string | string[];
  /** Sort order(s) corresponding to sortBy fields */
  order?: 'asc' | 'desc' | ('asc' | 'desc')[];
  /** Sorting algorithm to use */
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
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
