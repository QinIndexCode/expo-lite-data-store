import {
  init,
  createTable,
  insert,
  findMany,
  remove,
  update,
  deleteTable,
  hasTable,
  countTable,
} from '../../expo-lite-data-store';
import type { FindManyOptions } from '../../expo-lite-data-store';
import { configManager } from '../../core/config/ConfigManager';
import { QueryEngine } from '../../core/query/QueryEngine';

/**
 * Engine parity suite for issue "the same query returns different results on
 * the two engines".
 *
 * Every case runs the identical filter against the identical dataset twice:
 * once on the file-system engine (memory semantics = QueryEngine) and once on
 * the sqlite engine (SQL pushdown via SqlQueryBuilder, or the memory fallback
 * when a condition cannot be expressed in SQL). Both runs must return exactly
 * the same record ids, and both must equal the hand-computed expectation that
 * mirrors QueryEngine behaviour.
 *
 * Isolation: each engine owns its own table name, and every run re-initialises
 * the library with `resetConfig() + init({ engine })`, so the two engines never
 * observe each other's tables or cached reads.
 */
type Engine = 'file-system' | 'sqlite';

type ParityRecord = {
  id: string;
  tags?: Array<string | number> | string | null;
  score: number;
  title: string | null;
  active: boolean;
  meta?: { city: string };
};

type Where = NonNullable<FindManyOptions<ParityRecord>['where']>;

const FS_TABLE = 'engine_parity_fs_table';
const SQLITE_TABLE = 'engine_parity_sqlite_table';

const SORT_FS_TABLE = 'engine_parity_sort_fs_table';
const SORT_SQLITE_TABLE = 'engine_parity_sort_sqlite_table';

const NUMERIC_FS_TABLE = 'engine_parity_numeric_fs_table';
const NUMERIC_SQLITE_TABLE = 'engine_parity_numeric_sqlite_table';

const tableFor = (engine: Engine): string => (engine === 'file-system' ? FS_TABLE : SQLITE_TABLE);
const sortTableFor = (engine: Engine): string => (engine === 'file-system' ? SORT_FS_TABLE : SORT_SQLITE_TABLE);
const numericTableFor = (engine: Engine): string =>
  engine === 'file-system' ? NUMERIC_FS_TABLE : NUMERIC_SQLITE_TABLE;

/**
 * Shared dataset covering: array/scalar/missing/null tags, boolean-vs-number
 * edge cases, Unicode titles (Latin accent, Greek, CJK) and a nested object.
 */
const DATASET: ParityRecord[] = [
  { id: 'p01', tags: ['alpha', 'beta'], score: 10, title: 'Hello World', active: true },
  { id: 'p02', tags: ['beta', 'gamma'], score: 20, title: 'hello world', active: false },
  { id: 'p03', tags: ['gamma'], score: 30, title: 'CAFÉ', active: true },
  { id: 'p04', tags: ['delta'], score: 40, title: 'café', active: false },
  { id: 'p05', tags: 'alpha', score: 50, title: 'Ω Omega', active: true },
  { id: 'p06', tags: [], score: 60, title: 'plain', active: false },
  { id: 'p07', score: 70, title: 'missing tags', active: true },
  { id: 'p08', tags: null, score: 80, title: null, active: false },
  { id: 'p09', tags: ['alpha', 42], score: 90, title: 'Mixed 中文', active: true },
  { id: 'p10', tags: ['omega'], score: 100, title: '测试用例', active: false },
  { id: 'p11', meta: { city: 'Paris' }, score: 110, title: 'ObjectMeta', active: true },
  { id: 'p12', tags: ['alpha', 'omega'], score: 1.5, title: 'Fraction', active: false },
];

const ALL_IDS = DATASET.map(record => record.id);
const except = (...ids: string[]): string[] => ALL_IDS.filter(id => !ids.includes(id));
const idsOf = (rows: Array<{ id: string }>): string[] => rows.map(row => row.id).sort();
/** Result order as returned — the parity assertion under test must not re-sort. */
const orderedIdsOf = (rows: Array<{ id: string }>): string[] => rows.map(row => row.id);

/**
 * Sort-parity dataset: mixed-case strings, CJK, a full-width Latin letter, a
 * private-use character (U+E000), an astral-plane emoji (U+1F600), an explicit
 * null, and repeated keys so the id tie-break is observable. Insertion order is
 * the physical row id order on both engines, which is what the sqlite
 * `ORDER BY ..., id ASC` tie-break falls back to.
 */
type SortRecord = {
  id: string;
  bucket: string;
  name: string | null;
};

