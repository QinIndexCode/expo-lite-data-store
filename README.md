# expo-lite-data-store

Local structured storage for Expo applications, with runtime-tested support for Expo Go, managed apps, and native development builds on Expo SDK 54.

[简体中文](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.zh-CN.md) | [English Alias](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.en.md) | [API Reference](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/API.md) | [Runtime QA Guide](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/EXPO_RUNTIME_QA.md) | [Changelog](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/CHANGELOG.md)

## Overview

`expo-lite-data-store` is a file-backed local data store for Expo projects that need more structure than ad hoc JSON files but do not want to introduce a full remote-first database just to keep local records on-device.

The package is designed around the following runtime guarantees:

- lazy initialization, so importing the package does not immediately require storage access or Expo native modules;
- explicit Expo install contract, so peer dependencies stay aligned with the host Expo SDK instead of being hidden inside the library;
- support for plain and encrypted storage surfaces;
- compatibility with Expo Go for the documented feature set;
- optional native crypto acceleration in development builds and standalone apps;
- storage-folder migration from legacy beta roots to the stable `lite-data-store` root.

## Support Matrix

| Surface | Status |
| --- | --- |
| Expo SDK | `54.x` |
| React | `19.1.x` |
| React Native | `0.81.x` |
| Managed apps | Supported |
| Expo Go | Supported for the documented contract below |
| Native dev client / standalone app | Supported and recommended for native crypto validation |

## Installation

This package does not support `npm install expo-lite-data-store` as a standalone installation step.

The only supported base install command for Expo SDK 54 is:

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

Treat `npm install expo-lite-data-store` on its own as an incomplete installation, even if the package manager finishes without error.

`react-native-quick-crypto` is an optional peer dependency. Install it only when the application is expected to run with the native flagship crypto provider in a development build or standalone app:

```bash
npx expo install react-native-quick-crypto
```

### Why the Expo runtime packages stay in `peerDependencies`

The published tarball only ships compiled JavaScript and type declarations. Expo runtime modules intentionally remain peer dependencies because they belong to the consumer application's native dependency graph.

That design avoids version drift such as:

- the library bundling one Expo native module version while the host app expects another;
- npm succeeding while Expo native modules remain unresolved at runtime;
- development builds and Expo Go ending up with different native dependency assumptions.

### Installation Contract

| Contract | Status | Notes |
| --- | --- | --- |
| `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store` | Supported | Required managed-compatible contract for Expo SDK 54 |
| Previous command plus `react-native-quick-crypto` | Supported | Required for native flagship validation in a dev client or standalone build |
| `npm install expo-lite-data-store` only | Not supported | May leave Expo peer dependencies missing or version-misaligned |

### Required runtime packages

| Package | Why it is required |
| --- | --- |
| `expo-file-system` | Table files, chunk files, metadata files, and directory management |
| `expo-constants` | Runtime config loading from `app.json` and Expo environment detection |
| `expo-crypto` | Randomness, hashing, and Expo-compatible crypto helpers |
| `expo-secure-store` | Secure persistence of the derived master key material |

`expo-modules-core` is used internally as part of Expo's native module bridge, but it is provided by the host Expo runtime rather than installed as a separate consumer contract line item.

### Missing Runtime Packages

If the host Expo application is missing a required runtime package, the library throws `StorageError` with code `EXPO_MODULE_MISSING`.

The error details identify the missing module, and the suggestion points back to the supported install command:

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

This error should be treated as an installation-contract failure in the consumer app, not as a recoverable runtime warning.

## Quick Start

### 1. Install the supported dependency set

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

### 2. Optional: define runtime config in `app.json`

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

### 3. Create a table and store records

```ts
import { db } from 'expo-lite-data-store';

await db.init();

await db.createTable('users', {
  columns: {
    id: 'string',
    name: 'string',
    email: 'string',
    age: 'number',
    active: 'boolean',
  },
  mode: 'single',
});

await db.insert('users', [
  { id: '1', name: 'Alice', email: 'alice@example.com', age: 28, active: true },
  { id: '2', name: 'Bob', email: 'bob@example.com', age: 31, active: false },
]);

const activeUsers = await db.findMany('users', {
  where: { active: true },
  sortBy: 'age',
  order: 'asc',
});
```

