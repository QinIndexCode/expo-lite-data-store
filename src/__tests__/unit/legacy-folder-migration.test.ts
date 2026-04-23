import { configManager } from '../../core/config/ConfigManager';
import { createTable, db, findOne, insert, plainStorage, read } from '../../expo-lite-data-store';
import { getRootPath, resetRootPathState } from '../../utils/ROOTPath';
import { getFileSystem } from '../../utils/fileSystemCompat';

describe('legacy folder migration', () => {
  const tableName = 'legacy_folder_users';

  beforeEach(async () => {
    (global as any).__expo_file_system_mock__.mockFileSystem = {};
    configManager.resetConfig();
    resetRootPathState();
    await plainStorage.cleanup();
    await db.init();
  });

  afterEach(async () => {
    await plainStorage.cleanup();
    configManager.resetConfig();
    resetRootPathState();
    (global as any).__expo_file_system_mock__.mockFileSystem = {};
  });

  it('migrates legacy expo-lite-data content into lite-data-store when directory move is unavailable', async () => {
    const fileSystem = getFileSystem();
    const defaultRoot = await getRootPath();
    await fileSystem.deleteAsync(defaultRoot, { idempotent: true });

    configManager.updateConfig({
      storageFolder: 'expo-lite-data',
    });
    await plainStorage.cleanup();
    await db.init();

    const legacyRoot = await getRootPath();
    await createTable(tableName);
    await insert(tableName, {
      id: 'legacy-1',
      label: 'legacy-data',
    });

    configManager.resetConfig();
    await plainStorage.cleanup();
    await db.init();

    const migratedRoot = await getRootPath();
    const [defaultRootInfo, legacyRootInfo, migratedTableInfo] = await Promise.all([
      fileSystem.getInfoAsync(migratedRoot),
      fileSystem.getInfoAsync(legacyRoot),
      fileSystem.getInfoAsync(`${migratedRoot}${tableName}.ldb`),
    ]);

    expect(defaultRootInfo.exists).toBe(true);
    expect(legacyRootInfo.exists).toBe(false);
    expect(migratedTableInfo.exists).toBe(true);
    expect(await read(tableName)).toEqual([
      {
        id: 'legacy-1',
        label: 'legacy-data',
      },
    ]);
    expect(
      await findOne(tableName, {
        where: {
          id: 'legacy-1',
        },
      })
    ).toEqual({
      id: 'legacy-1',
      label: 'legacy-data',
    });
  });

  it('merges legacy data when the default root already exists but only contains empty bootstrap metadata', async () => {
    configManager.updateConfig({
      storageFolder: 'expo-lite-data',
    });
    await plainStorage.cleanup();
    await db.init();

    const legacyRoot = await getRootPath();
    await createTable(tableName);
    await insert(tableName, {
      id: 'legacy-2',
      label: 'legacy-bootstrap',
    });

    configManager.resetConfig();
    await plainStorage.cleanup();
    await db.init();

    const migratedRoot = await getRootPath();
    const fileSystem = getFileSystem();
    const [legacyRootInfo, migratedTableInfo] = await Promise.all([
      fileSystem.getInfoAsync(legacyRoot),
      fileSystem.getInfoAsync(`${migratedRoot}${tableName}.ldb`),
    ]);

    expect(legacyRootInfo.exists).toBe(false);
    expect(migratedTableInfo.exists).toBe(true);
    expect(
      await findOne(tableName, {
        where: {
          id: 'legacy-2',
        },
      })
    ).toEqual({
      id: 'legacy-2',
      label: 'legacy-bootstrap',
    });
  });
});
