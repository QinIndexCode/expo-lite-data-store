# Expo Lite Data Store API

[简体中文](./API.zh-CN.md) | [Consumer Guide](../README.md) | [Runtime QA Guide](./EXPO_RUNTIME_QA.md) | [Changelog](./CHANGELOG.md)

## Scope of this reference

This document is the detailed API reference for the current `2.x` public surface. It covers:

- the supported install contract;
- the exported facade and named functions;
- table creation, reads, writes, query semantics, and transactions;
- configuration and monitoring helpers;
- crypto helpers, exported error types, and common runtime failure codes.

For a narrative setup guide, start with [README.md](../README.md). For maintainer release evidence and runtime verification lanes, use [EXPO_RUNTIME_QA.md](./EXPO_RUNTIME_QA.md).

## Installation Contract

This library is documented against the supported Expo install contract. `npm install expo-lite-data-store` on its own is not a supported setup.

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

If the consumer app installs only the package tarball name and skips the Expo runtime packages above, runtime module resolution may fail even though the package manager reports success.

`react-native-quick-crypto` is optional and belongs only in a native dev client or standalone build that needs the native flagship crypto provider.

### Supported install combinations

- Supported: `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`
- Supported for native flagship validation: the same command plus `react-native-quick-crypto`
- Not supported: `npm install expo-lite-data-store` as the only installation step

### Missing runtime package failure

When a required Expo runtime package cannot be resolved, the library throws `StorageError` with code `EXPO_MODULE_MISSING`.

That error should be interpreted as:

- the host app was installed outside the documented contract, or
- the host app removed one of the required Expo peer dependencies after initial setup.

## Import Surface

### Recommended import style

```ts
import {
  db,
  configManager,
  performanceMonitor,
  StorageError,
  StorageErrorCode,
} from 'expo-lite-data-store';
```

`StorageErrorCode` is available as a runtime constant map, and the `StorageError.code` field uses the corresponding string-literal union type.

### Export groups

| Export group | Public items |
| --- | --- |
| Facade object | `db` |
| Named CRUD functions | `init`, `createTable`, `deleteTable`, `hasTable`, `listTables`, `insert`, `overwrite`, `read`, `findOne`, `findMany`, `update`, `remove`, `clearTable`, `countTable`, `verifyCountTable`, `bulkWrite`, `migrateToChunked` |
| Transaction functions | `beginTransaction`, `commit`, `rollback` |
| Config exports | `configManager`, `ConfigManager` |
| Monitoring exports | `performanceMonitor` |
| Crypto helpers | `encrypt`, `decrypt`, `encryptBulk`, `decryptBulk`, `hash`, `resetMasterKey`, `getKeyCacheStats`, `getKeyCacheHitRate`, `CryptoService` |
| Error exports | `StorageError`, `StorageErrorCode`, `CryptoError` |
| Type exports | `CreateTableOptions`, `ReadOptions`, `WriteOptions`, `WriteResult`, `CommonOptions`, `TableOptions`, `FindOptions`, `FilterCondition`, `LiteStoreConfig`, `DeepPartial`, `StorageErrorCode` |
| Advanced plain adapter access | `plainStorage` |

### `db` facade vs named exports

The following calls are equivalent:

```ts
import { db, createTable } from 'expo-lite-data-store';

await db.createTable('users');
await createTable('profiles');
```

Use whichever style matches the host application's coding style. The facade and the named functions share the same implementation.

## Common Types

### `CommonOptions`

```ts
type CommonOptions = {
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
};
```

These flags decide which storage surface the call is routed to.

- `encrypted: true` selects the encrypted adapter surface.
- `requireAuthOnAccess: true` implies an encrypted surface and requests strict per-access authentication semantics.

### `WriteResult`

```ts
type WriteResult = {
  written: number;
  totalAfterWrite: number;
  chunked: boolean;
  chunks?: number;
};
```

Current runtime behavior:

