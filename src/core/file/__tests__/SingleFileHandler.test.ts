/// <reference path="../../../__tests__/test-globals.d.ts" />

import { SingleFileHandler } from '../SingleFileHandler';
import logger from '../../../utils/logger';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { hashHexSync } from '../../../utils/cryptoPrimitives';
import { type StorageRecord } from '../../../types/storageTypes';

const releasePendingWriteForRestart = (handler: SingleFileHandler): void => {
  (handler as unknown as { finishPendingWrite(): void }).finishPendingWrite();
};

const updateCommitMarker = (markerPath: string, updates: Record<string, unknown>): void => {
  const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
  const serializedMarker = fileSystemState[markerPath];
  if (typeof serializedMarker !== 'string') {
    throw new Error('Expected a serialized commit marker');
  }
  const parsed: unknown = JSON.parse(serializedMarker) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('marker' in parsed) ||
    typeof parsed.marker !== 'object' ||
    parsed.marker === null
  ) {
    throw new Error('Expected a commit marker envelope');
  }
  const marker = { ...parsed.marker, ...updates };
  fileSystemState[markerPath] = JSON.stringify({
    marker,
    hash: hashHexSync(JSON.stringify(marker), 'SHA-256'),
  });
};

const failCommittedMarkerPublish = async (
  writer: SingleFileHandler,
  data: StorageRecord[],
  targetStorageCommitToken: string,
  markMetadataCommitted: () => void
): Promise<void> => {
  const fileSystem = getFileSystem();
  const moveAsync = fileSystem.moveAsync.bind(fileSystem);
  let markerPublishCount = 0;
  const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
    if (options.from.endsWith('.commit-marker.tmp') && options.to.endsWith('.commit-marker')) {
      markerPublishCount++;
      if (markerPublishCount === 2) {
        throw new Error('committed marker publish interrupted');
      }
    }
    await moveAsync(options);
  });

  try {
    await writer.writeRecoverably(data, targetStorageCommitToken);
    markMetadataCommitted();
    await writer.commitPendingWrite();
    expect(markerPublishCount).toBe(2);
  } finally {
    moveSpy.mockRestore();
  }
};

