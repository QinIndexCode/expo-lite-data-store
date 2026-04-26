# Expo Lite Data Store API 参考

[README 入口](../README.md) | [English](./API.en.md) | [运行时 QA 指南](./EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./CHANGELOG.zh-CN.md)

## 文档范围

本文件是当前 `2.x` 公共表面的详细 API 参考，覆盖以下内容：

- 正式支持的安装契约；
- 公开导出的 facade、命名函数与辅助导出；
- 表创建、读取、写入、查询、事务等行为；
- 配置与性能监控能力；
- 加密辅助函数、错误类型，以及常见运行时错误码。

如果你需要的是叙述式安装与接入指南，请先阅读 [README.zh-CN.md](../README.zh-CN.md)。如果你需要维护者视角的发布验证与运行时证据，请阅读 [EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)。

## 安装契约

本库文档是基于正式支持的 Expo 安装契约编写的。单独执行 `npm install expo-lite-data-store` 不属于受支持的安装方式。

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

如果消费应用只安装包名本身，而没有同时安装上面的 Expo 运行时包，那么即使包管理器显示成功，运行时模块解析仍然可能失败。

`react-native-quick-crypto` 是可选依赖，仅当原生 dev client 或独立构建需要启用原生旗舰加密提供者时才需要安装。

### 受支持的安装组合

- 正式支持：`npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store`
- 用于原生旗舰验证时正式支持：在上一条基础上再安装 `react-native-quick-crypto`
- 不支持：只执行 `npm install expo-lite-data-store`

### 运行时缺包失败

当必需的 Expo 运行时包无法解析时，库会抛出 `StorageError`，错误码为 `EXPO_MODULE_MISSING`。

这通常意味着：

- 宿主应用没有按文档中的安装契约完成安装，或
- 应用在后续依赖调整中移除了必需的 Expo peer 依赖。

## 导入表面

### 推荐导入方式

```ts
import {
  db,
  configManager,
  performanceMonitor,
  StorageError,
  StorageErrorCode,
} from 'expo-lite-data-store';
```

`StorageErrorCode` 既作为运行时常量映射导出，也对应 `StorageError.code` 使用的字符串字面量联合类型。

### 导出分组

| 导出分组 | 公共项 |
| --- | --- |
| Facade 对象 | `db` |
| 命名 CRUD 函数 | `init`, `createTable`, `deleteTable`, `hasTable`, `listTables`, `insert`, `overwrite`, `read`, `findOne`, `findMany`, `update`, `remove`, `clearTable`, `countTable`, `verifyCountTable`, `bulkWrite`, `migrateToChunked` |
| 事务函数 | `beginTransaction`, `commit`, `rollback` |
| 配置导出 | `configManager`, `ConfigManager` |
| 监控导出 | `performanceMonitor` |
| 加密辅助导出 | `encrypt`, `decrypt`, `encryptBulk`, `decryptBulk`, `hash`, `resetMasterKey`, `getKeyCacheStats`, `getKeyCacheHitRate`, `CryptoService` |
| 错误导出 | `StorageError`, `StorageErrorCode`, `CryptoError` |
| 类型导出 | `CreateTableOptions`, `ReadOptions`, `WriteOptions`, `WriteResult`, `CommonOptions`, `TableOptions`, `FindOptions`, `FilterCondition`, `LiteStoreConfig`, `DeepPartial`, `StorageErrorCode` |
| 高级明文适配器导出 | `plainStorage` |

### `db` facade 与命名导出

下面两种写法是等价的：

```ts
import { db, createTable } from 'expo-lite-data-store';

await db.createTable('users');
await createTable('profiles');
```

可根据宿主应用的代码风格自由选择。`db` facade 与命名函数共用同一套实现。

## 常用类型

### `CommonOptions`

```ts
type CommonOptions = {
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
};
```

这两个标志决定当前调用会被路由到哪一个存储表面。

- `encrypted: true` 会选择加密适配器表面。
- `requireAuthOnAccess: true` 会隐式要求走加密表面，并表达严格逐次访问认证语义。

### `WriteResult`

```ts
type WriteResult = {
  written: number;
  totalAfterWrite: number;
  chunked: boolean;
  chunks?: number;
};
```

当前运行时行为如下：

- `written` 表示本次操作写入或影响的记录数；
- `totalAfterWrite` 表示操作完成后的总记录数；
- `chunked` 表示最终表是否处于 chunked 模式。

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

