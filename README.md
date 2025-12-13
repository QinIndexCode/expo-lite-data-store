# expo-lite-data-store

中文版: [中文文档](./README.md) |
English: [English Document](./README_EN.md)

---

**注意** 当前项目测试覆盖范围有限，可能存在未发现的问题。在生产环境中使用前，请务必进行充分测试。

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-51.0+-blue.svg)](https://expo.dev/)

**超轻量、零配置、纯 TypeScript 编写的 Expo 本地数据库**

专为 React Native + Expo 项目设计，无需任何 native 依赖。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

## ✨ 核心特性

| 特性                       | 描述                                           |
| -------------------------- | ---------------------------------------------- |
| 🚀 **零配置使用**          | 仅依赖 React Native FS，无需 Metro 配置        |
| 🔒 **可选加密**            | AES-GCM 加密，密钥完全由您掌控                 |
| 📦 **智能分块**            | 自动处理 >5MB 文件，完美规避 RN FS 限制        |
| 🔄 **完整事务**            | ACID 事务保证，数据一致性有保障                |
| 📝 **TypeScript 原生支持** | 完整的类型定义，开箱即用                       |
| 🔍 **复杂查询**            | 支持 where、skip、limit、sort 等高级查询       |
| 📱 **完全离线**            | 无需网络，数据 100% 存储在设备本地             |
| 🎯 **智能排序**            | 5种排序算法，自动选择最优性能                  |
| ⏰ **自动同步**            | 定期将缓存中的脏数据同步到磁盘，确保数据持久化 |

## 📦 安装

```bash
npm install expo-lite-data-store
# 或使用 yarn / pnpm ( 目前只上传了npm,后续将会跟进yarn , pnpm)
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

## 🚀 快速开始

```typescript
// ES 模块导入
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// CommonJS 导入
// const { createTable, insert, findOne, findMany, update, remove } = require('expo-lite-data-store');

// 创建用户表
await createTable('users');

// 插入数据
await insert('users', [
  { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: '李四', age: 30, email: 'lisi@example.com' },
  { id: 3, name: '王五', age: 35, email: 'wangwu@example.com' },
]);

// 查询单条数据
const user = await findOne('users', { id: 1 });
console.log(user); // { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' }

// 查询多条数据
const users = await findMany('users', { age: { $gte: 30 } });
console.log(users); // 返回年龄 >= 30 的用户

// 更新数据
await update('users', { age: 26 }, { id: 1 });

// 删除数据
await remove('users', { id: 2 });
```

```javascript
// JavaScript 中使用方式相同
const { createTable, insert, findMany } = require('expo-lite-data-store');

// 或使用 ES 模块导入
// import { createTable, insert, findMany } from 'expo-lite-data-store';

await createTable('users');

await insert('users', [
  { id: 1, name: 'Alice', age: 25 },
  { id: 2, name: 'Bob', age: 30 },
]);

const users = await findMany(
  'users',
  {},
  {
    sortBy: 'age',
    order: 'desc',
  }
);

console.log(users);
```

## 📚 基础 API 参考

### 🗂️ 表管理

| 方法          | 签名                                     | 说明           |
| ------------- | ---------------------------------------- | -------------- |
| `createTable` | `(tableName, options?) => Promise<void>` | 创建新表       |
| `deleteTable` | `(tableName) => Promise<void>`           | 删除表         |
| `hasTable`    | `(tableName) => Promise<boolean>`        | 检查表是否存在 |
| `listTables`  | `() => Promise<string[]>`                | 获取所有表名   |
| `countTable`  | `(tableName) => Promise<number>`         | 获取表记录数   |
| `clearTable`  | `(tableName) => Promise<void>`           | 清空表数据     |

### 💾 数据操作

| 方法        | 签名                                               | 说明                             |
| ----------- | -------------------------------------------------- | -------------------------------- |
| `insert`    | `(tableName, data) => Promise<WriteResult>`        | 插入单条或多条数据               |
| `read`      | `(tableName, options?) => Promise<any[]>`          | 读取数据（支持过滤、分页、排序） |
| `findOne`   | `(tableName, filter) => Promise<any\|null>`        | 查询单条记录                     |
| `findMany`  | `(tableName, filter?, options?) => Promise<any[]>` | 查询多条记录（支持高级选项）     |
| `update`    | `(tableName, data, where) => Promise<number>`      | 更新匹配的记录                   |
| `remove`    | `(tableName, where) => Promise<number>`            | 删除匹配的记录                   |
| `bulkWrite` | `(tableName, operations) => Promise<WriteResult>`  | 批量操作                         |

### 🔄 事务管理

| 方法               | 签名                  | 说明         |
| ------------------ | --------------------- | ------------ |
| `beginTransaction` | `() => Promise<void>` | 开始新事务   |
| `commit`           | `() => Promise<void>` | 提交当前事务 |
| `rollback`         | `() => Promise<void>` | 回滚当前事务 |

## 📖 详细文档

完整的详细文档请查看本地 [WIKI.md](./WIKI.md) 文件，包含：

- 🎯 **高级查询**：复杂条件查询、操作符、复合查询
- 🎯 **智能排序**：多字段排序、算法选择、性能优化
- 🎯 **事务管理**：ACID 事务、嵌套事务、最佳实践
- 🎯 **自动同步**：配置、统计、手动触发
- 🎯 **性能优化**：索引、批量操作、分页策略
- 🎯 **安全性**：数据加密、密钥管理
- 🎯 **故障排除**：常见问题、调试技巧

## 🔧 配置

```typescript
// liteStore.config.js
module.exports = {
  // 加密配置
  encryption: {
    cacheTimeout: 30000, // 缓存超时时间（毫秒）
    maxCacheSize: 100, // 最大缓存表数量
    // 其他加密配置...
  },
  // 性能配置
  performance: {
    enableQueryOptimization: true, // 启用查询优化
    enableBatchOptimization: true, // 启用批量操作优化
    // 其他性能配置...
  },
  // 其他配置...
};
```

## 🐛 常见问题

### Q: 如何切换不同版本？

A: 库通过类型定义文件自动提供TypeScript支持，JavaScript和TypeScript项目可以使用相同的导入路径：

- `import { ... } from 'expo-lite-data-store'` - 推荐使用
- `import { ... } from 'expo-lite-data-store/js'` - 显式指定JavaScript版本（与默认相同）

### Q: 如何处理中文排序？

A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持：

```typescript
const users = await findMany(
  'users',
  {},
  {
    sortBy: 'name',
    sortAlgorithm: 'slow',
  }
);
```

### Q: 如何提高查询性能？

A: 对于大数据集，建议使用：

- 分页查询
- 合适的排序算法
- 批量操作

## 📞 支持与反馈

- 📧 **邮箱**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **文档**: [完整文档](https://github.com/QinIndexCode/expo-liteDataStore/wiki)

## 许可证

MIT © QinIndex Qin

---

喜欢的话别忘了点个 ⭐ Star，让更多人发现这个项目！