- `written` is the number of records written or affected by the operation;
- `totalAfterWrite` is the total row count after the operation;
- `chunked` reflects the resulting table storage mode.

### `CreateTableOptions`

```ts
type CreateTableOptions = CommonOptions & {
  columns?: Record<string, string>;
  intermediates?: boolean;
  chunkSize?: number;
  initialData?: Record<string, any>[];
  mode?: 'single' | 'chunked';
  encryptedFields?: string[];
  encryptFullTable?: boolean;
};
```

Supported column types in current runtime validation:

- `string`
- `number`
- `boolean`
- `date`
- `blob`

### `ReadOptions`

```ts
type ReadOptions = CommonOptions & {
  skip?: number;
  limit?: number;
  filter?: FilterCondition;
  sortBy?: string | string[];
  order?: 'asc' | 'desc' | ('asc' | 'desc')[];
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  bypassCache?: boolean;
};
```

Important distinction:

- the public top-level `read()` call strips query-oriented fields and acts as a raw table read;
- query-oriented reads should use `findMany()` instead.

### `WriteOptions`

```ts
type WriteOptions = CommonOptions & {
  mode?: 'append' | 'overwrite';
  forceChunked?: boolean;
  encryptFullTable?: boolean;
};
```

### `FilterCondition`

```ts
type FilterCondition =
  | ((item: Record<string, any>) => boolean)
  | Partial<Record<string, any>>
  | { $or?: FilterCondition[]; $and?: FilterCondition[] };
```

Although the internal query engine supports function filters, the typed public `findOne()` and `findMany()` APIs are documented around object-based `where` conditions. Use object conditions for stable public compatibility.

## Initialization

### `init(options?)`

```ts
await init();
await init({ encrypted: true });
```

Behavior:

- idempotent;
- optional;
- selects the adapter surface implied by `encrypted` and `requireAuthOnAccess`;
- forces lazy services and storage paths to initialize before the first business operation.

Use `init()` when:

- you want startup failures to happen eagerly instead of during the first real CRUD call;
- you want to preflight the encrypted surface before the user reaches a secure workflow.

## Table Management API

### `createTable(tableName, options?)`

```ts
await createTable('users', {
  columns: {
    id: 'string',
    email: 'string',
    age: 'number',
    active: 'boolean',
  },
  mode: 'single',
  encrypted: true,
  encryptedFields: ['email'],
});
```

Behavior:

- creates metadata and the initial table storage;
- validates column types;
- can seed `initialData`;
- can start in `single` or `chunked` mode;
- can apply field-level or full-table encryption options.

### `deleteTable(tableName, options?)`

```ts
await deleteTable('users');
```

Behavior:

- removes the table file or chunk directory;
- clears index metadata associated with the table;
- removes table metadata.

### `hasTable(tableName, options?)`

```ts
const exists = await hasTable('users');
```

Returns `true` if table metadata exists for the selected surface.

### `listTables(options?)`

```ts
const tables = await listTables();
```

Returns every known table for the selected surface.

### `countTable(tableName, options?)`

```ts
const count = await countTable('users');
```

Reads the current count from metadata. This is the fast-path count API.

### `verifyCountTable(tableName, options?)`

```ts
const result = await verifyCountTable('users');
// { metadata: number, actual: number, match: boolean }
```

Use this only for diagnosis or maintenance:

- it compares metadata count to actual stored rows;
- it repairs metadata if a mismatch is detected;
- it is more expensive than `countTable()`.

### `migrateToChunked(tableName, options?)`

```ts
await migrateToChunked('audit-log');
```

Moves an existing table into chunked storage mode. Use this when a table has outgrown practical single-file behavior.

## Write API

### `insert(tableName, data, options?)`

```ts
await insert('users', { id: '1', name: 'Alice' });

await insert('users', [
  { id: '2', name: 'Bob' },
  { id: '3', name: 'Carol' },
]);
```

Behavior:

- always appends logically;
- accepts one record or an array of records;
- returns `WriteResult`.

### `overwrite(tableName, data, options?)`