当前运行时正式接受的列类型包括：

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

需要特别区分：

- 顶层公开 `read()` 会剥离查询相关字段，按“原始表读取”处理；
- 真正带过滤、排序、分页的读取应使用 `findMany()`。

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

尽管内部查询引擎支持函数式过滤，公开 `findOne()` 和 `findMany()` 的类型文档仍以对象式 `where` 条件为主。若你希望保持稳定的公共兼容性，请优先使用对象条件。

## 初始化

### `init(options?)`

```ts
await init();
await init({ encrypted: true });
```

行为说明：

- 具备幂等性；
- 可以不显式调用；
- 会根据 `encrypted` 和 `requireAuthOnAccess` 选择相应适配器表面；
- 会在首次业务操作前提前初始化存储路径与相关服务。

以下场景适合显式调用 `init()`：

- 你希望在启动阶段而不是第一次业务调用时暴露初始化失败；
- 你希望在进入安全业务流之前先预热加密表面。

## 表管理 API

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

行为说明：

- 创建表元数据和初始存储结构；
- 校验列类型是否合法；
- 可选地写入 `initialData`；
- 可在 `single` 与 `chunked` 模式间起始创建；
- 可同时声明字段级或整表级加密选项。

### `deleteTable(tableName, options?)`

```ts
await deleteTable('users');
```

行为说明：

- 删除单文件表或 chunk 目录；
- 清理该表对应的索引元数据；
- 删除表级元数据。

### `hasTable(tableName, options?)`

```ts
const exists = await hasTable('users');
```

若当前表面上存在对应表元数据，则返回 `true`。

### `listTables(options?)`

```ts
const tables = await listTables();
```

返回当前表面下所有已知表名。

### `countTable(tableName, options?)`

```ts
const count = await countTable('users');
```

这是基于元数据的快速计数 API。

### `verifyCountTable(tableName, options?)`

```ts
const result = await verifyCountTable('users');
// { metadata: number, actual: number, match: boolean }
```

仅建议在诊断或维护场景使用：

- 它会比较元数据计数与真实存储数据；
- 发现不一致时会自动修复元数据；
- 成本明显高于 `countTable()`。

### `migrateToChunked(tableName, options?)`

```ts
await migrateToChunked('audit-log');
```

把现有表迁移为 chunked 存储模式。适合在单文件表已经增长到不再适合继续维持单文件时使用。

## 写入 API

### `insert(tableName, data, options?)`

```ts
await insert('users', { id: '1', name: 'Alice' });

await insert('users', [
  { id: '2', name: 'Bob' },
  { id: '3', name: 'Carol' },
]);
```

行为说明：

- 逻辑上始终以追加方式写入；
- 同时支持单条记录和数组记录；
- 返回 `WriteResult`。

### `overwrite(tableName, data, options?)`

```ts
await overwrite('users', [
  { id: '1', name: 'Alice v2' },
]);
```

行为说明：

- 会替换整张表的逻辑内容；
- 不会保留未出现在新数据中的旧行。

### `bulkWrite(tableName, operations, options?)`

```ts
await bulkWrite('users', [
  { type: 'insert', data: { id: '4', name: 'Dan' } },
  { type: 'update', data: { $set: { active: true } }, where: { id: '2' } },
  { type: 'delete', where: { active: false } },
]);
```

操作结构如下：

```ts
type BulkOperation =
  | { type: 'insert'; data: Record<string, any> | Record<string, any>[] }
  | { type: 'update'; data: Record<string, any>; where: Record<string, any> }
  | { type: 'delete'; where: Record<string, any> };
```

行为说明：

- 保留操作顺序；
- 内部会对纯插入场景走专门的优化路径；
- 支持在事务中使用；
- 返回的 `WriteResult.written` 在当前运行时中表示受影响的记录数。

## 读取与查询 API

### `read(tableName, options?)`

```ts
const rows = await read('users');
```

`read()` 只适合“读出表当前存储内容”这一语义。当前公开实现会主动去掉以下字段：

- `filter`
- `skip`
- `limit`
- `sortBy`
- `order`
- `sortAlgorithm`

如果你需要过滤、排序或分页，请使用 `findMany()`。

### `findOne(tableName, options)`

```ts
const user = await findOne('users', {
  where: { id: '1' },
});
```

签名结构：

```ts
findOne(tableName, {
  where: Record<string, any>;
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
})
```

返回第一条命中的记录；若没有命中则返回 `null`。

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

签名结构：

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

