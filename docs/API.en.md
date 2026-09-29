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

The ban covers literal `dist/...` file paths and the removed `plainStorage` export only. The `package.json` `exports` subpaths `./js`, `./cjs`, and `./utils/*` remain supported compatibility spellings that resolve to the same built files; prefer the root entrypoint for new code.

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

### Supported subpath imports

```ts
import { db } from 'expo-lite-data-store/js';
import { db } from 'expo-lite-data-store/cjs';
import { randomBytes } from 'expo-lite-data-store/utils/cryptoProvider';
```

`./js` and `./cjs` expose the same builds as the root entrypoint's `import` and `require` conditions respectively (ESM via `./js`, CJS via `./cjs`), and `./utils/*` exposes internal utility modules such as the crypto provider. These subpaths exist for bundler and interop compatibility; new code should import from the package root.

### Export groups

| Export group                     | Public items                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Facade object                    | `db`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Named CRUD functions             | `init`, `createTable`, `deleteTable`, `hasTable`, `listTables`, `insert`, `overwrite`, `read`, `findOne`, `findMany`, `update`, `remove`, `clearTable`, `countTable`, `verifyCountTable`, `bulkWrite`, `migrateToChunked`, `createIndex`, `dropIndex`, `migrateEngine`                                                                                                                                                                                                   |
| Transaction functions            | `beginTransaction`, `commit`, `rollback`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Engine Migration                 | `migrateEngine`, `EngineMigrationService`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Config exports                   | `configManager`, `ConfigManager`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Monitoring exports               | `performanceMonitor`; type-only `PerformanceStats`, `HealthCheckResult`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Crypto helpers                   | `encrypt`, `decrypt`, `encryptBulk`, `decryptBulk`, `hash`, `resetMasterKey`, `getKeyCacheStats`, `getKeyCacheHitRate`, `CryptoService`; type-only `KeyCacheStats`                                                                                                                                                                                                                                                                                                       |
| Error exports                    | `StorageError`, `StorageErrorCode`, `CryptoError`, `TransactionError`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Type exports                     | `CreateTableOptions`, `ReadOptions`, `WriteOptions`, `WriteResult`, `CommonOptions`, `TableOptions`, `FindOptions`, `FindOneOptions`, `FindManyOptions`, `UpdateOptions`, `FilterCondition`, `BulkOperation`, `StorageInput`, `StorageRecord`, `UpdatePayload`, `LiteStoreConfig`, `DeepPartial`, `StorageErrorCode`, `PerformanceStats`, `HealthCheckResult`, `KeyCacheStats`, `MigrateEngineOptions`, `MigrationResult`, type-only `IStorageAdapter`, `IStorageEngine` |
| Type exports (table catalog)     | `Catalog`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Type exports (column definition) | `ColumnDefinition`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Type exports (sort field)        | `SortField`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Type exports (sort order)        | `SortOrder`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Type exports (sort algorithm)    | `SortAlgorithm`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Type exports (table metadata)    | `TableMeta`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
  chunkSize?: number;
  initialData?: T[];
  mode?: 'single' | 'chunked';
  encryptedFields?: string[];
  encryptFullTable?: boolean;
  indexes?: (string | { field: string; unique?: boolean })[];
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

- the public top-level `read()` call strips query-oriented fields and returns the stored rows without server-side filtering, sorting, or pagination; cache (`bypassCache`) and security (`encrypted`, `requireAuthOnAccess`) options still apply;
- query-oriented reads should use `findMany()` instead.

### `WriteOptions`

```ts
type WriteOptions = CommonOptions & {
  mode?: 'append' | 'overwrite';
  forceChunked?: boolean;
  encryptFullTable?: boolean;
  encryptedFields?: string[];
};
```

