// src/taskQueue/StorageTaskProcessor.ts
// 存储任务处理器

import { FileSystemStorageAdapter } from '../core/adapter/FileSystemStorageAdapter';
import { Task, TaskProcessor } from './taskQueue';

/**
 * 存储任务类型枚举
 */
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

/**
 * 存储任务处理器类
 */
export class StorageTaskProcessor implements TaskProcessor {
  /**
   * 存储适配器实例
   */
  private storageAdapter: FileSystemStorageAdapter;

  /**
   * 构造函数
   * @param storageAdapter 存储适配器实例
   */
  constructor(storageAdapter: FileSystemStorageAdapter) {
    this.storageAdapter = storageAdapter;
  }

  /**
   * 处理任务
   * @param task 任务对象
   */
  async process(task: Task): Promise<any> {
    const { type, data } = task;

    switch (type as StorageTaskType) {
      case StorageTaskType.CREATE_TABLE:
        return await this.storageAdapter.createTable(data.tableName, data.options);

      case StorageTaskType.DELETE_TABLE:
        return await this.storageAdapter.deleteTable(data.tableName);

      case StorageTaskType.WRITE:
        return await this.storageAdapter.write(data.tableName, data.data, data.options);

      case StorageTaskType.READ:
        return await this.storageAdapter.read(data.tableName, data.options);

      case StorageTaskType.COUNT:
        return await this.storageAdapter.count(data.tableName);

      case StorageTaskType.BULK_WRITE:
        return await this.storageAdapter.bulkWrite(data.tableName, data.operations);

      case StorageTaskType.MIGRATE_TO_CHUNKED:
        return await this.storageAdapter.migrateToChunked(data.tableName);

      case StorageTaskType.FIND_ONE:
        return await this.storageAdapter.findOne(data.tableName, data.filter);

      case StorageTaskType.FIND_MANY:
        return await this.storageAdapter.findMany(data.tableName, data.filter, data.options);

      default:
        throw new Error(`Unsupported storage task type: ${type}`);
    }
  }

  /**
   * 检查是否支持指定的任务类型
   * @param taskType 任务类型
   */
  supports(taskType: string): boolean {
    return Object.values(StorageTaskType).includes(taskType as StorageTaskType);
  }
}
