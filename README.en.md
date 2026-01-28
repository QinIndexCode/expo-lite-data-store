# expo-lite-data-store

---

**Notice**: The current project test coverage is limited, and may contain undiscovered issues. Before using in a production environment, please conduct thorough testing.

---

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.72+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

**Lightweight, easy-configuration, pure TypeScript Expo local database**

Designed specifically for React Native + Expo projects: TypeScript-only by default; in standalone APK/IPA builds it automatically enables native acceleration via react-native-quick-crypto to boost KDF and hashing performance (falls back to JavaScript in Expo Go and prints a one-time developer notice). Provides complete CRUD operations, transaction support, index optimization, and intelligent sorting features.

## ✨ Core Features

| Feature                          | Description                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 🚀 **Easy configuration**        | Only depends on React Native FS, no Metro configuration                         |
| 🔒 **Optional encryption**       | AES-CTR encryption with optional biometric authentication, keys automatically generated and managed by system, default 120,000 PBKDF2 iterations (mobile optimized)      |
| 📦 **Intelligent chunking**      | Automatically handles >5MB files, avoiding RN FS limits                         |
| 🔄 **Transaction support**       | Transaction support, data consistency ensured                                   |
| 📝 **TypeScript native support** | Complete type definitions, ready to use                                         |
| 🔍 **Advanced queries**          | Supports advanced queries like where, skip, limit, sort                         |
| 📱 **Fully offline**             | No network required, 100% local data storage                                    |
| 🎯 **Intelligent sorting**       | 5 sorting algorithms, automatically selects appropriate algorithm based on data size |
| ⏰ **Auto-sync**                 | Periodically syncs dirty data from cache to disk, ensuring data persistence      |
| 🛡️ **Data consistency validation** | Provides verifyCountTable tool to validate and fix consistency between metadata and actual data |
| 📊 **Batch operations**          | Supports batch insert, update, delete operations for improved efficiency        |

## 📦 Installation

```bash
npm install expo-lite-data-store
# or use yarn / pnpm (At present, only npm has been uploaded, and yarn and pnpm will be followed in the future.)
yarn add expo-lite-data-store
pnpm add expo-lite-data-store
```

## 🚀 Quick Start

```typescript
// ES module import
import { createTable, insert, findOne, findMany, update, remove } from 'expo-lite-data-store';

// CommonJS import
// const { createTable, insert, findOne, findMany, update, remove } = require('expo-lite-data-store');

// Create user table
await createTable('users');

// Insert data
await insert('users', [
  { id: 1, name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
  { id: 2, name: 'Li Si', age: 30, email: 'lisi@example.com' },
  { id: 3, name: 'Wang Wu', age: 35, email: 'wangwu@example.com' },
]);

// Query single data - Prisma style: where as part of options
const user = await findOne('users', {
  where: { id: 1 }
});
console.log(user); // { id: 1, name: 'Zhang San', age: 25, email: 'zhangsan@example.com' }

// Query multiple data - Prisma style: where as part of options
const users = await findMany('users', {
  where: { age: { $gte: 30 } },
  sortBy: 'age',
  order: 'desc'
});
console.log(users); // Returns users with age >= 30, sorted by age descending

// Update data - Prisma style: where as part of options
const updatedCount = await update('users', { age: 26 }, {
  where: { id: 1 }
});
console.log(`Updated ${updatedCount} records`);

// Delete data - Prisma style: where as part of options
const deletedCount = await remove('users', {
  where: { id: 2 }
});
console.log(`Deleted ${deletedCount} records`);
```

```javascript
// JavaScript usage is the same
const { createTable, insert, findMany } = require('expo-lite-data-store');

// Or use ES module import
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

## 🔒 Encryption Usage

The library supports multiple encryption modes, including non-encrypted mode and encrypted mode.

### Basic Usage Example

```typescript
// Non-encrypted mode (default)
await createTable('users');

