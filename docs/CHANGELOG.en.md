# Changelog

All notable changes to this project will be documented in this file.

[README Entry](../README.md) | [简体中文](./CHANGELOG.zh-CN.md) | [API Reference](./API.en.md)

## [Unreleased]

### Changed

- Removed unused `FileOperationManager`, `FileHandlerFactory`, `FileInfoCache`, `StorageStrategy`, and legacy `ICacheAdapter` modules, and moved storage-permission probing to adapter initialization so hot writes do not repeat filesystem checks.
- Added bounded logger levels through `EXPO_LITE_DATA_STORE_LOG_LEVEL` (`silent|error|warn|info|debug`), with `warn` as the non-test default and silent tests unless `EXPO_LITE_DATA_STORE_TEST_LOGS=1` is set.
- Added `expo/types` to the tracked TypeScript `types` configuration and stopped consuming the ignored local `expo-env.d.ts`, so `process.env` typing is reproducible in a clean checkout.
- Removed the redundant local `publish:safe` and `publish:force` wrappers so package scripts no longer advertise a path that bypasses tag, `main`-ancestry, and provenance checks in the supported release workflow.

### Fixed

- Made transactional `findOne()` and `findMany()` read the staged view, made transactional `remove()` report its staged matched-row count, isolated queued serializable record payloads, object-based query values, and transaction query results from later caller-side mutation, and rejected public `createTable()`, `deleteTable()`, and `migrateToChunked()` calls on the matching active transaction surface with `TRANSACTION_OPERATION_NOT_SUPPORTED`.
- Preserved pagination input-validation failures as caller-visible `RangeError` instances instead of wrapping them as `StorageError`.
- Restored deterministic `id` ascending ordering for encrypted `findMany()` calls that omit `sortBy`.
- Serialized same-path single-file and chunked operations through an in-process FIFO queue shared by handler instances, with a 30-second acquisition limit and cleanup for timed-out waiters.
- Shared FIFO table locks across DataWriter instances, keyed by storage root and table. Timed-out waiters preserve the later queue chain, and operation-slot handoff continues to enforce the configured concurrency limit.
- Serialized metadata flushes across manager instances by metadata path with a 30-second FIFO wait, reread the latest disk snapshot before merging `createdAt`-guarded updates/deletes and expected-absent upserts, advanced a shared mutation epoch for cross-adapter representation/cache/index refresh, and retained failed mutations for retry.
- Restored metadata backups only when the primary is missing, failed closed on an existing damaged primary, and made stale-backup removal a success condition for both publication and recovery.
- Kept recoverable single-file mutations locked through commit or rollback. A mutation that completes after its deadline is observed to settlement and rolled back before the lock is released.
- Bound v2 single-file commit markers to table names and both generations' tokens, hashes, and physical counts; recovery now reads the durable metadata token, preserves canonical v1 compatibility, and accepts temporary evidence only when a v2 committed target matches every field.
- Replaced row-copying chunk overwrite recovery with a bounded v2 journal and marked backup directory, made journal deletion the commit point, and verified committed data before retrying leftover backup cleanup.
- Resolved pending append recovery before overwrite recovery, validated journals and complete chunk sets, and cleaned failed journal and temporary-file artifacts.
- Staged touched-bucket index deltas for incremental writes and complete maps for rebuilds, validated `UNIQUE` constraints before physical writes, preferred `id` then `_id`, and disabled acceleration when stable identifier coverage was incomplete.
- Kept `null` and `undefined` stable and last across every sort algorithm in both directions.
- Made `deleteTable()` commit authoritative metadata absence before artifact cleanup, restore metadata on commit failure, leave post-commit cleanup retryable without reviving the table, and purge orphaned artifacts before same-name creation.
- Made the metadata mode switch the single-to-chunked migration commit point after chunk publication/verification; obsolete single-file cleanup can no longer roll back a committed mode.
- Protected transaction commit/restoration writes with a module-private symbol capability and deferred AutoSync writes while transactions are active without dropping dirty entries.
- Routed non-empty `encryptedFields` through the encrypted facade, persisted the exact dynamic all-fields marker, committed full-table logical counts with physical generations, bound decrypted cache entries to exact ciphertext, carried policy into transactional implicit table creation, bound active transactions to their creating adapter, and rejected conflicting security surfaces or in-place policy changes.
- Made bulk field decryption detect and group mixed legacy CTR/current GCM payloads per item while preserving input order.
- Required query `skip` and `limit` values to be non-negative safe integers, and replaced cache-key scans with bounded namespace versions.
- Treated an unreadable or malformed current `meta.ldb` as occupied during legacy-root discovery, and removed an empty bootstrap root before migration so correctness does not depend on move-over-existing behavior.

## [3.0.0] - 2026-07-18

### Breaking Changes

- Removed the public `plainStorage` export and unsupported package deep imports. Use the root `db` facade or named APIs instead.
- Table operations for data created with `encrypted: true` must explicitly pass `encrypted: true`. Requests that would route an encrypted table through the plain surface now fail closed.
- A transaction is pinned to one security surface. An operation that explicitly switches between encrypted and plain surfaces is rejected and must be run in a separate transaction.

## [2.0.2] - 2026-06-28

### Changed

