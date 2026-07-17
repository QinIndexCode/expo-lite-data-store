/**
 * @module EncryptedStorageAdapter
 * @description Encrypted storage adapter decorator with field-level encryption
 * @since 2025-11-19
 * @version 3.0.0
 */
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../types/storageTypes';
import type { LiteStoreConfig } from '../types/config';
import type { TableSchema } from './meta/MetadataManager';
import {
  decrypt,
  getMasterKey,
  getMasterKeyGeneration,
  decryptFields,
  decryptBulk,
  decryptFieldsBulk,
  encrypt,
  encryptFieldsBulk,
  encryptFields,
} from '../utils/crypto';
import { configManager } from './config/ConfigManager';
import storage from './adapter/FileSystemStorageAdapter';
import { ErrorHandler as StorageErrorHandler } from '../utils/StorageErrorHandler';
import { StorageError } from '../types/storageErrorInfc';
import { QueryEngine } from './query/QueryEngine';
import logger from '../utils/logger';

type CachedTableData = {
  data: Record<string, any>[];
  timestamp: number;
  sourceCiphertext?: string;
};

type FullTableWriteSnapshot = {
  existed: boolean;
  records: Record<string, any>[];
  logicalRecordCount?: number;
};

export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string> | null = null;
  private keyGeneration = -1;
  private cacheKeyGeneration = getMasterKeyGeneration();
  private cachedData: Map<string, CachedTableData> = new Map();
  private cacheTimeout = configManager.getConfig().encryption.cacheTimeout; // Read cache timeout from config
  private maxCacheSize = configManager.getConfig().encryption.maxCacheSize; // Read max cache size from config
  private requireAuthOnAccess: boolean = false;
  private pendingLogicalRecordCounts = new Map<string, number>();
  private transactionLogicalRecordCountSnapshots = new Map<string, number>();
  private static tableWriteLocks = new Map<string, Promise<void>>();

  // Optimization: Add query index cache
  private queryIndexes: Map<string, Map<string, Map<string | number, Record<string, any>[]>>> = new Map();

  /**
   * 构造函数
   * @param options 加密存储适配器配置选项
   */
  constructor(options?: { requireAuthOnAccess?: boolean }) {
    this.requireAuthOnAccess = options?.requireAuthOnAccess ?? false;
    this.validateConfig();
  }

  private invalidateCachesIfMasterKeyChanged(): void {
    const currentGeneration = getMasterKeyGeneration();
    if (this.cacheKeyGeneration !== currentGeneration) {
      this.cacheKeyGeneration = currentGeneration;
      this.clearAllCache();
    }
  }

  /**
   * 获取或初始化密钥
   * 延迟初始化，只有在实际需要使用密钥时才调用getMasterKey()，避免不必要的生物识别/密码识别
   */
  private async getOrInitKey(): Promise<string> {
    if (this.requireAuthOnAccess) {
      while (true) {
        const currentGeneration = getMasterKeyGeneration();
        const key = await getMasterKey(true);
        if (currentGeneration === getMasterKeyGeneration()) {
          return key;
        }
      }
    }

    while (true) {
      const currentGeneration = getMasterKeyGeneration();
      if (!this.keyPromise || this.keyGeneration !== currentGeneration) {
        this.keyPromise = getMasterKey(false);
        this.keyGeneration = currentGeneration;
      }

      const keyPromise = this.keyPromise!;
      try {
        const key = await keyPromise;
        if (currentGeneration === getMasterKeyGeneration()) {
          return key;
        }
      } catch (error) {
        if (this.keyPromise === keyPromise) {
          this.keyPromise = null;
          this.keyGeneration = -1;
        }
        throw error;
      }

      if (this.keyPromise === keyPromise) {
        this.keyPromise = null;
        this.keyGeneration = -1;
      }
    }
  }

  async ensureInitialized(): Promise<void> {
    if (typeof (storage as any).ensureInitialized === 'function') {
      await (storage as any).ensureInitialized();
    }

    if (this.requireAuthOnAccess) {
      await this.key();
    }
  }

  /**
   * 验证加密配置的合理性
   */
  private validateConfig(): void {
    const config = configManager.getConfig();
    // ValidateHMAC算法
    if (!['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)) {
      throw new Error(
        `Invalid HMAC algorithm: ${config.encryption.hmacAlgorithm}. Must be either 'SHA-256' or 'SHA-512'.`
      );
    }

    // ValidatePBKDF2迭代次数
    if (config.encryption.keyIterations < 10000 || config.encryption.keyIterations > 1000000) {
      throw new Error(`Invalid key iterations: ${config.encryption.keyIterations}. Must be between 10000 and 1000000.`);
    }

    // Validate缓存超时时间

    if (config.encryption.cacheTimeout < 0 || config.encryption.cacheTimeout > 3600000) {
      throw new Error(
        `Invalid cache timeout: ${config.encryption.cacheTimeout}. Must be between 0 and 3600000 (1 hour).`
      );
    }

    // Validate最大缓存大小
    if (config.encryption.maxCacheSize < 1 || config.encryption.maxCacheSize > 1000) {
      throw new Error(`Invalid max cache size: ${config.encryption.maxCacheSize}. Must be between 1 and 1000.`);
    }

    // Validate批量操作配置
    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      throw new Error(`Invalid useBulkOperations value: ${config.encryption.useBulkOperations}. Must be a boolean.`);
    }

    // Validate字段级加密配置
    if (config.encryption.encryptedFields !== undefined && !Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private async normalizeFullTableWriteResult(
    tableName: string,
    result: WriteResult,
    written: number,
    totalAfterWrite: number,
    snapshot?: FullTableWriteSnapshot
  ): Promise<WriteResult> {
    if (this.isStorageTransactionInProgress()) {
      this.rememberLogicalRecordCountBeforeTransactionWrite(tableName);
      this.pendingLogicalRecordCounts.set(tableName, totalAfterWrite);
    } else {
      try {
        await storage.setLogicalRecordCount(tableName, totalAfterWrite);
      } catch (error) {
        await this.restoreFailedFullTableWrite(tableName, snapshot, error);
        throw error;
      }
    }
    return {
      ...result,
      written,
      totalAfterWrite,
    };
  }

  private async key() {
    this.invalidateCachesIfMasterKeyChanged();
    const key = await this.getOrInitKey();
    this.invalidateCachesIfMasterKeyChanged();
    return key;
  }

  private async ensureAccessAuthorized(): Promise<string | undefined> {
    if (this.requireAuthOnAccess) {
      return this.key();
    }

    return undefined;
  }

  private isStorageTransactionInProgress(): boolean {
    return typeof (storage as any).isInTransaction === 'function' && (storage as any).isInTransaction();
  }

  private async withTableWriteLock<T>(tableName: string, operation: () => Promise<T>): Promise<T> {
    const previous = EncryptedStorageAdapter.tableWriteLocks.get(tableName);
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const queued = previous ? previous.then(() => current) : current;
    EncryptedStorageAdapter.tableWriteLocks.set(tableName, queued);

    if (previous) {
      await previous;
    }

    try {
      return await operation();
    } finally {
      releaseCurrent?.();
      if (EncryptedStorageAdapter.tableWriteLocks.get(tableName) === queued) {
        EncryptedStorageAdapter.tableWriteLocks.delete(tableName);
      }
    }
  }

  private rememberLogicalRecordCountBeforeTransactionWrite(tableName: string): void {
    if (this.transactionLogicalRecordCountSnapshots.has(tableName)) {
      return;
    }

    const currentCount = (storage as any).getTableMeta(tableName)?.count;
    if (Number.isSafeInteger(currentCount) && currentCount >= 0) {
      this.transactionLogicalRecordCountSnapshots.set(tableName, currentCount);
    }
  }

  private async restoreTransactionLogicalRecordCounts(): Promise<void> {
    for (const [tableName, count] of this.transactionLogicalRecordCountSnapshots) {
      await storage.setLogicalRecordCount(tableName, count);
    }
  }

  private async restoreTransactionLogicalRecordCountsSafely(): Promise<void> {
    try {
      await this.restoreTransactionLogicalRecordCounts();
    } catch (error) {
      logger.error('Failed to restore logical record counts after transaction rollback', error);
    }
  }

  private async captureFullTableWriteSnapshot(tableName: string): Promise<FullTableWriteSnapshot> {
    const existed = await storage.hasTable(tableName);
    if (!existed) {
      return { existed: false, records: [] };
    }

    const logicalRecordCount = (storage as any).getTableMeta(tableName)?.count;
    if (!Number.isSafeInteger(logicalRecordCount) || logicalRecordCount < 0) {
      throw new StorageError(
        `Cannot safely update full-table encrypted data for '${tableName}' because its logical record count is invalid`,
        'TABLE_UPDATE_FAILED',
        {
          details: 'The existing logical record count must be a non-negative safe integer before a recoverable write.',
          suggestion: 'Repair the table metadata before retrying the write.',
          tableName,
        }
      );
    }

    const records = await storage.read(tableName, { bypassCache: true });
    return {
      existed: true,
      records: this.cloneRecords(records),
      logicalRecordCount,
    };
  }

  private async prepareFullTableWriteSnapshot(tableName: string): Promise<FullTableWriteSnapshot | undefined> {
    if (this.isStorageTransactionInProgress()) {
      return undefined;
    }

    return this.captureFullTableWriteSnapshot(tableName);
  }

  private async restoreFullTableWriteSnapshot(tableName: string, snapshot: FullTableWriteSnapshot): Promise<void> {
    try {
      if (!snapshot.existed) {
        await storage.deleteTable(tableName);
        return;
      }

      await storage.write(tableName, this.cloneRecords(snapshot.records), { mode: 'overwrite' });
      await storage.setLogicalRecordCount(tableName, snapshot.logicalRecordCount!);
    } finally {
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
    }
  }

  private async restoreFailedFullTableWrite(
    tableName: string,
    snapshot: FullTableWriteSnapshot | undefined,
    originalError: unknown
  ): Promise<void> {
    if (!snapshot) {
      throw new StorageError(
        `Failed to recover full-table encrypted write for '${tableName}' after logical record count publication failed`,
        'TABLE_UPDATE_FAILED',
        {
          cause: originalError,
          details: 'No pre-write snapshot was available for recovery.',
          suggestion: 'Verify the table contents before retrying the write.',
          tableName,
        }
      );
    }

    try {
      await this.restoreFullTableWriteSnapshot(tableName, snapshot);
    } catch (recoveryError) {
      throw new StorageError(
        `Failed to recover full-table encrypted write for '${tableName}' after logical record count publication failed`,
        'TABLE_UPDATE_FAILED',
        {
          cause: originalError,
          details: `Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          suggestion: 'Verify the table contents and metadata before retrying the write.',
          tableName,
        }
      );
    }
  }

  private async getTableMeta(tableName: string) {
    if (typeof (storage as any).ensureInitialized === 'function') {
      await (storage as any).ensureInitialized();
    }
    const tableMeta = (storage as any).getTableMeta(tableName) as TableSchema | undefined;
    this.assertTableAccessPolicy(tableName, tableMeta);
    return tableMeta;
  }

  private assertTableAccessPolicy(tableName: string, tableMeta: TableSchema | undefined): void {
    if (tableMeta?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(
        `Table '${tableName}' requires strict access authentication`,
        'PERMISSION_DENIED',
        {
          details: 'This table is bound to the requireAuthOnAccess key scope.',
          suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
          tableName,
        }
      );
    }

    if (this.requireAuthOnAccess && tableMeta && tableMeta.requireAuthOnAccess !== true) {
      throw new StorageError(
        `Table '${tableName}' is not bound to the strict access-authentication key scope`,
        'MIGRATION_FAILED',
        {
          details: 'Switching an existing table between normal and strict encryption requires an explicit data migration.',
          suggestion: 'Migrate the table with an application-controlled flow before enabling requireAuthOnAccess.',
          tableName,
        }
      );
    }
  }

  private fullTableCacheKey(tableName: string): string {
    return `__enc_full_table_${tableName}`;
  }

  private cloneRecords(data: Record<string, any>[]): Record<string, any>[] {
    return JSON.parse(JSON.stringify(data)) as Record<string, any>[];
  }

  private getCachedFullTableData(tableName: string, sourceCiphertext: string): Record<string, any>[] | undefined {
    if (this.cacheTimeout <= 0) {
      return undefined;
    }

    const entry = this.cachedData.get(this.fullTableCacheKey(tableName));
    if (
      !entry ||
      entry.sourceCiphertext !== sourceCiphertext ||
      Date.now() - entry.timestamp >= this.cacheTimeout
    ) {
      return undefined;
    }

    return this.cloneRecords(entry.data);
  }

  private cacheFullTableData(tableName: string, data: Record<string, any>[], sourceCiphertext: string): void {
    if (this.cacheTimeout <= 0) {
      return;
    }

    this.cachedData.set(this.fullTableCacheKey(tableName), {
      data: this.cloneRecords(data),
      timestamp: Date.now(),
      sourceCiphertext,
    });
    this.manageCacheSize();
  }

  /**
   * 清除特定表的缓存
   */
  private clearTableCache(tableName: string): void {
    this.cachedData.delete(tableName);
    this.queryIndexes.delete(tableName);
  }

  private clearFullTableCache(tableName: string): void {
    this.cachedData.delete(this.fullTableCacheKey(tableName));
  }

  private resolveConfiguredEncryptedFields(tableMeta: TableSchema | undefined, config: LiteStoreConfig): string[] {
    const tableEncryptedFields = tableMeta?.encryptedFields;
    if (tableEncryptedFields && tableEncryptedFields.length > 0) {
      return tableEncryptedFields;
    }

    return config.encryption.encryptedFields || [];
  }

  private resolveAllRecordFields(data: Record<string, unknown>[]): string[] {
    const fields = new Set<string>();
    for (const item of data) {
      Object.keys(item).forEach(field => fields.add(field));
    }
    return [...fields];
  }

  private resolveFieldsForWrite(
    data: Record<string, unknown>[],
    tableMeta: TableSchema | undefined,
    config: LiteStoreConfig
  ): string[] {
    const configuredFields = this.resolveConfiguredEncryptedFields(tableMeta, config);
    if (configuredFields.length > 0) {
      return configuredFields;
    }

    if (tableMeta?.encrypted) {
      return this.resolveAllRecordFields(data);
    }

    return [];
  }

  private resolveFieldsForRead(
    raw: Record<string, unknown>[],
    tableMeta: TableSchema | undefined,
    config: LiteStoreConfig
  ): string[] {
    const configuredFields = this.resolveConfiguredEncryptedFields(tableMeta, config);
    if (configuredFields.length > 0) {
      return configuredFields;
    }

    if (tableMeta?.encrypted) {
      return this.resolveAllRecordFields(raw);
    }

    return [];
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cachedData.clear();
    this.queryIndexes.clear();
  }

  /**
   * 管理缓存大小，防止内存溢出
   * 同时清理对应的查询索引缓存
   */
  private manageCacheSize(): void {
    if (this.cachedData.size > this.maxCacheSize) {
      // Cleanup最旧的缓存条目
      const entries = Array.from(this.cachedData.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // Remove最旧的条目，直到缓存大小回到安全范围内
      const toRemove = entries.slice(0, this.cachedData.size - this.maxCacheSize);
      toRemove.forEach(([tableName]) => {
        this.cachedData.delete(tableName);
        // Also clear corresponding query index
        this.queryIndexes.delete(tableName);
      });
    }
  }

  /**
   * 构建查询索引（优化单字段查询）
   */
  private buildQueryIndex(tableName: string, field: string): void {
    const cached = this.cachedData.get(tableName);
    if (!cached) return;

    const index = new Map<string | number, Record<string, any>[]>();
    for (const item of cached.data) {
      const value = item[field];
      if (value !== undefined && value !== null) {
        const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(item);
      }
    }

    if (!this.queryIndexes.has(tableName)) {
      this.queryIndexes.set(tableName, new Map());
    }
    this.queryIndexes.get(tableName)!.set(field, index);
  }

  async createTable(
    tableName: string,
    options?: CreateTableOptions & {
      columns?: Record<string, string>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
      enableFieldLevelEncryption?: boolean;
      encryptedFields?: string[];
    }
  ): Promise<void> {
    const accessKey = await this.ensureAccessAuthorized();
    const { initialData = [], ...tableOptions } = options ?? {};
    const alreadyExists = await storage.hasTable(tableName);
    if (alreadyExists) {
      await this.getTableMeta(tableName);
      return;
    }

    if (options?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(
        `Table '${tableName}' requires a strict encrypted storage adapter`,
        'PERMISSION_DENIED',
        {
          details: 'requireAuthOnAccess must be selected when the encrypted adapter is created.',
          suggestion: 'Create the adapter with requireAuthOnAccess: true before creating the table.',
          tableName,
        }
      );
    }

    await storage.createTable(tableName, {
      ...tableOptions,
      encrypted: this.requireAuthOnAccess || tableOptions.encrypted,
      requireAuthOnAccess: this.requireAuthOnAccess,
      initialData: [],
    });

    if (initialData.length === 0) {
      return;
    }

    try {
      await this.overwriteWithKey(
        tableName,
        initialData,
        {
          encrypted: options?.encrypted,
          requireAuthOnAccess: options?.requireAuthOnAccess,
          encryptFullTable: options?.encryptFullTable,
        },
        accessKey ?? (await this.key())
      );
    } catch (error) {
      try {
        await storage.deleteTable(tableName);
      } catch (cleanupError) {
        logger.error(`Failed to clean up table ${tableName} after encrypted initialization failed`, cleanupError);
      }
      throw error;
    }
  }

  async deleteTable(tableName: string, _options?: any) {
    await this.ensureAccessAuthorized();
    return this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      try {
        return await storage.deleteTable(tableName, _options);
      } finally {
        this.clearTableCache(tableName);
        this.clearFullTableCache(tableName);
      }
    });
  }

  async hasTable(tableName: string, _options?: any) {
    await this.ensureAccessAuthorized();
    return storage.hasTable(tableName, _options);
  }

  async listTables(_options?: any) {
    await this.ensureAccessAuthorized();
    return storage.listTables(_options);
  }

  /**
   * 覆盖数据（总是使用覆盖模式）
   * @param tableName 表名
   * @param data 要覆盖的数据
   * @param options 写入选项（mode将被强制设为overwrite）
   * @returns Promise<WriteResult>
   */
  async overwrite(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return this.overwriteWithKey(tableName, data, options, await this.key());
  }

  private async overwriteWithKey(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.overwriteWithKeyUnlocked(tableName, data, options, key));
  }

  private async overwriteWithKeyUnlocked(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(Array.isArray(data) ? data : [data]);

        let encryptedData: Record<string, any>[] = [];
        let fullTableCiphertext: string | undefined;

        // Get配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Decide which encryption strategy to use
        const shouldEncryptFullTable = tableMeta?.encryptFullTable === true || options?.encryptFullTable === true;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          // Field-level encryption mode
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config);

          if (config.encryption.useBulkOperations && finalData.length > 1) {
            encryptedData = await encryptFieldsBulk(finalData, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            const encryptionPromises = finalData.map(item =>
              encryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            encryptedData = await Promise.all(encryptionPromises);
          }

          return storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
        } else {
          // Full table encryption mode
          if (shouldEncryptFullTable) {
            // Overwrite mode: Direct encrypted write
            const serializedData = JSON.stringify(finalData);
            const encrypted = await encrypt(serializedData, key);
            encryptedData = [{ __enc: encrypted }];
            fullTableCiphertext = encrypted;
          }
        }

        const fullTableWriteSnapshot = fullTableCiphertext
          ? await this.prepareFullTableWriteSnapshot(tableName)
          : undefined;
        const result = await storage.write(tableName, encryptedData, { ...options, mode: 'overwrite' });
        const normalizedResult = await this.normalizeFullTableWriteResult(
          tableName,
          result,
          finalData.length,
          finalData.length,
          fullTableWriteSnapshot
        );
        if (fullTableCiphertext) {
          this.cacheFullTableData(tableName, finalData, fullTableCiphertext);
        }
        return normalizedResult;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to overwrite table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.writeWithKey(tableName, data, options, await this.key());
  }

  private async writeWithKey(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.writeWithKeyUnlocked(tableName, data, options, key));
  }

  private async writeWithKeyUnlocked(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // Clear cache for this table
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(Array.isArray(data) ? data : [data]);

        let encryptedData: Record<string, any>[] = [];
        let fullTableTotal: number | undefined;
        let fullTableCacheData: Record<string, any>[] | undefined;
        let fullTableCacheCiphertext: string | undefined;
        let fullTableWriteSnapshot: FullTableWriteSnapshot | undefined;

        // Get配置，优先使用表级配置，然后是全局配置
        const config = configManager.getConfig();
        const tableMeta = await this.getTableMeta(tableName);

        // Encrypt写入策略：
        // 1. 优先使用字段级加密（性能更好，支持增量写入）
        // 2. 整表加密作为备选，但优化其append操作

        // Decide which encryption strategy to use
        // Optimization: Prefer field-level encryption for better performance，默认情况下即使没有配置encryptedFields也使用字段级加密
        // Only use full-table encryption when encryptFullTable is explicitly true
        // Prefer table metadata encryption config
        const tableEncryptFullTable = tableMeta?.encryptFullTable || false;
        const tableEncrypted = tableMeta?.encrypted || options?.encrypted || false;

        const shouldEncryptFullTable = options?.encryptFullTable === true || tableEncryptFullTable;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          // Field-level encryption mode - 性能更好，支持增量写入
          // Prefer table metadata encrypted fields over global config
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config);

          if (config.encryption.useBulkOperations && finalData.length > 1) {
            // Batch field-level encryption - 只加密新增数据
            encryptedData = await encryptFieldsBulk(finalData, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            // Single field-level encryption - 只加密新增数据
            const encryptionPromises = finalData.map(item =>
              encryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            encryptedData = await Promise.all(encryptionPromises);
          }

          // Field-level encryption supports direct append，不需要重新加密整个表
          // Removeencrypted选项，因为数据已经被加密了，避免重复加密
          const writeOptions = { ...options };
          delete writeOptions.encrypted;
          delete writeOptions.requireAuthOnAccess;
          return storage.write(tableName, encryptedData, writeOptions);
        } else {
          // Full table encryption mode - 仅在明确要求时使用
          if (shouldEncryptFullTable) {
            fullTableWriteSnapshot = await this.prepareFullTableWriteSnapshot(tableName);
            // Check写入模式
            if (options?.mode === 'append') {
              // Full-table encryption append mode optimization
              // Optimization 1: Use cache to reduce repeated decryption
              // Optimization 2: Encrypt only new data, not entire table
              // Optimization 3: Use incremental encryption strategy

              // Read existing encrypted data first
              const existingEncrypted = fullTableWriteSnapshot?.records ?? (await storage.read(tableName, { bypassCache: true }));
              let combinedData = finalData;

              if (existingEncrypted.length > 0 && existingEncrypted[0].__enc) {
                const existingCiphertext = existingEncrypted[0].__enc;
                const cachedData = this.getCachedFullTableData(tableName, existingCiphertext);
                const existingData = cachedData ?? JSON.parse(await decrypt(existingCiphertext, key));
                const normalizedExistingData = Array.isArray(existingData) ? existingData : [existingData];
                combinedData = [...normalizedExistingData, ...finalData];
              }

              // The cached plaintext must track every append, including a cache
              // hit, otherwise a later append can overwrite an earlier record.
              fullTableCacheData = combinedData;

              // Optimization 4: Use more efficient serialization and encryption
              const serializedData = JSON.stringify(combinedData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = combinedData.length;
            } else {
              // Overwrite mode: Direct encrypted write
              const serializedData = JSON.stringify(finalData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheData = finalData;
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = finalData.length;
            }
          } else {
            // Not explicitly required full-table, check if table needs encryption
            if (tableEncrypted || options?.encrypted) {
              // Table is encrypted, use field-level encryption（默认行为）
              if (config.encryption.useBulkOperations && finalData.length > 1) {
                // Batch field-level encryption - 只加密新增数据
                encryptedData = await encryptFieldsBulk(finalData, {
                  fields: Object.keys(finalData[0] || {}), // Encrypt所有字段
                  masterKey: key,
                });
              } else {
                // Single field-level encryption - 只加密新增数据
                const encryptionPromises = finalData.map(item =>
                  encryptFields(item, {
                    fields: Object.keys(item), // Encrypt所有字段
                    masterKey: key,
                  })
                );
                encryptedData = await Promise.all(encryptionPromises);
              }
            }
          }
        }

        // If encryptedData is empty且表是加密的，说明加密逻辑没有被正确执行
        // This should not happen，如果发生应该抛出错误
        if (encryptedData.length === 0) {
          if (tableEncrypted || options?.encrypted) {
            throw new Error('Encryption logic was not executed for encrypted table');
          }
          encryptedData = finalData;
        }

        // Removeencrypted和requireAuthOnAccess选项，因为数据已经被加密了，避免重复加密
        const finalWriteOptions = { ...options };
        delete finalWriteOptions.encrypted;
        delete finalWriteOptions.requireAuthOnAccess;
        const storageMode = fullTableTotal !== undefined ? 'overwrite' : options?.mode;
        const result = await storage.write(tableName, encryptedData, { ...finalWriteOptions, mode: storageMode });
        if (fullTableTotal !== undefined) {
          const normalizedResult = await this.normalizeFullTableWriteResult(
            tableName,
            result,
            finalData.length,
            fullTableTotal,
            fullTableWriteSnapshot
          );
          if (fullTableCacheData && fullTableCacheCiphertext) {
            this.cacheFullTableData(tableName, fullTableCacheData, fullTableCacheCiphertext);
          }
          return normalizedResult;
        }
        return result;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to write to table ${tableName}`,
          'TABLE_UPDATE_FAILED',
          cause,
          'Storage operation failed',
          'Check if you have write permissions. For better performance with encrypted storage, consider using field-level encryption instead of full-table encryption.'
        )
    );
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return this.readWithKey(tableName, options, await this.key());
  }

  private async readWithKey(
    tableName: string,
    options: (ReadOptions & { bypassCache?: boolean }) | undefined,
    key: string
  ): Promise<Record<string, any>[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // If cache timeout is 0，清除所有缓存并禁用缓存
        if (this.cacheTimeout === 0) {
          this.cachedData.clear();
          this.queryIndexes.clear();
        }

        // Always read latest data from underlying adapter，忽略缓存
        // Ensures we get latest disk data，包括刚提交的事务数据
        // Only pass read-related options，不传递查询相关的选项
        const tableMeta = await this.getTableMeta(tableName);
        const readOptions = options ? { bypassCache: options.bypassCache } : undefined;
        const raw = await storage.read(tableName, readOptions);
        if (raw.length === 0) {
          this.clearTableCache(tableName);
          this.clearFullTableCache(tableName);
          return [];
        }

        const first = raw[0];
        let result: Record<string, any>[] = [];

        // Get table的元数据，以确定是否启用了字段级加密
        const config = configManager.getConfig();
        // Prefer table metadata encrypted fields over global config
        const encryptedFields = this.resolveFieldsForRead(raw, tableMeta, config);

        if (first?.['__enc']) {
          // Full data decryption
          const decryptedData = JSON.parse(await decrypt(first['__enc'], key));
          result = Array.isArray(decryptedData) ? decryptedData : [decryptedData];
          this.cacheFullTableData(tableName, result, first['__enc']);
        } else if (first?.['__enc_bulk']) {
          // Batch data decryption
          const decryptedStrings = await decryptBulk(first['__enc_bulk'], key);
          result = decryptedStrings.map(str => JSON.parse(str));
        } else if (encryptedFields.length > 0) {
          // Field-level decryption - 根据encryptedFields是否存在来决定
          if (config.encryption.useBulkOperations && raw.length > 1) {
            // Batch field-level decryption
            result = await decryptFieldsBulk(raw, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
            // Single field-level decryption
            const decryptionPromises = raw.map(item =>
              decryptFields(item, {
                fields: encryptedFields,
                masterKey: key,
              })
            );
            result = await Promise.all(decryptionPromises);
          }
        } else {
          result = raw;
        }

        // Only when cache timeout is greater than 0，才更新缓存
        if (this.cacheTimeout > 0) {
          this.cachedData.set(tableName, {
            data: this.cloneRecords(result),
            timestamp: Date.now(),
          });

          // Manage cache size
          this.manageCacheSize();

          // Build indexes for common fields（优化查询性能）
          if (configManager.getConfig().performance.enableQueryOptimization && result.length > 0) {
            // Build index for ID field（最常用）
            if (result.some(item => item['id'] !== undefined)) {
              this.buildQueryIndex(tableName, 'id');
            }
            // Build index for other common fields
            const commonFields = ['name', 'email', 'type', 'status'];
            commonFields.forEach(field => {
              if (result.some(item => item[field] !== undefined)) {
                this.buildQueryIndex(tableName, field);
              }
            });
          }
        }

        return this.cloneRecords(result);
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to read from table ${tableName}`,
          'TABLE_READ_FAILED',
          cause,
          'Decryption or storage operation failed',
          'Check if you have read permissions and the encryption key is valid'
        )
    );
  }

  async count(tableName: string): Promise<number> {
    return this.countWithKey(tableName, await this.key());
  }

  private async countWithKey(tableName: string, key: string): Promise<number> {
    await this.getTableMeta(tableName);
    // Optimization: Get count from cache if valid, avoid reading all data
    const cached = this.cachedData.get(tableName);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data.length;
    }

    // For encrypted tables, read all data to get count
    const data = await this.readWithKey(tableName, undefined, key);
    return data.length;
  }

  /**
   * 验证表的计数准确性（加密适配器版本）
   * 对于加密表，计数直接从数据读取，不涉及元数据
   */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const key = await this.key();
    const tableMeta = await this.getTableMeta(tableName);
    if (!tableMeta?.encryptFullTable) {
      return storage.verifyCount(tableName);
    }

    const metadata = tableMeta.count ?? 0;
    const actual = await this.countWithKey(tableName, key);
    const match = metadata === actual;
    if (!match && !this.isStorageTransactionInProgress()) {
      await storage.setLogicalRecordCount(tableName, actual);
    }
    return { metadata, actual, match };
  }

  async findOne(tableName: string, filter: Record<string, any>, options?: any): Promise<Record<string, any> | null> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        const key = await this.key();
        await this.getTableMeta(tableName);
        // Optimization: Use index for fast lookup
        if (configManager.getConfig().performance.enableQueryOptimization) {
          // Get所有索引字段
          const tableIndexes = this.queryIndexes.get(tableName);
          if (tableIndexes) {
            // Find index fields used in filter
            const filterFields = Object.keys(filter);
            for (const field of filterFields) {
              // Check该字段是否有索引
              if (tableIndexes.has(field)) {
                const fieldIndex = tableIndexes.get(field)!;
                const filterValue = filter[field];
                const indexKey = typeof filterValue === 'object' ? JSON.stringify(filterValue) : String(filterValue);

                // Find matching data from index
                const indexedData = fieldIndex.get(indexKey) || [];
                if (indexedData.length > 0) {
                  // If matches found, use QueryEngine for more precise filtering
                  const filtered = QueryEngine.filter(indexedData, filter);
                  if (filtered.length > 0) {
                    return this.cloneRecords([filtered[0]])[0];
                  }
                }
              }
            }
          }
        }

        // No usable index or not found, fallback to read all data
        const data = await this.readWithKey(tableName, options, key);
        const filtered = QueryEngine.filter(data, filter);
        return filtered.length > 0 ? this.cloneRecords([filtered[0]])[0] : null;
      },
      cause =>
        StorageErrorHandler.createGeneralError(
          `Failed to findOne in table ${tableName}`,
          'QUERY_FAILED',
          cause,
          'Query operation failed',
          'Check if your query filter is valid and the table exists'
        )
    );
  }

  async findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: {
      skip?: number;
      limit?: number;
      sortBy?: string | string[];
      order?: 'asc' | 'desc' | ('asc' | 'desc')[];
      sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
      requireAuthOnAccess?: boolean;
    },
    findOptions?: any
  ): Promise<Record<string, any>[]> {
    const key = await this.key();
    // Prefer cache
    // Only pass read-related options，不传递skip和limit等查询选项
    const readOptions = { ...findOptions };
    // Remove可能影响底层存储读取的查询选项
    delete readOptions.skip;
    delete readOptions.limit;
    delete readOptions.sortBy;
    delete readOptions.order;
    delete readOptions.sortAlgorithm;

    let data = await this.readWithKey(tableName, readOptions, key);

    // Apply filtering - 使用QueryEngine处理所有复杂查询操作符
    if (filter) {
      const filtered = QueryEngine.filter(data, filter);
      data = filtered;
    }

    // Apply sorting
    if (options?.sortBy) {
      data = QueryEngine.sort(data, options.sortBy, options.order, options.sortAlgorithm);
    } else {
      // Default sort by id, ensure consistent pagination
      data = QueryEngine.sort(data, 'id', 'asc', options?.sortAlgorithm);
    }

    // Apply pagination - 手动实现分页逻辑，确保正确处理skip和limit
    const skip = options?.skip || 0;
    const limit = options?.limit;

    if (limit !== undefined) {
      return this.cloneRecords(data.slice(skip, skip + limit));
    } else {
      return this.cloneRecords(data.slice(skip));
    }
  }

  async bulkWrite(
    tableName: string,
    operations: Array<
      | {
          type: 'insert';
          data: Record<string, any> | Record<string, any>[];
        }
      | {
          type: 'update';
          data: Record<string, any>;
          where: Record<string, any>;
        }
      | {
          type: 'delete';
          where: Record<string, any>;
        }
    >,
    options?: any
  ): Promise<WriteResult> {
    const key = await this.key();
    if (operations.length > 0 && operations.every(operation => operation.type === 'insert')) {
      const insertItems = operations.flatMap(operation =>
        Array.isArray(operation.data) ? operation.data : [operation.data]
      );
      const result = await this.writeWithKey(tableName, insertItems, { ...options, mode: 'append' }, key);
      return {
        ...result,
        written: insertItems.length,
      };
    }

    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      let finalData = [...allData];
      let writtenCount = 0;

      for (const operation of operations) {
        if (operation.type === 'insert') {
          const insertData = Array.isArray(operation.data) ? operation.data : [operation.data];
          finalData = [...finalData, ...insertData];
          writtenCount += insertData.length;
        } else if (operation.type === 'update') {
          if (operation.where) {
            const matchedItems = QueryEngine.filter(finalData, operation.where);
            const matchedItemRefs = new Set(matchedItems);
            finalData = finalData.map(item =>
              matchedItemRefs.has(item) ? QueryEngine.update(item, operation.data) : item
            );
            writtenCount += matchedItems.length;
          } else {
            const index = finalData.findIndex(item => item.id === operation.data.id);
            if (index !== -1) {
              finalData[index] = QueryEngine.update(finalData[index], operation.data);
              writtenCount++;
            }
          }
        } else if (operation.type === 'delete') {
          if (operation.where) {
            const matchedItems = QueryEngine.filter(finalData, operation.where);
            const matchedItemRefs = new Set(matchedItems);
            finalData = finalData.filter(item => !matchedItemRefs.has(item));
            writtenCount += matchedItems.length;
          } else {
            finalData = [];
            writtenCount = allData.length;
          }
        }
      }

      const result = await this.writeWithKeyUnlocked(tableName, finalData, { ...options, mode: 'overwrite' }, key);

      return { ...result, written: writtenCount };
    });
  }

  async migrateToChunked(tableName: string): Promise<void> {
    await this.ensureAccessAuthorized();
    await this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
      await storage.migrateToChunked(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
    });
  }

  async delete(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    const key = await this.key();
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, where);
      const matchedItemRefs = new Set(matchedItems);
      const remainingData = allData.filter(item => !matchedItemRefs.has(item));

      await this.writeWithKeyUnlocked(tableName, remainingData, { ...options, mode: 'overwrite' }, key);
      return matchedItems.length;
    });
  }

  async beginTransaction(options?: any): Promise<void> {
    await this.ensureAccessAuthorized();
    await storage.beginTransaction(options);
    this.pendingLogicalRecordCounts.clear();
    this.transactionLogicalRecordCountSnapshots.clear();
  }

  async commit(options?: any): Promise<void> {
    await this.ensureAccessAuthorized();
    const pendingCounts = new Map(this.pendingLogicalRecordCounts);
    try {
      await storage.commit(options, async () => {
        for (const [tableName, count] of pendingCounts) {
          await storage.setLogicalRecordCount(tableName, count);
        }
      });
    } catch (error) {
      await this.restoreTransactionLogicalRecordCountsSafely();
      throw error;
    } finally {
      this.clearAllCache();
      this.pendingLogicalRecordCounts.clear();
      this.transactionLogicalRecordCountSnapshots.clear();
    }
  }

  async rollback(options?: any): Promise<void> {
    await this.ensureAccessAuthorized();
    try {
      await storage.rollback(options);
    } finally {
      await this.restoreTransactionLogicalRecordCountsSafely();
      this.clearAllCache();
      this.pendingLogicalRecordCounts.clear();
      this.transactionLogicalRecordCountSnapshots.clear();
    }
  }

  async update(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    options?: any
  ): Promise<number> {
    const key = await this.key();
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, where);
      const matchedItemRefs = new Set(matchedItems);
      let updatedCount = 0;
      const updatedData = allData.map(item => {
        if (matchedItemRefs.has(item)) {
          updatedCount++;
          return QueryEngine.update(item, data);
        }
        return item;
      });

      await this.writeWithKeyUnlocked(tableName, updatedData, { ...options, mode: 'overwrite' }, key);
      return updatedCount;
    });
  }

  async remove(tableName: string, where: Record<string, any>, options?: any): Promise<number> {
    return this.delete(tableName, where, options);
  }

  async clearTable(tableName: string): Promise<void> {
    await this.ensureAccessAuthorized();
    await this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      this.clearTableCache(tableName);
      this.clearFullTableCache(tableName);
      await storage.clearTable(tableName);
    });
  }

  async insert(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    // Insert operation总是使用append模式，忽略传入的mode选项
    return this.write(tableName, data, { ...options, mode: 'append' });
  }
}
