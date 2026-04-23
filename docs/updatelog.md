# Update Log

[简体中文](./updatelog.zh-CN.md) | [English Alias](./updatelog.en.md) | [Consumer Guide](../README.md)

### 📅 2026-04-02 `v2.0.0-beta.5` Encryption Upgrade and Architecture Optimization

> Encryption Upgrade: Added AES-256-GCM encryption mode, compliant with NIST SP 800-38D and OWASP MASVS 2026
> Auto Migration: encrypt/decrypt auto-detects data version; new data defaults to GCM, old data remains compatible
> Security Boost: PBKDF2 default iterations increased from 120,000 to 600,000 (OWASP 2026 recommendation)
> Config Extension: encryption.algorithm supports 'AES-CTR' | 'AES-GCM' | 'auto' modes
> Architecture: Resolved ConfigManager circular dependency, created PathHelper for independent path management
> Error Handling: Consolidated duplicate ErrorHandler classes into StorageErrorHandler and ApiErrorHandler
> Adapter Complete: StorageAdapterFactory now supports creating EncryptedStorageAdapter
> Config Unification: Created tsconfig.base.json to unify all TypeScript configurations
> Cross-Platform: Fixed build scripts, replaced Windows-specific commands with rimraf
> Code Organization: Moved CryptoService to core/crypto/, removed empty directories
> New Files: crypto-gcm.ts (GCM encryption), crypto-errors.ts (error definitions), crypto-types.ts (type definitions)
> New Files: PathHelper.ts (path management), envUtils.ts (environment detection)
> New Files: .prettierignore, COMMENT_SPECIFICATION docs (Chinese and English)
> Tests: All 365 tests passing, added GCM encryption tests

### 📅 2026-01-28 `v2.0.0-beta.2`  Expo Go Crypto Performance and Provider Hardening

> Expo Go Performance: Reduced PBKDF2 iterations to speed up development workflows
> Native KDF: Added react-native-quick-crypto for real-device KDF acceleration
> Crypto Provider: Cached native module loading to avoid repeated require
> Crypto Provider: Removed Buffer dependency in native PBKDF2 path for RN compatibility
> Crypto Provider: Normalized ExpoCrypto.getRandomBytes return handling for unstable types
> Crypto Provider: Hash now encodes strings with TextEncoder before noble hashing
> Tests: Added coverage for Expo Go iteration downgrade behavior

### 📅 2026-01-22 `v2.0.0-beta.2`  Encryption Dependency Upgrade and Architecture Optimization

> Encryption Upgrade: Migrated from crypto-es to @noble/ciphers and @noble/hashes for improved security and performance
> Dependency Handling: Simplified package management, using only a single package.json, removed automatic generation scripts
> Documentation Update: Updated architecture design documents, added detailed description of encryption utility module
> Encryption Optimization: Implemented AES-256-CTR + HMAC-SHA512 encryption scheme, emulating GCM mode
> Key Management: Optimized PBKDF2 key derivation with dynamic iteration adjustment
> Performance Improvement: Added smart key cache with LRU cleanup strategy
> Cross-Platform Compatibility: Ensured compatibility with React Native, Expo, and Web environments

### 📅 2025-12-24 `v2.0.0-beta.2`  Security Fixes and Documentation Updates

> Security Fix: Fixed prototype pollution vulnerability in ConfigManager.ts by adding key name validation to prevent malicious key names from modifying Object.prototype
> Documentation Update: Completely updated architecture design documents (Chinese and English versions), adding descriptions for new components like API layer, encryption layer, and monitor layer
> Documentation Update: Redrawn core module relationship diagram to reflect actual code structure
> Security Policy: Created GitHub standard SECURITY.md file, defining vulnerability reporting process and version support
> Testing: All tests passed, ensuring fixes don't break existing functionality

### 📅 2025-12-22 `v2.0.0-beta.2`  Configuration System Simplification and Documentation Improvement

