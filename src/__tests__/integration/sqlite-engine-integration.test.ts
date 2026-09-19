import {
  init,
  createTable,
  insert,
  findOne,
  findMany,
  update,
  remove,
  deleteTable,
  hasTable,
  beginTransaction,
  commit,
  rollback,
  countTable,
  createIndex,
  dropIndex,
  migrateEngine,
} from '../../expo-lite-data-store';
import { configManager } from '../../core/config/ConfigManager';
import { meta } from '../../core/meta/MetadataManager';

describe('SQLite Engine Integration', () => {
  const SQLITE_TABLE = 'sqlite_integration_test_table';
  const ENCRYPTED_TABLE = 'sqlite_encrypted_test_table';
  const ENCRYPTED_OPTIONS = { encrypted: true } as const;

  beforeEach(async () => {
    configManager.resetConfig();
    await init({ engine: 'sqlite' });

    if (await hasTable(SQLITE_TABLE)) {
      await deleteTable(SQLITE_TABLE);
    }
    if (await hasTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS)) {
      await deleteTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS);
    }
  });

  afterAll(async () => {
    try {
      if (await hasTable(SQLITE_TABLE)) {
        await deleteTable(SQLITE_TABLE);
      }
      if (await hasTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS);
      }
    } catch {
      // ignore teardown errors
    }
    configManager.resetConfig();
  });

  describe('Core CRUD with SQLite pushdown', () => {
    it('executes create, insert, findOne, findMany, update, delete through SQLite', async () => {
      await createTable(SQLITE_TABLE, {
        indexes: ['category', { field: 'code', unique: true }],
      });

      const records = [
        { id: 'item-1', code: 'C01', category: 'A', score: 95, active: true },
        { id: 'item-2', code: 'C02', category: 'B', score: 70, active: false },
        { id: 'item-3', code: 'C03', category: 'A', score: 85, active: true },
        { id: 'item-4', code: 'C04', category: 'B', score: 60, active: true },
        { id: 'item-5', code: 'C05', category: 'A', score: 90, active: false },
      ];

      const insertRes = await insert(SQLITE_TABLE, records);
      expect(insertRes.written).toBe(5);
      expect(await countTable(SQLITE_TABLE)).toBe(5);

      // findOne pushdown
      const one = await findOne<{ id: string; code: string }>(SQLITE_TABLE, {
        where: { code: 'C03' },
      });
      expect(one).toBeDefined();
      expect(one?.id).toBe('item-3');

      // findMany pushdown with filter, sort and pagination
      const queryRes = await findMany<{ id: string; score: number }>(SQLITE_TABLE, {
        where: { category: 'A', active: true },
        sortBy: 'score',
        order: 'desc',
      });
      expect(queryRes).toHaveLength(2);
      expect(queryRes[0].id).toBe('item-1');
      expect(queryRes[1].id).toBe('item-3');

      // update pushdown
      const updatedCount = await update(SQLITE_TABLE, { score: 75, active: true }, { where: { code: 'C02' } });
      expect(updatedCount).toBe(1);

      const updated = await findOne<{ id: string; score: number; active: boolean }>(SQLITE_TABLE, {
        where: { code: 'C02' },
      });
      expect(updated?.score).toBe(75);
      expect(updated?.active).toBe(true);

      // remove pushdown
      const deletedCount = await remove(SQLITE_TABLE, {
        where: { category: 'B' },
      });
      expect(deletedCount).toBe(2);
      expect(await countTable(SQLITE_TABLE)).toBe(3);
    });

    it('enforces unique index constraint in SQLite', async () => {
      await createTable(SQLITE_TABLE, {
        indexes: [{ field: 'email', unique: true }],
      });

      await insert(SQLITE_TABLE, [
        { id: 'u1', email: 'alice@example.com' },
        { id: 'u2', email: 'bob@example.com' },
      ]);

      await expect(insert(SQLITE_TABLE, [{ id: 'u3', email: 'alice@example.com' }])).rejects.toThrow();
    });

    it('creates and drops indexes dynamically via API', async () => {
      await createTable(SQLITE_TABLE);
      await insert(SQLITE_TABLE, [
        { id: '1', tag: 'alpha' },
        { id: '2', tag: 'beta' },
      ]);

      await createIndex(SQLITE_TABLE, 'tag');
      await dropIndex(SQLITE_TABLE, 'tag');

      const found = await findMany(SQLITE_TABLE, { where: { tag: 'beta' } });
      expect(found).toHaveLength(1);
    });
  });

  describe('Transactions in SQLite', () => {
    it('commits transaction changes atomically', async () => {
      await createTable(SQLITE_TABLE);

      await beginTransaction();
      await insert(SQLITE_TABLE, [{ id: 'tx-1', val: 100 }]);
      await insert(SQLITE_TABLE, [{ id: 'tx-2', val: 200 }]);
      await commit();

      expect(await countTable(SQLITE_TABLE)).toBe(2);
    });

    it('rolls back transaction changes atomically', async () => {
      await createTable(SQLITE_TABLE);
      await insert(SQLITE_TABLE, [{ id: 'init-1', val: 50 }]);

      await beginTransaction();
      await insert(SQLITE_TABLE, [{ id: 'tx-fail', val: 999 }]);
      await rollback();

      expect(await countTable(SQLITE_TABLE)).toBe(1);
      const found = await findOne(SQLITE_TABLE, { where: { id: 'tx-fail' } });
      expect(found).toBeNull();
    });
  });

  describe('Field-level encryption with on-demand decryption', () => {
    it('encrypts sensitive fields while pushing down filters and decrypting only sliced results', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
        encryptedFields: ['secretToken', 'ssn'],
        indexes: ['status', 'score'],
      });

      const batch = Array.from({ length: 50 }, (_, i) => ({
        id: `user-${i + 1}`,
        status: i % 2 === 0 ? 'active' : 'inactive',
        score: i * 10,
        secretToken: `token-secret-xyz-${i + 1}`,
        ssn: `999-00-${String(i).padStart(4, '0')}`,
      }));

      await insert(ENCRYPTED_TABLE, batch, ENCRYPTED_OPTIONS);
      expect(await countTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS)).toBe(50);

      // Query on unencrypted fields with pagination (pushdown eligible!)
      const pageResults = await findMany<{
        id: string;
        status: string;
        score: number;
        secretToken: string;
        ssn: string;
      }>(ENCRYPTED_TABLE, {
        where: { status: 'active', score: { $gte: 200 } },
        sortBy: 'score',
        order: 'desc',
        skip: 0,
        limit: 5,
        encrypted: true,
      });

      expect(pageResults).toHaveLength(5);
      // Top active scores: 480, 460, 440, 420, 400
      expect(pageResults[0].score).toBe(480);
      expect(pageResults[0].id).toBe('user-49');
      // Secret tokens correctly decrypted
      expect(pageResults[0].secretToken).toBe('token-secret-xyz-49');
      expect(pageResults[0].ssn).toBe('999-00-0048');

      expect(pageResults[1].score).toBe(460);
      expect(pageResults[1].secretToken).toBe('token-secret-xyz-47');

      // findOne with unencrypted filter condition
      const single = await findOne<{ id: string; secretToken: string }>(ENCRYPTED_TABLE, {
        where: { id: 'user-49' },
        encrypted: true,
      });
      expect(single).not.toBeNull();
      expect(single?.secretToken).toBe('token-secret-xyz-49');

      // Dynamic index creation and dropping on encrypted table
      await createIndex(ENCRYPTED_TABLE, 'status', ENCRYPTED_OPTIONS);
      expect(meta.get(ENCRYPTED_TABLE)?.indexes?.['status_normal']).toBe('normal');
      await dropIndex(ENCRYPTED_TABLE, 'status', ENCRYPTED_OPTIONS);
      expect(meta.get(ENCRYPTED_TABLE)?.indexes?.['status_normal']).toBeUndefined();
    });
  });

  describe('Bidirectional Engine Migration', () => {
    it('migrates existing data and indexes from SQLite to FileSystem and vice versa', async () => {
      await createTable(SQLITE_TABLE, {
        indexes: ['title', { field: 'id', unique: true }],
      });
      const initialRecords = [
        { id: 'mig-1', title: 'Task A', completed: true },
        { id: 'mig-2', title: 'Task B', completed: false },
      ];
      await insert(SQLITE_TABLE, initialRecords);

      // Verify indexes in metadata
      expect(meta.get(SQLITE_TABLE)?.indexes?.['title_normal']).toBe('normal');
      expect(meta.get(SQLITE_TABLE)?.indexes?.['id_unique']).toBe('unique');

      // Migrate SQLite -> file-system
      const toFsResult = await migrateEngine('file-system', { cleanSource: true });
      expect(toFsResult.fromEngine).toBe('sqlite');
      expect(toFsResult.toEngine).toBe('file-system');
      expect(toFsResult.migratedTables).toContain(SQLITE_TABLE);
      expect(toFsResult.totalRecords).toBe(2);

      // Verify active engine is now file-system and data and indexes are preserved
      expect(configManager.getConfig().engine).toBe('file-system');
      const fsRecords = await findMany(SQLITE_TABLE);
      expect(fsRecords).toHaveLength(2);
      expect(meta.get(SQLITE_TABLE)?.indexes?.['title_normal']).toBe('normal');

      // Migrate file-system -> sqlite
      const toSqliteResult = await migrateEngine('sqlite', { cleanSource: true });
      expect(toSqliteResult.fromEngine).toBe('file-system');
      expect(toSqliteResult.toEngine).toBe('sqlite');
      expect(toSqliteResult.migratedTables).toContain(SQLITE_TABLE);
      expect(toSqliteResult.totalRecords).toBe(2);

      // Verify active engine is back to sqlite and data and indexes are preserved
      expect(configManager.getConfig().engine).toBe('sqlite');
      const sqliteRecords = await findMany(SQLITE_TABLE);
      expect(sqliteRecords).toHaveLength(2);
      expect(meta.get(SQLITE_TABLE)?.indexes?.['title_normal']).toBe('normal');
      expect(await countTable(SQLITE_TABLE)).toBe(2);
    });
  });

  describe('Index Cleanup & DDL Isolation', () => {
    it('does not drop indexes of similarly named tables when one table is deleted', async () => {
      const TABLE_A = 'test_user';
      const TABLE_B = 'test_users';

      if (await hasTable(TABLE_A)) await deleteTable(TABLE_A);
      if (await hasTable(TABLE_B)) await deleteTable(TABLE_B);

      await createTable(TABLE_A, { indexes: ['email'] });
      await createTable(TABLE_B, { indexes: ['email'] });

      expect(meta.get(TABLE_A)?.indexes?.['email_normal']).toBe('normal');
      expect(meta.get(TABLE_B)?.indexes?.['email_normal']).toBe('normal');

      // Delete table A
      await deleteTable(TABLE_A);
      expect(await hasTable(TABLE_A)).toBe(false);

      // Table B and its index must still exist intact!
      expect(await hasTable(TABLE_B)).toBe(true);
      expect(meta.get(TABLE_B)?.indexes?.['email_normal']).toBe('normal');

      // Cleanup
      await deleteTable(TABLE_B);
    });

    it('persists dynamic encryptAllFields properly on SQLite tables', async () => {
      const ALL_ENC_TABLE = 'sqlite_dynamic_all_enc_table';
      if (await hasTable(ALL_ENC_TABLE, ENCRYPTED_OPTIONS)) await deleteTable(ALL_ENC_TABLE, ENCRYPTED_OPTIONS);

      // Create table with dynamic all-field encryption (encryptedFields: [])
      await createTable(ALL_ENC_TABLE, { encrypted: true, encryptedFields: [] });
      expect(meta.get(ALL_ENC_TABLE)?.encryptAllFields).toBe(true);

      // Insert records with custom fields
      await insert(ALL_ENC_TABLE, [{ id: 'sec-1', customField: 'top-secret', salary: 100000 }], ENCRYPTED_OPTIONS);
      const fetched = await findOne<{ id: string; customField: string; salary: number }>(ALL_ENC_TABLE, {
        where: { id: 'sec-1' },
        encrypted: true,
      });
      expect(fetched?.customField).toBe('top-secret');
      expect(fetched?.salary).toBe(100000);

      await deleteTable(ALL_ENC_TABLE, ENCRYPTED_OPTIONS);
    });
  });
});
