# expo-liteDBStore 文档

## 1. 项目概述

### 1.1 什么是 expo-liteDBStore？

expo-liteDBStore 是一个超轻量、零配置、纯 TypeScript 编写的 Expo 本地数据库，专为 React Native + Expo 项目设计，无需任何 native 依赖。

### 1.2 核心优势

| 特性                | 说明                                         |
| ------------------- | -------------------------------------------- |
| 零依赖、零配置      | 仅依赖 React Native FS，不需要 Metro 配置    |
| 支持加密            | 可选 AES-GCM 加密，密钥由你完全掌控          |
| 分块存储            | 单文件最大 5MB 自动分块，完美规避 RN FS 限制 |
| 批量操作 & 事务支持 | 完整的事务支持，保证数据一致性               |
| TypeScript 完美支持 | 完整类型定义，开箱即用                       |
| 支持复杂查询        | 支持 where、skip、limit 等查询条件           |
| 完全离线可用        | 无需网络，数据 100% 存储在设备本地           |

### 1.3 适用场景

- 用户设置存储
- 表单草稿保存
- 离线数据缓存
- 轻量内容管理
- 应用状态持久化

## 2. 快速入门

### 2.1 安装

```bash
npm install expo-lite-db-store
# 或使用 yarn / pnpm
yarn add expo-lite-db-store
pnpm add expo-lite-db-store
```

### 2.2 基本使用

```ts
import { createTable, insert, findOne, update, remove, findMany } from 'expo-lite-db-store';

// 创建表
await createTable('users');

// 插入数据
await insert('users', [
  { id: 1, name: '张三', age: 25, active: true },
  { id: 2, name: '李四', age: 30, active: false },
  { id: 3, name: '王五', age: 35, active: true },
]);

// 查询单条数据
const user = await findOne('users', { id: 1 });
console.log(user); // { id: 1, name: '张三', age: 25, active: true }

// 更新数据
await update('users', { age: 26 }, { id: 1 });

// 查询多条数据
const activeUsers = await findMany('users', { active: true });
console.log(activeUsers.length); // 2

// 删除数据
await remove('users', { id: 2 });
```

## 3. 核心功能详解

### 3.1 表管理

#### 3.1.1 创建表

```ts
import { createTable } from 'expo-lite-db-store';

// 基本创建
await createTable('users');

// 带选项创建
await createTable('users', {
  columns: { id: 'string', name: 'string', age: 'number' },
  intermediates: true, // 自动创建中间目录
  chunkSize: 1024 * 1024, // 1MB 分片大小
});
```

#### 3.1.2 表操作

```ts
import { hasTable, listTables, deleteTable, clearTable } from 'expo-lite-db-store';

// 检查表是否存在
const exists = await hasTable('users');

// 列出所有表
const tables = await listTables();

// 删除表
await deleteTable('users');

// 清空表数据
await clearTable('users');
```

### 3.2 数据操作

#### 3.2.1 插入数据

```ts
import { insert } from 'expo-lite-db-store';

// 插入单条数据
await insert('users', { id: 1, name: '张三', age: 25 });

// 插入多条数据
await insert('users', [
  { id: 2, name: '李四', age: 30 },
  { id: 3, name: '王五', age: 35 },
]);

// 带写入选项插入
await insert('users', [{ id: 4, name: '赵六', age: 40 }], {
  mode: 'append', // 追加模式
  forceChunked: true, // 强制分片写入
});
```

#### 3.2.2 查询数据

```ts
import { findOne, findMany, read } from 'expo-lite-db-store';

// 查询单条数据
const user = await findOne('users', { id: 1 });

// 查询多条数据
const activeUsers = await findMany('users', { active: true });

// 复杂查询
const filteredUsers = await findMany('users', { age: { $gt: 30 }, active: true }, { skip: 1, limit: 10 });

// 读取所有数据
const allUsers = await read('users');

// 带选项读取
const paginatedUsers = await read('users', {
  skip: 0,
  limit: 20,
  filter: { active: true },
});
```

#### 3.2.3 更新数据

```ts
import { update } from 'expo-lite-db-store';

// 更新匹配条件的数据
const updatedCount = await update(
  'users',
  { age: 26, active: true }, // 更新内容
  { id: 1 } // 匹配条件
);
```

#### 3.2.4 删除数据

```ts
import { remove } from 'expo-lite-db-store';

// 删除单条数据
const deletedCount = await remove('users', { id: 1 });

// 删除多条数据
const deletedCount = await remove('users', { active: false });
```

### 3.3 事务管理

```ts
import { beginTransaction, commit, rollback, insert, update } from 'expo-lite-db-store';

try {
  // 开始事务
  await beginTransaction();

  // 执行多个操作
  await insert('orders', { id: 1, amount: 100 });
  await update('users', { balance: 900 }, { id: 1 });

  // 提交事务
  await commit();
} catch (error) {
  // 出错时回滚
  await rollback();
  console.error('Transaction failed:', error);
}
```