describe('SingleFileHandler', () => {
  let handler: SingleFileHandler;
  const testFilePath = '/mock/documents/test_table.ldb';

  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    handler = new SingleFileHandler(testFilePath);
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
  });

  afterEach(async () => {
    try {
      await handler.delete();
    } catch {
      // Best-effort cleanup prevents a prior failure from masking the test result.
    } finally {
      jest.restoreAllMocks();
    }
  });

  describe('write and read', () => {
    it('writes and reads data', async () => {
      const testData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('writes and reads an empty record set', async () => {
      await handler.write([]);
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('overwrites existing data', async () => {
      await handler.write([{ id: 1 }]);
      await handler.write([{ id: 2 }]);
      const result = await handler.read();
      expect(result).toEqual([{ id: 2 }]);
    });

    it('invalidates cached file existence across handler instances', async () => {
      const reader = new SingleFileHandler(testFilePath);
      const writer = new SingleFileHandler(testFilePath);

      await expect(reader.read()).resolves.toEqual([]);
      await writer.write([{ id: 1, value: 'visible' }]);

      await expect(reader.read()).resolves.toEqual([{ id: 1, value: 'visible' }]);
    });

    it('replaces an existing backup without relying on move overwrite behavior', async () => {
      await handler.write([{ id: 1 }]);
      const fileSystem = getFileSystem();
      global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`] = 'stale-backup';
      const moveAsync = fileSystem.moveAsync.bind(fileSystem);
      const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
        if (options.to in global.__expo_file_system_mock__.mockFileSystem) {
          throw new Error(`Destination already exists: ${options.to}`);
        }
        await moveAsync(options);
      });

      try {
        await expect(handler.write([{ id: 2 }])).resolves.toBeUndefined();
        await expect(handler.read()).resolves.toEqual([{ id: 2 }]);
      } finally {
        moveSpy.mockRestore();
      }
    });

    it('rolls back a recoverable write when metadata publication fails', async () => {
      await handler.write([{ id: 1, value: 'committed' }]);

      await handler.writeRecoverably([{ id: 2, value: 'uncommitted' }]);
      await handler.rollbackPendingWrite();

      await expect(handler.read()).resolves.toEqual([{ id: 1, value: 'committed' }]);
    });

    it('restores the previous generation after restart before metadata commit', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'committed' }]);
      const writer = createHandler();

      await writer.writeRecoverably([{ id: 2, value: 'uncommitted' }], 'target-token');
      updateCommitMarker(`${testFilePath}.commit-marker`, { version: 1, tableName: undefined });
      releasePendingWriteForRestart(writer);

      await expect(createHandler().read()).resolves.toEqual([{ id: 1, value: 'committed' }]);
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.commit-marker`]).toBeUndefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeUndefined();
    });

    it('restores a metadata-only empty generation after restart before metadata commit', async () => {
      const metadata = { storageCommitToken: 'previous-token', count: 0 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      const writer = createHandler();

      await writer.writeRecoverably([{ id: 1, value: 'uncommitted' }], 'target-token');
      releasePendingWriteForRestart(writer);

      await expect(createHandler().read()).resolves.toEqual([]);
      expect(global.__expo_file_system_mock__.mockFileSystem[testFilePath]).toBeUndefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.commit-marker`]).toBeUndefined();
    });

    it('retries rollback cleanup after the previous primary was restored', async () => {
      const metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'committed' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2, value: 'uncommitted' }], 'target-token');
      releasePendingWriteForRestart(writer);

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const fileSystem = getFileSystem();
      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === `${testFilePath}.commit-marker`) {
          throw new Error('rollback marker cleanup denied');
        }
        await deleteAsync(path, options);
      });

      try {
        await expect(createHandler().read()).resolves.toEqual([{ id: 1, value: 'committed' }]);
        expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeDefined();
        expect(fileSystemState[`${testFilePath}.bak`]).toBeDefined();
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(createHandler().read()).resolves.toEqual([{ id: 1, value: 'committed' }]);
      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeUndefined();
      expect(fileSystemState[`${testFilePath}.bak`]).toBeUndefined();
    });

    it('keeps the published generation after restart when metadata committed first', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();

      await writer.writeRecoverably([{ id: 2, value: 'committed' }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 1 };
      releasePendingWriteForRestart(writer);

      await expect(createHandler().read()).resolves.toEqual([{ id: 2, value: 'committed' }]);
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.commit-marker`]).toBeUndefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeUndefined();
    });

    const createCommittedTempMarkerFixture = async (): Promise<() => SingleFileHandler> => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();

      await failCommittedMarkerPublish(writer, [{ id: 2, value: 'committed' }], 'target-token', () => {
        metadata = { storageCommitToken: 'target-token', count: 1 };
      });

      return createHandler;
    };

    it('recovers a committed generation from a validated temporary marker', async () => {
      const createHandler = await createCommittedTempMarkerFixture();
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;

      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeUndefined();
      expect(fileSystemState[`${testFilePath}.commit-marker.tmp`]).toBeDefined();
      expect(fileSystemState[`${testFilePath}.bak`]).toBeDefined();

      await expect(createHandler().read()).resolves.toEqual([{ id: 2, value: 'committed' }]);
      expect(fileSystemState[`${testFilePath}.commit-marker.tmp`]).toBeUndefined();
      expect(fileSystemState[`${testFilePath}.bak`]).toBeUndefined();
    });

    it('rejects a temporary committed marker when the target primary is missing', async () => {
      const createHandler = await createCommittedTempMarkerFixture();
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const markerTemp = fileSystemState[`${testFilePath}.commit-marker.tmp`];
      const backup = fileSystemState[`${testFilePath}.bak`];
      delete fileSystemState[testFilePath];

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[testFilePath]).toBeUndefined();
      expect(fileSystemState[`${testFilePath}.commit-marker.tmp`]).toBe(markerTemp);
      expect(fileSystemState[`${testFilePath}.bak`]).toBe(backup);
    });

    it('rejects a temporary committed marker when the target primary is corrupted', async () => {
      const createHandler = await createCommittedTempMarkerFixture();
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const markerTemp = fileSystemState[`${testFilePath}.commit-marker.tmp`];
      const backup = fileSystemState[`${testFilePath}.bak`];
      fileSystemState[testFilePath] = 'corrupted-primary';

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[testFilePath]).toBe('corrupted-primary');
      expect(fileSystemState[`${testFilePath}.commit-marker.tmp`]).toBe(markerTemp);
      expect(fileSystemState[`${testFilePath}.bak`]).toBe(backup);
    });

    it.each<[string, Record<string, unknown>]>([
      ['legacy v1 format', { version: 1, tableName: undefined }],
      ['a different table name', { tableName: 'other_table' }],
      ['a different target token', { targetStorageCommitToken: 'other-target-token' }],
    ])('rejects a temporary committed marker with %s', async (_caseName, markerUpdates) => {
      const createHandler = await createCommittedTempMarkerFixture();
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const markerTempPath = `${testFilePath}.commit-marker.tmp`;
      updateCommitMarker(markerTempPath, markerUpdates);
      const primary = fileSystemState[testFilePath];
      const markerTemp = fileSystemState[markerTempPath];
      const backup = fileSystemState[`${testFilePath}.bak`];

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[testFilePath]).toBe(primary);
      expect(fileSystemState[markerTempPath]).toBe(markerTemp);
      expect(fileSystemState[`${testFilePath}.bak`]).toBe(backup);
    });

    it('retries committed marker cleanup without rolling back the published generation', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2, value: 'committed' }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 1 };

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const fileSystem = getFileSystem();
      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      let markerDeleteCount = 0;
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === `${testFilePath}.commit-marker`) {
          markerDeleteCount++;
          if (markerDeleteCount === 2) {
            throw new Error('marker cleanup denied');
          }
        }
        await deleteAsync(path, options);
      });

      try {
        await expect(writer.commitPendingWrite()).resolves.toBeUndefined();
        expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeDefined();
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(createHandler().read()).resolves.toEqual([{ id: 2, value: 'committed' }]);
      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeUndefined();
    });

    it('retains the committed marker when old-generation backup cleanup fails', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2, value: 'committed' }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 1 };

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const fileSystem = getFileSystem();
      const deleteAsync = fileSystem.deleteAsync.bind(fileSystem);
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockImplementation(async (path, options) => {
        if (path === `${testFilePath}.bak`) {
          throw new Error('backup cleanup denied');
        }
        await deleteAsync(path, options);
      });

      try {
        await expect(writer.commitPendingWrite()).resolves.toBeUndefined();
        expect(fileSystemState[`${testFilePath}.bak`]).toBeDefined();
        expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeDefined();
      } finally {
        deleteSpy.mockRestore();
      }

      delete fileSystemState[testFilePath];

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[`${testFilePath}.bak`]).toBeDefined();
      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeDefined();
    });

    it('fails closed and preserves recovery artifacts for an unknown metadata token', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2, value: 'candidate' }], 'target-token');
      metadata = { storageCommitToken: 'unknown-token', count: 1 };
      releasePendingWriteForRestart(writer);

      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      const primary = fileSystemState[testFilePath];
      const backup = fileSystemState[`${testFilePath}.bak`];
      const marker = fileSystemState[`${testFilePath}.commit-marker`];

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[testFilePath]).toBe(primary);
      expect(fileSystemState[`${testFilePath}.bak`]).toBe(backup);
      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBe(marker);
    });

    it('fails closed when the marker physical count does not match the primary generation', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2 }, { id: 3 }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 2 };
      releasePendingWriteForRestart(writer);
      updateCommitMarker(`${testFilePath}.commit-marker`, { targetPhysicalCount: 1 });

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.commit-marker`]).toBeDefined();
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeDefined();
    });

    it('fails closed when the marker target hash does not match the primary generation', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 1 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ id: 1, value: 'previous' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ id: 2, value: 'candidate' }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 1 };
      releasePendingWriteForRestart(writer);

      const markerPath = `${testFilePath}.commit-marker`;
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      updateCommitMarker(markerPath, { targetHash: '0'.repeat(64) });

      await expect(createHandler().read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
      expect(fileSystemState[markerPath]).toBeDefined();
      expect(fileSystemState[`${testFilePath}.bak`]).toBeDefined();
    });

    it('uses metadata only for generation identity, not physical record count', async () => {
      let metadata = { storageCommitToken: 'previous-token', count: 10 };
      const createHandler = (): SingleFileHandler => new SingleFileHandler(testFilePath, () => metadata);
      await new SingleFileHandler(testFilePath).write([{ __enc: 'previous-envelope' }]);
      const writer = createHandler();
      await writer.writeRecoverably([{ __enc: 'target-envelope' }], 'target-token');
      metadata = { storageCommitToken: 'target-token', count: 20 };
      releasePendingWriteForRestart(writer);

      await expect(createHandler().read()).resolves.toEqual([{ __enc: 'target-envelope' }]);
    });

    it('holds other instances behind a recoverable write until rollback completes', async () => {
      const writer = new SingleFileHandler(testFilePath);
      const reader = new SingleFileHandler(testFilePath);
      const remover = new SingleFileHandler(testFilePath);
      await writer.write([{ id: 1, value: 'committed' }]);
      await writer.writeRecoverably([{ id: 2, value: 'uncommitted' }]);
      await expect(writer.read()).resolves.toEqual([{ id: 2, value: 'uncommitted' }]);
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeDefined();

      let readSettled = false;
      let deleteSettled = false;
      const readPromise = reader.read().then(records => {
        readSettled = true;
        return records;
      });
      const deletePromise = remover.delete().then(() => {
        deleteSettled = true;
      });

      await Promise.resolve();
      expect(readSettled).toBe(false);
      expect(deleteSettled).toBe(false);
      expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeDefined();

      await writer.rollbackPendingWrite();
      await expect(readPromise).resolves.toEqual([{ id: 1, value: 'committed' }]);
      await expect(deletePromise).resolves.toBeUndefined();
    });

    it('rejects an overlapping recoverable write on the same handler', async () => {
      const fileSystem = getFileSystem();
      const writeAsStringAsync = fileSystem.writeAsStringAsync.bind(fileSystem);
      let releaseFirstWrite!: () => void;
      let signalFirstWriteStarted!: () => void;
      const firstWriteStarted = new Promise<void>(resolve => {
        signalFirstWriteStarted = resolve;
      });
      const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync').mockImplementation(async (path, data, options) => {
        if (path === `${testFilePath}.tmp`) {
          signalFirstWriteStarted();
          await new Promise<void>(resolve => {
            releaseFirstWrite = resolve;
          });
        }
        await writeAsStringAsync(path, data, options);
      });

      try {
        const firstWrite = handler.writeRecoverably([{ id: 1 }]);
        await firstWriteStarted;

        await expect(handler.writeRecoverably([{ id: 2 }])).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });

        releaseFirstWrite();
        await firstWrite;
        await handler.commitPendingWrite();
        await expect(handler.read()).resolves.toEqual([{ id: 1 }]);
      } finally {
        releaseFirstWrite?.();
        writeSpy.mockRestore();
      }
    });

    it('bounds cross-instance lock waits without bypassing the active writer', async () => {
      const writer = new SingleFileHandler(testFilePath);
      const waitingReader = new SingleFileHandler(testFilePath);
      await writer.write([{ id: 1, value: 'committed' }]);
      await writer.writeRecoverably([{ id: 2, value: 'pending' }]);

      jest.useFakeTimers();
      try {
        const blockedRead = waitingReader.read();
        await Promise.resolve();
        jest.advanceTimersByTime(30000);
        await expect(blockedRead).rejects.toMatchObject({ code: 'TIMEOUT' });
      } finally {
        jest.useRealTimers();
      }

      await writer.rollbackPendingWrite();
      await expect(new SingleFileHandler(testFilePath).read()).resolves.toEqual([{ id: 1, value: 'committed' }]);
    });

    it('restores the previous generation after a delayed publish crosses its deadline', async () => {
      const committed = [{ id: 1, value: 'committed' }];
      await handler.write(committed);

      const fileSystem = getFileSystem();
      const moveAsync = fileSystem.moveAsync.bind(fileSystem);
      let releasePublish!: () => void;
      let reportPublishStarted!: () => void;
      const publishStarted = new Promise<void>(resolve => {
        reportPublishStarted = resolve;
      });
      let delayedPublish = false;
      const moveSpy = jest.spyOn(fileSystem, 'moveAsync').mockImplementation(async options => {
        if (!delayedPublish && options.from === `${testFilePath}.tmp` && options.to === testFilePath) {
          delayedPublish = true;
          reportPublishStarted();
          await new Promise<void>(resolve => {
            releasePublish = resolve;
          });
        }
        await moveAsync(options);
      });

      jest.useFakeTimers();
      try {
        const pendingWrite = handler.writeRecoverably([{ id: 2, value: 'late' }]);
        let writeSettled = false;
        void pendingWrite.then(
          () => {
            writeSettled = true;
          },
          () => {
            writeSettled = true;
          }
        );

        await publishStarted;
        jest.advanceTimersByTime(10000);
        await Promise.resolve();
        expect(writeSettled).toBe(false);

        releasePublish();
        await expect(pendingWrite).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });
        jest.useRealTimers();

        await expect(new SingleFileHandler(testFilePath).read()).resolves.toEqual(committed);
        expect(global.__expo_file_system_mock__.mockFileSystem[`${testFilePath}.bak`]).toBeUndefined();
        await expect(new SingleFileHandler(testFilePath).write([{ id: 3, value: 'next' }])).resolves.toBeUndefined();
      } finally {
        jest.useRealTimers();
        moveSpy.mockRestore();
      }
    });

    it('writes and reads a large record set', async () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
      await handler.write(largeData);
      const result = await handler.read();
      expect(result).toHaveLength(100);
      expect(result[0]).toEqual({ id: 0, value: 'item-0' });
    });
  });

  describe('read edge cases', () => {
    it('returns an empty array for a nonexistent file', async () => {
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('fails closed when non-empty metadata has no recoverable data generation', async () => {
      const missingHandler = new SingleFileHandler(testFilePath, () => ({
        storageCommitToken: 'committed-token',
        count: 1,
      }));

      await expect(missingHandler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rejects corrupted data instead of treating it as an empty table', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem[testFilePath] = 'not-valid-json';
      }
      await expect(handler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('rejects data with a missing integrity hash', async () => {
      if (global.__expo_file_system_mock__) {
        global.__expo_file_system_mock__.mockFileSystem[testFilePath] = JSON.stringify({ data: [{ id: 1 }] });
      }
      await expect(handler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });

    it('restores a valid backup when the primary file is missing', async () => {
      await handler.write([{ id: 1, value: 'recoverable' }]);
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[`${testFilePath}.bak`] = fileSystem[testFilePath];
      delete fileSystem[testFilePath];

      await expect(new SingleFileHandler(testFilePath).read()).resolves.toEqual([{ id: 1, value: 'recoverable' }]);
      expect(fileSystem[testFilePath]).toBeDefined();
      expect(fileSystem[`${testFilePath}.bak`]).toBeUndefined();
    });

    it('restores a valid backup when the primary file is corrupted', async () => {
      await handler.write([{ id: 1, value: 'recoverable' }]);
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[`${testFilePath}.bak`] = fileSystem[testFilePath];
      fileSystem[testFilePath] = 'corrupted-primary';

      await expect(new SingleFileHandler(testFilePath).read()).resolves.toEqual([{ id: 1, value: 'recoverable' }]);
    });

    it('fails closed when both the primary file and backup are corrupted', async () => {
      const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
      fileSystem[testFilePath] = 'corrupted-primary';
      fileSystem[`${testFilePath}.bak`] = 'corrupted-backup';

      await expect(handler.read()).rejects.toMatchObject({ code: 'CORRUPTED_DATA' });
    });
  });

  describe('delete', () => {
    it('deletes a file', async () => {
      await handler.write([{ id: 1 }]);
      await handler.delete();
      const result = await handler.read();
      expect(result).toEqual([]);
    });

    it('does not throw when the file does not exist', async () => {
      await expect(handler.delete()).resolves.not.toThrow();
    });

    it('deletes commit marker artifacts', async () => {
      const fileSystemState = global.__expo_file_system_mock__.mockFileSystem;
      fileSystemState[`${testFilePath}.commit-marker`] = 'marker';
      fileSystemState[`${testFilePath}.commit-marker.tmp`] = 'marker-temp';

      await handler.delete();

      expect(fileSystemState[`${testFilePath}.commit-marker`]).toBeUndefined();
      expect(fileSystemState[`${testFilePath}.commit-marker.tmp`]).toBeUndefined();
    });

    it('reports filesystem deletion failures', async () => {
      const fileSystem = getFileSystem();
      const deleteSpy = jest.spyOn(fileSystem, 'deleteAsync').mockRejectedValueOnce(new Error('delete denied'));

      try {
        await expect(handler.delete()).rejects.toMatchObject({ code: 'FILE_DELETE_FAILED' });
      } finally {
        deleteSpy.mockRestore();
      }
    });
  });

  describe('data integrity', () => {
    it('verifies the data hash on read', async () => {
      const testData = [{ id: 1, name: 'Alice' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('preserves special characters in data', async () => {
      const testData = [{ id: 1, name: 'Alice & Bob', desc: '<script>alert("xss")</script>' }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result).toEqual(testData);
    });

    it('writes records containing null and undefined values', async () => {
      const testData = [{ id: 1, a: null, b: undefined, c: 0 }];
      await handler.write(testData);
      const result = await handler.read();
      expect(result[0].a).toBeNull();
      expect(result[0].c).toBe(0);
    });
  });
});
