# Changelog

All notable changes to this project will be documented in this file.

[README Entry](../README.md) | [简体中文](./CHANGELOG.zh-CN.md) | [API Reference](./API.en.md)

## [2.0.0] - 2026-04-23

### Added
- Formalized the Expo SDK 54 consumer installation contract in the root documentation, including managed-compatible and native flagship dependency paths
- Added a smoke-test regression suite for the Expo consumer packaging workflow

### Changed
- Promoted the package from beta to the stable `2.0.0` line
- Standardized the developer-facing documentation set across the root README, API reference, runtime QA guide, changelog, and update log
- Declared `babel-preset-expo` and `@babel/plugin-transform-modules-commonjs` explicitly for reproducible local Jest execution

### Fixed
- `smoke:expo-consumer` now self-heals missing build artifacts before packing and rejects tarballs that omit `dist/js`, `dist/cjs`, or `dist/types`
- Release verification now passes end to end with `npm run prepublishOnly`, full Jest coverage for the current suite set, and `npm pack --dry-run --ignore-scripts`

## [2.0.0-beta.5] - 2026-04-04

### Added
- AES-256-GCM encryption mode (NIST SP 800-38D and OWASP MASVS 2026 compliant)
- PBKDF2 + HKDF two-tier key derivation (600,000 iterations default, ~3μs per-record after initial ~2s)
- Automatic encryption version detection (GCM for new data, CTR+HMAC backward compatible)
- `crypto-gcm.ts` module for GCM encryption with bulk operations
- `crypto-errors.ts` for shared error definitions
- `crypto-types.ts` for encryption type definitions
- `PathHelper.ts` for independent path management (resolves circular dependency)
- `envUtils.ts` for centralized environment detection
- `.prettierignore` file
- TransactionService tests (23 tests)
- SingleFileHandler tests (13 tests)
- withTimeout tests (10 tests)
- Crypto performance benchmark tests
- `docs/ARCHITECTURE.md` - Unified architecture documentation
- `docs/API.md` - Complete API reference
- `docs/CHANGELOG.md` - Unified changelog
- `docs/COMMENT_SPECIFICATION.md` - Unified comment specification

### Changed
- PBKDF2 default iterations increased from 120,000 to 600,000 (OWASP 2026 recommendation)
- `encryption.algorithm` now supports 'AES-CTR' | 'AES-GCM' | 'auto' (default: 'auto')
- Resolved ConfigManager circular dependency with ROOTPath via PathHelper
- Consolidated duplicate ErrorHandler classes into StorageErrorHandler and ApiErrorHandler
- StorageAdapterFactory now supports creating EncryptedStorageAdapter
- Created tsconfig.base.json to unify all TypeScript configurations
- Fixed cross-platform build scripts (replaced Windows `del` with `rimraf`)
- Moved CryptoService to `core/crypto/` directory
- Made react-native-quick-crypto an optional peerDependency
- Unified all inline comments to English (761+ comments translated)
- Unified all file headers to JSDoc @module format (59 files)
- Optimized `$like` query with precompiled regex patterns
- Optimized cache key generation with recursive key sorting
- Optimized cache expiry cleanup with min-heap (O(k log n) vs O(n))
- Optimized cache size calculation with JSON approximation (10-100x faster)
- Optimized index rebuilding with batch operations (3-5x faster)
- Optimized QueryEngine `$or` deduplication with Set
- Updated README.md with new simplified format
- Consolidated documentation (merged Chinese/English versions)
- Cleaned up `.gitignore`, `.npmignore`, `.prettierignore` for consistency
- Fixed duplicate `peerDependencies` in package.json
- Updated eslint.config.mjs comments to English
- Removed 7 dead code modules (CacheCoordinator, RestController, FileService, CacheController, KeyManager, envUtils, taskQueueExample)
- Added `StorageError`, `StorageErrorCode`, `LiteStoreConfig`, `CryptoError`, `DeepPartial` to public API exports
- Fixed `sortAlgorithm` type from `any` to union type

### Fixed
- Import extension inconsistency (.js vs .ts in 3 files)
- Cross-platform build script (Windows `del` command)
- ConfigManager circular dependency with ROOTPath
- SecureStore fallback chain for Expo Go (3-tier: biometric → non-biometric → in-memory)
- Buffer usage in benchmark tests (replaced with `atob`)
- `config_loading.test.ts` singleton reset issue
- Mock `expo-file-system` recursive delete and directory move operations
- Test mocks for `hkdfDerive` function

