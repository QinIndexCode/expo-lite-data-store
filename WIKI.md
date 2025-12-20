# expo-lite-data-store 详细文档

## 🎯 完整配置说明

### 配置概览

LiteStore 提供丰富的配置选项，允许您根据项目需求调整性能、安全性和行为。

**重要说明**：配置直接从打包文件加载。要修改配置，您需要编辑以下文件：

```
node_modules/expo-lite-data-store/dist/js/liteStore.config.js
```

**无运行时配置 API**：该库不提供运行时配置 API。所有配置更改必须通过直接编辑打包的配置文件来完成。这种方法确保了在不同环境中一致的配置加载，并防止了异步加载的问题。

### 基础配置

| 配置项          | 类型     | 默认值                  | 说明                                                                 |
| --------------- | -------- | ----------------------- | -------------------------------------------------------------------- |
| `chunkSize`     | `number` | `5 * 1024 * 1024` (5MB) | 数据文件分片大小，超过此大小的文件将被自动分片                       |
| `storageFolder` | `string` | `'expo-litedatastore'`  | 数据存储目录名称                                                     |
| `sortMethods`   | `string` | `'default'`             | 默认排序算法，可选值：`default`, `fast`, `counting`, `merge`, `slow` |
| `timeout`       | `number` | `10000` (10秒)          | 操作超时时间                                                         |

### 加密配置

| 配置项                       | 类型       | 默认值           | 说明                                         |
| ---------------------------- | ---------- | ---------------- | -------------------------------------------- |
| `algorithm`                  | `string`   | `'AES-CTR'`      | 加密算法，支持 `AES-CTR`                     |
| `keySize`                    | `number`   | `256`            | 加密密钥长度，支持 `128`, `192`, `256`       |
| `hmacAlgorithm`              | `string`   | `'SHA-512'`      | HMAC 完整性保护算法                          |
| `keyIterations`              | `number`   | `120000`         | 密钥派生迭代次数，值越高安全性越强但性能越低 |

| `encryptedFields`            | `string[]` | 常见敏感字段列表 | 默认加密的字段列表                           |
| `cacheTimeout`               | `number`   | `30000` (30秒)   | 内存中 masterKey 的缓存超时时间              |
| `maxCacheSize`               | `number`   | `50`             | LRU 缓存最多保留的派生密钥数量               |
| `useBulkOperations`          | `boolean`  | `true`           | 是否启用批量操作优化                         |

**重要说明**：
- 整表加密和字段级加密**不能同时使用**，系统会自动检测冲突并抛出明确的错误信息
- 整表加密模式通过 API 调用时的 `encryptFullTable` 参数启用
- 字段级加密通过配置文件中的 `encryptedFields` 启用，当 `encryptedFields` 数组不为空时自动启用字段级加密
- 非加密模式下，数据以明文形式存储，不会使用任何加密算法，也不会触发生物识别或密码认证

### 性能配置

| 配置项                    | 类型      | 默认值 | 说明                              |
| ------------------------- | --------- | ------ | --------------------------------- |
| `enableQueryOptimization` | `boolean` | `true` | 是否启用查询优化（索引）          |
| `maxConcurrentOperations` | `number`  | `5`    | 最大并发操作数                    |
| `enableBatchOptimization` | `boolean` | `true` | 是否启用批量操作优化              |
| `memoryWarningThreshold`  | `number`  | `0.8`  | 内存使用触发警告的阈值（0-1之间） |

### 缓存配置

| 配置项                   | 类型      | 默认值            | 说明                       |
| ------------------------ | --------- | ----------------- | -------------------------- |
| `maxSize`                | `number`  | `1000`            | 缓存最大条目数             |
| `defaultExpiry`          | `number`  | `3600000` (1小时) | 缓存默认过期时间           |
| `enableCompression`      | `boolean` | `false`           | 是否启用缓存数据压缩       |
| `cleanupInterval`        | `number`  | `300000` (5分钟)  | 缓存清理间隔               |
| `memoryWarningThreshold` | `number`  | `0.8`             | 缓存内存使用触发警告的阈值 |
| `autoSync.enabled`       | `boolean` | `true`            | 是否启用自动同步           |
| `autoSync.interval`      | `number`  | `5000` (5秒)      | 自动同步间隔               |
| `autoSync.minItems`      | `number`  | `1`               | 触发同步的最小脏项数量     |
| `autoSync.batchSize`     | `number`  | `100`             | 每次同步的最大项目数       |



### 监控配置

| 配置项                      | 类型      | 默认值              | 说明             |
| --------------------------- | --------- | ------------------- | ---------------- |
| `enablePerformanceTracking` | `boolean` | `true`              | 是否启用性能跟踪 |
| `enableHealthChecks`        | `boolean` | `true`              | 是否启用健康检查 |
| `metricsRetention`          | `number`  | `86400000` (24小时) | 性能指标保留时间 |

