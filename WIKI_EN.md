# expo-lite-data-store Detailed Documentation

## 🎯 Complete Configuration Guide

### Configuration Overview

LiteStore provides rich configuration options that allow you to adjust performance, security, and behavior according to your project needs.

**Important Note**: Configuration is loaded directly from the bundled file. To modify configuration, you need to edit the file at:

```
node_modules/expo-lite-data-store/dist/js/liteStore.config.js
```

**No Runtime Configuration API**: The library does not provide runtime configuration APIs. All configuration changes must be made by editing the bundled configuration file directly. This approach ensures consistent configuration loading across different environments and prevents issues with asynchronous loading.

### Basic Configuration

| Configuration Item | Type     | Default Value           | Description                                                                                |
| ------------------ | -------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `chunkSize`        | `number` | `5 * 1024 * 1024` (5MB) | Data file chunk size, files exceeding this size will be automatically chunked              |
| `storageFolder`    | `string` | `'expo-litedatastore'`  | Data storage directory name                                                                |
| `sortMethods`      | `string` | `'default'`             | Default sorting algorithm, optional values: `default`, `fast`, `counting`, `merge`, `slow` |
| `timeout`          | `number` | `10000` (10 seconds)    | Operation timeout duration                                                                 |

### Encryption Configuration

| Configuration Item           | Type       | Default Value               | Description                                                                                   |
| ---------------------------- | ---------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `algorithm`                  | `string`   | `'AES-CTR'`                 | Encryption algorithm, supports `AES-CTR`                                                      |
| `keySize`                    | `number`   | `256`                       | Encryption key length, supports `128`, `192`, `256`                                           |
| `hmacAlgorithm`              | `string`   | `'SHA-512'`                 | HMAC integrity protection algorithm                                                           |
| `keyIterations`              | `number`   | `120000`                    | Key derivation iteration count, higher values provide stronger security but lower performance |
| `enableFieldLevelEncryption` | `boolean`  | `false`                     | Whether to enable field-level encryption                                                      |
| `encryptedFields`            | `string[]` | Common sensitive field list | List of fields to be encrypted by default                                                     |
| `cacheTimeout`               | `number`   | `30000` (30 seconds)        | Cache timeout for masterKey in memory                                                         |
| `maxCacheSize`               | `number`   | `50`                        | Maximum number of derived keys to retain in LRU cache                                         |
| `useBulkOperations`          | `boolean`  | `true`                      | Whether to enable bulk operation optimization                                                 |

**Important Notes**: 
- Full table encryption and field-level encryption **cannot be used simultaneously**. The system will automatically detect conflicts and throw a clear error message.
- Full table encryption mode is enabled through the `encryptFullTable` parameter when calling the API.
- Field-level encryption is enabled through the `enableFieldLevelEncryption` and `encryptedFields` configuration in the configuration file.
- In non-encrypted mode, data is stored in plain text, no encryption algorithm is used, and no biometric or password authentication is triggered.

### Performance Configuration

| Configuration Item        | Type      | Default Value | Description                                             |
| ------------------------- | --------- | ------------- | ------------------------------------------------------- |
| `enableQueryOptimization` | `boolean` | `true`        | Whether to enable query optimization (indexing)         |
| `maxConcurrentOperations` | `number`  | `5`           | Maximum number of concurrent operations                 |
| `enableBatchOptimization` | `boolean` | `true`        | Whether to enable batch operation optimization          |
| `memoryWarningThreshold`  | `number`  | `0.8`         | Memory usage threshold to trigger warning (between 0-1) |

### Cache Configuration

| Configuration Item       | Type      | Default Value        | Description                                     |
| ------------------------ | --------- | -------------------- | ----------------------------------------------- |
| `maxSize`                | `number`  | `1000`               | Maximum number of cache entries                 |
| `defaultExpiry`          | `number`  | `3600000` (1 hour)   | Default cache expiration time                   |
| `enableCompression`      | `boolean` | `false`              | Whether to enable cache data compression        |
| `cleanupInterval`        | `number`  | `300000` (5 minutes) | Cache cleanup interval                          |
| `memoryWarningThreshold` | `number`  | `0.8`                | Cache memory usage threshold to trigger warning |
| `autoSync.enabled`       | `boolean` | `true`               | Whether to enable auto-sync                     |
| `autoSync.interval`      | `number`  | `5000` (5 seconds)   | Auto-sync interval                              |
| `autoSync.minItems`      | `number`  | `1`                  | Minimum number of dirty items to trigger sync   |
| `autoSync.batchSize`     | `number`  | `100`                | Maximum number of items to sync per batch       |



### Monitoring Configuration

| Configuration Item          | Type      | Default Value         | Description                            |
| --------------------------- | --------- | --------------------- | -------------------------------------- |
| `enablePerformanceTracking` | `boolean` | `true`                | Whether to enable performance tracking |
| `enableHealthChecks`        | `boolean` | `true`                | Whether to enable health checks        |
| `metricsRetention`          | `number`  | `86400000` (24 hours) | Performance metrics retention duration |

### Configuration Best Practices

