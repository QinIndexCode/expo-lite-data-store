// src/core/service/TransactionService.ts
// 事务管理服务
// 负责处理数据库事务的开始、提交和回滚
// 支持事务操作队列管理和表数据快照保存
// 创建于: 2025-11-28
// 最后修改: 2025-12-19

import { QueryEngine } from "../query/QueryEngine";
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
    updateFn: (tableName: string, data: Record<string, any>, where: WhereCondition, options?: OperationOptions) => Promise<any>
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
      // 直接执行每个操作
      for (const operation of this.operations) {
        switch (operation.type) {
          case 'write':
            // 直接使用writeFn执行写入操作
            // 确保data是数组
            const writeData = Array.isArray(operation.data) ? operation.data : [operation.data];
            await writeFn(operation.tableName, writeData, { ...operation.options, directWrite: true });
            break;
          case 'update':
            // 直接使用updateFn执行更新操作
            // 确保where不是undefined
            await updateFn(operation.tableName, operation.data, operation.where || {}, { ...operation.options, directWrite: true });
            break;
          case 'delete':
            // 直接使用deleteFn执行删除操作
            // 确保where不是undefined
            // 注意：delete操作的where条件存储在operation.data中
            // 传递directWrite: true确保在提交时实际执行删除操作
            await deleteFn(operation.tableName, operation.data || {}, { ...operation.options, directWrite: true });
            break;
          case 'bulkWrite':
            // 直接使用bulkWriteFn执行批量写入操作
            // 确保data是数组
            const bulkData = Array.isArray(operation.data) ? operation.data : [operation.data];
            await bulkWriteFn(operation.tableName, bulkData, { ...operation.options, directWrite: true });
            break;
        }
      }
    } catch (error) {
      // 如果操作失败，尝试回滚事务
      await this.rollback(writeFn);
      // 重新抛出错误，让调用者知道事务失败
      throw error;
    } finally {
      // 确保事务状态被重置，无论成功还是失败
      // 使用resetTransactionState方法确保状态一致性
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
      // 遍历所有快照，恢复数据
      for (const [tableName, snapshot] of this.snapshots) {
        await writeFn(tableName, snapshot.data, { mode: 'overwrite', directWrite: true });
      }
    } finally {
      // 无论成功还是失败，都结束事务状态
      // 使用resetTransactionState方法确保状态一致性
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

    // 只保存第一次操作该表的快照
    if (!this.snapshots.has(tableName)) {
      // 使用深拷贝保存快照数据，确保回滚时数据完整性
      // 避免外部修改原始数据影响快照
      this.snapshots.set(tableName, {
        tableName,
        data: JSON.parse(JSON.stringify(data)),
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
    
    // 清除该表的事务数据缓存，确保下次获取时重新计算
    // 这样可以保证事务数据缓存始终与操作队列一致
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
    // 如果已有计算好的事务数据，直接返回
    if (this.transactionData.has(tableName)) {
      return this.transactionData.get(tableName)!;
    }

    // 获取原始数据
    let data = await readFn(tableName);

    // 应用所有已添加的操作
    for (const operation of this.operations) {
      if (operation.tableName !== tableName) {
        continue;
      }

      switch (operation.type) {
        case 'write':
          // 写入操作：根据mode决定是覆盖还是追加
          const writeData = Array.isArray(operation.data) ? operation.data : [operation.data];
          if (operation.options?.mode === 'overwrite') {
            // 覆盖模式：直接替换数据
            data = writeData;
          } else {
            // 默认追加模式：合并数据
            data = [...data, ...writeData];
          }
          break;
        case 'update':
          // 更新操作：使用QueryEngine过滤匹配的数据并更新
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
          // 删除操作：使用QueryEngine过滤掉匹配的数据
          // 注意：delete操作的where条件存储在operation.data中
          data = data.filter(item => {
            // 使用QueryEngine检查是否不匹配条件
            return QueryEngine.filter([item], operation.data || {}).length === 0;
          });
          break;
        case 'bulkWrite':
          // 批量操作：逐个应用批量操作中的每个子操作
          const bulkOperations = Array.isArray(operation.data) ? operation.data : [operation.data];
          for (const bulkOp of bulkOperations) {
            // 确保bulkOp是有效的操作对象
            if (typeof bulkOp !== 'object' || !bulkOp.type) {
              continue;
            }
            
            switch (bulkOp.type) {
              case 'insert':
                // 插入操作：添加数据到集合
                const insertData = Array.isArray(bulkOp.data) ? bulkOp.data : [bulkOp.data];
                data = [...data, ...insertData];
                break;
              case 'update':
                // 更新操作：使用QueryEngine过滤匹配的数据并更新
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
                // 删除操作：使用QueryEngine过滤掉匹配的数据
                // 注意：与顶层delete操作一致，条件存储在bulkOp.data中
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

    // 保存计算结果到transactionData
    this.transactionData.set(tableName, data);
    return data;
  }
}
