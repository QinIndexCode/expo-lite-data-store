/// <reference path="../../../__tests__/test-globals.d.ts" />

import { MetadataManager } from '../MetadataManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { isStorageRecord } from '../../../types/storageTypes';
import logger from '../../../utils/logger';

const META_FILE_PATH = '/mock/documents/lite-data-store/meta.ldb';
const BACKUP_META_FILE_PATH = `${META_FILE_PATH}.bak`;

const createMetadataSnapshot = (
  tableName: string,
  count: number,
  storageCommitToken?: string,
  tableOverrides: Record<string, unknown> = {}
): string =>
  JSON.stringify({
    version: '1.0.0',
    generatedAt: 1,
    tables: {
      [tableName]: {
        mode: 'single',
        path: `${tableName}.ldb`,
        count,
        createdAt: 1,
        updatedAt: 1,
        columns: { id: 'number' },
        ...(storageCommitToken === undefined ? {} : { storageCommitToken }),
        ...tableOverrides,
      },
    },
  });

const getPersistedTable = (serialized: string, tableName: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(serialized) as unknown;
  if (!isStorageRecord(parsed) || !isStorageRecord(parsed.tables)) {
    throw new Error('Expected persisted metadata to include a table map');
  }

  const table = parsed.tables[tableName];
  if (!isStorageRecord(table)) {
    throw new Error(`Expected persisted metadata to include table '${tableName}'`);
  }

  return table;
};

const getPersistedTableCount = (serialized: string, tableName: string): number => {
  const table = getPersistedTable(serialized, tableName);
  if (typeof table.count !== 'number') {
    throw new Error(`Expected persisted metadata for '${tableName}' to include a numeric count`);
  }

  return table.count;
};

const hasPersistedTable = (serialized: string, tableName: string): boolean => {
  const parsed: unknown = JSON.parse(serialized) as unknown;
  return (
    isStorageRecord(parsed) &&
    isStorageRecord(parsed.tables) &&
    Object.prototype.hasOwnProperty.call(parsed.tables, tableName)
  );
};

const publishInitialTableSnapshot = async (metadataManager: MetadataManager): Promise<void> => {
  await metadataManager.waitForLoad();
  metadataManager.update('published_table', {
    mode: 'single',
    path: 'published_table.ldb',
    count: 1,
    createdAt: 1,
    updatedAt: 1,
    columns: {},
  });
  await metadataManager.saveImmediately();
};

const pauseNextMetadataWrite = () => {
  const fileSystem = getFileSystem();
  const originalWrite = fileSystem.writeAsStringAsync.bind(fileSystem);
  let releaseFirstWrite: (() => void) | undefined;
  let markFirstWriteStarted: (() => void) | undefined;
  const firstWriteStarted = new Promise<void>(resolve => {
    markFirstWriteStarted = resolve;
  });
  const firstWriteGate = new Promise<void>(resolve => {
    releaseFirstWrite = resolve;
  });
  let metadataWriteCount = 0;

  const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync').mockImplementation(async (uri, contents, options) => {
    if (uri === `${META_FILE_PATH}.tmp`) {
      metadataWriteCount++;
      if (metadataWriteCount === 1) {
        markFirstWriteStarted?.();
        await firstWriteGate;
      }
    }
    return originalWrite(uri, contents, options);
  });

  return {
    firstWriteStarted,
    release: (): void => releaseFirstWrite?.(),
    restore: (): void => writeSpy.mockRestore(),
    writeCount: (): number => metadataWriteCount,
  };
};