### 配置最佳实践

要修改配置，您需要直接编辑打包的配置文件：

```
node_modules/expo-lite-data-store/dist/js/liteStore.config.js
```

1. **性能优化**：

   ```javascript
   // liteStore.config.js
   module.exports = {
     performance: {
       enableQueryOptimization: true,
       maxConcurrentOperations: 8, // 根据设备性能调整
       enableBatchOptimization: true,
     },
   };
   ```

2. **安全性增强**：

   ```javascript
   // liteStore.config.js
   module.exports = {
     encryption: {
       keyIterations: 200000, // 增加密钥派生迭代次数
       cacheTimeout: 15000, // 减少密钥缓存时间

     },
   };
   ```

3. **内存优化**：
   ```javascript
   // liteStore.config.js
   module.exports = {
     cache: {
       maxSize: 500, // 减少缓存大小
       enableCompression: true, // 启用缓存压缩
       memoryWarningThreshold: 0.7, // 降低内存警告阈值
     },
   };
   ```

## 🎯 API 参考

### 核心 API 列表

| 类别         | API 名称          | 描述                           |
| ------------ | ----------------- | ------------------------------ |
| **表管理**   | `createTable`     | 创建新表                       |
|              | `deleteTable`     | 删除表                         |
|              | `hasTable`        | 检查表是否存在                 |
|              | `listTables`      | 获取所有表名                   |
|              | `countTable`      | 获取表记录数                   |
|              | `clearTable`      | 清空表数据                     |
| **数据操作** | `insert`          | 插入单条或多条数据             |
|              | `read`            | 读取数据（支持过滤、分页、排序） |
|              | `findOne`         | 查询单条记录                   |
|              | `findMany`        | 查询多条记录（支持高级选项）   |
|              | `update`          | 更新匹配的记录                 |
|              | `remove`          | 删除匹配的记录                 |
|              | `bulkWrite`       | 批量操作                       |
| **事务管理** | `beginTransaction`| 开始新事务                     |
|              | `commit`          | 提交当前事务                   |
|              | `rollback`        | 回滚当前事务                   |

### 详细 API 说明

#### 表管理 API

##### createTable

**功能**：创建一个新的数据表

**签名**：
```typescript
createTable(tableName: string, options?: CreateTableOptions): Promise<void>
```

**参数**：
- `tableName`: 表名，必须唯一
- `options`: 可选配置项
  - `columns`: 列定义（可选）
  - `initialData`: 初始数据（可选）
  - `mode`: 存储模式，`'single'` 或 `'chunked'`（可选）
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
// 创建基本表
await createTable('users');

// 创建带初始数据的表
await createTable('users', {
  initialData: [
    { id: 1, name: '张三', age: 25 },
    { id: 2, name: '李四', age: 30 }
  ]
});

// 创建分块存储的表
await createTable('large_data', {
  mode: 'chunked'
});

// 使用加密选项创建表
await createTable('sensitive_data', {
  encrypted: true,
  requireAuthOnAccess: false
});
```

##### deleteTable

**功能**：删除指定的数据表

**签名**：
```typescript
deleteTable(tableName: string, options?: TableOptions): Promise<void>
```

**参数**：
- `tableName`: 要删除的表名
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
// 删除普通表
await deleteTable('users');

// 删除加密表
await deleteTable('sensitive_data', {
  encrypted: true
});
```

##### hasTable

**功能**：检查指定的数据表是否存在

**签名**：
```typescript
hasTable(tableName: string, options?: TableOptions): Promise<boolean>
```

**参数**：
- `tableName`: 要检查的表名
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `boolean`: 表是否存在

**示例**：
```typescript
// 检查普通表
const exists = await hasTable('users');
console.log(`表 users 存在: ${exists}`);

// 检查加密表
const encryptedExists = await hasTable('sensitive_data', {
  encrypted: true
});
```

##### listTables

**功能**：获取所有数据表的名称

**签名**：
```typescript
listTables(options?: TableOptions): Promise<string[]>
```

**参数**：
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `string[]`: 所有表名的数组

**示例**：
```typescript
// 获取所有普通表
const tables = await listTables();
console.log('所有表:', tables);

// 获取所有加密表
const encryptedTables = await listTables({
  encrypted: true
});
```

##### countTable

**功能**：获取指定表的记录数

**签名**：
```typescript
countTable(tableName: string, options?: TableOptions): Promise<number>
```

**参数**：
- `tableName`: 表名
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `number`: 表中的记录数

**示例**：
```typescript
// 获取普通表记录数
const count = await countTable('users');
console.log(`表 users 中有 ${count} 条记录`);

// 获取加密表记录数
const encryptedCount = await countTable('sensitive_data', {
  encrypted: true
});
```

