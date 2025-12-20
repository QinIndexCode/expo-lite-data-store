# expo-lite-data-store

English: [English Document](./README.en.md)
中文版: [中文文档](./README.zh-CN.md)

---

**注意** 当前项目测试覆盖范围有限，可能存在未发现的问题。在生产环境中使用前，请务必进行充分测试。

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.72+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

**轻量、易配置、纯 TypeScript 编写的 Expo 本地数据库**

专为 React Native + Expo 项目设计，无需任何 native 依赖。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

## ✨ 核心特性

| 特性                       | 描述                                           |
| -------------------------- | ---------------------------------------------- |
| 🚀 **易配置使用**          | 仅依赖 React Native FS，无需 Metro 配置        |
| 🔒 **可选加密**            | AES-CTR 加密，支持可选生物识别认证，密钥由系统自动生成和管理         |
| 📦 **智能分块**            | 自动处理 >5MB 文件，规避 RN FS 限制            |
| 🔄 **事务支持**            | 事务保证，数据一致性有保障                    |
| 📝 **TypeScript 原生支持** | 完整的类型定义，开箱即用                       |
| 🔍 **高级查询**            | 支持 where、skip、limit、sort 等查询选项       |
| 📱 **完全离线**            | 无需网络，数据 100% 存储在设备本地             |
| 🎯 **智能排序**            | 5种排序算法，根据数据量自动选择合适算法        |
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

// 查询单条数据 - Prisma风格：将where作为options的一部分
const user = await findOne('users', {
  where: { id: 1 }
});
console.log(user); // { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' }

// 查询多条数据 - Prisma风格：将where作为options的一部分
const users = await findMany('users', {
  where: { age: { $gte: 30 } },
  sortBy: 'age',
  order: 'desc'
});
console.log(users); // 返回年龄 >= 30 的用户，按年龄降序排列

// 更新数据 - Prisma风格：将where作为options的一部分
await update('users', { age: 26 }, {
  where: { id: 1 }
});

// 更新数据 - 复杂条件（Prisma风格）
await update('users', { active: true }, {
  where: { age: { $gte: 30 } }
});

// 删除数据 - Prisma风格：将where作为options的一部分
await remove('users', {
  where: { id: 2 }
});

// 删除数据 - 复杂条件（Prisma风格）
await remove('users', {
  where: { age: { $lt: 18 } }
});
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

const users = await findMany('users', {
  where: {},
  sortBy: 'age',
  order: 'desc'
});

