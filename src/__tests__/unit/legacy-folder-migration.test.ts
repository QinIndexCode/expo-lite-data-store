/// <reference path="../test-globals.d.ts" />

import { configManager } from '../../core/config/ConfigManager';
import { plainStorage } from '../../core/db';
import { createTable, db, findOne, insert, read } from '../../expo-lite-data-store';
import { getRootPath, resetRootPathState } from '../../utils/ROOTPath';
import { getFileSystem } from '../../utils/fileSystemCompat';

describe('legacy folder migration', () => {
  const tableName = 'legacy_folder_users';

  beforeEach(async () => {
    global.__expo_file_system_mock__.mockFileSystem = {};
    configManager.resetConfig();
    resetRootPathState();
    await plainStorage.cleanup();
    await db.init();
  });

  afterEach(async () => {
    await plainStorage.cleanup();
    configManager.resetConfig();
    resetRootPathState();
    global.__expo_file_system_mock__.mockFileSystem = {};
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
    const fileSystem = getFileSystem();
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

    const moveAsync = fileSystem.moveAsync.bind(fileSystem);
    const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
      if ((await fileSystem.getInfoAsync(options.to)).exists) {
        throw new Error(`Destination already exists: ${options.to}`);
      }
      await moveAsync(options);
    });

    try {
      configManager.resetConfig();
      await plainStorage.cleanup();
      await db.init();
    } finally {
      moveSpy.mockRestore();
    }

    const migratedRoot = await getRootPath();
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

  it('preserves a corrupted current root instead of treating it as empty', async () => {
    const fileSystem = getFileSystem();
    const defaultRoot = await getRootPath();

    configManager.updateConfig({ storageFolder: 'expo-lite-data' });
    await plainStorage.cleanup();
    await db.init();
    const legacyRoot = await getRootPath();
    await createTable(tableName);
    await insert(tableName, { id: 'legacy-preserved' });

    global.__expo_file_system_mock__.mockFileSystem[`${defaultRoot}meta.ldb`] = 'corrupted-current-metadata';
    configManager.resetConfig();
    resetRootPathState();

    await expect(getRootPath()).resolves.toBe(defaultRoot);

    const [legacyRootInfo, migratedTableInfo] = await Promise.all([
      fileSystem.getInfoAsync(legacyRoot),
      fileSystem.getInfoAsync(`${defaultRoot}${tableName}.ldb`),
    ]);
    expect(legacyRootInfo.exists).toBe(true);
    expect(migratedTableInfo.exists).toBe(false);
    expect(global.__expo_file_system_mock__.mockFileSystem[`${defaultRoot}meta.ldb`]).toBe(
      'corrupted-current-metadata'
    );
  });
});
