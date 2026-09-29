/**
 * Write paths carrying `encryptedFields` must select the encrypted surface,
 * persist the requested field list when they create the table implicitly, and
 * fail closed (MIGRATION_FAILED) against an existing table whose policy differs.
 */
import {
  createTable,
  insert,
  overwrite,
  update,
  bulkWrite,
  read,
  countTable,
  beginTransaction,
  commit,
  rollback,
} from '../../expo-lite-data-store';
import storage from '../../core/adapter/FileSystemStorageAdapter';
import { configManager } from '../../core/config/ConfigManager';

const GLOBAL_FALLBACK_FIELDS = ['password', 'email', 'phone'];

const removeTableIfPresent = async (tableName: string): Promise<void> => {
  if (await storage.hasTable(tableName)) {
    await storage.deleteTable(tableName);
  }
};

describe('writes carrying encryptedFields', () => {
  const TEST_TABLE_PREFIX = 'enc_fields_write_';
  let testTable: string;
  let testTableSequence = 0;

  beforeEach(() => {
    testTable = `${TEST_TABLE_PREFIX}${Date.now()}_${++testTableSequence}`;
    // Keep the global fallback deliberately different from every per-call list
    // below: persisted metadata must come from the request, never from config.
    configManager.updateConfig({ encryption: { encryptedFields: [...GLOBAL_FALLBACK_FIELDS] } });
  });

  afterEach(async () => {
    await removeTableIfPresent(testTable);
    configManager.resetConfig();
  });

  afterAll(async () => {
    const tables = await storage.listTables();
    for (const table of tables) {
      if (table.startsWith(TEST_TABLE_PREFIX)) {
        await storage.deleteTable(table);
      }
    }
  });

  describe('insert', () => {
    it('creates an encrypted table when a missing-table insert carries encryptedFields', async () => {
      // Literal options are a compile-time regression guard: this must type-check
      // against WriteOptions without `as any`.
      await insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
        mode: 'append',
        encryptedFields: ['secret'],
      });

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw).toHaveLength(1);
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });

    it('rejects an insert carrying encryptedFields against an existing plaintext table', async () => {
      await createTable(testTable);

      await expect(
        insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
          mode: 'append',
          encryptedFields: ['secret'],
        })
      ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });

      await expect(countTable(testTable)).resolves.toBe(0);
      expect(storage.getTableMeta(testTable)?.encrypted).not.toBe(true);
    });
  });

  describe('overwrite', () => {
    it('creates an encrypted table when a missing-table overwrite carries encryptedFields', async () => {
      await overwrite(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
        encryptedFields: ['secret'],
      });

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });

    it('rejects an overwrite carrying encryptedFields against an existing plaintext table', async () => {
      await createTable(testTable);
      await insert(testTable, [{ id: 1, name: 'plain' }]);

      await expect(
        overwrite(testTable, [{ id: 99, secret: 'classified' }], { encryptedFields: ['secret'] })
      ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });

      // The rejected write must not have replaced the plaintext contents.
      await expect(read(testTable)).resolves.toEqual([{ id: 1, name: 'plain' }]);
      await expect(countTable(testTable)).resolves.toBe(1);
    });
  });

  describe('update', () => {
    it('creates an encrypted table when a missing-table update carries encryptedFields', async () => {
      const updated = await update(
        testTable,
        { secret: 'classified' },
        {
          where: { id: 1 },
          encryptedFields: ['secret'],
        }
      );

      expect(updated).toBe(0);
      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([]);
    });

    it('rejects an update carrying encryptedFields against an existing plaintext table', async () => {
      await createTable(testTable);
      await insert(testTable, [{ id: 1, name: 'plain' }]);

      await expect(
        update(testTable, { secret: 'classified' }, { where: { id: 1 }, encryptedFields: ['secret'] })
      ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });

      await expect(read(testTable)).resolves.toEqual([{ id: 1, name: 'plain' }]);
    });
  });

  describe('bulkWrite', () => {
    it('creates an encrypted table when a missing-table bulkWrite carries encryptedFields', async () => {
      await bulkWrite(testTable, [{ type: 'insert', data: [{ id: 1, secret: 'classified', visible: 'plain' }] }], {
        encryptedFields: ['secret'],
      });

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });

    it('rejects a bulkWrite carrying encryptedFields against an existing plaintext table', async () => {
      await createTable(testTable);

      await expect(
        bulkWrite(testTable, [{ type: 'insert', data: [{ id: 1, secret: 'classified' }] }], {
          encryptedFields: ['secret'],
        })
      ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });

      await expect(countTable(testTable)).resolves.toBe(0);
    });
  });

  describe('implicit table policy', () => {
    it('persists the requested field list instead of the global default on implicit creation', async () => {
      await insert(testTable, [{ id: 1, secret: 'classified' }], {
        mode: 'append',
        encryptedFields: ['secret'],
      });

      expect(configManager.getConfig().encryption.encryptedFields).toEqual(GLOBAL_FALLBACK_FIELDS);
      const meta = storage.getTableMeta(testTable);
      expect(meta).toMatchObject({ encrypted: true });
      expect(meta?.encryptedFields).toEqual(['secret']);
      expect(meta?.encryptAllFields).toBeUndefined();
    });

    it('accepts literal encryptedFields write options without casts', async () => {
      // Both option shapes are checked against their public types as written;
      // adding `as any` here would turn this compile-time guard into a no-op.
      await insert(testTable, [{ id: 1, secret: 'classified' }], {
        mode: 'append',
        encryptedFields: ['secret'],
      });
      const updated = await update(
        testTable,
        { visible: 'plain' },
        {
          where: { id: 1 },
          encryptedFields: ['secret'],
        }
      );

      expect(updated).toBe(1);
      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });
  });

  describe('empty encryptedFields list', () => {
    type WriteSurface = [string, (table: string) => Promise<unknown>];

    // Every public write entry must reject a lone empty list before any storage
    // surface resolves, so no table and no metadata may be produced.
    const EMPTY_LIST_SURFACES: WriteSurface[] = [
      ['insert', table => insert(table, [{ id: 1, secret: 'classified' }], { mode: 'append', encryptedFields: [] })],
      ['overwrite', table => overwrite(table, [{ id: 1, secret: 'classified' }], { encryptedFields: [] })],
      [
        'bulkWrite',
        table =>
          bulkWrite(table, [{ type: 'insert', data: [{ id: 1, secret: 'classified' }] }], { encryptedFields: [] }),
      ],
      ['update', table => update(table, { secret: 'classified' }, { where: { id: 1 }, encryptedFields: [] })],
    ];

    it.each(EMPTY_LIST_SURFACES)(
      'rejects a lone encryptedFields: [] on %s without creating the table',
      async (name, run) => {
        const error = await run(testTable).then(
          () => {
            throw new Error(`expected ${name} to reject an empty encryptedFields list`);
          },
          (cause: unknown) => cause as { code?: string; message?: string; suggestion?: string }
        );

        expect(error.code).toBe('FILE_CONTENT_INVALID');
        expect(error.message).toContain('an empty list is a createTable option');
        expect(error.suggestion).toContain('encrypted: true');

        expect(await storage.hasTable(testTable)).toBe(false);
        expect(storage.getTableMeta(testTable)).toBeUndefined();
        expect(await storage.listTables()).not.toContain(testTable);
      }
    );

    it('still accepts an empty list when another encryption option selects the encrypted surface', async () => {
      await createTable(testTable, { encrypted: true, encryptedFields: [] });

      await insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
        mode: 'append',
        encrypted: true,
        encryptedFields: [],
      });

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptAllFields: true,
        encryptedFields: [],
      });
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });
  });

  describe('dynamic all-fields writes', () => {
    it('encrypts every field when writing to a dynamic all-fields table with encrypted: true and an empty list', async () => {
      await createTable(testTable, { encrypted: true, encryptedFields: [] });
      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptAllFields: true,
        encryptedFields: [],
      });

      await insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
        encrypted: true,
        encryptedFields: [],
      });

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptAllFields: true,
        encryptedFields: [],
      });
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw).toHaveLength(1);
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).not.toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });
  });

  describe('explicit security combinations', () => {
    it('persists the requested field list when encrypted: true accompanies a non-empty list on a missing table', async () => {
      await insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
        mode: 'append',
        encrypted: true,
        encryptedFields: ['secret'],
      });

      const meta = storage.getTableMeta(testTable);
      expect(meta).toMatchObject({ encrypted: true, encryptedFields: ['secret'] });
      // The explicit combination must still persist the request, never the global default.
      expect(meta?.encryptedFields).not.toEqual(GLOBAL_FALLBACK_FIELDS);
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });

    it('persists field policy and ciphertext for a missing-table insert inside a transaction', async () => {
      await beginTransaction({ encrypted: true });
      try {
        await insert(testTable, [{ id: 1, secret: 'classified', visible: 'plain' }], {
          encrypted: true,
          encryptedFields: ['secret'],
        });
        await commit({ encrypted: true });
      } catch (error) {
        await rollback({ encrypted: true }).catch(() => undefined);
        throw error;
      }

      expect(storage.getTableMeta(testTable)).toMatchObject({
        encrypted: true,
        encryptedFields: ['secret'],
      });
      expect(storage.getTableMeta(testTable)?.encryptedFields).not.toEqual(GLOBAL_FALLBACK_FIELDS);
      const raw = await storage.read(testTable, { bypassCache: true });
      expect(raw).toHaveLength(1);
      expect(raw[0]?.secret).not.toBe('classified');
      expect(raw[0]?.visible).toBe('plain');
      await expect(read(testTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
        { id: 1, secret: 'classified', visible: 'plain' },
      ]);
    });
  });
});
