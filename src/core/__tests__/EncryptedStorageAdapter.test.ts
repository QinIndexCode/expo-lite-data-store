// src/core/__tests__/EncryptedStorageAdapter.test.ts
import { EncryptedStorageAdapter } from '../EncryptedStorageAdapter';
import { MetadataManager } from '../meta/MetadataManager';
import storage, { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import { configManager } from '../config/ConfigManager';
import { resetMasterKey } from '../../utils/crypto';

function failFirstLogicalRecordCountPublication(message: string): () => void {
  const originalSetLogicalRecordCount = FileSystemStorageAdapter.prototype.setLogicalRecordCount;
  let failFirstPublication = true;

  FileSystemStorageAdapter.prototype.setLogicalRecordCount = async function (
    this: FileSystemStorageAdapter,
    tableName: string,
    count: number
  ): Promise<void> {
    if (failFirstPublication) {
      failFirstPublication = false;
      throw new Error(message);
    }
    return originalSetLogicalRecordCount.call(this, tableName, count);
  };

  return () => {
    FileSystemStorageAdapter.prototype.setLogicalRecordCount = originalSetLogicalRecordCount;
  };
}

describe('EncryptedStorageAdapter', () => {
  let adapter: EncryptedStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_encrypted_table';

  beforeEach(async () => {
    configManager.resetConfig();
    metadataManager = new MetadataManager();
    adapter = new EncryptedStorageAdapter();
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    try {
      await adapter.deleteTable(tableName);
    } catch (e) {
      // 忽略删除错误
    }
    if (metadataManager) {
      metadataManager.cleanup();
    }
    configManager.resetConfig();
  });

  describe('基本操作', () => {
    it('应该能够创建和检查表', async () => {
      const hasTable = await adapter.hasTable(tableName);
      expect(hasTable).toBe(true);
    });

    it('应该能够列出所有表', async () => {
      const tables = await adapter.listTables();
      expect(tables).toContain(tableName);
    });
  });

  describe('数据读写', () => {
    it('应该通过加密写入路径持久化 initialData', async () => {
      const initialTable = 'test_encrypted_initial_data';
      const initialData = [{ id: 1, secret: 'plain-secret', visible: 'ok' }];

      try {
        await adapter.createTable(initialTable, {
          encrypted: true,
          encryptedFields: ['secret'],
          initialData,
        });

        const rawData = await storage.read(initialTable, { bypassCache: true });
        expect(rawData[0]?.secret).not.toBe('plain-secret');
        await expect(adapter.read(initialTable, { bypassCache: true })).resolves.toEqual(initialData);
      } finally {
        await adapter.deleteTable(initialTable);
      }
    });

    it('应该在表启用加密且 encryptedFields 为空时加密并解密所有字段', async () => {
      const encryptedAllFieldsTable = 'test_encrypted_all_fields';
      const testData = [{ id: 1, name: 'Alice', age: 25, active: true }];

      try {
        configManager.updateConfig({ encryption: { encryptedFields: [] } });
        await adapter.createTable(encryptedAllFieldsTable, {
          encrypted: true,
          encryptedFields: [],
        });
        await adapter.overwrite(encryptedAllFieldsTable, testData, {
          encrypted: true,
          encryptFullTable: false,
        });

        const rawData = await storage.read(encryptedAllFieldsTable, { bypassCache: true });
        expect(rawData[0]?.id).not.toBe(1);
        expect(rawData[0]?.name).not.toBe('Alice');
        expect(rawData[0]?.age).not.toBe(25);
        expect(rawData[0]?.active).not.toBe(true);

        await expect(adapter.read(encryptedAllFieldsTable, { bypassCache: true })).resolves.toEqual(testData);
      } finally {
        await adapter.deleteTable(encryptedAllFieldsTable);
      }
    });

    it('应该能够写入和读取加密数据', async () => {
      const testData = { id: 1, name: 'Alice', age: 25 };

      await adapter.overwrite(tableName, testData);
      const result = await adapter.read(tableName);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(testData);
    });

    it('应该能够写入和读取加密数据数组', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];

      await adapter.overwrite(tableName, testData);
      const result = await adapter.read(tableName);

      expect(result.length).toBe(3);
      expect(result).toEqual(testData);
    });
  });

  describe('查询操作', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('应该能够通过findOne查找单条数据', async () => {
      const result = await adapter.findOne(tableName, { id: 1 });
      expect(result).toEqual({ id: 1, name: 'Alice', age: 25 });
    });

    it('应该能够通过findMany查找多条数据', async () => {
      const result = await adapter.findMany(tableName, { age: { $gt: 25 } });
      expect(result.length).toBe(2);
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ]);
    });

    it('应该能够通过findMany进行分页', async () => {
      const result = await adapter.findMany(tableName, {}, { skip: 1, limit: 1 });
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 2, name: 'Bob', age: 30 });
    });
  });

  describe('计数操作', () => {
    it('应该能够正确计数表中的数据', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];

      await adapter.overwrite(tableName, testData);
      const count = await adapter.count(tableName);

      expect(count).toBe(2);
    });

    it('整表加密应报告并持久化逻辑记录数，而不是物理密文包数', async () => {
      const fullTable = 'test_full_table_count';
      const testData = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
        { id: 3, secret: 'gamma' },
      ];

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        const result = await adapter.write(fullTable, testData, {
          mode: 'overwrite',
          encrypted: true,
          encryptFullTable: true,
        });

        expect(result).toMatchObject({ written: 3, totalAfterWrite: 3 });
        await expect(storage.read(fullTable, { bypassCache: true })).resolves.toHaveLength(1);
        await expect(adapter.count(fullTable)).resolves.toBe(3);
        await expect(adapter.verifyCount(fullTable)).resolves.toEqual({ metadata: 3, actual: 3, match: true });
      } finally {
        await adapter.deleteTable(fullTable);
      }
    });

    it('整表加密追加时覆盖密文包而不是追加第二个密文包', async () => {
      const fullTable = 'test_full_table_append';

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.insert(fullTable, { id: 1, secret: 'alpha' }, { encrypted: true, encryptFullTable: true });
        await Promise.all([
          adapter.insert(fullTable, { id: 2, secret: 'beta' }, { encrypted: true, encryptFullTable: true }),
          adapter.insert(fullTable, { id: 3, secret: 'gamma' }, { encrypted: true, encryptFullTable: true }),
        ]);
        await adapter.insert(fullTable, { id: 4, secret: 'delta' }, { encrypted: true, encryptFullTable: true });

        await expect(storage.read(fullTable, { bypassCache: true })).resolves.toHaveLength(1);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual(
          expect.arrayContaining([
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
          { id: 3, secret: 'gamma' },
            { id: 4, secret: 'delta' },
          ])
        );
        await expect(adapter.count(fullTable)).resolves.toBe(4);
      } finally {
        await adapter.deleteTable(fullTable);
      }
    });

    it('does not reuse stale full-table plaintext after another adapter writes', async () => {
      const fullTable = 'test_full_table_cache_ciphertext_binding';
      const secondAdapter = new EncryptedStorageAdapter();

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.insert(fullTable, { id: 1, secret: 'first' }, { encrypted: true, encryptFullTable: true });

        await secondAdapter.overwrite(fullTable, [{ id: 2, secret: 'replacement' }]);
        await adapter.insert(fullTable, { id: 3, secret: 'latest' });

        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 2, secret: 'replacement' },
          { id: 3, secret: 'latest' },
        ]);
      } finally {
        await adapter.deleteTable(fullTable);
      }
    });

    it('does not retain caller-owned records in a disabled full-table cache', async () => {
      const fullTable = 'test_full_table_cache_snapshot';
      configManager.updateConfig({ encryption: { cacheTimeout: 0 } });
      const cacheDisabledAdapter = new EncryptedStorageAdapter();
      const firstRecord = { id: 1, secret: 'original' };

      try {
        await cacheDisabledAdapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await cacheDisabledAdapter.insert(fullTable, firstRecord);
        firstRecord.secret = 'mutated-after-write';
        await cacheDisabledAdapter.insert(fullTable, { id: 2, secret: 'second' });

        await expect(cacheDisabledAdapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'original' },
          { id: 2, secret: 'second' },
        ]);
      } finally {
        await cacheDisabledAdapter.deleteTable(fullTable);
      }
    });

    it('keeps an existing full-table encryption policy when overwrite options omit it', async () => {
      const fullTable = 'test_full_table_overwrite_policy';
      const data = [{ id: 1, secret: 'alpha' }];

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(fullTable, data);

        const raw = await storage.read(fullTable, { bypassCache: true });
        expect(raw).toHaveLength(1);
        expect(raw[0]?.__enc).toEqual(expect.any(String));
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual(data);
      } finally {
        await adapter.deleteTable(fullTable);
      }
    });

    it('defers full-table logical record counts until transaction commit', async () => {
      const fullTable = 'test_full_table_transaction_count';

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(fullTable, [{ id: 1, secret: 'alpha' }]);
        expect((storage as any).getTableMeta(fullTable)?.count).toBe(1);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 2, secret: 'beta' });
        expect((storage as any).getTableMeta(fullTable)?.count).toBe(1);
        await adapter.rollback();
        expect((storage as any).getTableMeta(fullTable)?.count).toBe(1);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([{ id: 1, secret: 'alpha' }]);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 2, secret: 'beta' });
        expect((storage as any).getTableMeta(fullTable)?.count).toBe(1);
        await adapter.commit();

        expect((storage as any).getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
        ]);
      } finally {
        if ((storage as any).isInTransaction?.()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
      }
    });

    it('restores a full-table logical count when a transaction commit rolls back after a write failure', async () => {
      const fullTable = 'test_full_table_transaction_count_failure';

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(fullTable, [
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
        ]);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 3, secret: 'gamma' });

        const dataWriter = (storage as any).dataWriter;
        const originalWrite = dataWriter.write.bind(dataWriter);
        let writeCalls = 0;
        const writeSpy = jest.spyOn(dataWriter, 'write').mockImplementation(async (...args: any[]) => {
          writeCalls++;
          if (writeCalls === 1) {
            throw new Error('injected full-table commit failure');
          }
          return originalWrite(...args);
        });

        try {
          await expect(adapter.commit()).rejects.toBeDefined();
        } finally {
          writeSpy.mockRestore();
        }

        expect((storage as any).getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
        ]);
      } finally {
        if ((storage as any).isInTransaction?.()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
      }
    });

    it('restores a full-table write when logical record count publication fails', async () => {
      const fullTable = 'test_full_table_count_publication_failure';
      const originalData = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
      ];

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(fullTable, originalData);

        const restoreLogicalRecordCountPublication = failFirstLogicalRecordCountPublication(
          'injected logical count publication failure'
        );

        try {
          await expect(adapter.overwrite(fullTable, [{ id: 3, secret: 'replacement' }])).rejects.toBeDefined();
        } finally {
          restoreLogicalRecordCountPublication();
        }

        expect((storage as any).getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual(originalData);
      } finally {
        await adapter.deleteTable(fullTable);
      }
    });

    it('restores every transaction table when logical record count publication fails', async () => {
      const fullTable = 'test_full_table_transaction_count_publication_failure';
      const fieldTable = 'test_field_table_transaction_count_publication_failure';
      const originalData = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
      ];
      const originalFieldData = [{ id: 'field-before', secret: 'field-alpha' }];

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.createTable(fieldTable, { encrypted: true, encryptedFields: ['secret'] });
        await adapter.overwrite(fullTable, originalData);
        await adapter.overwrite(fieldTable, originalFieldData);

        await adapter.beginTransaction();
        await adapter.insert(fieldTable, { id: 'field-pending', secret: 'field-beta' });
        await adapter.insert(fullTable, { id: 3, secret: 'gamma' });

        const restoreLogicalRecordCountPublication = failFirstLogicalRecordCountPublication(
          'injected transaction logical count publication failure'
        );

        try {
          await expect(adapter.commit()).rejects.toBeDefined();
        } finally {
          restoreLogicalRecordCountPublication();
        }

        expect((storage as any).isInTransaction?.()).toBe(false);
        expect((storage as any).getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual(originalData);
        await expect(adapter.read(fieldTable, { bypassCache: true })).resolves.toEqual(originalFieldData);
      } finally {
        if ((storage as any).isInTransaction?.()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
        await adapter.deleteTable(fieldTable);
      }
    });
  });

  describe('cache invalidation', () => {
    it('does not retain uncommitted plaintext in query caches after rollback', async () => {
      const committed = [{ id: 'committed', name: 'persisted' }];
      const uncommitted = [{ id: 'uncommitted', name: 'transient' }];
      const cache = adapter as unknown as {
        cachedData: Map<string, unknown>;
        queryIndexes: Map<string, unknown>;
      };

      await adapter.overwrite(tableName, committed);
      await adapter.beginTransaction();
      await adapter.overwrite(tableName, uncommitted);
      await expect(adapter.read(tableName)).resolves.toEqual(uncommitted);
      await expect(adapter.findOne(tableName, { id: 'uncommitted' })).resolves.toEqual(uncommitted[0]);
      expect(cache.cachedData.has(tableName)).toBe(true);
      expect(cache.queryIndexes.has(tableName)).toBe(true);

      await adapter.rollback();

      expect(cache.cachedData.has(tableName)).toBe(false);
      expect(cache.queryIndexes.has(tableName)).toBe(false);
      await expect(adapter.findOne(tableName, { id: 'uncommitted' })).resolves.toBeNull();
      await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual(committed);
    });

    it('does not serve cached plaintext after resetting the master key', async () => {
      const resetTable = 'test_master_key_reset_cache';
      const cache = adapter as unknown as {
        cachedData: Map<string, unknown>;
        queryIndexes: Map<string, unknown>;
      };

      try {
        await adapter.createTable(resetTable, { encrypted: true, encryptedFields: ['secret'] });
        await adapter.overwrite(resetTable, [{ id: 'old', secret: 'cached-before-reset' }]);
        await expect(adapter.read(resetTable)).resolves.toEqual([{ id: 'old', secret: 'cached-before-reset' }]);
        await expect(adapter.findOne(resetTable, { id: 'old' })).resolves.toEqual({
          id: 'old',
          secret: 'cached-before-reset',
        });
        expect(cache.cachedData.has(resetTable)).toBe(true);
        expect(cache.queryIndexes.has(resetTable)).toBe(true);

        await resetMasterKey();

        await expect(adapter.findOne(resetTable, { id: 'old' })).rejects.toMatchObject({ code: 'TABLE_READ_FAILED' });
        expect(cache.cachedData.has(resetTable)).toBe(false);
        expect(cache.queryIndexes.has(resetTable)).toBe(false);
      } finally {
        await adapter.deleteTable(resetTable).catch(() => undefined);
      }
    });
  });

  describe('访问认证', () => {
    it('retries a strict key read that overlaps a master-key reset', async () => {
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const secureStore = require('expo-secure-store') as any;
      const constants = require('expo-constants');
      const originalGetItemAsync = secureStore.getItemAsync;
      const originalDeleteItemAsync = secureStore.deleteItemAsync;
      const originalAppOwnership = constants.appOwnership;
      let releaseOldRead: () => void = () => undefined;
      const oldReadGate = new Promise<void>(resolve => {
        releaseOldRead = resolve;
      });
      let signalOldReadStarted: () => void = () => undefined;
      const oldReadStarted = new Promise<void>(resolve => {
        signalOldReadStarted = resolve;
      });
      let strictReadCount = 0;

      constants.appOwnership = 'standalone';
      secureStore.getItemAsync = jest.fn(async (key: string) => {
        if (key !== 'expo_litedb_master_key_auth_v2026') {
          return null;
        }

        strictReadCount++;
        if (strictReadCount === 1) {
          signalOldReadStarted();
          await oldReadGate;
          return 'old-key';
        }
        return 'new-key';
      });
      secureStore.deleteItemAsync = jest.fn(async () => undefined);

      try {
        const keyPromise = (authAdapter as any).getOrInitKey() as Promise<string>;
        await oldReadStarted;
        await resetMasterKey();
        releaseOldRead();

        await expect(keyPromise).resolves.toBe('new-key');
        expect(strictReadCount).toBe(2);
      } finally {
        releaseOldRead();
        secureStore.getItemAsync = originalGetItemAsync;
        secureStore.deleteItemAsync = originalDeleteItemAsync;
        constants.appOwnership = originalAppOwnership;
      }
    });

    it('在一次加密操作内复用 requireAuthOnAccess 的已授权密钥', async () => {
      const authTable = 'test_auth_single_key_per_operation';
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const keySpy = jest.spyOn(authAdapter as any, 'key').mockResolvedValue('authorized-test-key');
      const records = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
      ];
      const expectSingleKeyAccess = async (operation: () => Promise<unknown>) => {
        keySpy.mockClear();
        await operation();
        expect(keySpy).toHaveBeenCalledTimes(1);
      };

      try {
        await expectSingleKeyAccess(() => authAdapter.createTable(authTable, { encrypted: true, encryptFullTable: true }));
        await expectSingleKeyAccess(() => authAdapter.write(authTable, records, { mode: 'overwrite' }));
        await expectSingleKeyAccess(() => authAdapter.read(authTable, { bypassCache: true }));
        await expectSingleKeyAccess(() => authAdapter.count(authTable));
        await expectSingleKeyAccess(() => authAdapter.verifyCount(authTable));
        await expectSingleKeyAccess(() => authAdapter.findOne(authTable, { id: 1 }));
        await expectSingleKeyAccess(() => authAdapter.findMany(authTable, { id: 1 }));
        await expectSingleKeyAccess(() => authAdapter.update(authTable, { secret: 'updated' }, { id: 1 }));
        await expectSingleKeyAccess(() =>
          authAdapter.bulkWrite(authTable, [
            { type: 'update', data: { secret: 'bulk-updated' }, where: { id: 2 } },
            { type: 'insert', data: { id: 3, secret: 'gamma' } },
          ])
        );
        await expectSingleKeyAccess(() => authAdapter.delete(authTable, { id: 3 }));
        await expectSingleKeyAccess(() => authAdapter.remove(authTable, { id: 2 }));
      } finally {
        keySpy.mockRestore();
        try {
          await storage.deleteTable(authTable);
        } catch {
          // The table may not have been created if setup failed.
        }
      }
    });

    it('在直接表操作前验证 requireAuthOnAccess 访问权限', async () => {
      const authTable = 'test_auth_guard_table';
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const keySpy = jest.spyOn(authAdapter as any, 'key').mockResolvedValue('authorized-test-key');

      try {
        await authAdapter.createTable(authTable);
        expect(keySpy).toHaveBeenCalled();

        keySpy.mockClear();
        await authAdapter.clearTable(authTable);
        expect(keySpy).toHaveBeenCalled();

        keySpy.mockClear();
        await authAdapter.migrateToChunked(authTable);
        expect(keySpy).toHaveBeenCalled();

        keySpy.mockClear();
        await authAdapter.deleteTable(authTable);
        expect(keySpy).toHaveBeenCalled();
      } finally {
        keySpy.mockRestore();
        try {
          await storage.deleteTable(authTable);
        } catch {
          // The assertion path may already have deleted the table.
        }
      }
    });

    it('rejects a normal encrypted adapter attempting to access a strict table', async () => {
      const strictTable = 'test_strict_table_rejects_normal_adapter';
      const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const strictKeySpy = jest.spyOn(strictAdapter as any, 'key').mockResolvedValue('strict-test-key');
      const normalAdapter = new EncryptedStorageAdapter();

      try {
        await strictAdapter.createTable(strictTable, { encrypted: true });

        expect((storage as any).getTableMeta(strictTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: true,
        });
        await expect(normalAdapter.deleteTable(strictTable)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
      } finally {
        strictKeySpy.mockRestore();
        await storage.deleteTable(strictTable).catch(() => undefined);
      }
    });

    it('rejects a strict encrypted adapter attempting to access a normal table', async () => {
      const normalTable = 'test_normal_table_rejects_strict_adapter';
      const normalAdapter = new EncryptedStorageAdapter();
      const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const strictKeySpy = jest.spyOn(strictAdapter as any, 'key').mockResolvedValue('strict-test-key');

      try {
        await normalAdapter.createTable(normalTable, { encrypted: true });

        expect((storage as any).getTableMeta(normalTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: false,
        });
        await expect(strictAdapter.deleteTable(normalTable)).rejects.toMatchObject({
          code: 'MIGRATION_FAILED',
        });
      } finally {
        strictKeySpy.mockRestore();
        await storage.deleteTable(normalTable).catch(() => undefined);
      }
    });
  });

  describe('删除操作', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('应该能够根据条件删除数据', async () => {
      const deletedCount = await adapter.delete(tableName, { id: 1 });

      const remainingData = await adapter.read(tableName, { bypassCache: true });

      expect(deletedCount).toBe(1);
      expect(remainingData.length).toBe(2);
      expect(remainingData).not.toContainEqual({ id: 1, name: 'Alice', age: 25 });
    });

    it('remove overwrites encrypted records instead of appending the remaining rows', async () => {
      const removedCount = await adapter.remove(tableName, { id: 1 });

      expect(removedCount).toBe(1);
      await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ]);
    });
  });

  describe('并发写入', () => {
    it('holds the table lock across an update read-modify-write sequence', async () => {
      await adapter.overwrite(tableName, [{ id: 1, name: 'before' }]);
      const originalRead = FileSystemStorageAdapter.prototype.read;
      let releaseRead: () => void = () => undefined;
      const readBlocked = new Promise<void>(resolve => {
        releaseRead = resolve;
      });
      let signalReadStarted: () => void = () => undefined;
      const readStarted = new Promise<void>(resolve => {
        signalReadStarted = resolve;
      });
      let blockNextRead = true;
      FileSystemStorageAdapter.prototype.read = async function (
        this: FileSystemStorageAdapter,
        currentTableName: string,
        readOptions?: any
      ) {
        const records = await originalRead.call(this, currentTableName, readOptions);
        if (blockNextRead && currentTableName === tableName) {
          blockNextRead = false;
          signalReadStarted();
          await readBlocked;
        }
        return records;
      };

      try {
        const updatePromise = adapter.update(tableName, { name: 'updated' }, { id: 1 });
        await readStarted;
        expect((EncryptedStorageAdapter as any).tableWriteLocks.has(tableName)).toBe(true);

        const insertPromise = adapter.insert(tableName, { id: 2, name: 'inserted' });
        releaseRead();
        await Promise.all([updatePromise, insertPromise]);

        await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual([
          { id: 1, name: 'updated' },
          { id: 2, name: 'inserted' },
        ]);
      } finally {
        releaseRead();
        FileSystemStorageAdapter.prototype.read = originalRead;
      }
    });
  });

  describe('批量操作', () => {
    it('应该能够执行批量插入操作', async () => {
      const operations = [
        { type: 'insert' as const, data: { id: 1, name: 'Alice' } },
        { type: 'insert' as const, data: { id: 2, name: 'Bob' } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      const allData = await adapter.read(tableName, { bypassCache: true });

      expect(result.written).toBe(2);
      expect(allData.length).toBe(2);
    });

    it('应该能够执行批量更新操作', async () => {
      // 先插入初始数据
      const initialData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];
      await adapter.overwrite(tableName, initialData);

      const operations = [
        { type: 'update' as const, data: { age: 26 }, where: { id: 1 } },
        { type: 'update' as const, data: { age: 31 }, where: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      const updatedData = await adapter.read(tableName, { bypassCache: true });

      expect(result.written).toBe(2);
      expect(updatedData[0]?.['age']).toBe(26);
      expect(updatedData[1]?.['age']).toBe(31);
    });

    it('应该能够执行批量删除操作', async () => {
      // 先插入初始数据
      const initialData = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];
      await adapter.overwrite(tableName, initialData);

      const operations = [
        { type: 'delete' as const, where: { id: 1 } },
        { type: 'delete' as const, where: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      const remainingData = await adapter.read(tableName, { bypassCache: true });

      expect(result.written).toBe(2);
      expect(remainingData.length).toBe(1);
      expect(remainingData[0]?.['id']).toBe(3);
    });
  });

  describe('模式迁移', () => {
    it('应该能够迁移到分片模式', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];

      await adapter.overwrite(tableName, testData);
      await adapter.migrateToChunked(tableName);

      const migratedData = await adapter.read(tableName);

      expect(migratedData).toEqual(testData);
    });

    it('迁移时保留加密与列元数据并避免明文重写窗口', async () => {
      const testData = [
        { id: 1, secret: 'alpha', visible: 'one' },
        { id: 2, secret: 'beta', visible: 'two' },
      ];
      await adapter.deleteTable(tableName);
      await adapter.createTable(tableName, {
        encrypted: true,
        encryptedFields: ['secret'],
        columns: { id: 'number', secret: 'string', visible: 'string' },
        initialData: testData,
      });

      const rawBeforeMigration = await storage.read(tableName, { bypassCache: true });
      expect(rawBeforeMigration[0]?.secret).not.toBe('alpha');

      await adapter.migrateToChunked(tableName);

      await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual(testData);
      const rawAfterMigration = await storage.read(tableName, { bypassCache: true });
      expect(rawAfterMigration[0]?.secret).toBe(rawBeforeMigration[0]?.secret);
      expect((storage as any).getTableMeta(tableName)).toMatchObject({
        mode: 'chunked',
        encrypted: true,
        encryptedFields: ['secret'],
        columns: { id: 'number', secret: 'string', visible: 'string' },
      });
    });
  });
});
