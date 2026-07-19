import type { IStorageAdapter } from '../types/storageAdapterInfc';
import {
  isStorageRecord,
  type BulkOperation,
  type CreateTableOptions,
  type FilterCondition,
  type FindOptions,
  type InternalWriteOptions,
  type NonInfer,
  type ReadOptions,
  type StorageInput,
  type StorageRecord,
  type TableOptions,
  type UpdatePayload,
  type WriteOptions,
  type WriteResult,
} from '../types/storageTypes';
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
import {
  transactionOwnerOption,
  withDynamicFieldEncryption,
  withLogicalRecordCount,
  type TransactionOwnerToken,
  type TransactionScopedOptions,
  type TransactionWriteOptions,
} from './service/TransactionService';

type CachedTableData = {
  data: StorageRecord[];
  timestamp: number;
  sourceCiphertext: string;
};

type ResolvedFieldEncryptionPolicy = {
  encryptedFields: string[];
  encryptAllFields: boolean;
};

export class EncryptedStorageAdapter implements IStorageAdapter {
  private keyPromise: Promise<string> | null = null;
  private keyGeneration = -1;
  private cacheKeyGeneration = getMasterKeyGeneration();
  private fullTableCache: Map<string, CachedTableData> = new Map();
  private cacheTimeout = configManager.getConfig().encryption.cacheTimeout;
  private maxCacheSize = configManager.getConfig().encryption.maxCacheSize;
  private requireAuthOnAccess: boolean = false;
  private static tableWriteLocks = new Map<string, Promise<void>>();
  private readonly transactionOwner: TransactionOwnerToken = {};

  private normalizeStorageInput<T extends object>(data: StorageInput<T>): StorageRecord[] {
    const records: unknown[] = Array.isArray(data) ? data : [data];
    if (!records.every(isStorageRecord)) {
      throw new StorageError('Invalid data: expected an object or an array of objects', 'FILE_CONTENT_INVALID', {
        suggestion: 'Provide a non-null object for every record.',
      });
    }
    return records;
  }

  private normalizeStorageRecord(record: object): StorageRecord {
    if (!isStorageRecord(record)) {
      throw new StorageError('Invalid update payload: expected a non-array object', 'FILE_CONTENT_INVALID', {
        suggestion: 'Provide one non-null object for the update payload.',
      });
    }
    return record;
  }

  private toPublicRecords<T extends object>(records: StorageRecord[]): T[] {
    return records as unknown as T[];
  }

  private toPublicRecord<T extends object>(record: StorageRecord | null): T | null {
    return record as unknown as T | null;
  }

  private toStorageFilter<T extends object>(filter: FilterCondition<T>): FilterCondition<StorageRecord> {
    return filter as unknown as FilterCondition<StorageRecord>;
  }

  private toStorageReadOptions<T extends object>(options?: ReadOptions<T>): ReadOptions<StorageRecord> | undefined {
    return options as unknown as ReadOptions<StorageRecord> | undefined;
  }

  private toStorageFindOptions<T extends object>(options?: FindOptions<T>): FindOptions<StorageRecord> | undefined {
    return options as unknown as FindOptions<StorageRecord> | undefined;
  }

  private normalizeBulkOperations<T extends object>(operations: BulkOperation<T>[]): BulkOperation<StorageRecord>[] {
    return operations.map(operation => {
      switch (operation.type) {
        case 'insert': {
          const records = this.normalizeStorageInput(operation.data);
          return {
            type: 'insert',
            data: Array.isArray(operation.data) ? records : records[0],
          };
        }
        case 'update':
          return {
            type: 'update',
            data: this.normalizeStorageRecord(operation.data),
            where: this.toStorageFilter(operation.where),
          };
        case 'delete':
          return {
            type: 'delete',
            where: this.toStorageFilter(operation.where),
          };
      }
    });
  }

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
    await storage.ensureInitialized();

