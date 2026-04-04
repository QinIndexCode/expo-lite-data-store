/**
 * @module MetadataManager
 * @description Metadata manager for table schema and data tracking
 * @since 2025-11-19
 * @version 1.0.0
 */

import * as FileSystem from 'expo-file-system';
import { StorageError } from '../../types/storageErrorInfc';
import ROOT from '../../utils/ROOTPath';
import logger from '../../utils/logger';

const META_FILE_PATH = `${ROOT}/meta.ldb`;
const CURRENT_VERSION = '1.0.0';

/**
 * 列模式接口
 * 定义表中列的数据类型和属性
 */
export interface ColumnSchema {
  [field: string]:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'blob'
    | {
        type: 'string' | 'number' | 'boolean' | 'date' | 'blob';
        isHighRisk?: boolean;
      };
}

/**
 * 表模式接口
 * 定义表的元数据信息
 */
export interface TableSchema {
  mode: 'single' | 'chunked'; // Store模式：单文件或分片
  path: string; // File path: single file "users.ldb", chunked "users/"
  count: number; // Record count in table
  size?: number; // Total table size (bytes)
  lastId?: number; // Last record ID
  chunks?: number; // Chunk count (chunked mode only)
  createdAt: number; // Create时间戳
  updatedAt: number; // Update时间戳
  columns: ColumnSchema; // Column definitions
  indexes?: Record<string, 'unique' | 'normal'>; // Index information
  isHighRisk?: boolean; // Is high risk table
  highRiskFields?: string[]; // High risk fields list

  encryptedFields?: string[]; // Fields requiring encryption
  encrypted?: boolean; // Is encrypted table
  encryptFullTable?: boolean; // Use full table encryption
}

/**
 * 数据库元数据接口
 * 定义整个数据库的元数据信息
 */
export interface DatabaseMeta {
  version: string; // Database version
  generatedAt: number; // Metadata generation time
  tables: Record<string, TableSchema>; // Metadata of all tables
}

/**
 * 元数据管理器类
 * 负责管理数据库的元数据信息，包括表结构、索引等
 * 提供元数据的加载、保存、更新和查询功能
 */
export class MetadataManager {
  private cache: DatabaseMeta = {
    version: CURRENT_VERSION,
    generatedAt: Date.now(),
    tables: {},
  };

  private dirty = false;
  private writing = false; // Prevent concurrent write conflicts
  private saveTimer: any = null; // Debounce timer
  private loadPromise: Promise<void> | null = null; // Track load method execution status

  constructor() {
    this.loadPromise = this.load(); // Async加载，不阻塞启动，但保存promise以便外部等待
  }

  // Load元数据（损坏自动重建）
  private async load() {
    try {
      const info = await FileSystem.getInfoAsync(META_FILE_PATH);
      if (!info.exists) throw new Error('File not exist');

      const text = await FileSystem.readAsStringAsync(META_FILE_PATH, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = JSON.parse(text);

      // check version
      if (parsed.version !== CURRENT_VERSION) {
        // future: add migration logic to upgrade the metadata version
      }

      this.cache = parsed;
    } catch (error) {
      this.cache = {
        version: CURRENT_VERSION,
        generatedAt: Date.now(),
        tables: {},
      };
      this.dirty = true;
      await this.save();
    }
  }

  // Wait加载完成（用于测试）
  async waitForLoad(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
    }
  }

  // Cleanup资源（用于测试）
  cleanup(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  // Save metadata immediately (for testing)
  async saveImmediately(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  // Lock Save (Prevent Concurrent Write)
  // Locked save (prevent concurrent write conflicts)
  private async save() {
    if (!this.dirty || this.writing) return;
    this.writing = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);

    try {
      this.cache.generatedAt = Date.now();

      // Ensure directory exists
      const dirPath = META_FILE_PATH.substring(0, META_FILE_PATH.lastIndexOf('/'));
      try {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      } catch (dirError) {
        // Directory creation failed, may already exist, ignore
        logger.warn(`MAKE DIRECTORY FAILED for ${dirPath}`, dirError);
      }

      // Write元数据文件
      await FileSystem.writeAsStringAsync(META_FILE_PATH, JSON.stringify(this.cache, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      this.dirty = false;
    } catch (error) {
      throw new StorageError('Metadata write failed', 'META_FILE_WRITE_ERROR', { cause: error });
    } finally {
      this.writing = false;
    }
  }

  private triggerSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // Use shorter delay in test to prevent test hanging
    const delay = typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 10 : 200;
    this.saveTimer = setTimeout(() => this.save(), delay);
  }

  // Get单表元数据
  get(tableName: string): TableSchema | undefined {
    // Sync访问：如果正在加载，返回 undefined（调用者应处理此情况）
    // Note: Load usually completes quickly, no issues
    return this.cache.tables[tableName];
  }

  // Async获取单表元数据（确保加载完成）
  async getAsync(tableName: string): Promise<TableSchema | undefined> {
    await this.waitForLoad();
    return this.cache.tables[tableName];
  }

  getPath(tableName: string): string {
    return this.cache.tables[tableName]?.path || `${tableName}.ldb`;
  }

  // Update表元数据（自动合并）
  update(tableName: string, updates: Partial<TableSchema>): void {
    const existing = this.cache.tables[tableName] || {
      mode: 'single',
      path: `${tableName}.ldb`,
      count: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      columns: {},
    };

    this.cache.tables[tableName] = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    this.triggerSave();
  }

  // Async更新表元数据（确保加载完成）
  async updateAsync(tableName: string, updates: Partial<TableSchema>): Promise<void> {
    // Ensure load complete before update
    await this.waitForLoad();

    this.update(tableName, updates);
  }

  // Sync更新（用于向后兼容，但会警告）
  updateSync(tableName: string, updates: Partial<TableSchema>): void {
    const existing = this.cache.tables[tableName] || {
      mode: 'single',
      path: `${tableName}.ldb`,
      count: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      columns: {},
    };

    this.cache.tables[tableName] = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    this.triggerSave();
  }

  // delete table
  delete(tableName: string) {
    delete this.cache.tables[tableName];
    this.triggerSave();
  }
  // all tables
  allTables(): string[] {
    return Object.keys(this.cache.tables);
  }

  // count records in table
  count(tableName: string): number {
    return this.cache.tables[tableName]?.count ?? 0;
  }

  // Debug用：查看完整元数据
  debugDump_checkMetaCache(): DatabaseMeta {
    return this.cache;
  }
}

// Singleton export + auto-load
export const meta = new MetadataManager();
