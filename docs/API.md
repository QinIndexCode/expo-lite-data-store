# Expo Lite Data Store - API Reference

## Installation

```bash
npm install expo-lite-data-store
```

## Quick Start

```typescript
import { db } from 'expo-lite-data-store';

// Initialize database
await db.init();

// Create table
await db.createTable('users', {
  columns: { name: 'string', email: 'string' }
});

// Insert data
await db.insert('users', { name: 'Alice', email: 'alice@example.com' });

// Query data
const users = await db.findMany('users', { where: { name: 'Alice' } });
```

## Database API

### `createTable(tableName, options?)`

Create a new table.

```typescript
await db.createTable('users', {
  columns: {
    name: 'string',
    age: 'number',
    active: 'boolean',
    createdAt: 'date',
    avatar: 'blob'
  },
  initialData: [{ id: 1, name: 'Alice' }],
  mode: 'single' | 'chunked',
  encrypted: true,
  encryptedFields: ['email', 'phone']
});
```

**Options:**
- `columns`: Column schema definitions (`string` | `{ type: string; isHighRisk?: boolean }`)
- `initialData`: Initial data to insert
- `mode`: Storage mode (`'single'` or `'chunked'`)
- `encrypted`: Enable encryption
- `encryptedFields`: Fields to encrypt
- `isHighRisk`: Mark table as high-risk (bypasses cache)
- `highRiskFields`: List of high-risk fields

### `deleteTable(tableName)`

Delete a table and all its data.

```typescript
await db.deleteTable('users');
```

### `hasTable(tableName)`

Check if a table exists.

```typescript
const exists = await db.hasTable('users');
```

### `listTables()`

List all tables.

```typescript
const tables = await db.listTables();
```

### `insert(tableName, data, options?)`

Insert one or more records (append mode only).

```typescript
// Single record
await db.insert('users', { name: 'Alice' });

// Multiple records
await db.insert('users', [
  { name: 'Alice' },
  { name: 'Bob' }
]);
```

### `overwrite(tableName, data, options?)`

Replace all data in a table (overwrite mode only).

```typescript
await db.overwrite('users', [
  { id: 1, name: 'New Alice' },
  { id: 2, name: 'New Bob' }
]);
```

### `read(tableName, options?)`

Read all records from a table (no filtering, sorting, or pagination).

```typescript
const allUsers = await db.read('users');
```

**Note:** For filtering, sorting, and pagination, use `findMany` instead.

### `countTable(tableName)`

Get record count from metadata (fast, O(1)).

```typescript
const count = await db.countTable('users');
```

### `verifyCountTable(tableName)`

Verify count accuracy by scanning actual data (slower, for diagnostics).

```typescript
const result = await db.verifyCountTable('users');
// Returns: { metadata: number; actual: number; match: boolean }
```

### `findOne(tableName, options)`

Find a single record.

```typescript
const user = await db.findOne('users', {
  where: { id: '123' },
  encrypted: true
});
```

### `findMany(tableName, options?)`

Find multiple records with filtering, sorting, and pagination.

```typescript
const users = await db.findMany('users', {
  where: { age: { $gt: 18 } },
  skip: 10,
  limit: 20,
  sortBy: 'createdAt',
  order: 'desc',
  encrypted: true
});
```

**Options:**
- `where`: Filter conditions
- `skip`: Number of records to skip
- `limit`: Maximum records to return
- `sortBy`: Field(s) to sort by
- `order`: Sort order (`'asc'` or `'desc'`)
- `sortAlgorithm`: Custom sort algorithm
- `encrypted`: Use encrypted storage

### `update(tableName, data, options)`

Update records matching conditions.

```typescript
const updatedCount = await db.update('users', 
  { name: 'Alice Updated' },
  { where: { id: '123' } }
);
```

### `remove(tableName, options)`

Delete records matching conditions.

```typescript
const deletedCount = await db.remove('users', {
  where: { id: '123' }
});
```

### `clearTable(tableName)`

Clear all data from a table.

```typescript
await db.clearTable('users');
```

### `bulkWrite(tableName, operations)`

Execute multiple operations in a single call.

```typescript
await db.bulkWrite('users', [
  { type: 'insert', data: { name: 'Alice' } },
  { type: 'update', data: { name: 'Bob Updated' }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } }
]);
```

### `migrateToChunked(tableName)`

Migrate a table from single-file to chunked storage mode.