describe('MetadataManager', () => {
  let metadataManager: MetadataManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    global.__expo_file_system_mock__.mockFileSystem = {};
    metadataManager = new MetadataManager();
  });

  afterEach(() => {
    metadataManager.cleanup();
  });

  describe('get', () => {
    it('returns undefined for a nonexistent table', () => {
      const result = metadataManager.get('non_existent_table');
      expect(result).toBeUndefined();
    });

    it('returns metadata for an existing table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.mode).toBe('single');
      expect(result?.path).toBe(`${testTableName}.ldb`);
      expect(result?.count).toBe(0);
    });
  });

  describe('getPath', () => {
    it('returns a table path', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.getPath(testTableName);
      expect(result).toBe(`${testTableName}.ldb`);
    });

    it('returns a default path for a nonexistent table', () => {
      const result = metadataManager.getPath('non_existent_table');
      expect(result).toBe('non_existent_table.ldb');
    });
  });

  describe('update', () => {
    it('creates metadata for a new table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.mode).toBe('single');
      expect(result?.count).toBe(0);
      expect(result?.columns).toEqual({
        id: 'string',
        name: 'string',
      });
    });

    it('updates metadata for an existing table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      metadataManager.update(testTableName, {
        count: 10,
        mode: 'chunked',
        path: `${testTableName}/`,
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.count).toBe(10);
      expect(result?.mode).toBe('chunked');
      expect(result?.path).toBe(`${testTableName}/`);
      expect(result?.columns).toEqual({
        id: 'string',
        name: 'string',
      });
    });

    it('explicitly removes the internal storage commit token', async () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
        storageCommitToken: 'previous-token',
      });
      await metadataManager.saveImmediately();

      metadataManager.update(testTableName, { storageCommitToken: undefined });
      await metadataManager.saveImmediately();

      expect(metadataManager.get(testTableName)?.storageCommitToken).toBeUndefined();
      const serializedMetadata = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof serializedMetadata !== 'string') {
        throw new Error('Expected persisted metadata');
      }
      const persisted = getPersistedTable(serializedMetadata, testTableName);
      expect(persisted.storageCommitToken).toBeUndefined();
    });

    it('reads the latest durable token without replacing a stale local cache', async () => {
      await metadataManager.waitForLoad();
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
        storageCommitToken: 'previous-token',
      });
      await metadataManager.saveImmediately();

      const staleManager = new MetadataManager();
      try {
        await staleManager.waitForLoad();
        metadataManager.update(testTableName, { storageCommitToken: 'target-token' });
        await metadataManager.saveImmediately();

        expect(staleManager.get(testTableName)?.storageCommitToken).toBe('previous-token');
        await expect(staleManager.getPersisted(testTableName)).resolves.toMatchObject({
          storageCommitToken: 'target-token',
        });
        expect(staleManager.get(testTableName)?.storageCommitToken).toBe('previous-token');
      } finally {
        staleManager.cleanup();
      }
    });
  });

  describe('delete', () => {
    it('deletes table metadata', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      metadataManager.delete(testTableName);

      const result = metadataManager.get(testTableName);
      expect(result).toBeUndefined();
    });

    it('does not throw when deleting metadata for a nonexistent table', () => {
      expect(() => metadataManager.delete('non_existent_table')).not.toThrow();
    });
  });

  describe('allTables', () => {
    it('returns all table names', () => {
      metadataManager.update('table1', {
        mode: 'single',
        path: 'table1.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      metadataManager.update('table2', {
        mode: 'single',
        path: 'table2.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      metadataManager.update('table3', {
        mode: 'single',
        path: 'table3.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      const result = metadataManager.allTables();
      expect(result).toEqual(expect.arrayContaining(['table1', 'table2', 'table3']));
      expect(result.length).toBe(3);
    });

    it('returns an empty array when no tables exist', () => {
      metadataManager.delete(testTableName);

      const result = metadataManager.allTables();
      expect(result).toEqual([]);
    });
  });

  describe('count', () => {
    it('returns a table record count', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.count(testTableName);
      expect(result).toBe(5);
    });

    it('returns zero records for a nonexistent table', () => {
      const result = metadataManager.count('non_existent_table');
      expect(result).toBe(0);
    });
  });

  describe('debugDump_checkMetaCache', () => {
    it('returns the complete metadata cache', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.debugDump_checkMetaCache();
      expect(result).toBeDefined();
      expect(result.version).toBeDefined();
      expect(result.generatedAt).toBeDefined();
      expect(result.tables).toBeDefined();
      expect(result.tables[testTableName]).toBeDefined();
    });
  });

  it('rejects corrupted existing metadata without overwriting it', async () => {
    const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
    fileSystem[META_FILE_PATH] = 'not-valid-json';

    const manager = new MetadataManager();
    await expect(manager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });
    expect(fileSystem[META_FILE_PATH]).toBe('not-valid-json');
    manager.cleanup();
  });

  it('refuses to publish over metadata corrupted after initialization', async () => {
    await publishInitialTableSnapshot(metadataManager);

    const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
    fileSystem[META_FILE_PATH] = 'corrupted-after-load';
    metadataManager.update('published_table', { count: 2 });

    await expect(metadataManager.saveImmediately()).rejects.toMatchObject({ code: 'META_FILE_WRITE_ERROR' });
    expect(fileSystem[META_FILE_PATH]).toBe('corrupted-after-load');
    expect(fileSystem[BACKUP_META_FILE_PATH]).toBeUndefined();
    expect(fileSystem[`${META_FILE_PATH}.tmp`]).toBeUndefined();
  });

  describe('metadata recovery', () => {
    it('loads a non-empty internal storage commit token', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[META_FILE_PATH] = createMetadataSnapshot('token_table', 2, 'commit-token');

      await expect(metadataManager.waitForLoad()).resolves.toBeUndefined();

      expect(metadataManager.get('token_table')?.storageCommitToken).toBe('commit-token');
    });

    it('rejects an empty internal storage commit token', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const invalidSnapshot = createMetadataSnapshot('token_table', 2, '');
      fileSystem[META_FILE_PATH] = invalidSnapshot;

      await expect(metadataManager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });
      expect(fileSystem[META_FILE_PATH]).toBe(invalidSnapshot);
    });

    it('loads a consistent dynamic all-field encryption marker', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[META_FILE_PATH] = createMetadataSnapshot('all_fields_table', 2, undefined, {
        encrypted: true,
        encryptedFields: [],
        encryptAllFields: true,
      });

      await expect(metadataManager.waitForLoad()).resolves.toBeUndefined();
      expect(metadataManager.get('all_fields_table')).toMatchObject({
        encrypted: true,
        encryptedFields: [],
        encryptAllFields: true,
      });
    });

    it('rejects an all-field marker combined with a non-empty field list', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const invalidSnapshot = createMetadataSnapshot('all_fields_table', 2, undefined, {
        encrypted: true,
        encryptedFields: ['secret'],
        encryptAllFields: true,
      });
      fileSystem[META_FILE_PATH] = invalidSnapshot;

      await expect(metadataManager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });
      expect(fileSystem[META_FILE_PATH]).toBe(invalidSnapshot);
    });

    it('restores a valid backup when the primary metadata file is missing', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const backupSnapshot = createMetadataSnapshot('recovered_table', 3);
      fileSystem[BACKUP_META_FILE_PATH] = backupSnapshot;

      await expect(metadataManager.waitForLoad()).resolves.toBeUndefined();

      expect(metadataManager.count('recovered_table')).toBe(3);
      expect(fileSystem[META_FILE_PATH]).toBe(backupSnapshot);
      expect(fileSystem[BACKUP_META_FILE_PATH]).toBeUndefined();
    });

    it('rejects recovery when the restored backup cannot be retired', async () => {
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const backupSnapshot = createMetadataSnapshot('recovered_table', 3);
      fileSystemState[BACKUP_META_FILE_PATH] = backupSnapshot;
      const fileSystem = getFileSystem();
      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri === BACKUP_META_FILE_PATH) {
          throw new Error('backup cleanup denied');
        }
        await deleteAsync(uri, options);
      });

      try {
        await expect(metadataManager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });
        expect(fileSystemState[META_FILE_PATH]).toBe(backupSnapshot);
        expect(fileSystemState[BACKUP_META_FILE_PATH]).toBe(backupSnapshot);
      } finally {
        deleteSpy.mockRestore();
      }
    });

    it('does not roll back to a potentially stale backup when primary metadata is corrupted', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const backupSnapshot = createMetadataSnapshot('recovered_table', 4);
      fileSystem[META_FILE_PATH] = 'corrupted-primary';
      fileSystem[BACKUP_META_FILE_PATH] = backupSnapshot;

      await expect(metadataManager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });

      expect(fileSystem[META_FILE_PATH]).toBe('corrupted-primary');
      expect(fileSystem[BACKUP_META_FILE_PATH]).toBe(backupSnapshot);
    });

    it('fails closed when both primary and backup metadata are invalid', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const invalidPrimary = JSON.stringify({ version: '1.0.0', generatedAt: 1, tables: { broken: { count: '1' } } });
      fileSystem[META_FILE_PATH] = invalidPrimary;
      fileSystem[BACKUP_META_FILE_PATH] = 'corrupted-backup';

      await expect(metadataManager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });

      expect(fileSystem[META_FILE_PATH]).toBe(invalidPrimary);
      expect(fileSystem[BACKUP_META_FILE_PATH]).toBe('corrupted-backup');
    });

    it('replaces a stale backup before publishing when move does not overwrite destinations', async () => {
      await publishInitialTableSnapshot(metadataManager);

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      fileSystemState[BACKUP_META_FILE_PATH] = 'stale-backup';
      const fileSystem = getFileSystem();
      const moveAsync = fileSystem.moveAsync.bind(fileSystem);
      const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
        if (options.to in fileSystemState) {
          throw new Error(`Destination already exists: ${options.to}`);
        }
        await moveAsync(options);
      });

      metadataManager.update('published_table', { count: 2 });
      await expect(metadataManager.saveImmediately()).resolves.toBeUndefined();

      const persisted = fileSystemState[META_FILE_PATH];
      if (typeof persisted !== 'string') {
        throw new Error('Expected current metadata to remain published');
      }
      expect(getPersistedTableCount(persisted, 'published_table')).toBe(2);
      expect(fileSystemState[BACKUP_META_FILE_PATH]).toBeUndefined();
      expect(moveSpy).toHaveBeenCalled();
    });

    it('recovers the previous snapshot when primary publication fails after backup publication', async () => {
      await publishInitialTableSnapshot(metadataManager);

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const fileSystem = getFileSystem();
      const moveAsync = fileSystem.moveAsync.bind(fileSystem);
      const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
        if (options.from === `${META_FILE_PATH}.tmp` && options.to === META_FILE_PATH) {
          throw new Error('primary publication denied');
        }
        await moveAsync(options);
      });

      metadataManager.update('published_table', { count: 2 });
      await expect(metadataManager.saveImmediately()).rejects.toMatchObject({ code: 'META_FILE_WRITE_ERROR' });

      expect(fileSystemState[META_FILE_PATH]).toBeUndefined();
      const backup = fileSystemState[BACKUP_META_FILE_PATH];
      if (typeof backup !== 'string') {
        throw new Error('Expected the previous metadata snapshot to remain recoverable');
      }
      expect(getPersistedTableCount(backup, 'published_table')).toBe(1);
      expect(fileSystemState[`${META_FILE_PATH}.tmp`]).toBeUndefined();
      expect(fileSystemState[`${BACKUP_META_FILE_PATH}.tmp`]).toBeUndefined();

      moveSpy.mockRestore();
      const recoveredManager = new MetadataManager();
      try {
        await expect(recoveredManager.waitForLoad()).resolves.toBeUndefined();
        expect(recoveredManager.count('published_table')).toBe(1);
      } finally {
        recoveredManager.cleanup();
      }
    });

    it('rejects publication and retains the mutation when stale backup cleanup fails', async () => {
      await publishInitialTableSnapshot(metadataManager);

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const fileSystem = getFileSystem();
      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      let backupDeleteCount = 0;
      jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri === BACKUP_META_FILE_PATH) {
          backupDeleteCount++;
          if (backupDeleteCount === 2) {
            throw new Error('backup cleanup denied');
          }
        }
        await deleteAsync(uri, options);
      });

      metadataManager.update('published_table', { count: 2 });
      await expect(metadataManager.saveImmediately()).rejects.toMatchObject({ code: 'META_FILE_WRITE_ERROR' });

      const persisted = fileSystemState[META_FILE_PATH];
      const staleBackup = fileSystemState[BACKUP_META_FILE_PATH];
      if (typeof persisted !== 'string' || typeof staleBackup !== 'string') {
        throw new Error('Expected both the new primary and previous backup snapshots to remain available');
      }
      expect(getPersistedTableCount(persisted, 'published_table')).toBe(2);
      expect(getPersistedTableCount(staleBackup, 'published_table')).toBe(1);

      await expect(metadataManager.saveImmediately()).resolves.toBeUndefined();
      expect(getPersistedTableCount(fileSystemState[META_FILE_PATH] as string, 'published_table')).toBe(2);
      expect(fileSystemState[BACKUP_META_FILE_PATH]).toBeUndefined();
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  it('preserves an update saved while the initial load is still in progress', async () => {
    const fileSystem = getFileSystem();
    const getInfoAsync = fileSystem.getInfoAsync.bind(fileSystem);
    let releaseInitialRead: (() => void) | undefined;
    let markInitialReadStarted: (() => void) | undefined;
    const initialReadStarted = new Promise<void>(resolve => {
      markInitialReadStarted = resolve;
    });
    const initialReadGate = new Promise<void>(resolve => {
      releaseInitialRead = resolve;
    });
    let shouldPauseInitialRead = true;
    const getInfoSpy = jest.spyOn(fileSystem, 'getInfoAsync').mockImplementation(async uri => {
      if (shouldPauseInitialRead && uri === META_FILE_PATH) {
        shouldPauseInitialRead = false;
        markInitialReadStarted?.();
        await initialReadGate;
      }
      return getInfoAsync(uri);
    });

    try {
      const loading = metadataManager.waitForLoad();
      await initialReadStarted;
      metadataManager.update('during_load', {
        mode: 'single',
        path: 'during_load.ldb',
        count: 4,
        createdAt: 1,
        updatedAt: 1,
        columns: {},
      });
      const saving = metadataManager.saveImmediately();

      releaseInitialRead?.();
      await Promise.all([loading, saving]);

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTableCount(persistedText, 'during_load')).toBe(4);
      expect(metadataManager.get('during_load')).toMatchObject({ count: 4 });
    } finally {
      releaseInitialRead?.();
      getInfoSpy.mockRestore();
    }
  });

  it('merges concurrent updates from different manager instances without temp-file contention', async () => {
    const secondManager = new MetadataManager();
    await Promise.all([metadataManager.waitForLoad(), secondManager.waitForLoad()]);
    const pausedWrite = pauseNextMetadataWrite();

    try {
      metadataManager.update('instance_a', {
        mode: 'single',
        path: 'instance_a.ldb',
        count: 1,
        createdAt: 1,
        updatedAt: 1,
        columns: {},
      });
      const firstFlush = metadataManager.saveImmediately();
      await pausedWrite.firstWriteStarted;

      secondManager.update('instance_b', {
        mode: 'single',
        path: 'instance_b.ldb',
        count: 2,
        createdAt: 2,
        updatedAt: 2,
        columns: {},
      });
      const secondFlush = secondManager.saveImmediately();

      pausedWrite.release();
      await Promise.all([firstFlush, secondFlush]);

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTableCount(persistedText, 'instance_a')).toBe(1);
      expect(getPersistedTableCount(persistedText, 'instance_b')).toBe(2);
      expect(secondManager.get('instance_a')).toMatchObject({ count: 1 });
      expect(pausedWrite.writeCount()).toBe(2);
      expect(global.__expo_file_system_mock__.mockFileSystem[`${META_FILE_PATH}.tmp`]).toBeUndefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[`${BACKUP_META_FILE_PATH}.tmp`]).toBeUndefined();
    } finally {
      pausedWrite.release();
      pausedWrite.restore();
      secondManager.cleanup();
    }
  });

  it('does not return a stale cache while a local save starts during refresh', async () => {
    await publishInitialTableSnapshot(metadataManager);
    const refreshingManager = new MetadataManager();
    await refreshingManager.waitForLoad();

    metadataManager.update('epoch_bump', {
      mode: 'single',
      path: 'epoch_bump.ldb',
      count: 0,
      createdAt: 2,
      updatedAt: 2,
      columns: {},
    });
    await metadataManager.saveImmediately();
    refreshingManager.update('published_table', { count: 2 });
    refreshingManager.cleanup();

    const fileSystem = getFileSystem();
    const readAsStringAsync = fileSystem.readAsStringAsync.bind(fileSystem);
    let releaseRefreshRead: (() => void) | undefined;
    let markRefreshReadStarted: (() => void) | undefined;
    const refreshReadStarted = new Promise<void>(resolve => {
      markRefreshReadStarted = resolve;
    });
    const refreshReadGate = new Promise<void>(resolve => {
      releaseRefreshRead = resolve;
    });
    let shouldPauseRefreshRead = true;
    const readSpy = jest.spyOn(fileSystem, 'readAsStringAsync').mockImplementation(async (uri, options) => {
      if (shouldPauseRefreshRead && uri === META_FILE_PATH) {
        shouldPauseRefreshRead = false;
        markRefreshReadStarted?.();
        await refreshReadGate;
      }
      return readAsStringAsync(uri, options);
    });

    try {
      const latestMetadata = refreshingManager.getLatest('published_table');
      await refreshReadStarted;
      const saving = refreshingManager.saveImmediately();
      releaseRefreshRead?.();

      const [latest] = await Promise.all([latestMetadata, saving]);
      expect(latest).toMatchObject({ count: 2 });
      expect(refreshingManager.get('published_table')).toMatchObject({ count: 2 });
    } finally {
      releaseRefreshRead?.();
      readSpy.mockRestore();
      refreshingManager.cleanup();
    }
  });

  it('does not let a stale manager update recreate a durably deleted table', async () => {
    await publishInitialTableSnapshot(metadataManager);
    const staleManager = new MetadataManager();
    await staleManager.waitForLoad();

    try {
      staleManager.update('published_table', { count: 99 });
      staleManager.cleanup();

      metadataManager.delete('published_table');
      await metadataManager.saveImmediately();
      await staleManager.saveImmediately();

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(hasPersistedTable(persistedText, 'published_table')).toBe(false);
      expect(staleManager.get('published_table')).toBeUndefined();
    } finally {
      staleManager.cleanup();
    }
  });

  it('does not let a stale missing-table upsert replace another manager creation', async () => {
    const staleManager = new MetadataManager();
    await Promise.all([metadataManager.waitForLoad(), staleManager.waitForLoad()]);

    try {
      staleManager.update('concurrent_create', {
        mode: 'single',
        path: 'concurrent_create.ldb',
        count: 99,
        createdAt: 1,
        updatedAt: 1,
        columns: { stale: 'boolean' },
      });
      staleManager.cleanup();

      metadataManager.update('concurrent_create', {
        mode: 'single',
        path: 'concurrent_create.ldb',
        count: 2,
        createdAt: 2,
        updatedAt: 2,
        columns: { id: 'number' },
      });
      await metadataManager.saveImmediately();
      await staleManager.saveImmediately();

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTable(persistedText, 'concurrent_create')).toMatchObject({
        count: 2,
        createdAt: 2,
        columns: { id: 'number' },
      });
      expect(staleManager.get('concurrent_create')).toMatchObject({ count: 2, createdAt: 2 });
    } finally {
      staleManager.cleanup();
    }
  });

  it('does not apply a stale update to a deleted and recreated table generation', async () => {
    await publishInitialTableSnapshot(metadataManager);
    const staleManager = new MetadataManager();
    await staleManager.waitForLoad();

    try {
      staleManager.update('published_table', { count: 99, size: 99 });
      staleManager.cleanup();

      metadataManager.delete('published_table');
      await metadataManager.saveImmediately();
      metadataManager.update('published_table', {
        mode: 'single',
        path: 'published_table.ldb',
        count: 2,
        createdAt: 2,
        updatedAt: 2,
        columns: { id: 'number' },
      });
      await metadataManager.saveImmediately();
      await staleManager.saveImmediately();

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTable(persistedText, 'published_table')).toMatchObject({
        count: 2,
        createdAt: 2,
      });
      expect(getPersistedTable(persistedText, 'published_table')).not.toHaveProperty('size');
      expect(staleManager.get('published_table')).toMatchObject({ count: 2, createdAt: 2 });
    } finally {
      staleManager.cleanup();
    }
  });

  it('normalizes a legacy missing creation timestamp before stale-update comparison', async () => {
    global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH] = createMetadataSnapshot(
      'legacy_table',
      1,
      undefined,
      { createdAt: undefined, updatedAt: undefined }
    );
    const staleManager = new MetadataManager();
    await Promise.all([metadataManager.waitForLoad(), staleManager.waitForLoad()]);

    try {
      expect(metadataManager.get('legacy_table')).toMatchObject({ createdAt: 1, updatedAt: 1 });
      staleManager.update('legacy_table', { count: 99 });
      staleManager.cleanup();

      metadataManager.delete('legacy_table');
      await metadataManager.saveImmediately();
      metadataManager.update('legacy_table', {
        mode: 'single',
        path: 'legacy_table.ldb',
        count: 3,
        createdAt: 3,
        updatedAt: 3,
        columns: { id: 'number' },
      });
      await metadataManager.saveImmediately();
      await staleManager.saveImmediately();

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTable(persistedText, 'legacy_table')).toMatchObject({ count: 3, createdAt: 3 });
      expect(staleManager.get('legacy_table')).toMatchObject({ count: 3, createdAt: 3 });
    } finally {
      staleManager.cleanup();
    }
  });

  it('times out a metadata lock waiter without letting a follower bypass the owner', async () => {
    const timedOutManager = new MetadataManager();
    const followerManager = new MetadataManager();
    await Promise.all([metadataManager.waitForLoad(), timedOutManager.waitForLoad(), followerManager.waitForLoad()]);
    const pausedWrite = pauseNextMetadataWrite();
    jest.useFakeTimers();

    try {
      metadataManager.update('lock_owner', {
        mode: 'single',
        path: 'lock_owner.ldb',
        count: 1,
        createdAt: 1,
        updatedAt: 1,
        columns: {},
      });
      const ownerFlush = metadataManager.saveImmediately();
      await pausedWrite.firstWriteStarted;

      timedOutManager.update('timed_out_waiter', {
        mode: 'single',
        path: 'timed_out_waiter.ldb',
        count: 2,
        createdAt: 2,
        updatedAt: 2,
        columns: {},
      });
      const timedOutFlush = timedOutManager.saveImmediately();
      const timeoutAssertion = expect(timedOutFlush).rejects.toMatchObject({ code: 'TIMEOUT' });
      await jest.advanceTimersByTimeAsync(30000);
      await timeoutAssertion;

      followerManager.update('lock_follower', {
        mode: 'single',
        path: 'lock_follower.ldb',
        count: 3,
        createdAt: 3,
        updatedAt: 3,
        columns: {},
      });
      let followerSettled = false;
      const followerFlush = followerManager.saveImmediately().then(() => {
        followerSettled = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(followerSettled).toBe(false);
      expect(pausedWrite.writeCount()).toBe(1);

      pausedWrite.release();
      await Promise.all([ownerFlush, followerFlush]);
      expect(followerManager.get('lock_owner')).toMatchObject({ count: 1 });
      expect(followerManager.get('timed_out_waiter')).toBeUndefined();

      await expect(timedOutManager.saveImmediately()).resolves.toBeUndefined();
      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTableCount(persistedText, 'lock_owner')).toBe(1);
      expect(getPersistedTableCount(persistedText, 'lock_follower')).toBe(3);
      expect(getPersistedTableCount(persistedText, 'timed_out_waiter')).toBe(2);
    } finally {
      pausedWrite.release();
      jest.useRealTimers();
      pausedWrite.restore();
      timedOutManager.cleanup();
      followerManager.cleanup();
    }
  });

  it('applies same-table manager mutations in FIFO order against the latest disk state', async () => {
    await publishInitialTableSnapshot(metadataManager);
    const secondManager = new MetadataManager();
    await secondManager.waitForLoad();
    const pausedWrite = pauseNextMetadataWrite();

    try {
      metadataManager.update('published_table', { count: 2, size: 10 });
      const firstFlush = metadataManager.saveImmediately();
      await pausedWrite.firstWriteStarted;

      secondManager.update('published_table', { count: 3, chunks: 2 });
      const secondFlush = secondManager.saveImmediately();

      pausedWrite.release();
      await Promise.all([firstFlush, secondFlush]);

      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTable(persistedText, 'published_table')).toMatchObject({
        count: 3,
        size: 10,
        chunks: 2,
      });
      expect(secondManager.get('published_table')).toMatchObject({ count: 3, size: 10, chunks: 2 });
      expect(pausedWrite.writeCount()).toBe(2);
    } finally {
      pausedWrite.release();
      pausedWrite.restore();
      secondManager.cleanup();
    }
  });

  it('retains failed mutations for an explicit retry on the same manager', async () => {
    await publishInitialTableSnapshot(metadataManager);
    const fileSystem = getFileSystem();
    const moveAsync = fileSystem.moveAsync.bind(fileSystem);
    let rejectedFirstPublication = false;
    const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
      if (!rejectedFirstPublication && options.from === `${META_FILE_PATH}.tmp` && options.to === META_FILE_PATH) {
        rejectedFirstPublication = true;
        throw new Error('first publication denied');
      }
      await moveAsync(options);
    });

    try {
      metadataManager.update('published_table', { count: 2, size: 20 });
      await expect(metadataManager.saveImmediately()).rejects.toMatchObject({ code: 'META_FILE_WRITE_ERROR' });
      expect(metadataManager.get('published_table')).toMatchObject({ count: 2, size: 20 });

      await expect(metadataManager.saveImmediately()).resolves.toBeUndefined();
      const persistedText = global.__expo_file_system_mock__.mockFileSystem[META_FILE_PATH];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected retry to publish metadata');
      }
      expect(getPersistedTable(persistedText, 'published_table')).toMatchObject({ count: 2, size: 20 });
      expect(metadataManager.get('published_table')).toMatchObject({ count: 2, size: 20 });
    } finally {
      moveSpy.mockRestore();
    }
  });

  it('treats prototype-related keys as ordinary table names without inherited false positives', async () => {
    const tableNames = ['constructor', '__proto__', 'prototype'];
    await metadataManager.waitForLoad();

    for (const tableName of tableNames) {
      expect(metadataManager.get(tableName)).toBeUndefined();
      metadataManager.update(tableName, {
        mode: 'single',
        path: `${tableName}.ldb`,
        count: 1,
        createdAt: 1,
        updatedAt: 1,
        columns: {},
      });
    }
    expect(metadataManager.allTables()).toEqual(expect.arrayContaining(tableNames));
    await metadataManager.saveImmediately();

    const reloadedManager = new MetadataManager();
    try {
      await reloadedManager.waitForLoad();
      for (const tableName of tableNames) {
        expect(reloadedManager.get(tableName)).toMatchObject({ path: `${tableName}.ldb`, count: 1 });
        reloadedManager.delete(tableName);
      }
      await reloadedManager.saveImmediately();
    } finally {
      reloadedManager.cleanup();
    }

    const finalManager = new MetadataManager();
    try {
      await finalManager.waitForLoad();
      for (const tableName of tableNames) {
        expect(finalManager.get(tableName)).toBeUndefined();
      }
      expect(finalManager.allTables()).toEqual([]);
    } finally {
      finalManager.cleanup();
    }
  });

  it('serializes overlapping metadata flushes without losing later table updates', async () => {
    await metadataManager.saveImmediately();
    const pausedWrite = pauseNextMetadataWrite();

    try {
      metadataManager.update('concurrent_a', {
        mode: 'single',
        path: 'concurrent_a.ldb',
        count: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
      });
      const firstFlush = metadataManager.saveImmediately();
      await pausedWrite.firstWriteStarted;

      metadataManager.update('concurrent_b', {
        mode: 'single',
        path: 'concurrent_b.ldb',
        count: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
      });
      const secondFlush = metadataManager.saveImmediately();

      pausedWrite.release();
      await Promise.all([firstFlush, secondFlush]);

      const persistedText = global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/meta.ldb'];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      expect(getPersistedTableCount(persistedText, 'concurrent_a')).toBe(1);
      expect(getPersistedTableCount(persistedText, 'concurrent_b')).toBe(2);
      expect(pausedWrite.writeCount()).toBe(2);
      expect(
        global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/meta.ldb.tmp']
      ).toBeUndefined();
    } finally {
      pausedWrite.release();
      pausedWrite.restore();
    }
  });
});
