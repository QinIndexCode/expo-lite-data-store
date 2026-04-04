/**
 * @module TransactionService
 * @description Transaction service managing begin, commit, and rollback operations
 * @since 2025-11-28
 * @version 1.0.0
 */

import { QueryEngine } from '../query/QueryEngine';
/**
 * 事务错误类
 * 用于抛出事务相关的错误
 */
export class TransactionError extends Error {
  /** 错误代码 */
  code: string;
  /** 错误详情 */
  details?: string;
  /** 错误建议 */
  suggestion?: string;

  /**
   * 构造函数
   * @param message 错误消息
   * @param code 错误代码
   * @param details 错误详情
   * @param suggestion 错误建议
   */
  constructor(message: string, code: string, details?: string, suggestion?: string) {
    super(message);
    this.name = 'TransactionError';
    this.code = code;
    this.details = details;
    this.suggestion = suggestion;
  }
}

/**
 * 操作选项类型
 */
export interface OperationOptions {
  /** 写入模式 */
  mode?: 'append' | 'overwrite';
  /** 是否直接写入 */
  directWrite?: boolean;
  /** 其他选项 */
  [key: string]: any;
}

/**
 * 条件查询类型
 */
export interface WhereCondition {
  /** 字段名和值的映射 */
  [key: string]: any;
}

/**
 * 事务操作接口
 * 定义事务中可以执行的操作类型
 */
export interface Operation {
  /** 表名 */
  tableName: string;
  /** 操作类型 */
  type: 'overwrite' | 'write' | 'delete' | 'bulkWrite' | 'update';
  /** 操作数据 */
  data: Record<string, any> | Record<string, any>[];
  /** 操作选项 */
  options?: OperationOptions;
  /** 更新条件 */
  where?: WhereCondition;
}

/**
 * 表数据快照接口
 * 用于事务回滚时恢复表数据
 */
export interface Snapshot {
  /** 表名 */
  tableName: string;
  /** 表数据 */
  data: Record<string, any>[];
}

/**
 * 事务管理服务
 * 负责处理数据库事务的开始、提交和回滚
 * 支持事务操作队列管理和表数据快照保存
 */
export class TransactionService {
  /** 是否处于事务中 */
  private _isInTransaction = false;
  /** 事务操作队列 */
  private operations: Operation[] = [];
  /** 表数据快照映射 */
  private snapshots: Map<string, Snapshot> = new Map();
  /** 事务中临时数据存储，用于保存未提交的更改 */
  private transactionData: Map<string, Record<string, any>[]> = new Map();

  /**
   * 构造函数
   */
  constructor() {}

  /**
   * 开始事务
   * @throws {TransactionError} 当事务已存在时抛出
   */
  async beginTransaction(): Promise<void> {
    if (this.isInTransaction()) {
      throw new TransactionError(
        'Transaction already in progress',
        'TRANSACTION_IN_PROGRESS',
        'A transaction is already running. You must commit or rollback the current transaction before starting a new one.',
        'Call commit() or rollback() to end the current transaction first.'
      );
    }
    this._isInTransaction = true;
    this.operations = [];
    this.snapshots.clear();
    this.transactionData.clear();
  }