```typescript
await db.migrateToChunked('users');
```

## Transaction API

### `beginTransaction()`

Start a new transaction.

```typescript
await db.beginTransaction();
```

### `commit()`

Commit the current transaction.

```typescript
await db.commit();
```

### `rollback()`

Rollback the current transaction.

```typescript
await db.rollback();
```

## Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal | `{ name: { $eq: 'Alice' } }` |
| `$ne` | Not equal | `{ name: { $ne: 'Alice' } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ age: { $lt: 65 } }` |
| `$lte` | Less than or equal | `{ age: { $lte: 65 } }` |
| `$in` | In array | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Not in array | `{ status: { $nin: ['deleted'] } }` |
| `$like` | Pattern match (SQL LIKE syntax) | `{ name: { $like: '%Alice%' } }` |
| `$and` | Logical AND | `{ $and: [{ name: 'Alice' }, { age: { $gt: 18 } }] }` |
| `$or` | Logical OR | `{ $or: [{ name: 'Alice' }, { name: 'Bob' }] }` |

## Encryption API

### `encrypt(plainText, masterKey)`

Encrypt text.

```typescript
import { encrypt, decrypt } from 'expo-lite-data-store';

const encrypted = await encrypt('secret text', 'master-key');
```

### `decrypt(encryptedText, masterKey)`

Decrypt text.

```typescript
const decrypted = await decrypt(encryptedText, 'master-key');
```

### `encryptBulk(texts, masterKey)`

Encrypt multiple texts.

```typescript
const encrypted = await encryptBulk(['text1', 'text2'], 'master-key');
```

### `decryptBulk(encryptedTexts, masterKey)`

Decrypt multiple texts.

```typescript
const decrypted = await decryptBulk(encryptedTexts, 'master-key');
```

### `hash(data, algorithm?)`

Hash data.

```typescript
import { hash } from 'expo-lite-data-store';

const hashValue = await hash('data to hash', 'SHA-512');
```

### `resetMasterKey()`

Reset the master key (for logout/reset).

```typescript
await resetMasterKey();
```

### `getKeyCacheStats()`

Get encryption key cache statistics.

```typescript
import { getKeyCacheStats } from 'expo-lite-data-store';

const stats = getKeyCacheStats();
// Returns: { hits: number; misses: number; evictions: number; size: number }
```

### `getKeyCacheHitRate()`

Get encryption key cache hit rate.

```typescript
import { getKeyCacheHitRate } from 'expo-lite-data-store';

const hitRate = getKeyCacheHitRate();
// Returns: number (0-1)
```

## Configuration API

### `configManager.getConfig()`

Get current configuration.

```typescript
import { configManager } from 'expo-lite-data-store';

const config = configManager.getConfig();
```

### `configManager.updateConfig(partialConfig)`

Update configuration.

```typescript
configManager.updateConfig({
  encryption: {
    algorithm: 'AES-GCM',
    keyIterations: 600000
  },
  cache: {
    maxSize: 1000
  }
});
```

### `configManager.resetConfig()`

Reset configuration to defaults.

```typescript
configManager.resetConfig();
```

## Performance Monitoring

### `performanceMonitor.getStats()`

Get performance statistics.

```typescript
import { performanceMonitor } from 'expo-lite-data-store';

const stats = performanceMonitor.getStats();
```

### `performanceMonitor.getHealthCheck()`

Run a health check.

```typescript
const health = performanceMonitor.getHealthCheck();
```

## Error Types

### `StorageError`

Base error class for all storage errors.

```typescript
import { StorageError } from 'expo-lite-data-store';

try {
  await db.read('nonexistent');
} catch (error) {
  if (error instanceof StorageError) {
    console.log(error.code);      // Error code
    console.log(error.category);  // Error category
    console.log(error.details);   // Error details
    console.log(error.suggestion); // Suggested fix
  }
}
```

### `CryptoError`

Error class for crypto operations.

```typescript
import { CryptoError } from 'expo-lite-data-store';

try {
  await decrypt(encryptedText, 'wrong-key');
} catch (error) {
  if (error instanceof CryptoError) {
    console.log(error.code); // DECRYPT_FAILED, KEY_DERIVE_FAILED, etc.
  }
}
```

### Error Codes

