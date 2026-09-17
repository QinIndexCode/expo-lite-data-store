import { init, createTable, insert, findOne, findMany, deleteTable, hasTable } from '../../expo-lite-data-store';
import { configManager } from '../../core/config/ConfigManager';

/**
 * Benchmark comparing SQLite Pushdown Query performance vs FileSystem storage.
 * Evaluates:
 * 1. findOne by indexed key (Pushdown LIMIT 1 vs scan)
 * 2. findMany with WHERE + ORDER BY + LIMIT/OFFSET pushdown
 * 3. On-demand pagination latency
 *
 * Run with: npm run test:performance
 */
describe('SQLite Pushdown Query Benchmark', () => {
  const BENCHMARK_TABLE = 'bench_pushdown_table';
  const RECORD_COUNT = 2000;

  const dataset = Array.from({ length: RECORD_COUNT }, (_, i) => ({
    id: `item-${i + 1}`,
    sku: `SKU-${String(i + 1).padStart(6, '0')}`,
    category: ['Electronics', 'Books', 'Home', 'Clothing'][i % 4],
    price: (i % 100) * 10 + 5,
    stock: i * 2,
    active: i % 3 === 0,
    tags: [`tag-${i % 10}`, `group-${i % 5}`],
    metadata: {
      rating: (i % 5) + 1,
      reviewsCount: i * 3,
    },
  }));

  afterEach(async () => {
    try {
      if (await hasTable(BENCHMARK_TABLE)) {
        await deleteTable(BENCHMARK_TABLE);
      }
    } catch {
      // ignore
    }
  });

  it('compares FileSystem vs SQLite pushdown query and pagination performance', async () => {
    // 1. Benchmark on FileSystem
    configManager.resetConfig();
    await init({ engine: 'file-system' });
    if (await hasTable(BENCHMARK_TABLE)) {
      await deleteTable(BENCHMARK_TABLE);
    }
    await createTable(BENCHMARK_TABLE);

    const fsInsertStart = Date.now();
    await insert(BENCHMARK_TABLE, dataset);
    const fsInsertDuration = Date.now() - fsInsertStart;

    // FS findOne
    const fsFindOneStart = Date.now();
    const fsFoundOne = await findOne<{ id: string; sku: string }>(BENCHMARK_TABLE, {
      where: { sku: 'SKU-001500' },
    });
    const fsFindOneDuration = Date.now() - fsFindOneStart;
    expect(fsFoundOne).toBeDefined();

    // FS findMany (filtered, sorted, paginated)
    const fsFindManyStart = Date.now();
    const fsFoundMany = await findMany<{ id: string; sku: string; price: number }>(BENCHMARK_TABLE, {
      where: {
        category: 'Electronics',
        price: { $gt: 200 },
      },
      sortBy: 'price',
      order: 'desc',
      skip: 0,
      limit: 20,
    });
    const fsFindManyDuration = Date.now() - fsFindManyStart;
    expect(fsFoundMany).toHaveLength(20);

    // 2. Benchmark on SQLite with expression indexes
    configManager.resetConfig();
    await init({ engine: 'sqlite' });
    if (await hasTable(BENCHMARK_TABLE)) {
      await deleteTable(BENCHMARK_TABLE);
    }
    await createTable(BENCHMARK_TABLE, {
      indexes: ['sku', 'category', 'price'],
    });

    const sqliteInsertStart = Date.now();
    await insert(BENCHMARK_TABLE, dataset);
    const sqliteInsertDuration = Date.now() - sqliteInsertStart;

    // SQLite findOne pushdown
    const sqliteFindOneStart = Date.now();
    const sqliteFoundOne = await findOne<{ id: string; sku: string }>(BENCHMARK_TABLE, {
      where: { sku: 'SKU-001500' },
    });
    const sqliteFindOneDuration = Date.now() - sqliteFindOneStart;
    expect(sqliteFoundOne).toBeDefined();

    // SQLite findMany pushdown (filtered, sorted, paginated in SQL)
    const sqliteFindManyStart = Date.now();
    const sqliteFoundMany = await findMany<{ id: string; sku: string; price: number }>(BENCHMARK_TABLE, {
      where: {
        category: 'Electronics',
        price: { $gt: 200 },
      },
      sortBy: 'price',
      order: 'desc',
      skip: 0,
      limit: 20,
    });
    const sqliteFindManyDuration = Date.now() - sqliteFindManyStart;
    expect(sqliteFoundMany).toHaveLength(20);

    // Verify consistency between engines
    expect(sqliteFoundMany[0].sku).toBe(fsFoundMany[0].sku);
    expect(sqliteFoundMany[0].price).toBe(fsFoundMany[0].price);

    // Output benchmark report
    console.log('\n================ SQLite vs FileSystem Pushdown Benchmark ================');
    console.log(`Dataset size: ${RECORD_COUNT} records`);
    console.log(`[Insert]   FileSystem: ${fsInsertDuration}ms | SQLite: ${sqliteInsertDuration}ms`);
    console.log(`[findOne]  FileSystem: ${fsFindOneDuration}ms | SQLite (pushdown): ${sqliteFindOneDuration}ms`);
    console.log(`[findMany] FileSystem: ${fsFindManyDuration}ms | SQLite (pushdown): ${sqliteFindManyDuration}ms`);
    console.log('=========================================================================\n');

    expect(sqliteFindOneDuration).toBeLessThan(1000);
    expect(sqliteFindManyDuration).toBeLessThan(2000);
  }, 120000);
});
