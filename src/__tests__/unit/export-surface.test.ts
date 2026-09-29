/**
 * API surface lock test (R2-P7).
 *
 * This test locks the three public export surfaces of the package plus the
 * `package.json` export-map subpaths: every surface is asserted as a full set
 * equality (`Object.keys(...).sort()` vs. an explicit key list), so both an
 * added export and a removed export turn this suite red instead of passing
 * silently.
 *
 * IMPORTANT: when you intentionally add or remove a public export, update the
 * explicit lists below AND the export tables in `docs/API.zh-CN.md` /
 * `docs/API.en.md` (and the CHANGELOG). Do not weaken the assertions to
 * `toContain`/`toHaveProperty` — that would turn this back into a test that
 * passes on accidental surface changes.
 *
 * Scope note: only runtime-enumerable exports are listed. Type-only exports
 * (`export type { ... }`) are erased by the compiler, so `Object.keys` cannot
 * see them; they are documented by the export-group tables in the API guides
 * instead of being locked here.
 */
import fs from 'fs';
import path from 'path';

type RuntimeExports = Record<string, unknown>;

const MAIN_ENTRY_SPECIFIER = '../../expo-lite-data-store';
const INDEX_ENTRY_SPECIFIER = '../../index';
const PACKAGE_JSON_PATH = path.resolve(__dirname, '../../../package.json');

/**
 * Runtime-enumerable exports of the main entrypoint: 41 named exports plus the
 * default export object.
 */
const MAIN_ENTRY_RUNTIME_EXPORT_KEYS: readonly string[] = [
  'ConfigManager',
  'CryptoError',
  'CryptoService',
  'EngineMigrationService',
  'StorageError',
  'StorageErrorCode',
  'TransactionError',
  'beginTransaction',
  'bulkWrite',
  'clearTable',
  'commit',
  'configManager',
  'countTable',
  'createIndex',
  'createTable',
  'db',
  'decrypt',
  'decryptBulk',
  'default',
  'deleteTable',
  'dropIndex',
  'encrypt',
  'encryptBulk',
  'findMany',
  'findOne',
  'getKeyCacheHitRate',
  'getKeyCacheStats',
  'hasTable',
  'hash',
  'init',
  'insert',
  'listTables',
  'migrateEngine',
  'migrateToChunked',
  'overwrite',
  'performanceMonitor',
  'read',
  'remove',
  'resetMasterKey',
  'rollback',
  'update',
  'verifyCountTable',
];

/** Keys of the `db` facade object exported from the main entrypoint. */
const DB_FACADE_KEYS: readonly string[] = [
  'beginTransaction',
  'bulkWrite',
  'clearTable',
  'commit',
  'countTable',
  'createIndex',
  'createTable',
  'deleteTable',
  'dropIndex',
  'findMany',
  'findOne',
  'hasTable',
  'init',
  'insert',
  'listTables',
  'migrateEngine',
  'migrateToChunked',
  'overwrite',
  'read',
  'remove',
  'rollback',
  'update',
  'verifyCountTable',
];

/** Keys of the default export object of the main entrypoint. */
const DEFAULT_EXPORT_KEYS: readonly string[] = [
  'beginTransaction',
  'bulkWrite',
  'clearTable',
  'commit',
  'countTable',
  'createIndex',
  'createTable',
  'db',
  'decrypt',
  'decryptBulk',
  'deleteTable',
  'dropIndex',
  'encrypt',
  'encryptBulk',
  'findMany',
  'findOne',
  'hasTable',
  'hash',
  'init',
  'insert',
  'listTables',
  'migrateEngine',
  'migrateToChunked',
  'overwrite',
  'read',
  'remove',
  'resetMasterKey',
  'rollback',
  'update',
  'verifyCountTable',
];

/** Subpath keys of the `package.json` `exports` field. */
const PACKAGE_EXPORT_SUBPATHS: readonly string[] = ['.', './cjs', './js', './utils/*'];

const loadRuntimeExports = (specifier: string): RuntimeExports => require(specifier) as unknown as RuntimeExports;

const sortedKeys = (value: unknown): string[] => Object.keys(value as object).sort();

const sortedCopy = (keys: readonly string[]): string[] => [...keys].sort();

describe('export surface lock', () => {
  it('locks the runtime-enumerable exports of the main entrypoint', () => {
    const mainEntry = loadRuntimeExports(MAIN_ENTRY_SPECIFIER);

    expect(Object.keys(mainEntry).sort()).toEqual(sortedCopy(MAIN_ENTRY_RUNTIME_EXPORT_KEYS));
  });

  it('locks the `db` facade key set', () => {
    const mainEntry = loadRuntimeExports(MAIN_ENTRY_SPECIFIER);

    expect(sortedKeys(mainEntry.db)).toEqual(sortedCopy(DB_FACADE_KEYS));
  });

  it('locks the default export object key set', () => {
    const mainEntry = loadRuntimeExports(MAIN_ENTRY_SPECIFIER);

    expect(sortedKeys(mainEntry.default)).toEqual(sortedCopy(DEFAULT_EXPORT_KEYS));
  });

  it('locks the subpath keys of the package export map', () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      exports?: Record<string, unknown>;
    };

    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual(sortedCopy(PACKAGE_EXPORT_SUBPATHS));
  });

  it('keeps the index entrypoint re-export surface identical to the main entrypoint', () => {
    const indexEntry = loadRuntimeExports(INDEX_ENTRY_SPECIFIER);
    const mainEntry = loadRuntimeExports(MAIN_ENTRY_SPECIFIER);

    expect(Object.keys(indexEntry).sort()).toEqual(Object.keys(mainEntry).sort());
  });
});