| Code | Category | Description |
|------|----------|-------------|
| `TABLE_NOT_FOUND` | table | Table does not exist |
| `TABLE_CREATE_FAILED` | table | Table creation failed |
| `TABLE_DELETE_FAILED` | table | Table deletion failed |
| `TABLE_UPDATE_FAILED` | table | Table update failed |
| `TABLE_READ_FAILED` | table | Table read failed |
| `TABLE_COUNT_FAILED` | table | Table count failed |
| `TABLE_ALREADY_EXISTS` | table | Table already exists |
| `TABLE_NAME_INVALID` | table | Table name is invalid |
| `TABLE_INDEX_NOT_UNIQUE` | table | Unique constraint violated |
| `FILE_NOT_FOUND` | file | File does not exist |
| `FILE_READ_FAILED` | file | File read failed |
| `FILE_WRITE_FAILED` | file | File write failed |
| `FILE_CONTENT_INVALID` | file | File content is invalid |
| `QUERY_FAILED` | query | Query execution failed |
| `TIMEOUT` | timeout | Operation timed out |
| `PERMISSION_DENIED` | permission | Permission denied |
| `DISK_FULL` | disk | Disk is full |
| `CORRUPTED_DATA` | data | Data is corrupted |
| `DATA_INCOMPLETE` | data | Data is incomplete |
| `TRANSACTION_IN_PROGRESS` | transaction | Transaction already in progress |
| `NO_TRANSACTION_IN_PROGRESS` | transaction | No transaction in progress |
| `TRANSACTION_COMMIT_FAILED` | transaction | Transaction commit failed |
| `TRANSACTION_ROLLBACK_FAILED` | transaction | Transaction rollback failed |
| `LOCK_TIMEOUT` | concurrency | Lock acquisition timed out |
| `KEY_DERIVE_FAILED` | crypto | Key derivation failed |
| `ENCRYPT_FAILED` | crypto | Encryption failed |
| `DECRYPT_FAILED` | crypto | Decryption failed |
| `HMAC_MISMATCH` | crypto | HMAC verification failed |

## Type Definitions

### `LiteStoreConfig`

```typescript
interface LiteStoreConfig {
  chunkSize: number;
  storageFolder: string;
  sortMethods: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  timeout: number;
  encryption: {
    algorithm: 'AES-CTR' | 'AES-GCM' | 'auto';
    keySize: 256;
    hmacAlgorithm: 'SHA-256' | 'SHA-512';
    keyIterations: number;
    encryptedFields?: string[];
    cacheTimeout: number;
    maxCacheSize: number;
    useBulkOperations: boolean;
    autoSelectHMAC?: boolean;
  };
  performance: {
    enableQueryOptimization: boolean;
    maxConcurrentOperations: number;
    enableBatchOptimization: boolean;
    memoryWarningThreshold: number;
  };
  cache: {
    maxSize: number;
    defaultExpiry: number;
    cleanupInterval: number;
    memoryWarningThreshold: number;
  };
  monitoring: {
    enablePerformanceTracking: boolean;
    enableHealthChecks: boolean;
    metricsRetention: number;
  };
  autoSync?: {
    enabled?: boolean;
    interval?: number;
    minItems?: number;
    batchSize?: number;
  };
  api: {
    rateLimit: {
      enabled: boolean;
      requestsPerSecond: number;
      burstCapacity: number;
    };
    retry: {
      maxAttempts: number;
      backoffMultiplier: number;
    };
  };
}
```

### `WriteResult`

```typescript
interface WriteResult {
  written: number;
  totalAfterWrite: number;
  chunked: boolean;
}
```

### `CreateTableOptions`

```typescript
interface CreateTableOptions {
  columns?: Record<string, string | { type: string; isHighRisk?: boolean }>;
  initialData?: Record<string, any>[];
  mode?: 'single' | 'chunked';
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
  encryptedFields?: string[];
  encryptFullTable?: boolean;
  isHighRisk?: boolean;
  highRiskFields?: string[];
}
```

### `ReadOptions`

```typescript
interface ReadOptions {
  filter?: Record<string, any>;
  skip?: number;
  limit?: number;
  sortBy?: string | string[];
  order?: 'asc' | 'desc' | Array<'asc' | 'desc'>;
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  bypassCache?: boolean;
}
```

### `WriteOptions`

```typescript
interface WriteOptions {
  mode?: 'append' | 'overwrite';
  directWrite?: boolean;
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
}
```

### `FilterCondition`

```typescript
type FilterCondition =
  | Record<string, any>
  | ((item: Record<string, any>) => boolean)
  | undefined;
```
