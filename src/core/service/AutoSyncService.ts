import { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import { isStorageRecord, type StorageRecord } from '../../types/storageTypes';

import { CacheService } from './CacheService';
import { configManager } from '../config/ConfigManager';
import logger from '../../utils/logger';

export const AUTO_SYNC_EVENTS = {
  SYNC_START: 'syncStart',
  SYNC_COMPLETE: 'syncComplete',
  SYNC_FAILED: 'syncFailed',
  SYNC_ERROR: 'syncError',
} as const;

export type AutoSyncEvent = (typeof AUTO_SYNC_EVENTS)[keyof typeof AUTO_SYNC_EVENTS];

export interface AutoSyncStats {
  syncCount: number;
  totalItemsSynced: number;
  lastSyncTime: number;
  avgSyncTime: number;
  failedSyncCount: number;
  successfulItemsSynced: number;
  failedItemsSynced: number;
}

export interface AutoSyncEventData {
  event: AutoSyncEvent;
  itemsCount?: number;
  successfulItems?: number;
  failedItems?: number;
  syncTime?: number;
  error?: Error;
  stats?: AutoSyncStats;
}

export type AutoSyncEventListener = (data: AutoSyncEventData) => void;

type DirtyCacheEntry = {
  cacheKey: string;
  data: unknown;
};

type RecordIdentity = string | number;

const getRecordIdentity = (record: StorageRecord): RecordIdentity | undefined => {
  const candidate = record.id ?? record._id;
  return typeof candidate === 'string' || typeof candidate === 'number' ? candidate : undefined;
};

const getIdentityKey = (identity: RecordIdentity): string => `${typeof identity}:${identity}`;

const getCachedRecords = (value: unknown): StorageRecord[] | undefined => {
  if (isStorageRecord(value)) {
    return [value];
  }
  if (Array.isArray(value) && value.every(isStorageRecord)) {
    return value;
  }
  return undefined;
};

const isFullTableSnapshot = (cacheKey: string, tableName: string, value: unknown): value is StorageRecord[] => {
  return cacheKey === `${tableName}_{}` && Array.isArray(value) && value.every(isStorageRecord);
};

const mergeRecords = (currentRecords: StorageRecord[], dirtyRecords: StorageRecord[]): StorageRecord[] => {
  const mergedRecords = [...currentRecords];
  const recordIndexes = new Map<string, number>();

  for (let index = 0; index < mergedRecords.length; index++) {
    const record = mergedRecords[index];
    if (!record) {
      continue;
    }
    const identity = getRecordIdentity(record);
    if (identity !== undefined) {
      recordIndexes.set(getIdentityKey(identity), index);
    }
  }

  for (const record of dirtyRecords) {
    const identity = getRecordIdentity(record);
    if (identity === undefined) {
      mergedRecords.push(record);
      continue;
    }

    const identityKey = getIdentityKey(identity);
    const existingIndex = recordIndexes.get(identityKey);
    if (existingIndex === undefined) {
      recordIndexes.set(identityKey, mergedRecords.length);
      mergedRecords.push(record);
    } else {
      mergedRecords[existingIndex] = record;
    }
  }

  return mergedRecords;
};

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

interface AutoSyncConfig {
  enabled: boolean;
  interval: number;
  minItems: number;
  batchSize: number;
}

/** Persists dirty cache records on a shared timer. */
export class AutoSyncService {
  private static instance: AutoSyncService | null = null;
  private cacheService: CacheService;
  private storageAdapter: FileSystemStorageAdapter;
  private config!: AutoSyncConfig;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private isShuttingDown = false;
  private hasDeferredBatchEntries = false;
  private syncCompleteResolve: (() => void) | null = null;
  private eventListeners = new Map<AutoSyncEvent, Set<AutoSyncEventListener>>();
  private stats: AutoSyncStats = {
    syncCount: 0,
    totalItemsSynced: 0,
    lastSyncTime: 0,
    avgSyncTime: 0,
    failedSyncCount: 0,
    successfulItemsSynced: 0,
    failedItemsSynced: 0,
  };

  private constructor(cacheService: CacheService, storageAdapter: FileSystemStorageAdapter) {
    this.cacheService = cacheService;
    this.storageAdapter = storageAdapter;

    this._updateConfigFromGlobalConfig();
    this._validateConfig(this.config);
  }

  public static getInstance(cacheService: CacheService, storageAdapter: FileSystemStorageAdapter): AutoSyncService {
    if (!AutoSyncService.instance) {
      AutoSyncService.instance = new AutoSyncService(cacheService, storageAdapter);
    } else {
      AutoSyncService.instance.cacheService = cacheService;
      AutoSyncService.instance.storageAdapter = storageAdapter;
      AutoSyncService.instance._updateConfigFromGlobalConfig();
      AutoSyncService.instance._validateConfig(AutoSyncService.instance.config);
    }
    return AutoSyncService.instance;
  }

  public static async cleanupInstance(): Promise<void> {
    if (AutoSyncService.instance) {
      await AutoSyncService.instance.cleanup();
      AutoSyncService.instance = null;
      logger.info('[AutoSyncService] Singleton instance cleaned up for hot reload');
    }
  }

  private _validateConfig(config: AutoSyncConfig): void {
    if (typeof config.interval !== 'number' || config.interval <= 0) {
      throw new Error(`Invalid interval: ${config.interval}. Must be a positive number.`);
    }
    if (typeof config.minItems !== 'number' || config.minItems < 0) {
      throw new Error(`Invalid minItems: ${config.minItems}. Must be a non-negative number.`);
    }
    if (typeof config.batchSize !== 'number' || config.batchSize <= 0) {
      throw new Error(`Invalid batchSize: ${config.batchSize}. Must be a positive number.`);
    }
    if (typeof config.enabled !== 'boolean') {
      throw new Error(`Invalid enabled: ${config.enabled}. Must be a boolean.`);
    }
  }

  private _updateConfigFromGlobalConfig(): void {
    const globalConfig = configManager.getConfig();
    this.config = {
      enabled: globalConfig.autoSync?.enabled ?? false,
      interval: globalConfig.autoSync?.interval ?? 5000,
      minItems: globalConfig.autoSync?.minItems ?? 1,
      batchSize: globalConfig.autoSync?.batchSize ?? 100,
    };
  }

  /** Starts the timer and optionally refreshes this instance from global configuration. */
  start(forceUpdateConfig: boolean = false): void {
    if (forceUpdateConfig) {
      this._updateConfigFromGlobalConfig();
      this._validateConfig(this.config);
    }

    if (this.syncTimer) {
      logger.info('[AutoSyncService] Sync timer already exists, restarting with new config', this.config);
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (!this.config.enabled) {
      logger.info('[AutoSyncService] Auto-sync is disabled in config');
      return;
    }

    logger.info('[AutoSyncService] Starting auto-sync service with config', this.config);

    // Start an initial pass without delaying the caller.
    this.sync().catch(error => {
      logger.error('[AutoSyncService] Initial sync failed', error);
    });

    this.syncTimer = setInterval(() => {
      this.sync().catch(error => {
        logger.error('[AutoSyncService] Scheduled sync failed', error);
      });
    }, this.config.interval);

    if (!this.syncTimer) {
      logger.error('[AutoSyncService] Failed to create sync timer');
    }
  }

  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info('[AutoSyncService] Stopping auto-sync service');
    }

    if (this.isSyncing) {
      logger.info('[AutoSyncService] Waiting for ongoing sync to complete...');
      await new Promise<void>(resolve => {
        // Chain concurrent stop calls so every waiter resolves after this sync.
        const existingResolve = this.syncCompleteResolve;
        this.syncCompleteResolve = () => {
          resolve();
          if (existingResolve) {
            existingResolve();
          }
        };
      });
      logger.info('[AutoSyncService] Ongoing sync completed');
    }
  }

  private async writeWithRetry(
    tableName: string,
    data: StorageRecord[],
    cacheKey: string,
    maxRetries: number = 3
  ): Promise<boolean> {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        attempt++;
        await this.storageAdapter.write<StorageRecord>(tableName, data, { mode: 'overwrite', directWrite: true });
        return true;
      } catch (error) {
        const isTransientError = this._isTransientError(error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries && isTransientError) {
          logger.warn(
            '[AutoSyncService] Attempt',
            attempt,
            'failed to sync item',
            cacheKey,
            'for table',
            tableName,
            ':',
            errorMessage
          );
        } else {
          logger.error(
            '[AutoSyncService] Attempt',
            attempt,
            'failed to sync item',
            cacheKey,
            'for table',
            tableName,
            ':',
            errorMessage
          );
        }

        if (attempt < maxRetries && isTransientError) {
          // Jitter prevents synchronized retries after a shared outage.
          const baseDelay = Math.pow(2, attempt - 1) * 500;
          const jitter = Math.random() * 250;
          const delay = baseDelay + jitter;
          logger.info('[AutoSyncService] Retrying in', Math.round(delay), 'ms...');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(
            '[AutoSyncService] Giving up on syncing item',
            cacheKey,
            'for table',
            tableName,
            '-',
            isTransientError ? 'max retries reached' : 'non-transient error'
          );
          break;
        }
      }
    }
    return false;
  }

  private _isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
    const transientErrorKeywords = [
      'timeout',
      'network',
      'connection',
      'retry',
      'temporary',
      'busy',
      'locked',
      'concurrency',
    ];

    return transientErrorKeywords.some(keyword => errorMessage.includes(keyword));
  }

  async sync(): Promise<void> {
    if (this.isSyncing || this.isShuttingDown) {
      logger.info('[AutoSyncService] Skipping sync, already in progress or shutting down');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const successfulWrites: string[] = [];
    const failedWrites: string[] = [];

    try {
      const dirtyData = this.cacheService.getDirtyData();
      const dirtyCount = dirtyData.size;

      logger.info('[AutoSyncService] Detected', dirtyCount, 'dirty items');

      if (dirtyCount === 0) {
        this.hasDeferredBatchEntries = false;
        return;
      }

      if (dirtyCount < this.config.minItems && !this.hasDeferredBatchEntries) {
        logger.info('[AutoSyncService] Dirty item count below threshold, skipping sync');
        return;
      }

      this.emit(AUTO_SYNC_EVENTS.SYNC_START, {
        itemsCount: dirtyCount,
      });

      const tableNames = await this.storageAdapter.listTables();
      const orderedTableNames = [...tableNames].sort((left, right) => right.length - left.length);
      const groupedDirtyData = new Map<string, DirtyCacheEntry[]>();
      for (const [cacheKey, data] of dirtyData.entries()) {
        try {
          const tableName = orderedTableNames.find(name => cacheKey === name || cacheKey.startsWith(`${name}_`));
          if (!tableName) {
            throw new Error('Cache key does not belong to an existing table');
          }

          const entries = groupedDirtyData.get(tableName) ?? [];
          entries.push({ cacheKey, data });
          groupedDirtyData.set(tableName, entries);
        } catch (error) {
          logger.error('[AutoSyncService] Failed to process cache key:', cacheKey, error);
          failedWrites.push(cacheKey);
        }
      }

      let hasDeferredBatchEntries = false;
      for (const [tableName, items] of groupedDirtyData.entries()) {
        const batchItems = items.slice(0, this.config.batchSize);
        hasDeferredBatchEntries ||= batchItems.length < items.length;
        logger.info('[AutoSyncService] Syncing', batchItems.length, 'items for table', tableName);

        const validEntries: DirtyCacheEntry[] = [];
        const incrementalRecords: StorageRecord[] = [];
        let fullTableSnapshot: StorageRecord[] | undefined;
        for (const entry of batchItems) {
          const records = getCachedRecords(entry.data);
          if (!records) {
            failedWrites.push(entry.cacheKey);
            logger.error('[AutoSyncService] Dirty cache entry is not a record or record array:', entry.cacheKey);
            continue;
          }
          validEntries.push(entry);
          if (isFullTableSnapshot(entry.cacheKey, tableName, entry.data)) {
            fullTableSnapshot = records;
          } else {
            incrementalRecords.push(...records);
          }
        }

        if (validEntries.length === 0) {
          continue;
        }

        const cacheKeys = validEntries.map(entry => entry.cacheKey);
        try {
          // The default read cache stores a complete table snapshot under `${tableName}_{}`.
          const currentRecords =
            fullTableSnapshot ?? (await this.storageAdapter.read<StorageRecord>(tableName, { bypassCache: true }));
          const mergedRecords = mergeRecords(currentRecords, incrementalRecords);
          const success = await this.writeWithRetry(tableName, mergedRecords, cacheKeys.join(','));

          if (success) {
            this.cacheService.markAsCleanBulk(cacheKeys);
            this.stats.totalItemsSynced += (fullTableSnapshot?.length ?? 0) + incrementalRecords.length;
            successfulWrites.push(...cacheKeys);
          } else {
            failedWrites.push(...cacheKeys);
          }
        } catch (error) {
          logger.error('[AutoSyncService] Unexpected error syncing table', tableName, ':', error);
          failedWrites.push(...cacheKeys);
        }

        logger.info('[AutoSyncService] Completed sync for table', tableName);
      }

      this.hasDeferredBatchEntries = hasDeferredBatchEntries;

      this.stats.syncCount++;
      this.stats.lastSyncTime = Date.now();
      this.stats.successfulItemsSynced += successfulWrites.length;
      this.stats.failedItemsSynced += failedWrites.length;

      const syncTime = Date.now() - startTime;
      // Maintain an incremental average without retaining every duration.
      this.stats.avgSyncTime = (this.stats.avgSyncTime * (this.stats.syncCount - 1) + syncTime) / this.stats.syncCount;

      logger.info('[AutoSyncService] Sync completed:', {
        totalItems: successfulWrites.length + failedWrites.length,
        successfulItems: successfulWrites.length,
        failedItems: failedWrites.length,
        syncTime,
      });

      this.emit(AUTO_SYNC_EVENTS.SYNC_COMPLETE, {
        itemsCount: successfulWrites.length + failedWrites.length,
        successfulItems: successfulWrites.length,
        failedItems: failedWrites.length,
        syncTime,
        stats: { ...this.stats },
      });
    } catch (error) {
      logger.error('[AutoSyncService] Sync failed with critical error:', error);
      this.stats.failedSyncCount++;

      const syncTime = Date.now() - startTime;
      this.emit(AUTO_SYNC_EVENTS.SYNC_ERROR, {
        syncTime,
        error: toError(error),
        stats: { ...this.stats },
      });
      this.emit(AUTO_SYNC_EVENTS.SYNC_FAILED, {
        syncTime,
        error: toError(error),
        stats: { ...this.stats },
      });
    } finally {
      this.isSyncing = false;
      // Shutdown waiters must run after every exit path, including failures.
      if (this.syncCompleteResolve) {
        this.syncCompleteResolve();
        this.syncCompleteResolve = null;
      }
    }
  }

  getStats(): AutoSyncStats {
    return { ...this.stats };
  }

  getConfig(): AutoSyncConfig {
    return { ...this.config };
  }

  async updateConfig(newConfig: Partial<AutoSyncConfig>): Promise<void> {
    const tempConfig = {
      ...this.config,
      ...newConfig,
    };

    this._validateConfig(tempConfig);

    this.config = tempConfig;

    logger.info('[AutoSyncService] Updated sync configuration', this.config);

    const shouldRestartTimer = newConfig.interval !== undefined && this.syncTimer !== null;
    if (shouldRestartTimer) {
      await this.stop();
      this.start();
    }

    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled && !this.syncTimer) {
        this.start();
      } else if (!newConfig.enabled && this.syncTimer) {
        await this.stop();
      }
    }
  }

  on(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    const listeners = this.eventListeners.get(event) ?? new Set<AutoSyncEventListener>();
    listeners.add(listener);
    this.eventListeners.set(event, listeners);
  }

  off(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) {
      return;
    }

    listeners.delete(listener);
    if (listeners.size === 0) {
      this.eventListeners.delete(event);
    }
  }

  once(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    const onceListener = (data: AutoSyncEventData) => {
      try {
        listener(data);
      } finally {
        this.off(event, onceListener);
      }
    };
    this.on(event, onceListener);
  }

  private emit(event: AutoSyncEvent, data: Omit<AutoSyncEventData, 'event'>): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) {
      return;
    }

    const fullData = { event, ...data };
    for (const listener of listeners) {
      try {
        listener(fullData);
      } catch (error) {
        logger.error('[AutoSyncService] Error in event listener:', error);
      }
    }
  }

  async cleanup(): Promise<void> {
    logger.info('[AutoSyncService] Starting cleanup...');
    this.isShuttingDown = true;
    await this.stop();
    this.eventListeners.clear();
    this.hasDeferredBatchEntries = false;
    this.isShuttingDown = false;
    logger.info('[AutoSyncService] Cleanup completed');
  }
}
