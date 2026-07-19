import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { ChunkedFileHandler } from '../../file/ChunkedFileHandler';
import { FileHandlerBase } from '../../file/FileHandlerBase';
import { SingleFileHandler } from '../../file/SingleFileHandler';
import { IndexManager, IndexType } from '../../index/IndexManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { getRootPathSync } from '../../../utils/ROOTPath';
import logger from '../../../utils/logger';
import { StorageError } from '../../../types/storageErrorInfc';
import type { StorageRecord } from '../../../types/storageTypes';
import { withLogicalRecordCount } from '../../service/TransactionService';
import { DataWriter } from '../DataWriter';

type DataWriterPrivateAccess = {
  countValidationInFlight: Map<string, Promise<void>>;
  acquireLock: (tableName: string) => Promise<() => void>;
  activeOperations: number;
  maxConcurrentOperations: number;
};

type ChunkedFileHandlerPrivateAccess = {
  writeOverwriteJournal: (previousData: StorageRecord[], targetData: StorageRecord[]) => Promise<void>;
};

const getDataWriterPrivateAccess = (writer: DataWriter): DataWriterPrivateAccess =>
  writer as unknown as DataWriterPrivateAccess;

const getChunkedFileHandlerPrivateAccess = (handler: ChunkedFileHandler): ChunkedFileHandlerPrivateAccess =>
  handler as unknown as ChunkedFileHandlerPrivateAccess;

const indexConflictCases = [
  { storageMode: 'single', writeMode: 'append' },
  { storageMode: 'single', writeMode: 'overwrite' },
  { storageMode: 'chunked', writeMode: 'append' },
  { storageMode: 'chunked', writeMode: 'overwrite' },
] as const;

const snapshotIndex = (manager: IndexManager, tableName: string) => {
  const index = manager.getTableIndexes(tableName)[0];
  if (!index) {
    throw new Error(`Expected an index for ${tableName}`);
  }
  return {
    definition: {
      name: index.name,
      type: index.type,
      fields: [...index.fields],
      ready: index.ready,
    },
    data: Array.from(index.data.entries(), ([key, items]) => [key, items.map(item => ({ ...item }))]),
  };
};

const mockPendingSingleFileRead = () => {
  let resolveRead!: (data: StorageRecord[]) => void;
  let signalReadStarted!: () => void;
  const pendingRead = new Promise<StorageRecord[]>(resolve => {
    resolveRead = resolve;
  });
  const readStarted = new Promise<void>(resolve => {
    signalReadStarted = resolve;
  });
  const readSpy = jest.spyOn(SingleFileHandler.prototype, 'read').mockImplementation(() => {
    signalReadStarted();
    return pendingRead;
  });

  return {
    readStarted,
    resolveRead,
    restore: () => readSpy.mockRestore(),
    getCallCount: () => readSpy.mock.calls.length,
  };
};