##### clearTable

**功能**：清空指定表中的所有数据

**签名**：
```typescript
clearTable(tableName: string, options?: TableOptions): Promise<void>
```

**参数**：
- `tableName`: 要清空的表名
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
// 清空普通表
await clearTable('users');

// 清空加密表
await clearTable('sensitive_data', {
  encrypted: true
});
```

#### 数据操作 API

##### insert

**功能**：向指定表中插入单条或多条数据

**签名**：
```typescript
insert(tableName: string, data: Record<string, any> | Record<string, any>[], options?: WriteOptions): Promise<WriteResult>
```

**参数**：
- `tableName`: 表名
- `data`: 要插入的数据，可以是单条记录或记录数组
- `options`: 可选配置项
  - `mode`: 写入模式，`'append'` 或 `'overwrite'`（可选）
  - `forceChunked`: 是否强制使用分片写入（可选）
  - `encryptFullTable`: 是否启用整表加密（可选）
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `WriteResult`: 写入结果，包含写入字节数、总字节数等信息

**示例**：
```typescript
// 插入单条数据
await insert('users', { id: 1, name: '张三', age: 25 });

// 插入多条数据
await insert('users', [
  { id: 2, name: '李四', age: 30 },
  { id: 3, name: '王五', age: 35 }
]);

// 插入加密数据
await insert('sensitive_data', {
  id: 1,
  password: 'secure_password'
}, {
  encrypted: true
});
```

##### read

**功能**：从指定表中读取数据，支持过滤、分页和排序

**签名**：
```typescript
read(tableName: string, options?: ReadOptions): Promise<Record<string, any>[]>
```

**参数**：
- `tableName`: 表名
- `options`: 读取选项
  - `filter`: 查询条件
  - `skip`: 跳过的记录数
  - `limit`: 返回的最大记录数
  - `sortBy`: 排序字段
  - `order`: 排序方向，`'asc'` 或 `'desc'`
  - `sortAlgorithm`: 排序算法

**返回值**：
- `Record<string, any>[]`: 匹配的记录数组

**示例**：
```typescript
// 读取所有数据
const allUsers = await read('users');

// 带过滤条件的读取
const activeUsers = await read('users', {
  filter: { status: 'active' }
});

