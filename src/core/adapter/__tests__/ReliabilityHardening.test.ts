/// <reference path="../../../__tests__/test-globals.d.ts" />

import { MetadataManager } from '../../meta/MetadataManager';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';
import { CacheManager } from '../../cache/CacheManager';
import { configManager } from '../../config/ConfigManager';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { DataWriter } from '../../data/DataWriter';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { getRootPathSync } from '../../../utils/ROOTPath';
import logger from '../../../utils/logger';
import { isStorageRecord, type StorageRecord } from '../../../types/storageTypes';
import { StorageError } from '../../../types/storageErrorInfc';

type AdapterPrivateAccess = {
  dataWriter: DataWriter;
  cacheManager: CacheManager;
};

const getAdapterPrivateAccess = (adapter: FileSystemStorageAdapter): AdapterPrivateAccess =>
  adapter as unknown as AdapterPrivateAccess;

const readMockFileText = (path: string): string => {
  const entry = global.__expo_file_system_mock__.mockFileSystem[path];
  if (typeof entry !== 'string') {
    throw new Error(`Expected a file at ${path}`);
  }
  return entry;
};

type PersistedDataFile = {
  data: StorageRecord[];
  hash: string;
};

type PersistedMetadata = {
  tables: StorageRecord;
};

const isStorageRecordArray = (value: unknown): value is StorageRecord[] =>
  Array.isArray(value) && value.every(isStorageRecord);

const parsePersistedDataFile = (serialized: string): PersistedDataFile => {
  const parsed: unknown = JSON.parse(serialized) as unknown;
  if (!isStorageRecord(parsed) || !isStorageRecordArray(parsed.data)) {
    throw new Error('Expected persisted data to contain record entries');
  }
  if (typeof parsed.hash !== 'string') {
    throw new Error('Expected persisted data to contain an integrity hash');
  }
  return { data: parsed.data, hash: parsed.hash };
};

const parsePersistedMetadata = (serialized: string): PersistedMetadata => {
  const parsed: unknown = JSON.parse(serialized) as unknown;
  if (!isStorageRecord(parsed) || !isStorageRecord(parsed.tables)) {
    throw new Error('Expected persisted metadata to contain table records');
  }
  return { tables: parsed.tables };
};

const getPersistedTable = (metadata: PersistedMetadata, tableName: string): StorageRecord => {
  const table = metadata.tables[tableName];
  if (!isStorageRecord(table)) {
    throw new Error(`Expected persisted metadata for '${tableName}'`);
  }
  return table;
};

const getPersistedCount = (metadata: PersistedMetadata, tableName: string): number => {
  const count = getPersistedTable(metadata, tableName).count;
  if (typeof count !== 'number') {
    throw new Error(`Expected a numeric record count for '${tableName}'`);
  }
  return count;
};

