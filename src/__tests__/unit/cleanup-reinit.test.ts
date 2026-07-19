/// <reference path="../test-globals.d.ts" />

import { configManager } from '../../core/config/ConfigManager';
import { MetadataManager } from '../../core/meta/MetadataManager';
import { plainStorage } from '../../core/db';
import { db, findOne, hasTable, insert, read, createTable } from '../../expo-lite-data-store';
import { getRootPath, resetRootPathState } from '../../utils/ROOTPath';

type StorageTestAccess = {
  metadataManager: MetadataManager;
};

type PersistedMetadata = {
  tables: Record<string, { count: number }>;
};

const getStorageTestAccess = (storage: object): StorageTestAccess => storage as unknown as StorageTestAccess;

describe('cleanup and reinit runtime state', () => {
  const tableName = 'cleanup_reinit_users';

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

  it('reloads metadata for the active root and clears stale filtered cache entries', async () => {
    configManager.updateConfig({
      storageFolder: 'qa-root-a',
    });
    await plainStorage.cleanup();
    await db.init();

    await createTable(tableName);
    await insert(tableName, {
      id: 'other',
      label: 'old-root',
    });

    const firstRoot = await getRootPath();
    const metadataManager = getStorageTestAccess(plainStorage).metadataManager;
    metadataManager.update(tableName, {
      count: 2,
    });

    const cachedMiss = await findOne(tableName, {
      where: {
        id: 'legacy-1',
      },
    });
    expect(cachedMiss).toBeNull();

    configManager.updateConfig({
      storageFolder: 'qa-root-b',
    });
    await plainStorage.cleanup();
    await db.init();

    expect(await hasTable(tableName)).toBe(false);

    const persistedOldMeta = JSON.parse(
      global.__expo_file_system_mock__.mockFileSystem[`${firstRoot}meta.ldb`] as string
    ) as unknown as PersistedMetadata;
    expect(persistedOldMeta.tables[tableName].count).toBe(2);

    await createTable(tableName);
    await insert(tableName, {
      id: 'legacy-1',
      label: 'fresh-root',
    });

    expect(await read(tableName)).toEqual([
      {
        id: 'legacy-1',
        label: 'fresh-root',
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
      label: 'fresh-root',
    });
  });

  it('rejects operations after a live storageFolder change until cleanup and reinitialization', async () => {
    await createTable(tableName);

    configManager.updateConfig({
      storageFolder: 'qa-root-switched',
    });

    await expect(hasTable(tableName)).rejects.toMatchObject({
      code: 'STORAGE_ROOT_CHANGED',
    });

    await plainStorage.cleanup();
    await db.init();
    expect(await hasTable(tableName)).toBe(false);
  });
});