`encryptedFields` is this write's field-level encryption policy assertion: a non-empty list selects the encrypted facade and is persisted as the table policy when the write implicitly creates the table; a list that disagrees with an existing table's persisted policy fails with `MIGRATION_FAILED`. A write-path call (`insert`/`overwrite`/`update`/`bulkWrite`) that passes an empty `encryptedFields: []` list with no other encryption option such as `encrypted: true` is rejected with `FILE_CONTENT_INVALID`: the empty-list dynamic all-fields semantics belong to `createTable`, so write paths must pair them with `encrypted: true`.

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

A non-empty `encryptedFields` list makes `createTable()` select the encrypted facade even when `encrypted: true` is omitted. An encrypted write can implicitly create a previously unknown table; on implicit creation the write request's field list is persisted as the table policy, and inside a transaction that resolved list is carried into commit together with the selected policy. For an existing table, `encrypted`, `encryptFullTable`, `encryptedFields`, and `requireAuthOnAccess` are policy inputs, not in-place mutation commands: a write carrying `encryptedFields` against an existing plaintext table likewise fails with `MIGRATION_FAILED` instead of silently persisting plaintext. A conflicting request must be handled by an application-controlled migration; a non-strict adapter that requests strict access fails with `PERMISSION_DENIED` rather than substituting a key.

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
- it repairs metadata if a mismatch is detected, except for full-table encrypted tables on the plain surface, where the raw physical envelope count is reported without overwriting the logical count (the encrypted surface decrypts, counts logically, and repairs instead);
- it is more expensive than `countTable()`.

### `migrateToChunked(tableName, options?)`

```ts
await migrateToChunked('audit-log');
```

Moves an existing table into chunked storage mode. Use this when a table has outgrown practical single-file behavior. The migration keeps column, risk, and encryption metadata; encrypted rows are moved in their stored form instead of passing through a decrypted rewrite window. It publishes and verifies all chunks before committing the metadata mode change. That mode change is the commit point; obsolete single-file cleanup after it cannot roll the committed representation back. On the SQLite engine the storage layout needs no conversion, so the call is a no-op — but it still follows the public schema-change contract: it resolves immediately outside a transaction and is rejected with `TRANSACTION_OPERATION_NOT_SUPPORTED` while one is active.

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
- a non-empty `encryptedFields` selects the encrypted facade: a missing table is created implicitly with the requested field list, while an existing table with a different policy (including a plaintext table) fails with `MIGRATION_FAILED`;
- returns `WriteResult`.

### `overwrite(tableName, data, options?)`

```ts
await overwrite('users', [{ id: '1', name: 'Alice v2' }]);
```

Behavior:

- replaces the logical table contents;
- does not preserve rows that are not present in the new payload;
- like `insert()`, a non-empty `encryptedFields` selects the encrypted facade and persists the requested field list on implicit table creation; a policy conflict with an existing table fails with `MIGRATION_FAILED`.

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
- accepts `WriteOptions`: `encryptFullTable` and a non-empty `encryptedFields` select the encrypted surface and are honored when the write implicitly creates the table, persisting the requested field list; a policy conflict with an existing table fails with `MIGRATION_FAILED`;
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

| Operator | Semantics                                        | Example                                               |
| -------- | ------------------------------------------------ | ----------------------------------------------------- |
| `$and`   | All nested conditions must match                 | `{ $and: [{ active: true }, { age: { $gte: 18 } }] }` |
| `$or`    | Any nested condition may match                   | `{ $or: [{ role: 'admin' }, { role: 'moderator' }] }` |
| `$eq`    | Exact equality (deep equality for object values) | `{ age: { $eq: 21 } }`                                |
| `$ne`    | Not equal                                        | `{ status: { $ne: 'archived' } }`                     |
| `$gt`    | Greater than                                     | `{ price: { $gt: 100 } }`                             |
| `$gte`   | Greater than or equal                            | `{ score: { $gte: 90 } }`                             |
| `$lt`    | Less than                                        | `{ stock: { $lt: 10 } }`                              |
| `$lte`   | Less than or equal                               | `{ retries: { $lte: 3 } }`                            |
| `$in`    | Included in a set                                | `{ role: { $in: ['admin', 'editor'] } }`              |
| `$nin`   | Excluded from a set                              | `{ status: { $nin: ['deleted', 'blocked'] } }`        |
| `$like`  | SQL-style pattern matching                       | `{ email: { $like: '%@example.com' } }`               |

