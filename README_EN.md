# expo-lite-data-store

---

**notice** :current project test coverage is limited, and may contain undiscovered issues. Before using in production environment, please conduct thorough testing.

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81+-blue.svg)](https://reactnative.dev/)

**Lightweight, easy-configuration, pure TypeScript Expo local database**

Designed specifically for React Native + Expo projects, with no native dependencies. Provides complete CRUD operations, transaction support, index optimization, and intelligent sorting features.

## ✨ Core Features

| Feature                          | Description                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 🚀 **Easy configuration**        | Only depends on React Native FS, no Metro configuration                         |
| 🔒 **Optional encryption**       | AES-CTR encryption, keys automatically generated and managed by the system      |
| 📦 **Intelligent chunking**      | Automatically handles >5MB files, avoiding RN FS limits                         |
| 🔄 **Transaction support**       | Transaction support, data consistency ensured                                   |
| 📝 **TypeScript native support** | Complete type definitions, ready to use                                         |
| 🔍 **Advanced queries**          | Supports advanced queries like where, skip, limit, sort                         |
| 📱 **Fully offline**             | No network required, 100% local data storage                                    |
| 🎯 **Intelligent sorting**       | 5 sorting algorithms, automatically selects appropriate algorithm based on data size |
| ⏰ **Auto-synchronization**      | Regularly synchronizes dirty data from cache to disk, ensuring data persistence |

## 📦 Installation

```bash
npm install expo-lite-data-store
# or use yarn / pnpm (At present, only npm has been uploaded, and yarn and pnpm will be followed in the future.)
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

## 🚀 Quick Start

```typescript
// ES module import
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// CommonJS import
// const { createTable, insert, findOne, findMany, update, remove } = require('expo-lite-data-store');

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

```javascript
// JavaScript usage is the same
const { createTable, insert, findMany } = require('expo-lite-data-store');

// Or use ES module import
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

For complete detailed documentation, please check the local [WIKI_EN.md](WIKI_EN.md) file, including:

- 🎯 **Advanced Queries**: Complex conditional queries, operators, compound queries
- 🎯 **Smart Sorting**: Multi-field sorting, algorithm selection, performance optimization
- 🎯 **Transaction Management**: ACID transactions, best practices
- 🎯 **Auto-synchronization**: Configuration, statistics, manual triggering
- 🎯 **Performance Optimization**: Indexes, batch operations, pagination strategies
- 🎯 **Security**: Data encryption, key management
- 🎯 **Troubleshooting**: Common issues, debugging tips

## 🔧 Configuration

### Configuration Modification Method

To modify the configuration, please find the `node_modules/expo-lite-data-store/dist/js/liteStore.config.js` file and make changes to it.

### Configuration Options

The configuration file contains the following main options:

```typescript
// liteStore.config.js
module.exports = {
  // Basic configuration
  chunkSize: 5 * 1024 * 1024, // File chunk size (5MB)
  storageFolder: 'expo-litedatastore', // Storage folder name
  sortMethods: 'default', // Default sorting algorithm
  timeout: 30000, // Operation timeout (30 seconds)
  
  // Encryption configuration
  encryption: {
    algorithm: 'AES-CTR', // Encryption algorithm
    keySize: 256, // Key size
    hmacAlgorithm: 'SHA-256', // HMAC algorithm
    keyIterations: 100000, // Key iteration count
    enableFieldLevelEncryption: false, // Enable field-level encryption
    encryptedFields: [], // Fields to encrypt
    cacheTimeout: 300000, // Cache timeout (5 minutes)
    maxCacheSize: 50, // Maximum number of cached tables
    useBulkOperations: true, // Enable bulk operations
  },
  
  // Performance configuration
  performance: {
    enableQueryOptimization: true, // Enable query optimization
    maxConcurrentOperations: 5, // Maximum concurrent operations
    enableBatchOptimization: true, // Enable batch operation optimization
    memoryWarningThreshold: 0.8, // Memory warning threshold (80%)
  },
  
  // Cache configuration
  cache: {
    maxSize: 1000, // Maximum cache size
    defaultExpiry: 3600000, // Default expiry time (1 hour)
    enableCompression: false, // Enable compression
    cleanupInterval: 300000, // Cleanup interval (5 minutes)
    memoryWarningThreshold: 0.8, // Memory warning threshold (80%)
    autoSync: {
      enabled: true, // Enable auto-sync
      interval: 5000, // Sync interval (5 seconds)
      minItems: 1, // Minimum items for sync
      batchSize: 100, // Batch size limit
    },
  },
  
  // Monitoring configuration
  monitoring: {
    enablePerformanceTracking: true, // Enable performance tracking
    enableHealthChecks: true, // Enable health checks
    metricsRetention: 86400000, // Metrics retention (24 hours)
  },
};
```

## 🐛 Common Issues

### Q: How to switch between different versions?

A: The library automatically provides TypeScript support through type definition files. You can use the same import path for both JavaScript and TypeScript projects:

- `import { ... } from 'expo-lite-data-store'` - Recommended use
- `import { ... } from 'expo-lite-data-store/js'` - Explicit JavaScript version (same as default)

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
