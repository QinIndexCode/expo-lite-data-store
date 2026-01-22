# Expo LiteDBStore Architecture Design Document

// Created on: 2025-11-28
// Last Modified: 2026-01-22

## 1. System Overview

Expo Lite Data Store is a lightweight local database solution based on Expo File System, supporting single-file and sharded storage modes, providing complete CRUD operations, transaction support, caching mechanism, indexing functionality, API routing, and data encryption.

## 2. System Architecture

### 2.1 Layered Architecture

Expo Lite Data Store adopts a layered architecture design, mainly divided into the following layers:

| Layer             | Responsibility                                             | Main Components                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| API Layer         | Provides API routing and request handling                  | ApiRouter, ApiWrapper, ErrorHandler, RateLimiter, RestController, ValidationWrapper |
| Interface Layer   | Provides unified API interface externally                  | FileSystemStorageAdapter, EncryptedStorageAdapter, StorageAdapterFactory |
| Data Access Layer | Handles data read/write operations                         | DataReader, DataWriter, QueryEngine                             |
| Cache Layer       | Provides caching mechanism to improve query performance    | CacheManager, CacheController, CacheService, CacheCoordinator   |
| Index Layer       | Provides indexing functionality to accelerate data queries | IndexManager                                                    |
| Encryption Layer  | Provides data encryption and key management                | KeyManager, EncryptedStorageAdapter                             |
| Storage Layer     | Handles physical storage of data                           | FileHandlerFactory, ChunkedFileHandler, SingleFileHandler, FileHandlerBase, FileInfoCache |
| Metadata Layer    | Manages database metadata                                  | MetadataManager                                                 |
| Transaction Layer | Provides transaction support to ensure data consistency    | TransactionService                                              |
| Task Queue Layer  | Asynchronously processes batch operations                  | StorageTaskProcessor, taskQueue                                 |
| Sync Layer        | Automatically syncs dirty data in cache to disk            | AutoSyncService                                                 |
| Monitor Layer     | Monitors system performance and cache status               | CacheMonitor, PerformanceMonitor                                |
| Utility Layer     | Provides common utility functions                          | FileOperationManager, PermissionChecker, StorageStrategy        |

### 2.2 Core Module Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             API Layer                                  │
├─────────────────┬─────────────────┬─────────────────┬───────────────────┤
│    ApiRouter    │   ApiWrapper    │  ErrorHandler   │    RateLimiter    │
└─────────────────┴─────────────────┴─────────────────┴───────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  ValidationWrapper      │  │    RestController      │  │   StorageAdapterFactory │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Interface Layer                                  │
├─────────────────────────────────┬───────────────────────────────────────┤
│  FileSystemStorageAdapter       │    EncryptedStorageAdapter            │
└─────────────────────────────────┴───────────────────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       DataReader        │  │       DataWriter        │  │   TransactionService    │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│      QueryEngine        │  │       KeyManager        │  │     CacheCoordinator    │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           StorageTaskProcessor                         │
└─────────────────────────────────────────────────────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       taskQueue         │  │      IndexManager       │  │    MetadataManager      │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       CacheManager      │  │  FileOperationManager   │  │     CacheService        │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│     CacheMonitor        │  │   FileHandlerFactory    │  │     AutoSyncService     │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                                │                    │
                                ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│  ChunkedFileHandler     │  │   SingleFileHandler     │
