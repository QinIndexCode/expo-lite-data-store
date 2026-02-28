# expo-lite-data-store

---

**注意** 当前项目测试覆盖范围有限，可能存在未发现的问题。在生产环境中使用前，请务必进行充分测试。

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.73+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

**轻量、易配置、纯 TypeScript 编写的 Expo 本地数据库**

专为 React Native + Expo 项目设计，默认纯 TypeScript 无需任何 native 依赖；在打包后的独立应用中自动启用 react-native-quick-crypto 原生加速以提升 KDF 等重计算性能（Expo Go 中自动回退到 JavaScript 实现，并在开发模式下打印一次提示信息）。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

## ✨ 核心特性

| 特性                       | 描述                                           |
| -------------------------- | ---------------------------------------------- |
| 🚀 **易配置使用**          | 仅依赖 React Native FS，无需 Metro 配置        |
| 🔒 **可选加密**            | AES-CTR 加密，支持可选生物识别认证，密钥由系统自动生成和管理，默认 120,000 次 PBKDF2 迭代（移动设备优化）         |
| 📦 **智能分块**            | 自动处理 >5MB 文件，规避 RN FS 限制            |
| 🔄 **事务支持**            | 事务保证，数据一致性有保障                    |
| 📝 **TypeScript 原生支持** | 完整的类型定义，开箱即用                       |
| 🔍 **高级查询**            | 支持 where、skip、limit、sort 等查询选项       |
| 📱 **完全离线**            | 无需网络，数据 100% 存储在设备本地             |
| 🎯 **智能排序**            | 5种排序算法，根据数据量自动选择合适算法        |
| ⏰ **自动同步**            | 定期将缓存中的脏数据同步到磁盘，确保数据持久化 |
| 🛡️ **数据一致性验证**     | 提供 verifyCountTable 工具，验证并修复元数据与实际数据的一致性 |
| 📊 **批量操作**            | 支持批量插入、更新、删除操作，提高处理效率    |

## 📦 安装

```bash
npm install expo-lite-data-store
# 或使用 yarn / pnpm ( 目前只上传了npm,后续将会跟进yarn , pnpm)
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

## 🚀 快速开始

```typescript
// ES 模块导入
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// CommonJS 导入
// const { createTable, insert, findOne, findMany, update, remove } = require('expo-lite-data-store');

// 创建用户表
await createTable('users');

// 插入数据
await insert('users', [
  { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: '李四', age: 30, email: 'lisi@example.com' },
  { id: 3, name: '王五', age: 35, email: 'wangwu@example.com' },
]);

// 查询单条数据 - Prisma风格：将where作为options的一部分
const user = await findOne('users', {
  where: { id: 1 }
});
console.log(user); // { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' }

// 查询多条数据 - Prisma风格：将where作为options的一部分
const users = await findMany('users', {
  where: { age: { $gte: 30 } },
  sortBy: 'age',
  order: 'desc'
});
console.log(users); // 返回年龄 >= 30 的用户，按年龄降序排列

// 更新数据 - Prisma风格：将where作为options的一部分
await update('users', { age: 26 }, {
  where: { id: 1 }
});

// 更新数据 - 复杂条件（Prisma风格）
await update('users', { active: true }, {
  where: { age: { $gte: 30 } }
});

// 删除数据 - Prisma风格：将where作为options的一部分
await remove('users', {
  where: { id: 2 }
});

// 删除数据 - 复杂条件（Prisma风格）
await remove('users', {
  where: { age: { $lt: 18 } }
});
```

```javascript
// JavaScript 中使用方式相同
const { createTable, insert, findMany } = require('expo-lite-data-store');

// 或使用 ES 模块导入
// import { createTable, insert, findMany } from 'expo-lite-data-store';

await createTable('users');

await insert('users', [
  { id: 1, name: 'Alice', age: 25 },
  { id: 2, name: 'Bob', age: 30 },
]);

const users = await findMany('users', {
  where: {},
  sortBy: 'age',
  order: 'desc'
});

