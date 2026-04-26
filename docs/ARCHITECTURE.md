# Expo Lite Data Store Architecture

[简体中文](./ARCHITECTURE.zh-CN.md) | [English Alias](./ARCHITECTURE.en.md) | [Consumer Guide](../README.md)

## 1. System Overview

Expo Lite Data Store is a lightweight local database solution based on Expo File System, supporting single-file and sharded storage modes, providing complete CRUD operations, transaction support, caching mechanism, indexing functionality, API routing, and data encryption.

## 2. Layered Architecture

| Layer             | Responsibility                                             | Main Components                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Interface Layer   | Provides unified API interface externally                  | FileSystemStorageAdapter, EncryptedStorageAdapter, StorageAdapterFactory |
| Data Access Layer | Handles data read/write operations                         | DataReader, DataWriter, QueryEngine                             |
| Cache Layer       | Provides caching mechanism to improve query performance    | CacheManager                                                    |
| Index Layer       | Provides indexing functionality to accelerate data queries | IndexManager                                                    |
| Encryption Layer  | Provides data encryption and key management                | EncryptedStorageAdapter, crypto-gcm, cryptoProvider             |
| Storage Layer     | Handles physical storage of data                           | ChunkedFileHandler, SingleFileHandler                           |
| Metadata Layer    | Manages database metadata                                  | MetadataManager                                                 |
| Monitor Layer     | Monitors system performance and cache status               | PerformanceMonitor, CacheMonitor                                |
| Utility Layer     | Provides common utility functions                          | FileOperationManager, withTimeout, logger                       |

## 3. Core Module Design

### 3.1 Interface Layer

#### FileSystemStorageAdapter
- Table management (create, delete, list tables)
- Data read/write (insert, update, delete, query)
- Transaction management (begin, commit, rollback)
- Batch operations and schema migration

#### EncryptedStorageAdapter
- AES-256-GCM encryption (NIST SP 800-38D compliant)
- Field-level and full-table encryption
- Key management with PBKDF2 + HKDF two-tier derivation

#### StorageAdapterFactory
- Creates appropriate storage adapters based on configuration
- Supports FILE_SYSTEM and ENCRYPTED adapter types

### 3.2 Data Access Layer

#### DataReader
- Read table data with filtering and pagination
- Cache integration with LRU/LFU strategies
- Index-based query optimization

#### DataWriter
- Write data to tables (insert, overwrite, update, delete)
- Automatic table creation
- Data validation and index updates
- Concurrency control with operation locks

#### QueryEngine
- Complex query conditions ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $like, $and, $or)
- Multiple sorting algorithms (default, fast, counting, merge, slow)
- Pagination support with skip/limit

### 3.3 Encryption Layer

#### crypto.ts / crypto-gcm.ts
- AES-256-GCM encryption (default, recommended)
- AES-256-CTR + HMAC (backward compatible)
- PBKDF2 key derivation (600,000 iterations, OWASP 2026)
- HKDF for fast per-record key derivation (~3μs vs ~2s)
- Field-level and bulk encryption/decryption

#### cryptoProvider.ts
- Pure JavaScript fallback for Expo Go via `crypto-js`
- Native acceleration via react-native-quick-crypto (optional)
- expo-crypto integration for secure random bytes

### 3.4 Storage Layer

#### ChunkedFileHandler
- Automatic data chunking (>5MB files)
- Atomic writes with temp file + rename
- Hash-based data integrity verification
- Parallel chunk reading with caching

#### SingleFileHandler
- Single-file storage for small datasets
- Atomic writes with temp file + rename
- Retry mechanism for file lock errors

#### FileHandlerFactory
- Creates appropriate file handlers based on storage mode
- Automatic mode selection based on data size

### 3.5 Cache Layer

#### CacheManager
- LRU (Least Recently Used) strategy
- LFU (Least Frequently Used) strategy
- Cache penetration protection (null value caching)
- Cache avalanche protection (random TTL jitter)
- Cache stampede protection (async mutex locks)
- Min-heap based expiry tracking for O(k log n) cleanup
- Approximate size calculation (JSON-based, 10-100x faster)

### 3.6 Index Layer

