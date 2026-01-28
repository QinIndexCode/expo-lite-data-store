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
| Interface Layer   | Provides unified API interface externally                  | FileSystemStorageAdapter, EncryptedStorageAdapter, StorageAdapterFactory |
| Data Access Layer | Handles data read/write operations                         | DataReader, DataWriter, QueryEngine                             |
| Cache Layer       | Provides caching mechanism to improve query performance    | CacheManager                                                    |
| Index Layer       | Provides indexing functionality to accelerate data queries | IndexManager                                                    |
| Encryption Layer  | Provides data encryption and key management                | EncryptedStorageAdapter                                         |
| Storage Layer     | Handles physical storage of data                           | ChunkedFileHandler, SingleFileHandler                           |
| Metadata Layer    | Manages database metadata                                  | MetadataManager                                                 |
| Monitor Layer     | Monitors system performance and cache status               | PerformanceMonitor                                              |
| Utility Layer     | Provides common utility functions                          | FileOperationManager                                            |

### 2.2 Core Module Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Interface Layer                                   │
├─────────────────────────────────┬───────────────────────────────────────┤
│  FileSystemStorageAdapter       │    EncryptedStorageAdapter            │
└─────────────────────────────────┴───────────────────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       DataReader        │  │       DataWriter        │  │   StorageAdapterFactory │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│      QueryEngine        │  │      IndexManager       │  │    MetadataManager      │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│       CacheManager      │  │  FileOperationManager   │  │   PerformanceMonitor    │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Storage Layer                                  │
├─────────────────────────────────┬───────────────────────────────────────┤
│  ChunkedFileHandler             │    SingleFileHandler                  │
└─────────────────────────────────┴───────────────────────────────────────┘
```

## 3. Core Module Design

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

**Responsibility**: Provides data encryption and decryption functionality based on @noble/ciphers / @noble/hashes, and automatically enables react-native-quick-crypto native acceleration in standalone builds.

**Main Functions**:

- **Encryption Algorithm**: Uses AES-256-CTR + HMAC-SHA512 algorithm (emulating GCM mode)
- **Key Management**: Supports PBKDF2 key derivation with dynamic iteration adjustment
- **Smart Key Cache**: Key cache with LRU cleanup strategy for improved performance
- **Bulk Encryption/Decryption**: Supports batch processing for improved efficiency
- **Field-Level Encryption**: Supports selective field encryption
- **Expo Environment Compatible**: Falls back to JavaScript in Expo Go and uses expo-crypto for random number generation
- **Native Acceleration**: Automatically enables react-native-quick-crypto for PBKDF2, random bytes, and hashing in standalone APK/IPA
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

#### 3.8.1 CacheManager

**Responsibility**: Manages cache data, implements different caching strategies and protective measures.

**Main Functions**:

- Support LRU caching strategy
- Provide cache statistics
- Support thread-safe cache operations
- Support cache consistency maintenance

### 3.9 Index Layer Modules

#### 3.9.1 IndexManager

**Responsibility**: Manages index creation, querying, and updating.

**Main Functions**:

- Add indexes for data
- Delete data from indexes
- Update indexes
- Use indexes for data querying

### 3.10 Metadata Layer Modules

#### 3.10.1 MetadataManager

**Responsibility**: Manages database metadata, including table structure, index information, etc.

**Main Functions**:

- Load and save metadata
- Get single table metadata
- Update table metadata
- Delete table metadata
- Get all table names
- Get table record count

### 3.11 Storage Layer Modules

#### 3.11.1 ChunkedFileHandler

**Responsibility**: Handles file operations in sharded storage mode.

**Main Functions**:

- Write data to sharded files
- Read data from sharded files
- Clear sharded files

#### 3.11.2 SingleFileHandler

**Responsibility**: Handles file operations in single-file storage mode.

**Main Functions**:

- Write data to single files
- Read data from single files
- Delete single files

## 4. Data Flow

### 4.1 Data Write Flow

1. Client calls `write`, `insert` or `overwrite` method to write data
2. `FileSystemStorageAdapter` directly executes write operation
3. `DataWriter` validates the validity of written data
4. `DataWriter` automatically creates table (if it doesn't exist)
5. `DataWriter` executes write operation according to storage mode
   - Single-file mode: directly write to single file
   - Sharded mode: write to sharded files
6. `DataWriter` updates indexes
7. `DataWriter` updates metadata
8. Return write result

### 4.2 Data Read Flow

1. Client calls `read`, `findOne` or `findMany` method to read data
2. `FileSystemStorageAdapter` calls `DataReader` to read data
3. `DataReader` checks if cache needs to be bypassed
   - If cache doesn't need to be bypassed, try to get data from cache
   - If cache hit, directly return data
4. `DataReader` checks if index can be used
   - If index can be used, use index to query data
   - If index can't be used, read all data and apply filtering conditions
5. `DataReader` applies sorting and pagination
6. `DataReader` stores result in cache (if not high-risk data)
7. Return read result

### 4.3 Transaction Processing Flow

1. Client calls `beginTransaction` method to start transaction
2. Client executes a series of data operations (write, delete, etc.)
3. Client calls `commit` method to commit transaction
4. Or client calls `rollback` method to rollback transaction

## 5. Performance Optimization

### 5.1 Caching Mechanism

- Use LRU caching strategy to improve query performance
- Support cache statistics for monitoring cache performance

### 5.2 Index Optimization

- Add indexes for data to accelerate queries
- Use indexes for data querying to reduce full table scans

### 5.3 Sharded Storage

- Support sharded storage mode to reduce memory usage
- Automatically handle >5MB files to avoid RN FS limitations

### 5.4 Concurrent Control

- Support maximum concurrent operations limit, adjusted based on device performance
- Implement operation queue to manage concurrent operations

## 6. Security Design

### 6.1 Data Encryption

- Support AES-CTR encryption to protect sensitive data
- High-risk data is directly written to storage without passing through cache
- Use PBKDF2 key derivation with default 120,000 iterations (mobile optimized)
- Support field-level encryption and full-table encryption
- Support optional biometric authentication

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