// 带分页和排序的读取
const paginatedUsers = await read('users', {
  skip: 10,
  limit: 20,
  sortBy: 'age',
  order: 'desc'
});
```

##### findOne

**功能**：查询指定表中的单条记录

**签名**：
```typescript
findOne(tableName: string, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<Record<string, any> | null>
```

**参数**：
- `tableName`: 表名
- `filter`: 查询条件
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `Record<string, any> | null`: 匹配的记录，如果没有匹配则返回 `null`

**示例**：
```typescript
// 根据ID查询
const user = await findOne('users', { where: { id: 1 } });

// 根据条件查询
const activeUser = await findOne('users', {
  where: { $and: [{ status: 'active' }, { age: { $gte: 18 } }] }
});

// 使用加密选项查询
const encryptedUser = await findOne('sensitive_data', {
  where: { id: 1 },
  encrypted: true,
  requireAuthOnAccess: false
});
```

##### findMany

**功能**：查询指定表中的多条记录，支持高级查询选项

**签名**：
```typescript
findMany(tableName: string, { where?, skip?, limit?, sortBy?, order?, sortAlgorithm?, encrypted?, requireAuthOnAccess? }: {
  where?: FilterCondition,
  skip?: number,
  limit?: number,
  sortBy?: string | string[],
  order?: 'asc' | 'desc' | ('asc' | 'desc')[],
  sortAlgorithm?: 'quick' | 'merge' | 'slow' | 'default' | 'radix',
  encrypted?: boolean,
  requireAuthOnAccess?: boolean
}): Promise<Record<string, any>[]>
```

**参数**：
- `tableName`: 表名
- `filter`: 查询条件
- `options`: 查询选项
  - `skip`: 跳过的记录数
  - `limit`: 返回的最大记录数
  - `sortBy`: 排序字段或字段数组
  - `order`: 排序方向或方向数组
  - `sortAlgorithm`: 排序算法
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `Record<string, any>[]`: 匹配的记录数组

**示例**：
```typescript
// 基本查询
const users = await findMany('users', { where: { age: { $gte: 18 } } });

// 多字段排序
const sortedUsers = await findMany('users', {
  where: {},
  sortBy: ['department', 'name', 'age'],
  order: ['asc', 'asc', 'desc']
});

// 使用特定排序算法
const chineseSortedUsers = await findMany('users', {
  where: {},
  sortBy: 'name',
  sortAlgorithm: 'slow' // 支持中文排序
});

// 使用加密选项查询
const encryptedUsers = await findMany('sensitive_data', {
  where: { status: 'active' },
  encrypted: true,
  requireAuthOnAccess: false,
  sortBy: 'created_at',
  order: 'desc'
});
```

##### update

**功能**：更新指定表中匹配条件的记录

**签名**：
```typescript
update(tableName: string, data: Record<string, any>, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<number>
```

**参数**：
- `tableName`: 表名
- `data`: 要更新的数据
- `options`: 选项对象
  - `where`: 更新条件
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `number`: 更新的记录数

**示例**：
```typescript
// 更新单条记录
const updatedCount = await update('users', { age: 26 }, { where: { id: 1 } });
console.log(`更新了 ${updatedCount} 条记录`);

// 更新多条记录
const updatedCount = await update('users', { status: 'inactive' }, {
  where: { lastLogin: { $lt: '2024-01-01' } }
});
console.log(`更新了 ${updatedCount} 条记录`);

// 使用加密选项更新
const updatedCount = await update('sensitive_data', { status: 'active' }, {
  where: { id: 1 },
  encrypted: true,
  requireAuthOnAccess: false
});
console.log(`更新了 ${updatedCount} 条记录`);
```

##### remove

**功能**：删除指定表中匹配条件的记录

**签名**：
```typescript
remove(tableName: string, { where, encrypted?, requireAuthOnAccess? }: { where: FilterCondition, encrypted?: boolean, requireAuthOnAccess?: boolean }): Promise<number>
```

**参数**：
- `tableName`: 表名
- `options`: 选项对象
  - `where`: 删除条件
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `number`: 删除的记录数

**示例**：
```typescript
// 删除单条记录
const deletedCount = await remove('users', { where: { id: 1 } });
console.log(`删除了 ${deletedCount} 条记录`);

// 删除多条记录
const deletedCount = await remove('users', {
  where: { status: 'inactive' }
});
console.log(`删除了 ${deletedCount} 条记录`);

// 使用加密选项删除
const deletedCount = await remove('sensitive_data', {
  where: { id: 1 },
  encrypted: true,
  requireAuthOnAccess: false
});
console.log(`删除了 ${deletedCount} 条记录`);
```

##### bulkWrite

**功能**：执行批量操作，支持插入、更新和删除

**签名**：
```typescript
bulkWrite(tableName: string, operations: Array<{
  type: 'insert' | 'update' | 'delete';
  data: Record<string, any> | Record<string, any>[];
  where?: FilterCondition;
}>, options?: TableOptions): Promise<WriteResult>
```

**参数**：
- `tableName`: 表名
- `operations`: 操作数组
  - `type`: 操作类型，`'insert'`、`'update'` 或 `'delete'`
  - `data`: 操作数据
  - `where`: 操作条件（update和delete操作需要）
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**返回值**：
- `WriteResult`: 写入结果

**示例**：
```typescript
await bulkWrite('users', [
  { type: 'insert', data: { id: 4, name: '赵六', age: 28 } },
  { type: 'update', data: { status: 'active' }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } }
]);

// 使用加密选项执行批量操作
await bulkWrite('sensitive_data', [
  { type: 'insert', data: { id: 1, name: '敏感数据', value: '123456' } },
  { type: 'update', data: { value: '789012' }, where: { id: 1 } }
], {
  encrypted: true,
  requireAuthOnAccess: false
});
```

#### 事务管理 API

##### beginTransaction

**功能**：开始一个新事务

**签名**：
```typescript
beginTransaction(options?: TableOptions): Promise<void>
```

**参数**：
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
await beginTransaction();
try {
  // 执行一系列操作
  await insert('users', { id: 5, name: '钱七' });
  await update('users', { balance: { $inc: 100 } }, { id: 5 });
  // 提交事务
  await commit();
} catch (error) {
  // 回滚事务
  await rollback();
  throw error;
}

// 使用加密选项开始事务
await beginTransaction({ encrypted: true, requireAuthOnAccess: false });
```

##### commit

**功能**：提交当前事务

**签名**：
```typescript
commit(options?: TableOptions): Promise<void>
```

**参数**：
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
await beginTransaction();
try {
  // 执行操作
  await commit();
} catch (error) {
  await rollback();
}

// 使用加密选项提交事务
await commit({ encrypted: true, requireAuthOnAccess: false });
```

##### rollback

**功能**：回滚当前事务

**签名**：
```typescript
rollback(options?: TableOptions): Promise<void>
```

**参数**：
- `options`: 可选配置项
  - `encrypted`: 是否启用加密存储，默认为 false（可选）
  - `requireAuthOnAccess`: 是否需要生物识别验证，默认为 false（可选）

**示例**：
```typescript
await beginTransaction();
try {
  // 执行操作
  await commit();
} catch (error) {
  await rollback();
}

// 使用加密选项回滚事务
await rollback({ encrypted: true, requireAuthOnAccess: false });
```



### 接口定义

#### ReadOptions 接口

```typescript
interface ReadOptions {
  // 分页选项
  skip?: number; // 跳过的记录数
  limit?: number; // 返回的记录数上限

  // 过滤选项
  filter?: FilterCondition; // 查询条件

  // 排序选项
  sortBy?: string | string[]; // 排序字段
  order?: 'asc' | 'desc' | ('asc' | 'desc')[]; // 排序方向
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow'; // 排序算法
}
```

#### FilterCondition 类型

```typescript
type FilterCondition =
  | ((item: Record<string, any>) => boolean) // 函数条件
  | Partial<Record<string, any>> // 简单对象条件
  | {
      // 高级条件
      $or?: FilterCondition[];
      $and?: FilterCondition[];
      [key: string]: any;
    };
```

#### WriteResult 接口

```typescript
interface WriteResult {
  written: number; // 写入的字节数
  totalAfterWrite: number; // 写入后的总字节数
  chunked: boolean; // 是否使用了分块写入
  chunks?: number; // 分块数量（分块写入时）
}
```

## 🎯 高级查询

### 条件查询操作符

| 操作符  | 说明       | 示例                                |
| ------- | ---------- | ----------------------------------- |
| `$eq`   | 等于       | `{ age: { $eq: 25 } }`              |
| `$ne`   | 不等于     | `{ status: { $ne: 'inactive' } }`   |
| `$gt`   | 大于       | `{ age: { $gt: 18 } }`              |
| `$gte`  | 大于等于   | `{ score: { $gte: 60 } }`           |
| `$lt`   | 小于       | `{ price: { $lt: 100 } }`           |
| `$lte`  | 小于等于   | `{ quantity: { $lte: 10 } }`        |
| `$in`   | 在数组中   | `{ category: { $in: ['A', 'B'] } }` |
| `$nin`  | 不在数组中 | `{ status: { $nin: ['deleted'] } }` |
| `$like` | 模糊匹配   | `{ name: { $like: '张%' } }`        |

### 复合查询

```typescript
import { findMany } from 'expo-lite-data-store';

// AND 查询
const activeAdults = await findMany('users', {
  $and: [{ age: { $gte: 18 } }, { active: true }, { role: { $in: ['user', 'admin'] } }],
});

// OR 查询
const featuredOrNew = await findMany('products', {
  $or: [{ featured: true }, { createdAt: { $gt: '2024-01-01' } }],
});

// 复杂嵌套查询
const complexQuery = await findMany('orders', {
  $and: [
    { status: 'completed' },
    {
      $or: [{ total: { $gt: 1000 } }, { priority: 'high' }],
    },
    { createdAt: { $gte: '2024-01-01' } },
  ],
});
```

## 🎯 智能排序

### 基础排序

```typescript
// 单字段排序
const usersByAge = await findMany('users', {
  where: {},
  sortBy: 'age',
  order: 'asc', // 'asc' | 'desc'
});

// 多字段排序（稳定排序）
const usersSorted = await findMany('users', {
  where: {},
  sortBy: ['department', 'name', 'age'],
  order: ['asc', 'asc', 'desc'],
});
```

### 排序算法选择

系统提供5种专业排序算法，根据数据量自动选择合适算法：

| 算法       | 适用场景                 | 性能特点           |
| ---------- | ------------------------ | ------------------ |
| `default`  | 小数据集 (< 100项)       | 平衡性能和功能     |
| `fast`     | 大数据集，简单比较       | 最快，但功能简化   |
| `merge`    | 大数据集，稳定排序       | 稳定，适合大数据   |
| `counting` | 有限值域（如状态、等级） | O(n+k)，空间换时间 |
| `slow`     | 需要完整localeCompare    | 支持中文、特殊字符 |

```typescript
// 自动选择算法（推荐）
const users = await findMany('users', {}, { sortBy: 'score' });

// 手动指定算法
const users = await findMany(
  'users',
  {},
  {
    sortBy: 'name',
    sortAlgorithm: 'slow', // 支持中文排序
  }
);

// 大数据优化
const largeDataset = await findMany(
  'logs',
  {},
  {
    sortBy: 'timestamp',
    sortAlgorithm: 'merge', // 适合大数据
  }
);
```

### 排序 + 过滤 + 分页

```typescript
// 完整查询示例
const paginatedResults = await findMany('products', {
  where: {
    $and: [{ price: { $gte: 50, $lte: 500 } }, { category: { $in: ['electronics', 'books'] } }, { inStock: true }],
  },
  sortBy: ['rating', 'price', 'name'],
  order: ['desc', 'asc', 'asc'],
  skip: 20, // 跳过前20条
  limit: 10, // 返回10条
});
```

## 🎯 事务管理

### ACID 事务

确保数据一致性的最佳实践：

```typescript
import { beginTransaction, commit, rollback, insert, update, findOne } from 'expo-lite-data-store';

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
    console.log('Transfer completed successfully');
  } catch (error) {
    // 出错时回滚所有操作
    await rollback();
    console.error('Transfer failed:', error);
    throw error;
  }
}
```

### 事务最佳实践

1. **保持事务简短**：事务持有锁，长时间运行的事务会影响性能
2. **避免嵌套事务**：当前版本不支持嵌套事务
3. **错误处理**：始终使用 try-catch 包裹事务代码
4. **批量操作**：在事务中使用批量操作减少磁盘 I/O
5. **测试回滚**：确保回滚机制正常工作



## 🎯 性能优化

### 索引优化

当前版本支持自动索引：

- 自动为 `id` 字段创建索引
- 自动为常用字段 (`name`, `email`, `type`, `status`) 创建索引
- 索引在数据读取后自动构建
- 在数据修改时自动清除并重建

```typescript
// 索引使用示例
const user = await findOne('users', { id: 123 }); // 使用id索引
const users = await findMany('users', { email: 'user@example.com' }); // 使用email索引
```

### 批量操作优化

```typescript
// 使用bulkWrite进行批量操作，比多次单独操作更高效
await bulkWrite('products', [
  { type: 'insert', data: { id: 1, name: 'Product 1' } },
  { type: 'update', data: { price: 29.99 }, where: { id: 2 } },
  { type: 'delete', where: { id: 3 } },
]);
```

### 分页查询优化

```typescript
// 对于大数据集，使用分页避免一次性加载过多数据
const pageSize = 50;
let page = 0;

