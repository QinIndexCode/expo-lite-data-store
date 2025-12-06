# expo-lite-data-store Detailed Documentation

## 🎯 Advanced Queries

### Query Operators

| Operator | Description    | Example                                |
| -------- | -------------- | -------------------------------------- |
| `$eq`    | Equal to       | `{ age: { $eq: 25 } }`                 |
| `$ne`    | Not equal to   | `{ status: { $ne: 'inactive' } }`      |
| `$gt`    | Greater than   | `{ age: { $gt: 18 } }`                 |
| `$gte`   | Greater or equal| `{ score: { $gte: 60 } }`              |
| `$lt`    | Less than      | `{ price: { $lt: 100 } }`              |
| `$lte`   | Less or equal  | `{ quantity: { $lte: 10 } }`           |
| `$in`    | In array       | `{ category: { $in: ['A', 'B'] } }`    |
| `$nin`   | Not in array   | `{ status: { $nin: ['deleted'] } }`    |
| `$like`  | Fuzzy match    | `{ name: { $like: 'Zhang%' } }`        |

### Complex Queries

```typescript
import { findMany } from 'expo-lite-data-store';

// AND query
const activeAdults = await findMany('users', {
  $and: [{ age: { $gte: 18 } }, { active: true }, { role: { $in: ['user', 'admin'] } }],
});

// OR query
const featuredOrNew = await findMany('products', {
  $or: [{ featured: true }, { createdAt: { $gt: '2024-01-01' } }],
});

// Complex nested query
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

## 🎯 Smart Sorting

### Basic Sorting

```typescript
// Single field sorting
const usersByAge = await findMany(
  'users',
  {},
  {
    sortBy: 'age',
    order: 'asc', // 'asc' | 'desc'
  }
);

// Multi-field sorting (stable sort)
const usersSorted = await findMany(
  'users',
  {},
  {
    sortBy: ['department', 'name', 'age'],
    order: ['asc', 'asc', 'desc'],
  }
);
```

### Sorting Algorithm Selection

The system provides 5 professional sorting algorithms, automatically selecting the optimal one:

| Algorithm  | Use Case                 | Performance Characteristics |
| ---------- | ------------------------ | --------------------------- |
| `default`  | Small datasets (< 100 items) | Balanced performance and features |
| `fast`     | Large datasets, simple comparison | Fastest, but simplified functionality |
| `merge`    | Large datasets, stable sorting | Stable, suitable for large data |
| `counting` | Limited range values (e.g., status, level) | O(n+k), space for time |
| `slow`     | Requires full localeCompare | Supports Chinese, special characters |

```typescript
// Auto-select algorithm (recommended)
const users = await findMany('users', {}, { sortBy: 'score' });

// Manually specify algorithm
const users = await findMany(
  'users',
  {},
  {
    sortBy: 'name',
    sortAlgorithm: 'slow', // Supports Chinese sorting
  }
);

// Large data optimization
const largeDataset = await findMany(
  'logs',
  {},
  {
    sortBy: 'timestamp',
    sortAlgorithm: 'merge', // Suitable for large data
  }
);
```

### Sorting + Filtering + Pagination

```typescript
// Complete query example
const paginatedResults = await findMany(
  'products',
  // Filter conditions
  {
    $and: [{ price: { $gte: 50, $lte: 500 } }, { category: { $in: ['electronics', 'books'] } }, { inStock: true }],
  },
  // Query options
  {
    sortBy: ['rating', 'price', 'name'],
    order: ['desc', 'asc', 'asc'],
    skip: 20, // Skip first 20 items
    limit: 10, // Return 10 items
  }
);
```

## 🎯 Transaction Management

### ACID Transactions

Best practice for ensuring data consistency:

```typescript
import { beginTransaction, commit, rollback, insert, update, findOne } from 'expo-lite-data-store';