To modify configuration, you need to edit the bundled configuration file directly:

```
node_modules/expo-lite-data-store/dist/js/liteStore.config.js
```

1. **Performance Optimization**:

   ```javascript
   // liteStore.config.js
   module.exports = {
     performance: {
       enableQueryOptimization: true,
       maxConcurrentOperations: 8, // Adjust based on device performance
       enableBatchOptimization: true,
     },
   };
   ```

2. **Security Enhancement**:

   ```javascript
   // liteStore.config.js
   module.exports = {
     encryption: {
       keyIterations: 200000, // Increase key derivation iterations
       cacheTimeout: 15000, // Reduce key cache time
       enableFieldLevelEncryption: true,
     },
   };
   ```

3. **Memory Optimization**:
   ```javascript
   // liteStore.config.js
   module.exports = {
     cache: {
       maxSize: 500, // Reduce cache size
       enableCompression: true, // Enable cache compression
       memoryWarningThreshold: 0.7, // Lower memory warning threshold
     },
   };
   ```

## 🎯 API Reference

### Core API List

| Category       | API Name           | Description                                       |
| -------------- | ------------------ | ------------------------------------------------- |
| **Table Mgmt** | `createTable`      | Create a new table                                |
|                | `deleteTable`      | Delete table                                      |
|                | `hasTable`         | Check if table exists                              |
|                | `listTables`       | Get all table names                                |
|                | `countTable`       | Get table record count                             |
|                | `clearTable`       | Clear table data                                   |
| **Data Ops**   | `insert`           | Insert single or multiple records                  |
|                | `read`             | Read data (supports filtering, pagination, sorting) |
|                | `findOne`          | Query single record                                |
|                | `findMany`         | Query multiple records (supports advanced options) |
|                | `update`           | Update matching records                            |
|                | `remove`           | Delete matching records                            |
|                | `bulkWrite`        | Batch operations                                   |
| **Transactions**| `beginTransaction` | Start new transaction                              |
|                | `commit`           | Commit current transaction                         |
|                | `rollback`         | Rollback current transaction                       |
| **Sync Mgmt**  | `getSyncStats`     | Get sync statistics                                |
|                | `syncNow`          | Trigger sync immediately                           |
|                | `setAutoSyncConfig`| Customize auto-sync configuration                  |
| **Cache Mgmt** | `clearKeyCache`    | Clear key cache                                    |

### Detailed API Documentation

#### Table Management APIs

##### createTable

**Functionality**: Create a new data table

**Signature**:
```typescript
createTable(tableName: string, options?: CreateTableOptions): Promise<void>
```

**Parameters**:
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)
- `tableName`: Table name, must be unique
- `options`: Optional configuration
  - `columns`: Column definitions (optional)
  - `initialData`: Initial data (optional)
  - `mode`: Storage mode, `'single'` or `'chunked'` (optional)

**Examples**:
```typescript
// Create basic table
await createTable('users');

// Create table with initial data
await createTable('users', {
  initialData: [
    { id: 1, name: 'John Doe', age: 25 },
    { id: 2, name: 'Jane Smith', age: 30 }
  ]
});

// Create chunked storage table
await createTable('large_data', {
  mode: 'chunked'
});
```

##### deleteTable

**Functionality**: Delete a specified data table

**Signature**:
```typescript
deleteTable(tableName: string, options?: TableOptions): Promise<void>
```

**Parameters**:
- `tableName`: Table name
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional) to delete
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Example**:
```typescript
await deleteTable('users');
```

##### hasTable

**Functionality**: Check if a specified data table exists

**Signature**:
```typescript
hasTable(tableName: string, options?: TableOptions): Promise<boolean>
```

**Parameters**:
- `tableName`: Table name to check
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `boolean`: Whether the table exists

**Example**:
```typescript
const exists = await hasTable('users');
console.log(`Table users exists: ${exists}`);
```

##### listTables

**Functionality**: Get all data table names

**Signature**:
```typescript
listTables(options?: TableOptions): Promise<string[]>
```

**Returns**:
- `string[]`: Array of all table names

**Example**:
```typescript
const tables = await listTables();
console.log('All tables:', tables);
```

##### countTable

**Functionality**: Get record count for a specified table

**Signature**:
```typescript
countTable(tableName: string, options?: TableOptions): Promise<number>
```

**Parameters**:
- `tableName`: Table name

**Returns**:
- `number`: Number of records in the table

**Example**:
```typescript
const count = await countTable('users');
console.log(`Table users has ${count} records`);
```

##### clearTable

**Functionality**: Clear all data from a specified table

**Signature**:
```typescript
clearTable(tableName: string, options?: TableOptions): Promise<void>
```

**Parameters**:
- `tableName`: Table name to clear
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Example**:
```typescript
await clearTable('users');
```

#### Data Operation APIs

##### insert

**Functionality**: Insert single or multiple records into a specified table

**Signature**:
```typescript
insert(tableName: string, data: Record<string, any> | Record<string, any>[], options?: WriteOptions): Promise<WriteResult>
```

