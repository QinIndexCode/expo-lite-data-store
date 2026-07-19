# Expo Lite Data Store API 参考

[README 入口](../README.md) | [English](./API.en.md) | [运行时 QA 指南](./EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./CHANGELOG.zh-CN.md)

## 文档范围

本文件是当前 `3.x` 公共表面的详细 API 参考，覆盖以下内容：

- 正式支持的安装契约；
- 公开导出的 facade、命名函数与辅助导出；
- 表创建、读取、写入、查询、事务等行为；
- 配置与性能监控能力；
- 加密辅助函数、错误类型，以及常见运行时错误码。

如果你需要的是叙述式安装与接入指南，请先阅读 [README.zh-CN.md](../README.zh-CN.md)。如果你需要维护者视角的发布验证与运行时证据，请阅读 [EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)。

## v3 迁移

`plainStorage` 以及 `expo-lite-data-store/dist/js/...`、`dist/cjs/...` 等包内深层导入不再属于公开 API。请从 `expo-lite-data-store` 根入口使用 `db` facade 或命名 API。对以 `encrypted: true` 创建的表，每一次表操作都必须传入 `encrypted: true`；选择明文表面的请求会以 fail-closed 方式被拒绝。

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
import { db, configManager, performanceMonitor, StorageError, StorageErrorCode } from 'expo-lite-data-store';
```

`StorageErrorCode` 既作为运行时常量映射导出，也对应 `StorageError.code` 使用的字符串字面量联合类型。

### 导出分组

| 导出分组       | 公共项                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Facade 对象    | `db`                                                                                                                                                                                                                                                                                                                                                                           |
| 命名 CRUD 函数 | `init`, `createTable`, `deleteTable`, `hasTable`, `listTables`, `insert`, `overwrite`, `read`, `findOne`, `findMany`, `update`, `remove`, `clearTable`, `countTable`, `verifyCountTable`, `bulkWrite`, `migrateToChunked`                                                                                                                                                      |
| 事务函数       | `beginTransaction`, `commit`, `rollback`                                                                                                                                                                                                                                                                                                                                       |
| 配置导出       | `configManager`, `ConfigManager`                                                                                                                                                                                                                                                                                                                                               |
| 监控导出       | `performanceMonitor`                                                                                                                                                                                                                                                                                                                                                           |
| 加密辅助导出   | `encrypt`, `decrypt`, `encryptBulk`, `decryptBulk`, `hash`, `resetMasterKey`, `getKeyCacheStats`, `getKeyCacheHitRate`, `CryptoService`                                                                                                                                                                                                                                        |
| 错误导出       | `StorageError`, `StorageErrorCode`, `CryptoError`                                                                                                                                                                                                                                                                                                                              |
| 类型导出       | `CreateTableOptions`, `ReadOptions`, `WriteOptions`, `WriteResult`, `CommonOptions`, `TableOptions`, `FindOptions`, `FindOneOptions`, `FindManyOptions`, `UpdateOptions`, `FilterCondition`, `BulkOperation`, `StorageInput`, `StorageRecord`, `UpdatePayload`, `LiteStoreConfig`, `DeepPartial`, `StorageErrorCode`, `PerformanceStats`, `HealthCheckResult`, `KeyCacheStats` |

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

严格表会绑定到该认证密钥作用域。常规加密表面不能访问严格表，严格表面也不能把既有常规加密表重新解释为严格表。应先由应用把数据显式迁移到新建的严格表并完成验证，再退役常规表和常规密钥。

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

### 类型化记录与 `CreateTableOptions`

面向记录的 API 都是泛型。需要字段补全时传入命名记录类型；无 schema 表可使用默认的 `StorageRecord`。

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

当前运行时正式接受的列类型包括：

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
type FilterCondition<T extends object = StorageRecord> =
  | ((item: T) => boolean)
  | Partial<T>
  | StorageRecord
  | { $or?: FilterCondition<T>[]; $and?: FilterCondition<T>[] };
```

尽管内部查询引擎支持函数式过滤，公开 `findOne()` 和 `findMany()` 的类型文档仍以对象式 `where` 条件为主。若你希望保持稳定的公共兼容性，请优先使用对象条件。

