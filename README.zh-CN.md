# expo-lite-data-store

面向 Expo 应用的本地结构化存储库，已针对 Expo SDK 54 下的 Expo Go、managed app 和原生开发构建完成运行时验证。

[README 入口](./README.md) | [English](./README.en.md) | [API 参考](./docs/API.zh-CN.md) | [运行时 QA 指南](./docs/EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./docs/CHANGELOG.zh-CN.md)

## 概览

`expo-lite-data-store` 适合这样一类 Expo 项目：希望把数据稳定地保存在本地设备上，需要比零散 JSON 文件更清晰的结构化操作能力，但又不想为了本地存储直接引入一整套远程数据库方案。

本库当前围绕以下运行时约束设计：

- 延迟初始化，导入包本身不会立刻触发存储访问或 Expo 原生模块加载；
- 明确的 Expo 安装契约，不把宿主应用必需的 Expo 原生模块偷偷打进库本身；
- 同时支持明文存储和加密存储；
- 对 Expo Go 下可支持的能力范围给出明确边界；
- 在原生开发构建或独立应用中支持可选的原生加密加速；
- 支持从历史 beta 根目录迁移到稳定的 `lite-data-store` 根目录。

## 支持矩阵

| 运行面 | 状态 |
| --- | --- |
| Expo SDK | `54.x` |
| React | `19.1.x` |
| React Native | `0.81.x` |
| Managed App | 支持 |
| Expo Go | 支持本文档定义的运行契约 |
| Native Dev Client / 独立应用 | 支持，且推荐用于原生加密性能验证 |

## 安装

本库不支持把 `npm install expo-lite-data-store` 当作唯一安装步骤。

对 Expo SDK 54 而言，唯一受支持的基础安装命令是：

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

| 契约 | 状态 | 说明 |
| --- | --- | --- |
| `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store` | 正式支持 | Expo SDK 54 下的 managed-compatible 安装契约 |
| 在上一条基础上额外安装 `react-native-quick-crypto` | 正式支持 | 用于 native dev client 或独立应用中的原生旗舰加密验证 |
| 仅执行 `npm install expo-lite-data-store` | 不支持 | 可能导致 Expo peer 依赖缺失或版本未对齐 |

### 必需运行时包

| 包名 | 用途 |
| --- | --- |
| `expo-file-system` | 负责表文件、chunk 文件、元数据文件和目录管理 |
| `expo-constants` | 负责从 `app.json` 读取运行时配置，并识别 Expo 运行环境 |
| `expo-crypto` | 负责随机数、哈希和 Expo 兼容的加密辅助流程 |
| `expo-secure-store` | 负责安全存储派生后的主密钥材料 |

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

如果初始数据明显超过配置的 chunk 阈值，运行时也可能自动切换到 chunked 存储方式。

### 列定义

`createTable()` 接受 `columns` 配置。当前运行时接受以下列类型：

- `string`
- `number`
- `boolean`
- `date`
- `blob`

列定义主要用于表元数据和写入验证，公开 API 里的记录本质上仍然是普通 JavaScript 对象。

### 写入数据

当你希望追加新记录时，使用 `insert()`：

```ts
await db.insert('events', { id: 'evt-1', type: 'login' });
```

当你希望逻辑上替换整张表的内容时，使用 `overwrite()`：

