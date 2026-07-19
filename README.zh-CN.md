# 🍃 expo-lite-data-store

面向 Expo 应用的本地结构化存储库，已针对 Expo SDK 56 下的 Expo Go、managed app 和原生开发构建完成运行时验证。

[README 入口](./README.md) | [English](./README.en.md) | [API 参考](./docs/API.zh-CN.md) | [运行时 QA 指南](./docs/EXPO_RUNTIME_QA.zh-CN.md) | [CI/CD 运维](./docs/CI_CD.zh-CN.md) | [变更日志](./docs/CHANGELOG.zh-CN.md)

## 概览

`expo-lite-data-store` 适合这样一类 Expo 项目：希望把数据稳定地保存在本地设备上，需要比零散 JSON 文件更清晰的结构化操作能力，但又不想为了本地存储直接引入一整套远程数据库方案。

本库当前围绕以下运行时约束设计：

- 延迟初始化，导入包本身不会立刻触发存储访问或 Expo 原生模块加载；
- 明确的 Expo 安装契约，不把宿主应用必需的 Expo 原生模块偷偷打进库本身；
- 同时支持明文存储和加密存储；
- 对 Expo Go 下可支持的能力范围给出明确边界；
- 在原生开发构建或独立应用中支持可选的原生加密加速；
- 支持从历史 beta 根目录迁移到稳定的 `lite-data-store` 根目录。

> **v3 迁移：**`plainStorage` 和 `expo-lite-data-store/dist/js/...` 等包内深层导入不再属于公开 API。请改从 `expo-lite-data-store` 根入口导入 `db` facade 或命名 API。对以 `encrypted: true` 创建的表，后续调用也必须显式传入 `encrypted: true`；明文表面访问会被拒绝。

## 支持矩阵

| 运行面                       | 状态                             |
| ---------------------------- | -------------------------------- |
| Expo SDK                     | `56.x`                           |
| React                        | `19.2.x`                         |
| React Native                 | `0.85.x`                         |
| Managed App                  | 支持                             |
| Expo Go                      | 支持本文档定义的运行契约         |
| Native Dev Client / 独立应用 | 支持，且推荐用于原生加密性能验证 |

## 安装

本库不支持把 `npm install expo-lite-data-store` 当作唯一安装步骤。

对 Expo SDK 56 而言，唯一受支持的基础安装命令是：

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

即使包管理器显示安装完成，也应将“只执行 `npm install expo-lite-data-store`”视为不完整安装。

`react-native-quick-crypto` 是可选 peer 依赖。只有当应用需要在原生开发构建或独立应用中启用原生旗舰加密提供者时，才需要额外安装：

```bash
npx expo install react-native-quick-crypto
```

### 为什么 Expo 运行时包保持在 `peerDependencies`

发布包只包含编译后的 JavaScript 与类型声明。Expo 运行时模块被刻意保留为 peer 依赖，因为它们本质上属于消费应用自己的原生依赖树。

这样做可以避免以下问题：

- 宿主应用与库内部使用的 Expo 原生模块版本不一致；
- npm 安装成功，但运行时仍然找不到 Expo 原生模块；
- Expo Go、开发构建和独立应用之间出现原生依赖假设漂移。

### 安装契约

