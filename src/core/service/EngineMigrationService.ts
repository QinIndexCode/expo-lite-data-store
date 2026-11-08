import { meta, type TableSchema } from '../meta/MetadataManager';
import storage, { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import { SQLiteStorageAdapter } from '../adapter/SQLiteStorageAdapter';
import { configManager } from '../config/ConfigManager';
import { writePersistedEnginePreference } from '../config/EnginePreference';
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
   * If true, replaces data in destination tables that already hold records.
   * Defaults to false: a non-empty destination table fails the migration with
   * MIGRATION_DEST_NOT_EMPTY instead of being silently overwritten.
   */
  overwriteExisting?: boolean;
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
    // Hydrate the persisted engine marker first so this decision matches the
    // engine a fresh launch would resolve (a previous migration may have
    // persisted the marker but crashed before the in-memory switch).
    await dbManager.loadPersistedEnginePreference();
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
    const newlyCreatedTables: string[] = [];
    // Both engines share one metadata store, so clearing a source table after
    // migration also resets the shared count. Capture the verified destination
    // counts first and republish them after cleanup, otherwise count() reports
    // an empty migrated table until the asynchronous validator repairs it.
    const verifiedCounts = new Map<string, number>();
    let totalRecords = 0;

    // Shared metadata makes hasTable() true for every source table on the
    // destination surface, so occupancy must be measured against the
    // destination's physical rows, not metadata.
    const destPhysicalCounts = new Map<string, number>();
    for (const tableName of tableNames) {
      destPhysicalCounts.set(tableName, await getDestPhysicalRecordCount(destEngine, tableName));
    }

    const occupiedTables = tableNames.filter(tableName => (destPhysicalCounts.get(tableName) ?? 0) > 0);
    if (occupiedTables.length > 0 && options?.overwriteExisting !== true) {
      throw new StorageError(
        `Destination engine already holds data for ${occupiedTables.length} table(s): ${occupiedTables.join(', ')}`,
        'MIGRATION_DEST_NOT_EMPTY',
        {
          details:
            'Engine migration refuses to overwrite non-empty destination tables by default to protect both engines from accidental data loss.',
          suggestion:
            'Pass overwriteExisting: true to replace destination data, or clean the destination engine first.',
        }
      );
    }

    for (const tableName of tableNames) {
      if ((destPhysicalCounts.get(tableName) ?? 0) === 0) {
        newlyCreatedTables.push(tableName);
      }
    }

    try {
      for (const tableName of tableNames) {
        const metaInspector = sourceEngine as { getTableMeta?: (name: string) => TableSchema | undefined };
        const tableMeta =
          typeof metaInspector.getTableMeta === 'function'
            ? metaInspector.getTableMeta(tableName)
            : meta.get(tableName);
        const records = await sourceEngine.read(tableName, { bypassCache: true });

        // Both engines read table existence from the shared metadata store, and
        // every name here came from that same store, so the destination always
        // reports the table as existing. overwrite() creates the physical table
        // (or SQL table) when the destination engine holds no rows for it yet.
        await destEngine.overwrite(tableName, records);

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

        // Verify row counts match. The physical adapter re-reads the destination
        // instead of trusting the shared metadata count, which both engines
        // publish from the same store and could mask a failed write.
        const destCount = await getVerifiedDestCount(destEngine, tableName, tableMeta?.encryptFullTable === true);
        if (destCount !== records.length) {
          throw new StorageError(
            `Migration verification failed for table '${tableName}': expected ${records.length} records, got ${destCount}`,
            'WRITTEN_COUNT_MISMATCH'
          );
        }

        totalRecords += records.length;
        migratedTables.push(tableName);
        // Publish the logical record count verified above; a full-table
        // encrypted destination reports one physical envelope, not N rows.
        verifiedCounts.set(tableName, records.length);

        if (options?.progressCallback) {
          options.progressCallback({
            table: tableName,
            copied: records.length,
            total: totalRecords,
          });
        }
      }
    } catch (migrationError) {
      logger.error(
        '[EngineMigrationService] Migration failed. Clearing destination rows written during this attempt...',
        migrationError
      );
      // Both engines share one metadata file, so deleteTable() would also
      // destroy the source engine's view of the table. Clearing destination
      // rows restores the pre-migration physical state while the untouched
      // source data stays readable.
      for (const tableToClean of newlyCreatedTables) {
        try {
          await destEngine.clearTable(tableToClean);
        } catch (cleanupErr) {
          logger.warn(`[EngineMigrationService] Rollback cleanup failed for table '${tableToClean}'`, cleanupErr);
        }
      }
      throw migrationError;
    }

    // Persist the engine choice BEFORE clearing the source. setConfig alone
    // is memory-only; without the marker the next launch would silently fall
    // back to the file-system engine — and with cleanSource that would
    // present as total data loss.
    await writePersistedEnginePreference(targetEngine);
    dbManager.setPersistedEnginePreference(targetEngine);

    // If source cleanup was requested, clear data from source engine
    if (options?.cleanSource) {
      for (const tableName of tableNames) {
        try {
          await sourceEngine.clearTable(tableName);
        } catch (cleanError) {
          logger.warn(`[EngineMigrationService] Failed to clean source table '${tableName}'`, cleanError);
        }
      }

      // Source clears write the shared metadata count back to zero, so restore
      // the counts already verified against the destination data.
      for (const tableName of migratedTables) {
        const verifiedCount = verifiedCounts.get(tableName);
        if (verifiedCount !== undefined) {
          meta.update(tableName, { count: verifiedCount });
        }
      }
      await meta.saveImmediately?.();
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

const getDestPhysicalRecordCount = async (
  destEngine: FileSystemStorageAdapter | SQLiteStorageAdapter,
  tableName: string
): Promise<number> => {
  if (typeof destEngine.getPhysicalRecordCount === 'function') {
    return destEngine.getPhysicalRecordCount(tableName);
  }
  return 0;
};

/**
 * Verifies the destination without trusting the shared metadata count.
 * A full-table encrypted destination stores one envelope for many logical
 * rows, so its verifyCount() cannot validate logical rows; count() remains
 * authoritative there because only the encrypted facade can verify it.
 */
const getVerifiedDestCount = async (
  destEngine: FileSystemStorageAdapter | SQLiteStorageAdapter,
  tableName: string,
  encryptFullTable: boolean
): Promise<number> => {
  if (!encryptFullTable) {
    const { actual } = await destEngine.verifyCount(tableName);
    return actual;
  }
  return destEngine.count(tableName);
};

export const migrateEngine = EngineMigrationService.migrateEngine;