**Parameters**:
- `tableName`: Table name
- `data`: Data to insert, can be single record or array of records
- `options`: Optional configuration
  - `mode`: Write mode, `'append'` or `'overwrite'` (optional)
  - `forceChunked`: Whether to force chunked writing (optional)
  - `encryptFullTable`: Whether to enable full table encryption (optional)
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `WriteResult`: Write result, including bytes written, total bytes, etc.

**Examples**:
```typescript
// Insert single record
await insert('users', { id: 1, name: 'John Doe', age: 25 });

// Insert multiple records
await insert('users', [
  { id: 2, name: 'Jane Smith', age: 30 },
  { id: 3, name: 'Bob Johnson', age: 35 }
]);
```

##### read

**Functionality**: Read data from a specified table, supporting filtering, pagination and sorting

**Signature**:
```typescript
read(tableName: string, options?: ReadOptions): Promise<Record<string, any>[]>
```

**Parameters**:
- `tableName`: Table name
- `options`: Read options
  - `filter`: Query condition
  - `skip`: Number of records to skip
  - `limit`: Maximum number of records to return
  - `sortBy`: Sort field
  - `order`: Sort direction, `'asc'` or `'desc'`
  - `sortAlgorithm`: Sorting algorithm
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `Record<string, any>[]`: Array of matching records

**Examples**:
```typescript
// Read all data
const allUsers = await read('users');

// Read with filter
const activeUsers = await read('users', {
  filter: { status: 'active' }
});

// Read with pagination and sorting
const paginatedUsers = await read('users', {
  skip: 10,
  limit: 20,
  sortBy: 'age',
  order: 'desc'
});
```

##### findOne

**Functionality**: Query single record from a specified table

**Signature**:
```typescript
findOne(tableName: string, filter: FilterCondition, options?: TableOptions): Promise<Record<string, any> | null>
```

**Parameters**:
- `tableName`: Table name
- `filter`: Query condition
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `Record<string, any> | null`: Matching record, or `null` if no match

**Examples**:
```typescript
// Query by ID
const user = await findOne('users', { id: 1 });

// Query by condition
const activeUser = await findOne('users', {
  $and: [{ status: 'active' }, { age: { $gte: 18 } }]
});

// Query with encryption options
const encryptedUser = await findOne('sensitive_data', { id: 1 }, {
  encrypted: true,
  requireAuthOnAccess: false
});
```

##### findMany

**Functionality**: Query multiple records from a specified table, supporting advanced query options

**Signature**:
```typescript
findMany(tableName: string, filter?: FilterCondition, options?: FindOptions): Promise<Record<string, any>[]>
```

**Parameters**:
- `tableName`: Table name
- `filter`: Query condition
- `options`: Query options
  - `skip`: Number of records to skip
  - `limit`: Maximum number of records to return
  - `sortBy`: Sort field or array of fields
  - `order`: Sort direction or array of directions
  - `sortAlgorithm`: Sorting algorithm
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `Record<string, any>[]`: Array of matching records

**Examples**:
```typescript
// Basic query
const users = await findMany('users', { age: { $gte: 18 } });

// Multi-field sorting
const sortedUsers = await findMany('users', {}, {
  sortBy: ['department', 'name', 'age'],
  order: ['asc', 'asc', 'desc']
});

// Using specific sorting algorithm
const chineseSortedUsers = await findMany('users', {}, {
  sortBy: 'name',
  sortAlgorithm: 'slow' // Supports Chinese sorting
});

// Query with encryption options
const encryptedUsers = await findMany('sensitive_data', { status: 'active' }, {
  encrypted: true,
  requireAuthOnAccess: false,
  sortBy: 'created_at',
  order: 'desc'
});
```

##### update

**Functionality**: Update matching records in a specified table

**Signature**:
```typescript
update(tableName: string, data: Record<string, any>, where: FilterCondition, options?: TableOptions): Promise<number>
```

**Parameters**:
- `tableName`: Table name
- `data`: Data to update
- `where`: Update condition
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `number`: Number of updated records

**Examples**:
```typescript
// Update single record
const updatedCount = await update('users', { age: 26 }, { id: 1 });

// Update multiple records
const updatedCount = await update('users', { status: 'inactive' }, {
  lastLogin: { $lt: '2024-01-01' }
});

// Update with operator
const updatedCount = await update('users', { balance: { $inc: 100 } }, { id: 1 });

// Update with encryption options
const updatedCount = await update('sensitive_data', { status: 'active' }, { id: 1 }, {
  encrypted: true,
  requireAuthOnAccess: false
});
```

##### remove

**Functionality**: Delete matching records from a specified table

**Signature**:
```typescript
remove(tableName: string, where: FilterCondition, options?: TableOptions): Promise<number>
```

**Parameters**:
- `tableName`: Table name
- `where`: Delete condition
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `number`: Number of deleted records

**Examples**:
```typescript
// Delete single record
const deletedCount = await remove('users', { id: 1 });

// Delete multiple records
const deletedCount = await remove('users', {
  status: 'inactive'
});

// Delete with encryption options
const deletedCount = await remove('sensitive_data', { id: 1 }, {
  encrypted: true,
  requireAuthOnAccess: false
});
```

