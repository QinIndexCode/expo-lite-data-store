# Expo Lite Data Store 注释规范

// 创建于: 2025-12-11
// 最后修改: 2025-12-12

## 1. 总体原则

- **简洁明了**：注释应简洁、准确，避免冗余或过时内容
- **专业规范**：使用专业术语，保持语言一致性
- **准确反映**：注释内容必须准确反映代码功能和逻辑
- **易于维护**：注释格式统一，便于后续维护和修改
- **必要才加**：只添加必要的注释，避免过度注释

## 2. 注释格式

### 2.1 文件头部注释

每个文件顶部应包含文件说明注释，包括：

- 文件路径
- 文件用途
- 创建/修改信息（可选）

```typescript
// src/core/service/TransactionService.ts
// 事务管理服务，负责处理数据库事务的开始、提交和回滚
// 创建于: 2025-01-01
// 最后修改: 2025-12-11
```

### 2.2 类注释

类定义前应添加注释，说明类的用途、主要功能和设计意图：

```typescript
/**
 * 事务管理服务
 * 负责处理数据库事务的开始、提交和回滚
 * 支持事务嵌套和快照管理
 */
export class TransactionService {
  // 类实现...
}
```

### 2.3 函数/方法注释

函数/方法定义前应添加注释，说明：

- 函数/方法的用途
- 参数说明（类型、含义、是否可选）
- 返回值说明
- 异常/错误情况
- 注意事项

```typescript
/**
 * 开始事务
 * @returns Promise<void>
 * @throws {TransactionError} 当事务已存在时抛出
 */
async beginTransaction(): Promise<void> {
  // 方法实现...
}

/**
 * 提交事务
 * @param writeHandler 写入处理函数
 * @param deleteHandler 删除处理函数
 * @param bulkWriteHandler 批量写入处理函数
 * @returns Promise<void>
 * @throws {TransactionError} 当事务不存在或提交失败时抛出
 */
async commit(
  writeHandler: (tableName: string, data: any, options?: any) => Promise<any>,
  deleteHandler: (tableName: string, where: any) => Promise<number>,
  bulkWriteHandler: (tableName: string, operations: any[]) => Promise<any>
): Promise<void> {
  // 方法实现...
}
```

### 2.4 变量/常量注释

重要的变量或常量应添加注释，说明其用途、取值范围或特殊含义：

```typescript
/** 默认分片大小：5MB */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** 加密缓存超时时间：30分钟 */
const ENCRYPTION_CACHE_TIMEOUT = 30 * 60 * 1000;
```

### 2.5 关键逻辑注释

复杂或关键的代码逻辑应添加注释，说明：

- 逻辑流程
- 设计思路
- 特殊处理原因

```typescript
// 恢复每个表的快照数据
for (const [tableName, snapshot] of snapshots.entries()) {
  // 直接写入快照数据，覆盖当前表数据
  await this.dataWriter.write(tableName, snapshot.data, { mode: 'overwrite' });
}
```

### 2.6 注意事项标注

对于需要特别注意的代码，应添加注意事项注释：

```typescript
// 注意：此处使用了私有属性访问，仅在测试环境中使用
const snapshots = this.transactionService['snapshots'] as Map<string, any>;
```

## 3. 注释语言

- **统一使用中文**：所有注释使用中文编写
- **专业术语**：使用准确的专业术语
- **简洁明了**：避免冗长或模糊的描述
- **语法正确**：保持语法正确性，避免错别字

## 4. 注释类型

### 4.1 文档注释

用于生成文档的注释，使用 JSDoc 格式，主要用于：

- 类定义
- 函数/方法定义
- 接口定义

### 4.2 行内注释

用于解释单行代码或代码块的注释，使用 `//` 格式，主要用于：

- 关键逻辑说明
- 变量含义说明
- 注意事项标注

### 4.3 块注释

用于注释多行代码或临时禁用代码，使用 `/* */` 格式，主要用于：

- 临时注释掉代码
- 复杂逻辑的详细说明

## 5. 注释检查清单

在编写或优化注释时，应检查：

- [ ] 注释内容是否准确反映代码功能
- [ ] 注释格式是否符合规范
- [ ] 是否删除了冗余或过时注释
- [ ] 是否补充了缺失的必要注释
- [ ] 注释语言是否简洁明了
- [ ] 专业术语是否正确使用

## 6. 示例文件

```typescript
// src/core/service/TransactionService.ts
// 事务管理服务，负责处理数据库事务的开始、提交和回滚

import { Transaction } from '../../types/transaction';

/**
 * 事务管理服务
 * 负责处理数据库事务的开始、提交和回滚
 * 支持事务嵌套和快照管理
 */
export class TransactionService {
  private transactions: Transaction[] = [];
  private snapshots: Map<string, any> = new Map();

  /**
   * 开始事务
   * @returns Promise<void>
   * @throws {TransactionError} 当事务已存在时抛出
   */
  async beginTransaction(): Promise<void> {
    // 检查是否已存在事务
    if (this.isInTransaction()) {
      throw new Error('Transaction already exists');
    }

    // 创建新事务并添加到事务栈
    const transaction: Transaction = {
      id: Date.now().toString(),
      startTime: Date.now(),
      operations: [],
      status: 'pending',
    };

    this.transactions.push(transaction);
  }

  /**
   * 检查是否处于事务中
   * @returns boolean 是否处于事务中
   */
  isInTransaction(): boolean {
    return this.transactions.length > 0;
  }

  /**
   * 提交事务
   * @param writeHandler 写入处理函数
   * @param deleteHandler 删除处理函数
   * @param bulkWriteHandler 批量写入处理函数
   * @returns Promise<void>
   * @throws {TransactionError} 当事务不存在或提交失败时抛出
   */
  async commit(
    writeHandler: (tableName: string, data: any, options?: any) => Promise<any>,
    deleteHandler: (tableName: string, where: any) => Promise<number>,
    bulkWriteHandler: (tableName: string, operations: any[]) => Promise<any>
  ): Promise<void> {
    // 获取当前事务
    const transaction = this.transactions.pop();
    if (!transaction) {
      throw new Error('No transaction to commit');
    }

    try {
      // 执行所有事务操作
      for (const operation of transaction.operations) {
        switch (operation.type) {
          case 'write':
            await writeHandler(operation.tableName, operation.data, operation.options);
            break;
          case 'delete':
            await deleteHandler(operation.tableName, operation.data);
            break;
          case 'bulkWrite':
            await bulkWriteHandler(operation.tableName, operation.data);
            break;
        }
      }

      transaction.status = 'committed';
    } catch (error) {
      transaction.status = 'failed';
      throw error;
    }
  }

  /**
   * 回滚事务
   * @returns Promise<void>
   */
  async rollback(): Promise<void> {
    // 获取当前事务
    const transaction = this.transactions.pop();
    if (!transaction) {
      return;
    }

    transaction.status = 'rolled-back';
  }

  /**
   * 保存表数据快照
   * @param tableName 表名
   * @param data 表数据
   */
  saveSnapshot(tableName: string, data: any): void {
    // 只保存第一次操作该表的快照
    if (!this.snapshots.has(tableName)) {
      this.snapshots.set(tableName, {
        data,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 添加事务操作
   * @param operation 操作对象
   */
  addOperation(operation: any): void {
    const transaction = this.transactions[this.transactions.length - 1];
    if (transaction) {
      transaction.operations.push(operation);
    }
  }
}
```
