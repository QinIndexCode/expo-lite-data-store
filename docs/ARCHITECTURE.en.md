# Expo Lite Data Store Architecture

[README Entry](../README.md) | [简体中文](./ARCHITECTURE.zh-CN.md) | [Consumer Guide](../README.en.md)

## 1. System Overview

Expo Lite Data Store is a lightweight local database solution based on Expo File System. It supports single-file and chunked storage modes, CRUD operations, in-process transaction coordination, caching, indexes, API routing, and data encryption.

## 2. Layered Architecture

| Layer             | Responsibility                                             | Main Components                                                          |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Interface Layer   | Provides unified API interface externally                  | FileSystemStorageAdapter, EncryptedStorageAdapter, StorageAdapterFactory |
| Data Access Layer | Handles data read/write operations                         | DataReader, DataWriter, QueryEngine                                      |
| Cache Layer       | Provides caching mechanism to improve query performance    | CacheManager                                                             |
| Index Layer       | Provides indexing functionality to accelerate data queries | IndexManager                                                             |
| Encryption Layer  | Provides data encryption and key management                | EncryptedStorageAdapter, crypto-gcm, cryptoProvider                      |
| Storage Layer     | Handles physical storage of data                           | ChunkedFileHandler, SingleFileHandler                                    |
| Metadata Layer    | Manages database metadata                                  | MetadataManager                                                          |
| Monitor Layer     | Monitors system performance and cache status               | PerformanceMonitor, CacheMonitor                                         |
| Utility Layer     | Provides common utility functions                          | PathHelper, withTimeout, logger                                          |

## 3. Core Module Design

### 3.1 Interface Layer

#### FileSystemStorageAdapter

- Table management (create, delete, list tables)
- Data read/write (insert, update, delete, query)
- Transaction management (begin, commit, rollback)
- Batch operations and schema migration
- Storage permission probing runs on each adapter runtime-initialization cycle; concurrent probes share only their in-flight work, and the write hot path does not repeat filesystem checks

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
- Index-based query optimization uses a stable string/finite-number `id`, with `_id` as fallback
- A compatible index containing any row without a stable identifier is excluded from acceleration, so the reader performs a full scan
- A shared metadata mutation epoch invalidates stale representation, cache namespace, and index state across adapters; reads retry a bounded number of times until one metadata generation remains stable

#### DataWriter

- Write data to tables (insert, overwrite, update, delete)
- Automatic table creation
- Data validation and index updates
- FIFO table locks are shared across DataWriter instances and keyed by storage root plus table name
- Lock acquisition is limited to 30 seconds; a timed-out waiter releases only its own gate, preserving later waiters, while operation-slot handoff enforces the configured concurrency limit
- Table deletion commits metadata absence first; commit failure restores metadata without touching data, while post-commit cleanup failure leaves a logically absent table whose orphaned artifacts can be retried or purged before same-name creation

#### QueryEngine

- Complex query conditions ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $like, $and, $or)
- Multiple sorting algorithms (default, fast, counting, merge, slow)
- Every algorithm keeps `null` and `undefined` stable and last for both ascending and descending order
- Pagination support with skip/limit

### 3.3 Encryption Layer

#### crypto.ts / crypto-gcm.ts

- AES-256-GCM encryption (default, recommended)
- AES-256-CTR + HMAC (backward compatible)
- PBKDF2 key derivation (600,000 configured default; Expo Go may use the documented runtime reduction)
- HKDF for per-record key derivation
- Field-level and bulk encryption/decryption
- Mixed legacy CTR/current GCM bulk decryption groups payloads by provider and restores original order

#### cryptoProvider.ts

- Pure JavaScript fallback for Expo Go via `crypto-js`
- Native acceleration via react-native-quick-crypto (optional)
- expo-crypto integration for secure random bytes

### 3.4 Storage Layer

#### FileHandlerBase

- Single-file and chunked handlers share one in-process FIFO queue per physical path across handler instances
- Path-lock acquisition is limited to 30 seconds; timed-out waiters release their queue gate and are removed when the tail settles
- The lock is process-local coordination and does not provide cross-process filesystem locking

#### ChunkedFileHandler