`db.init()` is optional and idempotent. All public APIs follow the same lazy-initialization path on first real use.

## Usage Guide

### Choosing a storage mode

Use `mode: 'single'` when:

- the table is modest in size;
- updates tend to touch the whole file anyway;
- operational simplicity matters more than very large payload handling.

Use `mode: 'chunked'` when:

- the table can grow into large payloads;
- you expect heavy append or overwrite patterns;
- you want the runtime to split data into chunk files after the configured threshold.

The library can also switch to chunked handling automatically when the initial payload clearly exceeds the configured chunk threshold.

### Declaring columns

`createTable()` accepts a `columns` map. The runtime currently accepts these column types:

- `string`
- `number`
- `boolean`
- `date`
- `blob`

Column metadata is used for validation and table metadata, but records remain plain JavaScript objects in the public API.

### Writing data

Use `insert()` when new records should be appended:

```ts
await db.insert('events', { id: 'evt-1', type: 'login' });
```

Use `overwrite()` when the entire logical contents of a table should be replaced:

```ts
await db.overwrite('cache', [
  { id: 'cfg', version: 2, payload: { theme: 'dark' } },
]);
```

The current runtime returns a `WriteResult` shaped like:

```ts
type WriteResult = {
  written: number;
  totalAfterWrite: number;
  chunked: boolean;
  chunks?: number;
};
```

In current runtime behavior:

- `written` is the number of records written or affected in the operation;
- `totalAfterWrite` is the total number of records present after the operation;
- `chunked` indicates whether the table is currently stored in chunked mode.

### Reading and querying

Use `read()` when the intent is "give me the table contents as stored":

```ts
const rows = await db.read('users');
```

`read()` is intentionally a raw table read. It does not apply query conditions, pagination, or sorting even if those fields are present on the options object.

Use `findOne()` or `findMany()` when query semantics are required:

```ts
const expensiveElectronics = await db.findMany('products', {
  where: {
    $and: [
      { category: 'Electronics' },
      { price: { $gt: 100 } },
    ],
  },
  sortBy: 'price',
  order: 'desc',
  limit: 20,
});
```

Supported query operators:

| Operator | Meaning |
| --- | --- |
| `$and` | Logical AND across nested conditions |
| `$or` | Logical OR across nested conditions |
| `$eq` | Exact equality |
| `$ne` | Not equal |
| `$gt` | Greater than |
| `$gte` | Greater than or equal |
| `$lt` | Less than |
| `$lte` | Less than or equal |
| `$in` | Value or array overlap is included in the candidate list |
| `$nin` | Value or array overlap is excluded from the candidate list |
| `$like` | SQL-style pattern matching using `%` and `_` |

### Updating records

`update()` applies the update payload to every record matched by `where`.

Simple replacement update:

```ts
await db.update(
  'users',
  { active: false },
  { where: { id: '2' } }
);
```

Operator-based update:

```ts
await db.update(
  'accounts',
  { $inc: { balance: -200 } },
  { where: { id: 'acct-1' } }
);
```

Supported update operators:

| Operator | Meaning |
| --- | --- |
| `$inc` | Increment numeric fields |
| `$set` | Set specific fields explicitly |
| `$unset` | Remove fields |
| `$push` | Push one value into an array field |
| `$pull` | Remove matching values from an array field |
| `$addToSet` | Add one value to an array only if it is not already present |

### Bulk operations

`bulkWrite()` accepts an ordered list of `insert`, `update`, and `delete` operations:

```ts
await db.bulkWrite('users', [
  { type: 'insert', data: { id: '3', name: 'Carol' } },
  { type: 'update', data: { $set: { active: true } }, where: { id: '2' } },
  { type: 'delete', where: { active: false } },
]);
```

This is useful when a workflow needs a single high-level mutation call while still preserving ordered semantics.

### Transactions

Transactions are explicit and stateful:

