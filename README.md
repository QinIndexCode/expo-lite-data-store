
# expo-liteDBStore

<div style="display: flex; gap: 10px; margin-bottom: 20px;">
  <a href="#english" style="padding: 5px 15px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">English</a>
  <a href="#chinese" style="padding: 5px 15px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">中文</a>
</div>

## <a id="english"></a>English

### Lightweight, Zero-config Local Storage for Expo Apps

JSON-based storage using `expo-file-system` + encrypted storage with `expo-secure-store`. No SQL, no native code — works in **Expo Go**.

### Features

- **Zero Configuration**: Ready to use out of the box, no complex setup required
- **Dual Storage Modes**: Supports single-file and chunked storage (for large datasets)
- **Encryption Support**: AES-256-CTR encryption for sensitive data
- **Flexible Querying**: Conditional filtering, pagination, and sorting
- **Transactional Operations**: Bulk write support
- **Type Safety**: Full TypeScript support
- **Cross-platform**: Works on iOS, Android, and Web
- **Lightweight**: Minimal dependencies and optimized performance

### Installation

```bash
npm install expo-litedbstore
# or
yarn add expo-litedbstore
```

### Basic Usage

#### 1. Initialize and Create Table

```typescript
import { createTable } from 'expo-litedbstore';

// Create user table
await createTable('users', {
  columns: {
    id: { type: 'string', primaryKey: true },
    name: { type: 'string' },
    age: { type: 'number' },
    email: { type: 'string' },
    createdAt: { type: 'date' }
  }
});
```

#### 2. Insert Data

```typescript
import { insert } from 'expo-litedbstore';

await insert('users', {
  id: '1',
  name: 'John Doe',
  age: 30,
  email: 'john@example.com',
  createdAt: new Date()
});
```

#### 3. Query Data

```typescript
import { findOne, findMany } from 'expo-litedbstore';

// Query single record
const user = await findOne('users', { id: '1' });

// Conditional query
const youngUsers = await findMany('users', {
  filters: { age: { $lt: 30 } },
  sort: { age: 'asc' },
  limit: 10,
  offset: 0
});
```

#### 4. Update Data

```typescript
import { update } from 'expo-litedbstore';

await update('users', { id: '1' }, {
  age: 31,
  email: 'newemail@example.com'
});
```

#### 5. Delete Data

```typescript
import { remove } from 'expo-litedbstore';

await remove('users', { id: '1' });
```

#### 6. Bulk Operations

```typescript
import { bulkWrite } from 'expo-litedbstore';

await bulkWrite('users', [
  {
    operation: 'insert',
    data: { id: '2', name: 'Jane Doe', age: 28 }
  },
  {
    operation: 'update',
    filters: { id: '1' },
    data: { age: 31 }
  },
  {
    operation: 'delete',
    filters: { age: { $gt: 50 } }
  }
]);
```

### Advanced Features

#### Chunked Storage

For large datasets, automatically use chunked storage mode:

```typescript
await createTable('largeDataset', {
  columns: {
    // column definitions
  },
  mode: 'chunked' // force chunked mode
});
```

#### Data Migration

Migrate existing tables to chunked mode:

```typescript
import { migrateToChunked } from 'expo-litedbstore';

await migrateToChunked('users');
```

#### Encrypted Storage

Configure encrypted storage (encryption is disabled by default):

```typescript
// Configure at app startup
import { configure } from 'expo-litedbstore';

configure({
  useEncryption: true,
  encryptionKey: 'your-secure-key' // Use secure key management in production
});
```

### API Reference

#### Table Operations

- **`createTable(tableName, options)`**: Create a new table
- **`deleteTable(tableName)`**: Delete a table
- **`hasTable(tableName)`**: Check if a table exists
- **`listTables()`**: List all tables

#### Data Operations

- **`insert(tableName, data)`**: Insert a single record
- **`update(tableName, filters, data)`**: Update matching records
- **`remove(tableName, filters)`**: Delete matching records
- **`findOne(tableName, filters)`**: Query a single record
- **`findMany(tableName, queryOptions)`**: Query multiple records
- **`count(tableName, filters)`**: Count records
- **`bulkWrite(tableName, operations)`**: Execute bulk operations

#### Advanced Features

- **`migrateToChunked(tableName)`**: Migrate to chunked mode
- **`configure(options)`**: Configure storage options

### Configuration Options

Customize configuration via `liteStore.config.js`:

```javascript
module.exports = {
  CHUNK_SIZE: 8 * 1024 * 1024, // 8MB chunk size
  STORAGE_FOLDER: '.liteStore', // Storage folder
  SORT_METHOD: 'stable', // Sorting method
  // More configurations...
};
```

### Limitations and Notes

- Complex cross-chunk queries are not supported in chunked storage mode
- Encrypted storage slightly increases performance overhead
- Use `bulkWrite` for large datasets to improve performance
- Use encryption mode for sensitive data

