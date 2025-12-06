# expo-lite-data-store 详细文档

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
const usersByAge = await findMany(
  'users',
  {},
  {
    sortBy: 'age',
    order: 'asc', // 'asc' | 'desc'
  }
);

// 多字段排序（稳定排序）
const usersSorted = await findMany(
  'users',
  {},
  {
    sortBy: ['department', 'name', 'age'],
    order: ['asc', 'asc', 'desc'],
  }
);
```

### 排序算法选择

系统提供5种专业排序算法，自动选择最优：

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
const paginatedResults = await findMany(
  'products',
  // 过滤条件
  {
    $and: [{ price: { $gte: 50, $lte: 500 } }, { category: { $in: ['electronics', 'books'] } }, { inStock: true }],
  },
  // 查询选项
  {
    sortBy: ['rating', 'price', 'name'],
    order: ['desc', 'asc', 'asc'],
    skip: 20, // 跳过前20条
    limit: 10, // 返回10条
  }
);
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

## 🎯 自动同步机制

### 配置自动同步

```typescript
import { setAutoSyncConfig, getSyncStats, syncNow } from 'expo-lite-data-store';

// 获取当前同步统计信息
const stats = await getSyncStats();
console.log('同步统计:', stats);

// 立即触发同步
await syncNow();

// 自定义自动同步配置
setAutoSyncConfig({
  enabled: true, // 启用自动同步
  interval: 10000, // 10秒同步一次
  minItems: 5, // 至少5个脏项才同步
  batchSize: 200, // 每次最多同步200个项目
});
```

### 同步配置参数

| 参数名      | 类型    | 默认值 | 描述             |
| ----------- | ------- | ------ | ---------------- |
| `enabled`   | boolean | `true` | 是否启用自动同步 |
| `interval`  | number  | `5000` | 同步间隔（毫秒） |
| `minItems`  | number  | `1`    | 最小同步项数量   |
| `batchSize` | number  | `100`  | 批量大小限制     |

### 同步统计信息

| 字段名             | 类型   | 描述                 |
| ------------------ | ------ | -------------------- |
| `syncCount`        | number | 总同步次数           |
| `totalItemsSynced` | number | 总同步项数           |
| `lastSyncTime`     | number | 上次同步时间         |
| `avgSyncTime`      | number | 平均同步耗时（毫秒） |

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
  { type: 'update', data: { id: 2, price: 29.99 } },
  { type: 'delete', data: { id: 3 } },
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
  processPageData(results);

  page++;
}
```

### 缓存优化

```typescript
// 配置缓存
// liteStore.config.js
module.exports = {
  encryption: {
    cacheTimeout: 30000, // 缓存超时时间（毫秒）
    maxCacheSize: 100,    // 最大缓存表数量
  },
};

// 禁用缓存
// 设置 cacheTimeout: 0
```

## 🎯 安全性

### 数据加密

```typescript
// 注意：加密功能需要在项目初始化时启用
// 当前版本的加密功能正在开发中，敬请期待

// 未来版本的使用方式：
// import { enableEncryption, setEncryptionKey } from 'expo-lite-data-store';
//
// // 启用加密
// await enableEncryption();
//
// // 设置加密密钥（请妥善保管）
// await setEncryptionKey('your-secure-key-here');
//
// // 加密后的数据将自动处理，无需额外代码
```

### 安全最佳实践

1. **密钥管理**: 加密密钥请妥善保管，避免硬编码
2. **敏感数据**: 对包含敏感信息的数据启用加密
3. **备份安全**: 加密数据的备份也需要保护
4. **密钥轮换**: 定期更换加密密钥
5. **权限控制**: 限制数据库文件的访问权限

## 🎯 故障排除

### 常见问题

#### Q: 排序后数据顺序不正确？
A: 检查排序字段是否存在 null/undefined 值，这些值会被排到末尾。

#### Q: 查询性能慢？
A: 尝试使用更适合的数据量的排序算法，或启用分页查询。

#### Q: 内存使用过高？
A: 对于超大数据集，考虑使用分页查询或 `fast` 排序算法。

#### Q: 中文排序不正确？
A: 使用 `sortAlgorithm: 'slow'` 以获得完整的中文支持。

#### Q: 如何在纯JavaScript项目中使用？
A: 导入时会自动使用JavaScript版本，无需特殊配置。

#### Q: TypeScript版本和JavaScript版本有什么区别？
A: TypeScript版本提供完整的类型检查和IDE支持；JavaScript版本轻量化但无类型检查。

#### Q: 如何构建自己的版本？
A: 运行 `npm run build:all` 来构建完整的TypeScript和JavaScript版本。

### 调试技巧

1. **启用调试日志**：在开发环境中启用详细日志
2. **检查配置**：确保配置文件正确加载
3. **验证表存在**：在操作前检查表是否存在
4. **查看同步统计**：检查自动同步是否正常工作
5. **监控性能**：使用性能监控工具查看查询耗时

## 🎯 API 参考

### ReadOptions 接口

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

### FilterCondition 类型

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

### WriteResult 接口

```typescript
interface WriteResult {
  written: number; // 写入的字节数
  totalAfterWrite: number; // 写入后的总字节数
  chunked: boolean; // 是否使用了分块写入
  chunks?: number; // 分块数量（分块写入时）
}
```

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
| `'expo-lite-data-store'`    | ✅ 自动选择   | 推荐使用（默认） | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/js'` | ✅ TypeScript | JavaScript环境   | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/ts'` | ✅ TypeScript | TypeScript环境   | `dist/js/index.js` + `dist/types/index.d.ts` |

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