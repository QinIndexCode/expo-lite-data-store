import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';
import { MetadataManager } from '../../meta/MetadataManager';

type IndexedRecord = {
  id: number;
  name?: string;
  email?: string;
};

describe('FileSystemStorageAdapter - index declarations and builds', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;
  const createdTables: string[] = [];

  const trackTable = (tableName: string): string => {
    createdTables.push(tableName);
    return tableName;
  };

  beforeEach(() => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
    createdTables.length = 0;
  });

  afterEach(async () => {
    for (const tableName of createdTables) {
      try {
        if (await adapter.hasTable(tableName)) {
          await adapter.deleteTable(tableName);
        }
      } catch {
        // The table may already be gone after a rollback assertion.
      }
    }

    await adapter.cleanup();
    metadataManager.cleanup();
    jest.restoreAllMocks();
  });

  describe('createTable({ indexes })', () => {
    it('builds declared indexes so unique constraints apply from the first write', async () => {
      const tableName = trackTable('idxfs_declared');
      await adapter.createTable(tableName, {
        indexes: ['name', { field: 'email', unique: true }],
        initialData: [
          { id: 1, name: 'alpha', email: 'a@example.com' },
          { id: 2, name: 'beta', email: 'b@example.com' },
        ],
      });

      expect(metadataManager.get(tableName)?.indexes).toMatchObject({
        name_normal: 'normal',
        email_unique: 'unique',
      });

      await expect(adapter.insert(tableName, [{ id: 3, name: 'gamma', email: 'a@example.com' }])).rejects.toMatchObject(
        { code: 'TABLE_INDEX_NOT_UNIQUE' }
      );

      // The non-unique index must not reject duplicate values.
      await expect(
        adapter.insert(tableName, [{ id: 4, name: 'alpha', email: 'd@example.com' }])
      ).resolves.toBeDefined();

      const rows = await adapter.read<IndexedRecord>(tableName, { filter: { email: 'b@example.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 2, email: 'b@example.com' });
    });

    it('rolls the table back when an index declaration is malformed', async () => {
      const tableName = trackTable('idxfs_malformed');

      await expect(
        adapter.createTable(tableName, { indexes: [{} as { field: string; unique?: boolean }] })
      ).rejects.toMatchObject({
        code: 'TABLE_INDEX_INVALID',
      });

      expect(await adapter.hasTable(tableName)).toBe(false);
      expect(metadataManager.get(tableName)).toBeUndefined();
    });

    it('rolls the table back when initialData violates a declared unique index', async () => {
      const tableName = trackTable('idxfs_conflict');

      await expect(
        adapter.createTable(tableName, {
          indexes: [{ field: 'email', unique: true }],
          initialData: [
            { id: 1, email: 'dup@example.com' },
            { id: 2, email: 'dup@example.com' },
          ],
        })
      ).rejects.toMatchObject({ code: 'TABLE_INDEX_NOT_UNIQUE' });

      expect(await adapter.hasTable(tableName)).toBe(false);
      expect(metadataManager.get(tableName)).toBeUndefined();
    });
  });

  describe('createTable({ indexes }) on an existing table', () => {
    it('ignores declarations and keeps stored rows when the declaration is malformed', async () => {
      const tableName = trackTable('idxfs_existing_malformed');
      await adapter.createTable(tableName, { initialData: [{ id: 1, name: 'alpha' }] });

      // Declarations only apply when this call creates the table: a failing
      // declaration must never trigger the new-table rollback against rows the
      // caller already owns.
      await expect(
        adapter.createTable(tableName, { indexes: [{} as { field: string; unique?: boolean }] })
      ).resolves.toBeUndefined();

      expect(metadataManager.get(tableName)?.indexes).toBeUndefined();
      const rows = await adapter.read<IndexedRecord>(tableName);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 1, name: 'alpha' });
    });

    it('ignores a unique declaration whose build would violate existing rows', async () => {
      const tableName = trackTable('idxfs_existing_conflict');
      await adapter.createTable(tableName, {
        initialData: [
          { id: 1, email: 'dup@example.com' },
          { id: 2, email: 'dup@example.com' },
        ],
      });

      await expect(
        adapter.createTable(tableName, { indexes: [{ field: 'email', unique: true }] })
      ).resolves.toBeUndefined();

      expect(metadataManager.get(tableName)?.indexes).toBeUndefined();
      const rows = await adapter.read<IndexedRecord>(tableName);
      expect(rows).toHaveLength(2);

      // No unique index was built, so duplicate values stay insertable.
      await expect(adapter.insert(tableName, [{ id: 3, email: 'dup@example.com' }])).resolves.toBeDefined();
    });

    it('does not re-run or corrupt declarations when the same index is declared again', async () => {
      const tableName = trackTable('idxfs_existing_duplicate');
      await adapter.createTable(tableName, {
        indexes: [{ field: 'email', unique: true }],
        initialData: [{ id: 1, email: 'a@example.com' }],
      });

      await expect(
        adapter.createTable(tableName, { indexes: [{ field: 'email', unique: true }] })
      ).resolves.toBeUndefined();

      expect(metadataManager.get(tableName)?.indexes).toMatchObject({ email_unique: 'unique' });
      const rows = await adapter.read<IndexedRecord>(tableName);
      expect(rows).toHaveLength(1);

      // The original unique enforcement survives the duplicate declaration.
      await expect(adapter.insert(tableName, [{ id: 2, email: 'a@example.com' }])).rejects.toMatchObject({
        code: 'TABLE_INDEX_NOT_UNIQUE',
      });
    });
  });

  describe('declaration durability and cache hygiene', () => {
    it('flushes declaration metadata immediately on createIndex, dropIndex, and failed builds', async () => {
      const tableName = trackTable('idxfs_durability');
      await adapter.createTable(tableName);
      const flushSpy = jest.spyOn(metadataManager, 'saveImmediately');

      flushSpy.mockClear();
      await adapter.createIndex(tableName, 'email', true);
      expect(flushSpy).toHaveBeenCalled();

      // Dropping removes enforcement and persists the removal right away.
      flushSpy.mockClear();
      await adapter.dropIndex(tableName, 'email');
      expect(flushSpy).toHaveBeenCalled();
      expect(metadataManager.get(tableName)?.indexes?.email_unique).toBeUndefined();

      await adapter.insert(tableName, [
        { id: 1, email: 'dup@example.com' },
        { id: 2, email: 'dup@example.com' },
      ]);

      // A failing build also flushes the cleanup, so a crash cannot resurrect
      // the declaration after the index has been torn down.
      flushSpy.mockClear();
      await expect(adapter.createIndex(tableName, 'email', true)).rejects.toMatchObject({
        code: 'TABLE_INDEX_NOT_UNIQUE',
      });
      expect(flushSpy).toHaveBeenCalled();
      expect(metadataManager.get(tableName)?.indexes?.email_unique).toBeUndefined();

      // No unique index survived any of the three operations.
      await expect(adapter.insert(tableName, [{ id: 3, email: 'dup@example.com' }])).resolves.toBeDefined();
    });

    it('builds indexes from the on-disk snapshot instead of the read cache', async () => {
      const tableName = trackTable('idxfs_bypass');
      await adapter.createTable(tableName);
      await adapter.insert(tableName, [{ id: 1, email: 'a@example.com' }]);

      const dataReader = (adapter as unknown as { dataReader: { read: (...args: unknown[]) => Promise<unknown> } })
        .dataReader;
      const readSpy = jest.spyOn(dataReader, 'read');

      await adapter.createIndex(tableName, 'email', false);

      expect(readSpy).toHaveBeenCalledWith(tableName, { bypassCache: true });
      readSpy.mockRestore();
    });
  });

  describe('createIndex on existing data', () => {
    it('builds the index over existing rows so queries and constraints take effect immediately', async () => {
      const tableName = trackTable('idxfs_nonempty');
      await adapter.createTable(tableName);
      await adapter.insert(tableName, [
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ]);

      await adapter.createIndex(tableName, 'email', true);

      // A ready unique index rejects a duplicate against pre-existing rows.
      await expect(adapter.insert(tableName, [{ id: 3, email: 'a@example.com' }])).rejects.toMatchObject({
        code: 'TABLE_INDEX_NOT_UNIQUE',
      });

      const rows = await adapter.read<IndexedRecord>(tableName, { filter: { email: 'b@example.com' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 2 });

      const allRows = await adapter.read<IndexedRecord>(tableName);
      expect(allRows).toHaveLength(2);
    });

    it('leaves no index behind when existing rows violate the unique constraint', async () => {
      const tableName = trackTable('idxfs_build_conflict');
      await adapter.createTable(tableName);
      await adapter.insert(tableName, [
        { id: 1, email: 'dup@example.com' },
        { id: 2, email: 'dup@example.com' },
      ]);

      await expect(adapter.createIndex(tableName, 'email', true)).rejects.toMatchObject({
        code: 'TABLE_INDEX_NOT_UNIQUE',
      });

      expect(metadataManager.get(tableName)?.indexes?.email_unique).toBeUndefined();

      // Without the index, duplicates remain insertable.
      await expect(adapter.insert(tableName, [{ id: 3, email: 'dup@example.com' }])).resolves.toBeDefined();
    });
  });

  describe('restart restoration', () => {
    it('restores index enforcement in a new adapter instance loading the same metadata', async () => {
      const tableName = trackTable('idxfs_restart');
      await adapter.createTable(tableName, {
        indexes: [{ field: 'email', unique: true }],
        initialData: [{ id: 1, email: 'a@example.com' }],
      });
      await metadataManager.saveImmediately();

      const restarted = new FileSystemStorageAdapter();
      try {
        await expect(restarted.insert(tableName, [{ id: 2, email: 'a@example.com' }])).rejects.toMatchObject({
          code: 'TABLE_INDEX_NOT_UNIQUE',
        });

        await expect(restarted.insert(tableName, [{ id: 3, email: 'b@example.com' }])).resolves.toBeDefined();

        const rows = await restarted.read<IndexedRecord>(tableName, { filter: { email: 'b@example.com' } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 3 });
      } finally {
        if (await restarted.hasTable(tableName)) {
          await restarted.deleteTable(tableName);
        }
        await restarted.cleanup();
      }
    });
  });
});
