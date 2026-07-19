import { isStorageRecord, type StorageRecord } from '../../types/storageTypes';
import type { IMetadataManager } from '../../types/metadataManagerInfc';
import { StorageError } from '../../types/storageErrorInfc';

export type IndexId = string | number;

const isStableIndexId = (value: unknown): value is IndexId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export const getStableIndexId = (record: StorageRecord): IndexId | undefined => {
  const id = record.id;
  if (isStableIndexId(id)) {
    return id;
  }

  const fallbackId = record._id;
  return isStableIndexId(fallbackId) ? fallbackId : undefined;
};

export enum IndexType {
  UNIQUE = 'unique',
  NORMAL = 'normal',
}

export interface IndexItem {
  value: unknown;
  id?: IndexId;
}

export interface Index {
  name: string;
  type: IndexType;
  fields: string[]; // Supports composite indexes
  data: Map<string, IndexItem[]>; // Stringified composite values as keys
  ready: boolean;
}

export type IndexUpdateMode = 'append' | 'rebuild';

export interface IndexUpdatePlan {
  readonly apply: () => void;
}

type PreparedBucketDelta = {
  readonly items: IndexItem[];
  readonly removals: Set<IndexItem>;
  readonly additions: IndexItem[];
};

type PreparedIndexPatch = {
  readonly kind: 'patch';
  readonly index: Index;
  readonly buckets: ReadonlyMap<string, PreparedBucketDelta>;
  readonly unqueryableRecords: number;
};

type PreparedIndexReplacement = {
  readonly kind: 'replace';
  readonly index: Index;
  readonly data: Map<string, IndexItem[]>;
  readonly ready: boolean;
  readonly unqueryableRecords: number;
};

type PreparedIndexUpdate = PreparedIndexPatch | PreparedIndexReplacement;

type PreparedIndexEntry = {
  readonly compositeKey: string;
  readonly item: IndexItem;
};

export class IndexManager {
  private indexCache = new Map<string, Map<string, Index>>();

  // Keying by the data map makes restored snapshots re-evaluate coverage automatically.
  private readonly unqueryableRecordCounts = new WeakMap<Index['data'], number>();

  private metadataManager: IMetadataManager;