describe('DataWriter', () => {
  let dataWriter: DataWriter;
  let metadataManager: MetadataManager;
  let cacheManager: CacheManager;
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    cacheManager = new CacheManager({
      strategy: CacheStrategy.LRU,
      maxSize: 100,
      defaultExpiry: 3600000,
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
    });
    indexManager = new IndexManager(metadataManager);
    dataWriter = new DataWriter(metadataManager, indexManager);

    await metadataManager.waitForLoad();
    metadataManager.delete(testTableName);
    await metadataManager.saveImmediately();
  });

  afterEach(() => {
    cacheManager.cleanup();
    metadataManager.cleanup();
  });

  describe('createTable', () => {
    it('creates a new table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
        ],
      });

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('single');
      expect(tableMeta?.count).toBe(2);
    });

    it('creates a chunked table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'chunked',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeDefined();
      expect(tableMeta?.mode).toBe('chunked');
    });

    it('rolls back a single-file table when metadata persistence fails', async () => {
      const tableName = 'create_metadata_failure_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockRejectedValueOnce(new Error('simulated metadata persistence failure'));
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      try {
        await expect(
          dataWriter.createTable(tableName, {
            mode: 'single',
            initialData: [{ id: 'not-published' }],
          })
        ).rejects.toMatchObject({ code: 'TABLE_CREATE_FAILED' });

        expect(metadataManager.get(tableName)).toBeUndefined();
        await expect(getFileSystem().getInfoAsync(filePath)).resolves.toMatchObject({ exists: false });

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toBeUndefined();
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        saveSpy.mockRestore();
        errorSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('removes chunk artifacts when schema metadata persistence fails', async () => {
      const tableName = 'create_chunked_metadata_failure_table';
      const chunkPath = `${getRootPathSync()}${tableName}/000000.ldb`;
      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('simulated schema metadata persistence failure'));

      try {
        await expect(
          dataWriter.createTable(tableName, {
            mode: 'chunked',
            initialData: [{ id: 'not-published' }],
          })
        ).rejects.toMatchObject({ code: 'TABLE_CREATE_FAILED' });

        expect(metadataManager.get(tableName)).toBeUndefined();
        await expect(getFileSystem().getInfoAsync(chunkPath)).resolves.toMatchObject({ exists: false });
      } finally {
        saveSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('purges orphaned representations before recreating a table with the same name', async () => {
      const tableName = 'same_name_orphan_recreation_table';
      const rootPath = getRootPathSync();
      const singleFilePath = `${rootPath}${tableName}.ldb`;
      const chunkDirectory = `${rootPath}${tableName}/`;
      const staleChunkPath = `${chunkDirectory}000000.ldb`;
      const markerPath = `${singleFilePath}.commit-marker`;
      const journalPath = `${rootPath}${tableName}.append-journal`;
      const fileSystem = getFileSystem();

      metadataManager.delete(tableName);
      await metadataManager.saveImmediately();
      await new SingleFileHandler(singleFilePath).write([{ id: 'orphaned-single' }]);
      await fileSystem.makeDirectoryAsync(chunkDirectory, { intermediates: true });
      await fileSystem.writeAsStringAsync(staleChunkPath, 'orphaned-chunk');
      await fileSystem.writeAsStringAsync(markerPath, 'orphaned-marker');
      await fileSystem.writeAsStringAsync(journalPath, 'orphaned-journal');

      try {
        await dataWriter.createTable(tableName, {
          mode: 'single',
          initialData: [{ id: 'replacement' }],
        });

        await expect(new SingleFileHandler(singleFilePath).read()).resolves.toEqual([{ id: 'replacement' }]);
        await expect(fileSystem.getInfoAsync(chunkDirectory)).resolves.toMatchObject({ exists: false });
        await expect(fileSystem.getInfoAsync(markerPath)).resolves.toMatchObject({ exists: false });
        await expect(fileSystem.getInfoAsync(journalPath)).resolves.toMatchObject({ exists: false });
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('write', () => {
    it('writes data to an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.write(testTableName, {
        id: '1',
        name: 'test',
        age: 20,
      });

      expect(result).toBeDefined();
      expect(result.written).toBe(1);
      expect(result.totalAfterWrite).toBe(1);
    });

    it('advances and persists the single-file commit token for each durable mutation', async () => {
      const tableName = 'single_file_commit_token_table';

      try {
        await dataWriter.createTable(tableName, {
          mode: 'single',
          initialData: [{ id: 'keep' }, { id: 'remove' }],
        });
        const createToken = metadataManager.get(tableName)?.storageCommitToken;

        await dataWriter.write(tableName, { id: 'appended' });
        const writeToken = metadataManager.get(tableName)?.storageCommitToken;

        await dataWriter.delete(tableName, { id: 'remove' });
        const deleteToken = metadataManager.get(tableName)?.storageCommitToken;
        await metadataManager.saveImmediately();

        expect(createToken).toMatch(/^[0-9a-f]{32}$/);
        expect(writeToken).toMatch(/^[0-9a-f]{32}$/);
        expect(deleteToken).toMatch(/^[0-9a-f]{32}$/);
        expect(new Set([createToken, writeToken, deleteToken]).size).toBe(3);

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)?.storageCommitToken).toBe(deleteToken);
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });

    it('commits a full-table logical count with the single-file storage token', async () => {
      const tableName = 'single_file_logical_count_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      const physicalEnvelope = { __enc: 'ciphertext-for-three-logical-records' };

      try {
        await dataWriter.createTable(tableName, {
          mode: 'single',
          encrypted: true,
          encryptFullTable: true,
        });

        const result = await dataWriter.write(
          tableName,
          physicalEnvelope,
          withLogicalRecordCount({ mode: 'overwrite' as const }, 3)
        );
        const committedMetadata = metadataManager.get(tableName);

        expect(result).toMatchObject({ written: 1, totalAfterWrite: 3, chunked: false });
        expect(committedMetadata).toMatchObject({ count: 3, encryptFullTable: true });
        expect(committedMetadata?.storageCommitToken).toMatch(/^[0-9a-f]{32}$/);
        await expect(new SingleFileHandler(filePath).read()).resolves.toEqual([physicalEnvelope]);

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toMatchObject({
            count: 3,
            storageCommitToken: committedMetadata?.storageCommitToken,
          });
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });

    it('preserves storage policy when a write implicitly creates its table', async () => {
      const tableName = 'implicit_encrypted_table';

      try {
        const result = await dataWriter.write(
          tableName,
          { id: 'encrypted-record' },
          {
            encryptFullTable: true,
            requireAuthOnAccess: true,
            forceChunked: true,
          }
        );

        expect(result.chunked).toBe(true);
        expect(metadataManager.get(tableName)).toMatchObject({
          mode: 'chunked',
          encrypted: true,
          encryptFullTable: true,
          requireAuthOnAccess: true,
        });
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });

    it('batch writes data to an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.write(testTableName, [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
        { id: '3', name: 'test3', age: 30 },
      ]);

      expect(result).toBeDefined();
      expect(result.written).toBe(3);
      expect(result.totalAfterWrite).toBe(3);
    });

    it.each(indexConflictCases)(
      'rejects UNIQUE conflicts before $storageMode $writeMode storage mutation',
      async ({ storageMode, writeMode }) => {
        const tableName = `unique_preflight_${storageMode}_${writeMode}`;
        const initialData = [{ id: 'existing', email: 'occupied@example.test' }];
        const conflictingData =
          writeMode === 'append'
            ? [{ id: 'append-conflict', email: 'occupied@example.test' }]
            : [
                { id: 'overwrite-a', email: 'collision@example.test' },
                { id: 'overwrite-b', email: 'collision@example.test' },
              ];

        try {
          await dataWriter.createTable(tableName, { mode: storageMode, initialData });
          await indexManager.createIndex(tableName, 'email', IndexType.UNIQUE);
          indexManager.rebuildIndexes(tableName, initialData);
          const indexBefore = snapshotIndex(indexManager, tableName);
          const metadataBefore = metadataManager.get(tableName);

          await expect(
            dataWriter.write(tableName, conflictingData, writeMode === 'overwrite' ? { mode: 'overwrite' } : undefined)
          ).rejects.toMatchObject({
            code: 'TABLE_INDEX_NOT_UNIQUE',
          });

          const storedData =
            storageMode === 'chunked'
              ? await new ChunkedFileHandler(tableName, metadataManager).readAll()
              : await new SingleFileHandler(`${getRootPathSync()}${tableName}.ldb`).read();
          expect(storedData).toEqual(initialData);
          expect(metadataManager.get(tableName)).toMatchObject({
            count: metadataBefore?.count,
            indexes: metadataBefore?.indexes,
          });
          expect(snapshotIndex(indexManager, tableName)).toEqual(indexBefore);
        } finally {
          await dataWriter.deleteTable(tableName);
        }
      }
    );

    it('preserves index definitions when overwrite and delete rebuild index data', async () => {
      const initialData = [
        { id: '1', name: 'before' },
        { id: '2', name: 'remove-me' },
      ];
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        initialData,
      });
      await indexManager.createIndex(testTableName, 'name');
      indexManager.rebuildIndexes(testTableName, initialData);

      await dataWriter.write(
        testTableName,
        [
          { id: '3', name: 'after' },
          { id: '4', name: 'keep' },
        ],
        { mode: 'overwrite' }
      );

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.queryIndex(testTableName, 'name', 'before')).toEqual([]);
      expect(indexManager.queryIndex(testTableName, 'name', 'after')).toEqual(['3']);

      await dataWriter.delete(testTableName, { id: '3' });

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.queryIndex(testTableName, 'name', 'after')).toEqual([]);
      expect(indexManager.queryIndex(testTableName, 'name', 'keep')).toEqual(['4']);
    });

    it('restores single-file data, metadata, and indexes when metadata persistence fails', async () => {
      const tableName = 'write_metadata_failure_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      const initialData = [{ id: '1', name: 'before' }];

      await dataWriter.createTable(tableName, { mode: 'single', initialData });
      await indexManager.createIndex(tableName, 'name');
      indexManager.rebuildIndexes(tableName, initialData);
      await metadataManager.saveImmediately();

      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockRejectedValueOnce(new Error('simulated metadata persistence failure'));

      try {
        await expect(
          dataWriter.write(tableName, [{ id: '2', name: 'after' }], { mode: 'overwrite' })
        ).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });

        expect(metadataManager.get(tableName)).toMatchObject({ count: 1, mode: 'single' });
        await expect(new SingleFileHandler(filePath).read()).resolves.toEqual(initialData);
        expect(indexManager.queryIndex(tableName, 'name', 'before')).toEqual(['1']);
        expect(indexManager.queryIndex(tableName, 'name', 'after')).toEqual([]);

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toMatchObject({
            count: 1,
            mode: 'single',
            indexes: { name_normal: 'normal' },
          });
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        saveSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('exposes both the primary metadata failure and a rollback persistence failure', async () => {
      const tableName = 'write_rollback_persistence_failure_table';
      const primaryError = new Error('simulated metadata persistence failure');
      const recoveryError = new Error('simulated rollback persistence failure');

      await dataWriter.createTable(tableName, {
        mode: 'single',
        initialData: [{ id: 'before' }],
      });
      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockRejectedValueOnce(primaryError)
        .mockRejectedValueOnce(recoveryError);

      try {
        let failure: unknown;
        try {
          await dataWriter.write(tableName, { id: 'after' });
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(StorageError);
        if (!(failure instanceof StorageError)) {
          throw new Error('Expected DataWriter.write to reject with StorageError');
        }
        expect(failure.code).toBe('FILE_WRITE_FAILED');

        const cause = failure.cause;
        if (
          !(cause instanceof Error) ||
          !('primaryError' in cause) ||
          !('recoveryErrors' in cause) ||
          !Array.isArray(cause.recoveryErrors)
        ) {
          throw new Error('Expected a structured single-file recovery failure');
        }
        expect(cause.name).toBe('SingleFileRecoveryError');
        expect(cause.primaryError).toBe(primaryError);
        expect(cause.recoveryErrors).toContain(recoveryError);
      } finally {
        saveSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('serializes concurrent writes to the same table without losing records', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const writeResults = await Promise.all(
        Array.from({ length: 25 }).map((_, index) =>
          dataWriter.write(testTableName, {
            id: `concurrent-${index}`,
            name: `user-${index}`,
            age: index,
          })
        )
      );

      expect(writeResults.every(result => result.written === 1)).toBe(true);

      const verified = await dataWriter.verifyCount(testTableName);
      expect(verified).toEqual({
        metadata: 25,
        actual: 25,
        match: true,
      });

      const count = await dataWriter.count(testTableName);
      expect(count).toBe(25);
    });

    it('serializes read-modify-write operations across DataWriter instances', async () => {
      await dataWriter.createTable(testTableName, { mode: 'single' });
      const secondWriter = new DataWriter(metadataManager, indexManager);
      const originalWriteRecoverably = SingleFileHandler.prototype.writeRecoverably;
      let delayFirstWrite = true;
      let releaseFirstWrite: (() => void) | undefined;
      let signalFirstWriteStarted!: () => void;
      const firstWriteStarted = new Promise<void>(resolve => {
        signalFirstWriteStarted = resolve;
      });
      const writeSpy = jest.spyOn(SingleFileHandler.prototype, 'writeRecoverably').mockImplementation(async function (
        this: SingleFileHandler,
        records,
        targetStorageCommitToken
      ) {
        if (delayFirstWrite) {
          delayFirstWrite = false;
          signalFirstWriteStarted();
          await new Promise<void>(resolve => {
            releaseFirstWrite = resolve;
          });
        }
        await originalWriteRecoverably.call(this, records, targetStorageCommitToken);
      });

      try {
        const firstWrite = dataWriter.write(testTableName, { id: 'first' });
        await firstWriteStarted;
        const secondWrite = secondWriter.write(testTableName, { id: 'second' });

        releaseFirstWrite?.();
        await Promise.all([firstWrite, secondWrite]);

        await expect(dataWriter.verifyCount(testTableName)).resolves.toEqual({
          metadata: 2,
          actual: 2,
          match: true,
        });
      } finally {
        releaseFirstWrite?.();
        writeSpy.mockRestore();
      }
    });

    it('refreshes a stale manager before writing to an empty table migrated by another instance', async () => {
      const tableName = 'cross_instance_empty_chunk_migration_table';
      const secondMetadata = new MetadataManager();
      let secondWriter: DataWriter | undefined;

      try {
        await dataWriter.createTable(tableName, { mode: 'single' });
        await secondMetadata.waitForLoad();
        const secondIndexManager = new IndexManager(secondMetadata);
        secondWriter = new DataWriter(secondMetadata, secondIndexManager);
        expect(secondMetadata.get(tableName)?.mode).toBe('single');

        await dataWriter.migrateToChunked(tableName);
        await expect(secondWriter.write(tableName, { id: 'written-after-migration' })).resolves.toMatchObject({
          totalAfterWrite: 1,
          chunked: true,
        });

        expect(secondMetadata.get(tableName)).toMatchObject({ mode: 'chunked', count: 1 });
        await expect(new ChunkedFileHandler(tableName, secondMetadata).readAll()).resolves.toEqual([
          { id: 'written-after-migration' },
        ]);
        await expect(getFileSystem().getInfoAsync(`${getRootPathSync()}${tableName}.ldb`)).resolves.toMatchObject({
          exists: false,
        });
      } finally {
        secondMetadata.cleanup();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('does not resurrect a table deleted after the existence check', async () => {
      const tableName = 'deleted_between_check_and_lock_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;

      await dataWriter.createTable(tableName, {
        mode: 'single',
        initialData: [{ id: 'must-stay-deleted' }],
      });
      const originalHasTable = dataWriter.hasTable.bind(dataWriter);
      const hasTableSpy = jest.spyOn(dataWriter, 'hasTable').mockImplementationOnce(async currentTableName => {
        const exists = await originalHasTable(currentTableName);
        await dataWriter.deleteTable(currentTableName);
        return exists;
      });

      try {
        await expect(dataWriter.write(tableName, { id: 'must-not-recreate' })).rejects.toMatchObject({
          code: 'TABLE_NOT_FOUND',
        });
        expect(metadataManager.get(tableName)).toBeUndefined();
        await expect(getFileSystem().getInfoAsync(filePath)).resolves.toMatchObject({ exists: false });
      } finally {
        hasTableSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('does not let a timed-out waiter break the table lock FIFO chain', async () => {
      const writer = getDataWriterPrivateAccess(dataWriter);
      const releaseOwner = await writer.acquireLock('fifo_lock_table');

      jest.useFakeTimers();
      try {
        const timedOutWaiter = writer.acquireLock('fifo_lock_table');
        const timeoutAssertion = expect(timedOutWaiter).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
        await Promise.resolve();
        jest.advanceTimersByTime(30000);
        await timeoutAssertion;

        let followerAcquired = false;
        const follower = writer.acquireLock('fifo_lock_table').then(release => {
          followerAcquired = true;
          return release;
        });
        await Promise.resolve();
        expect(followerAcquired).toBe(false);

        releaseOwner();
        const releaseFollower = await follower;
        releaseFollower();
      } finally {
        jest.useRealTimers();
        releaseOwner();
      }
    });

    it('transfers queued concurrency slots without exceeding the configured limit', async () => {
      const writer = getDataWriterPrivateAccess(dataWriter);
      const ownerReleases = await Promise.all(
        Array.from({ length: writer.maxConcurrentOperations }, (_, index) => writer.acquireLock(`slot_owner_${index}`))
      );

      const queued = writer.acquireLock('queued_slot');
      const releasedOwner = ownerReleases.pop();
      if (!releasedOwner) {
        throw new Error('Expected at least one concurrency slot owner');
      }
      releasedOwner();

      const lateArrival = writer.acquireLock('late_slot');
      const releaseQueued = await queued;
      expect(writer.activeOperations).toBe(writer.maxConcurrentOperations);

      let lateArrivalAcquired = false;
      void lateArrival.then(() => {
        lateArrivalAcquired = true;
      });
      await Promise.resolve();
      expect(lateArrivalAcquired).toBe(false);

      releaseQueued();
      const releaseLateArrival = await lateArrival;
      releaseLateArrival();
      ownerReleases.forEach(release => release());
      expect(writer.activeOperations).toBe(0);
    });

    it('appends to a chunked table without reading the entire table first', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'chunked',
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const readAllSpy = jest.spyOn(ChunkedFileHandler.prototype, 'readAll');

      try {
        const result = await dataWriter.write(testTableName, { id: '1', name: 'test' });

        expect(result).toMatchObject({
          written: 1,
          totalAfterWrite: 1,
          chunked: true,
        });
        expect(readAllSpy).not.toHaveBeenCalled();
      } finally {
        readAllSpy.mockRestore();
      }
    });

    it('honors forceChunked by converting a single-file table under the write lock', async () => {
      const forceChunkedTable = 'force_chunked_table';
      await dataWriter.createTable(forceChunkedTable, {
        mode: 'single',
        initialData: [{ id: '1', name: 'before-migration' }],
      });
      expect(metadataManager.get(forceChunkedTable)?.storageCommitToken).toMatch(/^[0-9a-f]{32}$/);

      try {
        const result = await dataWriter.write(
          forceChunkedTable,
          { id: '2', name: 'after-migration' },
          { forceChunked: true }
        );

        expect(result).toMatchObject({
          written: 1,
          totalAfterWrite: 2,
          chunked: true,
        });
        expect(metadataManager.get(forceChunkedTable)).toMatchObject({
          mode: 'chunked',
          path: `${forceChunkedTable}/`,
          count: 2,
        });
        expect(metadataManager.get(forceChunkedTable)).not.toHaveProperty('storageCommitToken');
        await expect(new ChunkedFileHandler(forceChunkedTable, metadataManager).readAll()).resolves.toEqual([
          { id: '1', name: 'before-migration' },
          { id: '2', name: 'after-migration' },
        ]);
      } finally {
        await dataWriter.deleteTable(forceChunkedTable);
      }
    });

    it('keeps a committed chunked migration authoritative when source cleanup fails', async () => {
      const tableName = 'force_chunked_cleanup_failure_table';
      const rootPath = getRootPathSync();
      const sourceFilePath = `${rootPath}${tableName}.ldb`;
      const fileSystem = getFileSystem();

      await dataWriter.createTable(tableName, {
        mode: 'single',
        initialData: [{ id: 'source', value: 'still-authoritative' }],
      });

      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === sourceFilePath) {
          throw new Error('simulated source cleanup failure');
        }
        await deleteAsync(path, options);
      });
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      try {
        await expect(
          dataWriter.write(tableName, { id: 'new', value: 'published' }, { forceChunked: true })
        ).resolves.toMatchObject({
          totalAfterWrite: 2,
          chunked: true,
        });
        expect(metadataManager.get(tableName)).toMatchObject({ mode: 'chunked', count: 2 });
        await expect(new SingleFileHandler(sourceFilePath).read()).resolves.toEqual([
          { id: 'source', value: 'still-authoritative' },
        ]);
        await expect(new ChunkedFileHandler(tableName, metadataManager).readAll()).resolves.toEqual([
          { id: 'source', value: 'still-authoritative' },
          { id: 'new', value: 'published' },
        ]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(sourceFilePath), expect.any(Error));
      } finally {
        warnSpy.mockRestore();
        deleteSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('delete', () => {
    it('deletes matching data from a table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
          { id: '3', name: 'test3', age: 30 },
        ],
      });

      const result = await dataWriter.delete(testTableName, { age: { $gt: 25 } });

      expect(result).toBe(1);
    });

    it('deletes all matching data', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
          { id: '3', name: 'test3', age: 30 },
        ],
      });

      const result = await dataWriter.delete(testTableName, {});

      expect(result).toBe(3);
    });

    it('restores a single-file deletion when metadata persistence fails', async () => {
      const tableName = 'delete_metadata_failure_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      const initialData = [
        { id: '1', name: 'keep' },
        { id: '2', name: 'remove' },
      ];

      await dataWriter.createTable(tableName, { mode: 'single', initialData });
      await indexManager.createIndex(tableName, 'name');
      indexManager.rebuildIndexes(tableName, initialData);
      await metadataManager.saveImmediately();

      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockRejectedValueOnce(new Error('simulated metadata persistence failure'));

      try {
        await expect(dataWriter.delete(tableName, { id: '2' })).rejects.toThrow(
          `delete from table ${tableName} failed`
        );

        expect(metadataManager.get(tableName)).toMatchObject({ count: 2, mode: 'single' });
        await expect(new SingleFileHandler(filePath).read()).resolves.toEqual(initialData);
        expect(indexManager.queryIndex(tableName, 'name', 'keep')).toEqual(['1']);
        expect(indexManager.queryIndex(tableName, 'name', 'remove')).toEqual(['2']);

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toMatchObject({
            count: 2,
            mode: 'single',
            indexes: { name_normal: 'normal' },
          });
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        saveSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('does not erase index schema or data when delete planning fails unexpectedly', async () => {
      const tableName = 'delete_index_plan_failure_table';
      const initialData = [
        { id: 'keep', email: 'keep@example.test' },
        { id: 'remove', email: 'remove@example.test' },
      ];
      await dataWriter.createTable(tableName, { mode: 'chunked', initialData });
      await indexManager.createIndex(tableName, 'email', IndexType.UNIQUE);
      indexManager.rebuildIndexes(tableName, initialData);
      const indexBefore = snapshotIndex(indexManager, tableName);
      const metadataBefore = metadataManager.get(tableName);
      const planError = new Error('simulated index planning failure');
      const planSpy = jest.spyOn(indexManager, 'stageIndexUpdate').mockImplementationOnce(() => {
        throw planError;
      });
      const writeSpy = jest.spyOn(ChunkedFileHandler.prototype, 'write');

      try {
        await expect(dataWriter.delete(tableName, { id: 'remove' })).rejects.toMatchObject({ cause: planError });

        expect(writeSpy).not.toHaveBeenCalled();
        await expect(new ChunkedFileHandler(tableName, metadataManager).readAll()).resolves.toEqual(initialData);
        expect(metadataManager.get(tableName)).toMatchObject({
          count: metadataBefore?.count,
          indexes: metadataBefore?.indexes,
        });
        expect(snapshotIndex(indexManager, tableName)).toEqual(indexBefore);
      } finally {
        planSpy.mockRestore();
        writeSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('count', () => {
    it('returns a table record count', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
        initialData: [
          { id: '1', name: 'test1', age: 20 },
          { id: '2', name: 'test2', age: 25 },
        ],
      });

      const count = await dataWriter.count(testTableName);

      expect(count).toBe(2);
    });

    it('returns the metadata count before background validation completes', async () => {
      const records = [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
      ];
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: { id: 'string', name: 'string', age: 'number' },
        initialData: records,
      });

      const pendingRead = mockPendingSingleFileRead();

      try {
        const countPromise = dataWriter.count(testTableName);
        await pendingRead.readStarted;

        let countResult: number | undefined;
        void countPromise.then(result => {
          countResult = result;
        });
        await Promise.resolve();

        expect(countResult).toBe(2);

        const validations = getDataWriterPrivateAccess(dataWriter).countValidationInFlight;
        const validation = validations.get(testTableName);
        expect(validation).toBeDefined();

        pendingRead.resolveRead(records);
        await validation;
        await expect(countPromise).resolves.toBe(2);
      } finally {
        pendingRead.resolveRead(records);
        pendingRead.restore();
      }
    });

    it('deduplicates concurrent background count validations per table', async () => {
      const records = [
        { id: '1', name: 'test1', age: 20 },
        { id: '2', name: 'test2', age: 25 },
      ];
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: { id: 'string', name: 'string', age: 'number' },
        initialData: records,
      });

      const pendingRead = mockPendingSingleFileRead();

      try {
        const countPromises = [
          dataWriter.count(testTableName),
          dataWriter.count(testTableName),
          dataWriter.count(testTableName),
        ];
        await pendingRead.readStarted;

        expect(pendingRead.getCallCount()).toBe(1);
        await expect(Promise.all(countPromises)).resolves.toEqual([2, 2, 2]);

        const validations = getDataWriterPrivateAccess(dataWriter).countValidationInFlight;
        const validation = validations.get(testTableName);
        expect(validation).toBeDefined();

        pendingRead.resolveRead(records);
        await validation;
      } finally {
        pendingRead.resolveRead(records);
        pendingRead.restore();
      }
    });

    it('returns zero records for a nonexistent table', async () => {
      const count = await dataWriter.count('non_existent_table');

      expect(count).toBe(0);
    });
  });

  describe('verifyCount', () => {
    it('returns metadata and actual counts separately and repairs metadata drift', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      await dataWriter.write(testTableName, [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      metadataManager.update(testTableName, { count: 99 });

      const result = await dataWriter.verifyCount(testTableName);

      expect(result).toEqual({
        metadata: 99,
        actual: 2,
        match: false,
      });
      expect(metadataManager.count(testTableName)).toBe(2);
    });

    it('fails closed when the physical table is corrupted', async () => {
      const tableName = 'corrupted_count_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      await dataWriter.createTable(tableName, {
        mode: 'single',
        initialData: [{ id: 'valid-before-corruption' }],
      });
      global.__expo_file_system_mock__.mockFileSystem[filePath] = 'corrupted';
      FileHandlerBase.invalidateFileInfoCache(filePath);

      await expect(dataWriter.verifyCount(tableName)).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(metadataManager.count(tableName)).toBe(1);
    });
  });

  describe('deleteTable', () => {
    it('deletes an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });
      const markerPath = `${getRootPathSync()}${testTableName}.ldb.commit-marker`;
      const markerTempPath = `${markerPath}.tmp`;
      await getFileSystem().writeAsStringAsync(markerPath, 'pending-marker');
      await getFileSystem().writeAsStringAsync(markerTempPath, 'pending-marker-temp');

      await dataWriter.deleteTable(testTableName);

      const tableMeta = metadataManager.get(testTableName);
      expect(tableMeta).toBeUndefined();
      await expect(getFileSystem().getInfoAsync(markerPath)).resolves.toMatchObject({ exists: false });
      await expect(getFileSystem().getInfoAsync(markerTempPath)).resolves.toMatchObject({ exists: false });
    });

    it('does not throw when deleting a nonexistent table', async () => {
      await expect(dataWriter.deleteTable('non_existent_table')).resolves.not.toThrow();
    });

    it('preserves metadata and physical data when the metadata deletion cannot be committed', async () => {
      const tableName = 'delete_metadata_commit_failure_table';
      const filePath = `${getRootPathSync()}${tableName}.ldb`;
      const originalData = [{ id: 'preserved', value: 'original' }];
      await dataWriter.createTable(tableName, { mode: 'single', initialData: originalData });

      const saveSpy = jest
        .spyOn(metadataManager, 'saveImmediately')
        .mockRejectedValueOnce(new Error('simulated delete metadata commit failure'));
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      try {
        await expect(dataWriter.deleteTable(tableName)).rejects.toMatchObject({ code: 'TABLE_DELETE_FAILED' });
        expect(metadataManager.get(tableName)).toMatchObject({ mode: 'single', count: 1 });
        await expect(new SingleFileHandler(filePath).read()).resolves.toEqual(originalData);

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toMatchObject({ mode: 'single', count: 1 });
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        saveSpy.mockRestore();
        errorSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('keeps a physical cleanup failure logically deleted and retryable', async () => {
      const tableName = 'delete_cleanup_failure_table';
      const rootPath = getRootPathSync();
      const staleSingleFilePath = `${rootPath}${tableName}.ldb`;
      const chunkDirectory = `${rootPath}${tableName}/`;
      const fileSystem = getFileSystem();

      await dataWriter.createTable(tableName, {
        mode: 'chunked',
        initialData: [{ id: 'current', value: 'authoritative' }],
      });
      await new SingleFileHandler(staleSingleFilePath).write([{ id: 'stale', value: 'residual' }]);

      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === staleSingleFilePath) {
          throw new Error('simulated stale-file cleanup failure');
        }
        await deleteAsync(path, options);
      });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

      try {
        let deletionError: unknown;
        try {
          await dataWriter.deleteTable(tableName);
        } catch (error) {
          deletionError = error;
        }
        expect(deletionError).toBeInstanceOf(StorageError);
        if (!(deletionError instanceof StorageError)) {
          throw new Error('Expected a StorageError for incomplete physical cleanup');
        }
        expect(deletionError.code).toBe('TABLE_DELETE_FAILED');
        expect(deletionError.details).toContain('logically absent');
        expect(metadataManager.get(tableName)).toBeUndefined();
        await expect(fileSystem.getInfoAsync(staleSingleFilePath)).resolves.toMatchObject({ exists: true });
        await expect(fileSystem.getInfoAsync(chunkDirectory)).resolves.toMatchObject({ exists: false });
      } finally {
        errorSpy.mockRestore();
        deleteSpy.mockRestore();
        await dataWriter.deleteTable(tableName);
      }

      await expect(fileSystem.getInfoAsync(staleSingleFilePath)).resolves.toMatchObject({ exists: false });
      await expect(fileSystem.getInfoAsync(chunkDirectory)).resolves.toMatchObject({ exists: false });
    });

    it('does not let a stale count check recreate metadata deleted by another manager', async () => {
      const tableName = 'stale_count_deleted_table';
      const staleMetadata = new MetadataManager();

      try {
        await dataWriter.createTable(tableName, {
          mode: 'single',
          initialData: [{ id: 'deleted' }],
        });
        await staleMetadata.waitForLoad();
        const staleWriter = new DataWriter(staleMetadata, new IndexManager(staleMetadata));
        expect(staleMetadata.get(tableName)).toMatchObject({ count: 1 });

        await dataWriter.deleteTable(tableName);
        await expect(staleWriter.count(tableName)).resolves.toBe(0);
        await staleMetadata.saveImmediately();

        const reloadedMetadata = new MetadataManager();
        try {
          await reloadedMetadata.waitForLoad();
          expect(reloadedMetadata.get(tableName)).toBeUndefined();
        } finally {
          reloadedMetadata.cleanup();
        }
      } finally {
        staleMetadata.cleanup();
        await dataWriter.deleteTable(tableName);
      }
    });

    it('purges pending chunk journals so deleted data cannot reappear after a same-name recreation', async () => {
      const tableName = 'delete_journal_cleanup_table';
      const rootPath = getRootPathSync();
      const journalPaths = [
        `${rootPath}${tableName}.overwrite-journal`,
        `${rootPath}${tableName}.overwrite-journal.tmp`,
        `${rootPath}${tableName}.append-journal`,
        `${rootPath}${tableName}.append-journal.tmp`,
      ];
      const overwriteBackupPath = `${rootPath}${tableName}.overwrite-backup/`;
      const handler = new ChunkedFileHandler(tableName, metadataManager);

      await dataWriter.createTable(tableName, {
        mode: 'chunked',
        initialData: [{ id: 'deleted', value: 'old-data' }],
      });
      await getChunkedFileHandlerPrivateAccess(handler).writeOverwriteJournal(
        [{ id: 'deleted', value: 'old-data' }],
        [{ id: 'next' }]
      );
      await getFileSystem().makeDirectoryAsync(overwriteBackupPath, { intermediates: true });
      await getFileSystem().writeAsStringAsync(`${overwriteBackupPath}000000.ldb`, 'orphaned backup');

      try {
        await dataWriter.deleteTable(tableName);

        for (const journalPath of journalPaths) {
          await expect(getFileSystem().getInfoAsync(journalPath)).resolves.toMatchObject({ exists: false });
        }
        await expect(getFileSystem().getInfoAsync(overwriteBackupPath)).resolves.toMatchObject({ exists: false });

        await dataWriter.createTable(tableName, {
          mode: 'chunked',
          initialData: [{ id: 'replacement', value: 'new-data' }],
        });
        await expect(new ChunkedFileHandler(tableName, metadataManager).readAll()).resolves.toEqual([
          { id: 'replacement', value: 'new-data' },
        ]);
      } finally {
        await dataWriter.deleteTable(tableName);
      }
    });
  });

  describe('hasTable', () => {
    it('returns true for an existing table', async () => {
      await dataWriter.createTable(testTableName, {
        mode: 'single',
        columns: {
          id: 'string',
          name: 'string',
          age: 'number',
        },
      });

      const result = await dataWriter.hasTable(testTableName);

      expect(result).toBe(true);
    });

    it('returns false for a nonexistent table', async () => {
      const result = await dataWriter.hasTable('non_existent_table');

      expect(result).toBe(false);
    });
  });
});