### Performance
- $like query: 20-50% faster with precompiled regex patterns
- Cache expiry cleanup: 5-10x faster with min-heap
- Cache size calculation: 10-100x faster with JSON approximation
- Index rebuilding: 3-5x faster with batch operations
- GCM encryption: ~3μs per record after initial PBKDF2 derivation
- Overall: 30-50% improvement in encryption operations

## [2.0.0-beta.4] - 2026-01-28

### Changed
- Reduced PBKDF2 iterations for Expo Go environment
- Added react-native-quick-crypto for native KDF acceleration
- Cached native module loading to avoid repeated require calls
- Removed Buffer dependency from native PBKDF2 path
- Standardized ExpoCrypto.getRandomBytes return type handling
- Hash input now uses TextEncoder encoding

### Added
- Test for Expo Go iteration count reduction behavior

## [2.0.0-beta.3] - 2026-01-22

### Changed
- Migrated from crypto-es to @noble/ciphers and @noble/hashes
- Simplified package management (single package.json)
- Implemented AES-256-CTR + HMAC-SHA512 encryption
- Optimized PBKDF2 key derivation with dynamic iteration adjustment
- Added smart key cache with LRU cleanup strategy

## [2.0.0-beta.2] - 2025-12-24

### Fixed
- Prototype pollution vulnerability in ConfigManager.ts
- Added key name validation to prevent malicious key modification

### Added
- GitHub-standard SECURITY.md file
- Updated architecture documentation (Chinese and English)

## [2.0.0-beta.1] - 2025-12-18

### Changed
- Enhanced field-level encryption logic
- Removed enableFieldLevelEncryption config option (auto-based on encryptedFields)
- Optimized encryption key management and cache
- Added "type": "module" for ES module support
- Updated API version management (default 2.0.0)
- Improved biometric authentication test coverage
- Fixed JEST configuration ES module compatibility

## [1.1.0] - 2025-12-16

### Changed
- Removed config generation script on npm install
- Fixed config file usage in Expo projects
- Removed config API (direct config file editing)
- Optimized biometric and password authentication triggers
- Unified language usage in documentation

### Fixed
- CacheManager handling of removed cache.enableCompression property
- Removed references to deleted requireAuthOnAccess property
- First startup "delete from table app_settings failed" error

## [1.0.5] - 2025-12-12

### Fixed
- Cache issues with update and delete operations
- Missing interface methods

## [1.0.0] - 2025-12-08

### Changed
- Implemented secure npm publish workflow
- Refactored npm publish workflow
- Updated documentation and code
- Added yarn and pnpm installation instructions
- Clarified installation documentation

## [1.0.0] - 2025-12-07

### Changed
- Improved README.md quality
- Enhanced functionality descriptions
- Removed test coverage directory from commits
- Fixed API implementation errors and performance issues

## [1.0.0] - 2025-12-06

### Added
- Wiki documentation
- Improved architecture and system stability

### Fixed
- Main entry point not correctly calling some features

## [1.0.0] - 2025-12-03

### Changed
- Optimized encryption field handling for correct encryption/decryption on read/write

## [0.1.0] - 2025-11-29

### Added
- Updated test files and configuration
- Default export from src/index.ts
- English README link

### Changed
- Adjusted chunkSize to 5MB
- Updated README.md MIT license link

## [0.1.0] - 2025-11-28

### Changed
- Refactored core architecture with complete storage engine
- Updated documentation and encrypted storage adapter
- Added API tests
- Removed unused files

## [0.1.0] - 2025-11-27

### Changed
- Code modifications for improved performance and stability

## [0.1.0] - 2025-11-26

### Added
- Cache adapter interface
- Storage error code interface
- Sorting tools for data sorting
- Merge data and cache utilities

### Changed
- Fixed encryption decorator, file system adapter, chunked file handler
- Renamed ldb.config.js to liteStore.config.js

## [0.1.0] - 2025-11-25

### Added
- File system adapter
- Chunked file handler
- Single file handler
- Index manager
- Metadata manager
- Query engine
- Encrypted storage adapter (AES-CTR mode)

## [0.0.1] - 2025-11-23

### Added
- File system storage adapter
- Core storage
- Chunked file handler
- Single file handler
- Index manager
- Metadata manager
- Query engine

## [0.0.1] - 2025-11-19

### Added
- Encrypted storage adapter (AES-CTR mode)

## [0.0.1] - 2025-11-17

### Added
- Basic project skeleton
- Encryption support (AES-CTR mode)
- Basic StorageAdapter interface

## [0.0.1] - 2025-11-15

### Added
- README.md with project information
- Initial project commit