> Documentation Update: Updated README.md, README.en.md, WIKI.md, WIKI_EN.md, simplifying configuration descriptions and encryption recommendations
> Configuration System: Removed code for creating configuration files in the root directory, only supporting app.json configuration and source code default configuration, adapting to Expo Go environment
> Configuration Cleanup: Removed unnecessary configurations like api.version, encryption.requireAuthOnAccess, cache.enableCompression
> Performance Configuration: Enabled performance.maxConcurrentOperations, performance.enableBatchOptimization, performance.memoryWarningThreshold, cache.cleanupInterval configurations
> File Cleanup: Deleted unnecessary ConfigGenerator.ts file
> Fix: Handled removed cache.enableCompression property in CacheManager.ts, returning default value false
> Fix: Removed reference to deleted requireAuthOnAccess property in ConfigManager.test.ts
> Fix: Removed validation for deleted configuration options in ConfigValidator.ts
> Fix: "delete from table app_settings failed" error on first startup
> Package Configuration: Adjusted exports configuration in package-env.json to match simplified npm upload version
> Documentation Optimization: Simplified README content, moved detailed content to WIKI, and added Q&A about encrypted write/read performance optimization

### 📅 2025-12-20 `v2.0.0-beta.2`  Performance Optimization and Documentation Improvement

> Fixed TypeScript errors in crypto-security-assessment.test.ts file
> Fixed test:performance command failure issue
> Optimized CacheService, added batch mark as clean data method
> Optimized AutoSyncService, used new batch mark method to improve batch processing performance
> Corrected Chinese and English versions of architecture documentation, added CacheService and AutoSyncService modules
> Added detailed description of auto-sync flow
> Ensured consistency between architecture documentation and actual code
> Improved efficiency of batch processing dirty data

### 📅 2025-12-18 `v2.0.0-beta.1`  Major Version Update

> Enhanced encryption functionality, improved field-level encryption logic
> Removed enableFieldLevelEncryption configuration option, now automatically enables field-level encryption based on encryptedFields
> Optimized encryption key management and caching mechanism
> Improved documentation consistency and accuracy
> Fixed warnings and errors in the build process
> Added "type": "module" configuration to support ES modules
> Updated API version management, default version changed to 2.0.0
> Enhanced biometric authentication test coverage
> Fixed JEST configuration file ES module compatibility issues
> Optimized test coverage, current coverage reaches 70.89%
> Improved error handling and type definitions
> Enhanced security, ensuring more secure key management

<!-- 2025-12-12 Fixed update, delete, delete issues -->

### 📅 2025-12-16 `v1.1.0`  Configuration System Optimization and Documentation Improvement

> Optimized the configuration system, removed the configuration generation script during npm install
> Fixed the issue where configuration files couldn't be used correctly in Expo projects
> Removed the configuration API, changed to directly editing configuration files
> Optimized the timing of biometric and password authentication triggers, only triggered when actually needed
> Improved Chinese and English documentation, unified language usage specifications
> Corrected exaggerated descriptions in the documentation to ensure content accurately reflects project functionality
> Improved API documentation, providing more detailed usage instructions

### 📅 2025-12-12 `v1.0.5`  Fixed update, delete, delete issues

> Fixed update, delete, delete cache issues and their missing interface issues.

<!-- 2025-12-12 Fixed configuration file generation issues -->

### 📅 2025-12-12 `v1.0.0`  Configuration File Generation Fix

> Fixed issues with the configuration file generation tool in different environments, ensuring it can generate configuration files correctly on all platforms.
> New: Added postinstall script to package.json to automatically generate configuration files.

<!-- 1.0.1 2025-12-10 Fixed compatibility and parameter issues -->

### 📅 2025-12-10 `v1.0.0`  Compatibility and Parameter Fixes

> Fixed issues with getting root path in ROOTPath.ts and encryption algorithm compatibility in crypto.ts.
> Fixed encryption compatibility issues and added configuration generation tool.
> Separated release dependencies and development dependencies to implement secure npm publish.
> Added expo version badge.

<!-- 1.0.0 2025-12-8 Release optimization -->

### 📅 2025-12-08 `v1.0.0`  Release Optimization

> Implemented secure npm publish.
> Refactored npm publish workflow.
> Updated some documentation and code.
> Updated README, added yarn and pnpm installation instructions.
> Clarified yarn and pnpm installation instructions.

