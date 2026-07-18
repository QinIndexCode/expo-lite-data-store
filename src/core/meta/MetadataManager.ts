/**
 * @module MetadataManager
 * @description Metadata manager for table schema and data tracking
 * @since 2025-11-19
 * @version 3.0.0
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
  /** Whether this encrypted table is bound to the per-access authentication key scope. */
  requireAuthOnAccess?: boolean;
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
  private savePromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void> | null = null;
  private metaFilePath: string | null = null;

  constructor() {}

  private async getCurrentRootMetaFilePath(): Promise<string> {
    const rootPath = await ensureStorageRootReady();
    return `${rootPath}meta.ldb`;
  }

  private async getMetaFilePath(): Promise<string> {
    if (!this.metaFilePath) {
      this.metaFilePath = await this.getCurrentRootMetaFilePath();
    }

    return this.metaFilePath;
  }

  private async load() {
    const fileSystem = getFileSystem();
    const metaFilePath = await this.getCurrentRootMetaFilePath();
    this.metaFilePath = metaFilePath;
    const info = await fileSystem.getInfoAsync(metaFilePath);

    if (!info.exists) {
      this.cache = {
        version: CURRENT_VERSION,
        generatedAt: Date.now(),
        tables: {},
      };
      this.dirty = true;
      await this.save();
      return;
    }

    try {
      const text = await fileSystem.readAsStringAsync(metaFilePath, {
        encoding: getEncodingType().UTF8,
      });
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object' || !parsed.tables || typeof parsed.tables !== 'object') {
        throw new Error('Metadata file has an invalid structure');
      }

      if (parsed.version !== CURRENT_VERSION) {
        // Reserved for future metadata migrations.
      }

      this.cache = parsed;
      this.dirty = false;
    } catch (error) {
      throw new StorageError('Metadata read failed: metadata file is corrupted or unreadable', 'META_FILE_READ_ERROR', {
        cause: error,
        details: `Refusing to overwrite existing metadata file: ${metaFilePath}`,
        suggestion: 'Restore metadata from a known-good backup or repair it before reopening the database',
      });
    }
  }

  async waitForLoad(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    await this.loadPromise;
  }

  async reload(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await this.save();
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

  private async persistSnapshot(snapshot: DatabaseMeta, metaFilePath: string): Promise<void> {
    const fileSystem = getFileSystem();
    const tempMetaFilePath = `${metaFilePath}.tmp`;
    const dirPath = metaFilePath.substring(0, metaFilePath.lastIndexOf('/'));

    try {
      await fileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
    } catch (dirError) {
      logger.warn(`MAKE DIRECTORY FAILED for ${dirPath}`, dirError);
    }

    try {
      await fileSystem.writeAsStringAsync(tempMetaFilePath, JSON.stringify(snapshot, null, 2), {
        encoding: getEncodingType().UTF8,
      });
      await fileSystem.moveAsync({ from: tempMetaFilePath, to: metaFilePath });
    } catch (error) {
      try {
        await fileSystem.deleteAsync(tempMetaFilePath, { idempotent: true });
      } catch (cleanupError) {
        logger.warn(`DELETE TEMP METADATA FAILED for ${tempMetaFilePath}`, cleanupError);
      }
      throw error;
    }
  }

  private async flushDirtyState(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      const metaFilePath = await this.getMetaFilePath();
      const snapshot: DatabaseMeta = {
        ...this.cache,
        generatedAt: Date.now(),
        tables: { ...this.cache.tables },
      };

      try {
        await this.persistSnapshot(snapshot, metaFilePath);
        this.cache.generatedAt = snapshot.generatedAt;
      } catch (error) {
        this.dirty = true;
        throw new StorageError('Metadata write failed', 'META_FILE_WRITE_ERROR', { cause: error });
      }
    }
  }

  private async save(): Promise<void> {
    if (this.savePromise) {
      await this.savePromise;
      if (this.dirty) {
        await this.save();
      }
      return;
    }

    if (!this.dirty) return;

    const savePromise = this.flushDirtyState();
    this.savePromise = savePromise;
    try {
      await savePromise;
    } finally {
      if (this.savePromise === savePromise) {
        this.savePromise = null;
      }
    }

    if (this.dirty) {
      await this.save();
    }
  }

  private triggerSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 10 : 200;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
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