| 契约                                                                                                  | 状态     | 说明                                                  |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store` | 正式支持 | Expo SDK 56 下的 managed-compatible 安装契约          |
| 在上一条基础上额外安装 `react-native-quick-crypto`                                                    | 正式支持 | 用于 native dev client 或独立应用中的原生旗舰加密验证 |
| 仅执行 `npm install expo-lite-data-store`                                                             | 不支持   | 可能导致 Expo peer 依赖缺失或版本未对齐               |

### 必需运行时包

| 包名                | 用途                                                   |
| ------------------- | ------------------------------------------------------ |
| `expo-file-system`  | 负责表文件、chunk 文件、元数据文件和目录管理           |
| `expo-constants`    | 负责从 `app.json` 读取运行时配置，并识别 Expo 运行环境 |
| `expo-crypto`       | 负责随机数、哈希和 Expo 兼容的加密辅助流程             |
| `expo-secure-store` | 负责安全存储派生后的主密钥材料                         |

`expo-modules-core` 也会作为 Expo 原生模块桥接层被内部使用，但它由宿主 Expo 运行时提供，不作为单独的 consumer 安装契约项暴露给使用者。

### 运行时缺包提示

如果宿主 Expo 应用缺少必需运行时包，库会抛出 `StorageError`，错误码为 `EXPO_MODULE_MISSING`。

错误详情会指出当前缺失的模块，错误建议会回到唯一受支持的安装命令：

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

这类错误应被视为消费应用安装契约失败，而不是可忽略的运行时警告。

## 快速开始

### 1. 安装正式支持的依赖组合

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

### 2. 可选：在 `app.json` 中定义运行时配置

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

### 3. 创建表并写入记录

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

`db.init()` 是可选且幂等的。所有公开 API 在第一次真实调用时都会走同一套延迟初始化路径。

## 使用说明

### 如何选择存储模式

以下场景更适合 `mode: 'single'`：

- 表规模较小；
- 更新通常会整体替换表内容；
- 你更关心简单性，而不是极大文件的处理能力。

以下场景更适合 `mode: 'chunked'`：

- 表可能增长为较大的本地数据集；
- 你预期会频繁追加或覆盖大批量记录；
- 希望在超过阈值时让运行时自动切分为多个 chunk 文件。

建表时若传入 `initialData`，其序列化大小估算值只有在超过 `chunkSize` 一半时才会自动选择 chunked 模式；默认 `chunkSize` 为 5 MiB，因此默认门槛是超过 2.5 MiB。后续写入不会隐式把单文件表迁移为 chunked；需要转换时请显式设置 `mode: 'chunked'` 或调用 `migrateToChunked()`。

chunked 覆盖写使用有界 v2 日志：日志只记录旧计数和 chunk 状态，不复制旧记录；已有 chunk 会移入 `<table>.overwrite-backup/`，并以 `.ready` 标记区分完整备份。删除 overwrite 日志是提交点；若提交后的备份清理失败，后续访问会先校验当前表，再删除残留备份。chunked 追加写也使用恢复日志，并在失败时移除已写出的部分 chunk。运行时会先解决待处理的追加日志、再解决待处理的覆盖写；追加写会先提交元数据、再移除恢复日志；读取遇到不完整 chunk 集合时会明确报错，而不是静默返回部分数据。single-to-chunked 迁移会先发布并校验新 chunk 集合，再切换元数据 mode；mode 切换是提交点，之后清理旧单文件工件失败不会回滚已经提交的模式。

单文件表采用可恢复发布。v2 commit marker 会绑定表名，并记录前后两代 storage commit token、SHA-256 hash 和物理记录数。恢复时直接读取磁盘上的持久化元数据快照，不信任适配器内的缓存 token。canonical v1 marker 只为兼容而保留；临时 marker 仅在它是 v2 `committed`、表名和目标 token 与持久化元数据一致、hash/count 与主文件一致时才可采信，任何不匹配都会 fail-closed 并保留证据。非 marker 恢复场景中，主文件缺失或损坏时也只能从有效的数据备份恢复。

文件处理器会通过跨实例共享的进程内 FIFO 队列，串行处理同一物理表路径上的操作；锁等待上限为 30 秒。若可恢复 mutation 超过截止时间，运行时不会放弃仍不可取消的底层文件操作，而是等待其结束、回滚后再释放路径锁。该协调不提供跨进程锁语义。

元数据 flush 使用另一条按元数据文件键控的进程级 FIFO，锁等待上限同样为 30 秒。每次 flush 都会重新读取最新磁盘快照；update/delete 必须匹配预期 `createdAt` 代际，create 则要求表名仍然缺失，因此陈旧 mutation 不能修改或覆盖同名新代际。共享 mutation epoch 会让其他 adapter 刷新元数据、存储表示、读取缓存 namespace 与索引；稳定读取会按最新 mode 重试。失败或超时的 mutation 会保留，等待显式重试。元数据主文件缺失时，初始化只会恢复结构有效的 backup；主文件存在但损坏时绝不回退到可能陈旧的 backup。发布与恢复都必须成功移除旧 backup 才算完成。该机制仍只协调当前进程，不是跨进程元数据锁。

### 列定义

`createTable()` 接受 `columns` 配置。当前运行时接受以下列类型：

- `string`
- `number`
- `boolean`
- `date`
- `blob`

列定义主要用于表元数据和写入验证，公开 API 里的记录本质上仍然是普通 JavaScript 对象。

记录不强制要求包含 `id` 或 `_id`。这些字段适合作为业务标识，也能在存在索引时帮助加速；但基于 `where` 的更新、删除、批量操作和事务路径会按查询引擎实际命中的行来处理，所以没有 id 的记录也会被安全地逐行匹配。内存索引优先使用字符串或有限数值形式的 `id`，仅在 `id` 不稳定时回退到 `_id`。只要索引覆盖的任一行没有稳定标识符，该索引就不会参与查询加速，查询会回退到全表扫描。增量写入只暂存受影响 bucket 的 delta，并在物理存储成功后发布。

### 写入数据

当你希望追加新记录时，使用 `insert()`：

```ts
await db.insert('events', { id: 'evt-1', type: 'login' });
```

当你希望逻辑上替换整张表的内容时，使用 `overwrite()`：

```ts
await db.overwrite('cache', [{ id: 'cfg', version: 2, payload: { theme: 'dark' } }]);
```

当前运行时返回的 `WriteResult` 结构如下：

```ts
type WriteResult = {
  written: number;
  totalAfterWrite: number;
  chunked: boolean;
  chunks?: number;
};
```

在当前实现里：

- `written` 表示本次操作写入或影响的记录数；
- `totalAfterWrite` 表示操作完成后表中的总记录数；
- `chunked` 表示当前表是否处于 chunked 模式。

### 读取和查询

当你的语义是“直接拿到表里当前存储的内容”时，使用 `read()`：

```ts
const rows = await db.read('users');
```

`read()` 是原始表读取，不负责应用过滤条件、排序或分页。即使你在 options 中传了这些字段，顶层公开 API 也会忽略它们。

当你需要真正的查询语义时，使用 `findOne()` 或 `findMany()`：

```ts
const expensiveElectronics = await db.findMany('products', {
  where: {
    $and: [{ category: 'Electronics' }, { price: { $gt: 100 } }],
  },
  sortBy: 'price',
  order: 'desc',
  limit: 20,
});
```

`skip` 和 `limit` 必须是非负安全整数。`limit: 0` 返回空页；负数、小数、非有限数或超出安全整数范围的值会抛出 `RangeError`，不会交给数组切片静默换算。该输入校验错误会以原始 `RangeError` 交给调用方，不会再包装成 `StorageError`。

所有受支持的排序算法在升序和降序下都会保持 `null`、`undefined` 的相对顺序，并把它们放在结果末尾。

当前支持的查询操作符如下：

| 操作符  | 含义                                |
| ------- | ----------------------------------- |
| `$and`  | 对多个条件做逻辑与                  |
| `$or`   | 对多个条件做逻辑或                  |
| `$eq`   | 精确相等                            |
| `$ne`   | 不相等                              |
| `$gt`   | 大于                                |
| `$gte`  | 大于等于                            |
| `$lt`   | 小于                                |
| `$lte`  | 小于等于                            |
| `$in`   | 值或数组成员出现在候选集合中        |
| `$nin`  | 值或数组成员不在候选集合中          |
| `$like` | 使用 `%` 和 `_` 的 SQL 风格模糊匹配 |

### 更新记录

`update()` 会把更新数据应用到所有命中 `where` 的记录上。

简单字段更新：

```ts
await db.update('users', { active: false }, { where: { id: '2' } });
```

基于操作符的更新：

```ts
await db.update('accounts', { $inc: { balance: -200 } }, { where: { id: 'acct-1' } });
```

当前支持的更新操作符如下：

| 操作符      | 含义                         |
| ----------- | ---------------------------- |
| `$inc`      | 数值递增或递减               |
| `$set`      | 显式设置字段值               |
| `$unset`    | 删除字段                     |
| `$push`     | 向数组字段追加一个值         |
| `$pull`     | 从数组字段移除匹配值         |
| `$addToSet` | 仅当数组中不存在该值时再追加 |

### 批量操作

`bulkWrite()` 接收按顺序执行的 `insert`、`update`、`delete` 操作数组：

```ts
await db.bulkWrite('users', [
  { type: 'insert', data: { id: '3', name: 'Carol' } },
  { type: 'update', data: { $set: { active: true } }, where: { id: '2' } },
  { type: 'delete', where: { active: false } },
]);
```

当业务流程希望用一次高层调用描述一组有顺序要求的本地变更时，这个 API 很适合。

### 删除表

`deleteTable()` 会先提交元数据删除，再清理物理文件。若元数据提交失败，运行时会恢复原元数据，且不会触碰物理数据。提交成功后，元数据缺失就是权威删除状态，残留文件不能让表复活；若工件清理失败，该表仍保持逻辑不存在，再次调用 `deleteTable()` 会重试清理。同名重建会先清除全部孤立单文件、chunk、journal、marker 和 backup 工件。

### 事务

事务是显式且有状态的：

```ts
await db.beginTransaction();