```ts
await db.beginTransaction();

try {
  await db.update('accounts', { $inc: { balance: -200 } }, { where: { id: 'acct-1' } });
  await db.update('accounts', { $inc: { balance: 200 } }, { where: { id: 'acct-2' } });
  await db.commit();
} catch (error) {
  await db.rollback();
  throw error;
}
```

Important transaction behavior:

- only one transaction can be active on a given adapter surface at a time;
- calling `beginTransaction()` twice without finishing the first transaction raises `TRANSACTION_IN_PROGRESS`;
- calling `commit()` or `rollback()` without an active transaction raises `NO_TRANSACTION_IN_PROGRESS`.

### Count vs verification

Use `countTable()` when you want the fast current row count from metadata:

```ts
const total = await db.countTable('users');
```

Use `verifyCountTable()` only when diagnosing metadata drift:

```ts
const result = await db.verifyCountTable('users');
// { metadata: number, actual: number, match: boolean }
```

`verifyCountTable()` is slower because it compares metadata to actual on-disk data and repairs mismatches when detected.

## Configuration

### Configuration precedence

The current runtime resolves configuration from lowest to highest priority in this order:

1. built-in defaults from `defaultConfig`
2. environment variables
3. Expo runtime config from `app.json` / `app.config.*`
4. `global.liteStoreConfig`
5. programmatic overrides through `configManager.setConfig()`, `configManager.updateConfig()`, and `configManager.set()`

Within Expo runtime config, the loader checks:

1. `global.__expoConfig`
2. `expo-constants.getConfig()`
3. `Constants.expoConfig`
4. `Constants.manifest`
5. `Constants.extra.liteStore`
6. `global.expo.extra.liteStore`

### Common runtime config keys

| Key | Default | Purpose |
| --- | --- | --- |
| `chunkSize` | `5242880` | Chunk threshold in bytes |
| `storageFolder` | `lite-data-store` | Root folder under Expo file storage |
| `sortMethods` | `default` | Default sort strategy hint |
| `timeout` | `10000` | Timeout for selected file operations |
| `encryption.algorithm` | `auto` | Preferred encryption mode |
| `encryption.keyIterations` | `600000` | PBKDF2 iteration target before Expo Go downshifts |
| `performance.maxConcurrentOperations` | `5` | Max write-side concurrency |
| `cache.maxSize` | `1000` | Cache entry budget |
| `monitoring.enablePerformanceTracking` | `false` | Enables performance sampling |
| `monitoring.enableHealthChecks` | `true` | Enables health-check evaluation |
| `autoSync.enabled` | `true` | Auto-sync service toggle |
| `autoSync.interval` | `30000` | Auto-sync interval in milliseconds |
| `autoSync.minItems` | `1` | Minimum queued item count before auto-sync |
| `autoSync.batchSize` | `100` | Max items processed per auto-sync batch |

### Environment variables currently recognized

| Variable | Maps to |
| --- | --- |
| `LITE_STORE_CHUNK_SIZE` | `chunkSize` |
| `LITE_STORE_STORAGE_FOLDER` | `storageFolder` |
| `LITE_STORE_SORT_METHODS` | `sortMethods` |
| `LITE_STORE_TIMEOUT` | `timeout` |
| `LITE_STORE_ENCRYPTION_KEY_ITERATIONS` | `encryption.keyIterations` |
| `LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS` | `performance.maxConcurrentOperations` |
| `LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD` | `performance.memoryWarningThreshold` |
| `LITE_STORE_CACHE_MAX_SIZE` | `cache.maxSize` |
| `LITE_STORE_CACHE_DEFAULT_EXPIRY` | `cache.defaultExpiry` |
| `LITE_STORE_AUTO_SYNC_ENABLED` | `autoSync.enabled` |
| `LITE_STORE_AUTO_SYNC_INTERVAL` | `autoSync.interval` |

### Programmatic configuration

```ts
import { configManager } from 'expo-lite-data-store';

configManager.updateConfig({
  storageFolder: 'my-app-store',
  chunkSize: 8 * 1024 * 1024,
  performance: {
    maxConcurrentOperations: 8,
  },
  autoSync: {
    enabled: true,
    interval: 15000,
  },
});
```

