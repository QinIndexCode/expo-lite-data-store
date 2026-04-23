/**
 * @module MetadataManager
 * @description Metadata manager for table schema and data tracking
 * @since 2025-11-19
 * @version 2.0.0
 */

import { StorageError } from '../../types/storageErrorInfc';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { ensureStorageRootReady } from '../../utils/ROOTPath';
import logger from '../../utils/logger';

const CURRENT_VERSION = '1.0.0';

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

export interface TableSchema {
  mode: 'single' | 'chunked';
  path: string;
  count: number;
  size?: number;
  lastId?: number;
  chunks?: number;
  createdAt: number;
  updatedAt: number;
  columns: ColumnSchema;
  indexes?: Record<string, 'unique' | 'normal'>;
  isHighRisk?: boolean;
  highRiskFields?: string[];
  encryptedFields?: string[];
  encrypted?: boolean;
  encryptFullTable?: boolean;
}

export interface DatabaseMeta {
  version: string;
  generatedAt: number;
  tables: Record<string, TableSchema>;
}

/**
 * Metadata manager responsible for table schemas and counters.
 */
export class MetadataManager {
  private cache: DatabaseMeta = {
    version: CURRENT_VERSION,
    generatedAt: Date.now(),
    tables: {},
  };

  private dirty = false;
  private writing = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.loadPromise = this.load();
  }

  private async getMetaFilePath(): Promise<string> {
    const rootPath = await ensureStorageRootReady();
    return `${rootPath}meta.ldb`;
  }

  private async load() {
    try {
      const fileSystem = getFileSystem();
      const metaFilePath = await this.getMetaFilePath();
      const info = await fileSystem.getInfoAsync(metaFilePath);
      if (!info.exists) throw new Error('File not exist');

      const text = await fileSystem.readAsStringAsync(metaFilePath, {
        encoding: getEncodingType().UTF8,
      });
      const parsed = JSON.parse(text);

      if (parsed.version !== CURRENT_VERSION) {
        // Reserved for future metadata migrations.
      }

      this.cache = parsed;
    } catch {
      this.cache = {
        version: CURRENT_VERSION,
        generatedAt: Date.now(),
        tables: {},
      };
      this.dirty = true;
      await this.save();
    }
  }

  async waitForLoad(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
    }
  }

  async reload(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.loadPromise = this.load();
    await this.loadPromise;
  }

  cleanup(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  async saveImmediately(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  private async save() {
    if (!this.dirty || this.writing) return;
    this.writing = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);

    try {
      const fileSystem = getFileSystem();
      const metaFilePath = await this.getMetaFilePath();
      this.cache.generatedAt = Date.now();

      const dirPath = metaFilePath.substring(0, metaFilePath.lastIndexOf('/'));
      try {
        await fileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      } catch (dirError) {
        logger.warn(`MAKE DIRECTORY FAILED for ${dirPath}`, dirError);
      }

      await fileSystem.writeAsStringAsync(metaFilePath, JSON.stringify(this.cache, null, 2), {
        encoding: getEncodingType().UTF8,
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
    const delay = typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 10 : 200;
    this.saveTimer = setTimeout(() => {
      this.save().catch(error => {
        logger.error('[MetadataManager] Failed to persist metadata:', error);
      });
    }, delay);
  }

  get(tableName: string): TableSchema | undefined {
    return this.cache.tables[tableName];
  }

  async getAsync(tableName: string): Promise<TableSchema | undefined> {
    await this.waitForLoad();
    return this.cache.tables[tableName];
  }

  getPath(tableName: string): string {
    return this.cache.tables[tableName]?.path || `${tableName}.ldb`;
  }

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

  async updateAsync(tableName: string, updates: Partial<TableSchema>): Promise<void> {
    await this.waitForLoad();
    this.update(tableName, updates);
  }

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

  delete(tableName: string) {
    delete this.cache.tables[tableName];
    this.triggerSave();
  }

  allTables(): string[] {
    return Object.keys(this.cache.tables);
  }

  count(tableName: string): number {
    return this.cache.tables[tableName]?.count ?? 0;
  }

  debugDump_checkMetaCache(): DatabaseMeta {
    return this.cache;
  }
}

export const meta = new MetadataManager();