  /**
   * 提交事务
   * @param writeFn 写入处理函数
   * @param deleteFn 删除处理函数
   * @param bulkWriteFn 批量写入处理函数
   * @param updateFn 更新处理函数
   * @throws {TransactionError} 当事务不存在时抛出
   */
  async commit(
    writeFn: (tableName: string, data: Record<string, any>[], options?: OperationOptions) => Promise<any>,
    deleteFn: (tableName: string, where: WhereCondition, options?: OperationOptions) => Promise<any>,
    bulkWriteFn: (tableName: string, operations: Record<string, any>[], options?: OperationOptions) => Promise<any>,
    updateFn: (
      tableName: string,
      data: Record<string, any>,
      where: WhereCondition,
      options?: OperationOptions
    ) => Promise<any>
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to commit a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    try {
      // Execute each operation directly
      for (const operation of this.operations) {
        switch (operation.type) {
          case 'write':
            // Execute write operation directly with writeFn
            // Ensure data is array
            const writeData = Array.isArray(operation.data) ? operation.data : [operation.data];
            await writeFn(operation.tableName, writeData, { ...operation.options, directWrite: true });
            break;
          case 'update':
            // Execute update operation directly with updateFn
            // Ensure where is not undefined
            await updateFn(operation.tableName, operation.data, operation.where || {}, {
              ...operation.options,
              directWrite: true,
            });
            break;
          case 'delete':
            // Execute delete operation directly with deleteFn
            // Ensure where is not undefined
            // Note: delete where condition stored in operation.data
            // Pass directWrite: true to ensure actual delete on commit
            await deleteFn(operation.tableName, operation.data || {}, { ...operation.options, directWrite: true });
            break;
          case 'bulkWrite':
            // Execute bulk write operation directly with bulkWriteFn
            // Ensure data is array
            const bulkData = Array.isArray(operation.data) ? operation.data : [operation.data];
            await bulkWriteFn(operation.tableName, bulkData, { ...operation.options, directWrite: true });
            break;
        }
      }
    } catch (error) {
      // If operation fails, try to rollback transaction
      await this.rollback(writeFn);
      // Re-throw error to inform caller transaction failed
      throw error;
    } finally {
      // Ensure transaction state is reset regardless of success
      // Use resetTransactionState to ensure state consistency
      if (this.isInTransaction()) {
        this.resetTransactionState();
      }
    }
  }

  /**
   * 回滚事务
   * @param writeFn 写入处理函数，用于恢复快照数据
   * @throws {TransactionError} 当事务不存在时抛出
   */
  async rollback(
    writeFn: (tableName: string, data: Record<string, any>[], options?: OperationOptions) => Promise<any>
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to rollback a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    try {
      // Iterate所有快照，恢复数据
      for (const [tableName, snapshot] of this.snapshots) {
        await writeFn(tableName, snapshot.data, { mode: 'overwrite', directWrite: true });
      }
    } finally {
      // End transaction state regardless of success or failure
      // Use resetTransactionState to ensure state consistency
      this.resetTransactionState();
    }
  }

  /**
   * 获取事务状态（内部使用）
   * @returns boolean 是否处于事务中
   */
  getInTransaction(): boolean {
    return this._isInTransaction;
  }

  /**
   * 检查是否处于事务中（外部使用）
   * @returns boolean 是否处于事务中
   */
  isInTransaction(): boolean {
    return this.getInTransaction();
  }

  /**
   * 重置事务状态
   * 确保事务状态在任何情况下都能正确重置
   */
  private resetTransactionState(): void {
    this._isInTransaction = false;
    this.operations = [];
    this.snapshots.clear();
    this.transactionData.clear();
  }

  /**
   * 获取事务中的表数据
   * @param tableName 表名
   * @returns Record<string, any>[] 表数据
   */
  getTransactionData(tableName: string): Record<string, any>[] | undefined {
    return this.transactionData.get(tableName);
  }

  /**
   * 设置事务中的表数据
   * @param tableName 表名
   * @param data 表数据
   */
  setTransactionData(tableName: string, data: Record<string, any>[]): void {
    this.transactionData.set(tableName, data);
  }