#### 支持的查询操作符

| 操作符 | 语义 | 示例 |
| --- | --- | --- |
| `$and` | 多个条件同时成立 | `{ $and: [{ active: true }, { age: { $gte: 18 } }] }` |
| `$or` | 任一条件成立即可 | `{ $or: [{ role: 'admin' }, { role: 'moderator' }] }` |
| `$eq` | 精确相等 | `{ age: { $eq: 21 } }` |
| `$ne` | 不等于 | `{ status: { $ne: 'archived' } }` |
| `$gt` | 大于 | `{ price: { $gt: 100 } }` |
| `$gte` | 大于等于 | `{ score: { $gte: 90 } }` |
| `$lt` | 小于 | `{ stock: { $lt: 10 } }` |
| `$lte` | 小于等于 | `{ retries: { $lte: 3 } }` |
| `$in` | 在候选集合中 | `{ role: { $in: ['admin', 'editor'] } }` |
| `$nin` | 不在候选集合中 | `{ status: { $nin: ['deleted', 'blocked'] } }` |
| `$like` | SQL 风格模糊匹配 | `{ email: { $like: '%@example.com' } }` |

#### 排序说明

当前 `sortAlgorithm` 可接受：

- `default`
- `fast`
- `counting`
- `merge`
- `slow`

如果你不强制指定算法，运行时会根据数据规模和排序形态自动选择更合适的实现。

## 更新与删除 API

### `update(tableName, data, options)`

```ts
const updatedCount = await update(
  'users',
  { active: false },
  { where: { id: '1' } }
);
```

操作符更新示例：

```ts
const updatedCount = await update(
  'accounts',
  { $inc: { balance: -200 } },
  { where: { id: 'acct-1' } }
);
```

返回命中的并已更新的记录数。

#### 支持的更新操作符

| 操作符 | 语义 | 示例 |
| --- | --- | --- |
| `$inc` | 数值递增或递减 | `{ $inc: { balance: -200 } }` |
| `$set` | 显式赋值 | `{ $set: { status: 'active' } }` |
| `$unset` | 删除字段 | `{ $unset: ['temporaryField'] }` |
| `$push` | 向数组追加单个值 | `{ $push: { tags: 'new' } }` |
| `$pull` | 从数组移除匹配值 | `{ $pull: { tags: 'obsolete' } }` |
| `$addToSet` | 仅在不存在时追加 | `{ $addToSet: { tags: 'admin' } }` |

不使用操作符、直接传普通字段对象同样有效，运行时会将其视为字段覆盖更新。

### `remove(tableName, options)`

```ts
const removed = await remove('users', {
  where: { active: false },
});
```

返回删除的记录数。

### `clearTable(tableName, options?)`

```ts
await clearTable('users');
```

清空表中的所有记录，但保留表定义本身。

## 事务 API

### `beginTransaction(options?)`

```ts
await beginTransaction();
```

在当前适配器表面上开启事务。

### `commit(options?)`

```ts
await commit();
```

提交当前事务中排队的所有操作。

### `rollback(options?)`

```ts
await rollback();
```

丢弃当前活动事务。

### 事务语义

- 当前不支持嵌套事务；
- 未结束前再次 `beginTransaction()` 会抛出 `TRANSACTION_IN_PROGRESS`；
- 没有活动事务时调用 `commit()` 或 `rollback()` 会抛出 `NO_TRANSACTION_IN_PROGRESS`；
- 事务所在表面同样由 `encrypted` 和 `requireAuthOnAccess` 决定。

## 配置 API

### `configManager`

```ts
import { configManager } from 'expo-lite-data-store';
```

公开方法如下：

#### `configManager.getConfig()`

返回当前完全合并后的运行时配置。

#### `configManager.setConfig(partialConfig)`

替换当前程序化覆盖对象，并重新加载合并配置。

#### `configManager.updateConfig(partialConfig)`

把传入的局部配置深度合并到当前程序化覆盖对象中，并重新加载配置。

```ts
configManager.updateConfig({
  storageFolder: 'my-app-store',
  performance: {
    maxConcurrentOperations: 8,
  },
});
```

#### `configManager.resetConfig()`

丢弃程序化覆盖项，回到“默认值 + 非程序化来源”的合并结果。

#### `configManager.get(path)`

通过点路径读取嵌套值。

```ts
const folder = configManager.get<string>('storageFolder');
const iterations = configManager.get<number>('encryption.keyIterations');
```

