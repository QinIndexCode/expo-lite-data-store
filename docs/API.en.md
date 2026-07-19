# Expo Lite Data Store API

[README Entry](../README.md) | [简体中文](./API.zh-CN.md) | [Runtime QA Guide](./EXPO_RUNTIME_QA.en.md) | [Changelog](./CHANGELOG.en.md)

## Scope of this reference

This document is the detailed API reference for the current `3.x` public surface. It covers:

- the supported install contract;
- the exported facade and named functions;
- table creation, reads, writes, query semantics, and transactions;
- configuration and monitoring helpers;
- crypto helpers, exported error types, and common runtime failure codes.

For a narrative setup guide, start with [README.en.md](../README.en.md). For maintainer release evidence and runtime verification lanes, use [EXPO_RUNTIME_QA.en.md](./EXPO_RUNTIME_QA.en.md).

## v3 Migration

`plainStorage` and package deep imports (`expo-lite-data-store/dist/js/...` or `dist/cjs/...`) are no longer public. Use the root `db` facade or named APIs imported from `expo-lite-data-store`. A table created with `encrypted: true` must be accessed with `encrypted: true` on every table operation; requests that select the plain surface fail closed.

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
import { db, configManager, performanceMonitor, StorageError, StorageErrorCode } from 'expo-lite-data-store';
```

`StorageErrorCode` is available as a runtime constant map, and the `StorageError.code` field uses the corresponding string-literal union type.

### Export groups

| Export group          | Public items                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Facade object         | `db`                                                                                                                                                                                                                                                                                                                                                                           |
| Named CRUD functions  | `init`, `createTable`, `deleteTable`, `hasTable`, `listTables`, `insert`, `overwrite`, `read`, `findOne`, `findMany`, `update`, `remove`, `clearTable`, `countTable`, `verifyCountTable`, `bulkWrite`, `migrateToChunked`                                                                                                                                                      |
| Transaction functions | `beginTransaction`, `commit`, `rollback`                                                                                                                                                                                                                                                                                                                                       |
| Config exports        | `configManager`, `ConfigManager`                                                                                                                                                                                                                                                                                                                                               |
| Monitoring exports    | `performanceMonitor`; type-only `PerformanceStats`, `HealthCheckResult`                                                                                                                                                                                                                                                                                                        |
| Crypto helpers        | `encrypt`, `decrypt`, `encryptBulk`, `decryptBulk`, `hash`, `resetMasterKey`, `getKeyCacheStats`, `getKeyCacheHitRate`, `CryptoService`; type-only `KeyCacheStats`                                                                                                                                                                                                             |
| Error exports         | `StorageError`, `StorageErrorCode`, `CryptoError`                                                                                                                                                                                                                                                                                                                              |
| Type exports          | `CreateTableOptions`, `ReadOptions`, `WriteOptions`, `WriteResult`, `CommonOptions`, `TableOptions`, `FindOptions`, `FindOneOptions`, `FindManyOptions`, `UpdateOptions`, `FilterCondition`, `BulkOperation`, `StorageInput`, `StorageRecord`, `UpdatePayload`, `LiteStoreConfig`, `DeepPartial`, `StorageErrorCode`, `PerformanceStats`, `HealthCheckResult`, `KeyCacheStats` |

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

Strict tables are bound to that authentication key scope. A regular encrypted surface cannot access a strict table, and a strict surface cannot reinterpret an existing regular encrypted table. Move existing data through an application-controlled migration to a newly created strict table before retiring the regular table and key.

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

### Typed Records and `CreateTableOptions`

Record-oriented APIs are generic. Supply a named record type when you want field completion, while schema-less tables can use the default `StorageRecord`.

```ts
type StorageRecord = Record<string, unknown>;
type StorageInput<T extends object = StorageRecord> = T | T[];
type ColumnDefinition =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'blob'
  | { type: 'string' | 'number' | 'boolean' | 'date' | 'blob'; isHighRisk?: boolean };

