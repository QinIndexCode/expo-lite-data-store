// src/core/service/TransactionService.ts

export interface Operation {
  tableName: string;
  type: 'write' | 'delete' | 'bulkWrite';
  data: any;
  options?: any;
}

export interface Snapshot {
  tableName: string;
  data: Record<string, any>[];
}

export class TransactionService {
  private _isInTransaction = false;
  private operations: Operation[] = [];
  private snapshots: Map<string, Snapshot> = new Map();

  constructor() {}

  /**
   * 开始事务
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
   */
  async commit(
    writeFn: (tableName: string, data: any, options?: any) => Promise<any>,
    deleteFn: (tableName: string, where: any) => Promise<any>,
    bulkWriteFn: (tableName: string, operations: any[]) => Promise<any>
  ): Promise<void> {
    if (!this.isInTransaction()) {
      throw new Error('No transaction in progress');
    }

    try {
      // 执行所有操作
      for (const operation of this.operations) {
        switch (operation.type) {
          case 'write':
            await writeFn(operation.tableName, operation.data, operation.options);
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
   */
  async rollback(): Promise<void> {
    if (!this.isInTransaction()) {
      throw new Error('No transaction in progress');
    }

    // 恢复所有快照数据
    for (const _snapshot of this.snapshots.values()) {
      // 这里需要实现数据恢复逻辑，具体实现取决于数据存储方式
      // 暂时留空，后续实现
    }

    // 结束事务
    this._isInTransaction = false;
    this.operations = [];
    this.snapshots.clear();
  }

  /**
   * 检查是否在事务中
   */
  getInTransaction(): boolean {
    return this._isInTransaction;
  }

  /**
   * 检查是否在事务中
   */
  isInTransaction(): boolean {
    return this.getInTransaction();
  }

  /**
   * 保存快照
   */
  saveSnapshot(tableName: string, data: Record<string, any>[]): void {
    if (!this.isInTransaction()) {
      return;
    }

    // 只保存一次快照
    if (!this.snapshots.has(tableName)) {
      this.snapshots.set(tableName, {
        tableName,
        data,
      });
    }
  }

  /**
   * 添加操作到事务队列
   */
  addOperation(operation: Operation): void {
    if (!this.isInTransaction()) {
      return;
    }

    this.operations.push(operation);
  }
}
