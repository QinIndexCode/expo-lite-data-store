# expo-lite-data-store

English: [English Document](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.en.md)
中文版: [中文文档](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.zh-CN.md)

---

**注意** 当前项目测试覆盖范围有限，可能存在未发现的问题。在生产环境中使用前，请务必进行充分测试。

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.72+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

**轻量、易配置、纯 TypeScript 编写的 Expo 本地数据库**

专为 React Native + Expo 项目设计，无需任何 native 依赖。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

## ✨ 核心特性

| 特性                       | 描述                                           |
| -------------------------- | ---------------------------------------------- |
| 🚀 **易配置使用**          | 仅依赖 React Native FS，无需 Metro 配置        |
| 🔒 **可选加密**            | AES-CTR 加密，支持可选生物识别认证，密钥由系统自动生成和管理，默认 50,000 次 PBKDF2 迭代（移动设备优化）         |
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

该库支持多种加密模式，包括非加密模式和加密模式。

### 基本使用示例

```typescript
// 非加密模式（默认）
await createTable('users');

// 加密模式
await createTable('users', {
  encrypted: true
});
```

**详细加密说明**：请查看 [WIKI.md](./WIKI.md) 中的加密部分，了解完整的加密配置和最佳实践。

## 📚 基础 API 参考

### API 分类

该库提供完整的 CRUD 操作、事务支持和高级查询功能，API 分为以下几类：

- **表管理**：`createTable`、`deleteTable`、`hasTable`、`listTables`、`countTable`、`clearTable`
- **数据操作**：`insert`、`write`、`read`、`findOne`、`findMany`、`update`、`remove`、`bulkWrite`
- **事务管理**：`beginTransaction`、`commit`、`rollback`

**详细 API 文档**：请查看 [WIKI.md](./WIKI.md) 中的 API 参考部分，了解完整的 API 签名和参数说明。

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

### 配置方式

该库通过 app.json 文件的 `expo.extra.liteStore` 部分进行配置（推荐）：

```json
{
  "expo": {
    "extra": {
      "liteStore": {
        "autoSync": {
          "enabled": true,
          "interval": 60000
        },
        "chunkSize": 10485760
      }
    }
  }
}
```

### 配置推荐

- **加密模式**：除非有特殊要求，否则推荐使用字段级加密
- **性能配置**：根据设备性能调整 `maxConcurrentOperations`（推荐范围：3-10）
- **监控配置**：推荐启用 `enableHealthChecks` 以提高性能和稳定性

**详细配置说明**：请查看 [WIKI.md](./WIKI.md) 中的配置部分，了解完整的配置选项和最佳实践。

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

### Q: 加密写入和读取速度较慢，如何优化？

A: 加密操作确实会增加一定的性能开销，以下是一些优化建议：

1. **使用字段级加密而非整表加密**：只加密敏感字段，而不是整个表，这样可以提高查询性能
2. **增加密钥缓存时间**：在配置中增加 `encryption.cacheTimeout` 的值，减少密钥派生的次数
3. **启用批量操作**：确保 `encryption.useBulkOperations` 为 `true`，可以减少加密/解密的次数
4. **减少密钥迭代次数**：适当降低 `encryption.keyIterations` 的值（不低于100000），可以加快密钥派生速度
5. **合理设置 `maxConcurrentOperations`**：根据设备性能调整并发操作数，推荐范围：3-10

## 📞 支持与反馈

- 📧 **邮箱**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **文档**: [完整文档](https://github.com/QinIndexCode/expo-liteDataStore/wiki)

## 许可证

MIT © QinIndexCode

---

喜欢的话别忘了点个 ⭐ Star，让更多人发现这个项目！