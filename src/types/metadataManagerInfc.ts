import type { TableSchema } from '../core/meta/MetadataManager';

export interface IMetadataManager {
  get(tableName: string): TableSchema | undefined;

  /** Read the latest durable table metadata without replacing local pending state. */
  getPersisted?(tableName: string): Promise<TableSchema | undefined>;

  /** Refresh from a newer in-process durable generation while retaining local pending mutations. */
  getLatest?(tableName: string): Promise<TableSchema | undefined>;

  getPath(tableName: string): string;

  update(tableName: string, updates: Partial<TableSchema>): void;

  delete(tableName: string): void;

  allTables(): string[];

  count(tableName: string): number;

  /**
   * Persist pending metadata immediately when the implementation supports it.
   */
  saveImmediately?(): Promise<void>;
}
