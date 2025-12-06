// src/core/index/__tests__/IndexManager.test.ts
import { StorageError } from '../../../types/storageErrorInfc';
import { meta } from '../../meta/MetadataManager';
import { IndexManager, IndexType } from '../IndexManager';

describe('IndexManager', () => {
  let indexManager: IndexManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    // 创建新的IndexManager实例
    indexManager = new IndexManager(meta);

    // 清除元数据
    meta.delete(testTableName);

    // 创建测试表元数据
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

  describe('createIndex', () => {
    it('should be able to create normal index', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(1);
      expect(indexes[0].name).toBe('name_normal');
      expect(indexes[0].type).toBe(IndexType.NORMAL);
      expect(indexes[0].fields).toEqual(['name']);
    });

    it('should be able to create unique index', async () => {
      await indexManager.createIndex(testTableName, 'id', IndexType.UNIQUE);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(1);
      expect(indexes[0].name).toBe('id_unique');
      expect(indexes[0].type).toBe(IndexType.UNIQUE);
      expect(indexes[0].fields).toEqual(['id']);
    });

    it('should throw error when creating duplicate index', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      await expect(indexManager.createIndex(testTableName, 'name', IndexType.NORMAL)).rejects.toThrow(StorageError);
    });

    it('should throw error when table does not exist', async () => {
      await expect(indexManager.createIndex('non_existent_table', 'name', IndexType.NORMAL)).rejects.toThrow(
        StorageError
      );
    });

    it('should throw error when field name is empty', async () => {
      await expect(indexManager.createIndex(testTableName, '', IndexType.NORMAL)).rejects.toThrow(StorageError);
    });
  });

  describe('dropIndex', () => {
    it('should be able to drop index', async () => {
      await indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);
      await indexManager.dropIndex(testTableName, 'name', IndexType.NORMAL);
      const indexes = indexManager.getTableIndexes(testTableName);
      expect(indexes.length).toBe(0);
    });

    it('should throw error when index does not exist', async () => {
      await expect(indexManager.dropIndex(testTableName, 'non_existent_field', IndexType.NORMAL)).rejects.toThrow(
        StorageError
      );
    });
  });

  describe('addToIndex', () => {
    it('should be able to add data to index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const data = { id: '1', name: 'test', age: 25 };
      indexManager.addToIndex(testTableName, data);

      const result = indexManager.queryIndex(testTableName, 'name', 'test');
      expect(result).toEqual(['1']);
    });

    it('should throw error when violating unique constraint', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.UNIQUE);

      const data1 = { id: '1', name: 'test', age: 25 };
      const data2 = { id: '2', name: 'test', age: 30 };

      indexManager.addToIndex(testTableName, data1);
      expect(() => indexManager.addToIndex(testTableName, data2)).toThrow(StorageError);
    });

    it('should skip data without ID', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      const data = { name: 'test', age: 25 }; // No ID
      expect(() => indexManager.addToIndex(testTableName, data)).not.toThrow();
    });
  });

  describe('removeFromIndex', () => {
    it('should be able to remove data from index', () => {
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
    it('should be able to update index', () => {
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
    it('should be able to query index', () => {
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

    it('should return empty array when index does not exist', () => {
      const result = indexManager.queryIndex(testTableName, 'non_existent_field', 'value');
      expect(result).toEqual([]);
    });
  });

  describe('hasIndex', () => {
    it('should be able to check if field has index', () => {
      indexManager.createIndex(testTableName, 'name', IndexType.NORMAL);

      expect(indexManager.hasIndex(testTableName, 'name')).toBe(true);
      expect(indexManager.hasIndex(testTableName, 'age')).toBe(false);
    });
  });

  describe('clearTableIndexes', () => {
    it('should be able to clear all indexes for table', () => {
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