while (true) {
  const results = await findMany(
    'largeTable',
    {},
    {
      skip: page * pageSize,
      limit: pageSize,
      sortBy: 'id',
    }
  );

  if (results.length === 0) break;

  // 处理当前页数据
  // processPageData(results);

  page++;
}
```

### 缓存优化

```javascript
// 配置缓存
// liteStore.config.js
module.exports = {
  encryption: {
    cacheTimeout: 30000, // 缓存超时时间（毫秒）
    maxCacheSize: 100, // 最大缓存表数量
  },
};

// 禁用缓存
// 设置 cacheTimeout: 0
```

## 🎯 安全性

### 数据加密

LiteStore 提供强大的加密功能，支持 AES-CTR 加密算法和 HMAC-SHA512 完整性验证。您可以根据需要灵活选择加密模式和生物识别认证选项。

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
await createTable('users', {
  encrypted: true,
  requireAuthOnAccess: true
});
await insert('users', { id: 1, name: '张三' }, {
  encrypted: true,
  requireAuthOnAccess: true
});
```

**加密优先级说明**：
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

### 生物识别与密码识别

**优化后的行为**: 只有在实际需要使用加密密钥时才会触发生物识别或密码识别。

**具体优化**:
1. 不再在系统初始化时触发生物识别或密码识别
2. 只有在实际执行加密操作（如解密数据）时才会请求密钥
3. 如果项目不使用加密数据，不会触发任何生物识别或密码识别
4. 优化后的行为提供了更好的用户体验，避免了不必要的身份验证请求
5. 支持指纹识别、面容识别和设备密码作为备选方案