##### bulkWrite

**Functionality**: Execute batch operations, supporting insert, update and delete

**Signature**:
```typescript
bulkWrite(tableName: string, operations: Array<{
  type: 'insert' | 'update' | 'delete';
  data: Record<string, any> | Record<string, any>[];
  where?: FilterCondition;
}>, options?: TableOptions): Promise<WriteResult>
```

**Parameters**:
- `tableName`: Table name
- `operations`: Array of operations
  - `type`: Operation type, `'insert'`, `'update'` or `'delete'`
  - `data`: Operation data
  - `where`: Operation condition (required for update and delete)
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Returns**:
- `WriteResult`: Write result

**Example**:
```typescript
await bulkWrite('users', [
  { type: 'insert', data: { id: 4, name: 'Alice Brown', age: 28 } },
  { type: 'update', data: { status: 'active' }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } }
]);

// Execute bulk operations with encryption options
await bulkWrite('sensitive_data', [
  { type: 'insert', data: { id: 1, name: 'Sensitive Data', value: '123456' } },
  { type: 'update', data: { value: '789012' }, where: { id: 1 } }
], {
  encrypted: true,
  requireAuthOnAccess: false
});
```

#### Transaction Management APIs

##### beginTransaction

**Functionality**: Start a new transaction

**Signature**:
```typescript
beginTransaction(options?: TableOptions): Promise<void>
```

**Parameters**:
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Example**:
```typescript
await beginTransaction();
try {
  // Execute a series of operations
  await insert('users', { id: 5, name: 'Charlie Davis' });
  await update('users', { balance: { $inc: 100 } }, { id: 5 });
  // Commit the transaction
  await commit();
} catch (error) {
  // Rollback the transaction
  await rollback();
  throw error;
}

// Start transaction with encryption options
await beginTransaction({ encrypted: true, requireAuthOnAccess: false });
```

##### commit

**Functionality**: Commit the current transaction

**Signature**:
```typescript
commit(options?: TableOptions): Promise<void>
```

**Parameters**:
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Example**:
```typescript
await beginTransaction();
try {
  // Execute operations
  await commit();
} catch (error) {
  await rollback();
}

// Commit transaction with encryption options
await commit({ encrypted: true, requireAuthOnAccess: false });
```

##### rollback

**Functionality**: Rollback the current transaction

**Signature**:
```typescript
rollback(options?: TableOptions): Promise<void>
```

**Parameters**:
- `options`: Optional configuration
  - `encrypted`: Whether to enable encrypted storage, default is false (optional)
  - `requireAuthOnAccess`: Whether biometric verification is required, default is false (optional)

**Example**:
```typescript
await beginTransaction();
try {
  // Execute operations
  await commit();
} catch (error) {
  await rollback();
}

// Rollback transaction with encryption options
await rollback({ encrypted: true, requireAuthOnAccess: false });
```

#### Auto-sync APIs

##### getSyncStats

**Functionality**: Get auto-sync statistics

**Signature**:
```typescript
getSyncStats(): Promise<{
  syncCount: number;
  totalItemsSynced: number;
  lastSyncTime: number;
  avgSyncTime: number;
}>
```

**Returns**:
- Sync statistics object
  - `syncCount`: Total sync count
  - `totalItemsSynced`: Total items synced
  - `lastSyncTime`: Last sync time
  - `avgSyncTime`: Average sync time (milliseconds)

**Example**:
```typescript
const stats = await getSyncStats();
console.log('Sync statistics:', stats);
```

##### syncNow

**Functionality**: Trigger sync immediately

**Signature**:
```typescript
syncNow(): Promise<void>
```

**Example**:
```typescript
// Manually trigger sync
await syncNow();
```

##### setAutoSyncConfig

**Functionality**: Set auto-sync configuration

**Signature**:
```typescript
setAutoSyncConfig(config: Partial<{
  enabled: boolean;
  interval: number;
  minItems: number;
  batchSize: number;
}>): Promise<void>
```

**Parameters**:
- `config`: Sync configuration
  - `enabled`: Whether to enable auto-sync
  - `interval`: Sync interval (milliseconds)
  - `minItems`: Minimum number of dirty items to trigger sync
  - `batchSize`: Maximum number of items per sync

**Example**:
```typescript
// Set auto-sync configuration
await setAutoSyncConfig({
  enabled: true,
  interval: 10000, // Sync every 10 seconds
  minItems: 5, // Sync at least 5 dirty items
  batchSize: 200 // Max 200 items per sync
});
```

### Interface Definitions

#### ReadOptions Interface

```typescript
interface ReadOptions {
  // Pagination options
  skip?: number; // Number of records to skip
  limit?: number; // Maximum number of records to return

  // Filter options
  filter?: FilterCondition; // Query condition

  // Sorting options
  sortBy?: string | string[]; // Sort field(s)
  order?: 'asc' | 'desc' | ('asc' | 'desc')[]; // Sort direction
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow'; // Sorting algorithm
}
```

#### FilterCondition Type

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

