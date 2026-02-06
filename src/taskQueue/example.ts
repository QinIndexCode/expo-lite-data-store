// src/taskQueue/example.ts
// 任务队列使用示例

import storage from '../core/adapter/FileSystemStorageAdapter';
import { StorageTaskType } from './StorageTaskProcessor';
import { TaskPriority, taskQueue } from './taskQueue';
import logger from '../utils/logger';

/**
 * 任务队列使用示例
 */
async function taskQueueExample() {
  logger.info('=== Task Queue Usage Example ===');

  // 创建测试表
  logger.info('1. Create test table...');
  await storage.createTable('test_table', {
    columns: {
      id: 'number',
      name: 'string',
      value: 'number',
    },
    initialData: [
      { id: 1, name: 'item1', value: 100 },
      { id: 2, name: 'item2', value: 200 },
    ],
  });

  // 示例1：使用任务队列执行批量写入
  logger.info('\n2. Run bulk write via task queue...');
  const bulkWriteResult = await new Promise((resolve, reject) => {
    taskQueue.addTask(
      StorageTaskType.BULK_WRITE,
      {
        tableName: 'test_table',
        operations: [
          {
            type: 'insert',
            data: [
              { id: 3, name: 'item3', value: 300 },
              { id: 4, name: 'item4', value: 400 },
              { id: 5, name: 'item5', value: 500 },
            ],
          },
          {
            type: 'update',
            data: { id: 1, value: 150 },
          },
          {
            type: 'delete',
            data: { id: 2 },
          },
        ],
      },
      {
        priority: TaskPriority.HIGH,
        timeout: 30000,
        callback: task => {
          if (task.status === 'completed') {
            resolve(task.result);
          } else {
            reject(task.error);
          }
        },
      }
    );
  });
  logger.info('Bulk write result:', bulkWriteResult);

  // 示例2：使用任务队列执行模式迁移
  logger.info('\n3. Run mode migration via task queue...');
  await new Promise((resolve, reject) => {
    taskQueue.addTask(
      StorageTaskType.MIGRATE_TO_CHUNKED,
      { tableName: 'test_table' },
      {
        priority: TaskPriority.NORMAL,
        timeout: 60000,
        callback: task => {
          if (task.status === 'completed') {
            logger.info('Mode migration completed');
            resolve(null);
          } else {
            reject(task.error);
          }
        },
      }
    );
  });

  // 示例3：使用任务队列执行读取操作
  logger.info('\n4. Run read operation via task queue...');
  const readResult = await new Promise((resolve, reject) => {
    taskQueue.addTask(
      StorageTaskType.READ,
      {
        tableName: 'test_table',
        options: {
          limit: 10,
        },
      },
      {
        priority: TaskPriority.LOW,
        callback: task => {
          if (task.status === 'completed') {
            resolve(task.result);
          } else {
            reject(task.error);
          }
        },
      }
    );
  });
  logger.info('Read result:', readResult);

  // 示例4：获取队列状态
  logger.info('\n5. Get queue status...');
  const status = taskQueue.getStatus();
  logger.info('Queue status:', status);

  // 清理测试表
  logger.info('\n6. Clean up test table...');
  await storage.deleteTable('test_table');

  logger.info('\n=== Task Queue Usage Example Completed ===');
}

// 运行示例
if (require.main === module) {
  taskQueueExample().catch(logger.error);
}

export { taskQueueExample };