## 🎯 故障排除

### 常见问题

<details>
<summary>Q: 排序后数据顺序不正确？</summary>

A: 检查排序字段是否存在 null/undefined 值，这些值会被排到末尾。
</details>

<details>
<summary>Q: 查询性能慢？</summary>

A: 尝试使用更适合的数据量的排序算法，或启用分页查询。
</details>

<details>
<summary>Q: 内存使用过高？</summary>

A: 对于超大数据集，考虑使用分页查询或 `fast` 排序算法。
</details>

<details>
<summary>Q: 中文排序不正确？</summary>

A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持。
</details>

<details>
<summary>Q: 如何在纯JavaScript项目中使用？</summary>

A: 导入时会自动使用JavaScript版本，无需特殊配置。
</details>

<details>
<summary>Q: TypeScript版本和JavaScript版本有什么区别？</summary>

A: TypeScript版本提供完整的类型检查和IDE支持；JavaScript版本轻量化但无类型检查。
</details>

<details>
<summary>Q: 如何构建自己的版本？</summary>

A: 运行 `npm run build:all` 来构建完整的TypeScript和JavaScript版本。
</details>

<details>
<summary>Q: 配置文件修改后不生效？</summary>

A: 配置文件直接从打包文件加载，修改后需要重新启动应用才能生效。
</details>


