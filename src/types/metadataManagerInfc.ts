/**
 * @module metadataManagerInfc
 * @description Metadata manager interface definition
 * @since 2025-11-19
 * @version 1.0.0
 */

import type { TableSchema } from '../core/meta/MetadataManager';

/**
 * Metadata manager interface defining core functionality to reduce module coupling
 */
export interface IMetadataManager {
  /**
   * Get metadata for a table
   */
  get(tableName: string): TableSchema | undefined;

  /**
   * Get the path for a table
   */
  getPath(tableName: string): string;

  /**
   * Update metadata for a table
   */
  update(tableName: string, updates: Partial<TableSchema>): void;

  /**
   * Delete metadata for a table
   */
  delete(tableName: string): void;

  /**
   * Get all table names
   */
  allTables(): string[];

  /**
   * Get record count for a table
   */
  count(tableName: string): number;
}