async function transferMoney(fromUserId: number, toUserId: number, amount: number) {
  try {
    // Start transaction
    await beginTransaction();

    // Check sender's balance
    const sender = await findOne('users', { id: fromUserId });
    if (!sender || sender.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Execute transfer operation
    await update('users', { balance: sender.balance - amount }, { id: fromUserId });
    await update('users', { balance: { $inc: amount } }, { id: toUserId });

    // Record transfer log
    await insert('transactions', {
      id: Date.now(),
      fromUserId,
      toUserId,
      amount,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await commit();
    console.log('Transfer completed successfully');
  } catch (error) {
    // Rollback all operations on error
    await rollback();
    console.error('Transfer failed:', error);
    throw error;
  }
}
```

### Transaction Best Practices

1. **Keep transactions short**: Transactions hold locks, long-running transactions affect performance
2. **Avoid nested transactions**: Current version doesn't support nested transactions
3. **Error handling**: Always wrap transaction code in try-catch
4. **Batch operations**: Use bulk operations in transactions to reduce disk I/O
5. **Test rollback**: Ensure rollback mechanism works correctly

## 🎯 Auto-sync Mechanism

### Configuring Auto-sync

```typescript
import { setAutoSyncConfig, getSyncStats, syncNow } from 'expo-lite-data-store';

// Get current sync statistics
const stats = await getSyncStats();
console.log('Sync statistics:', stats);

// Trigger sync immediately
await syncNow();

// Custom auto-sync configuration
setAutoSyncConfig({
  enabled: true, // Enable auto-sync
  interval: 10000, // Sync every 10 seconds
  minItems: 5, // Sync at least 5 dirty items
  batchSize: 200, // Max 200 items per sync
});
```

### Sync Configuration Parameters

| Parameter   | Type    | Default | Description               |
| ----------- | ------- | ------- | ------------------------- |
| `enabled`   | boolean | `true`  | Whether to enable auto-sync |
| `interval`  | number  | `5000`  | Sync interval (milliseconds) |
| `minItems`  | number  | `1`     | Minimum number of items to sync |
| `batchSize` | number  | `100`   | Batch size limit          |

### Sync Statistics

| Field Name          | Type   | Description                 |
| ------------------- | ------ | --------------------------- |
| `syncCount`         | number | Total sync count            |
| `totalItemsSynced`  | number | Total items synced          |
| `lastSyncTime`      | number | Last sync time              |
| `avgSyncTime`       | number | Average sync time (milliseconds) |

## 🎯 Performance Optimization

### Index Optimization

Current version supports automatic indexing:

- Automatically creates index for `id` field
- Automatically creates indexes for common fields (`name`, `email`, `type`, `status`)
- Indexes are built automatically after data reading
- Indexes are cleared and rebuilt when data is modified

```typescript
// Example of index usage
const user = await findOne('users', { id: 123 }); // Uses id index
const users = await findMany('users', { email: 'user@example.com' }); // Uses email index
```

### Batch Operation Optimization

```typescript
// Use bulkWrite for batch operations, more efficient than multiple individual operations
await bulkWrite('products', [
  { type: 'insert', data: { id: 1, name: 'Product 1' } },
  { type: 'update', data: { id: 2, price: 29.99 } },
  { type: 'delete', data: { id: 3 } },
]);
```

### Pagination Optimization

```typescript
// For large datasets, use pagination to avoid loading too much data at once
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

  // Process current page data
  processPageData(results);

  page++;
}
```

### Cache Optimization

```typescript
// Configure cache
// liteStore.config.js
module.exports = {
  encryption: {
    cacheTimeout: 30000, // Cache timeout (milliseconds)
    maxCacheSize: 100,    // Maximum number of cached tables
  },
};

// Disable cache
// Set cacheTimeout: 0
```

## 🎯 Security

### Data Encryption

```typescript
// Note: Encryption feature needs to be enabled during project initialization
// Current version's encryption feature is under development, stay tuned

// Future version usage:
// import { enableEncryption, setEncryptionKey } from 'expo-lite-data-store';
//
// // Enable encryption
// await enableEncryption();
//
// // Set encryption key (please keep it safe)
// await setEncryptionKey('your-secure-key-here');
//
// // Encrypted data will be automatically handled, no additional code needed
```

### Security Best Practices

1. **Key management**: Keep encryption keys safe, avoid hardcoding
2. **Sensitive data**: Enable encryption for data containing sensitive information
3. **Backup security**: Protect backups of encrypted data
4. **Key rotation**: Regularly rotate encryption keys
5. **Permission control**: Limit access permissions to database files

## 🎯 Troubleshooting

### Common Issues

#### Q: Incorrect sorting order?
A: Check if the sorting field has null/undefined values, which are sorted at the end.

#### Q: Slow query performance?
A: Try using a more suitable sorting algorithm for your data volume, or enable pagination.

#### Q: High memory usage?
A: For super large datasets, consider using pagination or `fast` sorting algorithm.

#### Q: Incorrect Chinese sorting?
A: Use `sortAlgorithm: 'slow'` for complete Chinese support.

#### Q: How to use in pure JavaScript projects?
A: JavaScript version is automatically used when importing, no special configuration needed.

#### Q: What's the difference between TypeScript and JavaScript versions?
A: TypeScript version provides complete type checking and IDE support; JavaScript version is lightweight but has no type checking.

#### Q: How to build your own version?
A: Run `npm run build:all` to build complete TypeScript and JavaScript versions.

### Debugging Tips

1. **Enable debug logs**: Enable detailed logs in development environment
2. **Check configuration**: Ensure configuration file is loaded correctly
3. **Verify table existence**: Check if table exists before operation
4. **View sync statistics**: Check if auto-sync is working properly
5. **Monitor performance**: Use performance monitoring tools to check query time

## 🎯 API Reference

### ReadOptions Interface

```typescript
interface ReadOptions {
  // Pagination options
  skip?: number; // Number of records to skip
  limit?: number; // Maximum number of records to return

  // Filter options
  filter?: FilterCondition; // Query condition

  // Sorting options
  sortBy?: string | string[]; // Sort field(s)
  order?: 'asc' | 'desc' | ('asc' | 'desc')[]; // Sort direction
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow'; // Sorting algorithm
}
```

### FilterCondition Type

```typescript
type FilterCondition =
  | ((item: Record<string, any>) => boolean) // Function condition
  | Partial<Record<string, any>> // Simple object condition
  | {
      // Advanced conditions
      $or?: FilterCondition[];
      $and?: FilterCondition[];
      [key: string]: any;
    };
```

### WriteResult Interface

```typescript
interface WriteResult {
  written: number; // Number of bytes written
  totalAfterWrite: number; // Total bytes after write
  chunked: boolean; // Whether chunked writing was used
  chunks?: number; // Number of chunks (when chunked writing)
}
```

## 🎯 Performance Benchmarks

### Sorting Algorithm Performance Comparison

| Algorithm  | Small Dataset (<100) | Medium Dataset (100-10K) | Large Dataset (>10K) | Memory Usage | Stability |
| ---------- | -------------------- | ------------------------- | -------------------- | ------------ | --------- |
| default    | ⭐⭐⭐⭐⭐           | ⭐⭐⭐                      | ⭐⭐                   | Low          | High      |
| fast       | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐                  | ⭐⭐⭐                 | Low          | Medium    |
| merge      | ⭐⭐⭐⭐                | ⭐⭐⭐⭐⭐                  | ⭐⭐⭐⭐⭐             | Medium       | High      |
| counting   | ⭐⭐⭐                 | ⭐⭐⭐⭐⭐                  | ⭐⭐⭐⭐⭐             | High\*       | High      |
| slow       | ⭐⭐                   | ⭐⭐                        | ⭐⭐                   | Low          | High      |

\* Counting sort is memory efficient when range is limited

### Recommended Use Cases

- **Real-time search results**: Use `fast` algorithm
- **Big data analysis**: Use `merge` algorithm
- **Status/rank sorting**: Use `counting` algorithm
- **Chinese content sorting**: Use `slow` algorithm
- **General scenarios**: Don't specify algorithm, let it auto-select

## 🎯 Version Selection

| Import Path                | Type Support      | Use Case          | Source Files                                 |
| ---------------------------| ---------------- | ----------------- | -------------------------------------------- |
| `'expo-lite-data-store'`    | ✅ Auto-select   | Recommended (default) | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/js'` | ✅ TypeScript    | JavaScript environment | `dist/js/index.js` + `dist/types/index.d.ts` |
| `'expo-lite-data-store/ts'` | ✅ TypeScript    | TypeScript environment | `dist/js/index.js` + `dist/types/index.d.ts` |

## 🎯 Build Tool Integration

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
    // Other plugins
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

## 📞 Support and Feedback

- 📧 **Email**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **Documentation**: [README](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.md)

## License

MIT © QinIndex Qin