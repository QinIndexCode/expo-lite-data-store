import { StorageError } from '../types/storageErrorInfc';
import { MetadataManagerInfc } from '../types/metadataManagerInfc';
import { File } from 'expo-file-system';
import { ChunkedFileHandler } from './file/ChunkedFileHandler';
import { SingleFileHandler } from './file/SingleFileHandler';
import { IndexManager } from './index/IndexManager';
import withTimeout from '../utils/withTimeout';
import ROOT from '../utils/ROOTPath';

/**
 * 事务操作类型
 */
type TransactionOperation = {
  tableName: string;
  type: "write" | "delete" | "bulkWrite";
  data: any;
  options?: any;
};

/**
 * 事务管理器类
 * 负责处理事务相关的功能，包括事务开始、提交和回滚
 */
export class TransactionManager {
  /**
   * 事务状态
   */
  private inTransaction = false;
  
  /**
   * 事务数据快照，用于回滚
   */
  private transactionSnapshots = new Map<string, Record<string, any>[]>();
  
  /**
   * 事务操作队列
   */
  private transactionOperations: TransactionOperation[] = [];
  
  /**
   * 索引管理器实例
   */
  private indexManager: IndexManager;
  
  /**
   * 元数据管理器实例
   */
  private metadataManager: MetadataManagerInfc;
  
  /**
   * 构造函数
   * @param metadataManager 元数据管理器实例
   * @param indexManager 索引管理器实例
   */
  constructor(metadataManager: MetadataManagerInfc, indexManager: IndexManager) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
  }
  
  /**
   * 开始事务
   */
  async beginTransaction(): Promise<void> {
    if (this.inTransaction) {
      throw new StorageError(
        "Transaction already in progress",
        "TRANSACTION_IN_PROGRESS",
        {
          details: "A transaction is already in progress",
          suggestion: "Commit or rollback the current transaction before starting a new one"
        }
      );
    }
    
    this.inTransaction = true;
    this.transactionSnapshots.clear();
    this.transactionOperations = [];
  }
  
  /**
     * 提交事务
     * @param executeWrite 执行写入操作的回调函数
     * @param executeDelete 执行删除操作的回调函数
     * @param executeBulkWrite 执行批量操作的回调函数
     */
  async commit(
    executeWrite: (tableName: string, data: any, options?: any) => Promise<any>,
    executeDelete: (tableName: string, where: any) => Promise<any>,
    executeBulkWrite: (tableName: string, operations: any) => Promise<any>
  ): Promise<void> {
    if (!this.inTransaction) {
      throw new StorageError(
        "No transaction in progress",
        "NO_TRANSACTION_IN_PROGRESS",
        {
          details: "No transaction is currently in progress",
          suggestion: "Start a transaction first before committing"
        }
      );
    }
    
    try {
      // 执行所有事务操作
      for (const op of this.transactionOperations) {
        switch (op.type) {
          case "write":
            await executeWrite(op.tableName, op.data, op.options);
            break;
          case "delete":
            await executeDelete(op.tableName, op.data);
            break;
          case "bulkWrite":
            await executeBulkWrite(op.tableName, op.data);
            break;
        }
      }
      
      // 事务提交成功，重置事务状态
      this.inTransaction = false;
      this.transactionSnapshots.clear();
      this.transactionOperations = [];
    } catch (error) {
      // 事务提交失败，回滚事务
      await this.rollback();
      throw new StorageError(
        "Transaction commit failed",
        "TRANSACTION_COMMIT_FAILED",
        {
          cause: error,
          details: "Failed to commit transaction",
          suggestion: "Check the error details and try again"
        }
      );
    }
  }
  
  /**
   * 回滚事务
   */
  async rollback(): Promise<void> {
    if (!this.inTransaction) {
      throw new StorageError(
        "No transaction in progress",
        "NO_TRANSACTION_IN_PROGRESS",
        {
          details: "No transaction is currently in progress",
          suggestion: "Start a transaction first before rolling back"
        }
      );
    }
    
    try {
      // 恢复所有表的数据快照
      for (const [tableName, snapshot] of this.transactionSnapshots.entries()) {
        const tableMeta = this.metadataManager.get(tableName);
        if (tableMeta) {
          if (tableMeta.mode === "chunked") {
                const handler = new ChunkedFileHandler(tableName);
                await withTimeout(handler.clear(), 10000, `clear chunked table ${tableName}`);
                await withTimeout(handler.append(snapshot), 10000, `restore chunked table ${tableName}`);
            } else {
                // 创建文件路径
                const filePath = `${ROOT}/${tableName}.ldb`;
                // 创建File对象，根据expo-file-system的API，File构造函数接受路径字符串
                const file = new File(filePath);
                // 创建SingleFileHandler实例
                const handler = new SingleFileHandler(file);
                await withTimeout(handler.write(snapshot), 10000, `restore single file table ${tableName}`);
            }
          
          // 恢复索引
          this.indexManager.clearTableIndexes(tableName);
          for (const item of snapshot) {
            this.indexManager.addToIndex(tableName, item);
          }
        }
      }
      
      // 事务回滚成功，重置事务状态
      this.inTransaction = false;
      this.transactionSnapshots.clear();
      this.transactionOperations = [];
    } catch (error) {
      throw new StorageError(
        "Transaction rollback failed",
        "TRANSACTION_ROLLBACK_FAILED",
        {
          cause: error,
          details: "Failed to rollback transaction",
          suggestion: "Manual intervention may be required to restore data consistency"
        }
      );
    }
  }
  
  /**
   * 添加事务操作
   * @param operation 事务操作
   */
  addOperation(operation: TransactionOperation): void {
    this.transactionOperations.push(operation);
  }
  
  /**
   * 保存数据快照
   * @param tableName 表名
   * @param data 数据快照
   */
  saveSnapshot(tableName: string, data: Record<string, any>[]): void {
    this.transactionSnapshots.set(tableName, data);
  }
  
  /**
   * 检查是否在事务中
   * @returns 是否在事务中
   */
  isInTransaction(): boolean {
    return this.inTransaction;
  }
}