const getPersistedBoolean = (metadata: PersistedMetadata, tableName: string, field: string): boolean => {
  const value = getPersistedTable(metadata, tableName)[field];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected '${field}' to be boolean for '${tableName}'`);
  }
  return value;
};

describe('FileSystemStorageAdapter reliability hardening', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;

  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    configManager.resetConfig();
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
  });

  afterEach(async () => {
    await adapter.cleanup();
    metadataManager.cleanup();
    configManager.resetConfig();
    jest.restoreAllMocks();
  });

  it('rejects traversal and path-like table names at the storage boundary', async () => {
    await expect(adapter.createTable('../outside')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
    await expect(adapter.hasTable('nested/table')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
    await expect(adapter.read('C:\\outside')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
  });

  it('preserves the corrupted-data error code through the public adapter', async () => {
    await adapter.createTable('corrupted_table', { initialData: [{ id: 1, value: 'original' }] });

    const filePath = '/mock/documents/lite-data-store/corrupted_table.ldb';
    const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
    const parsed = parsePersistedDataFile(readMockFileText(filePath));
    const firstRecord = parsed.data[0];
    if (!firstRecord) {
      throw new Error('Expected persisted data to include a first record');
    }
    firstRecord.value = 'tampered';
    fileSystem[filePath] = JSON.stringify(parsed);

    await expect(adapter.read('corrupted_table', { bypassCache: true })).rejects.toMatchObject({
      code: 'CORRUPTED_DATA',
    });
    await adapter.deleteTable('corrupted_table');
  });

  it('restores all touched tables when a transaction commit fails partway through', async () => {
    await adapter.createTable('transaction_a', { initialData: [{ id: 1, value: 'a-original' }] });
    await adapter.createTable('transaction_b', { initialData: [{ id: 1, value: 'b-original' }] });

    await adapter.beginTransaction();
    await adapter.overwrite('transaction_a', [{ id: 1, value: 'a-updated' }]);
    await adapter.overwrite('transaction_b', [{ id: 1, value: 'b-updated' }]);

    const dataWriter = getAdapterPrivateAccess(adapter).dataWriter;
    const originalWrite = dataWriter.write.bind(dataWriter);
    let writeCalls = 0;
    const writeSpy = jest
      .spyOn(dataWriter, 'write')
      .mockImplementation(async (...args: Parameters<DataWriter['write']>) => {
        writeCalls++;
        if (writeCalls === 2) {
          throw new Error('injected second-table commit failure');
        }
        return originalWrite(...args);
      });

    await expect(adapter.commit()).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });
    writeSpy.mockRestore();

    await expect(adapter.read('transaction_a', { bypassCache: true })).resolves.toEqual([
      { id: 1, value: 'a-original' },
    ]);
    await expect(adapter.read('transaction_b', { bypassCache: true })).resolves.toEqual([
      { id: 1, value: 'b-original' },
    ]);

    await adapter.deleteTable('transaction_a');
    await adapter.deleteTable('transaction_b');
  });

  it('removes tables created by a transaction when commit fails', async () => {
    await adapter.beginTransaction();
    await adapter.overwrite('transaction_new_a', [{ id: 1, value: 'a' }]);
    await adapter.overwrite('transaction_new_b', [{ id: 1, value: 'b' }]);

    const dataWriter = getAdapterPrivateAccess(adapter).dataWriter;
    const originalWrite = dataWriter.write.bind(dataWriter);
    let writeCalls = 0;
    const writeSpy = jest
      .spyOn(dataWriter, 'write')
      .mockImplementation(async (...args: Parameters<DataWriter['write']>) => {
        writeCalls++;
        if (writeCalls === 2) {
          throw new Error('injected new-table commit failure');
        }
        return originalWrite(...args);
      });

    try {
      await expect(adapter.commit()).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });
    } finally {
      writeSpy.mockRestore();
    }

    await expect(adapter.hasTable('transaction_new_a')).resolves.toBe(false);
    await expect(adapter.hasTable('transaction_new_b')).resolves.toBe(false);
  });

  it('discards an uncommitted transaction without rewriting table files', async () => {
    await adapter.createTable('transaction_discard', { initialData: [{ id: 1, value: 'original' }] });
    const dataWriter = getAdapterPrivateAccess(adapter).dataWriter;
    const writeSpy = jest.spyOn(dataWriter, 'write');

    await adapter.beginTransaction();
    await adapter.overwrite('transaction_discard', [{ id: 1, value: 'uncommitted' }]);
    await adapter.rollback();

    expect(writeSpy).not.toHaveBeenCalled();
    await expect(adapter.read('transaction_discard', { bypassCache: true })).resolves.toEqual([
      { id: 1, value: 'original' },
    ]);
    writeSpy.mockRestore();
    await adapter.deleteTable('transaction_discard');
  });

  it('rejects a forged directWrite property and discards the staged write on rollback', async () => {
    const tableName = 'transaction_forged_direct_write';
    await adapter.createTable(tableName, { initialData: [{ id: 1, value: 'original' }] });
    await adapter.beginTransaction();

    const forgedOptions = Object.assign({ mode: 'append' as const }, { directWrite: true });
    await adapter.write(tableName, { id: 2, value: 'must-remain-staged' }, forgedOptions);
    await adapter.rollback();

    await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual([{ id: 1, value: 'original' }]);
    await adapter.deleteTable(tableName);
  });

  it('applies a queued bulk write exactly once during commit', async () => {
    const tableName = 'transaction_bulk_once';
    await adapter.createTable(tableName, { initialData: [{ id: 1 }] });

    await adapter.beginTransaction();
    await adapter.bulkWrite(tableName, [{ type: 'insert', data: { id: 2 } }]);
    await adapter.commit();

    await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await adapter.deleteTable(tableName);
  });

  it('updates only matched rows when records do not have id fields', async () => {
    await adapter.createTable('no_id_update_rows', {
      initialData: [
        { name: 'alice', active: true },
        { name: 'bob', active: true },
      ],
    });

    const updated = await adapter.update('no_id_update_rows', { active: false }, { name: 'alice' });

    await expect(adapter.read('no_id_update_rows', { bypassCache: true })).resolves.toEqual([
      { name: 'alice', active: false },
      { name: 'bob', active: true },
    ]);
    expect(updated).toBe(1);
    await adapter.deleteTable('no_id_update_rows');
  });

  it('applies bulk update and delete by matched row identity when id fields are absent', async () => {
    await adapter.createTable('no_id_bulk_rows', {
      initialData: [
        { name: 'alice', active: true },
        { name: 'bob', active: true },
        { name: 'carol', active: true },
      ],
    });

    const result = await adapter.bulkWrite('no_id_bulk_rows', [
      { type: 'update', data: { active: false }, where: { name: 'alice' } },
      { type: 'delete', where: { name: 'bob' } },
    ]);

    await expect(adapter.read('no_id_bulk_rows', { bypassCache: true })).resolves.toEqual([
      { name: 'alice', active: false },
      { name: 'carol', active: true },
    ]);
    expect(result.written).toBe(2);
    await adapter.deleteTable('no_id_bulk_rows');
  });

  it('keeps transaction read-your-writes semantics for records without id fields', async () => {
    await adapter.createTable('no_id_transaction_rows', {
      initialData: [
        { name: 'alice', active: true },
        { name: 'bob', active: true },
      ],
    });

    await adapter.beginTransaction();
    const updated = await adapter.update('no_id_transaction_rows', { active: false }, { name: 'alice' });
    await adapter.write('no_id_transaction_rows', { name: 'carol', active: true });
    await adapter.commit();

    await expect(adapter.read('no_id_transaction_rows', { bypassCache: true })).resolves.toEqual([
      { name: 'alice', active: false },
      { name: 'bob', active: true },
      { name: 'carol', active: true },
    ]);
    expect(updated).toBe(1);
    await adapter.deleteTable('no_id_transaction_rows');
  });

  it('persists table metadata immediately after create and write operations', async () => {
    await adapter.createTable('metadata_flush_table', {
      initialData: [{ id: 1, value: 'first' }],
    });
    await adapter.write('metadata_flush_table', { id: 2, value: 'second' });

    const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
    const metaText = fileSystem['/mock/documents/lite-data-store/meta.ldb'];
    expect(metaText).toBeDefined();

    const persistedMeta = parsePersistedMetadata(readMockFileText('/mock/documents/lite-data-store/meta.ldb'));
    expect(getPersistedCount(persistedMeta, 'metadata_flush_table')).toBe(2);
    await adapter.deleteTable('metadata_flush_table');
  });

  it('surfaces cleanup flush failures and preserves pending metadata for a successful retry', async () => {
    const tableName = 'cleanup_metadata_flush_table';
    await adapter.createTable(tableName, { initialData: [{ id: 1 }] });
    metadataManager.update(tableName, { isHighRisk: true, updatedAt: Date.now() });

    const saveSpy = jest
      .spyOn(metadataManager, 'saveImmediately')
      .mockRejectedValueOnce(new Error('simulated cleanup metadata flush failure'));

    await expect(adapter.cleanup()).rejects.toThrow('simulated cleanup metadata flush failure');
    await expect(adapter.cleanup()).resolves.toBeUndefined();
    saveSpy.mockRestore();

    const reloadedMetadata = new MetadataManager();
    try {
      await reloadedMetadata.waitForLoad();
      expect(reloadedMetadata.get(tableName)).toMatchObject({ isHighRisk: true });
    } finally {
      reloadedMetadata.cleanup();
    }
  });

  it('records the actual chunk count for chunked initial data', async () => {
    await adapter.cleanup();
    metadataManager.cleanup();
    configManager.updateConfig({ chunkSize: 256 });
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);

    const initialData = [
      { name: 'one', payload: 'x'.repeat(300) },
      { name: 'two', payload: 'y'.repeat(300) },
      { name: 'three', payload: 'z'.repeat(300) },
    ];

    await adapter.createTable('chunked_initial_chunks', {
      mode: 'chunked',
      initialData,
    });

    expect(adapter.getTableMeta('chunked_initial_chunks')?.chunks).toBe(3);
    await expect(adapter.read('chunked_initial_chunks', { bypassCache: true })).resolves.toEqual(initialData);
    await adapter.deleteTable('chunked_initial_chunks');
  });

  it('preserves the strict access policy when migrating a table to chunked storage', async () => {
    const tableName = 'strict_policy_chunk_migration';

    await adapter.createTable(tableName, {
      mode: 'single',
      encrypted: true,
      requireAuthOnAccess: true,
      initialData: [{ id: 1, value: 'strict' }],
    });

    await adapter.migrateToChunked(tableName);

    expect(adapter.getTableMeta(tableName)).toMatchObject({
      mode: 'chunked',
      encrypted: true,
      requireAuthOnAccess: true,
    });

    const persistedMeta = parsePersistedMetadata(readMockFileText(`${getRootPathSync()}meta.ldb`));
    expect(getPersistedBoolean(persistedMeta, tableName, 'requireAuthOnAccess')).toBe(true);
    await adapter.deleteTable(tableName);
  });

  it('serializes migration with a concurrent write to avoid losing the new record', async () => {
    const tableName = 'migration_write_lock_table';
    const initialData = [{ id: 'before', value: 'original' }];
    let resolveSourceRead!: (data: StorageRecord[]) => void;
    let markSourceReadStarted!: () => void;
    const sourceRead = new Promise<StorageRecord[]>(resolve => {
      resolveSourceRead = resolve;
    });
    const sourceReadStarted = new Promise<void>(resolve => {
      markSourceReadStarted = resolve;
    });

    await adapter.createTable(tableName, { mode: 'single', initialData });
    const readSpy = jest.spyOn(SingleFileHandler.prototype, 'read').mockImplementation(() => {
      markSourceReadStarted();
      return sourceRead;
    });

    try {
      const migration = adapter.migrateToChunked(tableName);
      await sourceReadStarted;

      let writeSettled = false;
      const concurrentWrite = adapter.write(tableName, { id: 'during', value: 'concurrent' }).then(() => {
        writeSettled = true;
      });
      await Promise.resolve();
      expect(writeSettled).toBe(false);

      resolveSourceRead(initialData);
      await migration;
      await concurrentWrite;

      await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual([
        ...initialData,
        { id: 'during', value: 'concurrent' },
      ]);
    } finally {
      resolveSourceRead(initialData);
      readSpy.mockRestore();
      await adapter.deleteTable(tableName);
    }
  });

  it('removes a stale single-file artifact when deleting a chunked table', async () => {
    const tableName = 'stale_single_after_chunk_migration';
    const rootPath = getRootPathSync();
    const fileSystem = getFileSystem();

    await adapter.createTable(tableName, {
      mode: 'single',
      initialData: [{ id: 1, value: 'before-migration' }],
    });
    await adapter.write(tableName, { id: 2, value: 'after-migration' }, { forceChunked: true });
    await fileSystem.writeAsStringAsync(`${rootPath}${tableName}.ldb`, 'stale migration artifact');
    await fileSystem.writeAsStringAsync(`${rootPath}${tableName}.ldb.tmp`, 'stale atomic-write artifact');

    await adapter.deleteTable(tableName);

    await expect(fileSystem.getInfoAsync(`${rootPath}${tableName}.ldb`)).resolves.toMatchObject({ exists: false });
    await expect(fileSystem.getInfoAsync(`${rootPath}${tableName}.ldb.tmp`)).resolves.toMatchObject({ exists: false });
    await expect(fileSystem.getInfoAsync(`${rootPath}${tableName}/`)).resolves.toMatchObject({ exists: false });
  });

  it('keeps a failed physical delete logically absent, invalidates cache, and allows cleanup retry', async () => {
    const tableName = 'delete_physical_cleanup_retry';
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    const fileSystem = getFileSystem();
    await adapter.createTable(tableName, { mode: 'single', initialData: [{ id: 1, value: 'old' }] });
    await adapter.read(tableName);

    const cacheManager = getAdapterPrivateAccess(adapter).cacheManager;
    const namespaceBeforeDelete = cacheManager.getNamespaceVersion(tableName);
    const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
    let failAuthoritativeDelete = true;
    const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
      if (path === filePath && failAuthoritativeDelete) {
        failAuthoritativeDelete = false;
        throw new Error('simulated physical table cleanup failure');
      }
      await deleteAsync(path, options);
    });

    try {
      let deletionError: unknown;
      try {
        await adapter.deleteTable(tableName);
      } catch (error) {
        deletionError = error;
      }
      expect(deletionError).toBeInstanceOf(StorageError);
      if (!(deletionError instanceof StorageError)) {
        throw new Error('Expected a StorageError for incomplete physical cleanup');
      }
      expect(deletionError.code).toBe('TABLE_DELETE_FAILED');
      expect(deletionError.details).toContain('logically absent');
      await expect(adapter.hasTable(tableName)).resolves.toBe(false);
      await expect(fileSystem.getInfoAsync(filePath)).resolves.toMatchObject({ exists: true });
      expect(cacheManager.getNamespaceVersion(tableName)).not.toBe(namespaceBeforeDelete);
      await expect(adapter.migrateToChunked(tableName)).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
      await expect(adapter.hasTable(tableName)).resolves.toBe(false);
      await expect(fileSystem.getInfoAsync(filePath)).resolves.toMatchObject({ exists: true });

      await expect(adapter.deleteTable(tableName)).resolves.toBeUndefined();
      await expect(fileSystem.getInfoAsync(filePath)).resolves.toMatchObject({ exists: false });
    } finally {
      deleteSpy.mockRestore();
      await adapter.deleteTable(tableName).catch(() => undefined);
    }
  });
});
