import { meta } from '../../meta/MetadataManager';
import { configManager } from '../../config/ConfigManager';
import { dbManager } from '../../db';
import storage from '../../adapter/FileSystemStorageAdapter';
import { SQLiteStorageAdapter } from '../../adapter/SQLiteStorageAdapter';
import { migrateEngine } from '../EngineMigrationService';

describe('EngineMigrationService', () => {
  beforeEach(async () => {
    configManager.setConfig({ engine: 'file-system' });
    dbManager.resetInstances();
    meta.cleanup();
  });

  afterEach(async () => {
    configManager.setConfig({ engine: 'file-system' });
    dbManager.resetInstances();
    meta.cleanup();
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
});
