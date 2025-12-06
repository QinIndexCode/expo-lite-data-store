// src/types/metadataManagerInfc.ts
import type { TableSchema } from '../core/meta/MetadataManager';

/**
 * 元数据管理器接口
 * 定义了元数据管理的核心功能，用于降低模块间的耦合度
 */
export interface IMetadataManager {
  /**
   * 获取表的元数据
   */
  get(tableName: string): TableSchema | undefined;

  /**
   * 获取表的路径
   */
  getPath(tableName: string): string;

  /**
   * 更新表的元数据
   */
  update(tableName: string, updates: Partial<TableSchema>): void;

  /**
   * 删除表的元数据
   */
  delete(tableName: string): void;

  /**
   * 获取所有表名
   */
  allTables(): string[];

  /**
   * 获取表的记录数
   */
  count(tableName: string): number;
}