```ts
await db.overwrite('cache', [
  { id: 'cfg', version: 2, payload: { theme: 'dark' } },
]);
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

当前支持的查询操作符如下：

| 操作符 | 含义 |
| --- | --- |
| `$and` | 对多个条件做逻辑与 |
| `$or` | 对多个条件做逻辑或 |
| `$eq` | 精确相等 |
| `$ne` | 不相等 |
| `$gt` | 大于 |
| `$gte` | 大于等于 |
| `$lt` | 小于 |
| `$lte` | 小于等于 |
| `$in` | 值或数组成员出现在候选集合中 |
| `$nin` | 值或数组成员不在候选集合中 |
| `$like` | 使用 `%` 和 `_` 的 SQL 风格模糊匹配 |

### 更新记录

`update()` 会把更新数据应用到所有命中 `where` 的记录上。

简单字段更新：

```ts
await db.update(
  'users',
  { active: false },
  { where: { id: '2' } }
);
```

基于操作符的更新：

```ts
await db.update(
  'accounts',
  { $inc: { balance: -200 } },
  { where: { id: 'acct-1' } }
);
```

当前支持的更新操作符如下：

| 操作符 | 含义 |
| --- | --- |
| `$inc` | 数值递增或递减 |
| `$set` | 显式设置字段值 |
| `$unset` | 删除字段 |
| `$push` | 向数组字段追加一个值 |
| `$pull` | 从数组字段移除匹配值 |
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

### 事务

事务是显式且有状态的：

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

当前事务行为需要注意：

- 同一适配器表面一次只能有一个活动事务；
- 在未结束前再次调用 `beginTransaction()` 会抛出 `TRANSACTION_IN_PROGRESS`；
- 没有活动事务时调用 `commit()` 或 `rollback()` 会抛出 `NO_TRANSACTION_IN_PROGRESS`。

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
2. 环境变量
3. 来自 `app.json` / `app.config.*` 的 Expo 运行时配置
4. `global.liteStoreConfig`
5. 通过 `configManager.setConfig()`、`configManager.updateConfig()`、`configManager.set()` 注入的程序化配置

在 Expo 运行时配置内部，加载顺序为：

1. `global.__expoConfig`
2. `expo-constants.getConfig()`
3. `Constants.expoConfig`
4. `Constants.manifest`
5. `Constants.extra.liteStore`
6. `global.expo.extra.liteStore`

### 常用运行时配置项

| Key | 默认值 | 作用 |
| --- | --- | --- |
| `chunkSize` | `5242880` | chunk 切分阈值，单位为字节 |
| `storageFolder` | `lite-data-store` | Expo 文件系统下的根目录名 |
| `sortMethods` | `default` | 默认排序策略提示 |
| `timeout` | `10000` | 部分文件操作的超时时间 |
| `encryption.algorithm` | `auto` | 首选加密算法模式 |
| `encryption.keyIterations` | `600000` | PBKDF2 目标迭代次数，Expo Go 下会自动下调 |
| `performance.maxConcurrentOperations` | `5` | 写入侧最大并发数 |
| `cache.maxSize` | `1000` | 缓存项预算 |
| `monitoring.enablePerformanceTracking` | `false` | 是否开启性能采样 |
| `monitoring.enableHealthChecks` | `true` | 是否开启健康检查 |
| `autoSync.enabled` | `true` | 自动同步服务开关 |
| `autoSync.interval` | `30000` | 自动同步间隔，单位毫秒 |
| `autoSync.minItems` | `1` | 触发自动同步前的最小排队项数 |
| `autoSync.batchSize` | `100` | 每批自动同步的最大项目数 |

### 当前支持的环境变量

| 环境变量 | 对应配置 |
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

### Expo Go 边界

常规加密存储在 Expo Go 中可用。

`requireAuthOnAccess: true` 采用严格语义；当当前运行时无法真正强制“每次访问都认证”时，库会直接抛出 `AUTH_ON_ACCESS_UNSUPPORTED`。

这意味着：

- Expo Go 适合验证明文存储、chunked 存储和常规加密存储；
- Expo Go 不适合验证生物识别或严格逐次访问认证保证；
- 依赖 `react-native-quick-crypto` 的原生性能验证应在 native dev client 或独立应用中完成。

### 既有设备数据

稳定 2.x 运行时会继续兼容较早 beta 版本产生的设备端数据格式，包括：

- 元数据文件；
- 明文表文件；
- chunked 表布局；
- 历史 beta 产生的加密负载格式。

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
- 变更日志： [docs/CHANGELOG.zh-CN.md](./docs/CHANGELOG.zh-CN.md)
- 英文变更日志： [docs/CHANGELOG.en.md](./docs/CHANGELOG.en.md)
- 架构说明： [docs/ARCHITECTURE.zh-CN.md](./docs/ARCHITECTURE.zh-CN.md)
- 贡献指南： [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)
- 安全策略： [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)
- README 入口页： [README.md](./README.md)
- 英文开发者文档： [README.en.md](./README.en.md)

## 许可证

[MIT](./LICENSE.txt)
