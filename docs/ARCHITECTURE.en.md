# Expo LiteDBStore Architecture Design Document

## 1. System Overview

Expo LiteDBStore is a lightweight local database solution based on Expo File System, supporting single-file and sharded storage modes, providing complete CRUD operations, transaction support, caching mechanism, and indexing functionality.

## 2. System Architecture

### 2.1 Layered Architecture

Expo LiteDBStore adopts a layered architecture design, mainly divided into the following layers:

| Layer             | Responsibility                                             | Main Components                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Interface Layer   | Provides unified API interface externally                  | FileSystemStorageAdapter                                        |
| Data Access Layer | Handles data read/write operations                         | DataReader, DataWriter                                          |
| Cache Layer       | Provides caching mechanism to improve query performance    | CacheManager, CacheController, CacheService                     |
| Index Layer       | Provides indexing functionality to accelerate data queries | IndexManager                                                    |
| Storage Layer     | Handles physical storage of data                           | FileSystemStorageAdapter, ChunkedFileHandler, SingleFileHandler |
| Metadata Layer    | Manages database metadata                                  | MetadataManager                                                 |
| Transaction Layer | Provides transaction support to ensure data consistency    | TransactionService                                              |
| Task Queue Layer  | Asynchronously processes batch operations                  | StorageTaskProcessor, taskQueue                                 |
| Sync Layer        | Automatically syncs dirty data in cache to disk            | AutoSyncService                                                 |

### 2.2 Core Module Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FileSystemStorageAdapter                     │
└─────────────────────────────────────────────────────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       DataReader        │  │       DataWriter        │  │   TransactionService    │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           StorageTaskProcessor                         │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             taskQueue                                  │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       CacheManager      │  │       IndexManager      │  │    MetadataManager      │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       CacheService      │  │    FileOperationManager │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│     AutoSyncService     │  │   ChunkedFileHandler    │  │   SingleFileHandler     │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

## 3. Core Module Design

### 3.1 FileSystemStorageAdapter

**Responsibility**: As the external unified interface, coordinates the work of various modules, and handles data read/write operations.

**Main Functions**:

- Table management (create, delete, list tables)
- Data read/write (insert, update, delete, query)
- Transaction management (begin, commit, rollback transactions)
- Batch operations
- Schema migration

### 3.2 DataReader

**Responsibility**: Handles data read operations, including reading data from single files and sharded files, and applying filtering and pagination.

**Main Functions**:

- Read table data
- Apply filtering conditions
- Apply pagination
- Support index querying
- Support caching

### 3.3 DataWriter

**Responsibility**: Handles data write operations, including insertion, update, deletion, and batch operations.

**Main Functions**:

- Write data to tables
- Support single-file and sharded storage modes
- Automatically create tables (if they don't exist)
- Validate the validity of written data
- Update indexes
- Update metadata

### 3.4 CacheManager

**Responsibility**: Manages cache data, implements different caching strategies and protective measures.

**Main Functions**:

- Support LRU/LFU caching strategies
- Implement cache penetration, breakdown, and avalanche protection
- Provide cache statistics
- Support thread-safe cache operations
- Support cache consistency maintenance

### 3.5 CacheController

**Responsibility**: Manages cache consistency, ensuring consistency between cache and stored data.

**Main Functions**:

- Clear cache related to specific tables
- Clear cache for specific queries
- Record cache keys
- Provide cache event system

### 3.6 CacheService

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

### 3.7 IndexManager

**Responsibility**: Manages index creation, querying, and updating.

**Main Functions**:

- Create normal and unique indexes
- Delete indexes
- Add indexes for data
- Delete data from indexes
- Update indexes
- Use indexes for data querying

### 3.8 MetadataManager

**Responsibility**: Manages database metadata, including table structure, index information, etc.

**Main Functions**:

- Load and save metadata
- Get single table metadata
- Update table metadata
- Delete table metadata
- Get all table names
- Get table record count

### 3.9 TransactionService

**Responsibility**: Provides transaction support to ensure data consistency.

**Main Functions**:

- Begin transactions
- Commit transactions
- Rollback transactions
- Save data snapshots
- Manage transaction operation queues

### 3.10 StorageTaskProcessor

**Responsibility**: Processes asynchronous tasks, including batch operations, schema migration, etc.

**Main Functions**:

- Process batch write operations
- Process schema migration operations
- Execute tasks asynchronously
- Provide task callbacks

### 3.11 ChunkedFileHandler

**Responsibility**: Handles file operations in sharded storage mode.

**Main Functions**:

- Write data to sharded files
- Read data from sharded files
- Clear sharded files
- Support parallel reading of sharded files

### 3.12 SingleFileHandler

**Responsibility**: Handles file operations in single-file storage mode.

**Main Functions**:

- Write data to single files
- Read data from single files
- Delete single files

### 3.13 AutoSyncService

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
