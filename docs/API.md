# Expo Lite Data Store API

[简体中文](./API.zh-CN.md) | [Consumer Guide](../README.md) | [Runtime QA Guide](./EXPO_RUNTIME_QA.md) | [Changelog](./CHANGELOG.md)

## Installation

This API is documented against the supported install contract. `npm install expo-lite-data-store` on its own is not a supported setup.

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

If the consumer app installs only the package tarball name and skips the Expo runtime packages above, runtime module resolution may fail even though the package manager reports success.

`react-native-quick-crypto` is optional and belongs only in a native dev client or standalone build that needs the native flagship crypto provider.

### Supported Install Contract

- Supported: `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`
- Supported for native flagship validation: the same command plus `react-native-quick-crypto`
- Not supported: `npm install expo-lite-data-store` as the only installation step

Expo runtime packages remain peer dependencies on purpose so the consumer application can keep native versions aligned with Expo SDK 54.

### Missing Runtime Package Errors

When a required Expo runtime package cannot be resolved, the library throws `StorageError` with code `EXPO_MODULE_MISSING`.

- The error message identifies the missing module.
- The error suggestion points to `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`.
- The condition means the consumer application was installed outside the documented contract.

## Initialization

```ts
import { db } from 'expo-lite-data-store';

await db.init();
```

- `db.init()` is idempotent
- `db.init()` is optional because all public APIs auto-initialize

## Facade API

### `db.createTable(tableName, options?)`

```ts
await db.createTable('users', {
  columns: {
    id: 'string',
    name: 'string',
    email: 'string',
  },
  mode: 'single',
  encrypted: true,
  encryptedFields: ['email'],
});
```

### `db.deleteTable(tableName)`

```ts
await db.deleteTable('users');
```

### `db.hasTable(tableName)`

```ts
const exists = await db.hasTable('users');
```

### `db.listTables()`

```ts
const tables = await db.listTables();
```

### `db.insert(tableName, data, options?)`

```ts
await db.insert('users', { id: '1', name: 'Alice' });
await db.insert('users', [
  { id: '2', name: 'Bob' },
  { id: '3', name: 'Carol' },
]);
```

### `db.overwrite(tableName, data, options?)`

```ts
await db.overwrite('users', [{ id: '1', name: 'Alice v2' }]);
```

### `db.read(tableName, options?)`

```ts
const rows = await db.read('users');
```

### `db.findOne(tableName, options)`

```ts
const user = await db.findOne('users', {
  where: { id: '1' },
});
```

### `db.findMany(tableName, options?)`

```ts
const users = await db.findMany('users', {
  where: { active: true },
  sortBy: 'createdAt',
  order: 'desc',
  skip: 0,
  limit: 20,
});
```

### `db.update(tableName, data, options)`

```ts
const updated = await db.update(
  'users',
  { active: false },
  { where: { id: '1' } }
);
```

### `db.remove(tableName, options)`

```ts
const removed = await db.remove('users', {
  where: { id: '1' },
});
```

### `db.clearTable(tableName)`

```ts
await db.clearTable('users');
```

### `db.countTable(tableName)`

```ts
const count = await db.countTable('users');
```

### `db.verifyCountTable(tableName)`

```ts
const result = await db.verifyCountTable('users');
// { metadata: number, actual: number, match: boolean }
```

### `db.bulkWrite(tableName, operations)`

```ts
await db.bulkWrite('users', [
  { type: 'insert', data: { id: '1', name: 'Alice' } },
  { type: 'update', data: { name: 'Bob v2' }, where: { id: '2' } },
  { type: 'delete', where: { id: '3' } },
]);
```

### Transactions

```ts
await db.beginTransaction();
await db.insert('users', { id: '1', name: 'Alice' });
await db.commit();

await db.beginTransaction();
await db.update('users', { name: 'Rollback me' }, { where: { id: '1' } });
await db.rollback();
```

### `db.migrateToChunked(tableName)`

```ts
await db.migrateToChunked('users');
```

## Function API

All `db.*` methods also exist as top-level exports:

- `init`
- `createTable`
- `deleteTable`
- `hasTable`
- `listTables`
- `insert`
- `overwrite`
- `read`
- `findOne`
- `findMany`
- `update`
- `remove`
- `clearTable`
- `countTable`
- `verifyCountTable`
- `bulkWrite`
- `beginTransaction`
- `commit`
- `rollback`
- `migrateToChunked`

## Crypto Helpers

```ts
import {
  encrypt,
  decrypt,
  encryptBulk,
  decryptBulk,
  hash,
  resetMasterKey,
} from 'expo-lite-data-store';
```

- `encrypt(plainText, masterKey)`
- `decrypt(cipherText, masterKey)`
- `encryptBulk(values, masterKey)`
- `decryptBulk(values, masterKey)`
- `hash(data, algorithm?)`
- `resetMasterKey()`

## Security Notes

- Default encryption for new writes is `AES-GCM`
- `AES-CTR` is available only for explicit configuration or legacy compatibility
- `requireAuthOnAccess: true` is strict and throws `AUTH_ON_ACCESS_UNSUPPORTED` if the runtime cannot enforce it
- Expo Go supports regular encrypted storage, but not strict per-access authentication

## Related Documents

- Consumer guide: [../README.md](../README.md)
- Simplified Chinese API reference: [./API.zh-CN.md](./API.zh-CN.md)
- Runtime QA guide: [./EXPO_RUNTIME_QA.md](./EXPO_RUNTIME_QA.md)
- Changelog: [./CHANGELOG.md](./CHANGELOG.md)