- Aligned the local React development dependency exactly to `19.2.3`, matching the Expo SDK 56 dependency validation contract used by `expo-doctor`
- Added a push/PR CI workflow that installs deterministically, type-checks, tests, builds, runs the Expo consumer smoke test, and verifies package contents
- Replaced the manually disabled npm workflow with a new tag-only release workflow that validates tag/package version alignment and npm authentication before publishing
- Added a bilingual CI/CD operations runbook covering repository secrets, release sequencing, remote observation, and failure recovery
- Made Expo runtime QA temporary-path generation explicitly use Windows or POSIX path semantics, so platform-simulation tests remain deterministic on GitHub's Linux runners
- Made the clean-checkout gate build `dist/` before package-export and built-artifact tests, and removed the final Windows-only separator assertion from the deterministic suite
- Made the Expo consumer pack parser tolerate npm lifecycle messages that Linux npm can emit before its `--json` payload
- Disabled auto-sync by default so importing or initializing the library does not start background dirty-cache timers unless the host app opts in explicitly

### Fixed

- Restored the Expo consumer smoke test after npm resolved React to a newer patch version that Expo SDK 56 rejected
- Made the GitHub publish workflow match the documented release gate before `npm publish --ignore-scripts --access public --provenance`
- Fixed `where`-based update, delete, bulk, and transaction paths for records that do not carry `id` or `_id` fields
- Added chunked append recovery journals and partial-chunk cleanup so failed appends leave the previous table contents readable
- Made encrypted tables with an empty `encryptedFields` list consistently encrypt and decrypt all record fields
- Flushed table/write metadata immediately and preserved the actual chunk count for chunked `initialData`
- Serialized recoverable metadata publication so overlapping flushes cannot lose later table updates
- Committed chunk append metadata before deleting its recovery journal and rejected incomplete chunk sets on read
- Preserved schema and encryption metadata during chunk migration without decrypting and rewriting encrypted tables
- Removed transaction-created tables after a partially failed commit and made explicit rollback discard queued work without disk rewrites

## [2.0.1] - 2026-06-12

### Changed

- Upgraded the supported Expo install contract to Expo SDK 56
- Aligned Expo runtime peers and local development dependencies with `expo@~56.0.12`, `expo-constants@~56.0.18`, `expo-crypto@~56.0.4`, `expo-file-system@~56.0.8`, `expo-secure-store@~56.0.4`, React 19.2, React Native 0.85, and TypeScript 6.0
- Updated README, runtime QA guidance, package metadata, and source headers to describe the 2.0.1 / SDK 56 release candidate consistently
- Added `package-lock.json` to the release-controlled dependency surface and expanded the publish gate with production and no-high audit checks

### Fixed

- Hardened storage reliability around chunk overwrite recovery, stale chunk-cache invalidation, metadata corruption handling, single-file corruption handling, and transaction rollback snapshots
- Hardened security behavior so invalid table names are rejected at the adapter boundary and production encryption fails closed when secure storage or secure randomness is unavailable
- Made the stress test bounded and reproducible by default while preserving environment-controlled scale-up

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

## [2.0.0-beta.4] - 2026-02-06

### Changed

- Resolved high-severity dependency audit findings
- Unified dependency ranges and cleaned TypeScript/ESLint configuration
- Standardized development runtime logs in English
- Reduced redundant test and setup code

## [2.0.0-beta.3] - 2026-01-28

### Changed

- Reduced PBKDF2 iterations for Expo Go environment
- Added react-native-quick-crypto for native KDF acceleration
- Cached native module loading to avoid repeated require calls
- Removed Buffer dependency from native PBKDF2 path
- Standardized ExpoCrypto.getRandomBytes return type handling
- Hash input now uses TextEncoder encoding

### Added

- Test for Expo Go iteration count reduction behavior

## [2.0.0-beta.2] - 2026-01-22

### 2026-01-22

#### Changed

- Migrated from crypto-es to @noble/ciphers and @noble/hashes
- Simplified package management (single package.json)
- Implemented AES-256-CTR + HMAC-SHA512 encryption
- Optimized PBKDF2 key derivation with dynamic iteration adjustment
- Added smart key cache with LRU cleanup strategy

### 2025-12-24

#### Fixed

- Prototype pollution vulnerability in ConfigManager.ts
- Added key name validation to prevent malicious key modification

#### Added

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

### 2025-12-07

#### Changed

- Improved README.md quality
- Enhanced functionality descriptions
- Removed test coverage directory from commits
- Fixed API implementation errors and performance issues

### 2025-12-06

#### Added

- Wiki documentation
- Improved architecture and system stability

#### Fixed

- Main entry point not correctly calling some features

### 2025-12-03

#### Changed

- Optimized encryption field handling for correct encryption/decryption on read/write

## [0.1.0] - 2025-11-29

### Added

- Updated test files and configuration
- Default export from src/index.ts
- English README link

### Changed

- Adjusted chunkSize to 5MB
- Updated README.md MIT license link

### 2025-11-28

#### Changed

- Refactored core architecture with complete storage engine
- Updated documentation and encrypted storage adapter
- Added API tests
- Removed unused files

### 2025-11-27

#### Changed

- Code modifications for improved performance and stability

### 2025-11-26

#### Added

- Cache adapter interface
- Storage error code interface
- Sorting tools for data sorting
- Merge data and cache utilities

#### Changed

- Fixed encryption decorator, file system adapter, chunked file handler
- Renamed ldb.config.js to liteStore.config.js

### 2025-11-25

#### Added

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

### 2025-11-19

#### Added

- Encrypted storage adapter (AES-CTR mode)

### 2025-11-17

#### Added

- Basic project skeleton
- Encryption support (AES-CTR mode)
- Basic StorageAdapter interface

### 2025-11-15

#### Added

- README.md with project information
- Initial project commit
