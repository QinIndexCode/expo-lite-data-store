// src/expo-lite-data-store.ts
// Expo Lite Data Store Main API Export File
// Provides all public interfaces for database operations, including table management, data read/write, queries, transactions, etc.
// Created: 2025-11-19
// Last Modified: 2025-12-17
// Directly import database instance
import { plainStorage, dbManager } from './core/db';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, TableOptions } from './types/storageTypes';

/**
 * Plain storage instance, no encryption support
 */
export { plainStorage };

/**
 * Create table
 * @param tableName Table name
 * @param options Create table options, including common options and table-specific options
 * @returns Promise<void>
 */
export const createTable = async (
  tableName: string,
  options: CreateTableOptions = {}
): Promise<void> => {
  const { encrypted = false, requireAuthOnAccess = false, ...tableOptions } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.createTable(tableName, tableOptions);
};

/**
 * Delete table
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const deleteTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  const { encrypted = false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.deleteTable(tableName, options);
};

/**
 * Check if table exists
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<boolean>
 */
export const hasTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<boolean> => {
  const { encrypted = false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.hasTable(tableName, options);
};

/**
 * List all tables
 * @param options Operation options, including common options
 * @returns Promise<string[]>
 */
export const listTables = async (
  options: TableOptions = {}
): Promise<string[]> => {
  const { encrypted = false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.listTables(options);
};

/**
 * Insert data
 * @param tableName Table name
 * @param data Data to insert
 * @param options Write options, including common options
 * @returns Promise<WriteResult>
 */
export const insert = async (
  tableName: string,
  data: Record<string, any> | Record<string, any>[],
  options: WriteOptions = {}
): Promise<WriteResult> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { requireAuthOnAccess = false, encrypted = requireAuthOnAccess || false, ...finalWriteOptions } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.write(tableName, data, finalWriteOptions);
};

/**
 * Read data
 * @param tableName Table name
 * @param options Read options, including common options
 * @returns Promise<Record<string, any>[]>
 */
export const read = async (
  tableName: string,
  options: ReadOptions = {}
): Promise<Record<string, any>[]> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { requireAuthOnAccess = false, encrypted = requireAuthOnAccess || false, ...finalReadOptions } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.read(tableName, finalReadOptions);
};

/**
 * Count table data rows
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<number>
 */
export const countTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<number> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.count(tableName);
};

/**
 * Verify table count accuracy
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<{ metadata: number; actual: number; match: boolean }>
 */
export const verifyCountTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<{ metadata: number; actual: number; match: boolean }> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.verifyCount(tableName);
};

/**
 * Find single record
 * @param tableName Table name
 * @param options Operation options, including where condition and common options
 * @returns Promise<Record<string, any> | null>
 */
export const findOne = async (
  tableName: string,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<Record<string, any> | null> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { where, encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findOne(tableName, where, options);
};

/**
 * Find multiple records
 * @param tableName Table name
 * @param options Query options, including where condition, skip, limit, sortBy, order, sortAlgorithm, and common options
 * @returns Promise<Record<string, any>[]>
 */
export const findMany = async (
  tableName: string,
  options?: {
    where?: Record<string, any>,
    skip?: number,
    limit?: number,
    sortBy?: string | string[],
    order?: 'asc' | 'desc' | Array<'asc' | 'desc'>,
    sortAlgorithm?: any,
    encrypted?: boolean,
    requireAuthOnAccess?: boolean
  }
): Promise<Record<string, any>[]> => {
  const {
    where = {},
    skip,
    limit,
    sortBy,
    order,
    sortAlgorithm,
    requireAuthOnAccess = false,
    // 如果requireAuthOnAccess为true，则默认encrypted为true
    encrypted = requireAuthOnAccess || false
  } = options || {};

  // Extract query-specific options, exclude common options
  const finalFindOptions = {
    skip,
    limit,
    sortBy,
    order,
    sortAlgorithm
  };

  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.findMany(tableName, where, finalFindOptions, options);
};

/**
 * Delete data
 * @param tableName Table name
 * @param options Operation options, including where condition and common options
 * @returns Promise<number>
 */
export const remove = async (
  tableName: string,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<number> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { where, encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.delete(tableName, where, options);
};

/**
 * Bulk operations
 * @param tableName Table name
 * @param operations Operations array
 * @param options Operation options, including common options
 * @returns Promise<WriteResult>
 */
export const bulkWrite = async (
  tableName: string,
  operations: Array<{
    type: 'insert' | 'update' | 'delete';
    data: Record<string, any> | Record<string, any>[];
    where?: Record<string, any>;
  }>,
  options: TableOptions = {}
): Promise<WriteResult> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.bulkWrite(tableName, operations);
};

/**
 * Begin transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const beginTransaction = async (
  options: TableOptions = {}
): Promise<void> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.beginTransaction(options);
};

/**
 * Commit transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const commit = async (
  options: TableOptions = {}
): Promise<void> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.commit(options);
};

/**
 * Rollback transaction
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const rollback = async (
  options: TableOptions = {}
): Promise<void> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.rollback(options);
};

/**
 * Migrate table to chunked mode
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const migrateToChunked = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.migrateToChunked(tableName);
};

/**
 * Update matching data
 * @param tableName Table name
 * @param data Data to update
 * @param options Operation options, including where condition and common options
 * @returns Promise<number> Number of records updated
 */
export const update = async (
  tableName: string,
  data: Record<string, any>,
  options: { where: Record<string, any>, encrypted?: boolean, requireAuthOnAccess?: boolean }
): Promise<number> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { where, encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.update(tableName, data, where, options);
};

/**
 * Clear table data
 * @param tableName Table name
 * @param options Operation options, including common options
 * @returns Promise<void>
 */
export const clearTable = async (
  tableName: string,
  options: TableOptions = {}
): Promise<void> => {
  // 如果requireAuthOnAccess为true，则默认encrypted为true
  const { encrypted = options.requireAuthOnAccess || false, requireAuthOnAccess = false } = options;
  const adapter = dbManager.getDbInstance(encrypted, requireAuthOnAccess);
  return adapter.clearTable(tableName);
};



// Export types
export type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult, CommonOptions, TableOptions, FindOptions, FilterCondition } from './types/storageTypes.js';

export default {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
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
