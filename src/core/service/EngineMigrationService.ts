import { meta, type TableSchema } from '../meta/MetadataManager';
import storage, { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import { SQLiteStorageAdapter } from '../adapter/SQLiteStorageAdapter';
import { configManager } from '../config/ConfigManager';
import { dbManager } from '../db';
import { StorageError } from '../../types/storageErrorInfc';
import logger from '../../utils/logger';

export interface MigrateEngineOptions {
  /**
   * If true, clears data from the source storage engine after migration succeeds.
   * Defaults to false.
   */
  cleanSource?: boolean;
  /**
   * Optional callback to track migration progress table by table.
   */
  progressCallback?: (progress: { table: string; copied: number; total: number }) => void;
}

export interface MigrationResult {
  fromEngine: 'file-system' | 'sqlite';
  toEngine: 'file-system' | 'sqlite';
  migratedTables: string[];
  totalRecords: number;
  durationMs: number;
}

export class EngineMigrationService {
  /**
   * Migrates all existing tables and data between the FileSystem engine and the SQLite engine.
   */
  static async migrateEngine(
    targetEngine: 'file-system' | 'sqlite',
    options?: MigrateEngineOptions
  ): Promise<MigrationResult> {
    if (targetEngine !== 'file-system' && targetEngine !== 'sqlite') {
      throw new StorageError(
        `Invalid target engine: '${String(targetEngine)}'. Must be 'file-system' or 'sqlite'.`,
        'MIGRATION_FAILED'
      );
    }

    const startTime = Date.now();
    const fromEngine = dbManager.resolveActiveEngine();

    if (fromEngine === targetEngine) {
      logger.info(`[EngineMigrationService] Already running on target engine '${targetEngine}'. No migration needed.`);
      return {
        fromEngine,
        toEngine: targetEngine,
        migratedTables: [],
        totalRecords: 0,
        durationMs: Date.now() - startTime,
      };
    }

    logger.info(`[EngineMigrationService] Starting engine migration from '${fromEngine}' to '${targetEngine}'...`);

    const sourceEngine = fromEngine === 'sqlite' ? new SQLiteStorageAdapter(meta) : storage;
    const destEngine = targetEngine === 'sqlite' ? new SQLiteStorageAdapter(meta) : new FileSystemStorageAdapter(meta);

    await sourceEngine.ensureInitialized();
    await destEngine.ensureInitialized();

    const tableNames = await sourceEngine.listTables();
    const migratedTables: string[] = [];
    let totalRecords = 0;

    for (const tableName of tableNames) {
      const metaInspector = sourceEngine as { getTableMeta?: (name: string) => TableSchema | undefined };
      const tableMeta =
        typeof metaInspector.getTableMeta === 'function' ? metaInspector.getTableMeta(tableName) : meta.get(tableName);
      const records = await sourceEngine.read(tableName, { bypassCache: true });

      const targetHasTable = await destEngine.hasTable(tableName);
      if (!targetHasTable) {
        await destEngine.createTable(tableName, {
          columns: tableMeta?.columns,
          encrypted: tableMeta?.encrypted,
          requireAuthOnAccess: tableMeta?.requireAuthOnAccess,
          encryptedFields: tableMeta?.encryptedFields,
          encryptFullTable: tableMeta?.encryptFullTable,
          initialData: records,
        });
      } else {
        await destEngine.overwrite(tableName, records);
      }

      // If table had index definitions, recreate them on the destination engine
      const indexes = tableMeta?.indexes;
      if (indexes && typeof destEngine.createIndex === 'function') {
        for (const [indexKey, indexType] of Object.entries(indexes)) {
          const field = indexKey.endsWith(`_${indexType}`) ? indexKey.slice(0, -(indexType.length + 1)) : indexKey;
          try {
            await destEngine.createIndex(tableName, field, indexType === 'unique');
          } catch (indexError) {
            logger.warn(
              `[EngineMigrationService] Could not recreate index for table '${tableName}' on field '${field}'`,
              indexError
            );
          }
        }
      }

      // Verify row counts match
      const destCount = await destEngine.count(tableName);
      if (destCount !== records.length) {
        throw new StorageError(
          `Migration verification failed for table '${tableName}': expected ${records.length} records, got ${destCount}`,
          'WRITTEN_COUNT_MISMATCH'
        );
      }

      totalRecords += records.length;
      migratedTables.push(tableName);

      if (options?.progressCallback) {
        options.progressCallback({
          table: tableName,
          copied: records.length,
          total: totalRecords,
        });
      }
    }

    // If source cleanup was requested, clear data from source engine
    if (options?.cleanSource) {
      for (const tableName of tableNames) {
        try {
          await sourceEngine.clearTable(tableName);
        } catch (cleanError) {
          logger.warn(`[EngineMigrationService] Failed to clean source table '${tableName}'`, cleanError);
        }
      }
    }

    // Switch active runtime engine configuration and reset cached adapter instances
    configManager.setConfig({ engine: targetEngine });
    await dbManager.resetInstances();

    const durationMs = Date.now() - startTime;
    logger.info(
      `[EngineMigrationService] Engine migration to '${targetEngine}' completed in ${durationMs}ms. Migrated ${migratedTables.length} tables (${totalRecords} records).`
    );

    return {
      fromEngine,
      toEngine: targetEngine,
      migratedTables,
      totalRecords,
      durationMs,
    };
  }
}

export const migrateEngine = EngineMigrationService.migrateEngine;
