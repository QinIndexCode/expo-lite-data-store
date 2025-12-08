# expo-lite-data-store

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81+-blue.svg)](https://reactnative.dev/)

**Ultra-lightweight, zero-configuration, pure TypeScript Expo local database**

Designed specifically for React Native + Expo projects, with no native dependencies. Provides complete CRUD operations, transaction support, index optimization, and intelligent sorting features.

## ✨ Core Features

| Feature                          | Description                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 🚀 **Zero configuration**        | Only depends on React Native FS, no Metro configuration                         |
| 🔒 **Optional encryption**       | AES-GCM encryption, keys fully under your control                               |
| 📦 **Intelligent chunking**      | Automatically handles >5MB files, perfectly avoiding RN FS limits               |
| 🔄 **Complete transactions**     | ACID transaction guarantees, data consistency ensured                           |
| 📝 **TypeScript native support** | Complete type definitions, ready to use                                         |
| 🔍 **Complex queries**           | Supports advanced queries like where, skip, limit, sort                         |
| 📱 **Fully offline**             | No network required, 100% local data storage                                    |
| 🎯 **Intelligent sorting**       | 5 sorting algorithms, automatically selects optimal performance                 |
| ⏰ **Auto-synchronization**      | Regularly synchronizes dirty data from cache to disk, ensuring data persistence |

## 📦 Installation

```bash
npm install expo-lite-data-store
# or use yarn / pnpm (At present, only npm has been uploaded, and yarn and pnpm will be followed in the future.)
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

**Note**: The package name is `expo-lite-data-store` (note: `data-store` not `db-store`)

## 🚀 Quick Start

### TypeScript Version (Recommended)

```typescript
// Method 1: Default import (recommended, automatically selects best version)
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// Create user table
await createTable('users');

// Insert data
await insert('users', [
  { id: 1, name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: 'Li Si', age: 30, email: 'lisi@example.com' },
  { id: 3, name: 'Wang Wu', age: 35, email: 'wangwu@example.com' },
]);

// Query single data
const user = await findOne('users', { id: 1 });
console.log(user); // { id: 1, name: 'Zhang San', age: 25, email: 'zhangsan@example.com' }

// Query multiple data
const users = await findMany('users', { age: { $gte: 30 } });
console.log(users); // Returns users with age >= 30

// Update data
await update('users', { age: 26 }, { id: 1 });

// Delete data
await remove('users', { id: 2 });
```

### JavaScript Version

```javascript
// CommonJS import
const { createTable, insert, findMany } = require('expo-lite-data-store');

// ES6 import
import { createTable, insert, findMany } from 'expo-lite-data-store';

// Usage is identical to TypeScript version
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

## 📚 Basic API Reference

### 🗂️ Table Management

| Method        | Signature                                | Description            |
| ------------- | ---------------------------------------- | ---------------------- |
| `createTable` | `(tableName, options?) => Promise<void>` | Create new table       |
| `deleteTable` | `(tableName) => Promise<void>`           | Delete table           |
| `hasTable`    | `(tableName) => Promise<boolean>`        | Check if table exists  |
| `listTables`  | `() => Promise<string[]>`                | Get all table names    |
| `countTable`  | `(tableName) => Promise<number>`         | Get table record count |
| `clearTable`  | `(tableName) => Promise<void>`           | Clear table data       |

### 💾 Data Operations

| Method      | Signature                                          | Description                                         |
| ----------- | -------------------------------------------------- | --------------------------------------------------- | ------------------- |
| `insert`    | `(tableName, data) => Promise<WriteResult>`        | Insert single or multiple records                   |
| `read`      | `(tableName, options?) => Promise<any[]>`          | Read data (supports filtering, pagination, sorting) |
| `findOne`   | `(tableName, filter) => Promise<any                | null>`                                              | Query single record |
| `findMany`  | `(tableName, filter?, options?) => Promise<any[]>` | Query multiple records (supports advanced options)  |
| `update`    | `(tableName, data, where) => Promise<number>`      | Update matching records                             |
| `remove`    | `(tableName, where) => Promise<number>`            | Delete matching records                             |
| `bulkWrite` | `(tableName, operations) => Promise<WriteResult>`  | Batch operations                                    |

### 🔄 Transaction Management

| Method             | Signature             | Description                  |
| ------------------ | --------------------- | ---------------------------- |
| `beginTransaction` | `() => Promise<void>` | Start new transaction        |
| `commit`           | `() => Promise<void>` | Commit current transaction   |
| `rollback`         | `() => Promise<void>` | Rollback current transaction |

## 📖 Detailed Documentation

For complete detailed documentation, please check the [WIKI page](https://github.com/QinIndexCode/expo-lite-data-store/wiki), including:

- 🎯 **Advanced Queries**: Complex conditional queries, operators, compound queries
- 🎯 **Smart Sorting**: Multi-field sorting, algorithm selection, performance optimization
- 🎯 **Transaction Management**: ACID transactions, best practices
- 🎯 **Auto-synchronization**: Configuration, statistics, manual triggering
- 🎯 **Performance Optimization**: Indexes, batch operations, pagination strategies
- 🎯 **Security**: Data encryption, key management
- 🎯 **Troubleshooting**: Common issues, debugging tips

## 🔧 Configuration

```typescript
// liteStore.config.js
module.exports = {
  // Encryption configuration
  encryption: {
    cacheTimeout: 30000, // Cache timeout (milliseconds)
    maxCacheSize: 100, // Maximum number of cached tables
    // Other encryption configurations...
  },
  // Performance configuration
  performance: {
    enableQueryOptimization: true, // Enable query optimization
    enableBatchOptimization: true, // Enable batch operation optimization
    // Other performance configurations...
  },
  // Other configurations...
};
```

## 🐛 Common Issues

### Q: How to switch between different versions?

A: All versions are sourced from the dist directory, ensuring stability in production environments:

- `import { ... } from 'expo-lite-data-store'` - Recommended use (auto-select)
- `import { ... } from 'expo-lite-data-store/js'` - JavaScript environment
- `import { ... } from 'expo-lite-data-store/ts'` - TypeScript environment

### Q: How to handle Chinese sorting?

A: Use `sortAlgorithm: 'slow'` for complete Chinese support:

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

### Q: How to improve query performance?

A: For large datasets, it is recommended to use:

- Pagination querying
- Appropriate sorting algorithm
- Batch operations

## 📞 Support and Feedback

- 📧 **Email**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **Documentation**: [README](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.md)

## License

MIT © QinIndex Qin

---

If you like it, don't forget to give it a ⭐ Star to let more people discover this project!