These operators behave identically on the `file-system` and `sqlite` engines, so the same query returns the same result set on both: the `sqlite` engine pushes a condition down to SQL only when it is equivalent to the in-memory semantics (array `$in`/`$nin` match both array elements and scalar values through `json_each`, `json_type` distinguishes a missing field from an explicit JSON `null`, and booleans are never mistaken for numbers), while conditions that cannot be expressed equivalently (such as `$like`'s Unicode case folding, or `$in`/`$nin` lists needing more than 500 bound parameters) automatically fall back to the same in-memory filtering the `file-system` engine uses.

A field path containing exactly one all-numeric segment without a leading zero (such as `a.0.c`) matches both readings at once: the array index (`$.a[0].c`) and the object numeric key (`$.a.0.c`) — the `sqlite` pushdown generates one branch per reading for the whole predicate (the `ORDER BY` key takes the first resolving branch through `COALESCE`), so records stored through either of those two readings agree across engines in their read, delete and update hit sets and in sort order. A path with two or more all-numeric segments (such as `a.0.1` or `a.0.b.1`) is not pushed down yet: with mixed containers (array then object key, or object then array) both path forms miss at once, so for such fields both filtering and sorting fall back to in-memory execution as a whole — both engines return exactly the same results, just without the pushdown speed-up. A path whose numeric segment carries a leading zero (such as `a.01`) falls back to in-memory filtering the same way: SQLite reads the rewritten `[01]` as an array index while memory reads the literal key `'01'`, the two semantics differ, and after the fallback both engines agree.

#### Sorting notes

`sortAlgorithm` currently accepts:

- `default`
- `fast`
- `counting`
- `merge`
- `slow`

If you do not force an algorithm, the runtime may choose a more suitable one based on dataset size and sort shape.

Every supported algorithm keeps `null` and `undefined` values stable at the end in both ascending and descending order.

Numbers, bigints, and dates sort by magnitude in every algorithm, including the string-tuned `fast` and `slow` paths.

String ordering is case-sensitive deterministic code point order (Unicode code point order), matching SQLite's `BINARY` collation (UTF-8 byte order ≡ code point order) and independent of the locale or runtime — the same dataset returns exactly the same string sequence on the `file-system` and `sqlite` engines under any `sortAlgorithm`.

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

Besides `where`, `options` accepts the security options: a non-empty `encryptedFields` selects the encrypted facade and persists the requested field list on implicit table creation; a conflict with an existing table's persisted policy (including a plaintext table) fails with `MIGRATION_FAILED`.

#### Supported update operators

| Operator    | Semantics                                                                                | Example                            |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `$inc`      | Increment or decrement numeric values                                                    | `{ $inc: { balance: -200 } }`      |
| `$set`      | Assign explicit values                                                                   | `{ $set: { status: 'active' } }`   |
| `$unset`    | Remove fields                                                                            | `{ $unset: ['temporaryField'] }`   |
| `$push`     | Push a single value into an array                                                        | `{ $push: { tags: 'new' } }`       |
| `$pull`     | Remove array elements equal to the value, or object elements matching every listed field | `{ $pull: { tags: 'obsolete' } }`  |
| `$addToSet` | Push only if absent                                                                      | `{ $addToSet: { tags: 'admin' } }` |

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
- AutoSync retains dirty entries and performs no storage write while a transaction is active. A later scheduled sync may flush them after the transaction settles.
- Transactions are in-process and are not crash-durable or cross-process ACID transactions.

## Storage Engine and Index APIs

### Storage Engine Configuration

The library supports two pluggable backing storage engines:

1. `'file-system'` (default): Purely based on `expo-file-system`. Incurs zero additional native peer dependencies, working out-of-the-box in Expo Go and pure JS environments.
2. `'sqlite'` (high-performance engine): Backed by `expo-sqlite`. Logical tables share a single physical `__elds_records` table with WAL journal mode enabled. Supports SQL query pushdown, JSON1 expression indexes, and on-demand pagination decryption.

Switch engines using `init()` or `configManager`:

```ts
import { db, init } from 'expo-lite-data-store';

// Initialize and switch to the high-performance SQLite engine
await init({ engine: 'sqlite' });
```

> **Dependency Note**: `expo-sqlite` is an optional peer dependency. When using the default `'file-system'` engine, `expo-sqlite` is not required; it only needs to be installed when explicitly configuring `engine: 'sqlite'`.

### Index Management APIs

#### `createIndex(tableName, field, options?)`

Creates an index for the specified table field. Under the SQLite engine, automatically creates a native B-tree index on `json_extract(payload, '$.<field>')`. Under the FileSystem engine, the declaration is registered in table metadata and the index is built over existing rows immediately while the table write lock is held, so unique constraints apply from the next write and queries gain acceleration right away. Index declarations persist across restarts: the FileSystem adapter re-registers and rebuilds them during initialization, before any public API call. If existing rows violate a `unique` index, `createIndex` fails with `TABLE_INDEX_NOT_UNIQUE` and drops the index again, leaving nothing behind; the SQLite engine instead surfaces the database's native unique-constraint error. A `unique` constraint compares stored values, so never declare one on a field encrypted by the encrypted surface: every encryption yields different ciphertext (random salt and IV) and the constraint can never fire. The index expression is generated in the array bracket form (the field `a.0.c` becomes `json_extract(payload, '$.a[0].c')`), so records that store that numeric segment as an object numeric key never use the index — this affects query performance only, never results (such records are still matched by the query itself).

```ts
import { db, createIndex } from 'expo-lite-data-store';

// Create a normal field index
await createIndex('users', 'city');

// Create a unique constraint index
await createIndex('users', 'email', { unique: true });
```

#### `dropIndex(tableName, field, options?)`

Drops an existing field index.

```ts
import { db, dropIndex } from 'expo-lite-data-store';

await dropIndex('users', 'city');
```

#### Declaring Indexes in `createTable`

Indexes can be declared during table creation via the `indexes` option:

```ts
await db.createTable('products', {
  indexes: ['category', { field: 'sku', unique: true }],
});
```

Declarations are validated before the table is committed: an empty field name fails with `TABLE_INDEX_INVALID`, and a `unique` violation in `initialData` fails the creation — SQLite rolls the transaction back atomically, while the FileSystem engine deletes the freshly created table, so a failed creation never leaves a partial table behind. Under the FileSystem engine the declarations persist in table metadata and are rebuilt automatically on the next startup. Declarations apply only when the call actually creates the table: calling `createTable` again on an existing table ignores them (the SQLite creation statement returns early there too), so a failing or duplicate declaration can never trigger the rollback against rows the table already holds.

### Bidirectional Engine Migration API

#### `migrateEngine(targetEngine, options?)`

Performs an online, zero-data-loss migration of all tables and data between `'file-system'` and `'sqlite'`. The migration service reads table metadata, column definitions, and records from the source engine, recreates tables and expression indexes in the target engine, verifies row count equality, and updates the active runtime engine configuration. If a destination table already holds rows, the migration fails with `MIGRATION_DEST_NOT_EMPTY` instead of silently overwriting them; pass `overwriteExisting: true` to replace destination data deliberately. Once a migration succeeds, the engine choice persists across app launches; an explicit runtime `engine` option in `init()` or `configManager` still overrides the persisted marker.

```ts
import { db, migrateEngine } from 'expo-lite-data-store';

const result = await migrateEngine('sqlite', {
  cleanSource: true, // Cleans up source data upon successful migration (defaults to false)
  progressCallback: ({ table, copied, total }) => {
    console.log(`Migrating ${table}: ${copied}/${total}`);
  },
});

console.log(
  `Migrated ${result.migratedTables.length} tables (${result.totalRecords} records) in ${result.durationMs}ms`
);
```

#### `MigrationResult`

```ts
interface MigrationResult {
  fromEngine: 'file-system' | 'sqlite';
  toEngine: 'file-system' | 'sqlite';
  migratedTables: string[];
  totalRecords: number;
  durationMs: number;
}
```

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

The value takes effect as soon as `set()` returns: committed changes notify subscribed components (such as `performanceMonitor`) to refresh the affected runtime fields in place, with no instance rebuild required. Changes only take over fields that have not been explicitly overridden: explicit `performanceMonitor.configure()` and `setEnabled()` settings win over configuration changes, and `resetRuntimeOptions()` drops those overrides to restore configuration authority.

> `cache.*` takes effect only on the `file-system` engine. `monitoring.enablePerformanceTracking` likewise records storage-side samples only through the `file-system` engine (encrypt/decrypt timing samples record on both engines). Enabling `monitoring.enablePerformanceTracking` under `sqlite` produces a one-time warning prefixed `[SQLiteStorageAdapter]` at initialization and is then ignored; `cache.*` is ignored silently without a warning. `monitoring.enableHealthChecks` (default `true`) is a `performanceMonitor` runtime switch, independent of the storage engine, and is never warned about.

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

`autoSync.enabled` is `false` by default. The following example opts into periodic dirty-cache flushing explicitly. `autoSync.batchSize` limits the number of dirty cache entries processed for each table in one sync run; it does not split a single table overwrite into record-level writes. Sync attempts made during an active transaction retain their dirty entries for a later scheduled sync. These keys configure an in-process timer that exists only in the `file-system` engine's write-behind cache — the `sqlite` engine persists writes immediately and does not run the timer — and the timer fires only while the app is running, not as an OS-level background task. Enabling `autoSync.enabled` under `sqlite` produces a one-time warning prefixed `[SQLiteStorageAdapter]` at initialization instead of a silent no-op.

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

Runtime defaults are `maxRecords: 1000`, `sampleRate: 0.1`, thresholds `{ minSuccessRate: 90, maxAverageDuration: 1000, maxP95Duration: 3000 }`, and performance tracking off (`monitoring.enablePerformanceTracking: false`); opt in explicitly when sampling is wanted. The key can also be flipped at any time with `configManager.set('monitoring.enablePerformanceTracking', ...)`: `performanceMonitor` starts or stops sampling immediately, with no instance rebuild required. Configuration changes never overwrite explicit `configure()` / `setEnabled()` settings; `resetRuntimeOptions()` drops those explicit overrides so configuration applies again. Performance sampling records storage-side operations only through the `file-system` engine, while encrypt/decrypt timing samples are recorded on both engines; enabling this key under `sqlite` produces a one-time warning prefixed `[SQLiteStorageAdapter]` at initialization.

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
- `hash(data, algorithm?)` defaults to `SHA-512`.
- `encryption.keyIterations` defaults to `600000` (valid range `10000`–`1000000`). On Expo Go the runtime caps the work factor at `20000` iterations with a warning, so the same data has a lighter security posture there than in standalone builds. Decryption honors the iteration count stored in each payload (clamped to the same bounds), so only decrypt payloads the app wrote and rate-limit externally supplied data.

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

`StorageError` instances with a `TRANSACTION_*` code, `SNAPSHOT_FAILED`, or `NO_TRANSACTION_IN_PROGRESS` use `category: 'transaction'`. Transaction lifecycle failures are raised as `TransactionError`, which extends `StorageError`, so `instanceof StorageError` catches them. `LOCK_TIMEOUT` uses `category: 'timeout'`.

### Common `StorageErrorCode` values

| Code                                  | Meaning                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_MODULE_MISSING`                 | Required Expo runtime package is missing                                                                                                                      |
| `AUTH_ON_ACCESS_UNSUPPORTED`          | Strict per-access authentication cannot be enforced in the current runtime                                                                                    |
| `PERMISSION_DENIED`                   | A request selected a weaker storage surface than the table's encryption or strict-authentication policy                                                       |
| `TABLE_NOT_FOUND`                     | The requested table does not exist                                                                                                                            |
| `TABLE_NAME_INVALID`                  | The table name is empty or invalid                                                                                                                            |
| `TABLE_COLUMN_INVALID`                | A declared column uses an unsupported type                                                                                                                    |
| `TABLE_INDEX_INVALID`                 | An index declaration is invalid (empty field name, or a field unsafe for SQL expression indexing)                                                             |
| `TABLE_INDEX_ALREADY_EXISTS`          | An index with this name is already registered on the table (FileSystem engine); SQLite raises it only when the name is taken by a different field expression  |
| `TABLE_INDEX_NOT_FOUND`               | The requested index does not exist on the table                                                                                                               |
| `TABLE_INDEX_NOT_UNIQUE`              | A write or index build would violate a declared unique index (FileSystem engine; SQLite surfaces the database's native constraint error instead)              |
| `FILE_CONTENT_INVALID`                | A record or update payload failed validation (for example a non-object record, or a record carrying the reserved envelope field names `__enc` / `__enc_bulk`) |
| `QUERY_FAILED`                        | The query engine failed to execute the condition                                                                                                              |
| `MIGRATION_FAILED`                    | Table migration failed, or an existing encryption/strict-authentication policy requires an explicit key/data migration                                        |
| `MIGRATION_DEST_NOT_EMPTY`            | An engine migration found existing rows in a destination table and refused to overwrite them; pass `overwriteExisting: true` to replace them deliberately     |
| `TRANSACTION_IN_PROGRESS`             | A transaction already exists on the current surface                                                                                                           |
| `NO_TRANSACTION_IN_PROGRESS`          | `commit()` or `rollback()` was called with no active transaction                                                                                              |
| `TRANSACTION_OPERATION_NOT_SUPPORTED` | An active transaction cannot perform a public schema operation that persists immediately                                                                      |
| `TRANSACTION_ROLLBACK_FAILED`         | A failed commit or rollback could not restore every table to its snapshot                                                                                     |
| `SNAPSHOT_FAILED`                     | Transaction record data could not be isolated or snapshotted                                                                                                  |
| `LOCK_TIMEOUT`                        | Concurrent write lock acquisition exceeded the timeout budget                                                                                                 |
| `TIMEOUT`                             | An operation exceeded a configured timeout                                                                                                                    |
| `CORRUPTED_DATA`                      | On-disk data could not be parsed safely                                                                                                                       |

### `CryptoError`

Crypto helper failures may raise `CryptoError` for crypto-specific fault paths.

## Advanced Exports

### `CryptoService`

`CryptoService` re-exports three cryptographic provider primitives for advanced consumers: `deriveKey` (PBKDF2 key derivation), `randomBytes` (secure random generation), and `hash` (SHA-256/SHA-512 digests). For record and field encryption, prefer the `encrypt`/`decrypt` convenience helpers.

## Related Documents

- Consumer guide: [../README.en.md](../README.en.md)
- Simplified Chinese API reference: [./API.zh-CN.md](./API.zh-CN.md)
- Runtime QA guide: [./EXPO_RUNTIME_QA.en.md](./EXPO_RUNTIME_QA.en.md)
- Changelog: [./CHANGELOG.en.md](./CHANGELOG.en.md)
