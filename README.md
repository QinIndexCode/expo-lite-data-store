# Expo Lite-Data-Store

[![npm version](https://img.shields.io/npm/v/expo-lite-db-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-db-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-liteDataStore)](https://github.com/QinIndexCode/expo-liteDataStore/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81+-blue.svg)](https://reactnative.dev/)

**超轻量、零配置、纯 TypeScript 编写的 Expo 本地数据库**

专为 React Native + Expo 项目设计，无需任何 native 依赖。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

---

## ✨ 核心特性

| 特性 | 描述 |
|------|------|
| 🚀 **零配置使用** | 仅依赖 React Native FS，无需 Metro 配置 |
| 🔒 **可选加密** | AES-GCM 加密，密钥完全由您掌控 |
| 📦 **智能分块** | 自动处理 >5MB 文件，完美规避 RN FS 限制 |
| 🔄 **完整事务** | ACID 事务保证，数据一致性有保障 |
| 📝 **TypeScript 原生支持** | 完整的类型定义，开箱即用 |
| 🔍 **复杂查询** | 支持 where、skip、limit、sort 等高级查询 |
| 📱 **完全离线** | 无需网络，数据 100% 存储在设备本地 |
| 🎯 **智能排序** | 5种排序算法，自动选择最优性能 |

---

## 📦 安装

```bash
npm install expo-lite-db-store
# 或使用 yarn / pnpm
yarn add expo-lite-db-store
pnpm add expo-lite-db-store
```

### 📦 构建版本

项目提供 TypeScript 和 JavaScript 双版本：

```bash
# 构建所有版本
npm run build:all

# 仅构建 JavaScript 版本
npm run build:js

# 仅构建 TypeScript 类型定义
npm run build:types
```

---

## 🚀 快速开始

### TypeScript 版本 (推荐)

```typescript
import {
  createTable,
  insert,
  findOne,
  findMany,
  update,
  remove
} from 'expo-lite-db-store';

// 或使用具名导入
import { findMany } from 'expo-lite-db-store';

// 创建用户表
await createTable('users', {
  columns: {
    id: 'number',
    name: 'string',
    age: 'number',
    email: 'string'
  }
});

// 插入数据
await insert('users', [
  { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: '李四', age: 30, email: 'lisi@example.com' },
  { id: 3, name: '王五', age: 35, email: 'wangwu@example.com' }
]);

// 查询数据 - 支持排序
const users = await findMany('users', {}, {
  sortBy: 'age',
  order: 'desc',
  limit: 10
});

console.log(users);
// 输出: 王五(35), 李四(30), 张三(25)

// 条件查询
const activeUsers = await findMany('users', { age: { $gte: 30 } });
console.log(activeUsers); // 返回年龄 >= 30 的用户
```

### JavaScript 版本

```javascript
// CommonJS 导入
const {
  createTable,
  insert,
  findMany
} = require('expo-lite-db-store');

// ES6 导入
import { findMany } from 'expo-lite-db-store';

// 使用方式与 TypeScript 版本完全一致
await createTable('users');

await insert('users', [
  { id: 1, name: 'Alice', age: 25 },
  { id: 2, name: 'Bob', age: 30 }
]);

// 排序查询
const users = await findMany('users', {}, {
  sortBy: 'age',
  order: 'desc'
});

console.log(users);
```

### 版本选择

| 导入路径 | 类型支持 | 适用场景 |
|---------|---------|---------|
| `'expo-lite-db-store'` | ✅ TypeScript + JavaScript | 推荐使用 |
| `'expo-lite-db-store/ts'` | ✅ TypeScript | 需要原始源码 |
| `'expo-lite-db-store/js'` | ❌ JavaScript | 仅运行时使用 |

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

---

## 📚 API 参考

### 🗂️ 表管理

| 方法 | 签名 | 说明 |
|------|------|------|
| `createTable` | `(tableName, options?) => Promise<void>` | 创建新表 |
| `deleteTable` | `(tableName) => Promise<void>` | 删除表 |
| `hasTable` | `(tableName) => Promise<boolean>` | 检查表是否存在 |
| `listTables` | `() => Promise<string[]>` | 获取所有表名 |
| `countTable` | `(tableName) => Promise<number>` | 获取表记录数 |
| `clearTable` | `(tableName) => Promise<void>` | 清空表数据 |

### 💾 数据操作

| 方法 | 签名 | 说明 |
|------|------|------|
| `insert` | `(tableName, data) => Promise<WriteResult>` | 插入单条或多条数据 |
| `read` | `(tableName, options?) => Promise<any[]>` | 读取数据（支持过滤、分页、排序） |
| `findOne` | `(tableName, filter) => Promise<any\|null>` | 查询单条记录 |
| `findMany` | `(tableName, filter?, options?) => Promise<any[]>` | 查询多条记录（支持高级选项） |
| `update` | `(tableName, data, where) => Promise<number>` | 更新匹配的记录 |
| `remove` | `(tableName, where) => Promise<number>` | 删除匹配的记录 |
| `bulkWrite` | `(tableName, operations) => Promise<WriteResult>` | 批量操作 |

### 🔄 事务管理

| 方法 | 签名 | 说明 |
|------|------|------|
| `beginTransaction` | `() => Promise<void>` | 开始新事务 |
| `commit` | `() => Promise<void>` | 提交当前事务 |
| `rollback` | `() => Promise<void>` | 回滚当前事务 |

### 🔧 高级功能

| 方法 | 签名 | 说明 |
|------|------|------|
| `migrateToChunked` | `(tableName) => Promise<void>` | 迁移表到分块存储模式 |

---

## 🎯 高级用法

### 🔄 事务操作

确保数据一致性的最佳实践：

```typescript
import { beginTransaction, commit, rollback, insert, update } from 'expo-lite-db-store';

async function transferMoney(fromUserId: number, toUserId: number, amount: number) {
  try {
    // 开始事务
    await beginTransaction();

    // 检查发送者余额
    const sender = await findOne('users', { id: fromUserId });
    if (!sender || sender.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // 执行转账操作
    await update('users', { balance: sender.balance - amount }, { id: fromUserId });
    await update('users', { balance: { $inc: amount } }, { id: toUserId });

    // 记录转账日志
    await insert('transactions', {
      id: Date.now(),
      fromUserId,
      toUserId,
      amount,
      timestamp: new Date().toISOString()
    });

    // 提交事务
    await commit();
    console.log('Transfer completed successfully');
  } catch (error) {
    // 出错时回滚所有操作
    await rollback();
    console.error('Transfer failed:', error);
    throw error;
  }
}
```

### 🔍 高级查询

#### 条件查询操作符

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `$eq` | 等于 | `{ age: { $eq: 25 } }` |
| `$ne` | 不等于 | `{ status: { $ne: 'inactive' } }` |
| `$gt` | 大于 | `{ age: { $gt: 18 } }` |
| `$gte` | 大于等于 | `{ score: { $gte: 60 } }` |
| `$lt` | 小于 | `{ price: { $lt: 100 } }` |
| `$lte` | 小于等于 | `{ quantity: { $lte: 10 } }` |
| `$in` | 在数组中 | `{ category: { $in: ['A', 'B'] } }` |
| `$nin` | 不在数组中 | `{ status: { $nin: ['deleted'] } }` |
| `$like` | 模糊匹配 | `{ name: { $like: '张%' } }` |

#### 复合查询

```typescript
import { findMany } from 'expo-lite-db-store';

// AND 查询
const activeAdults = await findMany('users', {
  $and: [
    { age: { $gte: 18 } },
    { active: true },
    { role: { $in: ['user', 'admin'] } }
  ]
});

// OR 查询
const featuredOrNew = await findMany('products', {
  $or: [
    { featured: true },
    { createdAt: { $gt: '2024-01-01' } }
  ]
});

// 复杂嵌套查询
const complexQuery = await findMany('orders', {
  $and: [
    { status: 'completed' },
    {
      $or: [
        { total: { $gt: 1000 } },
        { priority: 'high' }
      ]
    },
    { createdAt: { $gte: '2024-01-01' } }
  ]
});
```

### 🎯 智能排序系统

#### 基础排序

```typescript
// 单字段排序
const usersByAge = await findMany('users', {}, {
  sortBy: 'age',
  order: 'asc'  // 'asc' | 'desc'
});

// 多字段排序（稳定排序）
const usersSorted = await findMany('users', {}, {
  sortBy: ['department', 'name', 'age'],
  order: ['asc', 'asc', 'desc']
});
```

#### 排序算法选择

系统提供5种专业排序算法，自动选择最优：

| 算法 | 适用场景 | 性能特点 |
|------|----------|----------|
| `default` | 小数据集 (< 100项) | 平衡性能和功能 |
| `fast` | 大数据集，简单比较 | 最快，但功能简化 |
| `merge` | 大数据集，稳定排序 | 稳定，适合大数据 |
| `counting` | 有限值域（如状态、等级） | O(n+k)，空间换时间 |
| `slow` | 需要完整localeCompare | 支持中文、特殊字符 |

```typescript
// 自动选择算法（推荐）
const users = await findMany('users', {}, { sortBy: 'score' });

// 手动指定算法
const users = await findMany('users', {}, {
  sortBy: 'name',
  sortAlgorithm: 'slow'  // 支持中文排序
});

// 大数据优化
const largeDataset = await findMany('logs', {}, {
  sortBy: 'timestamp',
  sortAlgorithm: 'merge'  // 适合大数据
});
```

#### 排序 + 过滤 + 分页

```typescript
// 完整查询示例
const paginatedResults = await findMany('products',
  // 过滤条件
  {
    $and: [
      { price: { $gte: 50, $lte: 500 } },
      { category: { $in: ['electronics', 'books'] } },
      { inStock: true }
    ]
  },
  // 查询选项
  {
    sortBy: ['rating', 'price', 'name'],
    order: ['desc', 'asc', 'asc'],
    skip: 20,    // 跳过前20条
    limit: 10    // 返回10条
  }
);
```

### 🔧 性能优化建议

#### 索引优化
```typescript
// 为经常查询的字段创建索引
// 注意：当前版本的索引功能正在开发中
// 未来版本将支持：
// await createIndex('users', 'email');
// await createIndex('products', ['category', 'price']);
```

#### 批量操作优化
```typescript
// 使用bulkWrite进行批量操作，比多次单独操作更高效
await bulkWrite('products', [
  { type: 'insert', data: { id: 1, name: 'Product 1' } },
  { type: 'update', data: { price: 29.99 }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } }
]);
```

#### 分页查询优化
```typescript
// 对于大数据集，使用分页避免一次性加载过多数据
const pageSize = 50;
let page = 0;

while (true) {
  const results = await findMany('largeTable', {}, {
    skip: page * pageSize,
    limit: pageSize,
    sortBy: 'id'
  });

  if (results.length === 0) break;

  // 处理当前页数据
  processPageData(results);

  page++;
}
```

---

## 🔄 TypeScript 与 JavaScript 双版本支持

项目同时提供 TypeScript 和 JavaScript 两种版本，满足不同开发环境的需求。

### 📁 文件结构

```
expo-lite-db-store/
├── src/                    # TypeScript 源码
│   ├── index.ts           # 主入口
│   ├── core/              # 核心模块
│   ├── types/             # 类型定义
│   └── utils/             # 工具函数
├── dist/
│   ├── js/                # JavaScript 编译输出
│   │   ├── index.js      # JS 主入口
│   │   └── core/         # JS 核心模块
│   └── types/             # TypeScript 类型定义
│       └── index.d.ts     # 类型声明文件
```

### 🛠️ 版本差异

| 特性 | TypeScript 版本 | JavaScript 版本 |
|------|----------------|----------------|
| **类型检查** | ✅ 完整类型支持 | ❌ 无类型检查 |
| **IDE 支持** | ✅ 智能提示 | ⚠️ 基础提示 |
| **调试体验** | ✅ 源码调试 | ⚠️ 编译后调试 |
| **文件大小** | 🔸 原始大小 | 🔸 编译后大小 |
| **运行时性能** | ✅ 最佳性能 | ✅ 相同性能 |
| **开发体验** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

### 🔧 开发环境配置

#### TypeScript 项目

```json
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

```typescript
// 直接导入，支持完整类型检查
import { createTable, findMany } from 'expo-lite-db-store';

const users = await findMany('users', {}, {
  sortBy: 'age', // ✅ 类型检查
  order: 'desc'  // ✅ 自动补全
});
```

#### JavaScript 项目

```json
// package.json
{
  "type": "commonjs", // 或 "module"
  "engines": {
    "node": ">=14.0.0"
  }
}
```

```javascript
// CommonJS
const { createTable, findMany } = require('expo-lite-db-store');

// ES6 Modules
import { findMany } from 'expo-lite-db-store';

const users = await findMany('users', {}, {
  sortBy: 'age', // ⚠️ 无类型检查
  order: 'desc'  // ⚠️ 无自动补全
});
```

### 📦 打包工具集成

#### Webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
    alias: {
      'expo-lite-db-store': 'expo-lite-db-store/dist/js'
    }
  }
};
```

#### Rollup

```javascript
// rollup.config.js
export default {
  external: ['expo-lite-db-store'],
  plugins: [
    // 其他插件
  ]
};
```

#### Metro (React Native)

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname, {
  resolver: {
    alias: {
      'expo-lite-db-store': 'expo-lite-db-store/dist/js'
    }
  }
});
```

---

## ⚙️ 配置和类型定义

### ReadOptions 接口

```typescript
interface ReadOptions {
  // 分页选项
  skip?: number;        // 跳过的记录数
  limit?: number;       // 返回的记录数上限

  // 过滤选项
  filter?: FilterCondition; // 查询条件

  // 排序选项
  sortBy?: string | string[];           // 排序字段
  order?: "asc" | "desc" | ("asc" | "desc")[]; // 排序方向
  sortAlgorithm?: "default" | "fast" | "counting" | "merge" | "slow"; // 排序算法
}
```

### FilterCondition 类型

```typescript
type FilterCondition =
  | ((item: Record<string, any>) => boolean)  // 函数条件
  | Partial<Record<string, any>>              // 简单对象条件
  | {                                          // 高级条件
      $or?: FilterCondition[];
      $and?: FilterCondition[];
      [key: string]: any;
    };
```

### WriteResult 接口

```typescript
interface WriteResult {
  written: number;      // 写入的字节数
  totalAfterWrite: number; // 写入后的总字节数
  chunked: boolean;     // 是否使用了分块写入
  chunks?: number;      // 分块数量（分块写入时）
}
```

---

## 📊 性能基准

### 排序算法性能对比

| 算法 | 小数据集 (<100) | 中等数据集 (100-10K) | 大数据集 (>10K) | 内存使用 | 稳定性 |
|------|----------------|---------------------|----------------|----------|--------|
| default | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 低 | 高 |
| fast | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 低 | 中 |
| merge | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中 | 高 |
| counting | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 高* | 高 |
| slow | ⭐⭐ | ⭐⭐ | ⭐⭐ | 低 | 高 |

*计数排序在值域有限时内存效率很高

### 推荐使用场景

- **实时搜索结果排序**: 使用 `fast` 算法
- **大数据分析**: 使用 `merge` 算法
- **状态/等级排序**: 使用 `counting` 算法
- **中文内容排序**: 使用 `slow` 算法
- **通用场景**: 不指定算法，自动选择

---

## 🔒 安全性和加密

### 数据加密

```typescript
// 注意：加密功能需要在项目初始化时启用
// 当前版本的加密功能正在开发中，敬请期待

// 未来版本的使用方式：
// import { enableEncryption, setEncryptionKey } from 'expo-lite-db-store';
//
// // 启用加密
// await enableEncryption();
//
// // 设置加密密钥（请妥善保管）
// await setEncryptionKey('your-secure-key-here');
//
// // 加密后的数据将自动处理，无需额外代码
```

### 安全最佳实践

1. **密钥管理**: 加密密钥请妥善保管，避免硬编码
2. **敏感数据**: 对包含敏感信息的数据启用加密
3. **备份安全**: 加密数据的备份也需要保护
4. **密钥轮换**: 定期更换加密密钥

---

## 🐛 故障排除

### 常见问题

#### Q: 排序后数据顺序不正确？
A: 检查排序字段是否存在 null/undefined 值，这些值会被排到末尾。

#### Q: 查询性能慢？
A: 尝试使用更适合的数据量的排序算法，或启用分页查询。

#### Q: 内存使用过高？
A: 对于超大数据集，考虑使用分页查询或 `fast` 排序算法。

#### Q: 中文排序不正确？
A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持。

#### Q: 如何在纯JavaScript项目中使用？
A: 导入时会自动使用JavaScript版本，无需特殊配置。

#### Q: TypeScript版本和JavaScript版本有什么区别？
A: TypeScript版本提供完整的类型检查和IDE支持；JavaScript版本轻量化但无类型检查。

#### Q: 如何构建自己的版本？
A: 运行 `npm run build:all` 来构建完整的TypeScript和JavaScript版本。

---

## 📞 支持与反馈

- 📧 **邮箱**: [项目维护者邮箱]
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **文档**: [完整文档](https://github.com/QinIndexCode/expo-liteDataStore/wiki)

## 许可证

MIT © QinIndex Qin

---

## 🙏 致谢

感谢所有为这个项目贡献代码和建议的开发者！

喜欢的话别忘了点个 ⭐ Star，让更多人发现这个项目！
