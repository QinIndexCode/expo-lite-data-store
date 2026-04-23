# Expo Lite Data Store API 参考

[English](./API.md) | [消费者文档](../README.zh-CN.md) | [运行时 QA 指南](./EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./CHANGELOG.zh-CN.md)

## 安装

本 API 文档基于正式支持的安装契约编写。单独执行 `npm install expo-lite-data-store` 不属于受支持的安装方式。

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

如果消费应用只安装包名本身，而没有同时安装上面的 Expo 运行时包，那么即使包管理器显示成功，运行时模块解析仍然可能失败。

`react-native-quick-crypto` 是可选依赖，仅当原生 dev client 或独立构建需要启用原生旗舰加密提供者时才需要安装。

### 正式支持的安装契约

- 正式支持：`npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`
- 用于原生旗舰验证时正式支持：在上一条基础上再安装 `react-native-quick-crypto`
- 不支持：只执行 `npm install expo-lite-data-store`

Expo 运行时模块被保留在 `peerDependencies` 中是有意设计，这样消费应用才能继续与 Expo SDK 54 的原生依赖版本保持对齐。

### 运行时缺包错误

当必需的 Expo 运行时包无法解析时，库会抛出 `StorageError`，错误码为 `EXPO_MODULE_MISSING`。

- 错误消息会指出缺失的模块。
- 错误建议会指向 `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`。
- 这说明消费应用没有按文档中的安装契约完成安装。

## 初始化

```ts
import { db } from 'expo-lite-data-store';

await db.init();
```

- `db.init()` 具有幂等性
- `db.init()` 是可选的，因为所有公开 API 都会在首次真实调用时自动初始化

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

### 事务

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

## 函数式 API

所有 `db.*` 方法也都以顶层导出形式提供：

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

## 加密辅助函数

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

## 安全说明

- 新写入数据默认使用 `AES-GCM`
- `AES-CTR` 只用于显式配置或兼容历史数据
- `requireAuthOnAccess: true` 采用严格语义；当运行时无法真正强制每次访问都认证时，会抛出 `AUTH_ON_ACCESS_UNSUPPORTED`
- Expo Go 支持常规加密存储，但不支持严格的逐次访问认证

## 相关文档

- 消费者文档： [../README.zh-CN.md](../README.zh-CN.md)
- 英文 API 参考： [./API.md](./API.md)
- 运行时 QA 指南： [./EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)
- 变更日志： [./CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)