```ts
await overwrite('users', [
  { id: '1', name: 'Alice v2' },
]);
```

Behavior:

- replaces the logical table contents;
- does not preserve rows that are not present in the new payload.

### `bulkWrite(tableName, operations, options?)`

```ts
await bulkWrite('users', [
  { type: 'insert', data: { id: '4', name: 'Dan' } },
  { type: 'update', data: { $set: { active: true } }, where: { id: '2' } },
  { type: 'delete', where: { active: false } },
]);
```

Operation forms:

```ts
type BulkOperation =
  | { type: 'insert'; data: Record<string, any> | Record<string, any>[] }
  | { type: 'update'; data: Record<string, any>; where: Record<string, any> }
  | { type: 'delete'; where: Record<string, any> };
```

Behavior:

- preserves operation order;
- supports pure insert fast-path optimization internally;
- can run inside a transaction;
- returns a `WriteResult` whose `written` count reflects affected records under current runtime behavior.

## Read and Query API

### `read(tableName, options?)`

```ts
const rows = await read('users');
```

Use `read()` only when you need the full stored dataset. The public implementation strips:

- `filter`
- `skip`
- `limit`
- `sortBy`
- `order`
- `sortAlgorithm`

If you need filtering, pagination, or sorting, use `findMany()`.

### `findOne(tableName, options)`

```ts
const user = await findOne('users', {
  where: { id: '1' },
});
```

Signature shape:

```ts
findOne(tableName, {
  where: Record<string, any>;
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
})
```

Returns the first matching record or `null`.

### `findMany(tableName, options?)`

```ts
const users = await findMany('users', {
  where: {
    $and: [
      { active: true },
      { age: { $gte: 18 } },
    ],
  },
  sortBy: ['age', 'name'],
  order: ['desc', 'asc'],
  limit: 20,
});
```

Signature shape:

```ts
findMany(tableName, {
  where?: Record<string, any>;
  skip?: number;
  limit?: number;
  sortBy?: string | string[];
  order?: 'asc' | 'desc' | Array<'asc' | 'desc'>;
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
})
```

#### Supported query operators

| Operator | Semantics | Example |
| --- | --- | --- |
| `$and` | All nested conditions must match | `{ $and: [{ active: true }, { age: { $gte: 18 } }] }` |
| `$or` | Any nested condition may match | `{ $or: [{ role: 'admin' }, { role: 'moderator' }] }` |
| `$eq` | Exact equality | `{ age: { $eq: 21 } }` |
| `$ne` | Not equal | `{ status: { $ne: 'archived' } }` |
| `$gt` | Greater than | `{ price: { $gt: 100 } }` |
| `$gte` | Greater than or equal | `{ score: { $gte: 90 } }` |
| `$lt` | Less than | `{ stock: { $lt: 10 } }` |
| `$lte` | Less than or equal | `{ retries: { $lte: 3 } }` |
| `$in` | Included in a set | `{ role: { $in: ['admin', 'editor'] } }` |
| `$nin` | Excluded from a set | `{ status: { $nin: ['deleted', 'blocked'] } }` |
| `$like` | SQL-style pattern matching | `{ email: { $like: '%@example.com' } }` |

#### Sorting notes

`sortAlgorithm` currently accepts:

- `default`
- `fast`
- `counting`
- `merge`
- `slow`

If you do not force an algorithm, the runtime may choose a more suitable one based on dataset size and sort shape.

## Update and Delete API

### `update(tableName, data, options)`

```ts
const updatedCount = await update(
  'users',
  { active: false },
  { where: { id: '1' } }
);
```

Operator-driven update:

```ts
const updatedCount = await update(
  'accounts',
  { $inc: { balance: -200 } },
  { where: { id: 'acct-1' } }
);
```

Returns the number of matched records updated.

#### Supported update operators