console.log(users);
```

## 🔒 加密使用说明

该库支持多种加密模式，包括非加密模式和加密模式。

### 加密模式

LiteStore 支持三种加密使用模式：

#### 1. 非加密模式（默认）

- 不使用任何加密算法
- 不触发任何生物识别或密码认证
- 数据以明文形式存储
- 适合非敏感数据

```typescript
// 非加密模式（默认）
await createTable('users');
await insert('users', { id: 1, name: '张三' });
```

#### 2. 加密模式

- 使用 AES-CTR 加密算法
- 不要求每次访问都进行生物识别认证
- 适合需要加密但不需要频繁生物识别的数据
- **默认加密方式**：字段级加密
- **默认加密字段**：`password`、`email`、`phone`

```typescript
// 加密模式，无需生物识别（默认使用字段级加密）
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: false
});
await insert('users', { id: 1, name: '张三' }, {
  encrypted: true,
  requireAuthOnAccess: false
});
```

#### 3. 加密模式 + 生物识别认证

- 使用 AES-CTR 加密算法
- 要求每次访问都进行生物识别或密码认证
- 适合高度敏感的数据
- **默认加密方式**：字段级加密

```typescript
// 加密模式，需要生物识别认证（默认使用字段级加密）
await createTable('sensitive_data', {
  encrypted: true,
  requireAuthOnAccess: true
});
await insert('sensitive_data', { id: 1, password: 'secure_password' }, {
  encrypted: true,
  requireAuthOnAccess: true
});
```

### 加密优先级说明

- 当明确设置 `encryptFullTable: true` 参数时，使用整表加密
- 否则，默认使用字段级加密（根据配置文件中的 `encryptedFields` 设置，当 `encryptedFields` 数组不为空时自动启用字段级加密）
- 整表加密和字段级加密**不能同时使用**，系统会自动检测冲突并抛出明确的错误信息

### 加密参数说明

| 参数名               | 类型    | 默认值 | 说明                                                                 |
| -------------------- | ------- | ------ | -------------------------------------------------------------------- |
| `encrypted`          | boolean | false  | 是否启用数据加密                                                     |
| `requireAuthOnAccess`| boolean | false  | 是否在每次访问数据时都要求生物识别认证（仅在 `encrypted` 为 true 时生效） |
| `encryptFullTable`   | boolean | false  | 是否启用整表加密（仅在 `encrypted` 为 true 时生效，与字段级加密互斥） |
| `encryptedFields` | string[] | [] | 需要加密的字段列表（当数组不为空时自动启用字段级加密，仅在 `encrypted` 为 true 时生效，与整表加密互斥） |

### 密钥管理

1. **密钥生成**: 系统自动生成 256 位 AES 密钥，使用设备唯一标识符和安全随机数
2. **密钥存储**: 密钥使用系统 SecureStore 安全存储
3. **密钥缓存**: 密钥在内存中缓存一段时间，减少生物识别请求频率
4. **完整性验证**: 使用 HMAC-SHA512 确保数据完整性
5. **自动轮换**: 系统会定期自动轮换密钥，增强安全性

### 安全最佳实践

1. **根据数据敏感性选择加密模式**: 敏感数据使用加密模式，非敏感数据使用非加密模式
2. **合理使用生物识别**: 仅对高度敏感数据启用 `requireAuthOnAccess`
3. **密钥管理**: 加密密钥由系统自动生成和管理，无需手动处理
4. **备份安全**: 加密数据的备份也需要妥善保护
5. **权限控制**: 限制数据库文件的访问权限
6. **定期更新**: 及时更新库版本，获取最新安全修复

## 📚 基础 API 参考

### API 分类

该库提供完整的 CRUD 操作、事务支持和高级查询功能，API 分为以下几类：

- **表管理**：`createTable`、`deleteTable`、`hasTable`、`listTables`、`countTable`、`clearTable`、`verifyCountTable`、`migrateToChunked`
- **数据操作**：`insert`、`overwrite`、`read`、`findOne`、`findMany`、`update`、`remove`、`bulkWrite`
- **事务管理**：`beginTransaction`、`commit`、`rollback`
- **工具类与实例**：`plainStorage`、`configManager`、`ConfigManager`、`performanceMonitor`、`CryptoService`、`getKeyCacheStats`、`getKeyCacheHitRate`
- **类型定义**：`CreateTableOptions`、`ReadOptions`、`WriteOptions`、`WriteResult`、`CommonOptions`、`TableOptions`、`FindOptions`、`FilterCondition`、`PerformanceStats`、`HealthCheckResult`、`KeyCacheStats`

### 核心 API 签名

#### 表管理 API

- `createTable(tableName: string, options?: CreateTableOptions): Promise<void>` - 创建新表
- `deleteTable(tableName: string, options?: TableOptions): Promise<void>` - 删除表
- `hasTable(tableName: string, options?: TableOptions): Promise<boolean>` - 检查表是否存在
- `listTables(options?: TableOptions): Promise<string[]>` - 获取所有表名
- `countTable(tableName: string, options?: TableOptions): Promise<number>` - 获取表记录数
- `verifyCountTable(tableName: string, options?: TableOptions): Promise&lt;{ metadata: number; actual: number; match: boolean }&gt;` - 验证并修复表计数准确性
- `clearTable(tableName: string, options?: TableOptions): Promise&lt;void&gt;` - 清空表数据
- `migrateToChunked(tableName: string, options?: TableOptions): Promise&lt;void&gt;` - 将表迁移到分块模式

#### 数据操作 API

- `insert(tableName: string, data: Record<string, any> | Record<string, any>[], options?: WriteOptions): Promise<WriteResult>` - 插入单条或多条数据
- `overwrite(tableName: string, data: Record<string, any> | Record<string, any>[], options?: Omit<WriteOptions, 'mode'>): Promise<WriteResult>` - 覆盖表数据
- `read(tableName: string, options?: ReadOptions): Promise<Record<string, any>[]>` - 读取数据
- `findOne(tableName: string, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<Record<string, any> | null>` - 查询单条记录
- `findMany(tableName: string, { where?, skip?, limit?, sortBy?, order?, sortAlgorithm?, encrypted?, requireAuthOnAccess? }: { where?: FilterCondition, skip?: number, limit?: number, sortBy?: string | string[], order?: 'asc' | 'desc' | Array<'asc' | 'desc'>, sortAlgorithm?: any, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<Record<string, any>[]>` - 查询多条记录
- `update(tableName: string, data: Record<string, any>, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<number>` - 更新匹配的记录
- `remove(tableName: string, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<number>` - 删除匹配的记录
- `bulkWrite(tableName: string, operations: Array<{ type: 'insert', data: Record<string, any> | Record<string, any>[] } | { type: 'update', data: Record<string, any>, where: Record<string, any> } | { type: 'delete', where: Record<string, any> }>, options?: TableOptions): Promise<WriteResult>` - 批量操作

#### 事务管理 API

- `beginTransaction(options?: TableOptions): Promise&lt;void&gt;` - 开始一个新事务
- `commit(options?: TableOptions): Promise&lt;void&gt;` - 提交当前事务
- `rollback(options?: TableOptions): Promise&lt;void&gt;` - 回滚当前事务

#### 工具类与实例 API

- `plainStorage` - 普通存储实例（无加密支持）
- `configManager` - 配置管理器实例
- `ConfigManager` - 配置管理器类
- `performanceMonitor` - 性能监控器实例
- `CryptoService` - 加密服务模块
- `getKeyCacheStats(): KeyCacheStats` - 获取密钥缓存统计信息
- `getKeyCacheHitRate(): number` - 获取密钥缓存命中率

## 📖 详细功能说明

### 高级查询

支持复杂条件查询、操作符、复合查询：

```typescript
// AND 查询
const activeAdults = await findMany('users', {
  $and: [{ age: { $gte: 18 } }, { active: true }, { role: { $in: ['user', 'admin'] } }],
});

// OR 查询
const featuredOrNew = await findMany('products', {
  $or: [{ featured: true }, { createdAt: { $gt: '2024-01-01' } }],
});
```

### 智能排序

支持多字段排序、算法选择、性能优化：

```typescript
// 单字段排序
const usersByAge = await findMany('users', {
  where: {},
  sortBy: 'age',
  order: 'asc',
});

// 多字段排序（稳定排序）
const usersSorted = await findMany('users', {
  where: {},
  sortBy: ['department', 'name', 'age'],
  order: ['asc', 'asc', 'desc'],
});
```

### 事务管理

确保数据一致性的ACID事务：

```typescript
async function transferMoney(fromUserId: number, toUserId: number, amount: number) {
  try {
    // 开始事务
    await beginTransaction();

    // 检查发送者余额
    const sender = await findOne('users', { id: fromUserId });
    if (!sender || sender.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // 执行转账操作
    await update('users', { balance: sender.balance - amount }, { id: fromUserId });
    await update('users', { balance: { $inc: amount } }, { id: toUserId });

    // 记录转账日志
    await insert('transactions', {
      id: Date.now(),
      fromUserId,
      toUserId,
      amount,
      timestamp: new Date().toISOString(),
    });

    // 提交事务
    await commit();
  } catch (error) {
    // 回滚事务
    await rollback();
    throw error;
  }
}
```

### 性能优化

- **索引优化**：支持为常用字段手动创建索引，加速数据查询
- **批量操作优化**：使用 `bulkWrite` 进行高效的批量操作
- **分页查询优化**：对大数据集使用分页避免一次性加载过多数据
- **缓存优化**：可配置的缓存策略，减少重复操作

## 🔧 配置

### 配置方式

该库通过 app.json 文件的 `expo.extra.liteStore` 部分进行配置（推荐）：

```json
{
  "expo": {
    "extra": {
      "liteStore": {
        "autoSync": {
          "enabled": true,
          "interval": 60000
        },
        "chunkSize": 10485760
      }
    }
  }
}
```

### 完整配置说明

LiteStore 提供丰富的配置选项，允许您根据项目需求调整性能、安全性和行为。

#### 配置来源

LiteStore 支持从以下来源读取配置，优先级从高到低：

1. **程序化配置（高级用法）**：通过 `ConfigManager.setConfig / updateConfig` 设置（非公开 API）
2. **app.json 中的 extra.liteStore 配置**（推荐）
3. **环境变量**：如 `LITE_STORE_CHUNK_SIZE`、`LITE_STORE_AUTO_SYNC_INTERVAL`（适用于 Node/测试环境）
4. **默认配置**：内置的默认配置，用于所有未明确指定的配置项

**说明**：公开 API 不提供运行时配置入口。如果需要在初始化前注入配置，可使用 app.json、环境变量，或设置 `global.liteStoreConfig` 作为兜底方案。

#### 基础配置

| 配置项          | 类型     | 默认值                   | 说明                                                                 |
| --------------- | -------- | ------------------------ | -------------------------------------------------------------------- |
| `chunkSize`     | `number` | `10 * 1024 * 1024` (10MB) | 数据文件分片大小，超过此大小的文件将被自动分片                       |
| `storageFolder` | `string` | `'lite-data-store'`       | 数据存储目录名称                                                     |
| `sortMethods`   | `string` | `'default'`              | 默认排序算法，可选值：`default`, `fast`, `counting`, `merge`, `slow` |
| `timeout`       | `number` | `10000` (10秒)           | 操作超时时间                                                         |

#### API 配置

| 配置项                      | 类型      | 默认值 | 说明                              |
| --------------------------- | --------- | ------ | --------------------------------- |
| `api.rateLimit.enabled`     | `boolean` | `false` | 是否启用速率限制                  |
| `api.rateLimit.requestsPerSecond` | `number` | `10`   | 每秒最大请求数                    |
| `api.rateLimit.burstCapacity` | `number`  | `20`   | 突发容量                          |
| `api.retry.maxAttempts`     | `number`  | `3`    | 最大重试次数                      |
| `api.retry.backoffMultiplier` | `number` | `2`    | 退避乘数                          |

#### 加密配置

| 配置项                       | 类型       | 默认值           | 说明                                         |
| ---------------------------- | ---------- | ---------------- | -------------------------------------------- |
| `encryption.algorithm`       | `string`   | `'AES-CTR'`      | 加密算法，支持 `AES-CTR`                     |
| `encryption.keySize`         | `number`   | `256`            | 加密密钥长度，支持 `128`, `192`, `256`       |
| `encryption.hmacAlgorithm`   | `string`   | `'SHA-512'`      | HMAC 完整性保护算法                          |
| `encryption.keyIterations`   | `number`   | `120000`         | 密钥派生迭代次数，值越高安全性越强但性能越低。Expo Go 环境自动调整，移动设备推荐 120,000 次 |
| `encryption.encryptedFields` | `string[]` | `['password', 'email', 'phone']` | 默认加密的字段列表       |
| `encryption.cacheTimeout`    | `number`   | `30000` (30秒)   | 内存中 masterKey 的缓存超时时间              |
| `encryption.maxCacheSize`    | `number`  | `100`            | LRU 缓存最多保留的派生密钥数量              |
| `encryption.useBulkOperations` | `boolean`  | `true` | 是否启用批量操作优化                   |
| `encryption.autoSelectHMAC` | `boolean`  | `true` | 是否根据数据大小自动选择 HMAC 算法（小数据用 SHA-256，大数据用 SHA-512） |

**重要说明**：
- 整表加密和字段级加密**不能同时使用**，系统会自动检测冲突并抛出明确的错误信息
- 整表加密模式通过 API 调用时的 `encryptFullTable` 参数启用
- 字段级加密通过配置文件中的 `encryptedFields` 启用，当 `encryptedFields` 数组不为空时自动启用字段级加密
- 非加密模式下，数据以明文形式存储，不会使用任何加密算法，也不会触发生物识别或密码认证

#### 性能配置

| 配置项                    | 类型      | 默认值 | 说明                              |
| ------------------------- | --------- | ------ | --------------------------------- |
| `enableQueryOptimization` | `boolean` | `true` | 是否启用查询优化（索引）          |
| `maxConcurrentOperations` | `number`  | `5`    | 最大并发操作数                    |
| `enableBatchOptimization` | `boolean` | `true` | 是否启用批量操作优化              |
| `memoryWarningThreshold`  | `number`  | `0.8`  | 内存使用触发警告的阈值（0-1之间） |

#### 自动同步配置

| 配置项                      | 类型      | 默认值 | 说明                              |
| --------------------------- | --------- | ------ | --------------------------------- |
| `autoSync.enabled`          | `boolean` | `true` | 是否启用自动同步                  |
| `autoSync.interval`         | `number`  | `30000` (30秒) | 自动同步间隔                      |
| `autoSync.minItems`         | `number`  | `1`    | 触发同步的最小脏项数量            |
| `autoSync.batchSize`        | `number`  | `100`  | 每次同步的最大项目数              |

#### 缓存配置

| 配置项                   | 类型      | 默认值            | 说明                       |
| ------------------------ | --------- | ----------------- | -------------------------- |
| `maxSize`                | `number`  | `1000`            | 缓存最大条目数             |
| `defaultExpiry`          | `number`  | `3600000` (1小时) | 缓存默认过期时间           |
| `cleanupInterval`        | `number`  | `300000` (5分钟)  | 缓存清理间隔               |
| `memoryWarningThreshold` | `number`  | `0.8`             | 缓存内存使用触发警告的阈值 |

#### 监控配置

| 配置项                      | 类型      | 默认值              | 说明             |
| --------------------------- | --------- | ------------------- | ---------------- |
| `enablePerformanceTracking` | `boolean` | `false`             | 是否启用性能跟踪 |
| `enableHealthChecks`        | `boolean` | `true`              | 是否启用健康检查 |
| `metricsRetention`          | `number`  | `86400000` (24小时) | 性能指标保留时间 |

### 配置最佳实践

要修改配置，推荐在 app.json 中进行配置，这是最方便且可靠的方式：

```json
{
  "expo": {
    "extra": {
      "liteStore": {
        "performance": {
          "enableQueryOptimization": true,
          "maxConcurrentOperations": 8, // 根据设备性能调整
          "enableBatchOptimization": true
        },
        "encryption": {
          "keyIterations": 200000, // 增加密钥派生迭代次数
          "cacheTimeout": 15000 // 减少密钥缓存时间
        },
        "cache": {
          "maxSize": 500, // 减少缓存大小
          "memoryWarningThreshold": 0.7 // 降低内存警告阈值
        }
      }
    }
  }
}
```

**配置建议**：

1. **性能优化**：
   - 根据设备性能调整 `maxConcurrentOperations`（建议值：4-10）
   - 启用 `enableQueryOptimization` 以提高查询性能
   - 启用 `enableBatchOptimization` 以提高批量操作性能

2. **安全性增强**：
   - 对于高敏感数据，增加 `keyIterations`（建议值：100000-200000）
   - 减少 `cacheTimeout` 以降低密钥泄露风险

3. **内存优化**：
   - 对于低内存设备，减少 `cache.maxSize`
   - 调整 `memoryWarningThreshold` 以适应设备内存情况

## 🐛 常见问题与故障排除

### Q: 如何切换不同版本？

A: 库通过类型定义文件自动提供TypeScript支持，JavaScript和TypeScript项目可以使用相同的导入路径：

- `import { ... } from 'expo-lite-data-store'` - 推荐使用
- `import { ... } from 'expo-lite-data-store/js'` - 显式指定JavaScript版本（与默认相同）

### Q: 如何处理中文排序？

A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持：

```typescript
const users = await findMany('users', {
  where: {},
  sortBy: 'name',
  sortAlgorithm: 'slow',
});
```

### Q: 如何提高查询性能？

A: 对于大数据集，建议使用：

- 分页查询
- 合适的排序算法
- 批量操作
- 索引优化（系统自动为常用字段创建索引）

### Q: 加密写入和读取速度较慢，如何优化？

A: 加密操作确实会增加一定的性能开销，以下是一些优化建议：

1. **使用字段级加密而非整表加密**：只加密敏感字段，而不是整个表，这样可以提高查询性能
2. **增加密钥缓存时间**：在配置中增加 `encryption.cacheTimeout` 的值，减少密钥派生的次数
3. **启用批量操作**：确保 `encryption.useBulkOperations` 为 `true`，可以减少加密/解密的次数
4. **减少密钥迭代次数**：适当降低 `encryption.keyIterations` 的值（不低于100000），可以加快密钥派生速度
5. **合理设置 `maxConcurrentOperations`**：根据设备性能调整并发操作数，推荐范围：3-10

### Q: 排序后数据顺序不正确？

A: 检查排序字段是否存在 null/undefined 值，这些值会被排到末尾。

### Q: 内存使用过高？

A: 对于超大数据集，考虑使用分页查询或 `fast` 排序算法。

### Q: 如何在纯JavaScript项目中使用？

A: 导入时会自动使用JavaScript版本，无需特殊配置。

### Q: TypeScript版本和JavaScript版本有什么区别？

A: TypeScript版本提供完整的类型检查和IDE支持；JavaScript版本轻量化但无类型检查。

### Q: 如何构建自己的版本？

A: 运行 `npm run build:all` 来构建完整的TypeScript和JavaScript版本。

### Q: 配置文件修改后不生效？

A: 配置文件直接从app.json中加载，修改后需要重新启动应用才能生效。

### Q: 如何处理数据迁移？

A: 目前不支持自动数据迁移，建议手动导出旧数据并导入到新表中。

### Q: 支持哪些过滤操作符？

A: 支持 `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or` 等操作符。

## 📞 支持与反馈

- 📧 **邮箱**: [qinIndexCode@gmail.com](mailto:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-lite-data-store/issues)
- 📖 **文档**: [完整文档](https://github.com/QinIndexCode/expo-lite-data-store/wiki)

## 许可证

MIT © QinIndexCode

---

喜欢的话别忘了点个 ⭐ Star，让更多人发现这个项目！