const SORT_DATASET: SortRecord[] = [
  { id: 's01', bucket: 'x', name: 'b' },
  { id: 's02', bucket: 'x', name: 'B' },
  { id: 's03', bucket: 'y', name: 'a' },
  { id: 's04', bucket: 'y', name: 'A' },
  { id: 's05', bucket: 'x', name: '中' },
  { id: 's06', bucket: 'y', name: 'Ｚ' },
  { id: 's07', bucket: 'x', name: 'z' },
  { id: 's08', bucket: 'y', name: '' },
  { id: 's09', bucket: 'x', name: '😀' },
  { id: 's10', bucket: 'y', name: null },
  { id: 's11', bucket: 'y', name: 'a' },
  { id: 's12', bucket: 'x', name: 'a' },
];

/** Code point order: A < B < a < b < z < CJK <  < full-width Latin Z < emoji, nulls last, ties by id. */
const NAME_ASC_IDS = ['s04', 's02', 's03', 's11', 's12', 's01', 's07', 's05', 's08', 's06', 's09', 's10'];
/** Exact reverse of the non-null part, nulls still last, ties still by id. */
const NAME_DESC_IDS = ['s09', 's06', 's08', 's05', 's07', 's01', 's03', 's11', 's12', 's02', 's04', 's10'];
/** bucket ASC, then name DESC, then physical id. */
const BUCKET_NAME_IDS = ['s09', 's05', 's07', 's01', 's12', 's02', 's06', 's08', 's03', 's11', 's04', 's10'];

/**
 * Numeric-path datasets: one field path (`a.0.c`) that reads an array index
 * on the first dataset and an object numeric key on the second. SQLite only
 * understands one reading per path expression - `$.a[0].c` addresses arrays,
 * `$.a.0.c` addresses objects with a `"0"` key - while the in-memory engine
 * resolves both with property access, so the pushdown has to cover both
 * variants or it silently skips half of each dataset.
 *
 * The per-record value of `a.0.c` is identical across the two datasets, so
 * every expectation below is shared: any difference between the engines is a
 * pushdown bug, never a dataset difference.
 */
type NumericRecord = {
  id: string;
  score?: number;
  /**
   * Deliberately loose: the k = 1 datasets store `{ c }` elements/fields,
   * the k >= 2 fallback datasets store the mixed array/object walks, and the
   * read-proof cases assert the exact stored shape at the call site.
   */
  a?: unknown;
};

type NumericWhere = NonNullable<FindManyOptions<NumericRecord>['where']>;

/** Path with a numeric segment; must stay ambiguous between both readings. */
const NUMERIC_FIELD = 'a.0.c';

const ARRAY_DATASET: NumericRecord[] = [
  { id: 'n01', a: [{ c: 10 }] },
  { id: 'n02', a: [{ c: 20 }] },
  { id: 'n03', a: [{ c: 50 }] },
  { id: 'n04', a: [{ c: null }] },
  { id: 'n05', a: [{}] },
  { id: 'n06', a: [] },
  { id: 'n07' },
  { id: 'n08', a: null },
  { id: 'n09', a: [{ c: 50 }] },
];

const OBJECT_DATASET: NumericRecord[] = [
  { id: 'n01', a: { '0': { c: 10 } } },
  { id: 'n02', a: { '0': { c: 20 } } },
  { id: 'n03', a: { '0': { c: 50 } } },
  { id: 'n04', a: { '0': { c: null } } },
  { id: 'n05', a: { '0': {} } },
  { id: 'n06', a: {} },
  { id: 'n07' },
  { id: 'n08', a: null },
  { id: 'n09', a: { '0': { c: 50 } } },
];

const NUMERIC_DATASETS: Array<[string, NumericRecord[]]> = [
  ['array', ARRAY_DATASET],
  ['object numeric key', OBJECT_DATASET],
];

/** Shared expectations: 10/20/50 values, one explicit null, four missing paths. */
const NUMERIC_ALL_IDS = ['n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09'];
const NUMERIC_MISSING_IDS = ['n05', 'n06', 'n07', 'n08'];

/**
 * Mixed numeric-path sort dataset: both readings of `a.0.c` live in one
 * table, so the ORDER BY key has to resolve each row through its own variant
 * instead of reporting the object rows as NULL.
 */
const MIXED_DATASET: NumericRecord[] = [
  { id: 'm01', a: [{ c: 30 }] },
  { id: 'm02', a: { '0': { c: 10 } } },
  { id: 'm03', a: [{ c: 10 }] },
  { id: 'm04', a: { '0': { c: 30 } } },
  { id: 'm05', a: { '0': { c: null } } },
  { id: 'm06', a: [{ c: null }] },
  { id: 'm07', a: [{ c: 20 }] },
  { id: 'm08', a: { '0': {} } },
  { id: 'm09' },
];

/** 10 (m02, m03) < 20 (m07) < 30 (m01, m04), ties by id, then nullish last by id. */
const MIXED_ASC_IDS = ['m02', 'm03', 'm07', 'm01', 'm04', 'm05', 'm06', 'm08', 'm09'];
/** Non-nullish reversed (equal keys keep id order), nullish rows still last. */
const MIXED_DESC_IDS = ['m01', 'm04', 'm07', 'm02', 'm03', 'm05', 'm06', 'm08', 'm09'];

