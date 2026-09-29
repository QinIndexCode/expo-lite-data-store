import { meta } from '../../meta/MetadataManager';
import { configManager } from '../../config/ConfigManager';
import { dbManager } from '../../db';
import storage from '../../adapter/FileSystemStorageAdapter';
import { SQLiteStorageAdapter } from '../../adapter/SQLiteStorageAdapter';
import { migrateEngine } from '../EngineMigrationService';
import { clearPersistedEnginePreference, readPersistedEnginePreference } from '../../config/EnginePreference';

const SQLITE_DATABASE_NAME = 'expo-lite-data-store.db';

type SqliteMockState = {
  databases: Record<string, unknown[]>;
  syncDbs: Record<string, unknown>;
};

const getSqliteMockState = (): SqliteMockState =>
  (global as unknown as { __expo_sqlite_mock__: SqliteMockState }).__expo_sqlite_mock__;

/**
 * Both engines share one metadata file, so tables seeded by a previous test
 * stay visible to listTables() and would poison the destination-occupancy
 * check (leftover sqlite rows make every later migration fail).
 */
const clearLeftoverState = async (): Promise<void> => {
  for (const tableName of meta.allTables()) {
    try {
      await storage.deleteTable(tableName);
    } catch {
      // The physical file may be gone; metadata removal is what matters here.
    }
  }
  delete getSqliteMockState().databases[SQLITE_DATABASE_NAME];
  delete getSqliteMockState().syncDbs[SQLITE_DATABASE_NAME];
};