try {
  await db.update('accounts', { $inc: { balance: -200 } }, { where: { id: 'acct-1' } });
  await db.update('accounts', { $inc: { balance: 200 } }, { where: { id: 'acct-2' } });
} catch (error) {
  await db.rollback();
  throw error;
}

// commit 失败时会在内部恢复快照，然后重新抛出错误。
await db.commit();
```

当前事务行为需要注意：

- 同一适配器表面一次只能有一个活动事务；
- 在未结束前再次调用 `beginTransaction()` 会抛出 `TRANSACTION_IN_PROGRESS`；
- 没有活动事务时调用 `commit()` 或 `rollback()` 会抛出 `NO_TRANSACTION_IN_PROGRESS`；
- 事务 owner 通过 `read()`、`countTable()`、`findOne()` 和 `findMany()` 具备 read-your-writes 可见性；过滤、排序和分页基于暂存视图执行，`remove()` 返回该视图中实际命中的记录数；
- 排队的可序列化记录输入、对象形式的查询值和事务查询结果与调用方后续的对象修改相隔离；
- 在活动事务 owner 的匹配存储表面上，公开的 schema 操作 `createTable()`、`deleteTable()` 和 `migrateToChunked()` 会以 `TRANSACTION_OPERATION_NOT_SUPPORTED` 被拒绝，因为它们会立即持久化元数据或文件；其他 adapter 或安全表面会先由既有事务 guard 拒绝；
- 显式回滚只丢弃排队写入，不会重写表文件；若提交执行到一半失败，已有表会恢复，事务中新建的表会被移除；
- commit 执行和 commit 失败后的快照恢复使用模块私有 symbol capability 进行直接写；公开 options 中伪造 `directWrite` 不能绕过事务暂存；
- 活动事务期间 AutoSync 会保留脏缓存项，只有事务结束后的后续定时或显式 sync 才会写入；
- 事务是进程内协调能力，不是跨进程或应用崩溃后仍可恢复的 ACID 实现。

### 计数与校验

当你需要快速读取当前记录数时，使用 `countTable()`：

```ts
const total = await db.countTable('users');
```

当你需要排查元数据是否漂移时，使用 `verifyCountTable()`：

```ts
const result = await db.verifyCountTable('users');
// { metadata: number, actual: number, match: boolean }
```

`verifyCountTable()` 会比 `countTable()` 慢，因为它会把元数据计数与真实磁盘数据做比对，并在检测到不一致时进行修复。

## 配置说明

### 配置优先级

当前运行时从低到高按以下顺序合并配置：

1. `defaultConfig` 内建默认值
2. 受支持的 `LITE_STORE_*` 环境变量
3. 一个 Expo 运行时配置来源
4. 通过 `configManager.setConfig()`、`configManager.updateConfig()`、`configManager.set()` 注入的程序化配置

运行时配置层不会合并每一种宿主来源。在 Expo、React Native 或测试运行时中，它会按以下顺序选择第一个可用来源：`global.__expoConfig.extra.liteStore`、`expo-constants`（`getConfig()`、`expoConfig`、`manifest` 或 `extra`）、`global.expo.extra.liteStore`，最后才回退到 `global.liteStoreConfig`。

### 常用运行时配置项

| Key                                    | 默认值            | 作用                                                |
| -------------------------------------- | ----------------- | --------------------------------------------------- |
| `chunkSize`                            | `5242880`         | 分片目标大小；初始数据自动选 chunked 的门槛为其一半 |
| `storageFolder`                        | `lite-data-store` | Expo 文件系统下的根目录名                           |
| `sortMethods`                          | `default`         | 默认排序策略提示                                    |
| `timeout`                              | `10000`           | 部分文件操作的超时时间                              |
| `encryption.algorithm`                 | `auto`            | 首选加密算法模式                                    |
| `encryption.keyIterations`             | `600000`          | PBKDF2 目标迭代次数，Expo Go 下会自动下调           |
| `performance.maxConcurrentOperations`  | `5`               | 写入侧最大并发数                                    |
| `cache.maxSize`                        | `1000`            | 缓存项预算                                          |
| `monitoring.enablePerformanceTracking` | `false`           | 是否开启性能采样                                    |
| `monitoring.enableHealthChecks`        | `true`            | 是否开启健康检查                                    |
| `autoSync.enabled`                     | `false`           | 自动同步服务开关；需要后台脏缓存同步时显式开启      |
| `autoSync.interval`                    | `30000`           | 自动同步间隔，单位毫秒                              |
| `autoSync.minItems`                    | `1`               | 触发自动同步前的最小排队项数                        |
| `autoSync.batchSize`                   | `100`             | 每次自动同步中每张表最多处理的脏缓存条目数          |

`storageFolder` 只能是单一目录名，不能包含路径分隔符、编码后的分隔符或路径穿越名称。请在首次存储操作前完成配置；适配器运行期间修改该值会被明确拒绝，避免不同根目录间混用元数据和缓存状态。

### 当前支持的环境变量

| 环境变量                                           | 对应配置                              |
| -------------------------------------------------- | ------------------------------------- |
| `LITE_STORE_CHUNK_SIZE`                            | `chunkSize`                           |
| `LITE_STORE_STORAGE_FOLDER`                        | `storageFolder`                       |
| `LITE_STORE_SORT_METHODS`                          | `sortMethods`                         |
| `LITE_STORE_TIMEOUT`                               | `timeout`                             |
| `LITE_STORE_ENCRYPTION_KEY_ITERATIONS`             | `encryption.keyIterations`            |
| `LITE_STORE_PERFORMANCE_MAX_CONCURRENT_OPERATIONS` | `performance.maxConcurrentOperations` |
| `LITE_STORE_PERFORMANCE_MEMORY_WARNING_THRESHOLD`  | `performance.memoryWarningThreshold`  |
| `LITE_STORE_CACHE_MAX_SIZE`                        | `cache.maxSize`                       |
| `LITE_STORE_CACHE_DEFAULT_EXPIRY`                  | `cache.defaultExpiry`                 |
| `LITE_STORE_AUTO_SYNC_ENABLED`                     | `autoSync.enabled`                    |
| `LITE_STORE_AUTO_SYNC_INTERVAL`                    | `autoSync.interval`                   |

Logger 控制项独立于 `configManager`。`EXPO_LITE_DATA_STORE_LOG_LEVEL` 支持 `silent`、`error`、`warn`、`info`、`debug`，非测试环境默认 `warn`。测试默认静默，避免大规模测试撑满本地磁盘或 CI 日志；设置 `EXPO_LITE_DATA_STORE_TEST_LOGS=1` 可开启测试 `debug` 输出。

### 程序化配置

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

当前公开的配置管理器能力包括：

- `configManager.getConfig()`
- `configManager.setConfig(partialConfig)`
- `configManager.updateConfig(partialConfig)`
- `configManager.resetConfig()`
- `configManager.get(path)`
- `configManager.set(path, value)`

## 加密与安全边界

### 明文与加密表面

默认情况下，库使用明文存储适配器。若某次调用需要走加密存储表面，可以在 options 中传入 `encrypted: true`：

```ts
await db.createTable('profiles', {
  encrypted: true,
  encryptedFields: ['email', 'phone'],
});
```

当前可选的安全策略包括：

- 通过 `encryptedFields` 做字段级加密；
- 通过 `encryptFullTable: true` 做整表加密；
- 通过 `requireAuthOnAccess: true` 表达严格的逐次访问认证意图。

即使省略 `encrypted: true`，非空 `encryptedFields` 也会选择加密 facade。若加密写入在事务中隐式建表，解析后的字段列表会传入 commit，确保持久化策略与加密负载一致。

一次加密写入若隐式创建了未知表，会持久化所选加密策略。该策略不是每次调用都能切换的开关：对既有加密表改变 `encrypted`、`encryptFullTable`、`encryptedFields` 或 `requireAuthOnAccess` 都需要由应用控制的数据迁移。运行时会以 `MIGRATION_FAILED` fail-closed，而不会静默用不同策略重写数据。

对新建字段级加密表，只有 `encryptAllFields: true` 与 `encryptedFields: []` 的精确组合表示动态全字段加密，之后记录形态中新增的字段也会被加密。早期 v3 元数据没有该 marker；空列表或字段缺失仍按历史全局配置回退。整表加密在物理层只保存一条 envelope，其逻辑行数与同一 storage generation 一并提交；事务快照也会同时恢复两者。可选的解密缓存只在绑定当前精确 ciphertext 时才可命中，cache timeout 为 0 时完全禁用。

### Expo Go 边界

常规加密存储在 Expo Go 中可用。

`requireAuthOnAccess: true` 采用严格语义；当当前运行时无法真正强制“每次访问都认证”时，库会直接抛出 `AUTH_ON_ACCESS_UNSUPPORTED`。

严格访问使用独立的密钥作用域，不能把已有常规加密表原地升级。应由应用显式迁移数据：在旧密钥仍可用时通过常规加密表面读取数据，写入并验证一个新建的严格认证表，再退役旧表和旧密钥。库绝不会静默复用常规主密钥来满足严格访问。

这意味着：

- Expo Go 适合验证明文存储、chunked 存储和常规加密存储；
- Expo Go 不适合验证生物识别或严格逐次访问认证保证；
- 依赖 `react-native-quick-crypto` 的原生性能验证应在 native dev client 或独立应用中完成。

### 既有设备数据

稳定 3.x 运行时会继续兼容较早 beta 版本产生的设备端数据格式，包括：

- 元数据文件；
- 明文表文件；
- chunked 表布局；
- 历史 beta 产生的加密负载格式。

字段批量解密会逐条识别 legacy CTR 与当前 GCM payload，按 provider 分组解密后恢复原始顺序。因此升级后的同一存储批次即使混合两种格式，也能保持可读。

上述兼容不代表会把常规加密数据转换为严格访问数据或任何其他加密策略。若未经过应用控制的数据迁移就为已有加密表启用 `requireAuthOnAccess`、切换字段级/整表级加密或修改 `encryptedFields`，操作会以 `MIGRATION_FAILED` 失败。若适配器本身未按严格访问创建却请求严格访问，会以 `PERMISSION_DENIED` 失败；运行时绝不会替换为较弱的密钥。

当稳定默认根目录 `lite-data-store` 尚不存在，而旧目录 `expo-lite-data` 存在时，运行时会自动尝试兼容迁移。

## 性能与监控

库导出了 `performanceMonitor`，供高级使用者和维护者做本地性能观察。普通 CRUD 场景不需要先接入它，但当你需要分析本地操作表现时，它是现成入口。

当前可用的监控能力包括：

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

如果你的目标只是拿到发布级运行时证据，优先使用仓库自带的 QA baseline，而不是从零实现一套自定义监控流程。

## 故障排查

### 安装了包但抛出 `EXPO_MODULE_MISSING`

大概率是消费应用只安装了 tarball 名称，而没有按文档安装完整的 Expo 运行时依赖。请重新执行：

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

### `requireAuthOnAccess` 在 Expo Go 中失败

这是预期行为。Expo Go 不支持 `requireAuthOnAccess: true` 所要求的严格认证契约。请在 native dev client 或独立应用中验证该路径。

### Expo Go 下加密操作感觉更慢

这同样符合预期。运行时会为了可用性在 Expo Go 中主动降低 PBKDF2 迭代次数。若需要更高的原生加密性能验证，请使用安装了 `react-native-quick-crypto` 的原生构建。

## 发布验证

仓库提供了明确的发布基线 QA 命令：

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

如需连续执行两条基线：

```bash
npm run qa:baseline:release
```

这些命令会在 `artifacts/expo-runtime-qa/` 下生成工件目录。发布判断应以生成的 `summary.json` 为准，而不是瞬时截图或手动复制的界面结果。

## 文档入口

- API 参考： [docs/API.zh-CN.md](./docs/API.zh-CN.md)
- 英文 API 参考： [docs/API.en.md](./docs/API.en.md)
- 运行时 QA 流程、lane 定义、verdict 语义与工件结构： [docs/EXPO_RUNTIME_QA.zh-CN.md](./docs/EXPO_RUNTIME_QA.zh-CN.md)
- CI/CD 触发条件、npm 凭据、发布步骤与失败恢复： [docs/CI_CD.zh-CN.md](./docs/CI_CD.zh-CN.md)
- 变更日志： [docs/CHANGELOG.zh-CN.md](./docs/CHANGELOG.zh-CN.md)
- 英文变更日志： [docs/CHANGELOG.en.md](./docs/CHANGELOG.en.md)
- 架构说明： [docs/ARCHITECTURE.zh-CN.md](./docs/ARCHITECTURE.zh-CN.md)
- 贡献指南： [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)
- 安全策略： [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)
- README 入口页： [README.md](./README.md)
- 英文开发者文档： [README.en.md](./README.en.md)

## 许可证

[MIT](./LICENSE.txt)
