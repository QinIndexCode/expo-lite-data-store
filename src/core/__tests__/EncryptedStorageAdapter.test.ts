import { EncryptedStorageAdapter } from '../EncryptedStorageAdapter';
import { MetadataManager } from '../meta/MetadataManager';
import storage, { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import { configManager } from '../config/ConfigManager';
import { DataWriter } from '../data/DataWriter';
import { resetMasterKey } from '../../utils/crypto';
import type { ReadOptions, StorageRecord } from '../../types/storageTypes';

type EncryptedAdapterPrivateAccess = {
  getOrInitKey: () => Promise<string>;
  key: () => Promise<string>;
};

type StoragePrivateAccess = {
  dataWriter: DataWriter;
  metadataManager: MetadataManager;
};

type EncryptedAdapterStaticAccess = {
  tableWriteLocks: Map<string, Promise<void>>;
};

type SecureStoreOptions = {
  authenticationPrompt?: string;
  requireAuthentication?: boolean;
};

type SecureStoreMock = {
  deleteItemAsync: (key: string, options?: SecureStoreOptions) => Promise<void>;
  getItemAsync: (key: string, options?: SecureStoreOptions) => Promise<string | null>;
};

type ExpoConstantsMock = {
  appOwnership: string | null | undefined;
};

const getEncryptedAdapterPrivateAccess = (adapter: EncryptedStorageAdapter): EncryptedAdapterPrivateAccess =>
  adapter as unknown as EncryptedAdapterPrivateAccess;

const getEncryptedAdapterStaticAccess = (): EncryptedAdapterStaticAccess =>
  EncryptedStorageAdapter as unknown as EncryptedAdapterStaticAccess;

const getSecureStoreMock = (): SecureStoreMock => require('expo-secure-store') as SecureStoreMock;

const getStoragePrivateAccess = (adapter: FileSystemStorageAdapter): StoragePrivateAccess =>
  adapter as unknown as StoragePrivateAccess;

const deleteTableIfPresent = async (tableName: string): Promise<void> => {
  if (await storage.hasTable(tableName)) {
    await storage.deleteTable(tableName);
  }
};

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
    if (await adapter.hasTable(tableName)) {
      await adapter.deleteTable(tableName);
    }
    if (metadataManager) {
      metadataManager.cleanup();
    }
    configManager.resetConfig();
  });

  describe('basic operations', () => {
    it('creates and checks encrypted tables', async () => {
      const hasTable = await adapter.hasTable(tableName);
      expect(hasTable).toBe(true);
    });

    it('lists encrypted tables', async () => {
      const tables = await adapter.listTables();
      expect(tables).toContain(tableName);
    });
  });

  describe('persisted encryption policy', () => {
    it('persists full-table encryption when a write creates the table implicitly', async () => {
      const autoTable = 'test_auto_created_full_table_policy';

      try {
        await adapter.write(autoTable, { id: 1, secret: 'classified' }, { mode: 'append', encryptFullTable: true });

        expect(storage.getTableMeta(autoTable)).toMatchObject({
          encrypted: true,
          encryptFullTable: true,
          requireAuthOnAccess: false,
        });
        expect(storage.getTableMeta(autoTable)?.encryptAllFields).toBeUndefined();
        const raw = await storage.read(autoTable, { bypassCache: true });
        expect(raw).toHaveLength(1);
        expect(raw[0]?.__enc).toEqual(expect.any(String));
        await expect(adapter.read(autoTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'classified' },
        ]);
      } finally {
        await deleteTableIfPresent(autoTable);
      }
    });

    it('persists the field policy used by an implicitly created encrypted table', async () => {
      const autoTable = 'test_auto_created_field_policy';
      configManager.updateConfig({ encryption: { encryptedFields: ['secret', 'secret'] } });

      try {
        await adapter.write(
          autoTable,
          { id: 1, secret: 'classified', visible: 'plain' },
          { mode: 'append', encrypted: true }
        );

        expect(storage.getTableMeta(autoTable)).toMatchObject({
          encrypted: true,
          encryptFullTable: false,
          encryptedFields: ['secret'],
        });
        expect(storage.getTableMeta(autoTable)?.encryptAllFields).toBeUndefined();
        const raw = await storage.read(autoTable, { bypassCache: true });
        expect(raw[0]?.secret).not.toBe('classified');
        expect(raw[0]?.visible).toBe('plain');
        await expect(adapter.read(autoTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'classified', visible: 'plain' },
        ]);
      } finally {
        await deleteTableIfPresent(autoTable);
      }
    });

    it('keeps dynamic all-field encryption when initial data has a different shape from later records', async () => {
      const policyTable = 'test_explicit_dynamic_fields_with_initial_data';
      const initialRecord = { id: 1, initialField: 'initial' };
      const laterRecord = { id: 2, laterField: 'later' };
      configManager.updateConfig({ encryption: { encryptedFields: [] } });

      try {
        await adapter.createTable(policyTable, { encrypted: true, initialData: [initialRecord] });
        await adapter.insert(policyTable, laterRecord, { encrypted: true });

        expect(storage.getTableMeta(policyTable)).toMatchObject({
          encrypted: true,
          encryptFullTable: false,
          encryptedFields: [],
          encryptAllFields: true,
        });
        const raw = await storage.read(policyTable, { bypassCache: true });
        expect(raw[0]?.id).not.toBe(initialRecord.id);
        expect(raw[0]?.initialField).not.toBe(initialRecord.initialField);
        expect(raw[1]?.id).not.toBe(laterRecord.id);
        expect(raw[1]?.laterField).not.toBe(laterRecord.laterField);
        await expect(adapter.read(policyTable, { bypassCache: true })).resolves.toEqual([initialRecord, laterRecord]);
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('keeps dynamic all-field encryption when an explicitly empty table receives new record shapes', async () => {
      const policyTable = 'test_explicit_dynamic_fields_without_initial_data';
      const firstRecord = { id: 1, firstField: 'first' };
      const secondRecord = { id: 2, secondField: 'second' };
      configManager.updateConfig({ encryption: { encryptedFields: [] } });

      try {
        await adapter.createTable(policyTable, { encrypted: true });
        await adapter.insert(policyTable, firstRecord, { encrypted: true });
        await adapter.insert(policyTable, secondRecord, { encrypted: true });

        expect(storage.getTableMeta(policyTable)).toMatchObject({
          encrypted: true,
          encryptedFields: [],
          encryptAllFields: true,
        });
        const raw = await storage.read(policyTable, { bypassCache: true });
        expect(raw[0]?.firstField).not.toBe(firstRecord.firstField);
        expect(raw[1]?.secondField).not.toBe(secondRecord.secondField);
        await expect(adapter.read(policyTable, { bypassCache: true })).resolves.toEqual([firstRecord, secondRecord]);
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('keeps dynamic all-field encryption when writes implicitly create a table with changing shapes', async () => {
      const policyTable = 'test_implicit_dynamic_fields';
      const firstRecord = { id: 1, firstField: 'first' };
      const secondRecord = { id: 2, secondField: 'second' };
      configManager.updateConfig({ encryption: { encryptedFields: [] } });

      try {
        await adapter.insert(policyTable, firstRecord, { encrypted: true });
        await adapter.insert(policyTable, secondRecord, { encrypted: true });

        expect(storage.getTableMeta(policyTable)).toMatchObject({
          encrypted: true,
          encryptedFields: [],
          encryptAllFields: true,
        });
        const raw = await storage.read(policyTable, { bypassCache: true });
        expect(raw[0]?.firstField).not.toBe(firstRecord.firstField);
        expect(raw[1]?.secondField).not.toBe(secondRecord.secondField);
        await expect(adapter.read(policyTable, { bypassCache: true })).resolves.toEqual([firstRecord, secondRecord]);
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('keeps dynamic all-field encryption across transactional writes with changing shapes', async () => {
      const policyTable = 'test_transaction_dynamic_fields';
      const firstRecord = { id: 1, firstField: 'first' };
      const secondRecord = { id: 2, secondField: 'second' };
      configManager.updateConfig({ encryption: { encryptedFields: [] } });

      try {
        await adapter.beginTransaction();
        await adapter.insert(policyTable, firstRecord, { encrypted: true });
        await adapter.insert(policyTable, secondRecord, { encrypted: true });
        await adapter.commit();

        expect(storage.getTableMeta(policyTable)).toMatchObject({
          encrypted: true,
          encryptedFields: [],
          encryptAllFields: true,
        });
        const raw = await storage.read(policyTable, { bypassCache: true });
        expect(raw[0]?.firstField).not.toBe(firstRecord.firstField);
        expect(raw[1]?.secondField).not.toBe(secondRecord.secondField);
        await expect(adapter.read(policyTable, { bypassCache: true })).resolves.toEqual([firstRecord, secondRecord]);
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await deleteTableIfPresent(policyTable);
      }
    });

    it.each([
      { metadataShape: 'an empty field list', tableName: 'test_legacy_empty_fields', encryptedFields: [] as string[] },
      { metadataShape: 'a missing field list', tableName: 'test_legacy_missing_fields', encryptedFields: undefined },
    ])(
      'uses the global field fallback for legacy metadata with $metadataShape',
      async ({ tableName: legacyTable, encryptedFields }) => {
        const record = { id: 1, secret: 'ciphertext-only', visible: 'plain-string' };
        configManager.updateConfig({ encryption: { encryptedFields: ['secret'] } });

        try {
          await adapter.createTable(legacyTable, { encrypted: true, encryptedFields: ['secret'] });
          await adapter.overwrite(legacyTable, [record], { encrypted: true });
          const raw = await storage.read(legacyTable, { bypassCache: true });
          expect(raw[0]?.secret).not.toBe(record.secret);
          expect(raw[0]?.visible).toBe(record.visible);

          const storageMetadata = getStoragePrivateAccess(storage).metadataManager;
          storageMetadata.update(legacyTable, { encryptedFields, encryptAllFields: undefined });
          await storageMetadata.saveImmediately();
          await storageMetadata.reload();

          expect(storage.getTableMeta(legacyTable)?.encryptAllFields).toBeUndefined();
          const reopenedAdapter = new EncryptedStorageAdapter();
          await expect(reopenedAdapter.read(legacyTable, { bypassCache: true })).resolves.toEqual([record]);
          await expect(
            reopenedAdapter.createTable(legacyTable, { encrypted: true, encryptedFields: [] })
          ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
        } finally {
          await deleteTableIfPresent(legacyTable);
        }
      }
    );

    it('keeps the configured field policy captured by explicit table creation', async () => {
      const policyTable = 'test_explicit_configured_field_policy';
      const initialData = [{ id: 1, secret: 'classified', visible: 'plain' }];
      configManager.updateConfig({ encryption: { encryptedFields: ['secret'] } });

      try {
        await adapter.createTable(policyTable, { encrypted: true, initialData });

        expect(storage.getTableMeta(policyTable)).toMatchObject({
          encrypted: true,
          encryptFullTable: false,
          encryptedFields: ['secret'],
        });
        expect(storage.getTableMeta(policyTable)?.encryptAllFields).toBeUndefined();
        configManager.updateConfig({ encryption: { encryptedFields: ['visible'] } });
        const reopenedAdapter = new EncryptedStorageAdapter();

        await expect(reopenedAdapter.read(policyTable, { bypassCache: true })).resolves.toEqual(initialData);
        const raw = await storage.read(policyTable, { bypassCache: true });
        expect(raw[0]?.secret).not.toBe('classified');
        expect(raw[0]?.visible).toBe('plain');
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('rejects encryption mode changes on an existing table', async () => {
      const policyTable = 'test_existing_encryption_policy';

      try {
        await adapter.createTable(policyTable, {
          encrypted: true,
          encryptedFields: ['secret'],
        });

        await expect(
          adapter.write(
            policyTable,
            { id: 1, secret: 'classified' },
            { mode: 'append', encrypted: true, encryptFullTable: true }
          )
        ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
        await expect(
          adapter.createTable(policyTable, {
            encrypted: true,
            encryptedFields: ['differentField'],
          })
        ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('rejects per-write authentication changes on an existing table', async () => {
      const policyTable = 'test_existing_authentication_policy';

      try {
        await adapter.createTable(policyTable, { encrypted: true });

        await expect(
          adapter.write(
            policyTable,
            { id: 1, secret: 'classified' },
            { mode: 'append', encrypted: true, requireAuthOnAccess: true }
          )
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      } finally {
        await deleteTableIfPresent(policyTable);
      }
    });

    it('rejects strict access requests without leaving an implicitly created table', async () => {
      const policyTable = 'test_rejected_implicit_strict_policy';

      await expect(
        adapter.write(
          policyTable,
          { id: 1, secret: 'classified' },
          { mode: 'append', encrypted: true, requireAuthOnAccess: true }
        )
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(storage.hasTable(policyTable)).resolves.toBe(false);
    });

    it('rejects contradictory persisted encryption metadata when opening a table', async () => {
      const policyTable = 'test_inconsistent_persisted_encryption_policy';

      try {
        await storage.createTable(policyTable);
        getStoragePrivateAccess(storage).metadataManager.update(policyTable, {
          encrypted: false,
          encryptFullTable: true,
        });

        await expect(adapter.read(policyTable, { bypassCache: true })).rejects.toMatchObject({
          code: 'MIGRATION_FAILED',
        });
      } finally {
        await storage.deleteTable(policyTable);
      }
    });

    it.each([
      {
        encryptionMode: 'field-level',
        tableName: 'test_implicit_strict_field_transaction',
        writeOptions: { encrypted: true },
        encryptFullTable: false,
      },
      {
        encryptionMode: 'full-table',
        tableName: 'test_implicit_strict_full_transaction',
        writeOptions: { encrypted: true, encryptFullTable: true },
        encryptFullTable: true,
      },
    ])(
      'persists strict $encryptionMode policy when a transaction creates a table implicitly',
      async ({ tableName: strictTable, writeOptions, encryptFullTable }) => {
        const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
        const strictKeySpy = jest
          .spyOn(getEncryptedAdapterPrivateAccess(strictAdapter), 'key')
          .mockResolvedValue('strict-transaction-test-key');
        const normalAdapter = new EncryptedStorageAdapter();

        try {
          await strictAdapter.beginTransaction();
          await strictAdapter.insert(strictTable, { id: 1, secret: 'classified' }, writeOptions);
          await strictAdapter.commit();

          expect(storage.getTableMeta(strictTable)).toMatchObject({
            encrypted: true,
            encryptFullTable,
            requireAuthOnAccess: true,
          });
          await expect(normalAdapter.read(strictTable, { bypassCache: true })).rejects.toMatchObject({
            code: 'PERMISSION_DENIED',
          });
        } finally {
          if (storage.isInTransaction()) {
            await strictAdapter.rollback();
          }
          if (await storage.hasTable(strictTable)) {
            await strictAdapter.deleteTable(strictTable);
          }
          strictKeySpy.mockRestore();
        }
      }
    );
  });

  describe('encrypted reads and writes', () => {
    it('persists initial data through the encrypted write path', async () => {
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

    it('encrypts and decrypts all fields when encrypted fields are unspecified', async () => {
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
        expect(storage.getTableMeta(encryptedAllFieldsTable)).toMatchObject({
          encryptedFields: [],
          encryptAllFields: true,
        });

        configManager.updateConfig({ encryption: { encryptedFields: ['name'] } });
        const reopenedAdapter = new EncryptedStorageAdapter();

        await expect(reopenedAdapter.read(encryptedAllFieldsTable, { bypassCache: true })).resolves.toEqual(testData);
      } finally {
        await adapter.deleteTable(encryptedAllFieldsTable);
      }
    });

    it('writes and reads an encrypted record', async () => {
      const testData = { id: 1, name: 'Alice', age: 25 };

      await adapter.overwrite(tableName, testData);
      const result = await adapter.read(tableName);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(testData);
    });

    it('writes and reads an encrypted record array', async () => {
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

    it('applies read options after decrypting field-encrypted records', async () => {
      const encryptedTable = 'test_encrypted_read_options';
      type EncryptedRecord = { id: number; category: string; secret: string };

      try {
        await adapter.createTable(encryptedTable, { encrypted: true, encryptedFields: ['secret'] });
        await adapter.overwrite(encryptedTable, [
          { id: 1, category: 'primary', secret: 'first' },
          { id: 2, category: 'secondary', secret: 'ignored' },
          { id: 3, category: 'primary', secret: 'latest' },
        ]);

        await expect(
          adapter.read<EncryptedRecord>(encryptedTable, {
            filter: { category: 'primary' },
            sortBy: 'id',
            order: 'desc',
            limit: 1,
            bypassCache: true,
          })
        ).resolves.toEqual([{ id: 3, category: 'primary', secret: 'latest' }]);
      } finally {
        await deleteTableIfPresent(encryptedTable);
      }
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('finds one encrypted record', async () => {
      const result = await adapter.findOne(tableName, { id: 1 });
      expect(result).toEqual({ id: 1, name: 'Alice', age: 25 });
    });

    it('finds multiple encrypted records', async () => {
      const result = await adapter.findMany(tableName, { age: { $gt: 25 } });
      expect(result.length).toBe(2);
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ]);
    });

    it('paginates encrypted records', async () => {
      const result = await adapter.findMany(tableName, {}, { skip: 1, limit: 1 });
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 2, name: 'Bob', age: 30 });
    });
  });

  describe('counts', () => {
    it('counts records in an encrypted table', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];

      await adapter.overwrite(tableName, testData);
      const count = await adapter.count(tableName);

      expect(count).toBe(2);
    });

    it('reports and persists logical record counts for full-table encryption', async () => {
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

    it('overwrites the ciphertext envelope when appending full-table encrypted records', async () => {
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
        expect(storage.getTableMeta(fullTable)?.count).toBe(1);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 2, secret: 'beta' });
        expect(storage.getTableMeta(fullTable)?.count).toBe(1);
        await adapter.rollback();
        expect(storage.getTableMeta(fullTable)?.count).toBe(1);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([{ id: 1, secret: 'alpha' }]);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 2, secret: 'beta' });
        expect(storage.getTableMeta(fullTable)?.count).toBe(1);
        await adapter.commit();

        expect(storage.getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
        ]);
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
      }
    });

    it('publishes an implicitly created encrypted table only after transaction commit', async () => {
      const fullTable = 'test_implicit_encrypted_transaction_rollback';

      await adapter.beginTransaction();
      try {
        await adapter.insert(fullTable, { id: 1, secret: 'pending' }, { encrypted: true, encryptFullTable: true });

        await expect(adapter.hasTable(fullTable)).resolves.toBe(false);
        await adapter.rollback();
        await expect(storage.hasTable(fullTable)).resolves.toBe(false);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 2, secret: 'committed' }, { encrypted: true, encryptFullTable: true });

        await expect(adapter.hasTable(fullTable)).resolves.toBe(false);
        await adapter.commit();

        await expect(storage.hasTable(fullTable)).resolves.toBe(true);
        expect(storage.getTableMeta(fullTable)).toMatchObject({
          count: 1,
          encrypted: true,
          encryptFullTable: true,
        });
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([{ id: 2, secret: 'committed' }]);
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await deleteTableIfPresent(fullTable);
      }
    });

    it('rejects encrypted transaction work from a different adapter instance', async () => {
      const fullTable = 'test_encrypted_transaction_owner';
      const otherAdapter = new EncryptedStorageAdapter();

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.beginTransaction();

        await expect(storage.hasTable(fullTable)).rejects.toMatchObject({ code: 'TRANSACTION_IN_PROGRESS' });
        await expect(otherAdapter.hasTable(fullTable)).rejects.toMatchObject({ code: 'TRANSACTION_IN_PROGRESS' });
        await expect(otherAdapter.insert(fullTable, { id: 1, secret: 'cross-instance' })).rejects.toMatchObject({
          code: 'TRANSACTION_IN_PROGRESS',
        });
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await deleteTableIfPresent(fullTable);
      }
    });

    it('rolls back an implicitly created table when queued writes use conflicting policies', async () => {
      const policyTable = 'test_transaction_implicit_policy_conflict';

      await adapter.beginTransaction();
      try {
        await adapter.overwrite(policyTable, [{ id: 1, secret: 'field' }], { encrypted: true });
        await adapter.overwrite(policyTable, [{ id: 2, secret: 'full' }], { encrypted: true, encryptFullTable: true });

        await expect(adapter.commit()).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
        await expect(storage.hasTable(policyTable)).resolves.toBe(false);
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await deleteTableIfPresent(policyTable);
      }
    });

    it('rejects a cross-instance write whose transaction precheck becomes stale', async () => {
      const raceTable = 'test_encrypted_transaction_owner_race';
      const otherAdapter = new EncryptedStorageAdapter();
      const otherAdapterPrivate = getEncryptedAdapterPrivateAccess(otherAdapter);
      const originalGetOrInitKey = otherAdapterPrivate.getOrInitKey.bind(otherAdapter);
      let signalKeyReadStarted: () => void = () => undefined;
      const keyReadStarted = new Promise<void>(resolve => {
        signalKeyReadStarted = resolve;
      });
      let releaseKeyRead: () => void = () => undefined;
      const keyReadGate = new Promise<void>(resolve => {
        releaseKeyRead = resolve;
      });
      const keySpy = jest.spyOn(otherAdapterPrivate, 'getOrInitKey').mockImplementation(async () => {
        signalKeyReadStarted();
        await keyReadGate;
        return originalGetOrInitKey();
      });

      try {
        await adapter.createTable(raceTable, { encrypted: true, encryptedFields: ['secret'] });

        const competingWrite = otherAdapter.insert(raceTable, { id: 1, secret: 'cross-instance' });
        await keyReadStarted;
        await adapter.beginTransaction();
        releaseKeyRead();

        await expect(competingWrite).rejects.toMatchObject({ code: 'TRANSACTION_IN_PROGRESS' });
        await expect(adapter.read(raceTable, { bypassCache: true })).resolves.toEqual([]);
      } finally {
        releaseKeyRead();
        keySpy.mockRestore();
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await deleteTableIfPresent(raceTable);
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
        await adapter.insert(fullTable, { id: 4, secret: 'delta' });

        const dataWriter = getStoragePrivateAccess(storage).dataWriter;
        const originalWrite = dataWriter.write.bind(dataWriter);
        let writeCalls = 0;
        const writeSpy = jest
          .spyOn(dataWriter, 'write')
          .mockImplementation(async (...args: Parameters<DataWriter['write']>) => {
            writeCalls++;
            if (writeCalls === 2) {
              throw new Error('injected full-table commit failure');
            }
            return originalWrite(...args);
          });

        try {
          await expect(adapter.commit()).rejects.toBeDefined();
        } finally {
          writeSpy.mockRestore();
        }

        expect(storage.getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'alpha' },
          { id: 2, secret: 'beta' },
        ]);
      } finally {
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
      }
    });

    it('publishes a full-table logical count without a second metadata update', async () => {
      const fullTable = 'test_full_table_atomic_count';
      const replacementData = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
      ];
      const countSpy = jest
        .spyOn(FileSystemStorageAdapter.prototype, 'setLogicalRecordCount')
        .mockRejectedValue(new Error('unexpected second metadata update'));

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await expect(adapter.overwrite(fullTable, replacementData)).resolves.toMatchObject({
          written: 2,
          totalAfterWrite: 2,
        });

        expect(countSpy).not.toHaveBeenCalled();
        expect(storage.getTableMeta(fullTable)?.count).toBe(2);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual(replacementData);
      } finally {
        countSpy.mockRestore();
        await adapter.deleteTable(fullTable);
      }
    });

    it('commits a full-table logical count without a post-commit metadata callback', async () => {
      const fullTable = 'test_full_table_transaction_atomic_count';
      const originalData = [
        { id: 1, secret: 'alpha' },
        { id: 2, secret: 'beta' },
      ];
      const countSpy = jest
        .spyOn(FileSystemStorageAdapter.prototype, 'setLogicalRecordCount')
        .mockRejectedValue(new Error('unexpected post-commit metadata callback'));

      try {
        await adapter.createTable(fullTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(fullTable, originalData);

        await adapter.beginTransaction();
        await adapter.insert(fullTable, { id: 3, secret: 'gamma' });
        await expect(adapter.commit()).resolves.toBeUndefined();

        expect(countSpy).not.toHaveBeenCalled();
        expect(storage.isInTransaction()).toBe(false);
        expect(storage.getTableMeta(fullTable)?.count).toBe(3);
        await expect(adapter.read(fullTable, { bypassCache: true })).resolves.toEqual([
          ...originalData,
          { id: 3, secret: 'gamma' },
        ]);
      } finally {
        countSpy.mockRestore();
        if (storage.isInTransaction()) {
          await adapter.rollback();
        }
        await adapter.deleteTable(fullTable);
      }
    });
  });

  describe('cache invalidation', () => {
    it('does not expose uncommitted plaintext after rollback', async () => {
      const committed = [{ id: 'committed', name: 'persisted' }];
      const uncommitted = [{ id: 'uncommitted', name: 'transient' }];

      await adapter.overwrite(tableName, committed);
      await adapter.beginTransaction();
      await adapter.overwrite(tableName, uncommitted);
      await expect(adapter.read(tableName)).resolves.toEqual(uncommitted);
      await expect(adapter.findOne(tableName, { id: 'uncommitted' })).resolves.toEqual(uncommitted[0]);

      await adapter.rollback();

      await expect(adapter.findOne(tableName, { id: 'uncommitted' })).resolves.toBeNull();
      await expect(adapter.read(tableName, { bypassCache: true })).resolves.toEqual(committed);
    });

    it('does not serve cached full-table plaintext after resetting the master key', async () => {
      const resetTable = 'test_master_key_reset_cache';
      const cache = adapter as unknown as {
        fullTableCache: Map<string, unknown>;
      };

      try {
        await adapter.createTable(resetTable, { encrypted: true, encryptFullTable: true });
        await adapter.overwrite(resetTable, [{ id: 'old', secret: 'cached-before-reset' }]);
        await expect(adapter.read(resetTable)).resolves.toEqual([{ id: 'old', secret: 'cached-before-reset' }]);
        await expect(adapter.findOne(resetTable, { id: 'old' })).resolves.toEqual({
          id: 'old',
          secret: 'cached-before-reset',
        });
        expect(cache.fullTableCache.size).toBe(1);

        await resetMasterKey();

        await expect(adapter.findOne(resetTable, { id: 'old' })).rejects.toMatchObject({ code: 'TABLE_READ_FAILED' });
        expect(cache.fullTableCache.size).toBe(0);
      } finally {
        await deleteTableIfPresent(resetTable);
      }
    });

    it('does not reuse field plaintext after another adapter overwrites the table', async () => {
      const crossInstanceTable = 'test_field_cache_cross_instance_overwrite';
      const secondAdapter = new EncryptedStorageAdapter();

      try {
        await adapter.createTable(crossInstanceTable, { encrypted: true, encryptedFields: ['secret'] });
        await adapter.overwrite(crossInstanceTable, [
          { id: 'old-1', secret: 'old-alpha' },
          { id: 'old-2', secret: 'old-beta' },
        ]);
        await expect(adapter.count(crossInstanceTable)).resolves.toBe(2);
        await expect(adapter.findOne(crossInstanceTable, { secret: 'old-alpha' })).resolves.toEqual({
          id: 'old-1',
          secret: 'old-alpha',
        });

        await secondAdapter.overwrite(crossInstanceTable, [{ id: 'new', secret: 'replacement' }]);

        await expect(adapter.count(crossInstanceTable)).resolves.toBe(1);
        await expect(adapter.findOne(crossInstanceTable, { secret: 'old-alpha' })).resolves.toBeNull();
        await expect(adapter.findOne(crossInstanceTable, { secret: 'replacement' })).resolves.toEqual({
          id: 'new',
          secret: 'replacement',
        });
      } finally {
        await deleteTableIfPresent(crossInstanceTable);
      }
    });

    it('does not reuse field plaintext after another adapter deletes a record', async () => {
      const crossInstanceTable = 'test_field_cache_cross_instance_delete';
      const secondAdapter = new EncryptedStorageAdapter();

      try {
        await adapter.createTable(crossInstanceTable, { encrypted: true, encryptedFields: ['secret'] });
        await adapter.overwrite(crossInstanceTable, [
          { id: 'remove', secret: 'remove-me' },
          { id: 'keep', secret: 'keep-me' },
        ]);
        await expect(adapter.count(crossInstanceTable)).resolves.toBe(2);
        await expect(adapter.findOne(crossInstanceTable, { secret: 'remove-me' })).resolves.toEqual({
          id: 'remove',
          secret: 'remove-me',
        });

        await expect(secondAdapter.delete(crossInstanceTable, { id: 'remove' })).resolves.toBe(1);

        await expect(adapter.count(crossInstanceTable)).resolves.toBe(1);
        await expect(adapter.findOne(crossInstanceTable, { secret: 'remove-me' })).resolves.toBeNull();
        await expect(adapter.findOne(crossInstanceTable, { secret: 'keep-me' })).resolves.toEqual({
          id: 'keep',
          secret: 'keep-me',
        });
      } finally {
        await deleteTableIfPresent(crossInstanceTable);
      }
    });
  });

  describe('access authentication', () => {
    it('retries a strict key read that overlaps a master-key reset', async () => {
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const secureStore = getSecureStoreMock();
      const constants = require('expo-constants') as unknown as ExpoConstantsMock;
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
        const keyPromise = getEncryptedAdapterPrivateAccess(authAdapter).getOrInitKey();
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

    it('reuses an authorized requireAuthOnAccess key within one encrypted operation', async () => {
      const authTable = 'test_auth_single_key_per_operation';
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const keySpy = jest
        .spyOn(getEncryptedAdapterPrivateAccess(authAdapter), 'key')
        .mockResolvedValue('authorized-test-key');
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
        await expectSingleKeyAccess(() =>
          authAdapter.createTable(authTable, { encrypted: true, encryptFullTable: true })
        );
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
        await deleteTableIfPresent(authTable);
      }
    });

    it('validates requireAuthOnAccess before direct table operations', async () => {
      const authTable = 'test_auth_guard_table';
      const authAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const keySpy = jest
        .spyOn(getEncryptedAdapterPrivateAccess(authAdapter), 'key')
        .mockResolvedValue('authorized-test-key');

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
        await deleteTableIfPresent(authTable);
      }
    });

    it('rejects a normal encrypted adapter attempting to access a strict table', async () => {
      const strictTable = 'test_strict_table_rejects_normal_adapter';
      const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const strictKeySpy = jest
        .spyOn(getEncryptedAdapterPrivateAccess(strictAdapter), 'key')
        .mockResolvedValue('strict-test-key');
      const normalAdapter = new EncryptedStorageAdapter();

      try {
        await strictAdapter.createTable(strictTable, { encrypted: true });

        expect(storage.getTableMeta(strictTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: true,
        });
        await expect(normalAdapter.deleteTable(strictTable)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        await expect(normalAdapter.hasTable(strictTable)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        await expect(normalAdapter.listTables()).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
      } finally {
        strictKeySpy.mockRestore();
        await deleteTableIfPresent(strictTable);
      }
    });

    it('rejects a strict encrypted adapter attempting to access a normal table', async () => {
      const normalTable = 'test_normal_table_rejects_strict_adapter';
      const normalAdapter = new EncryptedStorageAdapter();
      const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const strictKeySpy = jest
        .spyOn(getEncryptedAdapterPrivateAccess(strictAdapter), 'key')
        .mockResolvedValue('strict-test-key');

      try {
        await normalAdapter.createTable(normalTable, { encrypted: true });

        expect(storage.getTableMeta(normalTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: false,
        });
        await expect(strictAdapter.deleteTable(normalTable)).rejects.toMatchObject({
          code: 'MIGRATION_FAILED',
        });
      } finally {
        strictKeySpy.mockRestore();
        await deleteTableIfPresent(normalTable);
      }
    });
  });

  describe('deletion operations', () => {
    beforeEach(async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
      ];
      await adapter.overwrite(tableName, testData);
    });

    it('deletes encrypted records matching a predicate', async () => {
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

  describe('concurrent writes', () => {
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
      FileSystemStorageAdapter.prototype.read = async function <T extends object = StorageRecord>(
        this: FileSystemStorageAdapter,
        currentTableName: string,
        readOptions?: ReadOptions<T>
      ): Promise<T[]> {
        const records = (await originalRead.call(this, currentTableName, readOptions)) as T[];
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
        expect(getEncryptedAdapterStaticAccess().tableWriteLocks.has(tableName)).toBe(true);

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

  describe('bulk operations', () => {
    it('inserts encrypted records through a bulk write', async () => {
      const operations = [
        { type: 'insert' as const, data: { id: 1, name: 'Alice' } },
        { type: 'insert' as const, data: { id: 2, name: 'Bob' } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      const allData = await adapter.read(tableName, { bypassCache: true });

      expect(result.written).toBe(2);
      expect(allData.length).toBe(2);
    });

    it('updates encrypted records through a bulk write', async () => {
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

    it('deletes encrypted records through a bulk write', async () => {
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

  describe('storage mode migration', () => {
    it('migrates an encrypted table to chunked mode', async () => {
      const testData = [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ];

      await adapter.overwrite(tableName, testData);
      await adapter.migrateToChunked(tableName);

      const migratedData = await adapter.read(tableName);

      expect(migratedData).toEqual(testData);
    });

    it('preserves encryption and column metadata without a plaintext rewrite window during migration', async () => {
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
      expect(storage.getTableMeta(tableName)).toMatchObject({
        mode: 'chunked',
        encrypted: true,
        encryptedFields: ['secret'],
        columns: { id: 'number', secret: 'string', visible: 'string' },
      });
    });
  });
});