describe('EngineMigrationService', () => {
  beforeEach(async () => {
    configManager.setConfig({ engine: 'file-system' });
    dbManager.resetInstances();
    meta.cleanup();
    await clearPersistedEnginePreference();
    await clearLeftoverState();
  });

  afterEach(async () => {
    configManager.setConfig({ engine: 'file-system' });
    dbManager.resetInstances();
    meta.cleanup();
    await clearPersistedEnginePreference();
    await clearLeftoverState();
  });

  it('rejects invalid target engines', async () => {
    await expect(migrateEngine('unsupported' as unknown as 'sqlite')).rejects.toMatchObject({
      code: 'MIGRATION_FAILED',
    });
  });

  it('returns early when target engine is already active', async () => {
    const result = await migrateEngine('file-system');
    expect(result).toMatchObject({
      fromEngine: 'file-system',
      toEngine: 'file-system',
      migratedTables: [],
      totalRecords: 0,
    });
  });

  it('migrates data bidirectionally between file-system and sqlite', async () => {
    // 1. Seed data in file-system
    const fsTable = 'migration_users';
    await storage.createTable(fsTable, {
      initialData: [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ],
      indexes: ['name'],
    });

    const initialFsCount = await storage.count(fsTable);
    expect(initialFsCount).toBe(2);

    // 2. Migrate to SQLite
    const progressUpdates: Array<{ table: string; copied: number; total: number }> = [];
    const forwardResult = await migrateEngine('sqlite', {
      cleanSource: true,
      progressCallback: p => progressUpdates.push(p),
    });

    expect(forwardResult.fromEngine).toBe('file-system');
    expect(forwardResult.toEngine).toBe('sqlite');
    expect(forwardResult.migratedTables).toContain(fsTable);
    expect(forwardResult.totalRecords).toBe(2);
    expect(configManager.getConfig().engine).toBe('sqlite');
    expect(progressUpdates.length).toBeGreaterThan(0);

    // Verify data in SQLite
    const sqliteAdapter = new SQLiteStorageAdapter(meta);
    const sqliteRecords = await sqliteAdapter.read(fsTable);
    expect(sqliteRecords).toHaveLength(2);
    expect(sqliteRecords.map(r => r.name)).toEqual(['Alice', 'Bob']);

    // Verify source was cleaned
    const fsCountAfterClean = await storage.count(fsTable);
    expect(fsCountAfterClean).toBe(0);

    // 3. Migrate back from SQLite to FileSystem
    const backwardResult = await migrateEngine('file-system', {
      cleanSource: false,
    });

    expect(backwardResult.fromEngine).toBe('sqlite');
    expect(backwardResult.toEngine).toBe('file-system');
    expect(configManager.getConfig().engine).toBe('file-system');

    // Verify data in FileSystem
    const restoredFsRecords = await storage.read(fsTable);
    expect(restoredFsRecords).toHaveLength(2);
    expect(restoredFsRecords.map(r => r.name)).toEqual(['Alice', 'Bob']);
  });

  describe('engine choice persistence', () => {
    it('persists the migrated engine so a restart does not fall back to file-system', async () => {
      const table = 'marker_users';
      await storage.createTable(table, { initialData: [{ id: 1, name: 'Alice' }] });

      await migrateEngine('sqlite', { cleanSource: true });

      // The marker file is the only durable record of the choice.
      expect(await readPersistedEnginePreference()).toBe('sqlite');

      // Simulate a cold start: no explicit runtime choice, no cached instances,
      // and the in-memory marker mirror starts empty.
      configManager.resetConfig();
      dbManager.resetInstances();
      dbManager.setPersistedEnginePreference(null);
      await dbManager.loadPersistedEnginePreference();
      expect(dbManager.resolveActiveEngine()).toBe('sqlite');

      // An explicit runtime choice still wins over the persisted marker.
      configManager.setConfig({ engine: 'file-system' });
      expect(dbManager.resolveActiveEngine()).toBe('file-system');
    });

    it('does not persist a marker when the migration fails', async () => {
      const table = 'marker_fail_users';
      await storage.createTable(table, { initialData: [{ id: 1, name: 'Alice' }] });

      const overwriteSpy = jest
        .spyOn(SQLiteStorageAdapter.prototype, 'overwrite')
        .mockRejectedValue(new Error('mocked copy failure'));
      await expect(migrateEngine('sqlite')).rejects.toThrow('mocked copy failure');
      overwriteSpy.mockRestore();

      expect(await readPersistedEnginePreference()).toBeNull();
      expect(configManager.getConfig().engine).toBe('file-system');
    });
  });

  describe('destination occupancy guard', () => {
    it('fails fast with MIGRATION_DEST_NOT_EMPTY when dest tables hold rows', async () => {
      const table = 'guard_users';
      await storage.createTable(table, {
        initialData: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      });

      // Shared metadata hides physical occupancy from hasTable(), so seed the
      // destination's real rows directly.
      const sqliteAdapter = new SQLiteStorageAdapter(meta);
      await sqliteAdapter.write(table, [{ id: 99, name: 'Stale' }]);

      await expect(migrateEngine('sqlite')).rejects.toMatchObject({
        code: 'MIGRATION_DEST_NOT_EMPTY',
      });

      // The guard must not mutate source data, config, or the marker.
      expect(await storage.read(table, { bypassCache: true })).toHaveLength(2);
      expect(configManager.getConfig().engine).toBe('file-system');
      expect(await readPersistedEnginePreference()).toBeNull();

      // overwriteExisting: true replaces the stale destination rows.
      const result = await migrateEngine('sqlite', { overwriteExisting: true });
      expect(result.migratedTables).toContain(table);
      expect(result.totalRecords).toBe(2);

      const destRecords = await sqliteAdapter.read(table);
      expect(destRecords).toHaveLength(2);
      expect(destRecords.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('rolls back destination rows when a table copy fails midway', async () => {
      const alpha = 'rollback_alpha';
      const beta = 'rollback_beta';
      await storage.createTable(alpha, { initialData: [{ id: 1, name: 'A1' }] });
      await storage.createTable(beta, { initialData: [{ id: 1, name: 'B1' }] });

      type OverwriteFn = SQLiteStorageAdapter['overwrite'];
      const originalOverwrite: OverwriteFn = SQLiteStorageAdapter.prototype.overwrite;
      const overwriteSpy = jest.spyOn(SQLiteStorageAdapter.prototype, 'overwrite').mockImplementation(function (
        this: SQLiteStorageAdapter,
        tableName: string,
        data: Parameters<OverwriteFn>[1],
        options?: Parameters<OverwriteFn>[2]
      ) {
        if (tableName === beta) {
          return Promise.reject(new Error('mocked copy failure'));
        }
        return originalOverwrite.call(this, tableName, data, options);
      });

      await expect(migrateEngine('sqlite')).rejects.toThrow('mocked copy failure');
      overwriteSpy.mockRestore();

      // Rollback clears dest rows written during this attempt while the source
      // stays fully intact.
      const sqliteAdapter = new SQLiteStorageAdapter(meta);
      expect(await sqliteAdapter.getPhysicalRecordCount(alpha)).toBe(0);
      expect(await sqliteAdapter.getPhysicalRecordCount(beta)).toBe(0);
      expect(await storage.read(alpha, { bypassCache: true })).toHaveLength(1);
      expect(await storage.read(beta, { bypassCache: true })).toHaveLength(1);

      expect(configManager.getConfig().engine).toBe('file-system');
      expect(await readPersistedEnginePreference()).toBeNull();
    });
  });
});