### 3.4 批量操作

```ts
import { bulkWrite } from 'expo-lite-db-store';

// 批量写入数据
const result = await bulkWrite('users', [
  { type: 'insert', data: { id: 1, name: '张三' } },
  { type: 'insert', data: { id: 2, name: '李四' } },
  { type: 'update', data: { age: 26 }, where: { id: 1 } },
  { type: 'delete', where: { id: 3 } },
]);
```

### 3.5 分块存储

```ts
import { createTable, migrateToChunked } from 'expo-lite-db-store';

// 创建表时指定分块大小
await createTable('largeData', {
  chunkSize: 5 * 1024 * 1024, // 5MB 分片大小
});

// 将现有表迁移到分块模式
await migrateToChunked('existingTable');
```

## 4. API 参考

### 4.1 表管理 API

#### `createTable(tableName: string, options?: CreateTableOptions): Promise<void>`

创建一个新表。

**参数：**

- `tableName`: 表名
- `options`: 可选配置
  - `columns`: 列定义
  - `intermediates`: 是否自动创建中间目录
  - `chunkSize`: 分片大小（字节）

**返回值：**

- `Promise<void>`

#### `hasTable(tableName: string): Promise<boolean>`

检查指定表是否存在。

**参数：**

- `tableName`: 表名

**返回值：**

- `Promise<boolean>`: 表是否存在

#### `listTables(): Promise<string[]>`

列出所有表名。

**返回值：**

- `Promise<string[]>`: 表名数组

#### `deleteTable(tableName: string): Promise<void>`

删除指定表。

**参数：**

- `tableName`: 表名

**返回值：**

- `Promise<void>`

#### `clearTable(tableName: string): Promise<void>`

清空指定表的数据。

**参数：**

- `tableName`: 表名

**返回值：**

- `Promise<void>`

### 4.2 数据操作 API

#### `insert(tableName: string, data: any | any[], options?: WriteOptions): Promise<WriteResult>`

插入数据到指定表。

**参数：**

- `tableName`: 表名
- `data`: 要插入的数据（单条或数组）
- `options`: 可选配置
  - `mode`: 写入模式（`append` 或 `overwrite`）
  - `forceChunked`: 是否强制分片写入

**返回值：**

- `Promise<WriteResult>`: 写入结果

#### `read(tableName: string, options?: ReadOptions): Promise<any[]>`

读取指定表的数据。

**参数：**

- `tableName`: 表名
- `options`: 可选配置
  - `skip`: 跳过的记录数
  - `limit`: 读取的记录数
  - `filter`: 过滤条件

**返回值：**

- `Promise<any[]>`: 读取的数据数组

#### `findOne(tableName: string, filter: FilterCondition): Promise<any | null>`

查询单条匹配数据。

**参数：**

- `tableName`: 表名
- `filter`: 过滤条件

**返回值：**

- `Promise<any | null>`: 匹配的数据或 null

#### `findMany(tableName: string, filter: FilterCondition, options?: { skip?: number; limit?: number }): Promise<any[]>`

查询多条匹配数据。

**参数：**

- `tableName`: 表名
- `filter`: 过滤条件
- `options`: 可选配置
  - `skip`: 跳过的记录数
  - `limit`: 读取的记录数

**返回值：**

- `Promise<any[]>`: 匹配的数据数组

#### `update(tableName: string, data: any, where: FilterCondition): Promise<number>`

更新匹配条件的数据。

**参数：**

- `tableName`: 表名
- `data`: 要更新的数据
- `where`: 匹配条件

**返回值：**

- `Promise<number>`: 更新的记录数

#### `remove(tableName: string, where: FilterCondition): Promise<number>`

删除匹配条件的数据。

**参数：**

- `tableName`: 表名
- `where`: 匹配条件

**返回值：**

- `Promise<number>`: 删除的记录数

#### `bulkWrite(tableName: string, operations: BulkWriteOperation[]): Promise<WriteResult>`

执行批量写操作。

**参数：**

- `tableName`: 表名
- `operations`: 批量操作数组
  - `type`: 操作类型（`insert`、`update` 或 `delete`）
  - `data`: 数据（`insert` 和 `update` 操作需要）
  - `where`: 匹配条件（`update` 和 `delete` 操作需要）

**返回值：**

- `Promise<WriteResult>`: 写入结果

### 4.3 事务 API

#### `beginTransaction(): Promise<void>`

开始一个事务。

**返回值：**

- `Promise<void>`

#### `commit(): Promise<void>`

提交当前事务。

**返回值：**

- `Promise<void>`

#### `rollback(): Promise<void>`

回滚当前事务。

**返回值：**

- `Promise<void>`

### 4.4 工具 API

#### `migrateToChunked(tableName: string): Promise<void>`

将指定表迁移到分块存储模式。

**参数：**

- `tableName`: 表名

**返回值：**

- `Promise<void>`

## 5. 高级用法

### 5.1 复杂查询