| Operator | Semantics | Example |
| --- | --- | --- |
| `$inc` | Increment or decrement numeric values | `{ $inc: { balance: -200 } }` |
| `$set` | Assign explicit values | `{ $set: { status: 'active' } }` |
| `$unset` | Remove fields | `{ $unset: ['temporaryField'] }` |
| `$push` | Push a single value into an array | `{ $push: { tags: 'new' } }` |
| `$pull` | Remove a matching value from an array | `{ $pull: { tags: 'obsolete' } }` |
| `$addToSet` | Push only if absent | `{ $addToSet: { tags: 'admin' } }` |

Direct field assignment without an operator is also valid and is treated as a replace-on-field update.

### `remove(tableName, options)`

```ts
const removed = await remove('users', {
  where: { active: false },
});
```

Returns the number of removed records.

### `clearTable(tableName, options?)`

```ts
await clearTable('users');
```

Removes all rows from the table while keeping the table definition itself.

## Transaction API

### `beginTransaction(options?)`

```ts
await beginTransaction();
```

Starts a transaction on the selected adapter surface.

### `commit(options?)`

```ts
await commit();
```

Flushes all queued transactional operations.

### `rollback(options?)`

```ts
await rollback();
```

Discards the active transaction.

### Transaction semantics

- Transactions are not nested.
- Starting a second transaction before ending the first raises `TRANSACTION_IN_PROGRESS`.
- Calling `commit()` or `rollback()` with no active transaction raises `NO_TRANSACTION_IN_PROGRESS`.
- The surface is selected by the same `encrypted` and `requireAuthOnAccess` flags used by normal CRUD calls.

## Configuration API

### `configManager`

```ts
import { configManager } from 'expo-lite-data-store';
```

Public methods:

#### `configManager.getConfig()`

Returns the fully merged runtime configuration.

#### `configManager.setConfig(partialConfig)`

Replaces the current programmatic override object and reloads the merged config.

#### `configManager.updateConfig(partialConfig)`

Deep-merges the provided override into the current programmatic config and reloads.

```ts
configManager.updateConfig({
  storageFolder: 'my-app-store',
  performance: {
    maxConcurrentOperations: 8,
  },
});
```

#### `configManager.resetConfig()`

Drops programmatic overrides and returns to merged defaults plus non-programmatic sources.

#### `configManager.get(path)`

Retrieves a nested value by dot path.

```ts
const folder = configManager.get<string>('storageFolder');
const iterations = configManager.get<number>('encryption.keyIterations');
```

#### `configManager.set(path, value)`

Sets a nested override by dot path.

```ts
configManager.set('monitoring.enablePerformanceTracking', true);
```

### Runtime config sources

Current precedence from lowest to highest:

1. built-in defaults
2. environment variables
3. Expo runtime config from `app.json` / `app.config.*`
4. `global.liteStoreConfig`
5. programmatic config manager overrides

### `app.json` example

```json
{
  "expo": {
    "extra": {
      "liteStore": {
        "chunkSize": 8388608,
        "storageFolder": "my-app-store",
        "performance": {
          "maxConcurrentOperations": 8
        },
        "autoSync": {
          "enabled": true,
          "interval": 15000,
          "minItems": 1,
          "batchSize": 100
        }
      }
    }
  }
}
```

## Monitoring API

### `performanceMonitor`

```ts
import { performanceMonitor } from 'expo-lite-data-store';
```

This export is intended for advanced users, profiling, and maintainers. It is not required for normal CRUD usage.

Common methods:

#### `performanceMonitor.configure(options)`

```ts
performanceMonitor.configure({
  enabled: true,
  sampleRate: 1,
  maxRecords: 500,
  thresholds: {
    minSuccessRate: 95,
    maxAverageDuration: 500,
  },
});
```

#### `performanceMonitor.getMetrics(filter?)`

Returns raw metric samples, optionally filtered by:

- `operation`
- `group`
- `channel`
- `profile`
- `provider`

#### `performanceMonitor.getOperationStats(operation?)`

Returns aggregated stats for one operation or a map grouped by operation name.

#### `performanceMonitor.getGroupStats(group?)`