  constructor(metadataManager: IMetadataManager) {
    this.metadataManager = metadataManager;
  }

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
      ready: this.metadataManager.count(tableName) === 0,
    };

    this.unqueryableRecordCounts.set(index.data, 0);

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

  private generateCompositeKey(values: readonly unknown[]): string {
    return JSON.stringify(values);
  }

  private prepareIndexEntry(index: Index, record: StorageRecord): PreparedIndexEntry | undefined {
    const fieldValues = index.fields.map(field => record[field]);
    if (fieldValues.some(value => value === undefined)) {
      return undefined;
    }

    const value = fieldValues.length === 1 ? fieldValues[0] : fieldValues;
    const id = getStableIndexId(record);
    return {
      compositeKey: this.generateCompositeKey(fieldValues),
      item: id === undefined ? { value } : { value, id },
    };
  }

  private getUnqueryableRecordCount(index: Index): number {
    const cachedCount = this.unqueryableRecordCounts.get(index.data);
    if (cachedCount !== undefined) {
      return cachedCount;
    }

    let count = 0;
    for (const items of index.data.values()) {
      for (const item of items) {
        if (item.id === undefined) {
          count++;
        }
      }
    }
    this.unqueryableRecordCounts.set(index.data, count);
    return count;
  }

  private addRecordToPreparedIndex(index: Index, indexData: Index['data'], record: StorageRecord): number {
    const entry = this.prepareIndexEntry(index, record);
    if (!entry) {
      return 0;
    }

    const indexItems = indexData.get(entry.compositeKey) ?? [];

    if (index.type === IndexType.UNIQUE && indexItems.length > 0) {
      throw new StorageError(
        `Unique constraint violated for index ${index.name} on fields ${index.fields.join(', ')}`,
        'TABLE_INDEX_NOT_UNIQUE',
        {
          details: `Value '${entry.compositeKey}' already exists in unique index ${index.name}`,
          suggestion: 'Use a different combination of values for the fields or drop the unique constraint',
        }
      );
    }

    if (!indexData.has(entry.compositeKey)) {
      indexData.set(entry.compositeKey, indexItems);
    }
    indexItems.push(entry.item);
    return entry.item.id === undefined ? 1 : 0;
  }

  private createUpdatePlan(updates: readonly PreparedIndexUpdate[]): IndexUpdatePlan {
    let applied = false;
    return {
      apply: () => {
        if (applied) {
          return;
        }
        for (const update of updates) {
          if (update.kind === 'replace') {
            update.index.data = update.data;
            update.index.ready = update.ready;
            this.unqueryableRecordCounts.set(update.data, update.unqueryableRecords);
            continue;
          }

          for (const [compositeKey, delta] of update.buckets) {
            for (const item of delta.removals) {
              const itemIndex = delta.items.indexOf(item);
              if (itemIndex !== -1) {
                delta.items.splice(itemIndex, 1);
              }
            }
            for (const item of delta.additions) {
              delta.items.push(item);
            }

            if (delta.items.length === 0) {
              update.index.data.delete(compositeKey);
            } else {
              update.index.data.set(compositeKey, delta.items);
            }
          }
          this.unqueryableRecordCounts.set(update.index.data, update.unqueryableRecords);
        }
        applied = true;
      },
    };
  }

  private stageIncrementalUpdate(
    tableName: string,
    additions: readonly StorageRecord[],
    removals: readonly StorageRecord[] = []
  ): IndexUpdatePlan {
    const tableIndexes = this.indexCache.get(tableName);
    if (!tableIndexes || tableIndexes.size === 0) {
      return this.createUpdatePlan([]);
    }

    const updates: PreparedIndexUpdate[] = [];
    for (const index of tableIndexes.values()) {
      if (!index.ready) {
        continue;
      }

      // Stage only references and deltas; hot buckets remain untouched until apply().
      const preparedBuckets = new Map<string, PreparedBucketDelta>();
      const getPreparedBucket = (compositeKey: string) => {
        const prepared = preparedBuckets.get(compositeKey);
        if (prepared) {
          return prepared;
        }

        const delta: PreparedBucketDelta = {
          items: index.data.get(compositeKey) ?? [],
          removals: new Set<IndexItem>(),
          additions: [],
        };
        preparedBuckets.set(compositeKey, delta);
        return delta;
      };
      let unqueryableRecords = this.getUnqueryableRecordCount(index);

      for (const record of removals) {
        const entry = this.prepareIndexEntry(index, record);
        if (!entry) {
          continue;
        }

        const delta = getPreparedBucket(entry.compositeKey);
        const removedItem = delta.items.find(item => !delta.removals.has(item) && item.id === entry.item.id);
        if (removedItem) {
          delta.removals.add(removedItem);
          if (removedItem.id === undefined) {
            unqueryableRecords--;
          }
        }
      }

      for (const record of additions) {
        const entry = this.prepareIndexEntry(index, record);
        if (!entry) {
          continue;
        }

        const delta = getPreparedBucket(entry.compositeKey);
        const occupiedSlots = delta.items.length - delta.removals.size + delta.additions.length;
        if (index.type === IndexType.UNIQUE && occupiedSlots > 0) {
          throw new StorageError(
            `Unique constraint violated for index ${index.name} on fields ${index.fields.join(', ')}`,
            'TABLE_INDEX_NOT_UNIQUE',
            {
              details: `Value '${entry.compositeKey}' already exists in unique index ${index.name}`,
              suggestion: 'Use a different combination of values for the fields or drop the unique constraint',
            }
          );
        }
        delta.additions.push(entry.item);
        if (entry.item.id === undefined) {
          unqueryableRecords++;
        }
      }

      updates.push({
        kind: 'patch',
        index,
        buckets: preparedBuckets,
        unqueryableRecords,
      });
    }

    return this.createUpdatePlan(updates);
  }

  /**
   * Builds a complete, constraint-validated index update without mutating the
   * live index cache. The returned plan can be applied after storage succeeds.
   */
  stageIndexUpdate(tableName: string, data: readonly StorageRecord[], mode: IndexUpdateMode): IndexUpdatePlan {
    if (mode === 'append') {
      return this.stageIncrementalUpdate(tableName, data);
    }

    const tableIndexes = this.indexCache.get(tableName);
    if (!tableIndexes || tableIndexes.size === 0) {
      return this.createUpdatePlan([]);
    }

    const updates: PreparedIndexUpdate[] = [];
    for (const index of tableIndexes.values()) {
      const preparedData = new Map<string, IndexItem[]>();
      let unqueryableRecords = 0;
      for (const record of data) {
        unqueryableRecords += this.addRecordToPreparedIndex(index, preparedData, record);
      }
      updates.push({
        kind: 'replace',
        index,
        data: preparedData,
        ready: true,
        unqueryableRecords,
      });
    }

    return this.createUpdatePlan(updates);
  }

  /** Applies a plan whose data constraints were fully checked during staging. */
  applyIndexUpdate(plan: IndexUpdatePlan): void {
    plan.apply();
  }

  addToIndex<T extends object>(tableName: string, data: T): void {
    if (!isStorageRecord(data)) {
      return;
    }
    this.applyIndexUpdate(this.stageIncrementalUpdate(tableName, [data]));
  }

  removeFromIndex<T extends object>(tableName: string, data: T): void {
    if (!isStorageRecord(data)) {
      return;
    }
    this.applyIndexUpdate(this.stageIncrementalUpdate(tableName, [], [data]));
  }

  updateIndex<T extends object>(tableName: string, oldData: T, newData: T): void {
    if (!isStorageRecord(oldData) || !isStorageRecord(newData)) {
      return;
    }
    this.applyIndexUpdate(this.stageIncrementalUpdate(tableName, [newData], [oldData]));
  }

  rebuildIndexes<T extends object>(tableName: string, data: T[]): void {
    const records: StorageRecord[] = [];
    for (const item of data) {
      if (isStorageRecord(item)) {
        records.push(item);
      }
    }
    this.applyIndexUpdate(this.stageIndexUpdate(tableName, records, 'rebuild'));
  }

  queryIndex(tableName: string, fields: string | string[], values: unknown | unknown[]): IndexId[] {
    if (!this.indexCache.has(tableName)) {
      return [];
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const queryFields = Array.isArray(fields) ? fields : [fields];
    const queryValues = Array.isArray(values) ? values : [values];

    let matchingIndex: Index | undefined;
    for (const [, index] of tableIndexes.entries()) {
      if (index.ready && this.getUnqueryableRecordCount(index) === 0 && index.fields.length === queryFields.length) {
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

    return indexItems.flatMap(item => (item.id === undefined ? [] : [item.id]));
  }

  getTableIndexes(tableName: string): Index[] {
    if (!this.indexCache.has(tableName)) {
      return [];
    }

    return Array.from(this.indexCache.get(tableName)!.values());
  }

  hasIndex(tableName: string, fields: string | string[]): boolean {
    if (!this.indexCache.has(tableName)) {
      return false;
    }

    const tableIndexes = this.indexCache.get(tableName)!;
    const checkFields = Array.isArray(fields) ? fields : [fields];

    for (const [, index] of tableIndexes.entries()) {
      if (index.ready && this.getUnqueryableRecordCount(index) === 0 && index.fields.length === checkFields.length) {
        const fieldsMatch = index.fields.every((field, idx) => field === checkFields[idx]);
        if (fieldsMatch) {
          return true;
        }
      }
    }

    return false;
  }

  clearTableIndexes(tableName: string): void {
    this.invalidateTableIndexes(tableName);

    const tableMeta = this.metadataManager.get(tableName);
    if (tableMeta) {
      this.metadataManager.update(tableName, {
        indexes: {},
      });
    }
  }

  /** Drops only process-local index state after another adapter mutates a table. */
  invalidateTableIndexes(tableName: string): void {
    this.indexCache.delete(tableName);
  }
}

import { meta } from '../meta/MetadataManager';
export const indexManager = new IndexManager(meta);
