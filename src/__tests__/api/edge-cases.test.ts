/// <reference path="../test-globals.d.ts" />

import {
  createTable,
  insert,
  read,
  update,
  remove,
  findOne,
  findMany,
  deleteTable,
  hasTable,
  beginTransaction,
  commit,
  rollback,
  bulkWrite,
  countTable,
} from '../../expo-lite-data-store';
import { getRootPathSync } from '../../utils/ROOTPath';

const asInvalidInput = <T>(value: unknown): T => value as T;

type FindManyOptions = NonNullable<Parameters<typeof findMany>[1]>;
type FindOneOptions = Parameters<typeof findOne>[1];
type InsertData = Parameters<typeof insert>[1];
type RemoveOptions = Parameters<typeof remove>[1];
type UpdateOptions = Parameters<typeof update>[2];
type UserRecord = { id: number; name: string };

describe('edge cases and failure handling', () => {
  const TEST_TABLE = 'edge_cases_test_table';

  beforeEach(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  describe('empty tables', () => {
    it('reads an empty table as an empty record list', async () => {
      await createTable(TEST_TABLE);
      const result = await read(TEST_TABLE);
      expect(result).toEqual([]);
    });

    it('returns null when finding one record in an empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await findOne(TEST_TABLE, { where: { id: 1 } });
      expect(result).toBeNull();
    });

    it('returns an empty list when finding records in an empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await findMany(TEST_TABLE, { where: { active: true } });
      expect(result).toEqual([]);
    });

    it('updates zero records in an empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await update(TEST_TABLE, { active: true }, { where: { id: 1 } });
      expect(result).toBe(0);
    });

    it('removes zero records from an empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await remove(TEST_TABLE, { where: { id: 1 } });
      expect(result).toBe(0);
    });

    it('counts zero records in an empty table', async () => {
      await createTable(TEST_TABLE);
      const result = await countTable(TEST_TABLE);
      expect(result).toBe(0);
    });
  });

  describe('large data operations', () => {
    it('inserts one thousand records at once', async () => {
      await createTable(TEST_TABLE);
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        value: i,
      }));

      const result = await insert(TEST_TABLE, largeData);
      expect(result.written).toBe(1000);
      expect(result.totalAfterWrite).toBe(1000);

      const count = await countTable(TEST_TABLE);
      expect(count).toBe(1000);
    });

    it('updates only existing records in an oversized bulk write', async () => {
      await createTable(TEST_TABLE);

      await insert(
        TEST_TABLE,
        Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          name: `Initial User ${i + 1}`,
          active: true,
        }))
      );

      const operations = Array.from({ length: 100 }, (_, i) => ({
        type: 'update' as const,
        data: { active: false },
        where: { id: i + 1 },
      }));

      const result = await bulkWrite(TEST_TABLE, operations);
      expect(result.written).toBe(50);

      const activeUsers = await findMany(TEST_TABLE, { where: { active: true } });
      expect(activeUsers.length).toBe(0);
    });
  });

  describe('invalid operations', () => {
    it('rejects an invalid insert payload type', async () => {
      await createTable(TEST_TABLE);
      await expect(insert(TEST_TABLE, asInvalidInput<InsertData>('invalid_data'))).rejects.toThrow();
    });

    it('updates zero records for an invalid where clause', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });
      const result = await update(
        TEST_TABLE,
        { name: 'Updated' },
        asInvalidInput<UpdateOptions>({ where: 'invalid_where' })
      );
      expect(result).toBe(0);
    });

    it('removes zero records for an invalid where clause', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });
      const result = await remove(TEST_TABLE, asInvalidInput<RemoveOptions>({ where: 'invalid_where' }));
      expect(result).toBe(0);
    });

    it('returns null for an invalid findOne where clause', async () => {
      await createTable(TEST_TABLE);
      const result = await findOne(TEST_TABLE, asInvalidInput<FindOneOptions>({ where: 'invalid_where' }));
      expect(result).toBeNull();
    });
  });

  describe('transaction edges', () => {
    it('rejects a nested transaction', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });

      await beginTransaction({});
      await update(TEST_TABLE, { name: 'Updated 1' }, { where: { id: 1 } });

      await expect(beginTransaction({})).rejects.toThrow('Transaction already in progress');

      await commit({});

      const user = await findOne<UserRecord>(TEST_TABLE, { where: { id: 1 } });
      expect(user?.name).toBe('Updated 1');
    });

    it('commits multiple transaction operations', async () => {
      await createTable(TEST_TABLE);

      await beginTransaction({});
      await insert(TEST_TABLE, { id: 1, name: 'User 1' });
      await insert(TEST_TABLE, { id: 2, name: 'User 2' });
      await commit({});

      const users = await findMany(TEST_TABLE);
      expect(users.length).toBe(2);
    });

    it('preserves existing records after an invalid transaction operation', async () => {
      await createTable(TEST_TABLE);
      await insert(TEST_TABLE, { id: 1, name: 'Test User' });

      await expect(insert(TEST_TABLE, asInvalidInput<InsertData>('invalid_data'))).rejects.toThrow();

      const user = await findOne<UserRecord>(TEST_TABLE, { where: { id: 1 } });
      expect(user?.name).toBe('Test User');
    });
  });

  describe('table management edges', () => {
    it('creates and deletes a table with a long name', async () => {
      const longTableName = 'a'.repeat(100);
      await createTable(longTableName);
      expect(await hasTable(longTableName)).toBe(true);
      await deleteTable(longTableName);
    });

    it('allows deleting a missing table repeatedly', async () => {
      await expect(deleteTable('non_existent_table')).resolves.not.toThrow();
      await expect(deleteTable('non_existent_table')).resolves.not.toThrow();
    });

    it('allows creating an existing table repeatedly', async () => {
      await createTable(TEST_TABLE);
      await expect(createTable(TEST_TABLE)).resolves.not.toThrow();
    });
  });

  describe('query option edges', () => {
    beforeEach(async () => {
      await createTable(TEST_TABLE);
      await insert(
        TEST_TABLE,
        Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          age: 18 + i,
          active: i % 2 === 0,
        }))
      );
    });

    it('returns an empty result for a skip beyond the record count', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, skip: 1000, limit: 5 });
      expect(users).toEqual([]);
    });

    it('caps a large limit at the record count', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, limit: 1000 });
      expect(users.length).toBe(20);
    });

    it('returns no records for a zero limit', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, skip: 0, limit: 0 });
      expect(users.length).toBe(0);
    });

    it('uses default behavior for omitted query options', async () => {
      const users1 = await findMany(TEST_TABLE, {});
      const users2 = await findMany(TEST_TABLE, undefined);
      expect(users1.length).toBe(20);
      expect(users2.length).toBe(20);
    });

    it('returns records for an unknown sort field', async () => {
      const users = await findMany(TEST_TABLE, { where: {}, sortBy: 'non_existent_field', order: 'asc' });
      expect(users.length).toBe(20);
    });

    it('uses a valid ordering fallback for an invalid order value', async () => {
      const users = await findMany(
        TEST_TABLE,
        asInvalidInput<FindManyOptions>({ where: {}, sortBy: 'age', order: 'invalid_order' })
      );
      expect(users.length).toBe(20);
    });
  });

  describe('mixed encryption modes', () => {
    const ENCRYPTED_TABLE = 'mixed_encrypted_table';
    const PLAIN_TABLE = 'mixed_plain_table';

    beforeEach(async () => {
      if (await hasTable(ENCRYPTED_TABLE, { encrypted: true })) {
        await deleteTable(ENCRYPTED_TABLE, { encrypted: true });
      }
      if (await hasTable(PLAIN_TABLE)) {
        await deleteTable(PLAIN_TABLE);
      }
    });

    afterAll(async () => {
      if (await hasTable(ENCRYPTED_TABLE, { encrypted: true })) {
        await deleteTable(ENCRYPTED_TABLE, { encrypted: true });
      }
      if (await hasTable(PLAIN_TABLE)) {
        await deleteTable(PLAIN_TABLE);
      }
    });

    it('keeps encrypted and plain tables independent', async () => {
      await createTable(ENCRYPTED_TABLE, { encrypted: true });
      await insert(ENCRYPTED_TABLE, { id: 1, name: 'Encrypted User' }, { encrypted: true });

      await createTable(PLAIN_TABLE, { encrypted: false });
      await insert(PLAIN_TABLE, { id: 1, name: 'Plain User' });

      const encryptedUser = await findOne<UserRecord>(ENCRYPTED_TABLE, { where: { id: 1 }, encrypted: true });
      const plainUser = await findOne<UserRecord>(PLAIN_TABLE, { where: { id: 1 } });

      expect(encryptedUser?.name).toBe('Encrypted User');
      expect(plainUser?.name).toBe('Plain User');
    });

    it('rejects a cross-surface operation within an encrypted transaction', async () => {
      await createTable(ENCRYPTED_TABLE, { encrypted: true });
      await createTable(PLAIN_TABLE, { encrypted: false });

      await beginTransaction({ encrypted: true });
      try {
        await insert(ENCRYPTED_TABLE, { id: 1, name: 'Encrypted User' }, { encrypted: true });
        await expect(insert(PLAIN_TABLE, { id: 1, name: 'Plain User' }, { encrypted: false })).rejects.toThrow(
          'Transaction security options must match the active transaction'
        );
      } finally {
        await rollback({ encrypted: true });
      }

      expect(await findOne(ENCRYPTED_TABLE, { where: { id: 1 }, encrypted: true })).toBeNull();
      expect(await findOne(PLAIN_TABLE, { where: { id: 1 } })).toBeNull();
    });
  });

  describe('corrupted data', () => {
    it('rejects corrupted single-file table data', async () => {
      await createTable(TEST_TABLE);

      await insert(TEST_TABLE, { id: 1, name: 'Valid User' });

      const dataFilePath = `${getRootPathSync()}${TEST_TABLE}.ldb`;
      global.__expo_file_system_mock__.mockFileSystem[dataFilePath] = '{ invalid json data }';

      await expect(read(TEST_TABLE)).rejects.toThrow();
    });
  });
});
