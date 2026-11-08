import { meta } from '../../meta/MetadataManager';
import { configManager } from '../../config/ConfigManager';
import { dbManager } from '../../db';
import storage, { FileSystemStorageAdapter } from '../../adapter/FileSystemStorageAdapter';
import { migrateEngine } from '../EngineMigrationService';
import { clearPersistedEnginePreference, readPersistedEnginePreference } from '../../config/EnginePreference';

const SQLITE_DATABASE_NAME = 'expo-lite-data-store.db';

type SqliteMockState = {
  databases: Record<string, unknown[]>;
  syncDbs: Record<string, unknown>;
};

type GlobalWithExpoConfig = typeof globalThis & {
  __expoConfig?: unknown;
  __expo_sqlite_mock__: SqliteMockState;
};

const globalState = global as GlobalWithExpoConfig;

const getSqliteMockState = (): SqliteMockState => globalState.__expo_sqlite_mock__;

/** Simulates an `engine` value coming from app.json, not a programmatic setConfig call. */
const simulateAppConfigEngine = (engine: 'sqlite' | 'auto'): void => {
  globalState.__expoConfig = { extra: { liteStore: { engine } } };
  configManager.resetConfig();
};

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

const resetRuntime = async (): Promise<void> => {
  delete globalState.__expoConfig;
  configManager.resetConfig();
  dbManager.resetInstances();
  dbManager.setPersistedEnginePreference(null);
  await clearPersistedEnginePreference();
  await clearLeftoverState();
  meta.cleanup();
};

const coldStart = async (): Promise<void> => {
  configManager.resetConfig();
  dbManager.resetInstances();
  dbManager.setPersistedEnginePreference(null);
  await dbManager.loadPersistedEnginePreference();
};

describe('EngineMigrationService engine config precedence', () => {
  beforeEach(async () => {
    await resetRuntime();
  });

  afterEach(async () => {
    await resetRuntime();
  });

  it('keeps file-system after a cleanSource migration when app config asks for sqlite', async () => {
    simulateAppConfigEngine('sqlite');
    expect(configManager.getConfig().engine).toBe('sqlite');
    expect(configManager.hasExplicitEngineChoice()).toBe(false);

    const sqliteEngine = dbManager.getDbInstance();
    await sqliteEngine.createTable('config_precedence_users', {
      initialData: [{ id: 1, name: 'Alice' }],
    });

    await migrateEngine('file-system', { cleanSource: true });
    expect(await readPersistedEnginePreference()).toBe('file-system');

    await coldStart();

    expect(configManager.getConfig().engine).toBe('sqlite');
    expect(configManager.hasExplicitEngineChoice()).toBe(false);
    expect(dbManager.resolveActiveEngine()).toBe('file-system');
    expect(await dbManager.getDbInstance().read('config_precedence_users', { bypassCache: true })).toHaveLength(1);
  });

  it('keeps file-system after a cleanSource migration when app config asks for auto', async () => {
    simulateAppConfigEngine('auto');
    expect(configManager.getConfig().engine).toBe('auto');
    expect(configManager.hasExplicitEngineChoice()).toBe(false);
    expect(dbManager.resolveActiveEngine()).toBe('sqlite');

    const sqliteEngine = dbManager.getDbInstance();
    await sqliteEngine.createTable('config_precedence_auto_users', {
      initialData: [{ id: 1, name: 'Bob' }],
    });

    await migrateEngine('file-system', { cleanSource: true });
    expect(await readPersistedEnginePreference()).toBe('file-system');

    await coldStart();

    expect(configManager.getConfig().engine).toBe('auto');
    expect(configManager.hasExplicitEngineChoice()).toBe(false);
    expect(dbManager.resolveActiveEngine()).toBe('file-system');
    expect(await dbManager.getDbInstance().read('config_precedence_auto_users', { bypassCache: true })).toHaveLength(1);
  });

  it('reports migrated row counts immediately after a cleanSource migration', async () => {
    simulateAppConfigEngine('sqlite');
    const sqliteEngine = dbManager.getDbInstance();
    await sqliteEngine.createTable('config_precedence_counts', {
      initialData: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });

    await migrateEngine('file-system', { cleanSource: true });
    expect(await readPersistedEnginePreference()).toBe('file-system');

    // The source cleanup shares one metadata store with the destination, so the
    // count must be republished before count() is called again.
    const fileSystemEngine = dbManager.getDbInstance();
    expect(await fileSystemEngine.count('config_precedence_counts')).toBe(2);
    expect(meta.count('config_precedence_counts')).toBe(2);
  });

  it('verifies the destination with a physical count instead of the shared metadata count', async () => {
    simulateAppConfigEngine('sqlite');
    const sqliteEngine = dbManager.getDbInstance();
    await sqliteEngine.createTable('config_precedence_verify', {
      initialData: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });

    const verifySpy = jest.spyOn(FileSystemStorageAdapter.prototype, 'verifyCount');
    try {
      await migrateEngine('file-system');

      expect(verifySpy).toHaveBeenCalledWith('config_precedence_verify');
      expect(await dbManager.getDbInstance().count('config_precedence_verify')).toBe(2);
    } finally {
      verifySpy.mockRestore();
    }
  });
});
