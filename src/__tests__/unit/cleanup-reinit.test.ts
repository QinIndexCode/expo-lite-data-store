import { configManager } from '../../core/config/ConfigManager';
import { SingleFileHandler } from '../../core/file/SingleFileHandler';
import { db, findOne, hasTable, insert, plainStorage, read, createTable } from '../../expo-lite-data-store';
import { getRootPath, resetRootPathState } from '../../utils/ROOTPath';

describe('cleanup and reinit runtime state', () => {
  const tableName = 'cleanup_reinit_users';

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

    const nextRoot = await getRootPath();
    const handler = new SingleFileHandler(`${nextRoot}${tableName}.ldb`);
    await handler.write([
      {
        id: 'legacy-1',
        label: 'fresh-root',
      },
    ]);

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
});