The public configuration manager supports:

- `configManager.getConfig()`
- `configManager.setConfig(partialConfig)`
- `configManager.updateConfig(partialConfig)`
- `configManager.resetConfig()`
- `configManager.get(path)`
- `configManager.set(path, value)`

## Encryption and Security Boundary

### Plain vs encrypted surfaces

By default the library uses the plain storage adapter. To opt into encrypted behavior for a specific call, pass `encrypted: true` in the options object:

```ts
await db.createTable('profiles', {
  encrypted: true,
  encryptedFields: ['email', 'phone'],
});
```

You can choose between:

- field-level encryption through `encryptedFields`;
- full-table encryption through `encryptFullTable: true`;
- strict access-authentication intent through `requireAuthOnAccess: true`.

### Expo Go boundary

Regular encrypted storage works in Expo Go.

`requireAuthOnAccess: true` is strict. When the current runtime cannot enforce per-access authentication, the library throws `AUTH_ON_ACCESS_UNSUPPORTED`.

That means:

- Expo Go is suitable for plain storage, chunked storage, and regular encrypted storage validation;
- Expo Go is not the right environment for validating biometric or strict per-access authentication guarantees;
- native-performance validation with `react-native-quick-crypto` belongs in a native dev client or standalone app.

### Existing on-device data

Stable 2.x runtime logic keeps compatibility with earlier beta output formats, including:

- metadata files;
- plain table files;
- chunked table layouts;
- encrypted payload variants produced by earlier beta builds.

When the stable default root `lite-data-store` does not already exist, the runtime can migrate legacy `expo-lite-data` content automatically.

## Performance and Monitoring

The package exports `performanceMonitor` for advanced consumers and maintainers. This is not required for normal CRUD usage, but it is useful when profiling local workloads.

Available monitor capabilities include:

- `configure()`
- `getMetrics()`
- `getOperationStats()`
- `getGroupStats()`
- `getOverallStats()`
- `getThresholds()`
- `getSampleRate()`
- `performHealthCheck()`
- `clear()`
- `setEnabled()`
- `isEnabled()`

If you only need release-grade runtime evidence, prefer the repository QA baselines instead of building a custom monitoring setup from scratch.

## Troubleshooting

### The package installed but throws `EXPO_MODULE_MISSING`

The consumer app almost certainly installed only the tarball name instead of the documented Expo dependency set. Re-run:

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

### `requireAuthOnAccess` fails in Expo Go

This is expected. Expo Go does not support the strict authentication contract required by `requireAuthOnAccess: true`. Use a native dev client or standalone build for that validation path.

### Encrypted operations feel slower in Expo Go

This is also expected. The runtime intentionally reduces PBKDF2 iterations in Expo Go for usability. Native builds with `react-native-quick-crypto` are the correct surface for higher-performance crypto validation.

## Release Validation

The repository ships explicit QA baselines for release and prepublish validation:

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

To run both baselines in sequence:

```bash
npm run qa:baseline:release
```

These commands generate artifact bundles under `artifacts/expo-runtime-qa/`. The release source of truth is the generated `summary.json`, not a transient device screenshot or manual clipboard capture.

## Documentation

- Consumer and maintainer API reference: [docs/API.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/API.md)
- Simplified Chinese API reference: [docs/API.zh-CN.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/API.zh-CN.md)
- Runtime QA process, lanes, verdict semantics, and artifact layout: [docs/EXPO_RUNTIME_QA.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/EXPO_RUNTIME_QA.md)
- Changelog: [docs/CHANGELOG.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/CHANGELOG.md)
- Simplified Chinese changelog: [docs/CHANGELOG.zh-CN.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/CHANGELOG.zh-CN.md)
- Architecture notes: [docs/ARCHITECTURE.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/ARCHITECTURE.md)
- Contributing guide: [CONTRIBUTING.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/CONTRIBUTING.md)
- Security policy: [SECURITY.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/SECURITY.md)
- Simplified Chinese guide: [README.zh-CN.md](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.zh-CN.md)

## License

[MIT](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