- At table creation, automatically selects chunked mode when the initial-data estimate exceeds half of the configured `chunkSize` (default: >2.5 MiB)
- Recoverable publication with temporary files and journals; it does not assume destination replacement is atomic on every Expo platform
- A bounded overwrite-v2 journal records previous count/chunk state while old chunks move to `<table>.overwrite-backup/`; `.ready` marks a fully prepared backup
- Overwrite-journal deletion is the commit point. A committed leftover backup is deleted only after a later access validates the current chunk set
- Single-to-chunked migration publishes and verifies the new chunk set before the metadata mode switch; that switch commits the migration, and later obsolete-single cleanup cannot roll it back
- A separate append journal is recovered before any pending overwrite journal
- Reads, writes, range reads, preloads, and clears execute recovery-sensitive work under the shared table-directory path lock
- Failed writes clean partial chunks, journals when rollback is complete, and temporary staging files
- Hash-based data integrity verification
- Parallel chunk reading with caching

#### SingleFileHandler

- Before primary replacement, a table-bound v2 commit marker records previous/target internal `storageCommitToken` values, SHA-256 hashes, and physical record counts
- Restart recovery resolves the durable token from the metadata file, not an adapter cache. Canonical v1 markers remain compatibility evidence; temporary evidence is authoritative only when it is v2, `committed`, and its table/token/hash/count all match the durable target generation
- Single-file storage for small datasets
- Recoverable publication with a verified `.bak` predecessor while related metadata is finalized
- The shared path lock is retained from recoverable publication through explicit commit or rollback
- A non-cancellable mutation that crosses its deadline is observed to settlement and rolled back before releasing the lock
- Primary/backup validation with fail-closed corruption handling
- Retry mechanism for file lock errors

### 3.5 Cache Layer

#### CacheManager

- LRU (Least Recently Used) strategy
- LFU (Least Frequently Used) strategy
- Cache penetration protection (null value caching)
- Cache avalanche protection (random TTL jitter)
- Cache stampede protection (async mutex locks)
- Min-heap based expiry tracking for O(k log n) cleanup
- Approximate size calculation based on JSON serialization
- Bounded table namespace versions make invalidated read keys unreachable without scanning every cache entry; stale values remain subject to normal eviction

### 3.6 Index Layer

#### IndexManager

- Unique, non-unique, and composite field indexes
- Indexes are process-memory accelerators only; a query uses a ready compatible index and otherwise falls back to a full scan
- Stable identifiers prefer `id` and fall back to `_id`; a row with neither disables acceleration for that index until coverage is complete
- Incremental writes stage deltas only for touched buckets, while rebuilds stage a complete replacement map; both validate `UNIQUE` constraints before touching physical storage
- Staged deltas or replacement maps are applied only after storage succeeds, so live queries never observe a partially updated index
- Batch index rebuilding and index-based query optimization

### 3.7 Metadata Layer

#### MetadataManager

- Table schema management
- Lazy loading with debounce saving for low-priority changes
- Serialized recoverable temp/backup publication for immediate metadata flushes; no cross-platform atomic-move guarantee
- A missing metadata primary may be restored from a structurally valid backup. An existing damaged primary never falls back, and publication/recovery completes only after stale-backup removal succeeds
- Manager instances share a FIFO keyed by metadata path with a 30-second acquisition limit; a timed-out waiter cannot bypass the current owner or release a follower
- Each flush rereads the latest disk snapshot. Updates/deletes require the expected `createdAt`, while upserts require the name to remain absent, preserving unrelated changes and preventing stale mutations from touching a same-name replacement; failed mutations remain pending for retry
- A process-wide mutation epoch makes other manager instances refresh their snapshots after a successful publication
- Metadata version field with a reserved migration hook
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

- In-process queued transactions with read-your-writes behavior
- Owner identity captured at `beginTransaction()` prevents another adapter from reading, extending, committing, or rolling back the active transaction
- Commit execution and failed-commit snapshot restoration carry a module-private symbol capability for direct writes; public options cannot forge the bypass
- Snapshot restoration for partially failed commits, including removal of transaction-created tables
- Transaction data caching and computation

#### AutoSyncService

- Periodic dirty data synchronization
- Exponential backoff retry with jitter
- Per-table dirty-cache entry batching without splitting a table overwrite
- Active transactions defer AutoSync storage writes and retain dirty entries for a later scheduled or explicit sync
- Graceful shutdown support

#### CacheService

- Table-level cache invalidation
- Cache key management

### 3.10 Utility Layer

#### PathHelper

- Validates the configured storage-folder name and resolves current and legacy roots
- Migrates the legacy default root only when the current root is absent or effectively empty
- Removes an empty bootstrap root before legacy migration, so correctness does not depend on move-over-existing behavior
- Treats an unreadable or malformed current `meta.ldb` as occupied, so migration cannot overwrite damaged current metadata

