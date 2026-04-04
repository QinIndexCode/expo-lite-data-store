/**
 * @module IndexManager
 * @description Index manager for unique and non-unique field indexing
 * @since 2025-11-28
 * @version 1.0.0
 */
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { StorageError } from '../../types/storageErrorInfc';
/**
 * Index type enum
 */
export enum IndexType {
  UNIQUE = 'unique',
  NORMAL = 'normal',
}

/**
 * Index item interface
 */
export interface IndexItem {
  value: any;
  id: string | number;
}

/**
 * Index interface
 */
export interface Index {
  name: string;
  type: IndexType;
  fields: string[]; // Supports composite indexes
  data: Map<string, IndexItem[]>; // Stringified composite values as keys
}

/**
 * Index manager class for creating, querying, and updating indexes
 */
export class IndexManager {
  /**
   * Index cache
   */
  private indexCache = new Map<string, Map<string, Index>>(); // tableName -> indexName -> Index

  /**
   * Metadata manager instance
   */
  private metadataManager: IMetadataManager;

  /**
   * Constructor
   */
  constructor(metadataManager: IMetadataManager) {
    this.metadataManager = metadataManager;
  }

  /**
   * Create an index
   */
  async createIndex(tableName: string, fields: string | string[], type: IndexType = IndexType.NORMAL): Promise<void> {
    if (!tableName?.trim()) {
      throw new StorageError('Table name cannot be empty', 'TABLE_NAME_INVALID', {
        details: 'Table name is required to create an index',
        suggestion: 'Please provide a valid table name',
      });
    }

    const indexFields = Array.isArray(fields) ? fields : [fields];

    if (indexFields.length === 0) {
      throw new StorageError('Field name cannot be empty', 'TABLE_INDEX_INVALID', {
        details: 'Field name is required to create an index',
        suggestion: 'Please provide a valid field name or array of field names',
      });
    }

    for (const field of indexFields) {
      if (!field?.trim()) {
        throw new StorageError('Field name cannot be empty', 'TABLE_INDEX_INVALID', {
          details: 'All field names must be non-empty strings',
          suggestion: 'Please provide valid field names',
        });
      }
    }

    if (!this.metadataManager.get(tableName)) {
      throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
        details: `Cannot create index on non-existent table: ${tableName}`,
        suggestion: 'Create the table first before creating an index',
      });
    }

    const indexName = `${indexFields.join('_')}_${type}`;

    if (!this.indexCache.has(tableName)) {
      this.indexCache.set(tableName, new Map());
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    if (tableIndexes.has(indexName)) {
      throw new StorageError(`Index ${indexName} already exists on table ${tableName}`, 'TABLE_INDEX_ALREADY_EXISTS', {
        details: `An index with name ${indexName} already exists on table ${tableName}`,
        suggestion: 'Use different field names or drop the existing index first',
      });
    }

    const index: Index = {
      name: indexName,
      type,
      fields: indexFields,
      data: new Map(),
    };

    tableIndexes.set(indexName, index);

    const tableMeta = this.metadataManager.get(tableName);
    if (tableMeta) {
      this.metadataManager.update(tableName, {
        indexes: {
          ...tableMeta.indexes,
          [indexName]: type,
        },
      });
    }
  }

  /**
   * Drop an index
   */
  async dropIndex(tableName: string, fields: string | string[], type: IndexType = IndexType.NORMAL): Promise<void> {
    if (!tableName?.trim()) {
      throw new StorageError('Table name cannot be empty', 'TABLE_NAME_INVALID');
    }

    const indexFields = Array.isArray(fields) ? fields : [fields];

    if (indexFields.length === 0) {
      throw new StorageError('Field name cannot be empty', 'TABLE_INDEX_INVALID');
    }

    const indexName = `${indexFields.join('_')}_${type}`;

    if (!this.indexCache.has(tableName)) {
      throw new StorageError(`Index ${indexName} not found on table ${tableName}`, 'TABLE_INDEX_NOT_FOUND');
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    if (!tableIndexes.has(indexName)) {
      throw new StorageError(`Index ${indexName} not found on table ${tableName}`, 'TABLE_INDEX_NOT_FOUND');
    }

    tableIndexes.delete(indexName);

    const tableMeta = this.metadataManager.get(tableName);
    if (tableMeta?.indexes) {
      const newIndexes = { ...tableMeta.indexes };
      delete newIndexes[indexName];
      this.metadataManager.update(tableName, {
        indexes: newIndexes,
      });
    }
  }

  /**
   * Generate composite index key
   */
  private generateCompositeKey(values: any[]): string {
    return JSON.stringify(values);
  }

  /**
   * Add data to indexes
   */
  addToIndex(tableName: string, data: Record<string, any>): void {
    if (!this.indexCache.has(tableName)) {
      return;
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const id = data['id'];

    if (!id) {
      return;
    }

    for (const [indexName, index] of tableIndexes.entries()) {
      const fieldValues = index.fields.map(field => data[field]);

      if (fieldValues.some(value => value === undefined)) {
        continue;
      }

      const compositeKey = this.generateCompositeKey(fieldValues);

      if (!index.data.has(compositeKey)) {
        index.data.set(compositeKey, []);
      }

      const indexItems = index.data.get(compositeKey)!;

      if (index.type === IndexType.UNIQUE) {
        if (indexItems.length > 0) {
          throw new StorageError(
            `Unique constraint violated for index ${indexName} on fields ${index.fields.join(', ')}`,
            'TABLE_INDEX_NOT_UNIQUE',
            {
              details: `Value '${compositeKey}' already exists in unique index ${indexName}`,
              suggestion: 'Use a different combination of values for the fields or drop the unique constraint',
            }
          );
        }
      }

      indexItems.push({
        value: fieldValues.length === 1 ? fieldValues[0] : fieldValues,
        id,
      });
    }
  }

  /**
   * Remove data from indexes
   */
  removeFromIndex(tableName: string, data: Record<string, any>): void {
    if (!this.indexCache.has(tableName)) {
      return;
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const id = data['id'];

    if (!id) {
      return;
    }

    for (const [, index] of tableIndexes.entries()) {
      const fieldValues = index.fields.map(field => data[field]);

      if (fieldValues.some(value => value === undefined)) {
        continue;
      }

      const compositeKey = this.generateCompositeKey(fieldValues);

      if (!index.data.has(compositeKey)) {
        continue;
      }

      const indexItems = index.data.get(compositeKey)!;
      const indexToRemove = indexItems.findIndex(item => item.id === id);

      if (indexToRemove !== -1) {
        indexItems.splice(indexToRemove, 1);
      }

      if (indexItems.length === 0) {
        index.data.delete(compositeKey);
      }
    }
  }

  /**
   * Update index (remove old, add new)
   */
  updateIndex(tableName: string, oldData: Record<string, any>, newData: Record<string, any>): void {
    this.removeFromIndex(tableName, oldData);
    this.addToIndex(tableName, newData);
  }

  /**
   * Batch rebuild indexes (3-5x faster than adding items one by one)
   */
  rebuildIndexes(tableName: string, data: Record<string, any>[]): void {
    if (!this.indexCache.has(tableName)) {
      return;
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    if (tableIndexes.size === 0) {
      return;
    }

    for (const [, index] of tableIndexes.entries()) {
      index.data = new Map();

      for (const item of data) {
        const id = item['id'];
        if (id === undefined) continue;

        const fieldValues = index.fields.map(field => item[field]);
        if (fieldValues.some(value => value === undefined)) continue;

        const compositeKey = this.generateCompositeKey(fieldValues);

        if (!index.data.has(compositeKey)) {
          index.data.set(compositeKey, []);
        }

        const indexItems = index.data.get(compositeKey)!;

        if (index.type === IndexType.UNIQUE && indexItems.length > 0) {
          throw new StorageError(
            `Unique constraint violated for index ${index.name} on fields ${index.fields.join(', ')}`,
            'TABLE_INDEX_NOT_UNIQUE',
            {
              details: `Value '${compositeKey}' already exists in unique index ${index.name}`,
              suggestion: 'Use a different combination of values for the fields or drop the unique constraint',
            }
          );
        }

        indexItems.push({
          value: fieldValues.length === 1 ? fieldValues[0] : fieldValues,
          id,
        });
      }
    }
  }

  /**
   * Query index for matching data IDs
   */
  queryIndex(tableName: string, fields: string | string[], values: any | any[]): string[] | number[] {
    if (!this.indexCache.has(tableName)) {
      return [];
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const queryFields = Array.isArray(fields) ? fields : [fields];
    const queryValues = Array.isArray(values) ? values : [values];

    let matchingIndex: Index | undefined;
    for (const [, index] of tableIndexes.entries()) {
      if (index.fields.length === queryFields.length) {
        const fieldsMatch = index.fields.every((field, idx) => field === queryFields[idx]);
        if (fieldsMatch) {
          matchingIndex = index;
          break;
        }
      }
    }

    if (!matchingIndex) {
      return [];
    }

    const compositeKey = this.generateCompositeKey(queryValues);

    const indexItems = matchingIndex.data.get(compositeKey);
    if (!indexItems || indexItems.length === 0) {
      return [];
    }

    const firstId = indexItems[0]?.['id'];
    if (typeof firstId === 'string') {
      return indexItems.map(item => item['id'] as string);
    } else {
      return indexItems.map(item => item['id'] as number);
    }
  }

  /**
   * Get all indexes for a table
   */
  getTableIndexes(tableName: string): Index[] {
    if (!this.indexCache.has(tableName)) {
      return [];
    }

    return Array.from(this.indexCache.get(tableName)!.values());
  }

  /**
   * Check if a field or field combination has an index
   */
  hasIndex(tableName: string, fields: string | string[]): boolean {
    if (!this.indexCache.has(tableName)) {
      return false;
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const checkFields = Array.isArray(fields) ? fields : [fields];

    for (const [, index] of tableIndexes.entries()) {
      if (index.fields.length === checkFields.length) {
        const fieldsMatch = index.fields.every((field, idx) => field === checkFields[idx]);
        if (fieldsMatch) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Clear all indexes for a table
   */
  clearTableIndexes(tableName: string): void {
    this.indexCache.delete(tableName);

    const tableMeta = this.metadataManager.get(tableName);
    if (tableMeta) {
      this.metadataManager.update(tableName, {
        indexes: {},
      });
    }
  }
}

// Singleton export using global meta instance
import { meta } from '../meta/MetadataManager';
export const indexManager = new IndexManager(meta);