/**
 * Multi-numeric-segment counterexample datasets: field `a.0.1` has two
 * numeric segments, and with *mixed* containers neither SQL path form
 * survives - `$.a[0][1]` needs array -> array while `$.a.0.1` needs object
 * -> object, so both evaluate to SQL NULL while the in-memory engine walks
 * through step by step (array index then object key, or the reverse).
 * Pushdown is refused for such paths, so both engines must reach the same
 * rows through the in-memory fallback.
 *
 * Both datasets share one expectation set: `a.0.1` reads 9 on c1/c2, 7 on
 * c3, and is missing on c4/c5 - any engine difference is a bug, never a
 * dataset difference.
 */
const MULTI_ARRAY_DATASET: NumericRecord[] = [
  { id: 'c1', a: [{ '1': 9 }] },
  { id: 'c2', a: [{ '1': 9 }] },
  { id: 'c3', a: [{ '1': 7 }] },
  { id: 'c4', a: [{}] },
  { id: 'c5' },
];

const MULTI_OBJECT_DATASET: NumericRecord[] = [
  { id: 'c1', a: { '0': [7, 9] } },
  { id: 'c2', a: { '0': [8, 9] } },
  { id: 'c3', a: { '0': [8, 7] } },
  { id: 'c4', a: { '0': {} } },
  { id: 'c5' },
];

const MULTI_DATASETS: Array<[string, NumericRecord[]]> = [
  ['array -> object key', MULTI_ARRAY_DATASET],
  ['object -> array', MULTI_OBJECT_DATASET],
];

/** Two numeric segments in the path under test (`a.0.1`). */
const MULTI_NUMERIC_FIELD = 'a.0.1';

/** Three segments (`a.0.b.1`): the same mixed-walk refusal, one level deeper. */
const MULTI_DEEP_FIELD = 'a.0.b.1';

const MULTI_DEEP_DATASET: NumericRecord[] = [
  { id: 'd1', a: [{ b: { '1': 42 } }] }, // array -> object key
  { id: 'd2', a: { '0': { b: [0, 42] } } }, // object -> array index
  { id: 'd3' },
];

/**
 * Both mixed readings of `a.0.1` in one table, for the e2e delete form of
 * the reviewer's counterexample: file-system deletes both 9-valued rows,
 * sqlite used to delete none of them.
 */
const MULTI_MIXED_DATASET: NumericRecord[] = [
  { id: 'r1', a: [{ '1': 9 }] }, // array -> object key: reads 9
  { id: 'r2', a: { '0': [8, 9] } }, // object -> array index: reads 9
  { id: 'r3', a: [{ '1': 7 }] }, // reads 7
  { id: 'r4', a: { '0': [8, 7] } }, // reads 7
  { id: 'r5' }, // missing on both readings
];

/** Re-initialises the library on the requested engine and runs the callback. */
async function useEngine<T>(engine: Engine, run: (table: string) => Promise<T>): Promise<T> {
  configManager.resetConfig();
  await init({ engine });
  return run(tableFor(engine));
}

/** Drops, recreates and re-seeds one engine's parity table from DATASET. */
async function seed(engine: Engine): Promise<void> {
  await useEngine(engine, async table => {
    if (await hasTable(table)) {
      await deleteTable(table);
    }
    await createTable(table);
    await insert(table, DATASET);
    expect(await countTable(table)).toBe(DATASET.length);
  });
}

async function seedBoth(): Promise<void> {
  await seed('file-system');
  await seed('sqlite');
}

/** Re-initialises the library on the requested engine against the sort table. */
async function useSortEngine<T>(engine: Engine, run: (table: string) => Promise<T>): Promise<T> {
  configManager.resetConfig();
  await init({ engine });
  return run(sortTableFor(engine));
}

/** Drops, recreates and re-seeds one engine's sort-parity table. */
async function seedSort(engine: Engine): Promise<void> {
  await useSortEngine(engine, async table => {
    if (await hasTable(table)) {
      await deleteTable(table);
    }
    await createTable(table);
    await insert(table, SORT_DATASET);
    expect(await countTable(table)).toBe(SORT_DATASET.length);
  });
}

async function seedSortBoth(): Promise<void> {
  await seedSort('file-system');
  await seedSort('sqlite');
}

/** Re-initialises the library on the requested engine against the numeric-path table. */
async function useNumericEngine<T>(engine: Engine, run: (table: string) => Promise<T>): Promise<T> {
  configManager.resetConfig();
  await init({ engine });
  return run(numericTableFor(engine));
}

