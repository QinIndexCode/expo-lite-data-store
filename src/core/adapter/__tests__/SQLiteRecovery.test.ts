import { MetadataManager } from '../../meta/MetadataManager';
import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter';

type UserRecord = {
  id: number;
  name: string;
};

const DATABASE_NAME = 'sqlite-recovery-test.db';

const getGlobalSqliteMockState = (): { databases: Record<string, unknown[]> } =>
  (global as unknown as { __expo_sqlite_mock__: { databases: Record<string, unknown[]> } }).__expo_sqlite_mock__;

const createAdapter = (metadataManager: MetadataManager): SQLiteStorageAdapter =>
  new SQLiteStorageAdapter(metadataManager, { databaseName: DATABASE_NAME });

describe('SQLiteStorageAdapter recovery and diagnostics', () => {
  afterEach(() => {
    delete getGlobalSqliteMockState().databases[DATABASE_NAME];
  });

  describe('cold-start metadata loading', () => {
    it('keeps surviving tables readable after a restart', async () => {
      const first = createAdapter(new MetadataManager());
      await first.createTable('persist_users', { initialData: [{ id: 1, name: 'Alice' }] });
      await first.write('persist_users', [{ id: 2, name: 'Bob' }]);

      // Simulate a restart: brand-new metadata manager and adapter over the
      // same physical database file.
      const second = createAdapter(new MetadataManager());
      await second.ensureInitialized();

      expect(await second.hasTable('persist_users')).toBe(true);
      expect(await second.listTables()).toContain('persist_users');
      const rows = await second.read<UserRecord>('persist_users');
      expect(rows).toHaveLength(2);
      expect(rows.map(row => row.name)).toEqual(['Alice', 'Bob']);
    });

    it('does not wipe surviving rows when a restart triggers an implicit create', async () => {
      const first = createAdapter(new MetadataManager());
      await first.createTable('persist_implicit', { initialData: [{ id: 1, name: 'Alice' }] });

      const second = createAdapter(new MetadataManager());
      await second.ensureInitialized();

      // hasTable() must now be true, so write() appends instead of taking the
      // implicit-createTable path that previously erased surviving rows.
      await second.write('persist_implicit', [{ id: 2, name: 'Bob' }]);
      expect(await second.count('persist_implicit')).toBe(2);
    });
  });

  describe('full-table encrypted count semantics', () => {
    it('reports the logical count instead of reconciling the envelope row', async () => {
      const adapter = createAdapter(new MetadataManager());
      await adapter.createTable('enc_full_count');
      // One physical envelope row; the logical count lives in metadata.
      await adapter.write('enc_full_count', [{ __enc: 'cGF5bG9hZA==' }]);
      const metadataManager = adapter.getTableMeta('enc_full_count')
        ? (adapter as unknown as { metadataManager: MetadataManager }).metadataManager
        : undefined;
      metadataManager?.update('enc_full_count', { count: 42, encryptFullTable: true });
      await metadataManager?.saveImmediately?.();

      expect(await adapter.count('enc_full_count')).toBe(42);
      expect(adapter.getTableMeta('enc_full_count')?.count).toBe(42);

      const verified = await adapter.verifyCount('enc_full_count');
      expect(verified).toMatchObject({ metadata: 42, actual: 1, match: false });
      expect(adapter.getTableMeta('enc_full_count')?.count).toBe(42);
      await adapter.deleteTable('enc_full_count');
    });
  });

  describe('expression index name collisions', () => {
    it('rejects createTable indexes that normalize to the same index name', async () => {
      const adapter = createAdapter(new MetadataManager());
      await expect(
        adapter.createTable('idx_conflict_table', {
          indexes: ['user.name', { field: 'user_name', unique: true }],
        })
      ).rejects.toMatchObject({ code: 'TABLE_INDEX_ALREADY_EXISTS' });
      await adapter.deleteTable('idx_conflict_table').catch(() => undefined);
    });

    it('rejects createIndex collisions and keeps the existing index intact', async () => {
      const adapter = createAdapter(new MetadataManager());
      await adapter.createTable('idx_conflict_create');
      await adapter.createIndex('idx_conflict_create', 'user.name');
      await expect(adapter.createIndex('idx_conflict_create', 'user_name')).rejects.toMatchObject({
        code: 'TABLE_INDEX_ALREADY_EXISTS',
      });
      expect(adapter.getTableMeta('idx_conflict_create')?.indexes?.['user.name_normal']).toBe('normal');
      await adapter.deleteTable('idx_conflict_create');
    });
  });
});