记录可以包含 `id` 或 `_id`，但这不是强制要求。只要调用提供了 `where` 条件，更新、删除、批量操作和事务路径都会按实际命中的行对象应用变更，而不是在缺少标识符时臆测身份。内存索引优先使用字符串或有限数值形式的 `id`，仅在 `id` 不可用或不稳定时回退到 `_id`。若索引覆盖的任一行两者都没有，该索引会被视为不适合查询加速，读取会回退到完整过滤。

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
- 可同时声明字段级或整表级加密选项；
- 建表完成后会立即持久化表元数据。

即使省略 `encrypted: true`，非空 `encryptedFields` 也会让 `createTable()` 选择加密 facade。加密写入可以隐式创建此前未知的表；在事务中，解析后的字段列表会传入 commit，并持久化所选策略。对既有加密表，`encrypted`、`encryptFullTable`、`encryptedFields` 和 `requireAuthOnAccess` 是策略输入，而不是原地修改命令。冲突请求会以 `MIGRATION_FAILED` 失败，必须由应用控制迁移；未按严格访问创建的适配器请求严格访问时会以 `PERMISSION_DENIED` 失败，而不会替换密钥。

显式创建字段级加密表但省略 `encryptedFields` 时，若建表时配置了非空字段列表，会先去重再快照到表元数据。若当时的配置为空，或调用方显式传入 `encryptedFields: []`，新表会用 `encryptAllFields: true` 与 `encryptedFields: []` 的精确组合持久化动态全字段策略，之后出现的新记录字段也会被加密。早期 v3 元数据没有内部全字段 marker；legacy 空列表或字段缺失仍沿用历史的全局配置回退，避免把混合记录中的明文字符串重新解释为密文。若要改变 legacy 表的行为，必须先显式迁移。

整表加密在物理层只存一条 envelope，而元数据记录逻辑行数。正常写入和事务写入都会把 envelope、逻辑计数与 storage generation 一起发布；事务回滚也会随物理快照恢复已捕获的逻辑计数，而不是再执行第二次元数据修补。可选的整表解密缓存只有在绑定当前精确 ciphertext 时才有效，timeout 为 0 时禁用。

### `deleteTable(tableName, options?)`

```ts
await deleteTable('users');
```

行为说明：

- 先提交表级元数据删除，再清理物理工件；
- 若元数据提交失败，则恢复原元数据并保持物理数据不变；
- 提交成功后清理内存索引、单文件、chunk 目录、恢复日志和 overwrite 备份；
- 以持久化元数据缺失作为权威删除状态，残留文件不能让表复活；
- 若物理清理失败，表仍保持逻辑不存在，后续 `deleteTable()` 可重试；同名建表会先清理全部孤立工件。

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

若任何已知表绑定了 `requireAuthOnAccess: true`，未选择严格表面的列表请求会 fail-closed：`listTables()` 以及仅传入 `encrypted: true` 的调用都会抛出错误码为 `PERMISSION_DENIED` 的 `StorageError`，而不会返回可能泄露表存在性的部分列表。只有具备相应权限的调用方才应重试：

```ts
const tables = await listTables({ encrypted: true, requireAuthOnAccess: true });
```

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

把现有表迁移为 chunked 存储模式。适合在单文件表已经增长到不再适合继续维持单文件时使用。迁移会保留列、风险与加密元数据；加密记录按实际存储形态迁移，不经过解密后重写窗口。运行时先发布并校验全部 chunk，再提交元数据 mode 变更。mode 变更是提交点；之后清理旧单文件失败不能回滚已提交的存储表示。

chunked 覆盖写使用有界 v2 日志，记录旧计数和 chunk 状态，而不保存旧行 payload。已有 chunk 会移入 `<table>.overwrite-backup/`，`.ready` 标记表示备份已完整准备。删除 overwrite 日志是提交点；若之后的备份清理失败，后续访问会先验证已提交 chunk 集合，再删除残留备份。append 使用独立日志；若追加过程中已有新 chunk 写出但后续失败，运行时会移除这些部分 chunk，并保持旧表可读。恢复会先解决待处理 append、再解决待处理 overwrite；返回数据前会校验日志封装和完整 chunk 集合。

单文件发布使用绑定表名的 v2 commit marker，记录前后代 storage token、hash 与物理记录数；恢复会直接从磁盘解析持久化元数据 token。canonical v1 marker 继续兼容；临时证据必须是 v2 `committed` marker，且表名、目标 token、主文件 hash 和物理计数全部匹配，否则 fail-closed。非 marker 恢复场景中，缺失或损坏的数据主文件只能从有效数据备份恢复。