console.log(users);
```

## 🔒 加密使用说明

### 非加密模式

默认情况下，数据库使用非加密模式，**不会触发任何生物识别认证**：

```typescript
// 非加密模式（默认）
await createTable('users');
await insert('users', { id: 1, name: '张三' });
const user = await findOne('users', { where: { id: 1 } });
```

**重要说明**：非加密模式下，数据以明文形式存储，不会使用任何加密算法，也不会触发生物识别或密码认证。

### 加密模式

启用加密模式，但不要求每次访问都进行生物识别认证：

```typescript
// 加密模式，无需生物识别
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: false
});
await insert('users', { id: 1, name: '张三' }, {
  encrypted: true,
  requireAuthOnAccess: false
});
const user = await findOne('users', { 
  where: { id: 1 },
  encrypted: true,
  requireAuthOnAccess: false
});
```

### 加密模式 + 生物识别认证

启用加密模式，并要求每次访问都进行生物识别认证：

```typescript
// 加密模式，需要生物识别
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: true
});
await insert('users', { id: 1, name: '张三' }, {
  encrypted: true,
  requireAuthOnAccess: true
});
const user = await findOne('users', { 
  where: { id: 1 },
  encrypted: true,
  requireAuthOnAccess: true
});
```

### 加密参数说明

| 参数名               | 类型    | 默认值 | 说明                                                                 |
| -------------------- | ------- | ------ | -------------------------------------------------------------------- |
| `encrypted`          | boolean | false  | 是否启用数据加密                                                     |
| `requireAuthOnAccess`| boolean | false  | 是否在每次访问数据时都要求生物识别认证（仅在 `encrypted` 为 true 时生效） |
| `encryptFullTable`   | boolean | false  | 是否启用整表加密（仅在 `encrypted` 为 true 时生效，与字段级加密互斥） |
| `encryptedFields` | string[] | [] | 需要加密的字段列表（当数组不为空时自动启用字段级加密，仅在 `encrypted` 为 true 时生效，与整表加密互斥） |

**重要说明**：
- 整表加密和字段级加密**不能同时使用**，系统会自动检测冲突并抛出明确的错误信息
- 加密模式下，密钥由系统自动生成和管理，无需手动处理
- 生物识别认证仅在 `requireAuthOnAccess` 为 true 时触发

## 📚 基础 API 参考

### 🗂️ 表管理

| 方法          | 签名                                                                             | 说明           |
| ------------- | -------------------------------------------------------------------------------- | -------------- |
| `createTable` | `(tableName, options) => Promise<void>` | 创建新表       |
| `deleteTable` | `(tableName, options) => Promise<void>` | 删除表         |
| `hasTable`    | `(tableName, options) => Promise<boolean>` | 检查表是否存在 |
| `listTables`  | `(options) => Promise<string[]>` | 获取所有表名   |
| `countTable`  | `(tableName, options) => Promise<number>` | 获取表记录数   |
| `clearTable`  | `(tableName, options) => Promise<void>` | 清空表数据     |

### 💾 数据操作

| 方法        | 签名                                                                                       | 说明                             |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `insert`    | `(tableName, data, options) => Promise<WriteResult>`        | 插入单条或多条数据             |
| `read`      | `(tableName, options) => Promise<any[]>`          | 读取数据（支持过滤、分页、排序） |
| `findOne`   | `(tableName, { where, encrypted?, requireAuthOnAccess? }) => Promise<any\|null>`        | 查询单条记录                     |
| `findMany`  | `(tableName, { where?, skip?, limit?, sortBy?, order?, sortAlgorithm?, encrypted?, requireAuthOnAccess? }) => Promise<any[]>` | 查询多条记录（支持高级选项）     |
| `update`    | `(tableName, data, { where, encrypted?, requireAuthOnAccess? }) => Promise<number>`      | 更新匹配的记录                   |
| `remove`    | `(tableName, { where, encrypted?, requireAuthOnAccess? }) => Promise<number>`            | 删除匹配的记录                   |
| `bulkWrite` | `(tableName, operations, options) => Promise<WriteResult>`  | 批量操作                         |

### 🔄 事务管理

| 方法               | 签名                                                                       | 说明         |
| ------------------ | -------------------------------------------------------------------------- | ------------ |
| `beginTransaction` | `(options) => Promise<void>` | 开始新事务   |
| `commit`           | `(options) => Promise<void>` | 提交当前事务 |
| `rollback`         | `(options) => Promise<void>` | 回滚当前事务 |

### 🛠️ API 参数说明

所有 API 采用 Prisma 风格的选项对象格式，支持的通用选项：

| 参数名               | 类型    | 默认值 | 说明                                                                 |
| -------------------- | ------- | ------ | -------------------------------------------------------------------- |
| `encrypted`          | boolean | false  | 是否启用数据加密                                                     |
| `requireAuthOnAccess`| boolean | false  | 是否在每次访问数据时都要求生物识别认证（仅在 `encrypted` 为 true 时生效） |

### 📝 新 API 设计

所有 API 现在采用统一的 Prisma 风格设计，将条件查询参数 `where` 作为选项对象的一部分，提高了 API 的一致性和易用性：

```typescript
// 新的 Prisma 风格 API
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: false
});
```

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

### 如何修改配置

配置直接从打包文件加载。要修改配置，您需要编辑以下文件：

```
node_modules/expo-lite-data-store/dist/js/liteStore.config.js
```

### 配置选项

配置文件包含以下主要选项：

```typescript
// liteStore.config.js
module.exports = {
  // 基础配置
  chunkSize: 5 * 1024 * 1024, // 文件分块大小（5MB）
  storageFolder: 'expo-litedatastore', // 存储文件夹名称
  sortMethods: 'default', // 默认排序算法
  timeout: 10000, // 操作超时时间（10秒）
  
  // 加密配置
  encryption: {
    algorithm: 'AES-CTR', // 加密算法
    keySize: 256, // 密钥长度
    hmacAlgorithm: 'SHA-512', // HMAC算法
    keyIterations: 120000, // 密钥迭代次数

    encryptedFields: ['password', 'email', 'phone'], // 需要加密的字段
    cacheTimeout: 30000, // 密钥缓存超时时间（30秒）
    maxCacheSize: 50, // 最大缓存密钥数量
    useBulkOperations: true, // 是否启用批量操作
  },
  
  // 性能配置
  performance: {
    enableQueryOptimization: true, // 是否启用查询优化
    maxConcurrentOperations: 5, // 最大并发操作数
    enableBatchOptimization: true, // 是否启用批量操作优化
    memoryWarningThreshold: 0.8, // 内存警告阈值（80%）
  },
  
  // 缓存配置
  cache: {
    maxSize: 1000, // 最大缓存大小
    defaultExpiry: 3600000, // 默认过期时间（1小时）
    enableCompression: false, // 是否启用压缩
    cleanupInterval: 300000, // 清理间隔（5分钟）
    memoryWarningThreshold: 0.8, // 内存警告阈值（80%）
    autoSync: {
      enabled: true, // 是否启用自动同步
      interval: 5000, // 同步间隔（5秒）
      minItems: 1, // 触发同步的最小项目数
      batchSize: 100, // 每次同步的最大项目数
    },
  },
  
  // 监控配置
  monitoring: {
    enablePerformanceTracking: true, // 是否启用性能跟踪
    enableHealthChecks: true, // 是否启用健康检查
    metricsRetention: 86400000, // 指标保留时间（24小时）
  },
}
```

## 🐛 常见问题

### Q: 如何切换不同版本？

A: 库通过类型定义文件自动提供TypeScript支持，JavaScript和TypeScript项目可以使用相同的导入路径：

- `import { ... } from 'expo-lite-data-store'` - 推荐使用
- `import { ... } from 'expo-lite-data-store/js'` - 显式指定JavaScript版本（与默认相同）

### Q: 如何处理中文排序？

A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持：

```typescript
const users = await findMany('users', {
  where: {},
  sortBy: 'name',
  sortAlgorithm: 'slow',
});
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