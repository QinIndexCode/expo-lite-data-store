import { StorageError } from '../../../types/storageErrorInfc';
import { meta } from '../../meta/MetadataManager';
import { IndexManager, IndexType } from '../IndexManager';

describe('IndexManager', () => {
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    indexManager = new IndexManager(meta);

    meta.delete(testTableName);

    meta.update(testTableName, {
      mode: 'single',
      path: testTableName + '.ldb',
      count: 0,
      chunks: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      columns: {
        id: 'string',
        name: 'string',
        age: 'number',
      },
      indexes: {},
    });
  });

  afterEach(() => {
    meta.cleanup();
  });

  describe('createIndex', () => {
    it('creates a normal index', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(1);
      expect(indexes[0].name).toBe('name_normal');
      expect(indexes[0].type).toBe(IndexType.NORMAL);
      expect(indexes[0].fields).toEqual(['name']);
    });

    it('creates a unique index', async () => {
      await indexManager.createIndex(testTableName, 'id', IndexType.UNIQUE);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(1);
      expect(indexes[0].name).toBe('id_unique');
      expect(indexes[0].type).toBe(IndexType.UNIQUE);
      expect(indexes[0].fields).toEqual(['id']);
    });

    it('rejects duplicate index creation', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      await expect(indexManager.createIndex(testTableName, 'name', IndexType.NORMAL)).rejects.toThrow(StorageError);
    });

    it('rejects index creation for a nonexistent table', async () => {
      await expect(indexManager.createIndex('non_existent_table', 'name', IndexType.NORMAL)).rejects.toThrow(
        StorageError
      );
    });

    it('rejects an empty index field', async () => {
      await expect(indexManager.createIndex(testTableName, '', IndexType.NORMAL)).rejects.toThrow(StorageError);
    });
  });

  describe('dropIndex', () => {
    it('removes an index', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      await indexManager.dropIndex(testTableName, 'name', IndexType.NORMAL);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(0);
    });

    it('rejects deletion of a nonexistent index', async () => {
      await expect(indexManager.dropIndex(testTableName, 'non_existent_field', IndexType.NORMAL)).rejects.toThrow(
        StorageError
      );
    });
  });

  describe('addToIndex', () => {
    it('adds data to an index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const data = { id: '1', name: 'test', age: 25 };
      indexManager.addToIndex(testTableName, data);

      const result = indexManager.queryIndex(testTableName, 'name', 'test');
      expect(result).toEqual(['1']);
    });

    it('rejects a duplicate value in a unique index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.UNIQUE);

      const data1 = { id: '1', name: 'test', age: 25 };
      const data2 = { id: '2', name: 'test', age: 30 };

      indexManager.addToIndex(testTableName, data1);
      expect(() => indexManager.addToIndex(testTableName, data2)).toThrow(StorageError);
    });

    it('disables query acceleration while a matching record has no stable ID', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const stableRecord = { id: '1', name: 'test', age: 25 };
      const noIdRecord = { name: 'test', age: 30 };
      indexManager.addToIndex(testTableName, stableRecord);
      indexManager.addToIndex(testTableName, noIdRecord);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(false);
      expect(indexManager.queryIndex(testTableName, 'name', 'test')).toEqual([]);

      indexManager.removeFromIndex(testTableName, noIdRecord);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.queryIndex(testTableName, 'name', 'test')).toEqual(['1']);
    });

    it('enforces unique indexes for records without a stable ID', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.UNIQUE);

      indexManager.addToIndex(testTableName, { name: 'duplicate', age: 25 });

      expect(() => indexManager.addToIndex(testTableName, { name: 'duplicate', age: 30 })).toThrow(StorageError);
    });

    it('treats non-finite numeric IDs as unstable without bypassing unique constraints', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.UNIQUE);

      indexManager.addToIndex(testTableName, { id: Number.POSITIVE_INFINITY, name: 'duplicate' });

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(false);
      expect(indexManager.queryIndex(testTableName, 'name', 'duplicate')).toEqual([]);
      expect(() => indexManager.addToIndex(testTableName, { id: Number.NaN, name: 'duplicate' })).toThrow(StorageError);
    });

    it('keeps negative zero compatible with its persisted zero representation', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      indexManager.addToIndex(testTableName, { id: -0, name: 'zero' });

      const indexedIds = new Set(indexManager.queryIndex(testTableName, 'name', 'zero'));
      expect(indexedIds.has(0)).toBe(true);
      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
    });

    it('uses _id when id is absent and prefers id when both exist', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      indexManager.addToIndex(testTableName, { _id: 'legacy-1', name: 'legacy' });
      indexManager.addToIndex(testTableName, { id: 'primary-1', _id: 'legacy-2', name: 'primary' });

      expect(indexManager.queryIndex(testTableName, 'name', 'legacy')).toEqual(['legacy-1']);
      expect(indexManager.queryIndex(testTableName, 'name', 'primary')).toEqual(['primary-1']);
    });

    it('keeps the index map and hot bucket by reference during append updates', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      indexManager.addToIndex(testTableName, { id: '1', name: 'alpha' });
      indexManager.addToIndex(testTableName, { id: '2', name: 'beta' });

      const index = indexManager.getTableIndexes(testTableName)[0];
      if (!index) {
        throw new Error('Expected the test index to exist');
      }
      const indexData = index.data;
      const untouchedBucket = index.data.get(JSON.stringify(['alpha']));
      const hotBucket = index.data.get(JSON.stringify(['beta']));

      indexManager.addToIndex(testTableName, { id: '3', name: 'beta' });

      expect(index.data).toBe(indexData);
      expect(index.data.get(JSON.stringify(['alpha']))).toBe(untouchedBucket);
      expect(index.data.get(JSON.stringify(['beta']))).toBe(hotBucket);
      expect(indexManager.queryIndex(testTableName, 'name', 'beta')).toEqual(['2', '3']);
    });
  });

  describe('removeFromIndex', () => {
    it('removes data from an index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const data = { id: '1', name: 'test', age: 25 };
      indexManager.addToIndex(testTableName, data);

      let result = indexManager.queryIndex(testTableName, 'name', 'test');
      expect(result).toEqual(['1']);

      indexManager.removeFromIndex(testTableName, data);
      result = indexManager.queryIndex(testTableName, 'name', 'test');
      expect(result).toEqual([]);
    });
  });

  describe('updateIndex', () => {
    it('updates an index entry', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const oldData = { id: '1', name: 'old_name', age: 25 };
      const newData = { id: '1', name: 'new_name', age: 25 };

      indexManager.addToIndex(testTableName, oldData);
      let result = indexManager.queryIndex(testTableName, 'name', 'old_name');
      expect(result).toEqual(['1']);

      indexManager.updateIndex(testTableName, oldData, newData);
      result = indexManager.queryIndex(testTableName, 'old_name', 'old_name');
      expect(result).toEqual([]);

      result = indexManager.queryIndex(testTableName, 'name', 'new_name');
      expect(result).toEqual(['1']);
    });
  });

  describe('queryIndex', () => {
    it('returns matching IDs from an index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      indexManager.createIndex(testTableName, 'age', IndexType.NORMAL);

      const data1 = { id: '1', name: 'test1', age: 25 };
      const data2 = { id: '2', name: 'test2', age: 30 };
      const data3 = { id: '3', name: 'test1', age: 35 };

      indexManager.addToIndex(testTableName, data1);
      indexManager.addToIndex(testTableName, data2);
      indexManager.addToIndex(testTableName, data3);

      let result = indexManager.queryIndex(testTableName, 'name', 'test1');
      expect(result).toEqual(['1', '3']);

      result = indexManager.queryIndex(testTableName, 'age', 30);
      expect(result).toEqual(['2']);
    });

    it('returns an empty array for a nonexistent index', () => {
      const result = indexManager.queryIndex(testTableName, 'non_existent_field', 'value');
      expect(result).toEqual([]);
    });
  });

  describe('hasIndex', () => {
    it('reports whether a field is indexed', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.hasIndex(testTableName, 'age')).toBe(false);
    });

    it('uses an index on existing data only after a complete rebuild', async () => {
      meta.update(testTableName, { count: 1 });
      await indexManager.createIndex(testTableName, 'name');

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(false);

      indexManager.rebuildIndexes(testTableName, [{ id: '1', name: 'test' }]);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.queryIndex(testTableName, 'name', 'test')).toEqual(['1']);
    });

    it('keeps a rebuilt index out of query acceleration when a row has no stable ID', async () => {
      meta.update(testTableName, { count: 2 });
      await indexManager.createIndex(testTableName, 'name');

      indexManager.rebuildIndexes(testTableName, [{ id: '1', name: 'test' }, { name: 'test' }]);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(false);
      expect(indexManager.queryIndex(testTableName, 'name', 'test')).toEqual([]);
    });
  });

  describe('clearTableIndexes', () => {
    it('clears all indexes for a table', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      indexManager.createIndex(testTableName, 'age', IndexType.NORMAL);

      let indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(2);

      indexManager.clearTableIndexes(testTableName);
      indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(0);
    });
  });
});