#### IndexManager
- Unique and non-unique field indexes
- Composite index support
- Batch index rebuilding (3-5x faster)
- Index-based query optimization

### 3.7 Metadata Layer

#### MetadataManager
- Table schema management
- Lazy loading with debounce saving
- Version tracking and migration support
- Automatic metadata persistence

### 3.8 Monitor Layer

#### PerformanceMonitor
- Operation timing and statistics
- Sampling strategy (10% default, 90% overhead reduction)
- Health check support
- Configurable metrics retention

#### CacheMonitor
- Cache hit rate monitoring
- Memory usage tracking
- Eviction statistics

### 3.9 Service Layer

#### TransactionService
- ACID-compliant transactions
- Snapshot-based rollback
- Transaction data caching and computation

#### AutoSyncService
- Periodic dirty data synchronization
- Exponential backoff retry with jitter
- Batch processing for efficiency
- Graceful shutdown support

#### CacheService
- Table-level cache invalidation
- Cache key management

## 4. Data Flow

### 4.1 Write Flow
1. Client calls `write`/`insert`/`overwrite`
2. FileSystemStorageAdapter validates input
3. DataWriter validates data and ensures table exists
4. Write operation executes (single-file or chunked mode)
5. Indexes are updated
6. Metadata is updated
7. Result is returned

### 4.2 Read Flow
1. Client calls `read`/`findOne`/`findMany`
2. Cache is checked (unless bypassed)
3. Index is used if available
4. Data is read from storage
5. Filtering, sorting, and pagination are applied
6. Result is cached (if not high-risk data)
7. Result is returned

### 4.3 Transaction Flow
1. Client calls `beginTransaction()`
2. Operations are queued (not executed immediately)
3. Client calls `commit()` to execute all operations atomically
4. Or client calls `rollback()` to discard all operations

## 5. Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Cache hit read | <1ms | LRU/LFU strategies |
| Uncached read (1K records) | 5-20ms | Depends on storage mode |
| Uncached read (10K records) | 50-200ms | Chunked mode recommended |
| Single write | 10-50ms | Atomic write with retry |
| Batch write (100 items) | 50-200ms | Optimized for throughput |
| Index query | O(1) lookup | After O(n) index build |
| GCM encryption (first) | ~2s | PBKDF2 600K iterations |
| GCM encryption (subsequent) | ~3μs | HKDF key expansion |

## 6. Security Design

### 6.1 Encryption
- AES-256-GCM (NIST SP 800-38D, OWASP MASVS 2026)
- PBKDF2 key derivation with 600,000 iterations
- HKDF for fast per-record key derivation
- Field-level and full-table encryption modes
- Biometric authentication support (optional)

### 6.2 Data Integrity
- SHA-512 hash verification on read
- Atomic writes prevent partial writes
- Automatic data corruption detection

### 6.3 Key Management
- Secure key storage via expo-secure-store
- In-memory fallback for Expo Go
- Key cache with LRU cleanup
- Master key reset support (logout/reset)

## 7. Expo Go Compatibility

| Feature | Expo Go | Standalone APK/IPA |
|---------|---------|-------------------|
| File System | ✅ expo-file-system | ✅ expo-file-system |
| Crypto | ✅ crypto-js/native helpers (JS) | ✅ + native acceleration |
| Secure Store | ✅ expo-secure-store | ✅ expo-secure-store |
| Constants | ✅ expo-constants | ✅ expo-constants |
| Native Crypto | ❌ (falls back to JS) | ✅ react-native-quick-crypto |

## 8. Configuration

Configuration can be provided via:
1. `configManager.updateConfig()` (highest priority)
2. `global.__expoConfig` (Expo environment)
3. `app.json` extra field
4. Default configuration (lowest priority)

Key configuration options:
- `chunkSize`: File chunk size (default: 5MB)
- `encryption.algorithm`: 'auto' | 'AES-GCM' | 'AES-CTR'
- `encryption.keyIterations`: PBKDF2 iterations (default: 600,000)
- `cache.maxSize`: Maximum cache entries
- `performance.maxConcurrentOperations`: Max concurrent operations (default: 5)