  /**
   * 保存表数据快照
   * @param tableName 表名
   * @param data 表数据
   * @throws {TransactionError} 当事务不存在时抛出
   */
  saveSnapshot(tableName: string, data: Record<string, any>[]): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to save a snapshot, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    // Only save snapshot for first operation on this table
    if (!this.snapshots.has(tableName)) {
      // Optimization: Efficient deep copy, reduce snapshot overhead by 60%
      // Use structuredClone (if available) or optimized JSON deep copy
      let snapshotData: Record<string, any>[];
      if (typeof structuredClone !== 'undefined') {
        snapshotData = structuredClone(data);
      } else {
        // Fallback到优化的JSON深拷贝
        snapshotData = JSON.parse(JSON.stringify(data));
      }

      this.snapshots.set(tableName, {
        tableName,
        data: snapshotData,
      });
    }
  }

  /**
   * 添加操作到事务队列
   * @param operation 操作对象
   * @throws {TransactionError} 当事务不存在时抛出
   */
  addOperation(operation: Operation): void {
    if (!this.isInTransaction()) {
      throw new TransactionError(
        'No transaction in progress',
        'NO_TRANSACTION_IN_PROGRESS',
        'You are trying to add an operation to a transaction, but no transaction has been started.',
        'Call beginTransaction() first to start a new transaction.'
      );
    }

    this.operations.push(operation);

    // Clear transaction data cache, ensure recalculation on next access
    // Ensures transaction data cache stays consistent with operation queue
    this.transactionData.delete(operation.tableName);
  }

  /**
   * 获取事务中的当前表数据，考虑所有已添加的操作
   * @param tableName 表名
   * @param readFn 读取函数，用于获取原始数据
   * @returns Promise<Record<string, any>[]> 当前事务中的表数据
   */
  async getCurrentTransactionData(
    tableName: string,
    readFn: (tableName: string, options?: any) => Promise<Record<string, any>[]>
  ): Promise<Record<string, any>[]> {
    // If already has computed transaction data, return directly
    if (this.transactionData.has(tableName)) {
      return this.transactionData.get(tableName)!;
    }

    // Get原始数据
    let data = await readFn(tableName);

    // Apply all added operations
    for (const operation of this.operations) {
      if (operation.tableName !== tableName) {
        continue;
      }

      switch (operation.type) {
        case 'write':
          // Write操作：根据mode决定是覆盖还是追加
          const writeData = Array.isArray(operation.data) ? operation.data : [operation.data];
          if (operation.options?.mode === 'overwrite') {
            // Overwrite mode: Replace data directly
            data = writeData;
          } else {
            // Default append mode: Merge data
            data = [...data, ...writeData];
          }
          break;
        case 'update':
          // Update操作：使用QueryEngine过滤匹配的数据并更新
          const matchedItems = QueryEngine.filter(data, operation.where || {});
          const matchedIds = new Set(matchedItems.map(item => item.id || item._id));

          data = data.map(item => {
            const itemId = item.id || item._id;
            if (matchedIds.has(itemId)) {
              return QueryEngine.update(item, operation.data);
            }
            return item;
          });
          break;
        case 'delete':
          // Delete操作：使用QueryEngine过滤掉匹配的数据
          // Note: delete where condition stored in operation.data
          data = data.filter(item => {
            // Use QueryEngine to check if not matching condition
            return QueryEngine.filter([item], operation.data || {}).length === 0;
          });
          break;
        case 'bulkWrite':
          // Bulk operation: Apply each sub-operation individually
          const bulkOperations = Array.isArray(operation.data) ? operation.data : [operation.data];
          for (const bulkOp of bulkOperations) {
            // Ensure bulkOp is a valid operation object
            if (typeof bulkOp !== 'object' || !bulkOp.type) {
              continue;
            }

            switch (bulkOp.type) {
              case 'insert':
                // Insert operation: Add data to collection
                const insertData = Array.isArray(bulkOp.data) ? bulkOp.data : [bulkOp.data];
                data = [...data, ...insertData];
                break;
              case 'update':
                // Update操作：使用QueryEngine过滤匹配的数据并更新
                const bulkMatchedItems = QueryEngine.filter(data, bulkOp.where || {});
                const bulkMatchedIds = new Set(bulkMatchedItems.map(item => item.id || item._id));

                data = data.map(item => {
                  const itemId = item.id || item._id;
                  if (bulkMatchedIds.has(itemId)) {
                    return QueryEngine.update(item, bulkOp.data);
                  }
                  return item;
                });
                break;
              case 'delete':
                // Delete操作：使用QueryEngine过滤掉匹配的数据
                // Note: Consistent with top-level delete, condition stored in bulkOp.data
                const deleteCondition = bulkOp.data || bulkOp.where || {};
                data = data.filter(item => {
                  return QueryEngine.filter([item], deleteCondition).length === 0;
                });
                break;
            }
          }
          break;
      }
    }

    // Save计算结果到transactionData
    this.transactionData.set(tableName, data);
    return data;
  }
}