type CreateTableOptions<T extends object = StorageRecord> = CommonOptions & {
  columns?: Record<string, ColumnDefinition>;
  intermediates?: boolean;
  chunkSize?: number;
  initialData?: T[];
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
type ReadOptions<T extends object = StorageRecord> = CommonOptions & {
  skip?: number;
  limit?: number;
  filter?: FilterCondition<T>;
  sortBy?: SortField<T> | SortField<T>[];
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
type FilterCondition<T extends object = StorageRecord> =
  | ((item: T) => boolean)
  | Partial<T>
  | StorageRecord
  | { $or?: FilterCondition<T>[]; $and?: FilterCondition<T>[] };
```

Although the internal query engine supports function filters, the typed public `findOne()` and `findMany()` APIs are documented around object-based `where` conditions. Use object conditions for stable public compatibility.

Records may include `id` or `_id`, but they are not required. When a `where` condition is supplied, update, delete, bulk, and transaction paths apply changes to the matched row objects instead of guessing identity from missing identifiers. In-memory indexes use a string or finite-number `id` first and fall back to `_id` only when `id` is unavailable or unstable. If any row covered by an index has neither form, that index is marked unsuitable for query acceleration and reads fall back to full filtering.

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

> **Transaction boundary:** On the active transaction owner's matching storage surface, public `createTable()`, `deleteTable()`, and `migrateToChunked()` calls persist schema metadata or files directly and are rejected with `TRANSACTION_OPERATION_NOT_SUPPORTED`; commit or roll back first. A different adapter or security surface is rejected by the normal transaction guard before this DDL-specific code. This does not prevent a staged data write from implicitly creating a table during its eventual commit.

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
- can apply field-level or full-table encryption options;
- persists table metadata immediately after creation.

A non-empty `encryptedFields` list makes `createTable()` select the encrypted facade even when `encrypted: true` is omitted. An encrypted write can implicitly create a previously unknown table; inside a transaction, its resolved field list is carried into commit, and the selected policy is persisted. For an existing encrypted table, `encrypted`, `encryptFullTable`, `encryptedFields`, and `requireAuthOnAccess` are policy inputs, not in-place mutation commands. A conflicting request fails with `MIGRATION_FAILED` and must be handled by an application-controlled migration; a non-strict adapter that requests strict access fails with `PERMISSION_DENIED` rather than substituting a key.

When explicit field-level table creation omits `encryptedFields`, a non-empty creation-time configured list is deduplicated and snapshotted into table metadata. If that configured list is empty, or the caller explicitly passes `encryptedFields: []`, a newly created table persists the exact pair `encryptAllFields: true` and `encryptedFields: []` as its dynamic all-fields policy, so fields introduced by later record shapes are also encrypted. Metadata written by earlier v3 releases has no internal all-fields marker; an empty or missing legacy list keeps the historical global-configuration fallback so mixed ciphertext/plaintext records are not reinterpreted. Migrate a legacy table explicitly before changing that behavior.

Full-table encryption stores one physical envelope while metadata tracks the logical row count. The envelope, logical count, and storage generation are published together for normal and transactional writes; a transaction rollback restores the captured logical count with the physical snapshot rather than repairing it in a second metadata step. The optional decrypted full-table cache is valid only for the exact source ciphertext and is disabled when its timeout is zero.

### `deleteTable(tableName, options?)`

```ts
await deleteTable('users');
```

Behavior:

- commits removal of table metadata before physical cleanup;
- restores the original metadata and leaves physical data untouched if that commit fails;
- clears in-memory indexes and removes the table file, chunk directory, recovery journals, and overwrite backup after the commit;
- treats durable metadata absence as authoritative, so leftover files cannot revive a deleted table;
- keeps the table logically absent if physical cleanup fails and allows a later `deleteTable()` call to retry; same-name creation purges all orphaned table artifacts first.

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

If any table uses `requireAuthOnAccess: true`, both `listTables()` and `listTables({ encrypted: true })` fail with `PERMISSION_DENIED` to avoid exposing strict-table metadata. Only an authorized caller should retry:

```ts
const tables = await listTables({ encrypted: true, requireAuthOnAccess: true });
```

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

Moves an existing table into chunked storage mode. Use this when a table has outgrown practical single-file behavior. The migration keeps column, risk, and encryption metadata; encrypted rows are moved in their stored form instead of passing through a decrypted rewrite window. It publishes and verifies all chunks before committing the metadata mode change. That mode change is the commit point; obsolete single-file cleanup after it cannot roll the committed representation back.

Chunked overwrites use a bounded v2 journal containing previous count/chunk state rather than old row payloads. Existing chunks move to `<table>.overwrite-backup/`; a `.ready` marker identifies a fully prepared backup. Removing the overwrite journal is the commit point. If backup cleanup then fails, a later access verifies the committed chunk set before deleting the leftover backup. Appends use a separate journal; if an append fails after new chunks were written, the runtime removes those partial chunks and leaves the previous table readable. Recovery resolves a pending append before a pending overwrite, and validates journal envelopes and complete chunk sets before returning data.

Single-file publication uses a table-bound v2 commit marker containing previous/target storage tokens, hashes, and physical counts. Recovery resolves the durable metadata token directly from disk. Canonical v1 markers remain compatible; temporary evidence must be a v2 `committed` marker whose table name, target token, primary hash, and physical count all match, or recovery fails closed. Outside marker recovery, a missing or damaged data primary can be restored only from a valid data backup.

Metadata publication has a stricter backup rule: only a missing primary may be restored from a valid metadata backup. An existing but unreadable or malformed primary fails closed instead of using a potentially stale backup, and publication/recovery succeeds only after the stale backup is removed. Updates/deletes are conditional on the table's `createdAt` generation, while creation is conditional on the name still being absent. A shared mutation epoch makes other adapters refresh metadata, representation mode, cache namespaces, and indexes; bounded stable reads retry if the generation changes.

File handlers serialize operations for the same physical table path through an in-process FIFO queue shared across handler instances. Acquisition waits at most 30 seconds, and this mechanism does not provide cross-process locking. A recoverable mutation that crosses its deadline is observed until the underlying non-cancellable operation settles, then rolled back before the path lock is released.

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
await overwrite('users', [{ id: '1', name: 'Alice v2' }]);
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
type UpdateOperatorPayload = {
  $inc?: Record<string, number>;
  $set?: StorageRecord;
  $unset?: string[];
  $push?: StorageRecord;
  $pull?: StorageRecord;
  $addToSet?: StorageRecord;
};

type UpdatePayload<T extends object = StorageRecord> = Partial<T> | UpdateOperatorPayload | StorageRecord;

type BulkOperation<T extends object = StorageRecord> =
  | { type: 'insert'; data: StorageInput<T> }
  | { type: 'update'; data: UpdatePayload<T>; where: FilterCondition<T> }
  | { type: 'delete'; where: FilterCondition<T> };
```

Behavior:

- preserves operation order;
- supports pure insert fast-path optimization internally;
- can run inside a transaction;
- matches update and delete operations by the supplied `where` condition, including rows without `id` fields;
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
findOne<T extends object = StorageRecord>(tableName, {
  where: FilterCondition<T>;
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
}): Promise<T | null>
```

Returns the first matching record or `null`.

### `findMany(tableName, options?)`

```ts
const users = await findMany('users', {
  where: {
    $and: [{ active: true }, { age: { $gte: 18 } }],
  },
  sortBy: ['age', 'name'],
  order: ['desc', 'asc'],
  limit: 20,
});
```

Signature shape:

```ts
findMany<T extends object = StorageRecord>(tableName, {
  where?: FilterCondition<T>;
  skip?: number;
  limit?: number;
  sortBy?: SortField<T> | SortField<T>[];
  order?: 'asc' | 'desc' | Array<'asc' | 'desc'>;
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
}): Promise<T[]>
```

`skip` and `limit` must be non-negative safe integers. `limit: 0` returns an empty page. Negative, fractional, non-finite, and unsafe values throw a `RangeError` rather than being coerced by array slicing. This input-validation error reaches the caller unchanged rather than being wrapped as a `StorageError`.

#### Supported query operators

| Operator | Semantics                        | Example                                               |
| -------- | -------------------------------- | ----------------------------------------------------- |
| `$and`   | All nested conditions must match | `{ $and: [{ active: true }, { age: { $gte: 18 } }] }` |
| `$or`    | Any nested condition may match   | `{ $or: [{ role: 'admin' }, { role: 'moderator' }] }` |
| `$eq`    | Exact equality                   | `{ age: { $eq: 21 } }`                                |
| `$ne`    | Not equal                        | `{ status: { $ne: 'archived' } }`                     |
| `$gt`    | Greater than                     | `{ price: { $gt: 100 } }`                             |
| `$gte`   | Greater than or equal            | `{ score: { $gte: 90 } }`                             |
| `$lt`    | Less than                        | `{ stock: { $lt: 10 } }`                              |
| `$lte`   | Less than or equal               | `{ retries: { $lte: 3 } }`                            |
| `$in`    | Included in a set                | `{ role: { $in: ['admin', 'editor'] } }`              |
| `$nin`   | Excluded from a set              | `{ status: { $nin: ['deleted', 'blocked'] } }`        |
| `$like`  | SQL-style pattern matching       | `{ email: { $like: '%@example.com' } }`               |

#### Sorting notes

`sortAlgorithm` currently accepts:

- `default`
- `fast`
- `counting`
- `merge`
- `slow`

If you do not force an algorithm, the runtime may choose a more suitable one based on dataset size and sort shape.

Every supported algorithm keeps `null` and `undefined` values stable at the end in both ascending and descending order.

## Update and Delete API

### `update(tableName, data, options)`

```ts
const updatedCount = await update('users', { active: false }, { where: { id: '1' } });
```

Operator-driven update:

```ts
const updatedCount = await update('accounts', { $inc: { balance: -200 } }, { where: { id: 'acct-1' } });
```

Returns the number of matched records updated.

#### Supported update operators

| Operator    | Semantics                             | Example                            |
| ----------- | ------------------------------------- | ---------------------------------- |
| `$inc`      | Increment or decrement numeric values | `{ $inc: { balance: -200 } }`      |
| `$set`      | Assign explicit values                | `{ $set: { status: 'active' } }`   |
| `$unset`    | Remove fields                         | `{ $unset: ['temporaryField'] }`   |
| `$push`     | Push a single value into an array     | `{ $push: { tags: 'new' } }`       |
| `$pull`     | Remove a matching value from an array | `{ $pull: { tags: 'obsolete' } }`  |
| `$addToSet` | Push only if absent                   | `{ $addToSet: { tags: 'admin' } }` |

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
- The transaction owner sees staged mutations through `read()`, `countTable()`, `findOne()`, and `findMany()`. Query filtering, sorting, and pagination run against that staged view, and `remove()` returns its matched-row count from the same view.
- Queued serializable record payloads, object-based query values, and transaction query results are isolated from later caller-side mutation. Callback predicates retain their own closure semantics.
- On the active transaction owner's matching storage surface, public `createTable()`, `deleteTable()`, and `migrateToChunked()` calls are not transactional and raise `TRANSACTION_OPERATION_NOT_SUPPORTED`, because their schema metadata or file changes persist immediately. A different adapter or security surface is rejected by the normal transaction guard first.
- Explicit rollback discards queued operations without rewriting table files. A partially failed commit restores existing table snapshots and removes tables created by that transaction.
- Commit execution and failed-commit snapshot restoration use a module-private symbol capability for direct writes. Adding a public `directWrite` property to options cannot bypass transaction staging.
- AutoSync retains dirty entries and performs no storage write while a transaction is active. A later scheduled or explicit sync may flush them after the transaction settles.
- Transactions are in-process and are not crash-durable or cross-process ACID transactions.

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

`storageFolder` accepts one directory name only; path separators, encoded separators, and traversal names are rejected. Configure it before the first storage operation. Changing it while an adapter is active is rejected to prevent metadata or cached state from crossing storage roots.

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

1. built-in defaults;
2. supported `LITE_STORE_*` environment variables;
3. one Expo runtime configuration source; and
4. programmatic config manager overrides.

The runtime configuration layer is not a merge of every host source. In an Expo, React Native, or test runtime, the loader uses the first available source in this order: `global.__expoConfig.extra.liteStore`, `expo-constants` (`getConfig()`, `expoConfig`, `manifest`, or `extra`), `global.expo.extra.liteStore`, then `global.liteStoreConfig` as a fallback.

### Logger environment controls

`EXPO_LITE_DATA_STORE_LOG_LEVEL` accepts `silent`, `error`, `warn`, `info`, or `debug`. Non-test runtimes default to `warn`. Tests default to `silent`; set `EXPO_LITE_DATA_STORE_TEST_LOGS=1` to enable `debug` output while diagnosing a test. These variables control the internal logger and are not `configManager` keys.

### `app.json` example

`autoSync.enabled` is `false` by default. The following example opts into background dirty-cache syncing explicitly. `autoSync.batchSize` limits the number of dirty cache entries processed for each table in one sync run; it does not split a single table overwrite into record-level writes. Sync attempts made during an active transaction retain their dirty entries for a later scheduled or explicit sync.

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
- `decryptBulk()` detects legacy CTR and current GCM payloads per item, decrypts each provider group in bulk, and returns results in the original input order, including mixed-format batches;
- `requireAuthOnAccess: true` is strict and throws `AUTH_ON_ACCESS_UNSUPPORTED` if the runtime cannot truly enforce per-access authentication;
- a strict key scope is never silently derived from or substituted for a regular master key; attempting an in-place strict upgrade, switching field-level/full-table encryption, or changing encrypted fields for existing encrypted data fails with `MIGRATION_FAILED` until the application migrates and verifies the data explicitly;
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

`StorageError` instances with a `TRANSACTION_*` code or `NO_TRANSACTION_IN_PROGRESS` use `category: 'transaction'`.

### Common `StorageErrorCode` values

| Code                                  | Meaning                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `EXPO_MODULE_MISSING`                 | Required Expo runtime package is missing                                                                               |
| `AUTH_ON_ACCESS_UNSUPPORTED`          | Strict per-access authentication cannot be enforced in the current runtime                                             |
| `PERMISSION_DENIED`                   | A request selected a weaker storage surface than the table's encryption or strict-authentication policy                |
| `TABLE_NOT_FOUND`                     | The requested table does not exist                                                                                     |
| `TABLE_NAME_INVALID`                  | The table name is empty or invalid                                                                                     |
| `TABLE_COLUMN_INVALID`                | A declared column uses an unsupported type                                                                             |
| `QUERY_FAILED`                        | The query engine failed to execute the condition                                                                       |
| `MIGRATION_FAILED`                    | Table migration failed, or an existing encryption/strict-authentication policy requires an explicit key/data migration |
| `TRANSACTION_IN_PROGRESS`             | A transaction already exists on the current surface                                                                    |
| `NO_TRANSACTION_IN_PROGRESS`          | `commit()` or `rollback()` was called with no active transaction                                                       |
| `TRANSACTION_OPERATION_NOT_SUPPORTED` | An active transaction cannot perform a public schema operation that persists immediately                               |
| `LOCK_TIMEOUT`                        | Concurrent write lock acquisition exceeded the timeout budget                                                          |
| `TIMEOUT`                             | An operation exceeded a configured timeout                                                                             |
| `CORRUPTED_DATA`                      | On-disk data could not be parsed safely                                                                                |

### `CryptoError`

Crypto helper failures may raise `CryptoError` for crypto-specific fault paths.

## Advanced Exports

### `CryptoService`

`CryptoService` is re-exported for advanced consumers that need the lower-level crypto module surface rather than the convenience helpers.

## Related Documents

- Consumer guide: [../README.en.md](../README.en.md)
- Simplified Chinese API reference: [./API.zh-CN.md](./API.zh-CN.md)
- Runtime QA guide: [./EXPO_RUNTIME_QA.en.md](./EXPO_RUNTIME_QA.en.md)
- Changelog: [./CHANGELOG.en.md](./CHANGELOG.en.md)
