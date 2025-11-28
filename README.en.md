# expo-liteDataStore

[![npm version](https://img.shields.io/npm/v/expo-lite-db-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-db-store) [![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-liteDataStore)](https://github.com/QinIndexCode/expo-liteDataStore/blob/main/LICENSE)

Ultra-lightweight, zero-configuration, pure TypeScript Expo local database  
Designed for React Native + Expo projects, no native dependencies required.

Suitable for small to medium data persistence scenarios: user settings, form drafts, offline caching, lightweight content management, etc.

> Current version: 1.0.0 (stable, API is stable, welcome to try and provide feedback)

## Features

| Feature                | Description                                      |
|------------------------|--------------------------------------------------|
| Zero dependencies      | Only depends on React Native FS, no Metro config needed |
| Encryption support     | Optional AES-GCM encryption, you fully control the key |
| Chunked storage        | Automatic chunking for files larger than 5MB, perfectly avoiding RN FS limitations |
| Batch operations & transactions | Complete transaction support, ensuring data consistency |
| Perfect TypeScript support | Full type definitions, ready to use out of the box |
| Complex query support  | Support for where, skip, limit and other query conditions |
| Fully offline available | No network required, data 100% stored locally on the device |

## Installation

```bash
npm install expo-lite-db-store
# or use yarn / pnpm
yarn add expo-lite-db-store
pnpm add expo-lite-db-store
```

## Quick Start

```ts
import { 
  createTable, 
  insert, 
  findOne, 
  update, 
  remove, 
  findMany 
} from 'expo-lite-db-store';

// Create table
await createTable('users');

// Insert data
await insert('users', [
  { id: 1, name: 'John Doe', age: 25, active: true },
  { id: 2, name: 'Jane Smith', age: 30, active: false },
  { id: 3, name: 'Bob Johnson', age: 35, active: true }
]);

// Query single record
const user = await findOne('users', { id: 1 });
console.log(user); // { id: 1, name: 'John Doe', age: 25, active: true }

// Update data
await update('users', { age: 26 }, { id: 1 });

// Query multiple records
const activeUsers = await findMany('users', { active: true });
console.log(activeUsers.length); // 2

// Delete data
await remove('users', { id: 2 });
```

## API Overview

### Table Management

| Method                     | Description                              | Return Value         |
|----------------------------|------------------------------------------|----------------------|
| `createTable(tableName, options)` | Create table | Promise<void>  |
| `deleteTable(tableName)` | Delete table | Promise<void>  |
| `hasTable(tableName)` | Check if table exists | Promise<boolean> |
| `listTables()` | List all tables | Promise<string[]> |
| `countTable(tableName)` | Get table record count | Promise<number> |
| `clearTable(tableName)` | Clear table data | Promise<void> |

### Data Operations

| Method                     | Description                              | Return Value         |
|----------------------------|------------------------------------------|----------------------|
| `insert(tableName, data)` | Insert data | Promise<WriteResult>  |
| `read(tableName, options)` | Read data | Promise<Record<string, any>[]> |
| `findOne(tableName, filter)` | Query single record | Promise<Record<string, any> \| null> |
| `findMany(tableName, filter, options)` | Query multiple records | Promise<Record<string, any>[]> |
| `update(tableName, data, where)` | Update data | Promise<number> |
| `remove(tableName, where)` | Delete data | Promise<number> |
| `bulkWrite(tableName, operations)` | Batch operations | Promise<WriteResult> |

### Transaction Management

| Method                     | Description                              | Return Value         |
|----------------------------|------------------------------------------|----------------------|
| `beginTransaction()` | Start transaction | Promise<void>  |
| `commit()` | Commit transaction | Promise<void>  |
| `rollback()` | Rollback transaction | Promise<void>  |

### Schema Migration

| Method                     | Description                              | Return Value         |
|----------------------------|------------------------------------------|----------------------|
| `migrateToChunked(tableName)` | Migrate to chunked mode | Promise<void>  |

## Advanced Usage

### Transaction Operations

```ts
import { beginTransaction, commit, rollback, insert, update } from 'expo-lite-db-store';

try {
  // Start transaction
  await beginTransaction();
  
  // Execute multiple operations
  await insert('orders', { id: 1, amount: 100 });
  await update('users', { balance: 900 }, { id: 1 });
  
  // Commit transaction
  await commit();
} catch (error) {
  // Rollback on error
  await rollback();
  console.error('Transaction failed:', error);
}
```

### Complex Queries

```ts
import { findMany } from 'expo-lite-db-store';

// Query users older than 30 and active, skip first 1, limit to 10
const users = await findMany('users', 
  { age: { $gt: 30 }, active: true },
  { skip: 1, limit: 10 }
);
```

## License

MIT © QinIndex Qin

---

Don't forget to give a Star ✨ if you like it  
Found a bug or have a new feature request? Welcome to submit an Issue / PR～