<!-- 1.0.0 2025-12-7 Official release version -->

### 📅 2025-12-07 `v1.0.0`  Official Release Version

> Improved README.md, enhanced documentation quality.
> Improved some feature descriptions.
> Deleted test coverage directory, canceled submission of test coverage folder.
> Corrected incorrect implementation of some APIs and fixed some performance issues.

<!-- 1.0.0 2025-12-6 Core functionality improvement -->

### 📅 2025-12-06 `v1.0.0`  Core Functionality Improvement

> Fixed issue where main entry couldn't correctly call some functions.
> Added Wiki documentation to improve project maintainability.
> Enhanced architecture and system stability while maintaining documentation accuracy and completeness.

<!-- 1.0.0 2025-12-3 Encryption functionality optimization -->

### 📅 2025-12-03 `v1.0.0`  Encryption Functionality Optimization

> Optimized encrypted field processing, ensuring correct decryption when reading data and correct encryption when writing data.
> Updated some information and README.md content.

<!-- 0.1.0 2025-11-29 Testing and configuration optimization -->

### 📅 2025-11-29 `v0.1.0`  Testing and Configuration Optimization

> New: Updated test files and configuration, improved test coverage.
> Optimization: Adjusted chunkSize to 5MB to improve large file processing efficiency.
> New: Added default export from src/index.ts to simplify API calls.
> Correction: Updated MIT license link and some content in README.md.
> New: Added English README.md link to improve international support.

<!-- 0.1.0 2025-11-28 Core architecture refactoring -->

### 📅 2025-11-28 `v0.1.0`  Core Architecture Refactoring

> Core: Refactored core architecture, implemented complete storage engine functionality.
> New: Updated documentation and encrypted storage adapter, added API tests.
> Cleanup: Deleted some unused files, optimized project structure.

<!-- 0.1.0 2025-11-27 Code optimization -->

### 📅 2025-11-27 `v0.1.0`  Code Optimization

> Optimization: Modified some code to improve system performance and stability.

<!-- 0.1.0 2025-11-26 Function expansion -->

### 📅 2025-11-26 `v0.1.0`  Function Expansion

> New: Added cache adapter interface, storage error code interface.
> New: Added sorting tools to support data sorting functionality.
> Optimization: Fixed encryption decorator, file system adapter, chunked file handler and other components.
> New: Added merge data and cache tools to improve data processing efficiency.
> Renamed: Renamed ldb.config.js to liteStore.config.js.

<!-- 0.1.0 2025-11-25 Basic CRUD operations -->

### 📅 2025-11-25 `v0.1.0`  Basic CRUD

> Core architecture refactoring: Added file system adapter, chunked file processing, single file processing, index manager, metadata manager, query engine and other core components.
> Improved basic CRUD operations: Create table, insert, query, update, delete functions are stable and available.
> Added encrypted storage adapter, supporting AES-CTR mode encryption.

<!-- 0.0.1 2025-11-23 Core component refactoring -->

### 📅 2025-11-23 `v0.0.1`  Core Component Refactoring

> Core: Refactored core components, added file system storage adapter, core storage, chunked file processing, single file processing, index manager, metadata manager, query engine and other components.
> Optimization: Modified entry file and configuration file to improve system availability.
> Cleanup: Deleted some unused files, optimized project structure.

<!-- 0.0.1 2025-11-19 Function expansion -->

### 📅 2025-11-19 `v0.0.1`  Function Expansion

> New: Added encrypted storage adapter, supporting AES-CTR mode encryption.
> Optimization: Simplified README content to improve documentation readability.

<!-- 0.0.1 2025-11-17 Initial version -->

### 📅 2025-11-17 `v0.0.1`  Initial Version

> Built basic project skeleton, implemented data interaction prototype.
> Added encryption functionality, supporting AES-CTR mode encryption, implemented basic StorageAdapter interface.

<!-- 2025-11-15 Project initialization -->

### 📅 2025-11-15  Project Initialization

> Created README.md, introducing basic project information.
> Made initial project submission, built basic framework.