#### WriteResult Interface

```typescript
interface WriteResult {
  written: number; // Number of bytes written
  totalAfterWrite: number; // Total bytes after write
  chunked: boolean; // Whether chunked writing was used
  chunks?: number; // Number of chunks (when chunked writing)
}
```

## 🎯 Advanced Queries

### Query Operators

| Operator | Description      | Example                             |
| -------- | ---------------- | ----------------------------------- |
| `$eq`    | Equal to         | `{ age: { $eq: 25 } }`              |
| `$ne`    | Not equal to     | `{ status: { $ne: 'inactive' } }`   |
| `$gt`    | Greater than     | `{ age: { $gt: 18 } }`              |
| `$gte`   | Greater or equal | `{ score: { $gte: 60 } }`           |
| `$lt`    | Less than        | `{ price: { $lt: 100 } }`           |
| `$lte`   | Less or equal    | `{ quantity: { $lte: 10 } }`        |
| `$in`    | In array         | `{ category: { $in: ['A', 'B'] } }` |
| `$nin`   | Not in array     | `{ status: { $nin: ['deleted'] } }` |
| `$like`  | Fuzzy match      | `{ name: { $like: 'Zhang%' } }`     |

### Complex Queries

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

## 🎯 Smart Sorting

### Basic Sorting

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

### Sorting Algorithm Selection

The system provides 5 professional sorting algorithms, automatically selecting the optimal one:

| Algorithm  | Use Case                                   | Performance Characteristics           |
| ---------- | ------------------------------------------ | ------------------------------------- |
| `default`  | Small datasets (< 100 items)               | Balanced performance and features     |
| `fast`     | Large datasets, simple comparison          | Fastest, but simplified functionality |
| `merge`    | Large datasets, stable sorting             | Stable, suitable for large data       |
| `counting` | Limited range values (e.g., status, level) | O(n+k), space for time                |
| `slow`     | Requires full localeCompare                | Supports Chinese, special characters  |

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

### Sorting + Filtering + Pagination

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

## 🎯 Transaction Management

### ACID Transactions

Best practice for ensuring data consistency:

```typescript
import { beginTransaction, commit, rollback, insert, update, findOne } from 'expo-lite-data-store';

async function transferMoney(fromUserId: number, toUserId: number, amount: number) {
  try {
    // Start transaction
    await beginTransaction();

    // Check sender's balance
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

### Transaction Best Practices

1. **Keep transactions short**: Transactions hold locks, long-running transactions affect performance
2. **Avoid nested transactions**: Current version doesn't support nested transactions
3. **Error handling**: Always wrap transaction code in try-catch
4. **Batch operations**: Use bulk operations in transactions to reduce disk I/O
5. **Test rollback**: Ensure rollback mechanism works correctly

## 🎯 Auto-sync Mechanism

### Configuring Auto-sync

```typescript
import { setAutoSyncConfig, getSyncStats, syncNow } from 'expo-lite-data-store';

// Get current sync statistics
const stats = await getSyncStats();
console.log('Sync statistics:', stats);

// Trigger sync immediately
await syncNow();

// Custom auto-sync configuration
setAutoSyncConfig({
  enabled: true, // Enable auto-sync
  interval: 10000, // Sync every 10 seconds
  minItems: 5, // Sync at least 5 dirty items
  batchSize: 200, // Max 200 items per sync
});
```

### Sync Configuration Parameters

| Parameter   | Type    | Default | Description                     |
| ----------- | ------- | ------- | ------------------------------- |
| `enabled`   | boolean | `true`  | Whether to enable auto-sync     |
| `interval`  | number  | `5000`  | Sync interval (milliseconds)    |
| `minItems`  | number  | `1`     | Minimum number of items to sync |
| `batchSize` | number  | `100`   | Batch size limit                |

### Sync Statistics

| Field Name         | Type   | Description                      |
| ------------------ | ------ | -------------------------------- |
| `syncCount`        | number | Total sync count                 |
| `totalItemsSynced` | number | Total items synced               |
| `lastSyncTime`     | number | Last sync time                   |
| `avgSyncTime`      | number | Average sync time (milliseconds) |

## 🎯 Performance Optimization

### Index Optimization

Current version supports automatic indexing:

- Automatically creates index for `id` field
- Automatically creates indexes for common fields (`name`, `email`, `type`, `status`)
- Indexes are built automatically after data reading
- Indexes are cleared and rebuilt when data is modified

```typescript
// Example of index usage
const user = await findOne('users', { id: 123 }); // Uses id index
const users = await findMany('users', { email: 'user@example.com' }); // Uses email index
```

### Batch Operation Optimization

```typescript
// Use bulkWrite for batch operations, more efficient than multiple individual operations
await bulkWrite('products', [
  { type: 'insert', data: { id: 1, name: 'Product 1' } },
  { type: 'update', data: { price: 29.99 }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } },
]);
```

### Pagination Optimization

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
  // processPageData(results);

  page++;
}
```

### Cache Optimization