// Encrypted mode
await createTable('users', {
  encrypted: true
});
```

**Detailed Encryption Documentation**: Please refer to the encryption section in the Chinese README for complete encryption configuration and best practices.

## 📚 Basic API Reference

### API Categories

The library provides complete CRUD operations, transaction support, and advanced query features, categorized as follows:

- **Table Management**: `createTable`, `deleteTable`, `hasTable`, `listTables`, `countTable`, `clearTable`, `verifyCountTable`
- **Data Operations**: `insert`, `write`, `read`, `findOne`, `findMany`, `update`, `remove`, `bulkWrite`
- **Transaction Management**: `beginTransaction`, `commit`, `rollback`

**Detailed API Documentation**: Please refer to the API reference section in the Chinese README for complete API signatures and parameter descriptions.

## 📖 Detailed Documentation

For complete detailed documentation, please check the Chinese README file, including:

- 🎯 **Advanced Queries**: Complex conditional queries, operators, compound queries
- 🎯 **Smart Sorting**: Multi-field sorting, algorithm selection, performance optimization
- 🎯 **Transaction Management**: ACID transactions, best practices
- 🎯 **Performance Optimization**: Indexes, batch operations, pagination strategies
- 🎯 **Security**: Data encryption, key management
- 🎯 **Troubleshooting**: Common issues, debugging tips

## 🔧 Configuration

### Configuration Sources

The library supports reading configuration from multiple sources with the following priority (highest to lowest):

1. **Programmatic configuration (advanced)**: via `ConfigManager.setConfig / updateConfig` (not part of the public API)
2. **app.json extra.liteStore configuration** (Recommended):
   ```json
   {
     "expo": {
       "extra": {
         "liteStore": {
           "autoSync": {
             "enabled": true,
             "interval": 60000,
             "minItems": 10,
             "batchSize": 100
           },
           "chunkSize": 1024
         }
       }
     }
   }
   ```

3. **Environment variables**: e.g. `LITE_STORE_CHUNK_SIZE`, `LITE_STORE_AUTO_SYNC_INTERVAL` (useful in Node/tests)
4. **Default configuration**:
   Built-in default configuration for all unspecified options

### Encryption Recommendation Mode

**Unless you have special requirements, we recommend using field-level encryption** for the following reasons:

1. **Better performance**: Supports incremental writes, no need to re-encrypt the entire table for each operation
2. **More flexible queries**: Can directly query unencrypted fields without decrypting the entire table
3. **Supports partial encryption**: Can only encrypt sensitive fields, improving performance
4. **Default behavior**: The system now uses field-level encryption by default, no manual configuration required

**Full-table encryption is only recommended in the following special cases**:
- Highest level of data security is required
- Table data volume is small, performance impact is acceptable
- Need to ensure all data fields are encrypted

### Configuration Options

Recommended configuration is via app.json under `expo.extra.liteStore`, but you can also inject config via environment variables or `global.liteStoreConfig` before initialization. Here are the main configuration options you can customize:

```json
{
  "expo": {
    "extra": {
      "liteStore": {
        // Basic configuration
        "chunkSize": 10485760, // File chunk size (10MB)
        "storageFolder": "lite-data-store", // Storage folder name
        "sortMethods": "default", // Default sorting algorithm
        "timeout": 10000, // Operation timeout (10 seconds)
        
        // API configuration
        "api": {
          "rateLimit": {
            "enabled": false, // Whether to enable rate limiting
            "requestsPerSecond": 10, // Maximum requests per second
            "burstCapacity": 20 // Burst capacity
          },
          "retry": {
            "maxAttempts": 3, // Maximum retry attempts
            "backoffMultiplier": 2 // Backoff multiplier
          }
        },
        
        // Encryption configuration
        "encryption": {
          "algorithm": "AES-CTR", // Encryption algorithm
          "keySize": 256, // Key size
          "hmacAlgorithm": "SHA-512", // HMAC algorithm
          "keyIterations": 120000, // Key iteration count (120,000 for mobile optimization)
          "encryptedFields": ["password", "email", "phone"], // Fields to encrypt
          "cacheTimeout": 30000, // Cache timeout (30 seconds)
          "maxCacheSize": 100, // Maximum number of cached keys
          "useBulkOperations": true, // Enable bulk operations
          "autoSelectHMAC": true // Auto-select HMAC algorithm based on data size
        },
        
        // Performance configuration
        "performance": {
          "enableQueryOptimization": true, // Enable query optimization
          "maxConcurrentOperations": 5, // Maximum concurrent operations (3-10 recommended)
          "enableBatchOptimization": true, // Enable batch operation optimization
          "memoryWarningThreshold": 0.8 // Memory warning threshold (0-1 range)
        },
        
        // Auto-sync configuration
        "autoSync": {
          "enabled": true, // Whether to enable auto-sync
          "interval": 30000, // Auto-sync interval (30 seconds)
          "minItems": 1, // Minimum number of dirty items to trigger sync
          "batchSize": 100 // Maximum number of items to sync per batch
        },
        
        // Cache configuration
        "cache": {
          "maxSize": 1000, // Maximum number of cache entries
          "defaultExpiry": 3600000, // Default cache expiration (1 hour)
          "cleanupInterval": 300000, // Cache cleanup interval (5 minutes)
          "memoryWarningThreshold": 0.8 // Cache memory warning threshold
        },
        
        // Monitoring configuration
        "monitoring": {
          "enablePerformanceTracking": false, // Whether to enable performance tracking
          "enableHealthChecks": true, // Whether to enable health checks
          "metricsRetention": 86400000 // Metrics retention period (24 hours)
        }
      }
    }
  }
}
```

## 🐛 Common Issues

### Q: How to switch between different versions?

A: The library automatically provides TypeScript support through type definition files. You can use the same import path for both JavaScript and TypeScript projects:

- `import { ... } from 'expo-lite-data-store'` - Recommended use
- `import { ... } from 'expo-lite-data-store/js'` - Explicit JavaScript version (same as default)

### Q: How to handle Chinese sorting?

A: Use `sortAlgorithm: 'slow'` for complete Chinese support:

```typescript
const users = await findMany('users', {
  where: {},
  sortBy: 'name',
  sortAlgorithm: 'slow',
});
```

### Q: How to improve query performance?

A: For large datasets, it is recommended to use:

- Pagination querying
- Appropriate sorting algorithm
- Batch operations

### Q: Encrypted write and read operations are slow, how to optimize?

A: Encryption operations do increase certain performance overhead, here are some optimization suggestions:

1. **Use field-level encryption instead of full-table encryption**: Only encrypt sensitive fields instead of entire table, which can improve query performance
2. **Increase key cache timeout**: Increase the value of `encryption.cacheTimeout` in configuration to reduce the number of key derivations
3. **Enable batch operations**: Ensure `encryption.useBulkOperations` is `true`, which can reduce the number of encryption/decryption operations
4. **Reduce key iteration count**: Appropriately reduce the value of `encryption.keyIterations` (not less than 100000) to speed up key derivation. The default is 120,000 iterations for mobile optimization
5. **Reasonably set `maxConcurrentOperations`**: Adjust the number of concurrent operations according to device performance, recommended range: 3-10

## 📞 Support and Feedback

- 📧 **Email**: [qinIndexCode@gmail.com](gmail:qinIndexCode@gmail.com)
- 💬 **Issues**: [GitHub Issues](https://github.com/QinIndexCode/expo-liteDataStore/issues)
- 📖 **Documentation**: [README](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.md)

## License

MIT © QinIndexCode

---

If you like it, don't forget to give it a ⭐ Star to let more people discover this project!