```ts
import { findMany } from 'expo-lite-db-store';

// 使用函数作为过滤条件
const users = await findMany('users', user => {
  return user.age > 30 && user.active;
});

// 使用 $or 操作符
const users = await findMany('users', {
  $or: [{ age: { $gt: 30 } }, { active: true }],
});

// 使用 $and 操作符
const users = await findMany('users', {
  $and: [{ age: { $gt: 30 } }, { active: true }],
});
```

### 5.2 事务管理

```ts
import { beginTransaction, commit, rollback, insert, update } from 'expo-lite-db-store';

try {
  await beginTransaction();

  // 执行多个操作
  await insert('orders', { id: 1, userId: 1, amount: 100 });
  await update('users', { balance: 900 }, { id: 1 });

  // 提交事务
  await commit();
  console.log('Transaction committed successfully');
} catch (error) {
  // 出错时回滚
  await rollback();
  console.error('Transaction failed:', error);
}
```

### 5.3 加密存储

```ts
import { db } from 'expo-lite-db-store';

// 使用加密存储
const encryptedDb = db.withEncryption('your-secret-key');

// 使用加密存储进行操作
await encryptedDb.createTable('sensitiveData');
await encryptedDb.write('sensitiveData', { secret: 'value' });
```

## 6. 配置选项

### 6.1 全局配置

```ts
// liteStore.config.js
module.exports = {
  defaultChunkSize: 5 * 1024 * 1024, // 5MB
  encryptionKey: 'your-default-key',
  cacheSize: 100,
  timeout: 30000, // 30秒超时
};
```

### 6.2 运行时配置

```ts
import { db } from 'expo-lite-db-store';

// 配置数据库实例
db.configure({
  chunkSize: 2 * 1024 * 1024, // 2MB
  encryptionKey: 'runtime-key',
});
```

## 7. 常见问题解答

### 7.1 如何处理大数据量？

对于大数据量，建议：

1. 使用分块存储模式（设置合理的 chunkSize）
2. 使用分页查询（skip + limit）
3. 避免一次性读取所有数据
4. 使用索引（如果支持）

### 7.2 如何确保数据安全？

1. 使用加密存储功能
2. 定期备份数据
3. 避免存储敏感信息（如密码）
4. 使用安全的密钥管理方案

### 7.3 如何优化性能？

1. 减少磁盘 I/O 操作
2. 使用批量操作
3. 合理设置缓存大小
4. 避免频繁的表创建和删除

### 7.4 支持哪些数据类型？

支持所有 JSON 数据类型：

- 字符串
- 数字
- 布尔值
- 对象
- 数组
- null

### 7.5 如何迁移数据？

1. 使用 `migrateToChunked` 方法迁移到分块存储
2. 对于结构变更，建议：
   - 读取旧数据
   - 转换为新结构
   - 写入新表
   - 删除旧表

## 8. 性能优化建议

### 8.1 写入优化

1. 使用批量操作减少 I/O 次数
2. 合理设置分块大小
3. 避免频繁的小数据写入
4. 使用异步写入

### 8.2 读取优化

1. 使用分页查询
2. 合理使用过滤条件
3. 避免一次性读取大量数据
4. 利用缓存机制

### 8.3 内存优化

1. 及时释放不再使用的数据
2. 合理设置缓存大小
3. 避免内存泄漏

## 9. 故障排除

### 9.1 常见错误

| 错误类型   | 可能原因             | 解决方案                       |
| ---------- | -------------------- | ------------------------------ |
| 文件不存在 | 表未创建或已删除     | 检查表名是否正确，确保表已创建 |
| 权限错误   | 应用没有文件系统权限 | 检查应用权限设置               |
| 数据损坏   | 文件被意外修改       | 恢复备份或重新创建表           |
| 超时错误   | 操作耗时过长         | 优化查询或增加超时时间         |

### 9.2 调试技巧

1. 使用 Expo 开发工具查看日志
2. 检查文件系统中的数据文件
3. 使用 `console.log` 调试查询条件
4. 监控内存使用情况

## 10. 版本历史

### 1.0.0 (稳定版)

- 初始版本发布
- 支持基本的 CRUD 操作
- 支持事务管理
- 支持分块存储
- 支持加密存储
- 完整的 TypeScript 支持

## 11. 贡献指南

### 11.1 如何贡献

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

### 11.2 开发环境设置

```bash
# 克隆仓库
git clone https://github.com/QinIndexCode/expo-liteDBStore.git

# 安装依赖
npm install

# 运行测试
npm test

# 构建项目
npm run build

# 生成文档
npm run docs
```

## 12. 许可证

MIT © QinIndex Qin

## 13. 联系方式

- GitHub: [https://github.com/QinIndexCode/expo-liteDBStore](https://github.com/QinIndexCode/expo-liteDBStore)
- 邮箱: [qinindexcode@gmail.com](mailto:qinindexcode@gmail.com)

---

喜欢的话别忘了点个 Star ✨
发现 Bug 或有新需求欢迎提 Issue / PR～