```javascript
// Configure cache
// liteStore.config.js
module.exports = {
  encryption: {
    cacheTimeout: 30000, // Cache timeout (milliseconds)
    maxCacheSize: 100, // Maximum number of cached tables
  },
};

// Disable cache
// Set cacheTimeout: 0
```

## 🎯 Security

### Data Encryption

LiteStore provides robust encryption functionality, supporting AES-CTR encryption algorithm and HMAC-SHA512 integrity verification. You can flexibly choose encryption modes and biometric authentication options based on your needs.

### Encryption Modes

LiteStore supports three encryption usage modes:

#### 1. Non-encrypted Mode (Default)

- No encryption algorithm used
- No biometric or password authentication triggered
- Data stored in plain text
- Suitable for non-sensitive data

```typescript
// Non-encrypted mode (default)
await createTable('users');
await insert('users', { id: 1, name: 'John Doe' });
```

#### 2. Encrypted Mode

- Uses AES-CTR encryption algorithm
- Does not require biometric authentication for each access
- Suitable for data that needs encryption but doesn't require frequent biometric verification
- **Default encryption method**: Field-level encryption
- **Default encrypted fields**: `password`, `email`, `phone`

```typescript
// Encrypted mode without biometric authentication (default: field-level encryption)
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: false
});
await insert('users', { id: 1, name: 'John Doe' }, {
  encrypted: true,
  requireAuthOnAccess: false
});
```

#### 3. Encrypted Mode + Biometric Authentication

- Uses AES-CTR encryption algorithm
- Requires biometric or password authentication for each access
- Suitable for highly sensitive data
- **Default encryption method**: Field-level encryption

```typescript
// Encrypted mode with biometric authentication (default: field-level encryption)
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: true
});
await insert('users', { id: 1, name: 'John Doe' }, {
  encrypted: true,
  requireAuthOnAccess: true
});
```

**Encryption Priority Explanation**:
- When `encryptFullTable: true` parameter is explicitly set, full table encryption is used
- Otherwise, field-level encryption is used by default (based on `enableFieldLevelEncryption` and `encryptedFields` settings in the configuration file)
- Full table encryption and field-level encryption **cannot be used simultaneously**. The system will automatically detect conflicts and throw a clear error message

### Encryption Parameters

| Parameter           | Type    | Default | Description                                                                 |
| ------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `encrypted`         | boolean | false   | Whether to enable data encryption                                           |
| `requireAuthOnAccess` | boolean | false   | Whether to require biometric authentication for each data access (only effective when `encrypted` is true) |
| `encryptFullTable`   | boolean | false  | Whether to enable full table encryption (only effective when `encrypted` is true, mutually exclusive with field-level encryption) |
| `enableFieldLevelEncryption` | boolean | false | Whether to enable field-level encryption (only effective when `encrypted` is true, mutually exclusive with full table encryption) |
| `encryptedFields` | string[] | [] | List of fields to encrypt (only effective when `enableFieldLevelEncryption` is true) |

### Key Management

1. **Key Generation**: System automatically generates 256-bit AES keys using device unique identifiers and secure random numbers
2. **Key Storage**: Keys are securely stored using system SecureStore
3. **Key Caching**: Keys are cached in memory for a period to reduce biometric request frequency
4. **Integrity Verification**: Uses HMAC-SHA512 to ensure data integrity
5. **Auto Rotation**: System automatically rotates keys periodically to enhance security

### Security Best Practices

1. **Choose encryption mode based on data sensitivity**: Use encrypted mode for sensitive data, non-encrypted mode for non-sensitive data
2. **Use biometric appropriately**: Enable `requireAuthOnAccess` only for highly sensitive data
3. **Key management**: Encryption keys are automatically generated and managed by the system, no manual handling required
4. **Backup security**: Backups of encrypted data need to be properly protected
5. **Permission control**: Restrict access permissions to database files
6. **Regular updates**: Keep the library updated to get the latest security fixes

### Biometric and Password Authentication

**Optimized Behavior**: Biometric or password authentication is only triggered when actually needed for encryption operations.

**Specific Optimizations**:
1. No longer triggers biometric or password authentication during system initialization
2. Only requests encryption keys when actually performing encryption operations (such as decrypting data)
3. No biometric or password authentication is triggered if the project does not use encrypted data
4. The optimized behavior provides a better user experience by avoiding unnecessary authentication requests
5. Supports fingerprint recognition, face recognition, and device passwords as alternatives

## 🎯 Troubleshooting

### Common Issues

<details>
<summary>Q: Incorrect sorting order?</summary>

A: Check if the sorting field has null/undefined values, which are sorted at the end.
</details>

<details>
<summary>Q: Slow query performance?</summary>

A: Try using a more suitable sorting algorithm for your data volume, or enable pagination.
</details>

<details>
<summary>Q: High memory usage?</summary>

A: For super large datasets, consider using pagination or `fast` sorting algorithm.
</details>

<details>
<summary>Q: Incorrect international sorting (e.g., Chinese characters)?</summary>

A: Use `sortAlgorithm: 'slow'` for complete international character support, including Chinese, Japanese, Korean, and other languages.
</details>