<details>
<summary>Q: 加密功能如何使用？</summary>

A: 加密功能已完全可用，支持三种使用模式：
1. 非加密模式（默认）：不使用任何加密算法，不触发生物识别
2. 加密模式：使用AES-CTR加密，无需生物识别
3. 加密模式 + 生物识别认证：每次访问都需要生物识别或密码认证

详细使用方法请参考文档中的"🔒 加密使用说明"章节。
</details>

<details>
<summary>Q: 如何处理数据迁移？</summary>

A: 目前不支持自动数据迁移，建议手动导出旧数据并导入到新表中。
</details>

<details>
<summary>Q: 支持哪些过滤操作符？</summary>

A: 支持 `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or` 等操作符。
</details>

### 错误代码说明

#### 表相关错误代码

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| `TABLE_NOT_FOUND` | 指定的表不存在 | 检查表名是否正确，或先创建表 |
| `TABLE_CREATE_FAILED` | 表创建失败 | 检查是否有写权限，或表名是否已存在 |
| `TABLE_DELETE_FAILED` | 表删除失败 | 检查是否有写权限，或表是否被锁定 |
| `TABLE_UPDATE_FAILED` | 表更新失败 | 检查是否有写权限，或表是否被锁定 |
| `TABLE_READ_FAILED` | 表读取失败 | 检查是否有读权限，或文件是否损坏 |
| `TABLE_COUNT_FAILED` | 表计数失败 | 检查表是否存在，或是否有读权限 |
| `TABLE_SIZE_FAILED` | 获取表大小失败 | 检查表是否存在，或是否有读权限 |
| `TABLE_CHUNK_FAILED` | 表分片失败 | 检查文件系统权限，或存储空间是否充足 |
| `TABLE_CHUNK_SIZE_FAILED` | 表分片大小配置失败 | 检查分片大小配置是否在有效范围内 |
| `TABLE_CHUNK_SIZE_TOO_SMALL` | 表分片大小太小 | 增加分片大小配置 |
| `TABLE_CHUNK_SIZE_TOO_LARGE` | 表分片大小太大 | 减小分片大小配置 |
| `TABLE_ALREADY_EXISTS` | 表已存在 | 选择其他表名，或删除已存在的表 |
| `TABLE_NAME_INVALID` | 表名无效 | 使用有效的表名，避免特殊字符 |
| `TABLE_COLUMN_INVALID` | 表列无效 | 检查列定义是否正确 |
| `TABLE_INDEX_INVALID` | 表索引无效 | 检查索引定义是否正确 |
| `TABLE_INDEX_ALREADY_EXISTS` | 表索引已存在 | 选择其他索引名，或删除已存在的索引 |
| `TABLE_INDEX_NOT_FOUND` | 表索引不存在 | 检查索引名是否正确，或先创建索引 |
| `TABLE_INDEX_NAME_INVALID` | 表索引名无效 | 使用有效的索引名，避免特殊字符 |
| `TABLE_INDEX_TYPE_INVALID` | 表索引类型无效 | 使用支持的索引类型 |
| `TABLE_INDEX_UNIQUE_INVALID` | 表索引唯一性配置无效 | 检查唯一性配置是否正确 |
| `TABLE_INDEX_NOT_UNIQUE` | 表索引不唯一 | 确保索引字段值唯一，或修改索引配置 |

#### 文件相关错误代码

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| `FILE_NOT_FOUND` | 文件不存在 | 检查文件路径是否正确 |
| `FILE_ALREADY_EXISTS` | 文件已存在 | 选择其他文件名，或删除已存在的文件 |
| `FILE_NAME_INVALID` | 文件名无效 | 使用有效的文件名，避免特殊字符 |
| `FILE_CONTENT_INVALID` | 文件内容无效 | 检查文件内容格式是否正确 |
| `FILE_CONTENT_TOO_LARGE` | 文件内容太大 | 减小文件大小，或调整配置允许更大的文件 |
| `FILE_READ_FAILED` | 文件读取失败 | 检查是否有读权限，或文件是否损坏 |
| `FILE_WRITE_FAILED` | 文件写入失败 | 检查是否有写权限，或存储空间是否充足 |
| `FILE_DELETE_FAILED` | 文件删除失败 | 检查是否有写权限，或文件是否被锁定 |
| `FILE_MOVE_FAILED` | 文件移动失败 | 检查是否有写权限，或目标路径是否存在 |
| `FILE_COPY_FAILED` | 文件复制失败 | 检查是否有读/写权限，或存储空间是否充足 |
| `FILE_RENAME_FAILED` | 文件重命名失败 | 检查是否有写权限，或目标文件名是否已存在 |
| `FILE_TRUNCATE_FAILED` | 文件截断失败 | 检查是否有写权限，或文件是否被锁定 |