#### logger

- Accepts `silent`, `error`, `warn`, `info`, and `debug` through `EXPO_LITE_DATA_STORE_LOG_LEVEL`; non-test runtimes default to `warn`
- Keeps tests silent by default; `EXPO_LITE_DATA_STORE_TEST_LOGS=1` enables diagnostic `debug` output

## 4. Data Flow

### 4.1 Write Flow

1. Client calls the public `insert`, `overwrite`, `update`, `remove`, `clearTable`, or `bulkWrite` API
2. FileSystemStorageAdapter validates input
3. DataWriter validates data and ensures table exists
4. Incremental index bucket deltas or complete rebuild maps are staged and `UNIQUE` constraints are validated without mutating live indexes
5. The write executes in single-file or chunked mode; full-table encryption keeps physical envelope count separate from logical row count
6. The staged index map, logical count, and storage generation are published together; a recoverable single-file generation is rolled back if finalization fails
7. Result is returned

### 4.2 Read Flow

1. Client calls `read`/`findOne`/`findMany`
2. Current metadata and its representation mode are refreshed; cache and index namespaces are invalidated if another adapter advanced the mutation epoch
3. A ready compatible in-memory index is used only when every covered row has a stable `id` or `_id`; otherwise the query falls back to a full scan
4. Data is read from storage
5. `findOne`/`findMany` apply filtering, sorting, and pagination; raw `read` returns the stored rows
6. Metadata is checked again; a changed generation retries the read against the latest representation
7. Result is cached (if not high-risk data) and returned

### 4.3 Transaction Flow

1. Client calls `beginTransaction()` and the transaction captures that adapter's owner identity
2. Operations from the same owner are queued (not executed immediately); a different adapter is rejected
3. AutoSync retains dirty entries without writing while the transaction remains active
4. Client calls `commit()` to execute all operations in order through the module-private direct-write capability
5. A public `rollback()` discards queued operations without writing; a partially failed commit uses the same capability to restore snapshots

Transactions coordinate one adapter instance in memory. They are not a durable write-ahead log and do not claim crash recovery or cross-process ACID isolation.

### 4.4 Table Deletion Flow

1. `deleteTable()` snapshots current metadata and stages its removal under the shared table lock
2. The metadata deletion is flushed; failure restores and reflashes the snapshot before any artifact is removed
3. After a successful metadata commit, in-memory indexes and all table, journal, and overwrite-backup artifacts are removed
4. Cleanup failure returns an error but keeps the table logically absent; metadata absence prevents artifact-based revival, and a later delete or same-name create retries/purges orphan cleanup

## 5. Performance Characteristics

| Operation                       | Characteristic                       | Notes                                                                                                  |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cache hit read                  | Memory lookup                        | LRU/LFU strategy overhead still depends on payload copying and device runtime                          |
| Uncached read                   | Scales with stored payload           | Chunked mode limits individual file size but does not make a full scan constant-time                   |
| Overwrite                       | Scales with resulting table size     | Uses recoverable publication and may rewrite the table; it is not a filesystem-wide atomic transaction |
| Batch write                     | Amortizes setup and persistence work | Prefer it to many independent writes when the business operation allows batching                       |
| Index query                     | O(1) lookup after an O(n) build      | Applies only when a compatible index has stable identifier coverage; otherwise a full scan is used     |
| First encrypted operation       | Dominated by PBKDF2                  | Depends strongly on runtime provider, configured iterations, and device                                |
| Later per-record key derivation | Uses HKDF expansion and key caching  | Does not remove encryption, serialization, or I/O costs                                                |

These are implementation characteristics, not device-independent latency guarantees. Use the maintained runtime QA and performance suites for release evidence on a target environment.

## 6. Security Design

### 6.1 Encryption

- AES-256-GCM (NIST SP 800-38D)
- PBKDF2 key derivation with 600,000 iterations
- HKDF for fast per-record key derivation
- Field-level and full-table encryption modes
- Biometric authentication support (optional)

### 6.2 Data Integrity

- SHA-256 hash verification on read
- Recoverable single-file and metadata publication retain a verified predecessor while related state is finalized; this is not a cross-platform atomic-move guarantee. Metadata restoration is allowed only when the primary is missing, never when it exists but is damaged
- Recoverable single-file mutations retain their lock until commit or rollback, including rollback after a late mutation crosses its deadline
- Append and bounded overwrite-v2 journals resolve interrupted chunked writes. Old overwrite chunks live in a marked backup directory until journal deletion commits the new generation; failed paths clean partial chunks and temporary staging artifacts
- Automatic data corruption detection and fail-closed recovery when no verified backup is available

