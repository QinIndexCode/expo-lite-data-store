# Changelog

All notable changes to this project will be documented in this file.

[README Entry](../README.md) | [简体中文](./CHANGELOG.zh-CN.md) | [API Reference](./API.en.md)

## [Unreleased]

### Added

- **Full index lifecycle on the file-system engine**: `createTable({ indexes })` now actually creates and builds the declared indexes (previously the option was accepted and silently ignored), `createIndex` builds the index over existing rows immediately while holding the table write lock so unique constraints and query acceleration take effect from the next operation, and persisted index declarations are re-registered and rebuilt during adapter initialization — before any public API call — so unique enforcement and index-backed reads survive restarts. Declarations are validated (`TABLE_INDEX_INVALID` for an empty field name), and a failed table creation with declared indexes leaves no partial table behind.
- **`import/no-cycle` circular-dependency gate**: added `eslint-plugin-import` and enabled `import/no-cycle: error` in the flat ESLint config (this one rule only, not the plugin's wider rule set), together with `.ts`/`.tsx` entries for `import/resolver` and `import/extensions` so the rule can resolve and walk TypeScript modules (the defaults only accept `.js`/`.mjs`/`.cjs`, which leaves the rule silently inert for TS). The two existing value-import cycles — the reverse references to `FileSystemStorageAdapter` from `AutoSyncService` and `StorageTaskProcessor` — were broken with `import type`; both are pure type references, so runtime semantics are unchanged.
- **Export-surface lock test and API type backfill**: added `src/__tests__/unit/export-surface.test.ts`, which asserts explicit key lists against `Object.keys(...).sort()` to positively lock the three public export surfaces — 41 named runtime exports plus `default` on the main entrypoint (42 enumerable keys), the 23 keys of the `db` facade, and the 30 keys of the default export object — while also locking the subpath key set of `package.json` `exports` (`.`, `./js`, `./cjs`, `./utils/*`) and the `export *` re-export surface of `src/index.ts`, so any accidental export addition or removal turns the suite red (an intentional change must update these lists and the CHANGELOG); the export-group tables of the API reference (zh/en) now record the six type-only types that were previously missing: `Catalog`, `ColumnDefinition`, `SortAlgorithm`, `SortField`, `SortOrder`, `TableMeta`.

### Fixed

- **Dual-branch SQLite pushdown for numeric-key field paths (read/delete/update/sort)**: with exactly one all-numeric segment in the field path (such as `a.0.c`, the numeric segment having no leading zero), the `sqlite` pushdown previously generated WHERE and ORDER BY only in the array bracket form (`$.a[0].c`), silently skipping "object numeric key" records (`{a: {'0': ...}}`) — hit sets and sort order diverged across engines, worst of all through missed deletes/updates. `SqlQueryBuilder` now derives both path variants (dot `$.a.0.c` and bracket `$.a[0].c`): the WHERE wraps each whole predicate in a per-path guarded OR, where the guard (whether the bracket path resolves) keeps `$ne`/`$nin`/missing-path semantics from leaking through the losing branch; bindings merge per branch and, after doubling, are still held by the global 500-bound-parameter cap (over-cap conditions fall back to in-memory filtering). `ORDER BY` uses `COALESCE(bracket, dot)` to take the first resolving branch, with `NULLS LAST` and the trailing `id ASC` tie-break unchanged. A path with two or more all-numeric segments (such as `a.0.1` or `a.0.b.1`) makes both forms miss at once when containers are mixed (array then object key, or object then array), so the dual branch cannot align either — such fields are refused for pushdown as a whole and fall back to in-memory filtering (both WHERE and sorting): results still match the in-memory engine exactly, only the pushdown speed-up is lost. A path with a leading-zero numeric segment (such as `a.01`) falls back to in-memory filtering as well: `getJsonPath` rewrites `.01` into the bracket index `[01]`, SQLite evaluates array index 1 while memory reads the literal key `'01'` — different semantics that diverged on reads and deletes before the fallback, after which both engines agree. The pushdown verdict for single-numeric-segment fields without a leading zero is unchanged (only pre-existing vetoes such as `isSafeField` disable it), index DDL stays in the array bracket form (object numeric-key records do not use the index — performance only, results unaffected), and the `SQLiteStorageAdapter` pushdown consumption side plus the `customSortAlgorithm` path are untouched. The `engine-parity` suite gains array/object-numeric-key dual datasets (k = 1) plus multi-numeric-segment fallback cases (k >= 2 review counterexamples including the delete form) covering eq, ne (with missing/null interactions), range, `$in`/`$nin`, delete and update hit counts, and sort-order parity including desc and nulls, plus an assertion proving the object numeric-key record really is read by the `sqlite` engine.
- **Consistent string ordering between the `file-system` and `sqlite` engines**: string comparison moved from the locale-sensitive `localeCompare` to deterministic Unicode code point order, aligned with SQLite's `BINARY` collation (UTF-8 byte order ≡ code point order) — mixed case, CJK/full-width, private-use and astral-plane characters (such as `😀` U+1F600 and U+E000) now return exactly the same sequence on both engines under all five `sortAlgorithm` values, independent of the locale or runtime; `QueryEngine.max`/`min` string comparison follows the same rule. Each of the five sorting implementations in `sortingTools` and `QueryEngine` keeps a module-private code point comparator, so the public export surface is unchanged.
- **`timeout` config now applies to file-system engine I/O paths**: operations such as single-file/chunked I/O and `DataWriter.deleteTableArtifact` (table artifact deletion) now read the `timeout` config on every call (these paths were previously hardcoded to 10000ms, so `setConfig({ timeout })` had no effect on them); the 30s read guards and file-lock waits remain fixed by design and do not follow this setting.
- **Per-table write serialization (file-system engine)**: every physical write path (`write`, `overwrite`, `delete`, `bulkWrite`, `update`, and transaction commit/rollback writes) now runs under a per-table FIFO write lock. Concurrent read-modify-write operations queue instead of interleaving, so an insert or delete arriving mid-update can no longer be silently erased by the update's replace step. A module-private marker keeps lock-holding internal callers from deadlocking against themselves.
- **SQLite writes no longer interleave with open transactions**: external writes and DDL arriving while a SQL transaction is open now queue behind that transaction instead of running between its statements. Previously a concurrent insert could execute mid-transaction and be overwritten by the transaction's replace, or fail with "cannot start a transaction within a transaction". Replay-nested operations during commit/rollback still run inline through an unforgeable internal marker.
- **SQLite read-modify-replace consistency**: the fallback paths of `update`, `delete`, and mixed `bulkWrite` now read inside the same SQL transaction as their write, so the read snapshot and the replace are atomic with respect to other queued operations.
- **Reserved encrypted envelope field names**: records carrying `__enc` or `__enc_bulk` are rejected with `FILE_CONTENT_INVALID` at every public write entry (`insert`, `overwrite`, `update`, `bulkWrite`, and `createTable`'s `initialData`) before touching storage; previously such a record would be mistaken for a full-table envelope and permanently break reads of the table.
- **Engine migration destination guard**: `migrateEngine` now fails a destination table that already holds rows with the new `MIGRATION_DEST_NOT_EMPTY` error code instead of silently overwriting it; pass `overwriteExisting: true` to replace destination data deliberately. Destination occupancy is measured by physical rows through the new optional `getPhysicalRecordCount()` adapter method, because shared metadata makes `hasTable` unreliable across engines.
- **Persisted engine preference**: after a successful engine migration the chosen engine persists across app launches; an explicit runtime `engine` option in `init()` or `configManager` still overrides the persisted marker.
- **Transaction facade guards across adapter instances**: the SQLite engine creates separate plain/encrypted adapter instances, each with its own transaction service. `beginTransaction()` now enforces single-transaction semantics at the facade level, and transaction-security state is cleared against the adapter that actually opened the transaction instead of the default instance.
- **Mongo-aligned `$pull` semantics**: an array element is removed only when it matches ALL listed key/value pairs, and object values compare by deep equality instead of reference identity.
- **Deep document equality in queries**: `$eq`, `$ne`, and plain object-valued conditions now compare by deep equality. An empty object condition matches only empty stored objects (it previously matched every record), and array comparison no longer depends on key order.
- **AutoSync interval default**: the `AutoSyncService` fallback interval now matches the documented `30000` ms default instead of falling back to `5000` ms.
- **Legacy payload decryption diagnostics**: decrypting a legacy payload without an embedded PBKDF2 `iterations` field now logs a one-time warning that the current `encryption.keyIterations` config is used, making config-drift decryption failures diagnosable (CTR and GCM, single and bulk paths). An encrypted table without persisted `encryptedFields` metadata likewise warns once per table when falling back to the global config.
- **SQLite `migrateToChunked` transaction guard**: on the SQLite engine `migrateToChunked` is a no-op for the storage layout, but it now follows the public schema-change contract — it resolves immediately outside a transaction and is rejected with `TRANSACTION_OPERATION_NOT_SUPPORTED` while one is active, matching the file-system engine.
- **Existing-table safety for `createTable({ indexes })` (file-system engine)**: index declarations now run only when the call actually creates the table (matching SQLite). Previously a failing or duplicate declaration on an existing table triggered the new-table rollback and deleted the rows the table already held.
- **Durable index declarations (file-system engine)**: `createIndex`/`dropIndex` now flush the declaration metadata with `saveImmediately` instead of leaving it inside the 200 ms debounce window, so a unique constraint cannot silently vanish — or a dropped index resurrect — across a crash, matching the SQLite engine.
- **Index build reads bypass the read cache**: startup rebuilds and `createIndex` builds read the on-disk snapshot with `bypassCache`, so they can no longer build from a stale cached clone or leave a full-table copy behind in the cache.
- **Startup index-rebuild warnings no longer leak stored values**: the warnings log only the error code and message; a `StorageError`'s `details` (which can embed the violating value of a unique index) is no longer passed through to the console.
- **Write paths now honor `encryptedFields`**: a write carrying `encryptedFields` without `encrypted: true` selects the encrypted surface, persists the requested field list on implicit table creation, and fails with `MIGRATION_FAILED` against an existing table whose policy differs (no more silent plaintext writes).
- **The SQLite engine no longer silently ignores cross-cutting config**: initializing under the `sqlite` engine now logs a one-time warning prefixed `[SQLiteStorageAdapter]` when `autoSync.enabled` or `monitoring.enablePerformanceTracking` is enabled, noting that `autoSync` is a `file-system`-only capability and `monitoring.enablePerformanceTracking` records storage-side samples only through the `file-system` engine (encrypt/decrypt timing samples record on both engines) — switch to `engine: 'file-system'` or remove them. The default configuration stays silent; `cache.*` and the default-on `monitoring.enableHealthChecks` are never warned about and are documented only.
- **The same query now returns consistent results on both storage engines (`sqlite` pushdown aligned with `QueryEngine`)**: `$in`/`$nin` on array fields now match both array elements and scalar field values (composite conditions expand through `json_each`, with parameters kept as a bound placeholder array); `json_type` distinguishes a missing field from JSON `null`, booleans from numbers (`active: 1` and `$in: [1]` no longer match `true`), `$ne` matches records whose field is missing while direct `null` equality does not, and `null`/`undefined` members inside `$in`/`$nin` follow the reference semantics; `$nin`/`$in` gained a 500-bound-parameter cap per query (longer lists fall back to in-memory filtering with a warning; the array branch and the scalar branch each bind their own copy of the values); `$like` is no longer pushed down — SQLite lacks Unicode case folding — and always runs through the same in-memory filtering the `file-system` engine uses; non-whitelisted operators (`$exists`/`$regex`/`$elemMatch`/`$size`/`$notLike`) and operands without an SQL-equivalent form (objects, BigInt) keep falling back to memory. A new `engine-parity` integration suite seeds one dataset into both engines and asserts identical read, delete, and update result sets.
- **`performanceMonitor` runtime toggle wired up**: `configManager.set('monitoring.enablePerformanceTracking', ...)` now takes effect immediately at runtime — `ConfigManager` notifies subscribers after a configuration commit, and `performanceMonitor` refreshes `enabled` and `metricsRetention` in place (previously the value was read once at construction, so any later `set` had no effect); the callback refreshes only configuration-derived fields and never overwrites explicit settings — `configure()` / `setEnabled()` (including `enabled` and `metricsRetention`) win over configuration changes, `sampleRate`, `maxRecords`, and thresholds are likewise never touched by configuration, and `resetRuntimeOptions()` drops the explicit overrides to restore configuration authority.
- **SQLite engine initialization can now be retried after a failure**: when opening the database or any schema DDL step (`PRAGMA` / `CREATE TABLE` / `CREATE INDEX`) fails, the SQLite engine no longer stays permanently half-initialized — the next call runs initialization again and creates the missing `__elds_records` table, so subsequent reads and writes work again (previously a single failure meant every later operation failed with "no such table" and the cross-cutting configuration warning never fired); the abandoned database handle is closed instead of leaking one per retry.

### Removed

- The dead `intermediates` option was dropped from `CreateTableOptions`; it was documented but never consumed by any code path.
- The `precomputeCommonKeys()` export was removed from the `expo-lite-data-store/utils/crypto` subpath: it derived keys from random salts (so nothing was actually reused) and had no callers.
- Deleted dead code verified to have zero production references: the whole internal `src/core/api/` cluster (`ApiWrapper`, `RateLimiter`, `RateLimitWrapper`, `ValidationWrapper`, `ApiErrorHandler`, `ApiRouter`), `src/types/apiResponse.ts`, the `src/core/monitor/index.ts` barrel and the `expo-lite-data-store/utils/configValidator` subpath (`ConfigValidator`/`ConfigValidationResult`/`configValidationResult`/`fixedConfig`), together with their test files; and dropped zero-caller exports from otherwise live modules — `hashPassword()`/`verifyPassword()`/`generateSalt()` from `expo-lite-data-store/utils/crypto` (along with the `import bcrypt from 'bcryptjs'` that existed only for them), `isSpecialOperator()` from `expo-lite-data-store/utils/specialOperators`, `getExpoPeerInstallHint()` from `expo-lite-data-store/utils/expoModuleLoader`, and the `FILE_OPERATION.OPERATION_TIMEOUT` constant key. Mentions of these symbols in historical CHANGELOG/updatelog entries are release records and are kept as-is.

### Documentation

- AutoSync claims made honest across README/API/ARCHITECTURE (zh/en): the sync timer belongs to the `file-system` engine only, fires only while the app is running, and there is no public "explicit sync" API; `$eq`/`$pull` semantics documented precisely.
- Documented `FILE_CONTENT_INVALID` and `MIGRATION_DEST_NOT_EMPTY` in the common error-code table, the `migrateEngine` destination guard and engine-persistence behavior, and the per-table write serialization guarantee in README.
- Index chapters rewritten to match the implemented lifecycle: declaration validation and rollback, immediate build over existing rows, and startup rebuild of persisted declarations (API/README/ARCHITECTURE, zh/en); `migrateToChunked` now documents the SQLite no-op behavior.
- Added the `engine` (`'file-system' | 'sqlite' | 'auto'`) row to the README config tables, the `TABLE_INDEX_*` codes to the error-code table, and type-only `IStorageAdapter`/`IStorageEngine` to the export tables; removed the dead `intermediates` option from the API reference.
- ARCHITECTURE (zh/en): removed the non-existent `ApiRouter`/`ApiWrapper` components and the "API routing" claim, weakened the overstated "ACID transaction isolation" wording for the SQLite engine, and added the missing `requireAuthOnAccess` implicit encrypted-surface sentence in Chinese.
- Synced the Chinese ARCHITECTURE with the weakened SQLite ACID wording, and corrected statement serialization in both languages: the FIFO chain is per adapter instance, not process-wide.
- Removed the Chinese README claim that autoSync never runs while a page is hidden — no visibility listener exists; only process suspension is guaranteed, matching the English README.
- API error table: scoped `TABLE_INDEX_NOT_UNIQUE` and `TABLE_INDEX_ALREADY_EXISTS` to the FileSystem engine (SQLite surfaces native constraint errors, and re-declaring the same field expression is idempotent); documented that `createTable` ignores index declarations on an existing table, and added the caveat that `unique` constraints must not be declared on encrypted fields because each encryption yields different ciphertext.

## [3.1.1] - 2026-09-19

### Added

- **SQLite High-Performance Storage Engine Upgrade**: Upgraded SQLite from an experimental adapter to an officially supported high-performance engine while maintaining 100% public API compatibility. Can be enabled globally via `init({ engine: 'sqlite' })` or `configure({ engine: 'sqlite' })`.
- **SQL Query and Pagination Pushdown**: Added `SqlQueryBuilder` to convert NoSQL conditions (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or`) directly to SQLite JSON1 `json_extract(payload, '$.field')` expressions. Sorting (`ORDER BY ... NULLS LAST`) and pagination (`LIMIT ? OFFSET ?`) are pushed down to SQLite execution, eliminating full-table loads and in-memory deserialization bottlenecks.
- **Native JSON Expression Indexes**: Added support for field indexing in `createTable` (via `indexes`) as well as new `createIndex` and `dropIndex` APIs. Automatically manages `CREATE [UNIQUE] INDEX IF NOT EXISTS idx_<clean_table>_<clean_field> ON __elds_records (table_name, json_extract(payload, '$.<field>'))`, enabling B-tree binary acceleration for JSON field queries and intercepting unique index violations at the engine level.
- **On-Demand Page Decryption**: For field-level encrypted tables, when query filters and sort criteria only touch unencrypted fields, queries and pagination push down fully to SQLite. The decryption layer only invokes `decryptFieldsBulk` on the paginated slice (e.g. 20 items), dramatically lowering CPU overhead and memory footprint.
- **Bidirectional Engine Online Migration (`migrateEngine`)**: Seamless, zero-data-loss bidirectional full-database migration between `'file-system'` and `'sqlite'`. Replicates schema definitions, records, and expression indexes with strict row count verification before switching the active engine configuration. Supports `cleanSource: true` to purge source data.
- **Public Index Management APIs**: Exported `createIndex(tableName, field, options?)` and `dropIndex(tableName, field, options?)` from package root and `db`.

### Fixed & Security Hardening

- **Sensitive Information Redaction**: Refactored `CryptoError` to preserve the original error in `cause` while outputting only `error.name` in `message`, preventing sensitive plaintext data and stack fragments from leaking into error logs.
- **DDL Index Prefix Isolation**: Applied wildcard escaping (`idx_${escaped}__%`) to index drops in `deleteTable`, avoiding accidental index drops on tables sharing similar name prefixes (e.g. `users` and `users_backup`).
- **Cross-Engine Table Access Policy Penetration**: Resolved inspector lookup in `assertTableAccessPolicy` and `listTables`, ensuring encrypted tables in the SQLite engine fully enforce security checks and isolation policies.
- **Encrypted Deep-Field Query Routing**: Implemented bidirectional ancestor and descendant field checking in `EncryptedStorageAdapter`, preventing encrypted nested fields from being mistakenly pushed down to SQL.
- **Task Queue Synchronization Safety**: Hardened `SQLiteStorageAdapter.enqueue` to consistently return a Promise when `sqlTxDepth > 0`, eliminating unhandled synchronous exceptions.
- **Optional Dependency & Dynamic Loading**: `expo-sqlite` is marked as an optional peer dependency and loaded dynamically. The default engine remains `'file-system'`, allowing applications without `expo-sqlite` to bundle and run seamlessly.

## [3.1.0] - 2026-09-06

### Fixed

- Converged `TransactionError` onto `StorageError`: transaction lifecycle failures now carry `category: 'transaction'` and are catchable with `instanceof StorageError`; added the missing `SNAPSHOT_FAILED` error code.
- Fixed `PerformanceMonitor` treating an unset `enablePerformanceTracking` as enabled; tracking now stays off unless explicitly enabled, matching the documented default.
- Aligned the SQLite engine's missing-table behavior with the file-system engine inside transactions (staged empty view with implicit creation on commit, preserving `encryptedFields`/`columns` and the commit-time direct-write capability); the public `read()` `TABLE_NOT_FOUND` contract is unchanged.
- Made `DataWriter.verifyCount()` skip count correction for full-table encrypted tables so the physical envelope count can no longer overwrite the logical count.
- Widened `bulkWrite()` options to `WriteOptions` (`encryptFullTable` is honored for routing and implicit creation) and forwarded file-system `bulkWrite()` options into implicit table creation.
- Fixed `fast`/`slow` sorts comparing numbers, bigints, and dates lexicographically; non-string pairs now use the shared value-aware comparator.
- Categorized `LOCK_TIMEOUT` as a timeout instead of unknown.
- Made `RateLimitWrapper` fall back to the global `api.rateLimit` config when constructor options omit fields, and documented `api.retry` as reserved (validated but not consumed; `ApiWrapper` performs no automatic retries).
- Made the Expo consumer smoke test tolerate expo-doctor's known Hermes V1 advisory for the pinned Expo SDK 56 consumer (warn and continue when it is the only failing check); every other doctor failure still fails the run.

### Changed

- Clarified that the v3 deep-import ban covers literal `dist/...` paths only and documented the supported `./js`, `./cjs`, and `./utils/*` exports subpaths.
- Corrected the `CryptoService` description to the three provider primitives it re-exports (`deriveKey`, `randomBytes`, `hash`).
- Documented the `SNAPSHOT_FAILED` and `TRANSACTION_ROLLBACK_FAILED` codes, the `fast`/`slow` magnitude ordering, and the `WriteOptions` accepted by `bulkWrite()`.

## [3.0.1] - 2026-08-10

### Added

- Experimental SQLite-backed storage engine infrastructure: `IStorageEngine` engine contract, `SQLiteStorageAdapter` (logical tables share one physical `__elds_records` table keyed by `table_name` plus auto-increment id, payload stored as JSON), and `SQLITE` / `SQLITE_ENCRYPTED` support in `StorageAdapterFactory`. Not yet exported from the package root; the FileSystem engine remains the default. Application-level `TransactionService` transactions map onto real SQLite BEGIN/COMMIT, and all statements are serialized through an in-process FIFO chain.

### Changed

- Raised the in-library table read guard from 10 seconds to 30 seconds (DataReader, DataWriter) so large chunked documents (up to 50MB) stay queryable on slower runtimes such as Expo Go with the JavaScript fallback provider.
- Calibrated the Expo Go QA performance thresholds to measured baselines from a real MuMu + Expo Go 56 runtime run (25MB scenario ≈ 45s, 50MB ≈ 90s, plain-5000 bulk ≥ 20000 ops/s) and narrowed the business large-document QA case to 25MB so it stays inside the in-library read guard; the 50MB matrix sample now asserts counts from the write result instead of a full-table read.

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
- PBKDF2 + HKDF two-tier key derivation (600,000 iterations default; derivation is a one-time cost whose duration depends on device and runtime, cached afterwards for reuse)
- Automatic encryption version detection (GCM for new data, CTR+HMAC backward compatible)
- `crypto-gcm.ts` module for GCM encryption with bulk operations
- `crypto-errors.ts` for shared error definitions
- `crypto-types.ts` for encryption type definitions
- `PathHelper.ts` for independent path management (resolves circular dependency)
- `envUtils.ts` for centralized environment detection (removed again in the same release's dead-code cleanup below)
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
- Optimized cache size calculation with JSON approximation (measurable gain in benchmarks; magnitude depends on data distribution and device)
- Optimized index rebuilding with batch operations (measurable gain in benchmarks)
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

- $like query: precompiled regex patterns (measurable gain in benchmarks; depends on data distribution)
- Cache expiry cleanup: min-heap sweep (measurable gain in benchmarks)
- Cache size calculation: JSON approximation (measurable gain in benchmarks)
- Index rebuilding: batch operations (measurable gain in benchmarks)
- GCM encryption: cached-key path after derivation; actual per-record latency must be measured on target devices (no cross-device guarantee)
- Overall: measurable gain in encryption operations in benchmarks (magnitude depends on data size and runtime)

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