#### 事务相关错误代码

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| `TRANSACTION_IN_PROGRESS` | 事务已在进行中 | 等待当前事务完成，或提交/回滚当前事务 |
| `NO_TRANSACTION_IN_PROGRESS` | 没有事务在进行中 | 先开始一个事务 |
| `TRANSACTION_COMMIT_FAILED` | 事务提交失败 | 检查事务中的操作是否正确，或是否有并发冲突 |
| `TRANSACTION_ROLLBACK_FAILED` | 事务回滚失败 | 检查是否有写权限，或系统是否支持回滚操作 |

#### 其他错误代码

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| `UNKNOWN` | 未知错误 | 查看详细错误信息，或检查系统日志 |
| `TIMEOUT` | 操作超时 | 增加超时配置，或优化操作性能 |
| `PERMISSION_DENIED` | 权限不足 | 检查是否有相应的文件系统权限 |
| `DISK_FULL` | 磁盘空间不足 | 清理磁盘空间，或选择其他存储位置 |
| `CORRUPTED_DATA` | 数据损坏 | 恢复备份数据，或重新创建表 |
| `DATA_INCOMPLETE` | 数据不完整 | 检查数据来源，或重新获取数据 |
| `CHUNK_INTEGRITY_FAILED` | 分片完整性检查失败 | 检查文件是否损坏，或重新创建分片 |
| `META_FILE_READ_ERROR` | 元文件读取失败 | 检查元文件是否存在，或是否损坏 |
| `META_FILE_WRITE_ERROR` | 元文件写入失败 | 检查是否有写权限，或存储空间是否充足 |
| `QUERY_FAILED` | 查询执行失败 | 检查查询条件是否正确，或表结构是否匹配 |
| `MIGRATION_FAILED` | 数据迁移失败 | 检查迁移脚本是否正确，或数据格式是否兼容 |
| `WRITTEN_COUNT_MISMATCH` | 写入数量不匹配 | 检查写入操作是否正确，或数据是否完整 |
| `BULK_OPERATION_FAILED` | 批量操作失败 | 检查批量操作中的每个操作是否正确，或拆分批量操作 |

### 调试技巧

1. **启用调试日志**：在开发环境中启用详细日志
2. **检查配置**：确保配置文件正确加载
3. **验证表存在**：在操作前检查表是否存在
4. **查看同步统计**：检查自动同步是否正常工作
5. **监控性能**：使用性能监控工具查看查询耗时

## 🎯 性能基准

### 排序算法性能对比

| 算法     | 小数据集 (<100) | 中等数据集 (100-10K) | 大数据集 (>10K) | 内存使用 | 稳定性 |
| -------- | --------------- | -------------------- | --------------- | -------- | ------ |
| default  | ⭐⭐⭐⭐⭐      | ⭐⭐⭐               | ⭐⭐            | 低       | 高     |
| fast     | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐           | ⭐⭐⭐          | 低       | 中     |
| merge    | ⭐⭐⭐⭐        | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐      | 中       | 高     |
| counting | ⭐⭐⭐          | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐      | 高\*     | 高     |
| slow     | ⭐⭐            | ⭐⭐                 | ⭐⭐            | 低       | 高     |

\*计数排序在值域有限时内存效率很高

### 推荐使用场景

- **实时搜索结果排序**: 使用 `fast` 算法
- **大数据分析**: 使用 `merge` 算法
- **状态/等级排序**: 使用 `counting` 算法
- **中文内容排序**: 使用 `slow` 算法
- **通用场景**: 不指定算法，自动选择

## 🎯 版本选择

| 导入路径                    | 类型支持      | 适用场景         | 文件来源                                     |
| --------------------------- | ------------- | ---------------- | -------------------------------------------- |
| `'expo-lite-data-store'`    | ✅ TypeScript | 推荐使用（默认） | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/js'` | ✅ TypeScript | JavaScript环境   | `dist/js/index.js` + `dist/types/index.d.ts` |

> 注：TypeScript支持通过类型定义文件自动提供，所有导入路径都包含完整的类型支持，无需单独选择TypeScript版本。

## 🎯 打包工具集成

### Webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
    alias: {
      'expo-lite-data-store': 'expo-lite-data-store/dist/js',
    },
  },
};
```

### Rollup

```javascript
// rollup.config.js
export default {
  external: ['expo-lite-data-store'],
  plugins: [
    // 其他插件
  ],
};
```

### Metro (React Native)

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname, {
  resolver: {
    alias: {
      'expo-lite-data-store': 'expo-lite-data-store/dist/js',
    },
  },
});
```

## 📞 支持与反馈

- 📧 **邮箱**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **文档**: [README](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.md)

## 许可证

MIT © QinIndex Qin