### Example App

Check the `app` directory for example applications to understand real-world usage.

### License

MIT License

---

## <a id="chinese"></a>中文

### 轻量级、零配置的 Expo 本地数据存储库

基于 `expo-file-system` 的 JSON 存储 + 支持 `expo-secure-store` 加密存储。无需 SQL，无需原生代码 — 在 **Expo Go** 中完美运行。

### 特性

- **零配置**：开箱即用，无需复杂设置
- **双模式存储**：支持单文件和分片存储（适用于大数据集）
- **加密支持**：通过 AES-256-CTR 加密敏感数据
- **灵活查询**：支持条件过滤、分页和排序
- **事务操作**：批量写入支持
- **类型安全**：完整的 TypeScript 支持
- **跨平台**：支持 iOS、Android 和 Web
- **轻量级**：最小化依赖，优化性能

### 安装

```bash
npm install expo-litedbstore
# 或
yarn add expo-litedbstore
```

### 基本使用

#### 1. 初始化并创建表

```typescript
import { createTable } from 'expo-litedbstore';

// 创建用户表
await createTable('users', {
  columns: {
    id: { type: 'string', primaryKey: true },
    name: { type: 'string' },
    age: { type: 'number' },
    email: { type: 'string' },
    createdAt: { type: 'date' }
  }
});
```

#### 2. 插入数据

```typescript
import { insert } from 'expo-litedbstore';

await insert('users', {
  id: '1',
  name: '张三',
  age: 30,
  email: 'zhangsan@example.com',
  createdAt: new Date()
});
```

#### 3. 查询数据

```typescript
import { findOne, findMany } from 'expo-litedbstore';

// 查询单条记录
const user = await findOne('users', { id: '1' });

// 条件查询
const youngUsers = await findMany('users', {
  filters: { age: { $lt: 30 } },
  sort: { age: 'asc' },
  limit: 10,
  offset: 0
});
```

#### 4. 更新数据

```typescript
import { update } from 'expo-litedbstore';

await update('users', { id: '1' }, {
  age: 31,
  email: 'newemail@example.com'
});
```

#### 5. 删除数据

```typescript
import { remove } from 'expo-litedbstore';

await remove('users', { id: '1' });
```

#### 6. 批量操作

```typescript
import { bulkWrite } from 'expo-litedbstore';

await bulkWrite('users', [
  {
    operation: 'insert',
    data: { id: '2', name: '李四', age: 28 }
  },
  {
    operation: 'update',
    filters: { id: '1' },
    data: { age: 31 }
  },
  {
    operation: 'delete',
    filters: { age: { $gt: 50 } }
  }
]);
```

### 高级特性

#### 分片存储

当数据量大时，自动使用分片存储模式：

```typescript
await createTable('largeDataset', {
  columns: {
    // 列定义
  },
  mode: 'chunked' // 强制使用分片模式
});
```

#### 数据迁移

将现有表迁移到分片模式：

```typescript
import { migrateToChunked } from 'expo-litedbstore';

await migrateToChunked('users');
```

#### 加密存储

配置加密存储（默认情况下加密功能是禁用的）：

```typescript
// 在应用启动时配置
import { configure } from 'expo-litedbstore';

configure({
  useEncryption: true,
  encryptionKey: 'your-secure-key' // 实际应用中应使用安全的密钥管理
});
```

### API 参考

#### 表操作

- **`createTable(tableName, options)`**: 创建新表
- **`deleteTable(tableName)`**: 删除表
- **`hasTable(tableName)`**: 检查表是否存在
- **`listTables()`**: 列出所有表

#### 数据操作

- **`insert(tableName, data)`**: 插入单条记录
- **`update(tableName, filters, data)`**: 更新匹配的记录
- **`remove(tableName, filters)`**: 删除匹配的记录
- **`findOne(tableName, filters)`**: 查询单条记录
- **`findMany(tableName, queryOptions)`**: 查询多条记录
- **`count(tableName, filters)`**: 统计记录数量
- **`bulkWrite(tableName, operations)`**: 执行批量操作

#### 高级功能

- **`migrateToChunked(tableName)`**: 迁移到分片模式
- **`configure(options)`**: 配置存储选项

### 配置选项

可以通过 `liteStore.config.js` 自定义配置：

```javascript
module.exports = {
  CHUNK_SIZE: 8 * 1024 * 1024, // 8MB 分片大小
  STORAGE_FOLDER: '.liteStore', // 存储文件夹
  SORT_METHOD: 'stable', // 排序方法
  // 更多配置...
};
```

### 限制和注意事项

- 分片存储模式下不支持复杂的跨分片查询
- 加密存储会略微增加性能开销
- 建议为大型数据集使用 `bulkWrite` 以提高性能
- 敏感数据请使用加密模式存储

### 示例应用

查看 `app` 目录下的示例应用，了解实际使用方式。

### 许可证

MIT License