└─────────────────────────┘  └─────────────────────────┘
```

## 3. Core Module Design

### 3.1 API Layer Modules

#### 3.1.1 ApiRouter

**Responsibility**: Manages API routes and handles requests for different API versions.

**Main Functions**:

- Support multi-version API management
- Route requests to corresponding handler functions
- Support API version checking
- Provide default API version configuration

#### 3.1.2 ApiWrapper

**Responsibility**: Wraps API calls and handles request/response wrapping.

**Main Functions**:

- Wrap API requests and responses
- Handle API call context
- Support API call logging

#### 3.1.3 RestController

**Responsibility**: Handles RESTful API requests and provides standard RESTful interfaces.

**Main Functions**:

- Provide RESTful API interfaces
- Handle HTTP methods (GET, POST, PUT, DELETE)
- Support request parameter validation

#### 3.1.4 RateLimiter

**Responsibility**: Limits API request rates to prevent malicious requests and overload.

**Main Functions**:

- Support IP-based rate limiting
- Configurable rate limiting rules
- Support multiple rate limiting algorithms

#### 3.1.5 ValidationWrapper

**Responsibility**: Validates API request parameters to ensure data validity.

**Main Functions**:

- Validate request parameter types and formats
- Handle validation errors
- Support custom validation rules

### 3.2 Interface Layer Modules

#### 3.2.1 FileSystemStorageAdapter

**Responsibility**: As the external unified interface, coordinates the work of various modules, and handles data read/write operations.

**Main Functions**:

- Table management (create, delete, list tables)
- Data read/write (insert, update, delete, query)
- Transaction management (begin, commit, rollback transactions)
- Batch operations
- Schema migration

#### 3.2.2 EncryptedStorageAdapter

**Responsibility**: Provides encrypted storage functionality to protect sensitive data.

**Main Functions**:

- Data encryption and decryption
- Key management
- Support for different encryption algorithms
- Integration with existing storage systems

#### 3.2.3 StorageAdapterFactory

**Responsibility**: Creates and manages storage adapter instances.

**Main Functions**:

- Create appropriate storage adapters based on configuration
- Support multiple storage modes
- Manage adapter lifecycle

### 3.3 Data Access Layer Modules

#### 3.3.1 DataReader

**Responsibility**: Handles data read operations, including reading data from single files and sharded files, and applying filtering and pagination.

**Main Functions**:

- Read table data
- Apply filtering conditions
- Apply pagination
- Support index querying
- Support caching

#### 3.3.2 DataWriter

**Responsibility**: Handles data write operations, including insertion, update, deletion, and batch operations.

**Main Functions**:

- Write data to tables
- Support single-file and sharded storage modes
- Automatically create tables (if they don't exist)
- Validate the validity of written data
- Update indexes
- Update metadata

#### 3.3.3 QueryEngine

**Responsibility**: Handles complex query logic, including filtering, sorting, grouping, etc.

**Main Functions**:

- Support complex query conditions
- Implement multiple query operators
- Support sorting and grouping
- Optimize query performance

### 3.4 Encryption Layer Modules

#### 3.4.1 Encryption Utility Module

**Responsibility**: Provides data encryption and decryption functionality, implemented based on @noble/ciphers and @noble/hashes.

**Main Functions**:

- **Encryption Algorithm**: Uses AES-256-CTR + HMAC-SHA512 algorithm (emulating GCM mode)
- **Key Management**: Supports PBKDF2 key derivation with dynamic iteration adjustment
- **Smart Key Cache**: Key cache with LRU cleanup strategy for improved performance
- **Bulk Encryption/Decryption**: Supports batch processing for improved efficiency
- **Field-Level Encryption**: Supports selective field encryption
- **Expo Environment Compatible**: Uses expo-crypto for random number generation
- **Multi-Platform Support**: Compatible with React Native, Expo, and Web environments

#### 3.4.2 KeyManager

**Responsibility**: Manages encryption keys to ensure secure storage and usage.

**Main Functions**:

- Key generation and management
- Key encryption and decryption
- Support for multiple key storage methods (expo-secure-store or memory)
- Key rotation and update
- Biometric authentication support

### 3.5 Storage Layer Modules

#### 3.5.1 FileHandlerFactory

**Responsibility**: Creates and manages file handler instances.

**Main Functions**:

- Create appropriate file handlers based on storage mode
- Support single-file and sharded storage modes
- Manage file handler lifecycle

#### 3.5.2 FileHandlerBase

**Responsibility**: Base class for file handlers, defining common interfaces for file operations.

**Main Functions**:

- Define common methods for file operations
- Provide basic implementation for file operations
- Support file read/write and deletion

#### 3.5.3 FileInfoCache

**Responsibility**: Caches file information to improve file operation performance.

**Main Functions**:

- Cache file metadata
- Reduce file system access times
- Support cache update and invalidation

#### 3.5.4 PermissionChecker

**Responsibility**: Checks file operation permissions to ensure secure access.

**Main Functions**:

- Check file read/write permissions
- Handle permission errors
- Support different platform permission models

### 3.6 Monitor Layer Modules

#### 3.6.1 CacheMonitor

**Responsibility**: Monitors cache status and performance.

**Main Functions**:

- Monitor cache hit rate
- Statistic cache usage
- Support cache event listening
- Provide cache performance reports

#### 3.6.2 PerformanceMonitor

**Responsibility**: Monitors overall system performance.

**Main Functions**:

- Monitor system response time
- Statistic system throughput
- Support performance event listening
- Provide performance reports and analysis

### 3.7 Utility Layer Modules

#### 3.7.1 FileOperationManager

**Responsibility**: Manages file operations and provides a unified interface for file operations.

**Main Functions**:

- Unified file operation interface
- Support file read/write, deletion, and movement
- Handle file operation exceptions
- Provide transaction support for file operations

#### 3.7.2 StorageStrategy

**Responsibility**: Defines storage strategies to determine data storage methods.

**Main Functions**:

- Define storage strategy interfaces
- Support different storage strategy implementations
- Select appropriate storage strategy based on configuration

### 3.8 Cache Layer Modules

#### 3.8.1 CacheCoordinator

**Responsibility**: Coordinates cache usage to ensure cache consistency and performance.

**Main Functions**:

- Manage multiple cache instances
- Coordinate cache read/write operations
- Ensure cache consistency
- Optimize cache usage efficiency

### 3.9 Original Core Modules

#### 3.9.1 CacheManager

**Responsibility**: Manages cache data, implements different caching strategies and protective measures.

**Main Functions**:

- Support LRU/LFU caching strategies
- Implement cache penetration, breakdown, and avalanche protection
- Provide cache statistics
- Support thread-safe cache operations
- Support cache consistency maintenance

#### 3.9.2 CacheController

**Responsibility**: Manages cache consistency, ensuring consistency between cache and stored data.

**Main Functions**:

- Clear cache related to specific tables
- Clear cache for specific queries
- Record cache keys
- Provide cache event system

#### 3.9.3 CacheService

**Responsibility**: Provides unified cache operation interface, encapsulates CacheManager functionality, and manages data cache.

**Main Functions**:

- Set cache
- Get cache
- Delete cache
- Clear cache
- Mark cache items as dirty
- Batch mark cache items as clean
- Get all dirty data
- Record table-related cache keys
- Clear all cache related to specific tables

#### 3.9.4 IndexManager

**Responsibility**: Manages index creation, querying, and updating.

**Main Functions**:

- Create normal and unique indexes
- Delete indexes
- Add indexes for data
- Delete data from indexes
- Update indexes
- Use indexes for data querying

#### 3.9.5 MetadataManager

**Responsibility**: Manages database metadata, including table structure, index information, etc.

**Main Functions**:

- Load and save metadata
- Get single table metadata
- Update table metadata
- Delete table metadata
- Get all table names
- Get table record count

#### 3.9.6 TransactionService

**Responsibility**: Provides transaction support to ensure data consistency.

**Main Functions**:

- Begin transactions
- Commit transactions
- Rollback transactions
- Save data snapshots
- Manage transaction operation queues

#### 3.9.7 StorageTaskProcessor

**Responsibility**: Processes asynchronous tasks, including batch operations, schema migration, etc.

**Main Functions**:

- Process batch write operations
- Process schema migration operations
- Execute tasks asynchronously
- Provide task callbacks

#### 3.9.8 ChunkedFileHandler

**Responsibility**: Handles file operations in sharded storage mode.

**Main Functions**:

- Write data to sharded files
- Read data from sharded files
- Clear sharded files
- Support parallel reading of sharded files

#### 3.9.9 SingleFileHandler

**Responsibility**: Handles file operations in single-file storage mode.

**Main Functions**:

- Write data to single files
- Read data from single files
- Delete single files

#### 3.9.10 AutoSyncService

**Responsibility**: Regularly syncs dirty data in cache to disk, ensuring data persistence.

**Main Functions**:

- Automatically sync dirty data to disk
- Support configuring sync interval and batch size
- Provide retry mechanism to ensure successful data writing
- Support event listening to notify sync status
- Provide sync statistics
- Support manual triggering of sync
- Support stopping and starting sync service

## 4. Data Flow

### 4.1 Data Write Flow

1. Client calls `write` method to write data
2. `FileSystemStorageAdapter` checks if in transaction
   - If in transaction, add operation to transaction queue
   - If not in transaction, directly execute write operation
3. `DataWriter` validates the validity of written data
4. `DataWriter` automatically creates table (if it doesn't exist)
5. `DataWriter` executes write operation according to storage mode
   - Single-file mode: directly write to single file
   - Sharded mode: write to sharded files
6. `DataWriter` updates indexes
7. `DataWriter` updates metadata
8. `DataWriter` clears related cache
9. Return write result

### 4.2 Data Read Flow

1. Client calls `read` method to read data
2. `FileSystemStorageAdapter` calls `DataReader` to read data
3. `DataReader` checks if cache needs to be bypassed
   - If cache doesn't need to be bypassed, try to get data from cache
   - If cache hit, directly return data
4. `DataReader` checks if index can be used
   - If index can be used, use index to query data
   - If index can't be used, read all data and apply filtering conditions
5. `DataReader` applies pagination
6. `DataReader` stores result in cache (if not high-risk data)
7. Return read result

### 4.3 Transaction Processing Flow

1. Client calls `beginTransaction` method to start transaction
2. `TransactionService` starts transaction
3. Client executes a series of data operations (write, delete, etc.)
   - These operations are added to transaction queue instead of being executed immediately
4. Client calls `commit` method to commit transaction
   - `TransactionService` executes all operations in transaction queue
   - If all operations succeed, transaction is committed
   - If any operation fails, transaction is rolled back
5. Or client calls `rollback` method to rollback transaction
   - `TransactionService` restores data snapshots

### 4.4 Auto Sync Flow

1. `AutoSyncService` periodically checks for dirty data in cache
2. When the number of dirty data reaches threshold or specified time interval is reached, trigger sync
3. `AutoSyncService` gets all dirty data
4. Group dirty data by table name
5. Process dirty data according to configured batch size
6. For each batch, perform the following operations:
   - Acquire table write lock
   - Execute batch write operation
   - Update indexes
   - Update metadata
   - Batch mark dirty data as clean
   - Release table write lock
7. Update sync statistics
8. Trigger sync completion event

## 5. Performance Optimization

### 5.1 Caching Mechanism

- Use LRU/LFU caching strategies to improve query performance
- Implement cache penetration, breakdown, and avalanche protection
- Support cache statistics for monitoring cache performance

### 5.2 Index Optimization

- Support normal and unique indexes
- Automatically select appropriate indexes for queries
- Support multi-field indexes

### 5.3 Sharded Storage

- Support sharded storage mode to reduce memory usage
- Implement parallel reading of sharded files to improve reading efficiency
- Support on-demand reading of shards to reduce unnecessary I/O operations

### 5.4 Asynchronous Operations

- Use task queue to asynchronously process batch operations
- Asynchronously execute transaction commit and rollback
- Asynchronously load metadata without blocking startup

## 6. Security Design

### 6.1 Data Encryption

- Support data encryption to protect sensitive data
- High-risk data is directly written to storage without passing through cache

### 6.2 Data Validation

- Validate the validity of written data
- Check the legitimacy of field types and values
- Prevent injection attacks

### 6.3 Transaction Support

- Provide transaction support to ensure data consistency
- Support transaction rollback to prevent data corruption

## 7. Scalability Design

### 7.1 Modular Design

- Adopt modular design for easy extension and maintenance
- Modules communicate through interfaces to reduce coupling
- Support replacement and extension of individual modules

### 7.2 Plugin Mechanism

- Support plugin mechanism for easy function extension
- Support custom storage adapters
- Support custom caching strategies

### 7.3 Configuration Design

- Support configuration design for easy adjustment of system parameters
- Support dynamic configuration updates
- Support configurations for different environments

## 8. Deployment and Maintenance

### 8.1 Deployment

- Support Expo application deployment
- Support React Native application deployment
- Support Web application deployment

### 8.2 Maintenance

- Provide metadata backup and recovery functionality
- Support logging for easy debugging and monitoring
- Provide performance monitoring metrics

## 9. Summary

Expo LiteDBStore is a well-designed local database solution with clear modular design, good performance optimization, and high code maintainability. By adopting layered architecture, caching mechanism, index optimization, sharded storage, and other technologies, it can provide efficient and reliable data storage services for applications of various scales.
