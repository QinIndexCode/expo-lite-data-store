# expo-liteDataStore 

[![npm version](https://img.shields.io/npm/v/expo-lite-db-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-db-store) [![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-liteDataStore)](https://github.com/QinIndexCode/expo-liteDataStore/blob/main/LICENSE)

超轻量、零配置、纯 TypeScript 编写的 Expo 本地数据库  
专为 React Native + Expo 项目设计，无需任何 native 依赖。

适合中小型数据持久化场景：用户设置、表单草稿、离线缓存、轻量内容管理等。

> 当前版本：1.0.0（稳定版，API 已稳定，欢迎试用与反馈）

## 特性一览

| 特性                  | 说明                                      |
|-----------------------|-------------------------------------------|
| 零依赖、零配置        | 仅依赖 React Native FS，不需要 Metro 配置 |
| 支持加密              | 可选 AES-GCM 加密，密钥由你完全掌控       |
| 分块存储              | 单文件最大 5MB 自动分块，完美规避 RN FS 限制 |
| 批量操作 & 事务支持   | 完整的事务支持，保证数据一致性            |
| TypeScript 完美支持   | 完整类型定义，开箱即用                    |
| 支持复杂查询          | 支持 where、skip、limit 等查询条件        |
| 完全离线可用          | 无需网络，数据 100% 存储在设备本地        |

## 安装

```bash
npm install expo-lite-db-store
# 或使用 yarn / pnpm
yarn add expo-lite-db-store
pnpm add expo-lite-db-store
```

## 快速开始

```ts
import { 
  createTable, 
  insert, 
  findOne, 
  update, 
  remove, 
  findMany 
} from 'expo-lite-db-store';

// 创建表
await createTable('users');

// 插入数据
await insert('users', [
  { id: 1, name: '张三', age: 25, active: true },
  { id: 2, name: '李四', age: 30, active: false },
  { id: 3, name: '王五', age: 35, active: true }
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

## API 总览

### 表管理

| 方法                     | 说明                              | 返回值         |
|--------------------------|-----------------------------------|----------------|
| `createTable(tableName, options)` | 创建表 | Promise<void>  |
| `deleteTable(tableName)` | 删除表 | Promise<void>  |
| `hasTable(tableName)` | 检查表是否存在 | Promise<boolean> |
| `listTables()` | 列出所有表 | Promise<string[]> |
| `countTable(tableName)` | 获取表的记录数 | Promise<number> |
| `clearTable(tableName)` | 清空表数据 | Promise<void> |

### 数据操作

| 方法                     | 说明                              | 返回值         |
|--------------------------|-----------------------------------|----------------|
| `insert(tableName, data)` | 插入数据 | Promise<WriteResult>  |
| `read(tableName, options)` | 读取数据 | Promise<Record<string, any>[]> |
| `findOne(tableName, filter)` | 查询单条数据 | Promise<Record<string, any> \| null> |
| `findMany(tableName, filter, options)` | 查询多条数据 | Promise<Record<string, any>[]> |
| `update(tableName, data, where)` | 更新数据 | Promise<number> |
| `remove(tableName, where)` | 删除数据 | Promise<number> |
| `bulkWrite(tableName, operations)` | 批量操作 | Promise<WriteResult> |

### 事务管理

| 方法                     | 说明                              | 返回值         |
|--------------------------|-----------------------------------|----------------|
| `beginTransaction()` | 开始事务 | Promise<void>  |
| `commit()` | 提交事务 | Promise<void>  |
| `rollback()` | 回滚事务 | Promise<void>  |

### 模式迁移

| 方法                     | 说明                              | 返回值         |
|--------------------------|-----------------------------------|----------------|
| `migrateToChunked(tableName)` | 迁移到分片模式 | Promise<void>  |

## 高级用法

### 事务操作

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

### 复杂查询

```ts
import { findMany } from 'expo-lite-db-store';

// 查询年龄大于 30 且活跃的用户，跳过前 1 条，限制返回 10 条
const users = await findMany('users', 
  { age: { $gt: 30 }, active: true },
  { skip: 1, limit: 10 }
);
```

## 许可证

MIT © QinIndex Qin

---

喜欢的话别忘了点个 Star ✨  
发现 Bug 或有新需求欢迎提 Issue / PR～