#### `configManager.set(path, value)`

通过点路径写入一个覆盖值。

```ts
configManager.set('monitoring.enablePerformanceTracking', true);
```

### 运行时配置来源

当前优先级从低到高如下：

1. 内建默认值
2. 环境变量
3. 来自 `app.json` / `app.config.*` 的 Expo 运行时配置
4. `global.liteStoreConfig`
5. 配置管理器的程序化覆盖

### `app.json` 示例

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

## 监控 API

### `performanceMonitor`

```ts
import { performanceMonitor } from 'expo-lite-data-store';
```

这个导出面向高级使用者、性能分析场景和维护者。普通 CRUD 使用并不要求先接入它。

常用方法包括：

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

返回原始指标样本，支持按以下字段过滤：

- `operation`
- `group`
- `channel`
- `profile`
- `provider`

#### `performanceMonitor.getOperationStats(operation?)`

返回单个操作的聚合统计，或按操作名分组的统计映射。

#### `performanceMonitor.getGroupStats(group?)`

返回单个 group 的聚合统计，或按 group 分组的统计映射。

#### `performanceMonitor.getOverallStats()`

返回总操作数、成功率、p50、p95、p99 与吞吐量等统计信息。

#### `performanceMonitor.performHealthCheck()`

返回 `HealthCheckResult`，根据当前阈值判断运行时健康状态。

其它可用控制方法还包括：

- `getThresholds()`
- `getSampleRate()`
- `clear()`
- `setEnabled(enabled)`
- `isEnabled()`
- `resetRuntimeOptions()`
- `destroy()`

## 加密辅助函数

### 命名加密导出

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

当前辅助函数集合包括：

- `encrypt(plainText, masterKey)`
- `decrypt(cipherText, masterKey)`
- `encryptBulk(values, masterKey)`
- `decryptBulk(values, masterKey)`
- `hash(data, algorithm?)`
- `resetMasterKey()`
- `getKeyCacheStats()`
- `getKeyCacheHitRate()`

### 安全说明

- 默认 `encryption.algorithm` 为 `auto`；当前运行时会在调用方未显式指定 `AES-CTR` 时，把新写入走到 `AES-GCM` 路径；
- `AES-CTR` 仍保留用于显式配置或旧数据兼容；
- `requireAuthOnAccess: true` 采用严格语义，当运行时无法真正强制逐次访问认证时，会抛出 `AUTH_ON_ACCESS_UNSUPPORTED`；
- Expo Go 支持常规加密存储，但不支持严格的生物识别或逐次访问认证保证。

## 错误与失败语义

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

`StorageError` 当前包含：

- `message`
- `code`
- `category`
- `details`
- `suggestion`
- `timestamp`
- `cause`

### 常见 `StorageErrorCode`

| 错误码 | 含义 |
| --- | --- |
| `EXPO_MODULE_MISSING` | 缺少必需的 Expo 运行时包 |
| `AUTH_ON_ACCESS_UNSUPPORTED` | 当前运行时无法兑现严格逐次访问认证 |
| `TABLE_NOT_FOUND` | 请求的表不存在 |
| `TABLE_NAME_INVALID` | 表名为空或不合法 |
| `TABLE_COLUMN_INVALID` | 列定义使用了不支持的类型 |
| `QUERY_FAILED` | 查询引擎执行条件失败 |
| `MIGRATION_FAILED` | 表迁移失败 |
| `TRANSACTION_IN_PROGRESS` | 当前表面已经存在一个活动事务 |
| `NO_TRANSACTION_IN_PROGRESS` | 没有活动事务却调用了 `commit()` 或 `rollback()` |
| `LOCK_TIMEOUT` | 并发写锁获取超时 |
| `TIMEOUT` | 操作超过了配置的超时预算 |
| `CORRUPTED_DATA` | 磁盘数据无法安全解析 |

### `CryptoError`

加密辅助流程中的特定失败路径可能会抛出 `CryptoError`。

## 高级导出

### `plainStorage`

`plainStorage` 暴露底层非加密适配器。它属于高级导出，通常只建议用于调试或低层集成。

### `CryptoService`

`CryptoService` 面向需要更底层加密模块表面的高级使用者，而不是普通业务调用。

## 相关文档

- 消费者文档： [../README.zh-CN.md](../README.zh-CN.md)
- 英文 API 参考： [./API.en.md](./API.en.md)
- 运行时 QA 指南： [./EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)
- 变更日志： [./CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)