    if (this.requireAuthOnAccess) {
      await this.key();
    }
  }

  private validateConfig(): void {
    const config = configManager.getConfig();
    if (!['SHA-256', 'SHA-512'].includes(config.encryption.hmacAlgorithm)) {
      throw new Error(
        `Invalid HMAC algorithm: ${config.encryption.hmacAlgorithm}. Must be either 'SHA-256' or 'SHA-512'.`
      );
    }
    if (config.encryption.keyIterations < 10000 || config.encryption.keyIterations > 1000000) {
      throw new Error(`Invalid key iterations: ${config.encryption.keyIterations}. Must be between 10000 and 1000000.`);
    }

    if (config.encryption.cacheTimeout < 0 || config.encryption.cacheTimeout > 3600000) {
      throw new Error(
        `Invalid cache timeout: ${config.encryption.cacheTimeout}. Must be between 0 and 3600000 (1 hour).`
      );
    }
    if (config.encryption.maxCacheSize < 1 || config.encryption.maxCacheSize > 1000) {
      throw new Error(`Invalid max cache size: ${config.encryption.maxCacheSize}. Must be between 1 and 1000.`);
    }
    if (typeof config.encryption.useBulkOperations !== 'boolean') {
      throw new Error(`Invalid useBulkOperations value: ${config.encryption.useBulkOperations}. Must be a boolean.`);
    }
    if (config.encryption.encryptedFields !== undefined && !Array.isArray(config.encryption.encryptedFields)) {
      throw new Error(`Invalid encryptedFields value: ${config.encryption.encryptedFields}. Must be an array.`);
    }
  }

  private normalizeFullTableWriteResult(result: WriteResult, written: number, totalAfterWrite: number): WriteResult {
    return {
      ...result,
      written,
      totalAfterWrite,
    };
  }

  private async key() {
    this.assertTransactionOwnership();
    this.invalidateCachesIfMasterKeyChanged();
    const key = await this.getOrInitKey();
    this.invalidateCachesIfMasterKeyChanged();
    return key;
  }

  private async ensureAccessAuthorized(): Promise<string | undefined> {
    this.assertTransactionOwnership();
    if (this.requireAuthOnAccess) {
      return this.key();
    }

    return undefined;
  }

  private assertTransactionOwnership(): void {
    storage.assertTransactionOwner(this.transactionOwner);
  }

  private withTransactionOwner(): TableOptions & TransactionScopedOptions;
  private withTransactionOwner<T extends object>(options: T | undefined): T & TransactionScopedOptions;
  private withTransactionOwner<T extends object>(options?: T): (T | TableOptions) & TransactionScopedOptions {
    return {
      ...(options ?? ({} as T)),
      [transactionOwnerOption]: this.transactionOwner,
    } as (T | TableOptions) & TransactionScopedOptions;
  }

  private isStorageTransactionInProgress(): boolean {
    return storage.isInTransaction();
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

  private async getTableMeta(tableName: string) {
    this.assertTransactionOwnership();
    await storage.ensureInitialized();
    const tableMeta = storage.getTableMeta(tableName);
    this.assertPersistedEncryptionPolicy(tableName, tableMeta);
    this.assertTableAccessPolicy(tableName, tableMeta);
    return tableMeta;
  }

  private assertPersistedEncryptionPolicy(tableName: string, tableMeta: TableSchema | undefined): void {
    if (!tableMeta) {
      return;
    }

    const hasEncryptedFields = (tableMeta.encryptedFields?.length ?? 0) > 0;
    const encryptAllFields = tableMeta.encryptAllFields === true;
    const requiresEncryption =
      tableMeta.encryptFullTable === true ||
      tableMeta.requireAuthOnAccess === true ||
      hasEncryptedFields ||
      encryptAllFields;
    if (requiresEncryption && tableMeta.encrypted !== true) {
      throw new StorageError(
        `Table '${tableName}' has inconsistent persisted encryption metadata`,
        'MIGRATION_FAILED',
        {
          details: 'A protected table policy cannot be opened while its encrypted flag is disabled.',
          suggestion: 'Restore verified metadata or migrate the table through an application-controlled recovery flow.',
          tableName,
        }
      );
    }

    if (
      encryptAllFields &&
      (tableMeta.encryptFullTable === true ||
        tableMeta.encryptedFields === undefined ||
        tableMeta.encryptedFields.length !== 0)
    ) {
      throw new StorageError(
        `Table '${tableName}' has inconsistent all-field encryption metadata`,
        'MIGRATION_FAILED',
        {
          details: 'Dynamic all-field encryption requires field-level mode and an explicitly empty field list.',
          suggestion: 'Restore verified metadata or migrate the table through an application-controlled recovery flow.',
          tableName,
        }
      );
    }
  }

  private assertWriteEncryptionPolicy(
    tableName: string,
    tableMeta: TableSchema,
    options: Omit<WriteOptions, 'mode'> | WriteOptions | undefined
  ): void {
    const hasOption = (name: 'encrypted' | 'encryptFullTable' | 'requireAuthOnAccess'): boolean =>
      options !== undefined && Object.prototype.hasOwnProperty.call(options, name) && options[name] !== undefined;

    if (hasOption('encryptFullTable') && options?.encryptFullTable !== (tableMeta.encryptFullTable === true)) {
      throw new StorageError(`Table '${tableName}' has a different full-table encryption policy`, 'MIGRATION_FAILED', {
        details: 'Changing an existing table encryption mode requires an explicit data migration.',
        suggestion: 'Omit encryptFullTable to use the persisted policy, or migrate the table explicitly.',
        tableName,
      });
    }

    const requestedEncrypted = options?.encryptFullTable === true ? true : options?.encrypted;
    if (hasOption('encrypted') && requestedEncrypted !== (tableMeta.encrypted === true)) {
      throw new StorageError(`Table '${tableName}' has a different encrypted-storage policy`, 'MIGRATION_FAILED', {
        details: 'Changing an existing table encryption policy requires an explicit data migration.',
        suggestion: 'Omit encrypted to use the persisted policy, or migrate the table explicitly.',
        tableName,
      });
    }

    if (options?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires a strict encrypted storage adapter`, 'PERMISSION_DENIED', {
        details: 'requireAuthOnAccess must be selected when the encrypted adapter is created.',
        suggestion: 'Create the adapter with requireAuthOnAccess: true before writing.',
        tableName,
      });
    }

    if (hasOption('requireAuthOnAccess') && options?.requireAuthOnAccess !== (tableMeta.requireAuthOnAccess === true)) {
      throw new StorageError(`Table '${tableName}' has a different access-authentication policy`, 'MIGRATION_FAILED', {
        details: 'Changing requireAuthOnAccess on an existing table requires an explicit data migration.',
        suggestion: 'Omit requireAuthOnAccess to use the persisted policy, or migrate the table explicitly.',
        tableName,
      });
    }
  }

  private assertExistingCreateTablePolicy<T extends object>(
    tableName: string,
    tableMeta: TableSchema,
    options: CreateTableOptions<T> | undefined
  ): void {
    this.assertWriteEncryptionPolicy(tableName, tableMeta, options);

    if (options?.encryptedFields === undefined) {
      return;
    }

    const requestedFields = new Set(options.encryptedFields);
    const configuredFields = new Set(tableMeta.encryptedFields ?? []);
    const fieldsMatch =
      requestedFields.size === 0
        ? tableMeta.encrypted !== true || tableMeta.encryptFullTable === true || tableMeta.encryptAllFields === true
        : tableMeta.encryptAllFields !== true &&
          requestedFields.size === configuredFields.size &&
          Array.from(requestedFields).every(field => configuredFields.has(field));

    if (!fieldsMatch) {
      throw new StorageError(`Table '${tableName}' has different encrypted field settings`, 'MIGRATION_FAILED', {
        details: 'Changing encrypted fields on an existing table requires an explicit data migration.',
        suggestion: 'Omit encryptedFields to use the persisted policy, or migrate the table explicitly.',
        tableName,
      });
    }
  }

  private getImplicitTablePolicy(
    options: Omit<WriteOptions, 'mode'> | WriteOptions | undefined,
    fieldPolicy: ResolvedFieldEncryptionPolicy
  ): Pick<
    CreateTableOptions<StorageRecord>,
    'encrypted' | 'encryptFullTable' | 'requireAuthOnAccess' | 'encryptedFields'
  > {
    const encryptFullTable = options?.encryptFullTable === true;
    const encrypted = this.requireAuthOnAccess || options?.encrypted === true || encryptFullTable;
    const useFieldEncryption = encrypted && !encryptFullTable;
    return withDynamicFieldEncryption(
      {
        encrypted,
        encryptFullTable,
        requireAuthOnAccess: this.requireAuthOnAccess,
        encryptedFields: useFieldEncryption ? [...fieldPolicy.encryptedFields] : [],
      },
      useFieldEncryption && fieldPolicy.encryptAllFields
    );
  }

  private getExplicitCreateTablePolicy<T extends object>(
    options: Omit<CreateTableOptions<T>, 'initialData'>,
    config: LiteStoreConfig
  ): Pick<
    CreateTableOptions<StorageRecord>,
    'encrypted' | 'encryptFullTable' | 'requireAuthOnAccess' | 'encryptedFields'
  > {
    const requestedFields = options.encryptedFields;
    const policyOptions: Omit<WriteOptions, 'mode'> = {
      encrypted: options.encrypted === true || (requestedFields?.length ?? 0) > 0,
      encryptFullTable: options.encryptFullTable,
      requireAuthOnAccess: options.requireAuthOnAccess,
    };
    const fieldPolicy: ResolvedFieldEncryptionPolicy =
      requestedFields === undefined
        ? this.resolveImplicitFieldEncryptionPolicy(policyOptions, config)
        : {
            encryptedFields: [...new Set(requestedFields)],
            encryptAllFields: requestedFields.length === 0,
          };

    return this.getImplicitTablePolicy(policyOptions, fieldPolicy);
  }

  private getStorageWriteOptions(
    options: Omit<WriteOptions, 'mode'> | WriteOptions | undefined,
    tableMeta: TableSchema | undefined,
    mode: InternalWriteOptions['mode'] | undefined,
    implicitFieldPolicy: ResolvedFieldEncryptionPolicy,
    logicalRecordCount?: number
  ): TransactionWriteOptions {
    const writeOptions: TransactionWriteOptions = {
      ...options,
      ...(mode === undefined ? {} : { mode }),
    };
    if (tableMeta) {
      delete writeOptions.encrypted;
      delete writeOptions.requireAuthOnAccess;
      delete writeOptions.encryptedFields;
    } else {
      Object.assign(writeOptions, this.getImplicitTablePolicy(options, implicitFieldPolicy));
    }
    const transactionOptions = this.withTransactionOwner(writeOptions);
    return logicalRecordCount === undefined
      ? transactionOptions
      : withLogicalRecordCount(transactionOptions, logicalRecordCount);
  }

  private async getTableMetaForWrite(
    tableName: string,
    options: Omit<WriteOptions, 'mode'> | WriteOptions | undefined,
    implicitFieldPolicy: ResolvedFieldEncryptionPolicy
  ): Promise<TableSchema | undefined> {
    if (options?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires a strict encrypted storage adapter`, 'PERMISSION_DENIED', {
        details: 'requireAuthOnAccess must be selected when the encrypted adapter is created.',
        suggestion: 'Create the adapter with requireAuthOnAccess: true before writing.',
        tableName,
      });
    }

    let tableMeta = await this.getTableMeta(tableName);
    if (!tableMeta) {
      const policy = this.getImplicitTablePolicy(options, implicitFieldPolicy);
      const { encrypted } = policy;
      if (!encrypted) {
        return undefined;
      }

      // Let the queued storage write create the table during commit so its
      // transaction snapshot still records that the table did not exist.
      if (this.isStorageTransactionInProgress()) {
        return undefined;
      }

      await storage.createTable(tableName, this.withTransactionOwner(policy));
      tableMeta = await this.getTableMeta(tableName);
    }

    if (tableMeta) {
      this.assertWriteEncryptionPolicy(tableName, tableMeta, options);
    }
    return tableMeta;
  }

  private assertTableAccessPolicy(tableName: string, tableMeta: TableSchema | undefined): void {
    if (tableMeta?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires strict access authentication`, 'PERMISSION_DENIED', {
        details: 'This table is bound to the requireAuthOnAccess key scope.',
        suggestion: 'Repeat the operation with encrypted: true and requireAuthOnAccess: true.',
        tableName,
      });
    }

    if (this.requireAuthOnAccess && tableMeta && tableMeta.requireAuthOnAccess !== true) {
      throw new StorageError(
        `Table '${tableName}' is not bound to the strict access-authentication key scope`,
        'MIGRATION_FAILED',
        {
          details:
            'Switching an existing table between normal and strict encryption requires an explicit data migration.',
          suggestion: 'Migrate the table with an application-controlled flow before enabling requireAuthOnAccess.',
          tableName,
        }
      );
    }
  }

  private fullTableCacheKey(tableName: string): string {
    return `__enc_full_table_${tableName}`;
  }

  private cloneRecords(data: StorageRecord[]): StorageRecord[] {
    const cloned: unknown = JSON.parse(JSON.stringify(data));
    if (!Array.isArray(cloned) || !cloned.every(isStorageRecord)) {
      throw new StorageError('Encrypted records could not be cloned safely', 'FILE_CONTENT_INVALID');
    }
    return cloned;
  }

  private parseEncryptedRecords(serializedData: string): StorageRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedData);
    } catch (cause) {
      throw new StorageError('Encrypted data could not be parsed', 'FILE_CONTENT_INVALID', { cause });
    }

    const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (!records.every(isStorageRecord)) {
      throw new StorageError('Encrypted data has an invalid record structure', 'FILE_CONTENT_INVALID');
    }
    return records;
  }

  private getCachedFullTableData(tableName: string, sourceCiphertext: string): StorageRecord[] | undefined {
    if (this.cacheTimeout <= 0) {
      return undefined;
    }

    const entry = this.fullTableCache.get(this.fullTableCacheKey(tableName));
    if (!entry || entry.sourceCiphertext !== sourceCiphertext || Date.now() - entry.timestamp >= this.cacheTimeout) {
      return undefined;
    }

    return this.cloneRecords(entry.data);
  }

  private cacheFullTableData(tableName: string, data: StorageRecord[], sourceCiphertext: string): void {
    if (this.cacheTimeout <= 0) {
      return;
    }

    this.fullTableCache.set(this.fullTableCacheKey(tableName), {
      data: this.cloneRecords(data),
      timestamp: Date.now(),
      sourceCiphertext,
    });
    this.manageCacheSize();
  }

  private clearTableCache(tableName: string): void {
    this.fullTableCache.delete(this.fullTableCacheKey(tableName));
  }

  private resolveConfiguredEncryptedFields(tableMeta: TableSchema | undefined, config: LiteStoreConfig): string[] {
    if (tableMeta?.encrypted === true) {
      if (tableMeta.encryptAllFields === true) {
        return [];
      }
      const persistedFields = tableMeta.encryptedFields;
      if (persistedFields && persistedFields.length > 0) {
        return persistedFields;
      }
    }

    // v3 metadata had no all-fields marker. Empty or missing fields therefore
    // retain the legacy global-config fallback instead of reinterpreting plain strings.
    return config.encryption.encryptedFields || [];
  }

  private resolveAllRecordFields(data: Record<string, unknown>[]): string[] {
    const fields = new Set<string>();
    for (const item of data) {
      Object.keys(item).forEach(field => fields.add(field));
    }
    return [...fields];
  }

  private resolveImplicitFieldEncryptionPolicy(
    options: Omit<WriteOptions, 'mode'> | WriteOptions | undefined,
    config: LiteStoreConfig
  ): ResolvedFieldEncryptionPolicy {
    const encrypted = this.requireAuthOnAccess || options?.encrypted === true || options?.encryptFullTable === true;
    if (!encrypted || options?.encryptFullTable === true) {
      return { encryptedFields: [], encryptAllFields: false };
    }

    const configuredFields = config.encryption.encryptedFields ?? [];
    return configuredFields.length > 0
      ? { encryptedFields: [...new Set(configuredFields)], encryptAllFields: false }
      : { encryptedFields: [], encryptAllFields: true };
  }

  private resolveFieldsForWrite(
    data: Record<string, unknown>[],
    tableMeta: TableSchema | undefined,
    config: LiteStoreConfig,
    implicitFieldPolicy?: ResolvedFieldEncryptionPolicy
  ): string[] {
    if (!tableMeta && implicitFieldPolicy) {
      return implicitFieldPolicy.encryptAllFields
        ? this.resolveAllRecordFields(data)
        : implicitFieldPolicy.encryptedFields;
    }

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

  clearAllCache(): void {
    this.fullTableCache.clear();
  }

  private manageCacheSize(): void {
    if (this.fullTableCache.size > this.maxCacheSize) {
      const entries = Array.from(this.fullTableCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.fullTableCache.size - this.maxCacheSize);
      toRemove.forEach(([cacheKey]) => {
        this.fullTableCache.delete(cacheKey);
      });
    }
  }

  async createTable<T extends object = StorageRecord>(
    tableName: string,
    options?: CreateTableOptions<T> & {
      enableFieldLevelEncryption?: boolean;
    }
  ): Promise<void> {
    const accessKey = await this.ensureAccessAuthorized();
    const { initialData = [], ...tableOptions } = options ?? {};
    const normalizedInitialData = this.normalizeStorageInput(initialData);

    if (options?.requireAuthOnAccess === true && !this.requireAuthOnAccess) {
      throw new StorageError(`Table '${tableName}' requires a strict encrypted storage adapter`, 'PERMISSION_DENIED', {
        details: 'requireAuthOnAccess must be selected when the encrypted adapter is created.',
        suggestion: 'Create the adapter with requireAuthOnAccess: true before creating the table.',
        tableName,
      });
    }

    const alreadyExists = await storage.hasTable(tableName, this.withTransactionOwner());
    if (alreadyExists) {
      const tableMeta = await this.getTableMeta(tableName);
      if (tableMeta) {
        this.assertExistingCreateTablePolicy(tableName, tableMeta, options);
      }
      return;
    }

    const encryptionPolicy = this.getExplicitCreateTablePolicy(tableOptions, configManager.getConfig());

    await storage.createTable<StorageRecord>(
      tableName,
      this.withTransactionOwner({
        ...tableOptions,
        ...encryptionPolicy,
        initialData: [],
      })
    );

    if (normalizedInitialData.length === 0) {
      return;
    }

    try {
      await this.overwriteWithKey(
        tableName,
        normalizedInitialData,
        {
          encrypted: options?.encrypted,
          requireAuthOnAccess: options?.requireAuthOnAccess,
          encryptFullTable: options?.encryptFullTable,
        },
        accessKey ?? (await this.key())
      );
    } catch (error) {
      try {
        await storage.deleteTable(tableName, this.withTransactionOwner());
      } catch (cleanupError) {
        logger.error(`Failed to clean up table ${tableName} after encrypted initialization failed`, cleanupError);
      }
      throw error;
    }
  }

  async deleteTable(tableName: string, _options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    return this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      try {
        return await storage.deleteTable(tableName, this.withTransactionOwner(_options));
      } finally {
        this.clearTableCache(tableName);
      }
    });
  }

  async hasTable(tableName: string, _options?: TableOptions): Promise<boolean> {
    await this.ensureAccessAuthorized();
    const exists = await storage.hasTable(tableName, this.withTransactionOwner(_options));
    if (exists) {
      await this.getTableMeta(tableName);
    }
    return exists;
  }

  async listTables(_options?: TableOptions): Promise<string[]> {
    await this.ensureAccessAuthorized();
    const tableNames = await storage.listTables(this.withTransactionOwner(_options));
    if (
      !this.requireAuthOnAccess &&
      tableNames.some(tableName => storage.getTableMeta(tableName)?.requireAuthOnAccess === true)
    ) {
      throw new StorageError('Listing tables requires strict access authentication', 'PERMISSION_DENIED', {
        details: 'At least one table is bound to the requireAuthOnAccess key scope.',
        suggestion: 'Use an adapter created with requireAuthOnAccess: true.',
      });
    }
    return tableNames;
  }

  async overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return this.overwriteWithKey(tableName, this.normalizeStorageInput(data), options, await this.key());
  }

  private async overwriteWithKey(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.overwriteWithKeyUnlocked(tableName, data, options, key));
  }

  private async overwriteWithKeyUnlocked(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: Omit<WriteOptions, 'mode'> | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(this.normalizeStorageInput(data));

        let encryptedData: StorageRecord[] = [];
        let fullTableCiphertext: string | undefined;
        const config = configManager.getConfig();
        const implicitFieldPolicy = this.resolveImplicitFieldEncryptionPolicy(options, config);
        const tableMeta = await this.getTableMetaForWrite(tableName, options, implicitFieldPolicy);

        const shouldEncryptFullTable = tableMeta?.encryptFullTable === true || options?.encryptFullTable === true;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config, implicitFieldPolicy);

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

          return storage.write(
            tableName,
            encryptedData,
            this.getStorageWriteOptions(options, tableMeta, 'overwrite', implicitFieldPolicy)
          );
        } else {
          if (shouldEncryptFullTable) {
            const serializedData = JSON.stringify(finalData);
            const encrypted = await encrypt(serializedData, key);
            encryptedData = [{ __enc: encrypted }];
            fullTableCiphertext = encrypted;
          }
        }

        const result = await storage.write(
          tableName,
          encryptedData,
          this.getStorageWriteOptions(options, tableMeta, 'overwrite', implicitFieldPolicy, finalData.length)
        );
        const normalizedResult = this.normalizeFullTableWriteResult(result, finalData.length, finalData.length);
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

  async write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.writeWithKey(tableName, this.normalizeStorageInput(data), options, await this.key());
  }

  private async writeWithKey(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return this.withTableWriteLock(tableName, () => this.writeWithKeyUnlocked(tableName, data, options, key));
  }

  private async writeWithKeyUnlocked(
    tableName: string,
    data: StorageInput<StorageRecord>,
    options: WriteOptions | undefined,
    key: string
  ): Promise<WriteResult> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        this.clearTableCache(tableName);

        const finalData = this.cloneRecords(this.normalizeStorageInput(data));

        let encryptedData: StorageRecord[] = [];
        let fullTableTotal: number | undefined;
        let fullTableCacheData: StorageRecord[] | undefined;
        let fullTableCacheCiphertext: string | undefined;
        const config = configManager.getConfig();
        const implicitFieldPolicy = this.resolveImplicitFieldEncryptionPolicy(options, config);
        const tableMeta = await this.getTableMetaForWrite(tableName, options, implicitFieldPolicy);

        // Persisted full-table encryption cannot be downgraded by an individual write.
        const tableEncryptFullTable = tableMeta?.encryptFullTable || false;
        const tableEncrypted = tableMeta?.encrypted || options?.encrypted || false;

        const shouldEncryptFullTable = options?.encryptFullTable === true || tableEncryptFullTable;
        const useFieldLevelEncryption = !shouldEncryptFullTable;

        if (useFieldLevelEncryption) {
          const encryptedFields = this.resolveFieldsForWrite(finalData, tableMeta, config, implicitFieldPolicy);

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
          return storage.write(
            tableName,
            encryptedData,
            this.getStorageWriteOptions(options, tableMeta, undefined, implicitFieldPolicy)
          );
        } else {
          if (shouldEncryptFullTable) {
            if (options?.mode === 'append') {
              // A full-table append must republish one ciphertext for the combined plaintext generation.
              const existingEncrypted = await storage.read(tableName, this.withTransactionOwner({ bypassCache: true }));
              let combinedData = finalData;

              if (existingEncrypted.length > 0) {
                const existingCiphertext = existingEncrypted[0]?.['__enc'];
                if (typeof existingCiphertext !== 'string') {
                  throw new StorageError('Encrypted table envelope is invalid', 'FILE_CONTENT_INVALID');
                }
                const cachedData = this.getCachedFullTableData(tableName, existingCiphertext);
                const existingData = cachedData ?? this.parseEncryptedRecords(await decrypt(existingCiphertext, key));
                combinedData = [...existingData, ...finalData];
              }

              // The cached plaintext must track every append, including a cache
              // hit, otherwise a later append can overwrite an earlier record.
              fullTableCacheData = combinedData;

              const serializedData = JSON.stringify(combinedData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = combinedData.length;
            } else {
              const serializedData = JSON.stringify(finalData);
              const encrypted = await encrypt(serializedData, key);
              encryptedData = [{ __enc: encrypted }];
              fullTableCacheData = finalData;
              fullTableCacheCiphertext = encrypted;
              fullTableTotal = finalData.length;
            }
          } else {
            // An encrypted policy without full-table mode encrypts every record field.
            if (tableEncrypted || options?.encrypted) {
              if (config.encryption.useBulkOperations && finalData.length > 1) {
                encryptedData = await encryptFieldsBulk(finalData, {
                  fields: Object.keys(finalData[0] || {}),
                  masterKey: key,
                });
              } else {
                const encryptionPromises = finalData.map(item =>
                  encryptFields(item, {
                    fields: Object.keys(item),
                    masterKey: key,
                  })
                );
                encryptedData = await Promise.all(encryptionPromises);
              }
            }
          }
        }
        if (encryptedData.length === 0) {
          if (tableEncrypted || options?.encrypted) {
            throw new Error('Encryption logic was not executed for encrypted table');
          }
          encryptedData = finalData;
        }
        const storageMode = fullTableTotal !== undefined ? 'overwrite' : options?.mode;
        const result = await storage.write(
          tableName,
          encryptedData,
          this.getStorageWriteOptions(options, tableMeta, storageMode, implicitFieldPolicy, fullTableTotal)
        );
        if (fullTableTotal !== undefined) {
          const normalizedResult = this.normalizeFullTableWriteResult(result, finalData.length, fullTableTotal);
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

  async read<T extends object = StorageRecord>(tableName: string, options?: ReadOptions<NonInfer<T>>): Promise<T[]> {
    return this.toPublicRecords<T>(
      await this.readWithKey(tableName, this.toStorageReadOptions(options), await this.key())
    );
  }

  private async readWithKey(
    tableName: string,
    options: ReadOptions<StorageRecord> | undefined,
    key: string
  ): Promise<StorageRecord[]> {
    return StorageErrorHandler.handleAsyncError(
      async () => {
        // A zero timeout explicitly disables the ciphertext-bound decrypted cache.
        if (this.cacheTimeout === 0) {
          this.fullTableCache.clear();
        }
        const tableMeta = await this.getTableMeta(tableName);
        const readOptions = options ? { bypassCache: options.bypassCache } : undefined;
        const raw = await storage.read<StorageRecord>(tableName, this.withTransactionOwner(readOptions));
        if (raw.length === 0) {
          this.clearTableCache(tableName);
          return [];
        }

        const first = raw[0];
        let result: StorageRecord[] = [];
        const config = configManager.getConfig();
        const encryptedFields = this.resolveFieldsForRead(raw, tableMeta, config);

        const encryptedTablePayload = first?.['__enc'];
        const encryptedBulkPayload = first?.['__enc_bulk'];
        if (encryptedTablePayload !== undefined) {
          if (typeof encryptedTablePayload !== 'string') {
            throw new StorageError('Encrypted table payload is invalid', 'FILE_CONTENT_INVALID');
          }
          const cachedData = this.getCachedFullTableData(tableName, encryptedTablePayload);
          result = cachedData ?? this.parseEncryptedRecords(await decrypt(encryptedTablePayload, key));
          if (!cachedData) {
            this.cacheFullTableData(tableName, result, encryptedTablePayload);
          }
        } else if (encryptedBulkPayload !== undefined) {
          if (!Array.isArray(encryptedBulkPayload) || !encryptedBulkPayload.every(value => typeof value === 'string')) {
            throw new StorageError('Encrypted batch payload is invalid', 'FILE_CONTENT_INVALID');
          }
          const decryptedStrings = await decryptBulk(encryptedBulkPayload, key);
          result = decryptedStrings.map(serializedRecord => {
            const records = this.parseEncryptedRecords(serializedRecord);
            if (records.length !== 1) {
              throw new StorageError('Encrypted batch item must contain one record', 'FILE_CONTENT_INVALID');
            }
            return records[0];
          });
        } else if (encryptedFields.length > 0) {
          if (config.encryption.useBulkOperations && raw.length > 1) {
            result = await decryptFieldsBulk(raw, {
              fields: encryptedFields,
              masterKey: key,
            });
          } else {
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
        // Filtering and sorting must observe decrypted fields rather than encrypted envelopes.
        let visibleRecords = result;
        if (options?.filter) {
          visibleRecords = QueryEngine.filter(visibleRecords, options.filter);
        }
        if (options?.sortBy) {
          visibleRecords = QueryEngine.sort(visibleRecords, options.sortBy, options.order, options.sortAlgorithm);
        }

        return this.cloneRecords(QueryEngine.paginate(visibleRecords, options?.skip, options?.limit));
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
    const data = await this.readWithKey(tableName, undefined, key);
    return data.length;
  }

  /** Reconciles a full-table envelope's logical metadata count with its decrypted row count. */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const key = await this.key();
    const tableMeta = await this.getTableMeta(tableName);
    if (!tableMeta?.encryptFullTable) {
      return storage.verifyCount(tableName, this.withTransactionOwner());
    }

    const metadata = tableMeta.count ?? 0;
    const actual = await this.countWithKey(tableName, key);
    const match = metadata === actual;
    if (!match && !this.isStorageTransactionInProgress()) {
      await storage.setLogicalRecordCount(tableName, actual, this.withTransactionOwner());
    }
    return { metadata, actual, match };
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    options?: TableOptions
  ): Promise<T | null> {
    const storageFilter = this.toStorageFilter(filter);
    const result = await StorageErrorHandler.handleAsyncError(
      async () => {
        const key = await this.key();
        const data = await this.readWithKey(tableName, options, key);
        const filtered = QueryEngine.filter(data, storageFilter);
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
    return this.toPublicRecord<T>(result);
  }

  async findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    findOptions?: TableOptions
  ): Promise<T[]> {
    const key = await this.key();
    const readOptions: ReadOptions<StorageRecord> | undefined = findOptions ? { ...findOptions } : undefined;

    let data = await this.readWithKey(tableName, readOptions, key);
    if (filter) {
      const filtered = QueryEngine.filter(data, this.toStorageFilter(filter));
      data = filtered;
    }

    const storageOptions = this.toStorageFindOptions(options);
    if (storageOptions?.sortBy) {
      data = QueryEngine.sort(data, storageOptions.sortBy, storageOptions.order, storageOptions.sortAlgorithm);
    } else {
      // A stable default order keeps pagination deterministic.
      data = QueryEngine.sort(data, 'id', 'asc', storageOptions?.sortAlgorithm);
    }
    const skip = storageOptions?.skip || 0;
    const limit = storageOptions?.limit;

    if (limit !== undefined) {
      return this.toPublicRecords<T>(this.cloneRecords(data.slice(skip, skip + limit)));
    } else {
      return this.toPublicRecords<T>(this.cloneRecords(data.slice(skip)));
    }
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<T>[],
    options?: TableOptions
  ): Promise<WriteResult> {
    const key = await this.key();
    const normalizedOperations = this.normalizeBulkOperations(operations);
    if (normalizedOperations.length > 0 && normalizedOperations.every(operation => operation.type === 'insert')) {
      const insertItems = normalizedOperations.flatMap(operation =>
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

      for (const operation of normalizedOperations) {
        if (operation.type === 'insert') {
          const insertData = Array.isArray(operation.data) ? operation.data : [operation.data];
          finalData = [...finalData, ...insertData];
          writtenCount += insertData.length;
        } else if (operation.type === 'update') {
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          const matchedItemRefs = new Set(matchedItems);
          finalData = finalData.map(item =>
            matchedItemRefs.has(item) ? QueryEngine.update(item, operation.data) : item
          );
          writtenCount += matchedItems.length;
        } else if (operation.type === 'delete') {
          const matchedItems = QueryEngine.filter(finalData, operation.where);
          const matchedItemRefs = new Set(matchedItems);
          finalData = finalData.filter(item => !matchedItemRefs.has(item));
          writtenCount += matchedItems.length;
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
      await storage.migrateToChunked(tableName, this.withTransactionOwner());
      this.clearTableCache(tableName);
    });
  }

  async delete<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    const key = await this.key();
    const storageWhere = this.toStorageFilter(where);
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const matchedItemRefs = new Set(matchedItems);
      const remainingData = allData.filter(item => !matchedItemRefs.has(item));

      await this.writeWithKeyUnlocked(tableName, remainingData, { ...options, mode: 'overwrite' }, key);
      return matchedItems.length;
    });
  }

  async beginTransaction(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    await storage.beginTransaction(this.withTransactionOwner(options));
  }

  async commit(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    try {
      await storage.commit(this.withTransactionOwner(options));
    } finally {
      if (!storage.isInTransaction()) {
        this.clearAllCache();
      }
    }
  }

  async rollback(options?: TableOptions): Promise<void> {
    await this.ensureAccessAuthorized();
    try {
      await storage.rollback(this.withTransactionOwner(options));
    } finally {
      if (!storage.isInTransaction()) {
        this.clearAllCache();
      }
    }
  }

  async update<T extends object = StorageRecord>(
    tableName: string,
    data: UpdatePayload<T>,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    const key = await this.key();
    const storageData = this.normalizeStorageRecord(data);
    const storageWhere = this.toStorageFilter(where);
    return this.withTableWriteLock(tableName, async () => {
      this.clearTableCache(tableName);
      const allData = await this.readWithKey(tableName, options, key);
      const matchedItems = QueryEngine.filter(allData, storageWhere);
      const matchedItemRefs = new Set(matchedItems);
      let updatedCount = 0;
      const updatedData = allData.map(item => {
        if (matchedItemRefs.has(item)) {
          updatedCount++;
          return QueryEngine.update(item, storageData);
        }
        return item;
      });

      await this.writeWithKeyUnlocked(tableName, updatedData, { ...options, mode: 'overwrite' }, key);
      return updatedCount;
    });
  }

  async remove<T extends object = StorageRecord>(
    tableName: string,
    where: FilterCondition<T>,
    options?: TableOptions
  ): Promise<number> {
    return this.delete(tableName, where, options);
  }

  async clearTable(tableName: string): Promise<void> {
    await this.ensureAccessAuthorized();
    await this.withTableWriteLock(tableName, async () => {
      await this.getTableMeta(tableName);
      this.clearTableCache(tableName);
      await storage.clearTable(tableName, this.withTransactionOwner());
    });
  }

  async insert<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<T>,
    options?: WriteOptions
  ): Promise<WriteResult> {
    return this.write(tableName, data, { ...options, mode: 'append' });
  }
}
