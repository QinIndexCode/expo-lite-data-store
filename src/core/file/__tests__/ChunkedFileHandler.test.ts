/// <reference path="../../../__tests__/test-globals.d.ts" />

import { MetadataManager } from '../../meta/MetadataManager';
import { ChunkedFileHandler } from '../ChunkedFileHandler';
import { FileHandlerBase } from '../FileHandlerBase';
import logger from '../../../utils/logger';
import { configManager } from '../../config/ConfigManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { isStorageRecord, type StorageRecord } from '../../../types/storageTypes';
import { hashHexSync } from '../../../utils/cryptoPrimitives';

type ChunkedFileHandlerPrivateAccess = {
  computeHash: (data: unknown) => Promise<string>;
  preprocessData: (data: StorageRecord[], chunkSize: number) => Promise<StorageRecord[][]>;
  writeChunk: (index: number, data: StorageRecord[]) => Promise<void>;
  writeAppendJournal: (
    previousCount: number,
    previousChunks: number,
    targetChunkIndices: number[],
    targetCount: number
  ) => Promise<void>;
};

const getChunkedFileHandlerPrivateAccess = (handler: ChunkedFileHandler): ChunkedFileHandlerPrivateAccess =>
  handler as unknown as ChunkedFileHandlerPrivateAccess;

const tableDirPath = '/mock/documents/lite-data-store/test_chunked_table/';
const overwriteJournalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
const overwriteBackupPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-backup/';
const overwriteBackupMarkerPath = `${overwriteBackupPath}.ready`;
const appendJournalPath = '/mock/documents/lite-data-store/test_chunked_table.append-journal';

const computeFixtureHash = (value: unknown): string => hashHexSync(JSON.stringify(value), 'SHA-256');

const writeJournalEnvelope = async (path: string, journal: object): Promise<void> => {
  await getFileSystem().writeAsStringAsync(
    path,
    JSON.stringify({
      journal,
      hash: computeFixtureHash(journal),
    })
  );
};

const writeLegacyOverwriteJournal = async (
  tableName: string,
  previousData: StorageRecord[],
  targetData: StorageRecord[]
): Promise<void> => {
  await writeJournalEnvelope(overwriteJournalPath, {
    version: 1,
    tableName,
    previousData,
    previousHash: computeFixtureHash(previousData),
    targetHash: computeFixtureHash(targetData),
    targetCount: targetData.length,
    createdAt: Date.now(),
  });
};

type V2OverwriteFixture = {
  version: 2;
  tableName: string;
  previousMetadataExisted: boolean;
  previousDirectoryExisted: boolean;
  previousCount: number;
  previousChunks: number;
  createdAt: number;
};

const writeV2OverwriteJournal = async (
  tableName: string,
  previousCount: number,
  previousChunks: number
): Promise<V2OverwriteFixture> => {
  const journal: V2OverwriteFixture = {
    version: 2,
    tableName,
    previousMetadataExisted: true,
    previousDirectoryExisted: true,
    previousCount,
    previousChunks,
    createdAt: Date.now(),
  };
  await writeJournalEnvelope(overwriteJournalPath, journal);
  return journal;
};

const moveChunkToOverwriteBackup = async (index: number): Promise<void> => {
  const fileName = `${String(index).padStart(6, '0')}.ldb`;
  await getFileSystem().makeDirectoryAsync(overwriteBackupPath, { intermediates: true });
  await getFileSystem().moveAsync({ from: `${tableDirPath}${fileName}`, to: `${overwriteBackupPath}${fileName}` });
};

const markOverwriteBackupReady = async (journal: V2OverwriteFixture): Promise<void> => {
  await getFileSystem().writeAsStringAsync(
    overwriteBackupMarkerPath,
    JSON.stringify({ version: 1, tableName: journal.tableName, createdAt: journal.createdAt })
  );
};

const resetCanonicalDirectory = async (): Promise<void> => {
  await getFileSystem().deleteAsync(tableDirPath, { idempotent: true });
  await getFileSystem().makeDirectoryAsync(tableDirPath, { intermediates: true });
};