### 6.3 Key Management

- Secure key storage via expo-secure-store
- In-memory key fallback is limited to tests; runtime key-storage failures fail closed
- Key cache with LRU cleanup
- Master key reset support (logout/reset)

### 6.4 Access-Bound Table Policy

- The supported public surface is the root `db` facade and named exports; `plainStorage` is not exported.
- A table created with `encrypted: true` must be accessed through calls that also pass `encrypted: true`; a plain-surface request fails with `PERMISSION_DENIED` rather than exposing ciphertext or appending plaintext.
- A non-empty `encryptedFields` list implicitly selects the encrypted facade. Transactional writes preserve the resolved field list when commit implicitly creates the table.
- New field-level tables persist `encryptAllFields: true` with `encryptedFields: []` for a dynamic all-fields policy; this exact pair is the only metadata form with that meaning. A non-empty configured list is deduplicated and snapshotted. Earlier v3 metadata without the marker keeps the legacy global-config fallback for an empty or missing list, avoiding attempts to decrypt plaintext fields in mixed records.
- Module-private Symbol options carry the resolved dynamic policy and a full-table logical count through queued writes without expanding public options. `DataWriter` publishes these values with the same storage generation as the physical write. A full-table envelope has physical count 1, while its logical count remains independent; transaction snapshots retain that logical count for one-step rollback.
- The decrypted full-table cache is keyed by table and accepted only when bound to the exact current ciphertext; a zero timeout disables it.
- A table created with `requireAuthOnAccess: true` is bound to a separate strict-authentication key scope. `requireAuthOnAccess: true` implicitly selects the encrypted surface; callers should normally pass both flags explicitly. A weaker access surface fails with `PERMISSION_DENIED`.
- Strict access is not an in-place upgrade for a regular encrypted table. The application must migrate and verify data into a newly created strict table; a silent key substitution is never used.
- `encrypted`, `encryptFullTable`, `encryptedFields`, and `requireAuthOnAccess` are persisted table policy. Existing encrypted tables reject conflicting create/write options with `MIGRATION_FAILED` rather than silently changing protection.
- To avoid revealing strict-table metadata, `listTables()` requires strict options whenever a strict table exists.

## 7. Expo Go Compatibility

| Feature       | Expo Go                          | Standalone APK/IPA           |
| ------------- | -------------------------------- | ---------------------------- |
| File System   | ✅ expo-file-system              | ✅ expo-file-system          |
| Crypto        | ✅ crypto-js/native helpers (JS) | ✅ + native acceleration     |
| Secure Store  | ✅ expo-secure-store             | ✅ expo-secure-store         |
| Constants     | ✅ expo-constants                | ✅ expo-constants            |
| Native Crypto | ❌ (falls back to JS)            | ✅ react-native-quick-crypto |

## 8. Configuration

Configuration is merged from lowest to highest priority:

1. built-in defaults;
2. supported `LITE_STORE_*` environment variables;
3. one Expo runtime configuration source; and
4. `configManager.setConfig()`, `updateConfig()`, or `set()` overrides.

The runtime layer selects the first available source rather than merging every host source: `global.__expoConfig.extra.liteStore`, then `expo-constants` configuration (`getConfig()`, `expoConfig`, `manifest`, or `extra`), then `global.expo.extra.liteStore`, and finally `global.liteStoreConfig` as a fallback. Runtime-source lookup is active in Expo, React Native, and test environments.

Key configuration options:

- `chunkSize`: Target chunk size (default: 5 MiB); initial-data auto-selection begins above half this value
- `encryption.algorithm`: 'auto' | 'AES-GCM' | 'AES-CTR'
- `encryption.keyIterations`: PBKDF2 iterations (default: 600,000)
- `cache.maxSize`: Maximum cache entries
- `performance.maxConcurrentOperations`: Max concurrent operations (default: 5)
- `autoSync.enabled`: Background dirty-cache sync toggle (default: false)

Logger environment controls are independent of the configuration merge: `EXPO_LITE_DATA_STORE_LOG_LEVEL` selects `silent|error|warn|info|debug` (default `warn` outside tests), while tests default to silence unless `EXPO_LITE_DATA_STORE_TEST_LOGS=1` is set.