元数据发布使用更严格的备份规则：只有主文件缺失时才可从有效 metadata backup 恢复；主文件存在但不可读或格式损坏时会 fail-closed，不使用可能陈旧的备份。发布与恢复都必须成功移除旧 backup 才算完成。update/delete 以表的 `createdAt` 代际为条件，create 以表名仍缺失为条件；共享 mutation epoch 会让其他 adapter 刷新元数据、存储 mode、缓存 namespace 与索引，稳定读取在代际变化时进行有界重试。

文件处理器会通过跨实例共享的进程内 FIFO 队列，串行处理同一物理表路径上的操作；锁等待最多 30 秒，且该机制不提供跨进程锁。若可恢复 mutation 超过截止时间，运行时会观察底层不可取消操作直至结束，并在释放路径锁前回滚。

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
await overwrite('users', [{ id: '1', name: 'Alice v2' }]);
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

行为说明：

- 保留操作顺序；
- 内部会对纯插入场景走专门的优化路径；
- 支持在事务中使用；
- 更新和删除按传入的 `where` 条件匹配记录，包含没有 `id` 字段的行；
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
findOne<T extends object = StorageRecord>(tableName, {
  where: FilterCondition<T>;
  encrypted?: boolean;
  requireAuthOnAccess?: boolean;
}): Promise<T | null>
```

返回第一条命中的记录；若没有命中则返回 `null`。

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

签名结构：

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

`skip` 和 `limit` 必须是非负安全整数。`limit: 0` 返回空页；负数、小数、非有限数或超出安全整数范围的值会抛出 `RangeError`，不会被数组切片静默换算。

#### 支持的查询操作符

| 操作符  | 语义             | 示例                                                  |
| ------- | ---------------- | ----------------------------------------------------- |
| `$and`  | 多个条件同时成立 | `{ $and: [{ active: true }, { age: { $gte: 18 } }] }` |
| `$or`   | 任一条件成立即可 | `{ $or: [{ role: 'admin' }, { role: 'moderator' }] }` |
| `$eq`   | 精确相等         | `{ age: { $eq: 21 } }`                                |
| `$ne`   | 不等于           | `{ status: { $ne: 'archived' } }`                     |
| `$gt`   | 大于             | `{ price: { $gt: 100 } }`                             |
| `$gte`  | 大于等于         | `{ score: { $gte: 90 } }`                             |
| `$lt`   | 小于             | `{ stock: { $lt: 10 } }`                              |
| `$lte`  | 小于等于         | `{ retries: { $lte: 3 } }`                            |
| `$in`   | 在候选集合中     | `{ role: { $in: ['admin', 'editor'] } }`              |
| `$nin`  | 不在候选集合中   | `{ status: { $nin: ['deleted', 'blocked'] } }`        |
| `$like` | SQL 风格模糊匹配 | `{ email: { $like: '%@example.com' } }`               |

#### 排序说明

当前 `sortAlgorithm` 可接受：

- `default`
- `fast`
- `counting`
- `merge`
- `slow`

如果你不强制指定算法，运行时会根据数据规模和排序形态自动选择更合适的实现。

所有受支持的算法在升序和降序下都会保持 `null`、`undefined` 的相对顺序，并将它们放在结果末尾。

## 更新与删除 API

### `update(tableName, data, options)`

```ts
const updatedCount = await update('users', { active: false }, { where: { id: '1' } });
```

操作符更新示例：

```ts
const updatedCount = await update('accounts', { $inc: { balance: -200 } }, { where: { id: 'acct-1' } });
```

返回命中的并已更新的记录数。

#### 支持的更新操作符

| 操作符      | 语义             | 示例                               |
| ----------- | ---------------- | ---------------------------------- |
| `$inc`      | 数值递增或递减   | `{ $inc: { balance: -200 } }`      |
| `$set`      | 显式赋值         | `{ $set: { status: 'active' } }`   |
| `$unset`    | 删除字段         | `{ $unset: ['temporaryField'] }`   |
| `$push`     | 向数组追加单个值 | `{ $push: { tags: 'new' } }`       |
| `$pull`     | 从数组移除匹配值 | `{ $pull: { tags: 'obsolete' } }`  |
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
- 事务所在表面同样由 `encrypted` 和 `requireAuthOnAccess` 决定；
- 显式回滚只丢弃排队操作，不重写表文件；提交部分失败时会恢复已有表快照，并移除事务中新建的表；
- commit 执行和 commit 失败后的快照恢复使用模块私有 symbol capability 进行直接写；在公开 options 中加入 `directWrite` 属性不能绕过事务暂存；
- 活动事务期间 AutoSync 会保留脏数据且不执行存储写；事务结束后的后续定时或显式 sync 才可能刷出这些数据；
- 事务仅在进程内协调，不提供崩溃持久化或跨进程 ACID 语义。

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

`storageFolder` 只接受单一目录名，路径分隔符、编码后的分隔符和路径穿越名称都会被拒绝。请在首次存储操作前配置；适配器运行期间修改该值会被拒绝，以防元数据或缓存状态跨根目录混用。

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
2. 受支持的 `LITE_STORE_*` 环境变量
3. 一个 Expo 运行时配置来源
4. 配置管理器的程序化覆盖

运行时配置层不会合并每一种宿主来源。在 Expo、React Native 或测试运行时中，它会按以下顺序选择第一个可用来源：`global.__expoConfig.extra.liteStore`、`expo-constants`（`getConfig()`、`expoConfig`、`manifest` 或 `extra`）、`global.expo.extra.liteStore`，最后才回退到 `global.liteStoreConfig`。

### Logger 环境变量

`EXPO_LITE_DATA_STORE_LOG_LEVEL` 支持 `silent`、`error`、`warn`、`info`、`debug`，非测试环境默认 `warn`。测试默认 `silent`；仅在诊断测试时设置 `EXPO_LITE_DATA_STORE_TEST_LOGS=1` 开启 `debug` 输出。这两个变量控制内部 logger，不属于 `configManager` 配置项。

### `app.json` 示例

`autoSync.enabled` 默认是 `false`。下面的示例表示显式开启后台脏缓存同步。`autoSync.batchSize` 限制一次同步中每张表处理的脏缓存条目数；它不会把一次整表覆盖拆成记录级写入。活动事务期间触发的 sync 会保留脏数据，留给后续定时或显式 sync 处理。

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
- `decryptBulk()` 会逐条识别 legacy CTR 与当前 GCM payload，按 provider 批量解密并按输入顺序返回，支持同批混合格式；
- `requireAuthOnAccess: true` 采用严格语义，当运行时无法真正强制逐次访问认证时，会抛出 `AUTH_ON_ACCESS_UNSUPPORTED`；
- 严格密钥作用域绝不会从常规主密钥静默派生或替代；若试图原地把既有加密数据升级为严格认证、切换字段级/整表级加密或修改加密字段，在应用显式迁移并验证数据前会以 `MIGRATION_FAILED` 失败；
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

| 错误码                       | 含义                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `EXPO_MODULE_MISSING`        | 缺少必需的 Expo 运行时包                                                |
| `AUTH_ON_ACCESS_UNSUPPORTED` | 当前运行时无法兑现严格逐次访问认证                                      |
| `PERMISSION_DENIED`          | 通过明文表面访问加密表，或未用严格认证表面访问严格表/列出严格表时被拒绝 |
| `TABLE_NOT_FOUND`            | 请求的表不存在                                                          |
| `TABLE_NAME_INVALID`         | 表名为空或不合法                                                        |
| `TABLE_COLUMN_INVALID`       | 列定义使用了不支持的类型                                                |
| `QUERY_FAILED`               | 查询引擎执行条件失败                                                    |
| `MIGRATION_FAILED`           | 表迁移失败，或既有加密/严格认证策略需要显式迁移密钥与数据               |
| `TRANSACTION_IN_PROGRESS`    | 当前表面已经存在一个活动事务                                            |
| `NO_TRANSACTION_IN_PROGRESS` | 没有活动事务却调用了 `commit()` 或 `rollback()`                         |
| `LOCK_TIMEOUT`               | 并发写锁获取超时                                                        |
| `TIMEOUT`                    | 操作超过了配置的超时预算                                                |
| `CORRUPTED_DATA`             | 磁盘数据无法安全解析                                                    |

### `CryptoError`

加密辅助流程中的特定失败路径可能会抛出 `CryptoError`。

## 高级导出

### `CryptoService`

`CryptoService` 面向需要更底层加密模块表面的高级使用者，而不是普通业务调用。

## 相关文档

- 消费者文档： [../README.zh-CN.md](../README.zh-CN.md)
- 英文 API 参考： [./API.en.md](./API.en.md)
- 运行时 QA 指南： [./EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)
- 变更日志： [./CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)
