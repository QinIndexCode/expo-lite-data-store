import {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  overwrite,
  read,
  countTable,
  verifyCountTable,
  findOne,
  findMany,
  remove,
  bulkWrite,
  beginTransaction,
  commit,
  rollback,
  migrateToChunked,
  update,
  clearTable,
} from '../../expo-lite-data-store';
import { dbManager } from '../../core/db';
import storage from '../../core/adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from '../../core/EncryptedStorageAdapter';
import type { IStorageAdapter } from '../../types/storageAdapterInfc';

type EncryptedAdapterKeyAccess = {
  key: () => Promise<string>;
};

const getEncryptedAdapterKeyAccess = (adapter: EncryptedStorageAdapter): EncryptedAdapterKeyAccess =>
  adapter as unknown as EncryptedAdapterKeyAccess;

const asStorageAdapter = (adapter: object): IStorageAdapter => adapter as unknown as IStorageAdapter;

const removeTableIfPresent = async (tableName: string): Promise<void> => {
  if (await storage.hasTable(tableName)) {
    await storage.deleteTable(tableName);
  }
};

describe('public API', () => {
  const TEST_TABLE_PREFIX = 'api_test_';
  let testTable: string;
  let testTableSequence = 0;

  beforeEach(() => {
    testTable = `${TEST_TABLE_PREFIX}${Date.now()}_${++testTableSequence}`;
  });

  afterAll(async () => {
    const tables = await listTables({});
    for (const table of tables) {
      if (table.startsWith(TEST_TABLE_PREFIX)) {
        await deleteTable(table);
      }
    }
  });

  describe('table management', () => {
    it('does not allow the default public surface to bypass a strict table', async () => {
      const strictTable = `${TEST_TABLE_PREFIX}strict_${Date.now()}`;
      const strictAdapter = new EncryptedStorageAdapter({ requireAuthOnAccess: true });
      const keySpy = jest
        .spyOn(getEncryptedAdapterKeyAccess(strictAdapter), 'key')
        .mockResolvedValue('strict-test-key');

      try {
        await strictAdapter.createTable(strictTable, { encrypted: true });

        await expect(overwrite(strictTable, [{ id: 1, value: 'blocked' }])).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        await expect(read(strictTable, { encrypted: false })).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        await expect(listTables()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      } finally {
        keySpy.mockRestore();
        await removeTableIfPresent(strictTable);
      }
    });

    it('does not route a normal encrypted table through the plain facade', async () => {
      const encryptedTable = `${TEST_TABLE_PREFIX}encrypted_${Date.now()}`;
      const encryptedAdapter = new EncryptedStorageAdapter();
      const keySpy = jest
        .spyOn(getEncryptedAdapterKeyAccess(encryptedAdapter), 'key')
        .mockResolvedValue('encrypted-test-key');

      try {
        await encryptedAdapter.createTable(encryptedTable, { encrypted: true, encryptFullTable: true });

        await expect(read(encryptedTable)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        await expect(overwrite(encryptedTable, [{ id: 1, value: 'blocked' }])).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
      } finally {
        keySpy.mockRestore();
        await removeTableIfPresent(encryptedTable);
      }
    });

    it('routes an encryptedFields table through the encrypted facade', async () => {
      const encryptedTable = `${TEST_TABLE_PREFIX}fields_${Date.now()}_${++testTableSequence}`;

      try {
        await createTable(encryptedTable, {
          encryptedFields: ['secret'],
          initialData: [{ id: 1, secret: 'classified', visible: 'plain' }],
        });

        expect(storage.getTableMeta(encryptedTable)).toMatchObject({
          encrypted: true,
          encryptedFields: ['secret'],
        });
        await expect(read(encryptedTable)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        await expect(read(encryptedTable, { encrypted: true, bypassCache: true })).resolves.toEqual([
          { id: 1, secret: 'classified', visible: 'plain' },
        ]);
      } finally {
        await deleteTable(encryptedTable, { encrypted: true });
      }
    });

    it('serializes an ordinary insert behind a paused strict table creation', async () => {
      const strictTable = `${TEST_TABLE_PREFIX}strict_policy_lock_${Date.now()}_${++testTableSequence}`;
      let releaseStrictCreate: () => void = () => undefined;
      const strictCreateGate = new Promise<void>(resolve => {
        releaseStrictCreate = resolve;
      });
      let signalStrictCreateStarted: () => void = () => undefined;
      const strictCreateStarted = new Promise<void>(resolve => {
        signalStrictCreateStarted = resolve;
      });
      const strictAdapter = {
        createTable: jest.fn(async (...args: Parameters<IStorageAdapter['createTable']>) => {
          const [tableName, options] = args;
          signalStrictCreateStarted();
          await strictCreateGate;
          await storage.createTable(tableName, options);
        }),
      };
      const plainAdapter = {
        insert: jest.fn((...args: Parameters<IStorageAdapter['insert']>) => storage.insert(...args)),
      };
      const getDbInstanceSpy = jest
        .spyOn(dbManager, 'getDbInstance')
        .mockImplementation((encrypted, requireAuthOnAccess) =>
          asStorageAdapter(encrypted && requireAuthOnAccess ? strictAdapter : plainAdapter)
        );
      let strictCreation: Promise<void> | undefined;
      let ordinaryInsert: Promise<unknown> | undefined;

      try {
        strictCreation = createTable(strictTable, { encrypted: true, requireAuthOnAccess: true });
        await strictCreateStarted;

        ordinaryInsert = insert(strictTable, { id: 'plain-write' });
        await Promise.resolve();
        await Promise.resolve();
        expect(plainAdapter.insert).not.toHaveBeenCalled();

        releaseStrictCreate();
        await strictCreation;

        await expect(ordinaryInsert).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(plainAdapter.insert).not.toHaveBeenCalled();
        expect(storage.getTableMeta(strictTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: true,
        });
        await expect(storage.read(strictTable, { bypassCache: true })).resolves.toEqual([]);
      } finally {
        releaseStrictCreate();
        if (strictCreation) {
          await Promise.allSettled([strictCreation]);
        }
        if (ordinaryInsert) {
          await Promise.allSettled([ordinaryInsert]);
        }
        getDbInstanceSpy.mockRestore();
        await removeTableIfPresent(strictTable);
      }
    });

    it('revalidates a plain table list when a strict table appears after precheck', async () => {
      const strictTable = `${TEST_TABLE_PREFIX}strict_list_race_${Date.now()}_${++testTableSequence}`;
      const plainAdapter = {
        listTables: jest.fn(async () => {
          await storage.createTable(strictTable, { encrypted: true, requireAuthOnAccess: true });
          return [strictTable];
        }),
      };
      const getDbInstanceSpy = jest.spyOn(dbManager, 'getDbInstance').mockReturnValue(asStorageAdapter(plainAdapter));

      try {
        await expect(storage.hasTable(strictTable)).resolves.toBe(false);
        await expect(listTables()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(plainAdapter.listTables).toHaveBeenCalledTimes(1);
        expect(storage.getTableMeta(strictTable)).toMatchObject({
          encrypted: true,
          requireAuthOnAccess: true,
        });
      } finally {
        getDbInstanceSpy.mockRestore();
        await removeTableIfPresent(strictTable);
      }
    });

    it('creates, checks, and deletes a table', async () => {
      await createTable(testTable);
      expect(await hasTable(testTable)).toBe(true);

      await deleteTable(testTable);
      expect(await hasTable(testTable)).toBe(false);
    });

    it('lists multiple created tables', async () => {
      const tableNames = [
        `${TEST_TABLE_PREFIX}table1_${Date.now()}`,
        `${TEST_TABLE_PREFIX}table2_${Date.now()}`,
        `${TEST_TABLE_PREFIX}table3_${Date.now()}`,
      ];

      for (const tableName of tableNames) {
        await createTable(tableName);
      }

      const allTables = await listTables({});

      for (const tableName of tableNames) {
        expect(allTables).toContain(tableName);
      }

      for (const tableName of tableNames) {
        await deleteTable(tableName);
      }
    });

    it('clears records while preserving the table', async () => {
      await createTable(testTable);

      await insert(testTable, [
        { id: 1, name: 'Test 1' },
        { id: 2, name: 'Test 2' },
        { id: 3, name: 'Test 3' },
      ]);

      let data = await read(testTable);
      expect(data.length).toBe(3);

      await clearTable(testTable);

      data = await read(testTable);
      expect(data.length).toBe(0);
      expect(await hasTable(testTable)).toBe(true);

      await insert(testTable, { id: 4, name: 'Test 4' });
      data = await read(testTable);
      expect(data.length).toBe(1);
    });
  });

  describe('writes', () => {
    it('overwrites single and multiple records', async () => {
      await createTable(testTable);

      const singleResult = await overwrite(testTable, {
        id: 1,
        name: 'Single Record',
        value: 100,
      });
      expect(singleResult.written).toBe(1);
      expect(singleResult.totalAfterWrite).toBe(1);

      const multipleResult = await overwrite(testTable, [
        { id: 2, name: 'Multiple 1', value: 200 },
        { id: 3, name: 'Multiple 2', value: 300 },
      ]);
      expect(multipleResult.written).toBe(2);
      expect(multipleResult.totalAfterWrite).toBe(2);
    });

    it('appends records with insert', async () => {
      await createTable(testTable);

      await insert(testTable, [
        { id: 1, name: 'Initial 1', value: 100 },
        { id: 2, name: 'Initial 2', value: 200 },
      ]);

      const appendResult = await insert(testTable, [
        { id: 3, name: 'Appended 1', value: 300 },
        { id: 4, name: 'Appended 2', value: 400 },
      ]);

      expect(appendResult.written).toBe(2);
      expect(appendResult.totalAfterWrite).toBe(4);

      const data = await read(testTable);
      expect(data.length).toBe(4);
      expect(data[0].name).toBe('Initial 1');
      expect(data[2].name).toBe('Appended 1');
    });

    it('replaces records with overwrite', async () => {
      await createTable(testTable);

      await insert(testTable, [
        { id: 1, name: 'Original 1', value: 100 },
        { id: 2, name: 'Original 2', value: 200 },
      ]);

      const overwriteResult = await overwrite(testTable, [
        { id: 3, name: 'New 1', value: 300 },
        { id: 4, name: 'New 2', value: 400 },
      ]);

      expect(overwriteResult.written).toBe(2);
      expect(overwriteResult.totalAfterWrite).toBe(2);

      const data = await read(testTable);
      expect(data.length).toBe(2);
      expect(data[0].name).toBe('New 1');
      expect(data[1].name).toBe('New 2');
      expect(data.find(item => item.name === 'Original 1')).toBeUndefined();
    });

    it('inserts a single record', async () => {
      await createTable(testTable);

      const result = await insert(testTable, {
        id: 1,
        name: 'Single Insert',
        value: 100,
      });

      expect(result.written).toBe(1);
      expect(result.totalAfterWrite).toBe(1);

      const data = await read(testTable);
      expect(data.length).toBe(1);
      expect(data[0].name).toBe('Single Insert');
    });

    it('applies mixed bulk write operations', async () => {
      await createTable(testTable);

      await insert(testTable, [
        { id: 1, name: 'Initial 1', value: 100 },
        { id: 2, name: 'Initial 2', value: 200 },
      ]);

      const bulkResult = await bulkWrite(testTable, [
        {
          type: 'insert',
          data: { id: 3, name: 'Bulk Insert', value: 300 },
        },
        {
          type: 'update',
          data: { value: 150 },
          where: { id: 1 },
        },
        {
          type: 'delete',
          where: { id: 2 },
        },
      ]);

      expect(bulkResult.written).toBe(3);

      const data = await read(testTable);
      expect(data.length).toBe(2);

      const updatedItem = data.find(item => item.id === 1);
      expect(updatedItem?.value).toBe(150);

      const deletedItem = data.find(item => item.id === 2);
      expect(deletedItem).toBeUndefined();

      const insertedItem = data.find(item => item.id === 3);
      expect(insertedItem).toBeDefined();
    });
  });

  describe('reads', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Item 1', category: 'A', value: 100, active: true },
        { id: 2, name: 'Item 2', category: 'B', value: 200, active: false },
        { id: 3, name: 'Item 3', category: 'A', value: 300, active: true },
        { id: 4, name: 'Item 4', category: 'C', value: 400, active: true },
        { id: 5, name: 'Item 5', category: 'B', value: 500, active: false },
      ]);
    });

    it('reads all records', async () => {
      const data = await read(testTable);
      expect(data.length).toBe(5);
      expect(data[0].id).toBe(1);
      expect(data[4].id).toBe(5);
    });

    it('finds one record under different predicates', async () => {
      const byId = await findOne<{ id: number; name: string }>(testTable, { where: { id: 3 } });
      expect(byId?.name).toBe('Item 3');

      const byCategory = await findOne<{ id: number; category: string; active: boolean }>(testTable, {
        where: { category: 'B', active: false },
      });
      expect(byCategory?.id).toBe(2);

      const notFound = await findOne(testTable, { where: { id: 100 } });
      expect(notFound).toBeNull();
    });

    it('filters, sorts, and paginates records', async () => {
      const activeItems = await findMany(testTable, { where: { active: true } });
      expect(activeItems.length).toBe(3);

      const sortedItems = await findMany<{ id: number; value: number; active: boolean }>(testTable, {
        where: { active: true },
        sortBy: 'value',
        order: 'desc',
      });
      expect(sortedItems.length).toBe(3);
      expect(sortedItems[0].value).toBe(400);
      expect(sortedItems[2].value).toBe(100);

      const paginatedItems = await findMany<{ id: number; category: string }>(testTable, {
        where: { category: 'A' },
        skip: 1,
        limit: 1,
      });
      expect(paginatedItems.length).toBe(1);
      expect(paginatedItems[0].id).toBe(3);
    });

    it('counts records before and after inserts', async () => {
      const count = await countTable(testTable);
      expect(count).toBe(5);

      await insert(testTable, {
        id: 6,
        name: 'Item 6',
        category: 'A',
        value: 600,
        active: true,
      });
      const updatedCount = await countTable(testTable);
      expect(updatedCount).toBe(6);
    });

    it('reports matching metadata and stored counts', async () => {
      const result = await verifyCountTable(testTable);
      expect(result.metadata).toBe(5);
      expect(result.actual).toBe(5);
      expect(result.match).toBe(true);
    });
  });

  describe('updates and deletes', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Update Test 1', value: 100, active: true },
        { id: 2, name: 'Update Test 2', value: 200, active: false },
        { id: 3, name: 'Update Test 3', value: 300, active: true },
      ]);
    });

    it('updates records selected by different conditions', async () => {
      const singleUpdate = await update(testTable, { value: 150 }, { where: { id: 1 } });
      expect(singleUpdate).toBe(1);

      const updatedItem = await findOne<{ id: number; value: number }>(testTable, { where: { id: 1 } });
      expect(updatedItem?.value).toBe(150);

      const multipleUpdate = await update(testTable, { active: true }, { where: { active: false } });
      expect(multipleUpdate).toBe(1);

      const allActiveItems = await findMany(testTable, { where: { active: true } });
      expect(allActiveItems.length).toBe(3);
    });

    it('removes records selected by different conditions', async () => {
      const singleRemove = await remove(testTable, { where: { id: 1 } });
      expect(singleRemove).toBe(1);

      const remaining = await read(testTable);
      expect(remaining.length).toBe(2);

      const multipleRemove = await remove(testTable, { where: { active: true } });
      expect(multipleRemove).toBe(1);

      const final = await read(testTable);
      expect(final.length).toBe(1);
      expect(final[0].id).toBe(2);
    });
  });

  describe('transactions', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [{ id: 1, name: 'Transaction Test', balance: 1000 }]);
    });

    it('commits a transaction', async () => {
      await beginTransaction({});

      await update(testTable, { balance: 1500 }, { where: { id: 1 } });
      await insert(testTable, { id: 2, name: 'New Item', balance: 500 });

      await commit({});

      const item1 = await findOne<{ id: number; balance: number }>(testTable, { where: { id: 1 } });
      const item2 = await findOne(testTable, { where: { id: 2 } });

      expect(item1?.balance).toBe(1500);
      expect(item2).toBeDefined();
    });

    it('rolls back a transaction', async () => {
      await beginTransaction({});

      await update(testTable, { balance: 1500 }, { where: { id: 1 } });
      await insert(testTable, { id: 2, name: 'Rollback Test', balance: 500 });

      await rollback({});

      const items = await read(testTable);
      expect(items.length).toBe(1);
      expect(items[0].balance).toBe(1000);
    });

    it('does not allow a public directWrite property to bypass transaction staging', async () => {
      await beginTransaction({});
      let transactionActive = true;

      try {
        const forgedOptions = Object.assign({ mode: 'append' as const }, { directWrite: true });
        await insert(testTable, { id: 2, name: 'Forged Direct Write', balance: 500 }, forgedOptions);

        await rollback({});
        transactionActive = false;

        await expect(read(testTable, { bypassCache: true })).resolves.toEqual([
          { id: 1, name: 'Transaction Test', balance: 1000 },
        ]);
      } finally {
        if (transactionActive) {
          await rollback({}).catch(() => undefined);
        }
      }
    });

    it('reports transaction counts and append totals from the staged table view', async () => {
      await beginTransaction({});
      let transactionActive = true;

      try {
        const firstInsert = await insert(testTable, { id: 2, name: 'Second Item', balance: 500 });
        expect(firstInsert.totalAfterWrite).toBe(2);
        await expect(countTable(testTable)).resolves.toBe(2);

        const secondInsert = await insert(testTable, [
          { id: 3, name: 'Third Item', balance: 300 },
          { id: 4, name: 'Fourth Item', balance: 200 },
        ]);
        expect(secondInsert.totalAfterWrite).toBe(4);
        await expect(storage.read(testTable, { limit: 1 })).resolves.toHaveLength(1);
        await expect(countTable(testTable)).resolves.toBe(4);
        await expect(read(testTable)).resolves.toHaveLength(4);

        const bulkResult = await bulkWrite(testTable, [
          { type: 'delete', where: { id: 2 } },
          {
            type: 'insert',
            data: [
              { id: 5, name: 'Fifth Item', balance: 100 },
              { id: 6, name: 'Sixth Item', balance: 50 },
            ],
          },
        ]);
        expect(bulkResult.totalAfterWrite).toBe(5);
        await expect(countTable(testTable)).resolves.toBe(5);
        await expect(read(testTable)).resolves.toHaveLength(5);

        await rollback({});
        transactionActive = false;
      } finally {
        if (transactionActive) {
          await rollback({}).catch(() => undefined);
        }
      }
    });

    it('commits multiple transaction operations', async () => {
      await beginTransaction({});
      let transactionActive = true;

      try {
        await update(testTable, { balance: 1200 }, { where: { id: 1 } });
        await insert(testTable, { id: 2, name: 'Complex Test', balance: 800 });
        await remove(testTable, { where: { id: 1 } });

        await commit({});
        transactionActive = false;

        const items = await read(testTable);
        expect(items.length).toBe(1);
        const item2 = items.find(item => item.id === 2);
        expect(item2).toBeDefined();
      } catch (error) {
        if (transactionActive) {
          await rollback({});
        }
        throw error;
      }
    });

    it('pins every public operation to the strict-auth transaction facade', async () => {
      const strictAdapter = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue({ written: 1, totalAfterWrite: 1, chunked: false }),
      };
      const plainAdapter = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue({ written: 1, totalAfterWrite: 1, chunked: false }),
      };
      const getDbInstanceSpy = jest
        .spyOn(dbManager, 'getDbInstance')
        .mockImplementation((encrypted, requireAuthOnAccess) =>
          asStorageAdapter(encrypted && requireAuthOnAccess ? strictAdapter : plainAdapter)
        );

      try {
        await beginTransaction({ encrypted: false, requireAuthOnAccess: true });
        await insert('strict_transaction_table', { id: 1 });

        await expect(insert('strict_transaction_table', { id: 2 }, { encryptFullTable: true })).rejects.toThrow(
          'Transaction security options must match the active transaction'
        );

        await expect(commit({ encrypted: true, requireAuthOnAccess: false })).rejects.toThrow(
          'Transaction security options must match the active transaction'
        );
        await commit();

        expect(getDbInstanceSpy).toHaveBeenCalledWith(true, true);
        expect(strictAdapter.insert).toHaveBeenCalledTimes(1);
        expect(strictAdapter.commit).toHaveBeenCalledTimes(1);
        expect(plainAdapter.insert).not.toHaveBeenCalled();
        expect(plainAdapter.commit).not.toHaveBeenCalled();
      } finally {
        if (strictAdapter.commit.mock.calls.length === 0) {
          await rollback().catch(() => undefined);
        }
        getDbInstanceSpy.mockRestore();
      }
    });
  });

  describe('storage migrations', () => {
    it('migrates a large table to chunks', async () => {
      await createTable(testTable);

      // The fixture exceeds the single-file threshold and exercises chunk migration.
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Large Item ${i + 1}`,
        data: 'x'.repeat(500),
      }));
      await insert(testTable, largeData);

      await migrateToChunked(testTable);

      const migratedData = await read(testTable);
      expect(migratedData.length).toBe(100);

      const found = await findOne(testTable, { where: { id: 50 } });
      expect(found?.id).toBe(50);
    });
  });

  describe('complex queries', () => {
    beforeEach(async () => {
      await createTable(testTable);
      await insert(testTable, [
        { id: 1, name: 'Product 1', category: 'Electronics', price: 100, rating: 4.5, tags: ['a', 'b'], active: true },
        { id: 2, name: 'Product 2', category: 'Clothing', price: 50, rating: 3.8, tags: ['b', 'c'], active: true },
        { id: 3, name: 'Product 3', category: 'Electronics', price: 200, rating: 4.2, tags: ['a', 'c'], active: false },
        { id: 4, name: 'Product 4', category: 'Books', price: 20, rating: 4.7, tags: ['d'], active: true },
        { id: 5, name: 'Product 5', category: 'Clothing', price: 80, rating: 3.5, tags: ['a', 'b', 'c'], active: true },
      ]);
    });

    it('filters comparison and array operators', async () => {
      const expensiveItems = await findMany(testTable, {
        where: { price: { $gt: 80 } },
      });
      expect(expensiveItems.length).toBe(2);

      const mediumRatedItems = await findMany(testTable, {
        where: { rating: { $gte: 4.0, $lte: 4.5 } },
      });
      expect(mediumRatedItems.length).toBe(2);

      const taggedItems = await findMany(testTable, {
        where: { tags: { $in: ['a', 'd'] } },
      });
      expect(taggedItems.length).toBe(4);
    });

    it('evaluates logical query operators', async () => {
      const electronicsAndActive = await findMany(testTable, {
        where: { $and: [{ category: 'Electronics' }, { active: true }] },
      });
      expect(electronicsAndActive.length).toBe(1);

      const cheapOrHighRated = await findMany(testTable, {
        where: { $or: [{ price: { $lt: 50 } }, { rating: { $gt: 4.5 } }] },
      });
      expect(cheapOrHighRated.length).toBe(1);

      const complexQuery = await findMany(testTable, {
        where: {
          $and: [
            { active: true },
            {
              $or: [{ category: 'Clothing' }, { rating: { $gt: 4.5 } }],
            },
            { price: { $lt: 100 } },
          ],
        },
      });
      expect(complexQuery.length).toBe(3);
    });
  });
});
