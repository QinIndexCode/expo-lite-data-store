# expo-lite-data-store

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81+-blue.svg)](https://reactnative.dev/)

**Ultra-lightweight, zero-configuration, pure TypeScript Expo local database**

Designed specifically for React Native + Expo projects, with no native dependencies. Provides complete CRUD operations, transaction support, index optimization, and intelligent sorting features.

## 📋 Project Structure

The project adopts a clear modular design, with consistent directory structure for both TypeScript and JavaScript versions:

- **Main entry file**: `src/expo-lite-data-store.ts` (recommended) or `src/index.ts` (backward compatibility alias)
- **Build output**: `dist/js/` directory contains the complete JavaScript compiled version
- **Type definitions**: `dist/types/` directory contains complete TypeScript type declaration files
- **Unified structure**: JS and TS versions have identical directory structures for easy maintenance and debugging

---

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

---

## 📦 Installation

```bash
npm install expo-lite-data-store
# or use yarn / pnpm
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

**Note**: The package name is `expo-lite-data-store` (note: `data-store` not `db-store`)

### 📦 Build Versions

The project provides both TypeScript and JavaScript versions:

```bash
# Build all versions
npm run build:all

# Build only JavaScript version
npm run build:js

# Build only TypeScript type definitions
npm run build:types
```

---

## 🚀 Quick Start

### TypeScript Version (Recommended)

```typescript
// Method 1: Default import (recommended, automatically selects best version)
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// Method 2: Use TypeScript source code (complete type support)
import { findMany } from 'expo-lite-data-store/ts';

// Method 3: Directly import main file (explicitly specified)
import { findMany } from 'expo-lite-data-store/ts/main';

// Create user table
await createTable('users', {
  columns: {
    id: 'number',
    name: 'string',
    age: 'number',
    email: 'string',
  },
});

// Insert data
await insert('users', [
  { id: 1, name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: 'Li Si', age: 30, email: 'lisi@example.com' },
  { id: 3, name: 'Wang Wu', age: 35, email: 'wangwu@example.com' },
]);

// Query data - supports sorting
const users = await findMany(
  'users',
  {},
  {
    sortBy: 'age',
    order: 'desc',
    limit: 10,
  }
);

console.log(users);
// Output: Wang Wu(35), Li Si(30), Zhang San(25)

// Conditional query
const activeUsers = await findMany('users', { age: { $gte: 30 } });
console.log(activeUsers); // Returns users with age >= 30
```

### JavaScript Version

```javascript
// CommonJS import (automatically uses compiled JS version)
const { createTable, insert, findMany } = require('expo-lite-data-store');

// ES6 import (automatically uses compiled JS version)
import { findMany } from 'expo-lite-data-store';

// Explicitly specify to use JavaScript compiled version
import { findMany } from 'expo-lite-data-store/js';

// Usage is identical to TypeScript version
await createTable('users');

await insert('users', [
  { id: 1, name: 'Alice', age: 25 },
  { id: 2, name: 'Bob', age: 30 },
]);

// Sorting query
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

### Version Selection

All versions are sourced from the dist directory, ensuring stability and consistency in production environments:

| Import Path                 | Type Support   | Use Case               | File Source                                  |
| --------------------------- | -------------- | ---------------------- | -------------------------------------------- |
| `'expo-lite-data-store'`    | ✅ Auto-select | Recommended (default)  | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/js'` | ✅ TypeScript  | JavaScript environment | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/ts'` | ✅ TypeScript  | TypeScript environment | `dist/js/index.js` + `dist/types/index.d.ts` |

```ts
import { createTable, insert, findOne, update, remove, findMany } from 'expo-lite-data-store';

// Create table
await createTable('users');

// Insert data
await insert('users', [
  { id: 1, name: 'Zhang San', age: 25, active: true },
  { id: 2, name: 'Li Si', age: 30, active: false },
  { id: 3, name: 'Wang Wu', age: 35, active: true },
]);

// Query single data
const user = await findOne('users', { id: 1 });
console.log(user); // { id: 1, name: 'Zhang San', age: 25, active: true }

// Update data
await update('users', { age: 26 }, { id: 1 });

// Query multiple data
const activeUsers = await findMany('users', { active: true });
console.log(activeUsers.length); // 2

// Delete data
await remove('users', { id: 2 });
```

---

## 📚 API Reference

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

### 🔧 Advanced Features

| Method              | Signature                          | Description                               |
| ------------------- | ---------------------------------- | ----------------------------------------- |
| `migrateToChunked`  | `(tableName) => Promise<void>`     | Migrate table to chunked storage mode     |
| `getSyncStats`      | `() => Promise<SyncStats>`         | Get synchronization statistics            |
| `syncNow`           | `() => Promise<void>`              | Trigger immediate data synchronization    |
| `setAutoSyncConfig` | `(config: AutoSyncConfig) => void` | Update auto-synchronization configuration |

---

## 🎯 Advanced Usage

### 🔄 Transaction Operations

Best practice for ensuring data consistency:

```typescript
import { beginTransaction, commit, rollback, insert, update } from 'expo-lite-data-store';

async function transferMoney(fromUserId: number, toUserId: number, amount: number) {
  try {
    // Start transaction
    await beginTransaction();

    // Check sender balance
    const sender = await findOne('users', { id: fromUserId });
    if (!sender || sender.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Execute transfer operation
    await update('users', { balance: sender.balance - amount }, { id: fromUserId });
    await update('users', { balance: { $inc: amount } }, { id: toUserId });

    // Record transfer log
    await insert('transactions', {
      id: Date.now(),
      fromUserId,
      toUserId,
      amount,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await commit();
    console.log('Transfer completed successfully');
  } catch (error) {
    // Rollback all operations on error
    await rollback();
    console.error('Transfer failed:', error);
    throw error;
  }
}
```

### 🔍 Advanced Queries

#### Conditional Query Operators

| Operator | Description           | Example                             |
| -------- | --------------------- | ----------------------------------- |
| `$eq`    | Equal                 | `{ age: { $eq: 25 } }`              |
| `$ne`    | Not equal             | `{ status: { $ne: 'inactive' } }`   |
| `$gt`    | Greater than          | `{ age: { $gt: 18 } }`              |
| `$gte`   | Greater than or equal | `{ score: { $gte: 60 } }`           |
| `$lt`    | Less than             | `{ price: { $lt: 100 } }`           |
| `$lte`   | Less than or equal    | `{ quantity: { $lte: 10 } }`        |
| `$in`    | In array              | `{ category: { $in: ['A', 'B'] } }` |
| `$nin`   | Not in array          | `{ status: { $nin: ['deleted'] } }` |
| `$like`  | Fuzzy match           | `{ name: { $like: 'Zhang%' } }`     |

#### Compound Queries

```typescript
import { findMany } from 'expo-lite-data-store';

// AND query
const activeAdults = await findMany('users', {
  $and: [{ age: { $gte: 18 } }, { active: true }, { role: { $in: ['user', 'admin'] } }],
});

// OR query
const featuredOrNew = await findMany('products', {
  $or: [{ featured: true }, { createdAt: { $gt: '2024-01-01' } }],
});

// Complex nested query
const complexQuery = await findMany('orders', {
  $and: [
    { status: 'completed' },
    {
      $or: [{ total: { $gt: 1000 } }, { priority: 'high' }],
    },
    { createdAt: { $gte: '2024-01-01' } },
  ],
});
```

### 🎯 Intelligent Sorting System

#### Basic Sorting

```typescript
// Single field sorting
const usersByAge = await findMany(
  'users',
  {},
  {
    sortBy: 'age',
    order: 'asc', // 'asc' | 'desc'
  }
);

// Multi-field sorting (stable sort)
const usersSorted = await findMany(
  'users',
  {},
  {
    sortBy: ['department', 'name', 'age'],
    order: ['asc', 'asc', 'desc'],
  }
);
```

#### Sorting Algorithm Selection

The system provides 5 professional sorting algorithms, automatically selecting the optimal one:

| Algorithm  | Use Case                                  | Performance Characteristics            |
| ---------- | ----------------------------------------- | -------------------------------------- |
| `default`  | Small datasets (< 100 items)              | Balanced performance and functionality |
| `fast`     | Large datasets, simple comparisons        | Fastest, but simplified functionality  |
| `merge`    | Large datasets, stable sorting            | Stable, suitable for large data        |
| `counting` | Limited value range (e.g., status, level) | O(n+k), space for time                 |
| `slow`     | Needs complete localeCompare              | Supports Chinese, special characters   |

```typescript
// Auto-select algorithm (recommended)
const users = await findMany('users', {}, { sortBy: 'score' });

// Manually specify algorithm
const users = await findMany(
  'users',
  {},
  {
    sortBy: 'name',
    sortAlgorithm: 'slow', // Supports Chinese sorting
  }
);

// Large data optimization
const largeDataset = await findMany(
  'logs',
  {},
  {
    sortBy: 'timestamp',
    sortAlgorithm: 'merge', // Suitable for large data
  }
);
```

#### Sorting + Filtering + Pagination

```typescript
// Complete query example
const paginatedResults = await findMany(
  'products',
  // Filter conditions
  {
    $and: [{ price: { $gte: 50, $lte: 500 } }, { category: { $in: ['electronics', 'books'] } }, { inStock: true }],
  },
  // Query options
  {
    sortBy: ['rating', 'price', 'name'],
    order: ['desc', 'asc', 'asc'],
    skip: 20, // Skip first 20 items
    limit: 10, // Return 10 items
  }
);
```

### ⏰ Auto-synchronization Mechanism

The auto-synchronization mechanism regularly synchronizes dirty data from cache to disk, ensuring data persistence. It synchronizes every 5 seconds by default.

#### Configure Auto-synchronization

```typescript
import { setAutoSyncConfig, getSyncStats, syncNow } from 'expo-lite-data-store';

// Get current synchronization statistics
const stats = await getSyncStats();
console.log('Sync stats:', stats);

// Trigger immediate synchronization
await syncNow();

// Customize auto-synchronization configuration
setAutoSyncConfig({
  enabled: true, // Enable auto-synchronization
  interval: 10000, // Sync every 10 seconds
  minItems: 5, // At least 5 dirty items to sync
  batchSize: 200, // Maximum 200 items per sync
});
```

#### Synchronization Configuration Parameters

| Parameter   | Type    | Default | Description                             |
| ----------- | ------- | ------- | --------------------------------------- |
| `enabled`   | boolean | `true`  | Whether to enable auto-synchronization  |
| `interval`  | number  | `5000`  | Synchronization interval (milliseconds) |
| `minItems`  | number  | `1`     | Minimum number of items to sync         |
| `batchSize` | number  | `100`   | Batch size limit                        |

#### Synchronization Statistics

| Field Name         | Type   | Description                                 |
| ------------------ | ------ | ------------------------------------------- |
| `syncCount`        | number | Total synchronization count                 |
| `totalItemsSynced` | number | Total number of synced items                |
| `lastSyncTime`     | number | Last synchronization time                   |
| `avgSyncTime`      | number | Average synchronization time (milliseconds) |

### 🔧 Performance Optimization Suggestions

#### Index Optimization

```typescript
// Create indexes for frequently queried fields
// Note: Index functionality in current version is under development
// Future version will support:
// await createIndex('users', 'email');
// await createIndex('products', ['category', 'price']);
```

#### Batch Operation Optimization

```typescript
// Use bulkWrite for batch operations, more efficient than multiple individual operations
await bulkWrite('products', [
  { type: 'insert', data: { id: 1, name: 'Product 1' } },
  { type: 'update', data: { price: 29.99 }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } },
]);
```

#### Pagination Query Optimization

```typescript
// For large datasets, use pagination to avoid loading too much data at once
const pageSize = 50;
let page = 0;

while (true) {
  const results = await findMany(
    'largeTable',
    {},
    {
      skip: page * pageSize,
      limit: pageSize,
      sortBy: 'id',
    }
  );

  if (results.length === 0) break;

  // Process current page data
  processPageData(results);

  page++;
}
```

---

## 🔄 TypeScript and JavaScript Dual Version Support

The project provides both TypeScript and JavaScript versions to meet the needs of different development environments.

### 📁 File Structure

```
expo-lite-data-store/
├── src/                              # TypeScript source directory
│   ├── index.ts                      # Main entry (backward compatibility alias)
│   ├── expo-lite-data-store.ts       # Main entry file (recommended)
│   ├── core/                         # Core functionality modules
│   │   ├── adapter/                  # Storage adapters
│   │   ├── api/                      # API routes and controllers
│   │   ├── cache/                    # Cache management
│   │   ├── data/                     # Data read/write layer
│   │   ├── file/                     # File operations
│   │   ├── index/                    # Index management
│   │   ├── meta/                     # Metadata management
│   │   ├── monitor/                  # Performance monitoring
│   │   ├── query/                    # Query engine
│   │   ├── service/                  # Business service layer
│   │   └── strategy/                 # Storage strategies
│   ├── types/                        # TypeScript type definitions
│   ├── utils/                        # Utility functions
│   ├── taskQueue/                    # Task queue
│   └── liteStore.config.js           # Configuration file
├── dist/                             # Compilation output directory
│   ├── js/                           # JavaScript compilation output
│   │   ├── index.js                  # JS main entry
│   │   ├── expo-lite-data-store.js   # JS main entry (corresponds to TS)
│   │   ├── core/                     # JS core modules (complete directory structure)
│   │   ├── types/                    # JS type definitions
│   │   ├── utils/                    # JS utility functions
│   │   ├── taskQueue/                # JS task queue
│   │   └── liteStore.config.js       # Configuration file copy
│   └── types/                        # TypeScript type definitions (.d.ts)
│       ├── index.d.ts                # Main entry type declaration
│       ├── expo-lite-data-store.d.ts # Main entry type declaration (corresponds to TS)
│       └── [complete type definition structure]      # Identical to src/ directory structure
├── coverage/                         # Test coverage reports
├── __mocks__/                        # Jest mock files
└── [configuration files]                         # package.json, tsconfig.json, etc.
```

### 📦 Import Path Explanation

All import paths point to the dist directory, ensuring production environment stability:

| Import Method           | Path                        | Description                         | Recommendation |
| ----------------------- | --------------------------- | ----------------------------------- | -------------- |
| **Default Import**      | `'expo-lite-data-store'`    | Automatically uses compiled version | ⭐⭐⭐⭐⭐     |
| **Explicit JS Version** | `'expo-lite-data-store/js'` | Uses compiled JS version            | ⭐⭐⭐⭐       |
| **Explicit TS Version** | `'expo-lite-data-store/ts'` | Uses compiled JS + type definitions | ⭐⭐⭐⭐       |

**Note**: All versions use the same compiled JavaScript code, differing only in import style, ensuring consistent runtime behavior.

### 🛠️ Version Differences

| Feature                    | All Versions                              |
| -------------------------- | ----------------------------------------- |
| **Type Checking**          | ✅ Complete type support (via dist/types) |
| **IDE Support**            | ✅ Intelligent hints (via dist/types)     |
| **Debugging Experience**   | ⚠️ Compiled debugging                     |
| **File Size**              | 🔸 Optimized compiled size                |
| **Runtime Performance**    | ✅ Best performance                       |
| **Development Experience** | ⭐⭐⭐⭐⭐                                |

### 🔧 Development Environment Configuration

#### TypeScript Project

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
// Direct import, supports complete type checking
import { createTable, findMany } from 'expo-lite-data-store';

const users = await findMany(
  'users',
  {},
  {
    sortBy: 'age', // ✅ Type checking
    order: 'desc', // ✅ Auto-completion
  }
);
```

#### JavaScript Project

```json
// package.json
{
  "type": "commonjs", // or "module"
  "engines": {
    "node": ">=14.0.0"
  }
}
```

```javascript
// CommonJS
const { createTable, findMany } = require('expo-lite-data-store');

// ES6 Modules
import { findMany } from 'expo-lite-data-store';

const users = await findMany(
  'users',
  {},
  {
    sortBy: 'age', // ⚠️ No type checking
    order: 'desc', // ⚠️ No auto-completion
  }
);
```

### 📦 Bundler Integration

#### Webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
    alias: {
      'expo-lite-data-store': 'expo-lite-data-store/dist/js',
    },
  },
};
```

#### Rollup

```javascript
// rollup.config.js
export default {
  external: ['expo-lite-data-store'],
  plugins: [
    // other plugins
  ],
};
```

#### Metro (React Native)

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname, {
  resolver: {
    alias: {
      'expo-lite-data-store': 'expo-lite-data-store/dist/js',
    },
  },
});
```

---

## ⚙️ Configuration and Type Definitions

### ReadOptions Interface

```typescript
interface ReadOptions {
  // Pagination options
  skip?: number; // Number of records to skip
  limit?: number; // Maximum number of records to return

  // Filter options
  filter?: FilterCondition; // Query conditions

  // Sorting options
  sortBy?: string | string[]; // Sort field
  order?: 'asc' | 'desc' | ('asc' | 'desc')[]; // Sort direction
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow'; // Sort algorithm
  bypassCache?: boolean; // Whether to bypass cache
}
```

### FilterCondition Type

```typescript
type FilterCondition =
  | ((item: Record<string, any>) => boolean) // Function condition
  | Partial<Record<string, any>> // Simple object condition
  | {
      // Advanced conditions
      $or?: FilterCondition[];
      $and?: FilterCondition[];
      [key: string]: any;
    };
```

### WriteResult Interface

```typescript
interface WriteResult {
  written: number; // Number of bytes written
  totalAfterWrite: number; // Total bytes after write
  chunked: boolean; // Whether chunked write was used
  chunks?: number; // Number of chunks (for chunked write)
}
```

---

## 📊 Performance Benchmarks

### Sorting Algorithm Performance Comparison

| Algorithm | Small Dataset (<100) | Medium Dataset (100-10K) | Large Dataset (>10K) | Memory Usage | Stability |
| --------- | -------------------- | ------------------------ | -------------------- | ------------ | --------- |
| default   | ⭐⭐⭐⭐⭐           | ⭐⭐⭐                   | ⭐⭐                 | Low          | High      |
| fast      | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐               | ⭐⭐⭐               | Low          | Medium    |
| merge     | ⭐⭐⭐⭐             | ⭐⭐⭐⭐⭐               | ⭐⭐⭐⭐⭐           | Medium       | High      |
| counting  | ⭐⭐⭐               | ⭐⭐⭐⭐⭐               | ⭐⭐⭐⭐⭐           | High\*       | High      |
| slow      | ⭐⭐                 | ⭐⭐                     | ⭐⭐                 | Low          | High      |

\* Counting sort has high memory efficiency when the value range is limited

### Recommended Use Cases

- **Real-time search result sorting**: Use `fast` algorithm
- **Big data analysis**: Use `merge` algorithm
- **Status/level sorting**: Use `counting` algorithm
- **Chinese content sorting**: Use `slow` algorithm
- **General scenarios**: Do not specify algorithm, auto-select

---

## 🔒 Security and Encryption

### Data Encryption

```typescript
// Note: Encryption functionality needs to be enabled during project initialization
// Current version's encryption functionality is under development, stay tuned

// Future version usage:
// import { enableEncryption, setEncryptionKey } from 'expo-lite-data-store';
//
// // Enable encryption
// await enableEncryption();
//
// // Set encryption key (please keep it secure)
// await setEncryptionKey('your-secure-key-here');
//
// // Encrypted data will be automatically handled, no additional code needed
```

### Security Best Practices

1. **Key Management**: Keep encryption keys secure, avoid hardcoding
2. **Sensitive Data**: Enable encryption for data containing sensitive information
3. **Backup Security**: Protect backups of encrypted data
4. **Key Rotation**: Regularly rotate encryption keys

---

## 🐛 Troubleshooting

### Common Issues

#### Q: Incorrect data order after sorting?

A: Check if the sorting field has null/undefined values, which will be sorted to the end.

#### Q: Slow query performance?

A: Try using a sorting algorithm more suitable for your data volume, or enable pagination.

#### Q: High memory usage?

A: For extremely large datasets, consider using pagination or the `fast` sorting algorithm.

#### Q: Incorrect Chinese sorting?

A: Use `sortAlgorithm: 'slow'` for complete Chinese support.

#### Q: How to use in pure JavaScript projects?

A: The JavaScript version will be automatically used during import, no special configuration required.

#### Q: What's the difference between TypeScript and JavaScript versions?

A: TypeScript version provides complete type checking and IDE support; JavaScript version is lightweight but has no type checking.

#### Q: How to build your own version?

A: Run `npm run build:all` to build complete TypeScript and JavaScript versions.

---

## 📞 Support and Feedback

- 📧 **Email**: [Project maintainer email]
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **Documentation**: [Complete Documentation](https://github.com/QinIndexCode/expo-liteDataStore/wiki)

## License

MIT © QinIndex Qin

---

## 🙏 Acknowledgments

Thanks to all developers who have contributed code and suggestions to this project!

If you like it, don't forget to give it a ⭐ Star to let more people discover this project!