Returns aggregated stats for one group or a map grouped by group name.

#### `performanceMonitor.getOverallStats()`

Returns total operations, success rate, p50, p95, p99, and throughput.

#### `performanceMonitor.performHealthCheck()`

Returns a `HealthCheckResult` that evaluates metrics against the configured thresholds.

Other available control methods:

- `getThresholds()`
- `getSampleRate()`
- `clear()`
- `setEnabled(enabled)`
- `isEnabled()`
- `resetRuntimeOptions()`
- `destroy()`

## Crypto Helpers

### Named crypto exports

```ts
import {
  encrypt,
  decrypt,
  encryptBulk,
  decryptBulk,
  hash,
  resetMasterKey,
  getKeyCacheStats,
  getKeyCacheHitRate,
} from 'expo-lite-data-store';
```

Current helper set:

- `encrypt(plainText, masterKey)`
- `decrypt(cipherText, masterKey)`
- `encryptBulk(values, masterKey)`
- `decryptBulk(values, masterKey)`
- `hash(data, algorithm?)`
- `resetMasterKey()`
- `getKeyCacheStats()`
- `getKeyCacheHitRate()`

### Security notes

- the default `encryption.algorithm` is `auto`, and current runtime behavior routes new writes through the `AES-GCM` path unless the caller explicitly selects `AES-CTR`;
- `AES-CTR` exists for explicit configuration and legacy compatibility;
- `requireAuthOnAccess: true` is strict and throws `AUTH_ON_ACCESS_UNSUPPORTED` if the runtime cannot truly enforce per-access authentication;
- Expo Go supports regular encrypted storage but not strict biometric or per-access authentication guarantees.

## Errors and Failure Semantics

### `StorageError`

```ts
try {
  await db.findMany('users', { encrypted: true, requireAuthOnAccess: true });
} catch (error) {
  if (error instanceof StorageError) {
    console.log(error.code);
    console.log(error.category);
    console.log(error.details);
    console.log(error.suggestion);
  }
}
```

`StorageError` contains:

- `message`
- `code`
- `category`
- `details`
- `suggestion`
- `timestamp`
- `cause`

### Common `StorageErrorCode` values

| Code | Meaning |
| --- | --- |
| `EXPO_MODULE_MISSING` | Required Expo runtime package is missing |
| `AUTH_ON_ACCESS_UNSUPPORTED` | Strict per-access authentication cannot be enforced in the current runtime |
| `TABLE_NOT_FOUND` | The requested table does not exist |
| `TABLE_NAME_INVALID` | The table name is empty or invalid |
| `TABLE_COLUMN_INVALID` | A declared column uses an unsupported type |
| `QUERY_FAILED` | The query engine failed to execute the condition |
| `MIGRATION_FAILED` | Table migration failed |
| `TRANSACTION_IN_PROGRESS` | A transaction already exists on the current surface |
| `NO_TRANSACTION_IN_PROGRESS` | `commit()` or `rollback()` was called with no active transaction |
| `LOCK_TIMEOUT` | Concurrent write lock acquisition exceeded the timeout budget |
| `TIMEOUT` | An operation exceeded a configured timeout |
| `CORRUPTED_DATA` | On-disk data could not be parsed safely |

### `CryptoError`

Crypto helper failures may raise `CryptoError` for crypto-specific fault paths.

## Advanced Exports

### `plainStorage`

`plainStorage` exposes the underlying non-encrypted adapter. This is an advanced export and should usually be reserved for debugging or low-level integration work.

### `CryptoService`

`CryptoService` is re-exported for advanced consumers that need the lower-level crypto module surface rather than the convenience helpers.

## Related Documents

- Consumer guide: [../README.md](../README.md)
- Simplified Chinese API reference: [./API.zh-CN.md](./API.zh-CN.md)
- Runtime QA guide: [./EXPO_RUNTIME_QA.md](./EXPO_RUNTIME_QA.md)
- Changelog: [./CHANGELOG.md](./CHANGELOG.md)