/** Drops, recreates and re-seeds one engine's numeric-path table from `data`. */
async function seedNumeric(engine: Engine, data: NumericRecord[]): Promise<void> {
  await useNumericEngine(engine, async table => {
    if (await hasTable(table)) {
      await deleteTable(table);
    }
    await createTable(table);
    await insert(table, data);
    expect(await countTable(table)).toBe(data.length);
  });
}

/** Seeds the same numeric-path dataset on both engines before every case. */
async function seedNumericBoth(data: NumericRecord[]): Promise<void> {
  await seedNumeric('file-system', data);
  await seedNumeric('sqlite', data);
}

describe('engine parity: file-system vs sqlite', () => {
  beforeAll(async () => {
    await seedBoth();
  }, 60000);

  afterAll(async () => {
    for (const engine of ['file-system', 'sqlite'] as const) {
      for (const table of [tableFor(engine), sortTableFor(engine), numericTableFor(engine)]) {
        try {
          configManager.resetConfig();
          await init({ engine });
          if (await hasTable(table)) {
            await deleteTable(table);
          }
        } catch {
          // teardown is best effort
        }
      }
    }
    configManager.resetConfig();
  }, 60000);

  describe('read parity', () => {
    const runReadCase = async (where: Where, expected: string[]): Promise<void> => {
      const fsRows = await useEngine('file-system', table => findMany<ParityRecord>(table, { where }));
      const sqliteRows = await useEngine('sqlite', table => findMany<ParityRecord>(table, { where }));

      const fsIds = idsOf(fsRows);
      const sqliteIds = idsOf(sqliteRows);

      expect(fsIds).toEqual(expected);
      expect(sqliteIds).toEqual(expected);
      expect(fsIds).toEqual(sqliteIds);
    };

    it('array $in matches array elements and scalar fields', async () => {
      await runReadCase({ tags: { $in: ['alpha'] } }, ['p01', 'p05', 'p09', 'p12']);
    }, 30000);

    it('array $in with no match returns nothing on both engines', async () => {
      await runReadCase({ tags: { $in: ['nope'] } }, []);
    }, 30000);

    it('array $in with mixed string and number operands', async () => {
      await runReadCase({ tags: { $in: ['beta', 42] } }, ['p01', 'p02', 'p09']);
    }, 30000);

    it('$nin excludes element matches, scalar matches, missing and null fields', async () => {
      await runReadCase({ tags: { $nin: ['alpha'] } }, ['p02', 'p03', 'p04', 'p06', 'p07', 'p08', 'p10', 'p11']);
    }, 30000);

    it('$nin containing null also excludes the explicit JSON null record', async () => {
      await runReadCase({ tags: { $nin: ['alpha', null] } }, ['p02', 'p03', 'p04', 'p06', 'p07', 'p10', 'p11']);
    }, 30000);

    it('$in containing null matches only the explicit JSON null record', async () => {
      await runReadCase({ tags: { $in: [null] } }, ['p08']);
    }, 30000);

    it('$nin [null] keeps records whose field is missing', async () => {
      await runReadCase({ tags: { $nin: [null] } }, except('p08'));
    }, 30000);

    it('$ne null matches records whose field is missing', async () => {
      await runReadCase({ tags: { $ne: null } }, except('p08'));
    }, 30000);

    it('direct null equality misses records whose field is missing', async () => {
      await runReadCase({ tags: null }, ['p08']);
    }, 30000);

    it('$ne scalar value matches every record except the equal one', async () => {
      await runReadCase({ tags: { $ne: 'alpha' } }, except('p05'));
    }, 30000);

    it('$like folds ASCII case on both engines', async () => {
      await runReadCase({ title: { $like: '%hello%' } }, ['p01', 'p02']);
    }, 30000);

    it('$like matches accented Unicode regardless of case', async () => {
      await runReadCase({ title: { $like: '%CAFÉ%' } }, ['p03', 'p04']);
    }, 30000);

    it('$like matches Greek characters', async () => {
      await runReadCase({ title: { $like: '%Ω%' } }, ['p05']);
    }, 30000);

    it('$like matches CJK text', async () => {
      await runReadCase({ title: { $like: '%测试%' } }, ['p10']);
    }, 30000);

    it('$in above the 500-parameter cap falls back to memory semantics', async () => {
      const many = Array.from({ length: 501 }, (_, i) => i);
      await runReadCase({ score: { $in: many } }, ALL_IDS.slice(0, 11));
    }, 30000);

    it('compound $and with nested $or agrees across engines', async () => {
      await runReadCase(
        {
          $and: [{ score: { $gte: 30 } }, { $or: [{ active: true }, { tags: { $in: ['beta'] } }] }],
        },
        ['p03', 'p05', 'p07', 'p09', 'p11']
      );
    }, 30000);

    it('boolean true equality matches only booleans', async () => {
      await runReadCase({ active: true }, ['p01', 'p03', 'p05', 'p07', 'p09', 'p11']);
    }, 30000);

    it('number 1 does not match boolean true', async () => {
      await runReadCase({ active: 1 }, []);
    }, 30000);

    it('$in [1] does not match boolean true', async () => {
      await runReadCase({ active: { $in: [1] } }, []);
    }, 30000);

    it('$in [true] matches boolean true', async () => {
      await runReadCase({ active: { $in: [true] } }, ['p01', 'p03', 'p05', 'p07', 'p09', 'p11']);
    }, 30000);

    it('$in with undefined matches records whose field is missing', async () => {
      await runReadCase({ tags: { $in: ['alpha', undefined] } }, ['p01', 'p05', 'p07', 'p09', 'p11', 'p12']);
    }, 30000);

    it('nested path equality', async () => {
      await runReadCase({ 'meta.city': 'Paris' }, ['p11']);
    }, 30000);
  });

  describe('sort parity', () => {
    beforeAll(async () => {
      await seedSortBoth();
    }, 60000);

    /**
     * Runs the same ordered query on both engines and asserts the exact
     * returned sequence: sqlite executes `ORDER BY <key> NULLS LAST, id ASC`
     * as pushdown, while file-system sorts in memory. Both must agree with the
     * hand-computed Unicode code point order (the SQLite BINARY collation).
     */
    const runSortCase = async (
      options: Omit<FindManyOptions<SortRecord>, 'where'>,
      expected: string[]
    ): Promise<void> => {
      const fsRows = await useSortEngine('file-system', table =>
        findMany<SortRecord>(table, { where: {}, ...options })
      );
      const sqliteRows = await useSortEngine('sqlite', table => findMany<SortRecord>(table, { where: {}, ...options }));

      expect(orderedIdsOf(fsRows)).toEqual(expected);
      expect(orderedIdsOf(sqliteRows)).toEqual(expected);
    };

    it('sorts strings by code point order with the null field last on both engines', async () => {
      await runSortCase({ sortBy: 'name', order: 'asc' }, NAME_ASC_IDS);
    }, 30000);

    it('descending order reverses every non-null key and keeps the null field last', async () => {
      await runSortCase({ sortBy: 'name', order: 'desc' }, NAME_DESC_IDS);
    }, 30000);

    it('two-field sort falls back to the physical id when the second key ties', async () => {
      await runSortCase({ sortBy: ['bucket', 'name'], order: ['asc', 'desc'] }, BUCKET_NAME_IDS);
    }, 30000);

    it.each(['fast', 'counting', 'merge', 'slow'] as const)(
      'sortAlgorithm %s picks the same in-memory comparator on both engines',
      async algorithm => {
        await runSortCase({ sortBy: 'name', order: 'asc', sortAlgorithm: algorithm }, NAME_ASC_IDS);
        await runSortCase({ sortBy: 'name', order: 'desc', sortAlgorithm: algorithm }, NAME_DESC_IDS);
      },
      60000
    );

    it('max/min over the rows read from each engine follow code point order', async () => {
      const fsRows = await useSortEngine('file-system', table => findMany<SortRecord>(table, { where: {} }));
      const sqliteRows = await useSortEngine('sqlite', table => findMany<SortRecord>(table, { where: {} }));

      const fsNames = fsRows.filter(row => row.name !== null);
      const sqliteNames = sqliteRows.filter(row => row.name !== null);

      expect(QueryEngine.min(fsNames, 'name')).toBe('A');
      expect(QueryEngine.min(sqliteNames, 'name')).toBe('A');
      expect(QueryEngine.max(fsNames, 'name')).toBe('\u{1F600}');
      expect(QueryEngine.max(sqliteNames, 'name')).toBe('\u{1F600}');

      // The extremes of the sorted sequences are the same values on both engines.
      const fsSorted = await useSortEngine('file-system', table =>
        findMany<SortRecord>(table, { where: {}, sortBy: 'name', order: 'asc' })
      );
      const sqliteSorted = await useSortEngine('sqlite', table =>
        findMany<SortRecord>(table, { where: {}, sortBy: 'name', order: 'asc' })
      );
      expect(fsSorted[0]?.name).toBe('A');
      expect(sqliteSorted[0]?.name).toBe('A');
      expect(fsSorted[fsSorted.length - 1]?.name).toBeNull();
      expect(sqliteSorted[sqliteSorted.length - 1]?.name).toBeNull();
    }, 60000);
  });

  describe('write parity (remove / update with operator filters)', () => {
    it('remove with array $in deletes the same rows on both engines', async () => {
      await seedBoth();

      const fsRemoved = await useEngine('file-system', table =>
        remove<ParityRecord>(table, { where: { tags: { $in: ['alpha'] } } })
      );
      const sqliteRemoved = await useEngine('sqlite', table =>
        remove<ParityRecord>(table, { where: { tags: { $in: ['alpha'] } } })
      );

      expect(fsRemoved).toBe(4);
      expect(sqliteRemoved).toBe(4);

      const remaining = except('p01', 'p05', 'p09', 'p12');
      const fsRest = await useEngine('file-system', table => findMany<ParityRecord>(table));
      const sqliteRest = await useEngine('sqlite', table => findMany<ParityRecord>(table));
      expect(idsOf(fsRest)).toEqual(remaining);
      expect(idsOf(sqliteRest)).toEqual(remaining);
    }, 60000);

    it('remove with $nin containing null deletes the same rows on both engines', async () => {
      await seedBoth();

      const fsRemoved = await useEngine('file-system', table =>
        remove<ParityRecord>(table, { where: { tags: { $nin: ['alpha', null] } } })
      );
      const sqliteRemoved = await useEngine('sqlite', table =>
        remove<ParityRecord>(table, { where: { tags: { $nin: ['alpha', null] } } })
      );

      expect(fsRemoved).toBe(7);
      expect(sqliteRemoved).toBe(7);

      const remaining = ['p01', 'p05', 'p08', 'p09', 'p12'];
      const fsRest = await useEngine('file-system', table => findMany<ParityRecord>(table));
      const sqliteRest = await useEngine('sqlite', table => findMany<ParityRecord>(table));
      expect(idsOf(fsRest)).toEqual(remaining);
      expect(idsOf(sqliteRest)).toEqual(remaining);
    }, 60000);

    it('update with array $in touches the same rows on both engines', async () => {
      await seedBoth();

      const fsUpdated = await useEngine('file-system', table =>
        update<ParityRecord>(table, { score: 999 }, { where: { tags: { $in: ['beta'] } } })
      );
      const sqliteUpdated = await useEngine('sqlite', table =>
        update<ParityRecord>(table, { score: 999 }, { where: { tags: { $in: ['beta'] } } })
      );

      expect(fsUpdated).toBe(2);
      expect(sqliteUpdated).toBe(2);

      const fsTouched = await useEngine('file-system', table =>
        findMany<ParityRecord>(table, { where: { score: 999 } })
      );
      const sqliteTouched = await useEngine('sqlite', table =>
        findMany<ParityRecord>(table, { where: { score: 999 } })
      );
      expect(idsOf(fsTouched)).toEqual(['p01', 'p02']);
      expect(idsOf(sqliteTouched)).toEqual(['p01', 'p02']);
    }, 60000);
  });

  describe('numeric path parity (array index vs object numeric key)', () => {
    /**
     * Seeds the given dataset on both engines, runs the identical filter on
     * both, and asserts both hit sets against the hand-computed memory
     * expectation (QueryEngine resolves `a.0.c` on both readings).
     */
    const runNumericReadCase = async (
      data: NumericRecord[],
      where: NumericWhere,
      expected: string[]
    ): Promise<void> => {
      await seedNumericBoth(data);

      const fsRows = await useNumericEngine('file-system', table => findMany<NumericRecord>(table, { where }));
      const sqliteRows = await useNumericEngine('sqlite', table => findMany<NumericRecord>(table, { where }));

      const fsIds = idsOf(fsRows);
      const sqliteIds = idsOf(sqliteRows);

      expect(fsIds).toEqual(expected);
      expect(sqliteIds).toEqual(expected);
      expect(fsIds).toEqual(sqliteIds);
    };

    it.each(NUMERIC_DATASETS)(
      'eq on %s dataset matches only the equal record',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: 10 }, ['n01']);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      'direct null on %s dataset matches only the explicit null',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: null }, ['n04']);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      'undefined equality on %s dataset matches only missing paths',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: undefined }, NUMERIC_MISSING_IDS);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      '$ne value on %s dataset misses only the equal record',
      async (_label, data) => {
        const expected = NUMERIC_ALL_IDS.filter(id => id !== 'n01');
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $ne: 10 } }, expected);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      '$ne null on %s dataset keeps missing paths, drops the null',
      async (_label, data) => {
        const expected = NUMERIC_ALL_IDS.filter(id => id !== 'n04');
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $ne: null } }, expected);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      'range $gt/$lt on %s dataset matches the in-range records',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $gt: 15, $lt: 55 } }, ['n02', 'n03', 'n09']);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      '$in on %s dataset matches values and the explicit null',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $in: [10, null] } }, ['n01', 'n04']);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      '$nin on %s dataset excludes values and the explicit null',
      async (_label, data) => {
        const expected = NUMERIC_ALL_IDS.filter(id => id !== 'n01' && id !== 'n04');
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $nin: [10, null] } }, expected);
      },
      30000
    );

    it.each(NUMERIC_DATASETS)(
      '$in with undefined on %s dataset also matches missing paths',
      async (_label, data) => {
        await runNumericReadCase(data, { [NUMERIC_FIELD]: { $in: [20, undefined] } }, ['n02', ...NUMERIC_MISSING_IDS]);
      },
      30000
    );

    it('sqlite really reads the object numeric-key record (not just the array one)', async () => {
      await seedNumericBoth(OBJECT_DATASET);
      const rows = await useNumericEngine('sqlite', table =>
        findMany<NumericRecord>(table, { where: { [NUMERIC_FIELD]: 10 } })
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('n01');
      // The stored shape is the object form: the sqlite engine resolved the
      // numeric object key through the dot-path variant. This guards against
      // "both engines wrong in the same way" - file-system resolves it
      // through plain property access, sqlite only through this variant.
      expect(rows[0]?.a).toEqual({ '0': { c: 10 } });
    }, 30000);

    it('sqlite really reads the array record through the bracket-path variant', async () => {
      await seedNumericBoth(ARRAY_DATASET);
      const rows = await useNumericEngine('sqlite', table =>
        findMany<NumericRecord>(table, { where: { [NUMERIC_FIELD]: 10 } })
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('n01');
      expect(rows[0]?.a).toEqual([{ c: 10 }]);
    }, 30000);

    it.each(NUMERIC_DATASETS)(
      'remove by numeric-path range deletes the same rows on %s dataset',
      async (_label, data) => {
        await seedNumericBoth(data);

        const fsRemoved = await useNumericEngine('file-system', table =>
          remove<NumericRecord>(table, { where: { [NUMERIC_FIELD]: { $gt: 15 } } })
        );
        const sqliteRemoved = await useNumericEngine('sqlite', table =>
          remove<NumericRecord>(table, { where: { [NUMERIC_FIELD]: { $gt: 15 } } })
        );

        // The old pushdown only read the bracket form, so on the object
        // dataset it deleted nothing at all - a silent partial delete.
        expect(fsRemoved).toBe(3);
        expect(sqliteRemoved).toBe(3);

        const remaining = NUMERIC_ALL_IDS.filter(id => !['n02', 'n03', 'n09'].includes(id));
        const fsRest = await useNumericEngine('file-system', table => findMany<NumericRecord>(table));
        const sqliteRest = await useNumericEngine('sqlite', table => findMany<NumericRecord>(table));
        expect(idsOf(fsRest)).toEqual(remaining);
        expect(idsOf(sqliteRest)).toEqual(remaining);
      },
      60000
    );

    it.each(NUMERIC_DATASETS)(
      'update with $ne null touches the same rows on %s dataset',
      async (_label, data) => {
        await seedNumericBoth(data);

        const fsUpdated = await useNumericEngine('file-system', table =>
          update<NumericRecord>(table, { score: 999 }, { where: { [NUMERIC_FIELD]: { $ne: null } } })
        );
        const sqliteUpdated = await useNumericEngine('sqlite', table =>
          update<NumericRecord>(table, { score: 999 }, { where: { [NUMERIC_FIELD]: { $ne: null } } })
        );

        // `$ne null` over-matches on a single-variant pushdown: a record
        // whose path does not resolve evaluates the negation as TRUE, so the
        // object dataset would see all 9 rows touched instead of 8.
        expect(fsUpdated).toBe(8);
        expect(sqliteUpdated).toBe(8);

        const expected = NUMERIC_ALL_IDS.filter(id => id !== 'n04');
        const fsTouched = await useNumericEngine('file-system', table =>
          findMany<NumericRecord>(table, { where: { score: 999 } })
        );
        const sqliteTouched = await useNumericEngine('sqlite', table =>
          findMany<NumericRecord>(table, { where: { score: 999 } })
        );
        expect(idsOf(fsTouched)).toEqual(expected);
        expect(idsOf(sqliteTouched)).toEqual(expected);
      },
      60000
    );

    /**
     * Both readings live in one table: the sqlite ORDER BY key has to pick
     * the resolving variant per row (COALESCE), or the object rows collapse
     * to NULL and sort apart from their equal-valued array rows.
     */
    const runNumericSortCase = async (options: Omit<FindManyOptions<NumericRecord>, 'where'>, expected: string[]) => {
      await seedNumericBoth(MIXED_DATASET);

      const fsRows = await useNumericEngine('file-system', table =>
        findMany<NumericRecord>(table, { where: {}, ...options })
      );
      const sqliteRows = await useNumericEngine('sqlite', table =>
        findMany<NumericRecord>(table, { where: {}, ...options })
      );

      expect(orderedIdsOf(fsRows)).toEqual(expected);
      expect(orderedIdsOf(sqliteRows)).toEqual(expected);
    };

    it('sorts by the numeric path ascending with nullish rows last on both engines', async () => {
      await runNumericSortCase({ sortBy: NUMERIC_FIELD, order: 'asc' }, MIXED_ASC_IDS);
    }, 30000);

    it('sorts by the numeric path descending with nullish rows still last on both engines', async () => {
      await runNumericSortCase({ sortBy: NUMERIC_FIELD, order: 'desc' }, MIXED_DESC_IDS);
    }, 30000);

    /**
     * Counterexamples for paths with two (or three) numeric segments:
     * pushdown is refused for them, so both engines have to agree through
     * the in-memory fallback on shapes that walk through mixed containers.
     */
    describe('multi-numeric-segment fallback (k >= 2)', () => {
      const runMultiReadCase = async (
        data: NumericRecord[],
        where: NumericWhere,
        expected: string[]
      ): Promise<void> => {
        await seedNumericBoth(data);

        const fsRows = await useNumericEngine('file-system', table => findMany<NumericRecord>(table, { where }));
        const sqliteRows = await useNumericEngine('sqlite', table => findMany<NumericRecord>(table, { where }));

        const fsIds = idsOf(fsRows);
        const sqliteIds = idsOf(sqliteRows);

        expect(fsIds).toEqual(expected);
        expect(sqliteIds).toEqual(expected);
        expect(fsIds).toEqual(sqliteIds);
      };

      it.each(MULTI_DATASETS)(
        'eq, $ne and missing-path reads agree on the %s counterexample dataset',
        async (_label, data) => {
          // Equality over the counterexample value: both mixed walks read 9.
          await runMultiReadCase(data, { [MULTI_NUMERIC_FIELD]: 9 }, ['c1', 'c2']);
          // The over-match counterexample: `$ne` must not see c1/c2 as
          // "missing" - with pushdown they would leak back in as hits.
          await runMultiReadCase(data, { [MULTI_NUMERIC_FIELD]: { $ne: 9 } }, ['c3', 'c4', 'c5']);
          // The 7-valued row resolves through the other container mix.
          await runMultiReadCase(data, { [MULTI_NUMERIC_FIELD]: 7 }, ['c3']);
          // Missing on both engines: neither path form resolves the shape.
          await runMultiReadCase(data, { [MULTI_NUMERIC_FIELD]: undefined }, ['c4', 'c5']);
        },
        60000
      );

      it('three-segment mixed walk (a.0.b.1) matches on both engines', async () => {
        // d1 reads through array -> object key, d2 through object -> array;
        // a single-branch pushdown would drop both.
        await runMultiReadCase(MULTI_DEEP_DATASET, { [MULTI_DEEP_FIELD]: 42 }, ['d1', 'd2']);
        await runMultiReadCase(MULTI_DEEP_DATASET, { [MULTI_DEEP_FIELD]: { $ne: 42 } }, ['d3']);
      }, 60000);

      it('remove by the counterexample path deletes the same rows on both engines', async () => {
        await seedNumericBoth(MULTI_MIXED_DATASET);

        const fsRemoved = await useNumericEngine('file-system', table =>
          remove<NumericRecord>(table, { where: { [MULTI_NUMERIC_FIELD]: 9 } })
        );
        const sqliteRemoved = await useNumericEngine('sqlite', table =>
          remove<NumericRecord>(table, { where: { [MULTI_NUMERIC_FIELD]: 9 } })
        );

        // Without the fallback sqlite skipped every mixed-shape record and
        // deleted 0 rows while file-system deleted both 9-valued rows.
        expect(fsRemoved).toBe(2);
        expect(sqliteRemoved).toBe(2);

        const remaining = ['r3', 'r4', 'r5'];
        const fsRest = await useNumericEngine('file-system', table => findMany<NumericRecord>(table));
        const sqliteRest = await useNumericEngine('sqlite', table => findMany<NumericRecord>(table));
        expect(idsOf(fsRest)).toEqual(remaining);
        expect(idsOf(sqliteRest)).toEqual(remaining);
      }, 60000);

      it('orders by the refused path identically on both engines (memory sort)', async () => {
        await seedNumericBoth(MULTI_MIXED_DATASET);

        const fsRows = await useNumericEngine('file-system', table =>
          findMany<NumericRecord>(table, { where: {}, sortBy: MULTI_NUMERIC_FIELD, order: 'asc' })
        );
        const sqliteRows = await useNumericEngine('sqlite', table =>
          findMany<NumericRecord>(table, { where: {}, sortBy: MULTI_NUMERIC_FIELD, order: 'asc' })
        );

        // 7 (r3, r4) < 9 (r1, r2), the missing path (r5) sorts last, ties
        // keep insertion order - both engines sort in memory now.
        expect(orderedIdsOf(fsRows)).toEqual(['r3', 'r4', 'r1', 'r2', 'r5']);
        expect(orderedIdsOf(sqliteRows)).toEqual(['r3', 'r4', 'r1', 'r2', 'r5']);
      }, 60000);
    });
  });
});
