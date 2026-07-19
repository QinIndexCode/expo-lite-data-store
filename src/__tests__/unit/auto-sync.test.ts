import { FileSystemStorageAdapter } from '../../core/adapter/FileSystemStorageAdapter';
import { CacheManager } from '../../core/cache/CacheManager';
import {
  AUTO_SYNC_EVENTS,
  AutoSyncService,
  type AutoSyncEvent,
  type AutoSyncEventData,
} from '../../core/service/AutoSyncService';
import logger from '../../utils/logger';

type AdapterTestAccess = {
  autoSyncService: AutoSyncService;
  cacheManager: CacheManager;
};

type AutoSyncPrivateAccess = {
  emit: (event: AutoSyncEvent, data: Omit<AutoSyncEventData, 'event'>) => void;
};

type AutoSyncRecord = {
  id: number;
  name: string;
  value: string;
};

const getAdapterTestAccess = (adapter: FileSystemStorageAdapter): AdapterTestAccess =>
  adapter as unknown as AdapterTestAccess;
const getAutoSyncPrivateAccess = (service: AutoSyncService): AutoSyncPrivateAccess =>
  service as unknown as AutoSyncPrivateAccess;

describe('AutoSyncService', () => {
  let storageAdapter: FileSystemStorageAdapter;
  let autoSyncService: AutoSyncService;

  beforeEach(() => {
    storageAdapter = new FileSystemStorageAdapter();
    autoSyncService = getAdapterTestAccess(storageAdapter).autoSyncService;
  });

  afterEach(async () => {
    if (await storageAdapter.hasTable('test_auto_sync')) {
      await storageAdapter.deleteTable('test_auto_sync');
    }
    await storageAdapter.cleanup();
    await AutoSyncService.cleanupInstance();
  });

  it('keeps auto-sync disabled by default', () => {
    const config = autoSyncService.getConfig();
    expect(config.enabled).toBe(false);
  });

  it('removes a throwing once listener before a subsequent event', () => {
    const listener = jest.fn(() => {
      throw new Error('listener failed');
    });
    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const service = getAutoSyncPrivateAccess(autoSyncService);

    try {
      autoSyncService.once(AUTO_SYNC_EVENTS.SYNC_START, listener);

      service.emit(AUTO_SYNC_EVENTS.SYNC_START, { itemsCount: 1 });
      service.emit(AUTO_SYNC_EVENTS.SYNC_START, { itemsCount: 1 });

      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });

  it('syncs dirty data when the minimum item count is reached', async () => {
    await storageAdapter.createTable('test_auto_sync', { mode: 'single' });

    await storageAdapter.write('test_auto_sync', { id: 1, name: 'Test Item 1', value: 'Initial value' });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;

    await autoSyncService.updateConfig({ minItems: 1 });

    // The fourth argument marks the cache entry dirty.
    cacheManager.set('test_auto_sync_1', { id: 1, name: 'Test Item 1', value: 'Updated value 1' }, undefined, true);

    const dirtyData = cacheManager.getDirtyData();
    expect(dirtyData.size).toBe(1);

    await autoSyncService.sync();

    const syncedData = await storageAdapter.findMany('test_auto_sync');
    expect(syncedData).toHaveLength(1);
    expect(syncedData[0].value).toBe('Updated value 1');

    const dirtyDataAfterSync = cacheManager.getDirtyData();
    expect(dirtyDataAfterSync.size).toBe(0);
  });

  it('defers dirty data while a transaction is active and syncs it afterwards', async () => {
    await storageAdapter.createTable('test_auto_sync', {
      mode: 'single',
      initialData: [{ id: 1, name: 'Test Item 1', value: 'Persisted value' }],
    });
    await autoSyncService.updateConfig({ minItems: 1 });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;
    cacheManager.set('test_auto_sync_1', { id: 1, name: 'Test Item 1', value: 'Deferred value' }, undefined, true);

    await storageAdapter.beginTransaction();
    let transactionActive = true;
    try {
      await autoSyncService.sync();

      expect(cacheManager.getDirtyData().size).toBe(1);
      await storageAdapter.rollback();
      transactionActive = false;

      await expect(storageAdapter.read<AutoSyncRecord>('test_auto_sync', { bypassCache: true })).resolves.toEqual([
        { id: 1, name: 'Test Item 1', value: 'Persisted value' },
      ]);

      await autoSyncService.sync();

      await expect(storageAdapter.read<AutoSyncRecord>('test_auto_sync', { bypassCache: true })).resolves.toEqual([
        { id: 1, name: 'Test Item 1', value: 'Deferred value' },
      ]);
      expect(cacheManager.getDirtyData().size).toBe(0);
    } finally {
      if (transactionActive) {
        await storageAdapter.rollback().catch(() => undefined);
      }
    }
  });

  it('finishes a durable sync before a transaction started during the write can proceed', async () => {
    const persistedRecord = { id: 1, name: 'Test Item 1', value: 'Persisted value' };
    const dirtyRecord = { id: 1, name: 'Test Item 1', value: 'Durable synced value' };
    await storageAdapter.createTable('test_auto_sync', {
      mode: 'single',
      initialData: [persistedRecord],
    });
    await autoSyncService.updateConfig({ minItems: 1 });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;
    cacheManager.set('test_auto_sync_1', dirtyRecord, undefined, true);

    let signalWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>(resolve => {
      signalWriteStarted = resolve;
    });
    let releaseWrite: () => void = () => undefined;
    const writeReleased = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const originalWrite = storageAdapter.write.bind(storageAdapter);
    const writeSpy = jest
      .spyOn(storageAdapter, 'write')
      .mockImplementation(async (...args: Parameters<FileSystemStorageAdapter['write']>) => {
        signalWriteStarted();
        await writeReleased;
        return originalWrite(...args);
      });

    try {
      const syncPromise = autoSyncService.sync();
      await writeStarted;

      const beginPromise = storageAdapter.beginTransaction();
      releaseWrite();
      await syncPromise;
      await beginPromise;
      await storageAdapter.rollback();

      await expect(storageAdapter.read<AutoSyncRecord>('test_auto_sync', { bypassCache: true })).resolves.toEqual([
        dirtyRecord,
      ]);
      expect(cacheManager.getDirtyData().size).toBe(0);
    } finally {
      releaseWrite();
      writeSpy.mockRestore();
      if (storageAdapter.isInTransaction()) {
        await storageAdapter.rollback().catch(() => undefined);
      }
    }
  });

  it('limits each table to batchSize dirty entries and drains the deferred entry below minItems', async () => {
    await storageAdapter.createTable('test_auto_sync', {
      mode: 'single',
      initialData: [
        { id: 1, name: 'first', value: 'persisted-first' },
        { id: 3, name: 'unchanged', value: 'persisted-unchanged' },
      ],
    });
    await autoSyncService.updateConfig({ minItems: 2, batchSize: 1 });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;
    cacheManager.set('test_auto_sync_first', { id: 1, name: 'first', value: 'dirty-first' }, undefined, true);
    cacheManager.set('test_auto_sync_second', { id: 2, name: 'second', value: 'dirty-second' }, undefined, true);

    await autoSyncService.sync();

    await expect(storageAdapter.read<AutoSyncRecord>('test_auto_sync', { bypassCache: true })).resolves.toEqual([
      { id: 1, name: 'first', value: 'dirty-first' },
      { id: 3, name: 'unchanged', value: 'persisted-unchanged' },
    ]);
    expect(Array.from(cacheManager.getDirtyData().keys())).toEqual(['test_auto_sync_second']);

    await autoSyncService.sync();

    await expect(storageAdapter.read<AutoSyncRecord>('test_auto_sync', { bypassCache: true })).resolves.toEqual([
      { id: 1, name: 'first', value: 'dirty-first' },
      { id: 3, name: 'unchanged', value: 'persisted-unchanged' },
      { id: 2, name: 'second', value: 'dirty-second' },
    ]);
    expect(cacheManager.getDirtyData().size).toBe(0);
  });

  it('writes a dirty full-table snapshot without identifiers as a replacement', async () => {
    await storageAdapter.createTable('test_auto_sync', {
      mode: 'single',
      initialData: [
        { name: 'persisted-first', value: 'old-first' },
        { name: 'persisted-second', value: 'old-second' },
      ],
    });
    await autoSyncService.updateConfig({ minItems: 1 });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;
    const snapshot = [
      { name: 'snapshot-first', value: 'new-first' },
      { name: 'snapshot-second', value: 'new-second' },
    ];
    cacheManager.set('test_auto_sync_{}', snapshot, undefined, true);

    await autoSyncService.sync();

    await expect(storageAdapter.read('test_auto_sync', { bypassCache: true })).resolves.toEqual(snapshot);
    expect(cacheManager.getDirtyData().size).toBe(0);
  });

  it('allows an empty dirty full-table snapshot to clear a table', async () => {
    await storageAdapter.createTable('test_auto_sync', {
      mode: 'single',
      initialData: [{ name: 'persisted', value: 'old' }],
    });
    await autoSyncService.updateConfig({ minItems: 1 });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;
    cacheManager.set('test_auto_sync_{}', [], undefined, true);

    await autoSyncService.sync();

    await expect(storageAdapter.read('test_auto_sync', { bypassCache: true })).resolves.toEqual([]);
    expect(cacheManager.getDirtyData().size).toBe(0);
  });

  it('keeps dirty data when the item count is below the sync threshold', async () => {
    await autoSyncService.updateConfig({ minItems: 2 });

    await storageAdapter.createTable('test_auto_sync', { mode: 'single' });

    await storageAdapter.write('test_auto_sync', { id: 1, name: 'Test Item 1', value: 'Initial value' });

    const cacheManager = getAdapterTestAccess(storageAdapter).cacheManager;

    // The fourth argument marks the cache entry dirty.
    cacheManager.set('test_auto_sync_1', { id: 1, name: 'Test Item 1', value: 'Updated value 1' }, undefined, true);

    const dirtyData = cacheManager.getDirtyData();
    expect(dirtyData.size).toBe(1);

    await autoSyncService.sync();

    const dirtyDataAfterSync = cacheManager.getDirtyData();
    expect(dirtyDataAfterSync.size).toBe(1);

    await autoSyncService.updateConfig({ minItems: 1 });
  });

  it('updates its configuration', async () => {
    try {
      await autoSyncService.updateConfig({
        interval: 10000,
        minItems: 5,
        batchSize: 200,
      });

      const config = autoSyncService.getConfig();
      expect(config.interval).toBe(10000);
      expect(config.minItems).toBe(5);
      expect(config.batchSize).toBe(200);
    } finally {
      await autoSyncService.updateConfig({
        interval: 30000,
        minItems: 1,
        batchSize: 100,
      });
    }
  });
});