<details>
<summary>Q: How to use in pure JavaScript projects?</summary>

A: JavaScript version is automatically used when importing, no special configuration needed.
</details>

<details>
<summary>Q: What's the difference between TypeScript and JavaScript versions?</summary>

A: TypeScript version provides complete type checking and IDE support; JavaScript version is lightweight but has no type checking.
</details>

<details>
<summary>Q: How to build your own version?</summary>

A: Run `npm run build:all` to build complete TypeScript and JavaScript versions.
</details>

<details>
<summary>Q: Configuration changes not taking effect?</summary>

A: Configuration is loaded directly from the bundled file, so you need to restart the application after modifying the configuration file.
</details>

<details>
<summary>Q: How to disable auto-sync?</summary>

A: Set `cache.autoSync.enabled: false` in the configuration file, or use the `setAutoSyncConfig({ enabled: false })` API.
</details>

<details>
<summary>Q: How to use encryption?</summary>

A: Encryption functionality is fully available, supporting three usage modes:
1. Non-encrypted mode (default): No encryption algorithm used, no biometric authentication triggered
2. Encrypted mode: Uses AES-CTR encryption, no biometric authentication required
3. Encrypted mode + biometric authentication: Biometric or password authentication required for each access

Please refer to the "🔒 Encryption Usage" section in the documentation for detailed usage instructions.
</details>

<details>
<summary>Q: How to handle data migration?</summary>

A: Automatic data migration is not supported yet. It's recommended to manually export old data and import it into new tables.
</details>

<details>
<summary>Q: What filter operators are supported?</summary>

A: Supports `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or` and other operators.
</details>

### Error Code Description

#### Table-related Error Codes

| Error Code | Description | Solution |
|-----------|-------------|----------|
| `TABLE_NOT_FOUND` | The specified table does not exist | Check if the table name is correct, or create the table first |
| `TABLE_CREATE_FAILED` | Failed to create table | Check if you have write permissions, or if the table name already exists |
| `TABLE_DELETE_FAILED` | Failed to delete table | Check if you have write permissions, or if the table is locked |
| `TABLE_UPDATE_FAILED` | Failed to update table | Check if you have write permissions, or if the table is locked |
| `TABLE_READ_FAILED` | Failed to read table | Check if you have read permissions, or if the file is corrupted |
| `TABLE_COUNT_FAILED` | Failed to count table | Check if the table exists, or if you have read permissions |
| `TABLE_SIZE_FAILED` | Failed to get table size | Check if the table exists, or if you have read permissions |
| `TABLE_CHUNK_FAILED` | Failed to chunk table | Check file system permissions, or if there is sufficient storage space |
| `TABLE_CHUNK_SIZE_FAILED` | Failed to configure chunk size | Check if the chunk size configuration is within valid range |
| `TABLE_CHUNK_SIZE_TOO_SMALL` | Chunk size too small | Increase the chunk size configuration |
| `TABLE_CHUNK_SIZE_TOO_LARGE` | Chunk size too large | Decrease the chunk size configuration |
| `TABLE_ALREADY_EXISTS` | Table already exists | Choose a different table name, or delete the existing table |
| `TABLE_NAME_INVALID` | Invalid table name | Use a valid table name, avoid special characters |
| `TABLE_COLUMN_INVALID` | Invalid table column | Check if the column definition is correct |
| `TABLE_INDEX_INVALID` | Invalid table index | Check if the index definition is correct |
| `TABLE_INDEX_ALREADY_EXISTS` | Table index already exists | Choose a different index name, or delete the existing index |
| `TABLE_INDEX_NOT_FOUND` | Table index not found | Check if the index name is correct, or create the index first |
| `TABLE_INDEX_NAME_INVALID` | Invalid table index name | Use a valid index name, avoid special characters |
| `TABLE_INDEX_TYPE_INVALID` | Invalid table index type | Use a supported index type |
| `TABLE_INDEX_UNIQUE_INVALID` | Invalid table index uniqueness configuration | Check if the uniqueness configuration is correct |
| `TABLE_INDEX_NOT_UNIQUE` | Table index is not unique | Ensure index field values are unique, or modify the index configuration |

#### File-related Error Codes

| Error Code | Description | Solution |
|-----------|-------------|----------|
| `FILE_NOT_FOUND` | File not found | Check if the file path is correct |
| `FILE_ALREADY_EXISTS` | File already exists | Choose a different file name, or delete the existing file |
| `FILE_NAME_INVALID` | Invalid file name | Use a valid file name, avoid special characters |
| `FILE_CONTENT_INVALID` | Invalid file content | Check if the file content format is correct |
| `FILE_CONTENT_TOO_LARGE` | File content too large | Reduce the file size, or adjust configuration to allow larger files |
| `FILE_READ_FAILED` | Failed to read file | Check if you have read permissions, or if the file is corrupted |
| `FILE_WRITE_FAILED` | Failed to write file | Check if you have write permissions, or if there is sufficient storage space |
| `FILE_DELETE_FAILED` | Failed to delete file | Check if you have write permissions, or if the file is locked |
| `FILE_MOVE_FAILED` | Failed to move file | Check if you have write permissions, or if the target path exists |
| `FILE_COPY_FAILED` | Failed to copy file | Check if you have read/write permissions, or if there is sufficient storage space |
| `FILE_RENAME_FAILED` | Failed to rename file | Check if you have write permissions, or if the target file name already exists |
| `FILE_TRUNCATE_FAILED` | Failed to truncate file | Check if you have write permissions, or if the file is locked |

