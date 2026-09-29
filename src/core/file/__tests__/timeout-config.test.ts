/// <reference path="../../../__tests__/test-globals.d.ts" />

import { configManager } from '../../config/ConfigManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { ChunkedFileHandler } from '../ChunkedFileHandler';
import { FileHandlerBase } from '../FileHandlerBase';
import { SingleFileHandler } from '../SingleFileHandler';
import logger from '../../../utils/logger';
import { getFileSystem } from '../../../utils/fileSystemCompat';
import { StorageError } from '../../../types/storageErrorInfc';

type TimeoutOutcome = { status: 'resolved' } | { status: 'rejected'; error: unknown };

// Let every pending microtask hop of a read chain run so the handler reaches its withTimeout call.
const flushReadChain = async (): Promise<void> => {
  for (let tick = 0; tick < 100; tick++) {
    await Promise.resolve();
  }
};

const trackOutcome = (operation: Promise<unknown>): Promise<TimeoutOutcome> =>
  operation.then(
    () => ({ status: 'resolved' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error })
  );

describe('file handler timeouts honor config.timeout', () => {
  const singleFilePath = '/mock/documents/lite-data-store/timeout_single_table.ldb';
  const chunkedTableName = 'timeout_chunked_table';
  const chunkedTableDirPath = '/mock/documents/lite-data-store/timeout_chunked_table/';

  let metadataManager: MetadataManager;

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
  });

  afterEach(() => {
    configManager.resetConfig();
    metadataManager.cleanup();
    if (global.__expo_file_system_mock__) {
      global.__expo_file_system_mock__.mockFileSystem = {};
    }
    FileHandlerBase.invalidateFileInfoCache();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('times out a slow single-file read with the configured timeout instead of 10000ms', async () => {
    jest.useFakeTimers();
    configManager.setConfig({ timeout: 25 });

    global.__expo_file_system_mock__.mockFileSystem[singleFilePath] = '{"data":[],"hash":"unused"}';
    const fileSystem = getFileSystem();
    jest.spyOn(fileSystem, 'readAsStringAsync').mockImplementation(() => new Promise<string>(() => {}));

    const handler = new SingleFileHandler(singleFilePath);
    const outcome = trackOutcome(handler.read());

    await flushReadChain();
    // Only the configured 25ms timeout can reject here; the old hardcoded 10000ms would not fire yet.
    jest.advanceTimersByTime(25);

    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      return;
    }
    expect(result.error).toBeInstanceOf(StorageError);
    const storageError = result.error as StorageError;
    expect(storageError.code).toBe('TIMEOUT');
    expect(storageError.message).toContain('timeout');
    expect(storageError.message).toContain(singleFilePath);
  });

  it('times out a slow chunked read with the configured timeout instead of 10000ms', async () => {
    jest.useFakeTimers();
    configManager.setConfig({ timeout: 25 });

    const fileSystem = getFileSystem();
    await fileSystem.makeDirectoryAsync(chunkedTableDirPath, { intermediates: true });
    await fileSystem.writeAsStringAsync(`${chunkedTableDirPath}000000.ldb`, 'chunk-payload');
    jest.spyOn(fileSystem, 'readAsStringAsync').mockImplementation(() => new Promise<string>(() => {}));

    const handler = new ChunkedFileHandler(chunkedTableName, metadataManager);
    const outcome = trackOutcome(handler.readAll());

    await flushReadChain();
    jest.advanceTimersByTime(25);

    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      return;
    }
    expect(result.error).toBeInstanceOf(StorageError);
    const storageError = result.error as StorageError;
    expect(storageError.code).toBe('TIMEOUT');
    expect(storageError.message).toContain('timeout');
  });

  it('keeps the 10000ms default when config.timeout is not overridden', async () => {
    jest.useFakeTimers();

    global.__expo_file_system_mock__.mockFileSystem[singleFilePath] = '{"data":[],"hash":"unused"}';
    const fileSystem = getFileSystem();
    jest.spyOn(fileSystem, 'readAsStringAsync').mockImplementation(() => new Promise<string>(() => {}));

    const handler = new SingleFileHandler(singleFilePath);
    const outcome = trackOutcome(handler.read());
    let settled = false;
    outcome.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await flushReadChain();
    // At 9975ms a 5000ms default would already have settled; the real 10000ms default must not have.
    jest.advanceTimersByTime(9975);
    // Drain the promise continuations so a timeout that fired before 9975ms flips `settled`.
    await flushReadChain();
    expect(settled).toBe(false);

    // Advance the remaining 25ms to exactly 10000ms: the default must fire at 10000ms, not earlier.
    jest.advanceTimersByTime(25);
    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      return;
    }
    expect((result.error as StorageError).code).toBe('TIMEOUT');
  });

  it('reads config.timeout at the call site: a handler constructed before setConfig still times out at 25ms', async () => {
    jest.useFakeTimers();

    global.__expo_file_system_mock__.mockFileSystem[singleFilePath] = '{"data":[],"hash":"unused"}';
    const fileSystem = getFileSystem();
    jest.spyOn(fileSystem, 'readAsStringAsync').mockImplementation(() => new Promise<string>(() => {}));

    // Construct first while the config still holds the 10000ms default, then override.
    // A constructor-captured timeout would keep 10000ms and never fire within the 25ms window.
    const handler = new SingleFileHandler(singleFilePath);
    configManager.setConfig({ timeout: 25 });

    const outcome = trackOutcome(handler.read());
    let settled = false;
    outcome.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await flushReadChain();
    jest.advanceTimersByTime(25);
    await flushReadChain();
    // Fail fast (instead of hanging) when the timeout was captured at construction time.
    expect(settled).toBe(true);

    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      return;
    }
    expect(result.error).toBeInstanceOf(StorageError);
    const storageError = result.error as StorageError;
    expect(storageError.code).toBe('TIMEOUT');
    expect(storageError.message).toContain('timeout');
    expect(storageError.message).toContain(singleFilePath);
  });
});
