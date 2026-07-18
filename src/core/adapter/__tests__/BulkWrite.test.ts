import { MetadataManager } from '../../meta/MetadataManager';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';

type UserRecord = {
  id: number;
  name: string;
  age?: number;
  active?: boolean;
};

describe('FileSystemStorageAdapter bulkWrite', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_bulk_write';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    if (await adapter.hasTable(tableName)) {
      await adapter.deleteTable(tableName);
    }
    await adapter.cleanup();
    metadataManager.cleanup();
  });

  describe('inserts', () => {
    it('inserts multiple records', async () => {
      const operations = [
        { type: 'insert' as const, data: { id: 1, name: 'Alice' } },
        { type: 'insert' as const, data: { id: 2, name: 'Bob' } },
        { type: 'insert' as const, data: { id: 3, name: 'Charlie' } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3);
      expect(result.totalAfterWrite).toBe(3);

      const allData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.find(record => record.id === 1)?.name).toBe('Alice');
    });

    it('inserts an array payload', async () => {
      const operations = [
        {
          type: 'insert' as const,
          data: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);
      const allData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(allData.length).toBe(2);
    });
  });

  describe('updates', () => {
    beforeEach(async () => {
      await adapter.overwrite(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 32, active: false },
      ]);
    });

    it('updates multiple records', async () => {
      const operations = [
        { type: 'update' as const, data: { age: 26 }, where: { id: 1 } },
        { type: 'update' as const, data: { age: 31 }, where: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const data1 = await adapter.findOne<UserRecord>(tableName, { id: 1 });
      const data2 = await adapter.findOne<UserRecord>(tableName, { id: 2 });

      expect(data1?.age).toBe(26);
      expect(data2?.age).toBe(31);
      expect(data1?.name).toBe('Alice');
    });

    it('updates records selected by a where condition', async () => {
      const operations = [
        {
          type: 'update' as const,
          data: { age: 40 },
          where: { active: true },
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3);

      const activeUsers = await adapter.findMany<UserRecord>(tableName, { active: true });
      expect(activeUsers.every(user => user.age === 40)).toBe(true);
    });

    it('updates records selected by a compound where condition', async () => {
      const operations = [
        {
          type: 'update' as const,
          data: { name: 'Updated' },
          where: { $and: [{ age: { $gt: 25 } }, { active: false }] },
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const updatedUsers = await adapter.findMany<UserRecord>(tableName, { name: 'Updated' });
      expect(updatedUsers.length).toBe(2);
      expect(updatedUsers.every(user => user.age !== undefined && user.age > 25 && user.active === false)).toBe(true);
    });

    it('updates zero records when no record matches', async () => {
      const operations = [{ type: 'update' as const, data: { age: 99 }, where: { id: 999 } }];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(0);
    });

    it('rejects array update payloads instead of applying the first item', async () => {
      const invalidUpdate = [{ age: 99 }] as unknown as UserRecord;

      await expect(adapter.update(tableName, invalidUpdate, { id: 1 })).rejects.toMatchObject({
        code: 'FILE_CONTENT_INVALID',
      });
      await expect(
        adapter.bulkWrite(tableName, [{ type: 'update', data: invalidUpdate, where: { id: 1 } }])
      ).rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' });

      await expect(adapter.findOne<UserRecord>(tableName, { id: 1 })).resolves.toMatchObject({ age: 25 });
    });
  });

  describe('deletes', () => {
    beforeEach(async () => {
      await adapter.overwrite(tableName, [
        { id: 1, name: 'Alice', age: 25, active: true },
        { id: 2, name: 'Bob', age: 30, active: true },
        { id: 3, name: 'Charlie', age: 35, active: false },
        { id: 4, name: 'David', age: 28, active: true },
        { id: 5, name: 'Eve', age: 32, active: false },
      ]);
    });

    it('deletes multiple records', async () => {
      const operations = [
        { type: 'delete' as const, where: { id: 1 } },
        { type: 'delete' as const, where: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const allData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.every(item => item.id !== 1 && item.id !== 2)).toBe(true);
    });

    it('deletes records selected by a where condition', async () => {
      const operations = [
        {
          type: 'delete' as const,
          where: { active: false },
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const allData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(allData.length).toBe(3);
      expect(allData.every(item => item.active === true)).toBe(true);
    });

    it('deletes records selected by a compound where condition', async () => {
      const operations = [
        {
          type: 'delete' as const,
          where: { $or: [{ age: { $lt: 27 } }, { age: { $gt: 33 } }] },
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(2);

      const remainingData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(remainingData.length).toBe(3);
      expect(remainingData.every(user => user.age !== undefined && user.age >= 27 && user.age <= 33)).toBe(true);
    });

    it('deletes records selected by multiple conditions', async () => {
      const operations = [
        {
          type: 'delete' as const,
          where: { $and: [{ name: 'Alice' }, { active: true }] },
        },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(1);

      const remainingData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(remainingData.length).toBe(4);
      expect(remainingData.every(item => item.name !== 'Alice')).toBe(true);
    });
  });

  describe('mixed operations', () => {
    it('applies insert, update, and delete operations together', async () => {
      await adapter.overwrite(tableName, [
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
      ]);

      const operations = [
        { type: 'insert' as const, data: { id: 3, name: 'Charlie', age: 35 } },
        { type: 'update' as const, data: { age: 26 }, where: { id: 1 } },
        { type: 'delete' as const, where: { id: 2 } },
      ];

      const result = await adapter.bulkWrite(tableName, operations);

      expect(result.written).toBe(3);

      const allData = await adapter.read<UserRecord>(tableName, { bypassCache: true });
      expect(allData.length).toBe(2);

      const alice = allData.find(record => record.id === 1);
      const charlie = allData.find(record => record.id === 3);

      expect(alice?.age).toBe(26);
      expect(charlie?.name).toBe('Charlie');
    });
  });

  describe('large batches', () => {
    it('writes every record in a large batch', async () => {
      const largeDataSet = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
        age: 20 + i,
      }));

      const operations = largeDataSet.map(item => ({
        type: 'insert' as const,
        data: item,
      }));
      const result = await adapter.bulkWrite(tableName, operations);

      expect(result).toMatchObject({ written: largeDataSet.length, totalAfterWrite: largeDataSet.length });
      await expect(adapter.count(tableName)).resolves.toBe(largeDataSet.length);
    });
  });
});