#### Transaction-related Error Codes

| Error Code | Description | Solution |
|-----------|-------------|----------|
| `TRANSACTION_IN_PROGRESS` | Transaction already in progress | Wait for the current transaction to complete, or commit/rollback the current transaction |
| `NO_TRANSACTION_IN_PROGRESS` | No transaction in progress | Start a transaction first |
| `TRANSACTION_COMMIT_FAILED` | Failed to commit transaction | Check if operations in the transaction are correct, or if there are concurrency conflicts |
| `TRANSACTION_ROLLBACK_FAILED` | Failed to rollback transaction | Check if you have write permissions, or if the system supports rollback operations |

#### Other Error Codes

| Error Code | Description | Solution |
|-----------|-------------|----------|
| `UNKNOWN` | Unknown error | Check detailed error information, or check system logs |
| `TIMEOUT` | Operation timed out | Increase timeout configuration, or optimize operation performance |
| `PERMISSION_DENIED` | Permission denied | Check if you have the appropriate file system permissions |
| `DISK_FULL` | Disk full | Free up disk space, or choose a different storage location |
| `CORRUPTED_DATA` | Corrupted data | Restore from backup, or recreate the table |
| `DATA_INCOMPLETE` | Incomplete data | Check the data source, or re-acquire the data |
| `CHUNK_INTEGRITY_FAILED` | Chunk integrity check failed | Check if the file is corrupted, or recreate the chunks |
| `META_FILE_READ_ERROR` | Meta file read error | Check if the meta file exists, or if it is corrupted |
| `META_FILE_WRITE_ERROR` | Meta file write error | Check if you have write permissions, or if there is sufficient storage space |
| `QUERY_FAILED` | Query execution failed | Check if the query condition is correct, or if the table structure matches |
| `MIGRATION_FAILED` | Migration failed | Check if the migration script is correct, or if the data format is compatible |
| `WRITTEN_COUNT_MISMATCH` | Written count mismatch | Check if the write operation is correct, or if the data is complete |
| `BULK_OPERATION_FAILED` | Bulk operation failed | Check if each operation in the bulk operation is correct, or split the bulk operation |

### Debugging Tips

1. **Enable debug logs**: Enable detailed logs in development environment
2. **Check configuration**: Ensure configuration file is loaded correctly
3. **Verify table existence**: Check if table exists before operation
4. **View sync statistics**: Check if auto-sync is working properly
5. **Monitor performance**: Use performance monitoring tools to check query time

## 🎯 Performance Benchmarks

### Sorting Algorithm Performance Comparison

| Algorithm | Small Dataset (<100) | Medium Dataset (100-10K) | Large Dataset (>10K) | Memory Usage | Stability |
| --------- | -------------------- | ------------------------ | -------------------- | ------------ | --------- |
| default   | ⭐⭐⭐⭐⭐           | ⭐⭐⭐                   | ⭐⭐                 | Low          | High      |
| fast      | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐               | ⭐⭐⭐               | Low          | Medium    |
| merge     | ⭐⭐⭐⭐             | ⭐⭐⭐⭐⭐               | ⭐⭐⭐⭐⭐           | Medium       | High      |
| counting  | ⭐⭐⭐               | ⭐⭐⭐⭐⭐               | ⭐⭐⭐⭐⭐           | High\*       | High      |
| slow      | ⭐⭐                 | ⭐⭐                     | ⭐⭐                 | Low          | High      |

\* Counting sort is memory efficient when range is limited

### Recommended Use Cases

- **Real-time search results**: Use `fast` algorithm
- **Big data analysis**: Use `merge` algorithm
- **Status/rank sorting**: Use `counting` algorithm
- **Chinese content sorting**: Use `slow` algorithm
- **General scenarios**: Don't specify algorithm, let it auto-select

## 🎯 Version Selection

| Import Path                 | Type Support  | Use Case               | Source Files                                 |
| --------------------------- | ------------- | ---------------------- | -------------------------------------------- |
| `'expo-lite-data-store'`    | ✅ TypeScript | Recommended (default)  | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/js'` | ✅ TypeScript | JavaScript environment | `dist/js/index.js` + `dist/types/index.d.ts` |

> Note: TypeScript support is automatically provided through type definition files. All import paths include complete type support, no need to select a separate TypeScript version.

## 🎯 Build Tool Integration

### Webpack

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

### Rollup

```javascript
// rollup.config.js
export default {
  external: ['expo-lite-data-store'],
  plugins: [
    // Other plugins
  ],
};
```

### Metro (React Native)

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

## 📞 Support and Feedback

- 📧 **Email**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **Documentation**: [README](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.md)

## License

MIT © QinIndex Qin