const readMockFileText = (path: string): string => {
  const entry = global.__expo_file_system_mock__.mockFileSystem[path];
  if (typeof entry !== 'string') {
    throw new Error(`Expected a file at ${path}`);
  }
  return entry;
};

type PersistedChunkFile = {
  data: StorageRecord[];
  hash: string;
};

const isStorageRecordArray = (value: unknown): value is StorageRecord[] =>
  Array.isArray(value) && value.every(isStorageRecord);

const parsePersistedChunkFile = (serialized: string): PersistedChunkFile => {
  const parsed: unknown = JSON.parse(serialized) as unknown;
  if (!isStorageRecord(parsed) || !isStorageRecordArray(parsed.data) || typeof parsed.hash !== 'string') {
    throw new Error('Expected a persisted chunk with records and an integrity hash');
  }
  return { data: parsed.data, hash: parsed.hash };
};

describe('ChunkedFileHandler', () => {
  let chunkedFileHandler: ChunkedFileHandler;
  let metadataManager: MetadataManager;
  const testTableName = 'test_chunked_table';

  beforeEach(async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    configManager.resetConfig();
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
    FileHandlerBase.invalidateFileInfoCache();

    metadataManager = new MetadataManager();
    await metadataManager.waitForLoad();
    chunkedFileHandler = new ChunkedFileHandler(testTableName, metadataManager);
  });

  afterEach(async () => {
    await chunkedFileHandler.clear();

    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
    metadataManager.cleanup();
    configManager.resetConfig();
    jest.restoreAllMocks();
  });

  describe('basic behavior', () => {
    it('writes and reads records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual(testData);
    });

    it('appends records after existing data', async () => {
      const initialData = [{ id: 1, name: 'test1' }];
      const appendData = [
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      await chunkedFileHandler.write(initialData);

      await chunkedFileHandler.append(appendData);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([...initialData, ...appendData]);
    });

    it('keeps cross-instance reads behind an append until its journal is committed', async () => {
      const initialData = [{ id: 1, name: 'committed' }];
      const appendData = [{ id: 2, name: 'pending' }];
      await chunkedFileHandler.write(initialData);

      const writer = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = writer.writeChunk.bind(writer);
      let releaseChunkWrite: (() => void) | undefined;
      let reportChunkPublished!: () => void;
      const chunkPublished = new Promise<void>(resolve => {
        reportChunkPublished = resolve;
      });
      const writeSpy = jest.spyOn(writer, 'writeChunk').mockImplementation(async (...args) => {
        await originalWriteChunk(...args);
        reportChunkPublished();
        await new Promise<void>(resolve => {
          releaseChunkWrite = resolve;
        });
      });
      let appendPromise: Promise<void> | undefined;

      try {
        appendPromise = chunkedFileHandler.append(appendData);
        await chunkPublished;

        const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
        expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeDefined();
        expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeDefined();

        const reader = new ChunkedFileHandler(testTableName, metadataManager);
        let readSettled = false;
        const readPromise = reader.readAll().then(records => {
          readSettled = true;
          return records;
        });
        await Promise.resolve();

        expect(readSettled).toBe(false);
        expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeDefined();

        const releasePublishedChunk = releaseChunkWrite;
        if (!releasePublishedChunk) {
          throw new Error('Expected the delayed chunk write to be releasable');
        }
        releasePublishedChunk();
        await expect(appendPromise).resolves.toBeUndefined();
        await expect(readPromise).resolves.toEqual([...initialData, ...appendData]);
      } finally {
        releaseChunkWrite?.();
        await appendPromise?.catch(() => undefined);
        writeSpy.mockRestore();
      }
    });

    it('clears persisted records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      await chunkedFileHandler.clear();

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('deletes persisted records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      await chunkedFileHandler.write(testData);

      await chunkedFileHandler.delete();

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });
  });

  describe('multi-chunk reads', () => {
    it('reads all records', async () => {
      const testData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
        { id: 3, name: 'test3' },
      ];

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readAll();

      expect(result).toEqual(testData);
    });

    it('reads a requested chunk range', async () => {
      // This fixture spans multiple chunks so the range boundary is exercised.
      const testData = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `test${i}` }));

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readRange(0, 0);

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('edge cases', () => {
    it('accepts an empty record set', async () => {
      await chunkedFileHandler.write([]);

      const result = await chunkedFileHandler.read();

      expect(result).toEqual([]);
    });

    it('writes a large record set in one operation', async () => {
      // The payload size forces chunking without making the fixture unbounded.
      const testData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `test${i}`,
        data: `test data ${i}`.repeat(100),
      }));

      await chunkedFileHandler.write(testData);

      const result = await chunkedFileHandler.readAll();

      expect(result.length).toBe(testData.length);
      expect(result[0]).toEqual(testData[0]);
      expect(result[result.length - 1]).toEqual(testData[testData.length - 1]);
    });
  });

  describe('failure handling', () => {
    it('rejects a non-record write payload', async () => {
      const invalidData: unknown = 'invalid data';

      await expect(chunkedFileHandler.write(invalidData as StorageRecord[])).rejects.toThrow();
    });

    it('rejects a corrupted chunk instead of silently dropping its records', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      const parsed = parsePersistedChunkFile(readMockFileText(chunkPath));
      const firstRecord = parsed.data[0];
      if (!firstRecord) {
        throw new Error('Expected the persisted chunk to contain a record');
      }
      firstRecord.name = 'tampered';
      fileSystem[chunkPath] = JSON.stringify(parsed);

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('does not clear corrupted source data when an overwrite cannot take a snapshot', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[chunkPath] = '{corrupted';

      await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toMatchObject({
        code: 'CORRUPTED_DATA',
      });
      expect(fileSystem[chunkPath]).toBe('{corrupted');
    });

    it('publishes single-file migration metadata only after every chunk is durable', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      const migrationData = [
        { id: 1, payload: 'x'.repeat(300) },
        { id: 2, payload: 'y'.repeat(300) },
      ];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 1,
      });
      await metadataManager.saveImmediately();

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      const observedModes: Array<string | undefined> = [];
      const writeSpy = jest.spyOn(handler, 'writeChunk').mockImplementation(async (...args) => {
        await originalWriteChunk(...args);
        observedModes.push(metadataManager.get(testTableName)?.mode);
      });

      try {
        await chunkedFileHandler.writeSingleFileMigration(migrationData);
      } finally {
        writeSpy.mockRestore();
      }

      expect(observedModes.length).toBeGreaterThan(1);
      expect(observedModes.every(mode => mode === 'single')).toBe(true);
      expect(metadataManager.get(testTableName)).toMatchObject({
        mode: 'chunked',
        path: `${testTableName}/`,
        count: migrationData.length,
        chunks: observedModes.length,
      });
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(migrationData);
    });

    it('restores single-file metadata and removes staged chunks when migration fails', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      const migrationData = [
        { id: 1, payload: 'x'.repeat(300) },
        { id: 2, payload: 'y'.repeat(300) },
      ];
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 1,
      });
      await metadataManager.saveImmediately();

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let writeAttempts = 0;
      const writeSpy = jest.spyOn(handler, 'writeChunk').mockImplementation(async (...args) => {
        writeAttempts++;
        if (writeAttempts === 2) {
          throw new Error('injected migration chunk failure');
        }
        await originalWriteChunk(...args);
      });

      try {
        await expect(chunkedFileHandler.writeSingleFileMigration(migrationData)).rejects.toThrow();
      } finally {
        writeSpy.mockRestore();
      }

      expect(metadataManager.get(testTableName)).toMatchObject({
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 1,
      });
      const persistedFiles = global.__expo_file_system_mock__.mockFileSystem;
      expect(persistedFiles[tableDirPath]).toBeUndefined();
      expect(persistedFiles[`${tableDirPath}000000.ldb`]).toBeUndefined();
    });

    it('restores previous data when a chunked overwrite fails', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let writeAttempts = 0;
      const writeSpy = jest
        .spyOn(handler, 'writeChunk')
        .mockImplementation(async (...args: Parameters<typeof handler.writeChunk>) => {
          writeAttempts++;
          if (writeAttempts === 1) {
            throw new Error('injected chunk write failure');
          }
          return originalWriteChunk(...args);
        });

      try {
        await expect(chunkedFileHandler.write([{ id: 2, name: 'replacement' }])).rejects.toThrow();
      } finally {
        writeSpy.mockRestore();
      }

      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('rejects non-serializable records without silently dropping them', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      await chunkedFileHandler.write(originalData);

      const circular: StorageRecord = { id: 2 };
      circular.self = circular;

      await expect(chunkedFileHandler.write([circular])).rejects.toThrow();
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('recovers previous data from a legacy v1 overwrite journal', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      await writeLegacyOverwriteJournal(testTableName, originalData, replacementData);
      await resetCanonicalDirectory();
      metadataManager.update(testTableName, { count: 0, chunks: 0 });
      await metadataManager.saveImmediately();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[overwriteJournalPath]).toBeUndefined();
    });

    it('keeps a completed legacy v1 overwrite when only journal cleanup was interrupted', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'committed-replacement' }];
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await chunkedFileHandler.write(originalData);

      await writeLegacyOverwriteJournal(testTableName, originalData, replacementData);
      await resetCanonicalDirectory();
      await handler.writeChunk(0, replacementData);
      metadataManager.update(testTableName, { mode: 'chunked', count: 1, chunks: 1 });
      await metadataManager.saveImmediately();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(replacementData);
      expect(global.__expo_file_system_mock__.mockFileSystem[overwriteJournalPath]).toBeUndefined();
    });

    it('writes a bounded v2 overwrite journal without embedding previous rows', async () => {
      const previousPayload = 'previous-row-must-not-enter-journal';
      const originalData = [{ id: 1, payload: previousPayload }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      await chunkedFileHandler.write(originalData);

      const fileSystem = getFileSystem();
      const originalWrite = fileSystem.writeAsStringAsync.bind(fileSystem);
      let journalText: string | undefined;
      const writeSpy = jest
        .spyOn(fileSystem, 'writeAsStringAsync')
        .mockImplementation(async (uri, contents, options) => {
          if (uri === `${overwriteJournalPath}.tmp`) {
            journalText = contents;
          }
          await originalWrite(uri, contents, options);
        });

      try {
        await chunkedFileHandler.write(replacementData);
      } finally {
        writeSpy.mockRestore();
      }

      expect(journalText).toBeDefined();
      expect(journalText).not.toContain(previousPayload);
      const parsed: unknown = JSON.parse(journalText ?? 'null') as unknown;
      if (!isStorageRecord(parsed) || !isStorageRecord(parsed.journal)) {
        throw new Error('Expected a v2 overwrite journal envelope');
      }
      expect(parsed.journal.version).toBe(2);
      expect(parsed.journal).not.toHaveProperty('previousData');
    });

    it('rolls back a pending append before recovering its enclosing overwrite', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await chunkedFileHandler.write(originalData);

      const journal = await writeV2OverwriteJournal(testTableName, 1, 1);
      await moveChunkToOverwriteBackup(0);
      await markOverwriteBackupReady(journal);
      await resetCanonicalDirectory();
      await handler.writeAppendJournal(0, 0, [0], replacementData.length);
      await handler.writeChunk(0, replacementData);
      metadataManager.update(testTableName, {
        mode: 'chunked',
        count: replacementData.length,
        chunks: 1,
      });
      await metadataManager.saveImmediately();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.overwrite-journal']).toBeUndefined();
    });

    it('merges a partially prepared v2 backup without guessing between conflicting chunks', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      const originalData = [
        { id: 1, payload: 'x'.repeat(300) },
        { id: 2, payload: 'y'.repeat(300) },
      ];
      await chunkedFileHandler.write(originalData);
      const metadata = metadataManager.get(testTableName);
      if (!metadata?.chunks || metadata.chunks < 2) {
        throw new Error('Expected a multi-chunk fixture');
      }

      await writeV2OverwriteJournal(testTableName, originalData.length, metadata.chunks);
      await moveChunkToOverwriteBackup(0);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);
      expect(global.__expo_file_system_mock__.mockFileSystem[overwriteJournalPath]).toBeUndefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[overwriteBackupPath]).toBeUndefined();
    });

    it('preserves a committed overwrite when backup cleanup is retried by a later read', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'committed-replacement' }];
      const backupChunkPath = `${overwriteBackupPath}000000.ldb`;
      await chunkedFileHandler.write(originalData);

      const fileSystem = getFileSystem();
      const originalDelete = fileSystem.deleteAsync.bind(fileSystem);
      let backupCleanupFailures = 1;
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri === overwriteBackupPath && backupCleanupFailures > 0) {
          backupCleanupFailures--;
          throw new Error('injected committed backup cleanup failure');
        }
        await originalDelete(uri, options);
      });

      try {
        await expect(chunkedFileHandler.write(replacementData)).resolves.toBeUndefined();
        const persistedFiles = global.__expo_file_system_mock__.mockFileSystem;
        expect(persistedFiles[overwriteJournalPath]).toBeUndefined();
        expect(persistedFiles[backupChunkPath]).toBeDefined();

        const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
        await expect(restartedHandler.readAll()).resolves.toEqual(replacementData);
      } finally {
        deleteSpy.mockRestore();
      }

      expect(backupCleanupFailures).toBe(0);
      expect(global.__expo_file_system_mock__.mockFileSystem[overwriteBackupPath]).toBeUndefined();
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(replacementData);
    });

    it('rejects conflicting canonical and backup chunks while an overwrite backup is preparing', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const conflictingData = [{ id: 2, name: 'conflicting' }];
      const canonicalChunkPath = `${tableDirPath}000000.ldb`;
      const backupChunkPath = `${overwriteBackupPath}000000.ldb`;
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await chunkedFileHandler.write(originalData);

      await writeV2OverwriteJournal(testTableName, 1, 1);
      await moveChunkToOverwriteBackup(0);
      await handler.writeChunk(0, conflictingData);

      const canonicalBeforeRecovery = readMockFileText(canonicalChunkPath);
      const backupBeforeRecovery = readMockFileText(backupChunkPath);
      expect(canonicalBeforeRecovery).not.toBe(backupBeforeRecovery);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });

      const persistedFiles = global.__expo_file_system_mock__.mockFileSystem;
      expect(persistedFiles[overwriteJournalPath]).toBeDefined();
      expect(readMockFileText(canonicalChunkPath)).toBe(canonicalBeforeRecovery);
      expect(readMockFileText(backupChunkPath)).toBe(backupBeforeRecovery);
    });

    it('clears pending overwrite artifacts without allowing old data to reappear', async () => {
      const originalData = [{ id: 1, name: 'must-stay-cleared' }];
      await chunkedFileHandler.write(originalData);

      const journal = await writeV2OverwriteJournal(testTableName, 1, 1);
      await moveChunkToOverwriteBackup(0);
      await markOverwriteBackupReady(journal);
      await resetCanonicalDirectory();

      await chunkedFileHandler.clear();

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([]);
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[overwriteJournalPath]).toBeUndefined();
      expect(fileSystem[overwriteBackupPath]).toBeUndefined();
    });

    it('retains overwrite recovery state when clear fails before it commits', async () => {
      const originalData = [{ id: 1, name: 'recover-after-clear-failure' }];
      const backupChunkPath = `${overwriteBackupPath}000000.ldb`;
      await chunkedFileHandler.write(originalData);

      const journal = await writeV2OverwriteJournal(testTableName, 1, 1);
      await moveChunkToOverwriteBackup(0);
      await markOverwriteBackupReady(journal);
      await resetCanonicalDirectory();

      const fileSystem = getFileSystem();
      const originalDelete = fileSystem.deleteAsync.bind(fileSystem);
      let clearFailureInjected = false;
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri === tableDirPath && !clearFailureInjected) {
          clearFailureInjected = true;
          throw new Error('injected clear failure before commit');
        }
        await originalDelete(uri, options);
      });

      try {
        await expect(chunkedFileHandler.clear()).rejects.toThrow();
      } finally {
        deleteSpy.mockRestore();
      }

      const persistedFiles = global.__expo_file_system_mock__.mockFileSystem;
      expect(clearFailureInjected).toBe(true);
      expect(persistedFiles[overwriteJournalPath]).toBeDefined();
      expect(persistedFiles[backupChunkPath]).toBeDefined();

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);
    });

    it('invalidates cached chunks after an overwrite', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);
      await chunkedFileHandler.readAll();

      await chunkedFileHandler.write([{ id: 2, name: 'replacement' }]);

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([{ id: 2, name: 'replacement' }]);
    });

    it('invalidates cached chunks held by another handler instance after an overwrite', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      const cachedReader = new ChunkedFileHandler(testTableName, metadataManager);
      await chunkedFileHandler.write(originalData);
      await expect(cachedReader.readAll()).resolves.toEqual(originalData);

      await chunkedFileHandler.write(replacementData);

      await expect(cachedReader.readAll()).resolves.toEqual(replacementData);
    });

    it('rejects a corrupted overwrite journal instead of guessing recovery state', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const journalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[journalPath] = '{corrupted';

      await expect(chunkedFileHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rejects an append journal that targets an already committed chunk', async () => {
      const originalData = [{ id: 1, name: 'preserved' }];
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await chunkedFileHandler.write(originalData);
      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const originalChunk = readMockFileText(chunkPath);

      await handler.writeAppendJournal(1, 1, [0], 1);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(global.__expo_file_system_mock__.mockFileSystem[chunkPath]).toBe(originalChunk);
    });

    it('rolls back partial append chunks when a later chunk write fails', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      const originalData = [{ id: 1, name: 'original' }];
      const appendData = [
        { id: 2, payload: 'x'.repeat(300) },
        { id: 3, payload: 'y'.repeat(300) },
      ];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      const originalWriteChunk = handler.writeChunk.bind(handler);
      let appendWriteAttempts = 0;
      const writeSpy = jest
        .spyOn(handler, 'writeChunk')
        .mockImplementation(async (...args: Parameters<typeof handler.writeChunk>) => {
          appendWriteAttempts++;
          if (appendWriteAttempts === 2) {
            throw new Error('injected append chunk failure');
          }
          return originalWriteChunk(...args);
        });

      try {
        await expect(chunkedFileHandler.append(appendData)).rejects.toThrow();
      } finally {
        writeSpy.mockRestore();
      }

      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000002.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });

    it('rolls back completed append chunks when metadata was not committed before restart', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const appendData = [{ id: 2, name: 'interrupted' }];
      await chunkedFileHandler.write(originalData);

      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await handler.writeAppendJournal(1, 1, [1], appendData.length);
      await handler.writeChunk(1, appendData);

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).resolves.toEqual(originalData);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });

    it('removes every journal target when a post-publish chunk check fails', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const appendData = [{ id: 2, name: 'orphan-candidate' }];
      const orphanChunkPath = '/mock/documents/lite-data-store/test_chunked_table/000001.ldb';
      await chunkedFileHandler.write(originalData);

      const fileSystem = getFileSystem();
      const originalGetInfo = fileSystem.getInfoAsync.bind(fileSystem);
      let failureInjected = false;
      const getInfoSpy = jest.spyOn(fileSystem, 'getInfoAsync').mockImplementation(async (uri, options) => {
        if (uri === orphanChunkPath && !failureInjected) {
          failureInjected = true;
          throw new Error('injected post-publish chunk check failure');
        }
        return originalGetInfo(uri, options);
      });

      try {
        await expect(chunkedFileHandler.append(appendData)).rejects.toThrow();
      } finally {
        getInfoSpy.mockRestore();
      }

      expect(failureInjected).toBe(true);
      expect(global.__expo_file_system_mock__.mockFileSystem[orphanChunkPath]).toBeUndefined();
      expect(metadataManager.get(testTableName)).toMatchObject({ count: 1, chunks: 1 });
      await expect(chunkedFileHandler.readAll()).resolves.toEqual(originalData);
    });

    it('rejects an uncommitted overwrite and resolves its journal before a later append', async () => {
      const originalData = [{ id: 1, name: 'original' }];
      const replacementData = [{ id: 2, name: 'replacement' }];
      const appendedData = [{ id: 3, name: 'after-failed-overwrite' }];
      const overwriteJournalPath = '/mock/documents/lite-data-store/test_chunked_table.overwrite-journal';
      await chunkedFileHandler.write(originalData);

      const fileSystem = getFileSystem();
      const originalDelete = fileSystem.deleteAsync.bind(fileSystem);
      let remainingDeleteFailures = 2;
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri === overwriteJournalPath && remainingDeleteFailures > 0) {
          remainingDeleteFailures--;
          throw new Error('injected overwrite journal delete failure');
        }
        await originalDelete(uri, options);
      });

      try {
        await expect(chunkedFileHandler.write(replacementData)).rejects.toThrow();
        await expect(chunkedFileHandler.append(appendedData)).resolves.toBeUndefined();
      } finally {
        deleteSpy.mockRestore();
      }

      expect(remainingDeleteFailures).toBe(0);
      await expect(chunkedFileHandler.readAll()).resolves.toEqual([...originalData, ...appendedData]);
      expect(global.__expo_file_system_mock__.mockFileSystem[overwriteJournalPath]).toBeUndefined();
    });

    it('rejects a chunk set with a missing middle chunk', async () => {
      configManager.updateConfig({ chunkSize: 256 });
      await chunkedFileHandler.write([
        { id: 1, payload: 'x'.repeat(300) },
        { id: 2, payload: 'y'.repeat(300) },
        { id: 3, payload: 'z'.repeat(300) },
      ]);

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      delete fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb'];

      const restartedHandler = new ChunkedFileHandler(testTableName, metadataManager);
      await expect(restartedHandler.readAll()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rejects append when metadata underreports the physical chunk set', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'preserved' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const originalChunk = readMockFileText(chunkPath);
      metadataManager.update(testTableName, { count: 0, chunks: 0 });
      await metadataManager.saveImmediately();

      await expect(chunkedFileHandler.append([{ id: 2, name: 'must-not-overwrite' }])).rejects.toThrow();

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[chunkPath]).toBe(originalChunk);
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });

    it('rejects append when metadata overreports the physical chunk set', async () => {
      await chunkedFileHandler.write([{ id: 1, name: 'preserved' }]);

      const chunkPath = '/mock/documents/lite-data-store/test_chunked_table/000000.ldb';
      const originalChunk = readMockFileText(chunkPath);
      metadataManager.update(testTableName, { count: 2, chunks: 2 });
      await metadataManager.saveImmediately();

      await expect(chunkedFileHandler.append([{ id: 2, name: 'must-not-create' }])).rejects.toThrow();

      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      expect(fileSystem[chunkPath]).toBe(originalChunk);
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table/000001.ldb']).toBeUndefined();
      expect(fileSystem['/mock/documents/lite-data-store/test_chunked_table.append-journal']).toBeUndefined();
    });
  });

  describe('chunk processing', () => {
    it('chunks very large record arrays without spreading per-record size arguments', async () => {
      const records = Array.from({ length: 150_000 }, (_, id) => ({ id }));
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);

      const chunks = await handler.preprocessData(records, 1024 * 1024);

      expect(chunks.reduce((count, chunk) => count + chunk.length, 0)).toBe(records.length);
    });

    it('preserves record order across writes and appends', async () => {
      const batch1 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `batch1-${i}` }));
      const batch2 = Array.from({ length: 300 }, (_, i) => ({ id: 300 + i, name: `batch2-${i}` }));
      const batch3 = Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: `batch3-${i}` }));

      await chunkedFileHandler.write(batch1);
      await chunkedFileHandler.append(batch2);
      await chunkedFileHandler.append(batch3);

      const result = await chunkedFileHandler.readAll();

      expect(result.length).toBe(batch1.length + batch2.length + batch3.length);
      expect(result[0]).toEqual(batch1[0]);
      expect(result[300]).toEqual(batch2[0]);
      expect(result[600]).toEqual(batch3[0]);
    });

    it('does not include stored record content in chunk debug output', async () => {
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
      const payload = 'x'.repeat(6000);
      let debugOutput = '';

      try {
        await chunkedFileHandler.write([{ id: 'large-debug', payload }]);
        await chunkedFileHandler.readAll();

        debugOutput = debugSpy.mock.calls.flatMap(args => args.map(String)).join('\n');
      } finally {
        debugSpy.mockRestore();
      }

      expect(debugOutput).not.toContain('contentPreview=');
      expect(debugOutput).not.toContain(payload);
    });

    it('persists append metadata before deleting the recovery journal', async () => {
      await chunkedFileHandler.write([{ id: 1 }]);

      const events: string[] = [];
      const originalSave = metadataManager.saveImmediately.bind(metadataManager);
      const saveSpy = jest.spyOn(metadataManager, 'saveImmediately').mockImplementation(async () => {
        events.push('metadata');
        await originalSave();
      });
      const fileSystem = getFileSystem();
      const originalDelete = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (uri, options) => {
        if (uri.endsWith('.append-journal')) {
          events.push('journal');
        }
        await originalDelete(uri, options);
      });

      try {
        await chunkedFileHandler.append([{ id: 2 }]);
      } finally {
        saveSpy.mockRestore();
        deleteSpy.mockRestore();
      }

      expect(events).toContain('metadata');
      expect(events).toContain('journal');
      expect(events.indexOf('metadata')).toBeLessThan(events.indexOf('journal'));
    });

    it('keeps append journals bounded without hashing the entire append batch', async () => {
      const appendData = [
        { id: 2, payload: 'x'.repeat(300) },
        { id: 3, payload: 'y'.repeat(300) },
      ];
      const handler = getChunkedFileHandlerPrivateAccess(chunkedFileHandler);
      await chunkedFileHandler.write([{ id: 1, name: 'original' }]);

      const originalComputeHash = handler.computeHash.bind(handler);
      let wholeBatchHashCount = 0;
      const hashSpy = jest.spyOn(handler, 'computeHash').mockImplementation(async value => {
        if (value === appendData) {
          wholeBatchHashCount++;
        }
        return originalComputeHash(value);
      });
      const fileSystem = getFileSystem();
      const originalWrite = fileSystem.writeAsStringAsync.bind(fileSystem);
      let appendJournalText: string | undefined;
      const writeSpy = jest
        .spyOn(fileSystem, 'writeAsStringAsync')
        .mockImplementation(async (uri, contents, options) => {
          if (uri === `${appendJournalPath}.tmp`) {
            appendJournalText = contents;
          }
          await originalWrite(uri, contents, options);
        });

      try {
        await chunkedFileHandler.append(appendData);
      } finally {
        hashSpy.mockRestore();
        writeSpy.mockRestore();
      }

      expect(wholeBatchHashCount).toBe(0);
      const parsed: unknown = JSON.parse(appendJournalText ?? 'null') as unknown;
      if (!isStorageRecord(parsed) || !isStorageRecord(parsed.journal)) {
        throw new Error('Expected an append journal envelope');
      }
      expect(parsed.journal.targetCount).toBe(appendData.length);
      expect(parsed.journal).not.toHaveProperty('targetHash');
    });

    it('preserves chunk order when a later chunk is preloaded', async () => {
      await chunkedFileHandler.write([{ id: 1 }]);
      await chunkedFileHandler.append([{ id: 2 }]);
      await chunkedFileHandler.append([{ id: 3 }]);

      await chunkedFileHandler.preloadChunks([1]);

      await expect(chunkedFileHandler.readAll()).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
  });
});
