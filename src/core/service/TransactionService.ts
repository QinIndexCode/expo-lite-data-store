// src/core/service/TransactionService.ts
// 事务管理服务
// 负责处理数据库事务的开始、提交和回滚
// 支持事务操作队列管理和表数据快照保存
// 创建于: 2025-11-28
// 最后修改: 2025-12-11

/**
 * 事务操作接口
 * 定义事务中可以执行的操作类型
 */
export interface Operation {
  /** 表名 */
  tableName: string;
  /** 操作类型 */
  type: 'write' | 'delete' | 'bulkWrite';
  /** 操作数据 */
  data: any;
  /** 操作选项 */
  options?: any;
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

  /**
   * 构造函数
   */
  constructor() {}

  /**
   * 开始事务
   * @throws {Error} 当事务已存在时抛出
   */
  async beginTransaction(): Promise<void> {
    if (this.isInTransaction()) {
      throw new Error('Transaction already in progress');
    }
    this._isInTransaction = true;
    this.operations = [];
    this.snapshots.clear();
  }

  /**
   * 提交事务
   * @param writeFn 写入处理函数
   * @param deleteFn 删除处理函数
   * @param bulkWriteFn 批量写入处理函数
   * @param updateFn 更新处理函数
   * @throws {Error} 当事务不存在时抛出
   */
  async commit(
    writeFn: (tableName: string, data: any, options?: any) => Promise<any>,
    deleteFn: (tableName: string, where: any) => Promise<any>,
    bulkWriteFn: (tableName: string, operations: any[]) => Promise<any>,
    updateFn: (tableName: string, data: any, where: any) => Promise<any>
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new Error('No transaction in progress');
    }

    try {
      // 执行所有操作
      // 重要：在开始迭代前创建操作数组的副本，防止在迭代过程中修改原数组导致无限循环
      const operationsCopy = [...this.operations];
      for (const operation of operationsCopy) {
        switch (operation.type) {
          case 'write':
            // 检查是否是update操作伪装的write操作（带有where和updates属性）
            if (operation.data && typeof operation.data === 'object' && 'where' in operation.data && 'updates' in operation.data) {
              // 这是一个update操作，调用updateFn而不是writeFn
              await updateFn(operation.tableName, operation.data.updates, operation.data.where);
            } else {
              // 普通write操作
              await writeFn(operation.tableName, operation.data, operation.options);
            }
            break;
          case 'delete':
            await deleteFn(operation.tableName, operation.data);
            break;
          case 'bulkWrite':
            await bulkWriteFn(operation.tableName, operation.data);
            break;
        }
      }
    } finally {
      // 无论成功还是失败，都结束事务
      this._isInTransaction = false;
      this.operations = [];
      this.snapshots.clear();
    }
  }

  /**
   * 回滚事务
   * @throws {Error} 当事务不存在时抛出
   */
  async rollback(): Promise<void> {
    if (!this.isInTransaction()) {
      throw new Error('No transaction in progress');
    }

    // 结束事务（先结束事务状态，避免递归调用）
    this._isInTransaction = false;

    // 清空操作队列和快照（避免重复处理）
    this.operations = [];
    this.snapshots.clear();
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
   * 保存表数据快照
   * @param tableName 表名
   * @param data 表数据
   */
  saveSnapshot(tableName: string, data: Record<string, any>[]): void {
    if (!this.isInTransaction()) {
      return;
    }

    // 只保存第一次操作该表的快照
    if (!this.snapshots.has(tableName)) {
      this.snapshots.set(tableName, {
        tableName,
        data,
      });
    }
  }

  /**
   * 添加操作到事务队列
   * @param operation 操作对象
   */
  addOperation(operation: Operation): void {
    if (!this.isInTransaction()) {
      return;
    }

    this.operations.push(operation);
  }
}
