import { FileSystemStorageAdapter } from '../core/adapter/FileSystemStorageAdapter';
import {
  isStorageRecord,
  type BulkOperation,
  type CreateTableOptions,
  type FilterCondition,
  type FindOptions,
  type ReadOptions,
  type StorageInput,
  type StorageRecord,
  type WriteOptions,
} from '../types/storageTypes';
import { Task, TaskProcessor } from './taskQueue';

/** Storage operations accepted by the queue processor. */
export enum StorageTaskType {
  CREATE_TABLE = 'createTable',
  DELETE_TABLE = 'deleteTable',
  WRITE = 'write',
  READ = 'read',
  COUNT = 'count',
  BULK_WRITE = 'bulkWrite',
  MIGRATE_TO_CHUNKED = 'migrateToChunked',
  FIND_ONE = 'findOne',
  FIND_MANY = 'findMany',
}

const getTaskPayload = (data: unknown): StorageRecord => {
  if (!isStorageRecord(data)) {
    throw new TypeError('Storage task data must be an object');
  }

  return data;
};

const getTableName = (payload: StorageRecord): string => {
  const { tableName } = payload;
  if (typeof tableName !== 'string') {
    throw new TypeError('Storage task tableName must be a string');
  }

  return tableName;
};

const getOptionalOptions = <T extends object>(payload: StorageRecord, name: string): T | undefined => {
  const value = payload[name];
  if (value === undefined) {
    return undefined;
  }
  if (!isStorageRecord(value)) {
    throw new TypeError(`Storage task ${name} must be an object when provided`);
  }

  return value as T;
};

const getStorageInput = (payload: StorageRecord): StorageInput<StorageRecord> => {
  const { data } = payload;
  if (isStorageRecord(data)) {
    return data;
  }
  if (Array.isArray(data) && data.every(isStorageRecord)) {
    return data;
  }

  throw new TypeError('Storage write task data must be a record or an array of records');
};

const isFilterCondition = (value: unknown): value is FilterCondition<StorageRecord> =>
  typeof value === 'function' || isStorageRecord(value);

const getRequiredFilter = (payload: StorageRecord): FilterCondition<StorageRecord> => {
  const { filter } = payload;
  if (!isFilterCondition(filter)) {
    throw new TypeError('Storage query task filter must be a function or an object');
  }

  return filter;
};

const parseBulkOperation = (value: unknown): BulkOperation<StorageRecord> => {
  if (!isStorageRecord(value) || typeof value.type !== 'string') {
    throw new TypeError('Storage bulk operation must be an object with a supported type');
  }

  if (value.type === 'insert') {
    return { type: 'insert', data: getStorageInput(value) };
  }

  if (value.type === 'update') {
    if (!isStorageRecord(value.data)) {
      throw new TypeError('Storage bulk update data must be an object');
    }
    if (!isFilterCondition(value.where)) {
      throw new TypeError('Storage bulk update where must be a function or an object');
    }
    return { type: 'update', data: value.data, where: value.where };
  }

  if (value.type === 'delete') {
    if (!isFilterCondition(value.where)) {
      throw new TypeError('Storage bulk delete where must be a function or an object');
    }
    return { type: 'delete', where: value.where };
  }

  throw new TypeError(`Unsupported storage bulk operation type: ${value.type}`);
};

const getBulkOperations = (payload: StorageRecord): BulkOperation<StorageRecord>[] => {
  if (!Array.isArray(payload.operations)) {
    throw new TypeError('Storage bulk task operations must be an array');
  }

  return payload.operations.map(parseBulkOperation);
};

/** Validates queue payloads before dispatching supported operations to the storage adapter. */
export class StorageTaskProcessor implements TaskProcessor {
  private storageAdapter: FileSystemStorageAdapter;

  constructor(storageAdapter: FileSystemStorageAdapter) {
    this.storageAdapter = storageAdapter;
  }

  async process(task: Task): Promise<unknown> {
    const { type, data } = task;
    const payload = getTaskPayload(data);
    const tableName = getTableName(payload);

    switch (type) {
      case StorageTaskType.CREATE_TABLE:
        return this.storageAdapter.createTable<StorageRecord>(
          tableName,
          getOptionalOptions<CreateTableOptions<StorageRecord>>(payload, 'options')
        );

      case StorageTaskType.DELETE_TABLE:
        return this.storageAdapter.deleteTable(tableName);

      case StorageTaskType.WRITE:
        return this.storageAdapter.write<StorageRecord>(
          tableName,
          getStorageInput(payload),
          getOptionalOptions<WriteOptions>(payload, 'options')
        );

      case StorageTaskType.READ:
        return this.storageAdapter.read<StorageRecord>(
          tableName,
          getOptionalOptions<ReadOptions<StorageRecord>>(payload, 'options')
        );

      case StorageTaskType.COUNT:
        return this.storageAdapter.count(tableName);

      case StorageTaskType.BULK_WRITE:
        return this.storageAdapter.bulkWrite<StorageRecord>(tableName, getBulkOperations(payload));

      case StorageTaskType.MIGRATE_TO_CHUNKED:
        return this.storageAdapter.migrateToChunked(tableName);

      case StorageTaskType.FIND_ONE:
        return this.storageAdapter.findOne<StorageRecord>(tableName, getRequiredFilter(payload));

      case StorageTaskType.FIND_MANY:
        return this.storageAdapter.findMany<StorageRecord>(
          tableName,
          payload.filter === undefined ? undefined : getRequiredFilter(payload),
          getOptionalOptions<FindOptions<StorageRecord>>(payload, 'options')
        );

      default:
        throw new Error(`Unsupported storage task type: ${type}`);
    }
  }

  supports(taskType: string): boolean {
    return Object.values(StorageTaskType).includes(taskType as StorageTaskType);
  }
}
