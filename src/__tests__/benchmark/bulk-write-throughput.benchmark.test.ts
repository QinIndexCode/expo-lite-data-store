/**
 * Host-side bulk-write throughput regression gate for the file-system engine.
 *
 * Four scenarios, each with 1 warmup run (untimed) + 3 measured runs (median):
 * - plain-5000: bulkWrite of 5000 insert ops into a plaintext table
 * - field-encrypted-5000: same batch into an `{ encrypted, encryptedFields }` table
 * - full-encrypted-5000: same batch into an `{ encrypted, encryptFullTable }` table
 * - read-scan-5000: warm-cache findMany over a 5000-record plain table seeded once
 *   (DataReader cache hit after the warmup run — exercises facade policy, metadata,
 *   clone and record mapping, not disk I/O)
 *
 * Write scenarios delete and recreate the table before every run so every run
 * starts from an empty table. The suite emits a single `PERFGATE {json}` line
 * consumed by the CI performance gate (npm run test:perf-gate).
 */
import {
  bulkWrite,
  countTable,
  createTable,
  deleteTable,
  findMany,
  hasTable,
  init,
  insert,
} from '../../expo-lite-data-store';
import type {
  BulkOperation,
  CreateTableOptions,
  StorageRecord,
  TableOptions,
  WriteOptions,
} from '../../expo-lite-data-store';
import { configManager } from '../../core/config/ConfigManager';

jest.setTimeout(120000);

const BATCH_SIZE = 5000;
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 3;

// Floors sit ~3.6x below the slowest of three local calibration runs (2026-10-01,
// Node 22, in-memory expo-file-system mock; medians in ops/s — plain 478148-498733,
// field-encrypted 30436-32282, full-encrypted 187868-198817, read-scan 1807337-2147674).
// The margin absorbs CI-runner variance while still failing regressions beyond ~3.5x;
// finer-grained comparisons use the versioned A/B bench.
const MIN_OPS_PER_SEC: Record<string, number> = {
  'plain-5000': 130000,
  'field-encrypted-5000': 8000,
  'full-encrypted-5000': 50000,
  'read-scan-5000': 500000,
};

type TableScenario = {
  scenario: string;
  tableName: string;
  tableOptions: TableOptions;
};

type WriteScenario = TableScenario & {
  createOptions: CreateTableOptions;
  writeOptions: WriteOptions;
};

type ScenarioResult = {
  scenario: string;
  medianMs: number;
  medianOpsPerSec: number;
  runs: number[];
};

const PLAIN_SCENARIO: WriteScenario = {
  scenario: 'plain-5000',
  tableName: 'bench_bulk_plain',
  tableOptions: {},
  createOptions: {},
  writeOptions: {},
};

const FIELD_ENCRYPTED_SCENARIO: WriteScenario = {
  scenario: 'field-encrypted-5000',
  tableName: 'bench_bulk_field_encrypted',
  tableOptions: { encrypted: true },
  createOptions: { encrypted: true, encryptedFields: ['secret'] },
  writeOptions: { encrypted: true },
};

const FULL_ENCRYPTED_SCENARIO: WriteScenario = {
  scenario: 'full-encrypted-5000',
  tableName: 'bench_bulk_full_encrypted',
  tableOptions: { encrypted: true },
  createOptions: { encrypted: true, encryptFullTable: true },
  writeOptions: { encrypted: true },
};

const READ_SCENARIO: TableScenario = {
  scenario: 'read-scan-5000',
  tableName: 'bench_bulk_read_scan',
  tableOptions: {},
};

const WRITE_SCENARIOS: WriteScenario[] = [PLAIN_SCENARIO, FIELD_ENCRYPTED_SCENARIO, FULL_ENCRYPTED_SCENARIO];
const ALL_TABLES: TableScenario[] = [...WRITE_SCENARIOS, READ_SCENARIO];

const results: ScenarioResult[] = [];

const round = (value: number): number => Math.round(value * 100) / 100;

const buildRecords = (): StorageRecord[] =>
  Array.from({ length: BATCH_SIZE }, (_, index) => ({
    id: index + 1,
    label: 'bulk-write-gate',
    payload: `row-${index}`,
    secret: `secret-${index}`,
  }));

const buildOperations = (): BulkOperation[] => buildRecords().map(data => ({ type: 'insert', data }));

const measure = async <T>(operation: () => Promise<T>): Promise<{ durationMs: number; value: T }> => {
  const start = process.hrtime.bigint();
  const value = await operation();
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { durationMs, value };
};

const removeTable = async (tableName: string, tableOptions: TableOptions): Promise<void> => {
  if (await hasTable(tableName, tableOptions)) {
    await deleteTable(tableName, tableOptions);
  }
};

const summarize = (scenario: string, runs: number[]): ScenarioResult => {
  expect(runs).toHaveLength(MEASURED_RUNS);
  const sorted = [...runs].sort((left, right) => left - right);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const medianOpsPerSec = BATCH_SIZE / (medianMs / 1000);
  return {
    scenario,
    medianMs: round(medianMs),
    medianOpsPerSec: round(medianOpsPerSec),
    runs: runs.map(round),
  };
};

const expectThroughputFloor = (result: ScenarioResult): void => {
  const minOpsPerSec = MIN_OPS_PER_SEC[result.scenario];
  // Failure renders "Expected: >= <floor>, Received: <median>" under this scenario's test name.
  expect(result.medianOpsPerSec).toBeGreaterThanOrEqual(minOpsPerSec);
};

const runWriteScenario = async (spec: WriteScenario): Promise<ScenarioResult> => {
  const runs: number[] = [];

  for (let runIndex = 0; runIndex < WARMUP_RUNS + MEASURED_RUNS; runIndex += 1) {
    // Fresh table per run keeps every run comparable (identical empty starting state).
    await removeTable(spec.tableName, spec.tableOptions);
    await createTable(spec.tableName, spec.createOptions);

    const operations = buildOperations();
    const { durationMs, value } = await measure(() => bulkWrite(spec.tableName, operations, spec.writeOptions));
    expect(value.written).toBe(BATCH_SIZE);

    if (runIndex >= WARMUP_RUNS) {
      runs.push(durationMs);
    }
  }

  // The final batch must really land, and encrypted tables must round-trip through their own surface.
  await expect(countTable(spec.tableName, spec.tableOptions)).resolves.toBe(BATCH_SIZE);
  if (spec.tableOptions.encrypted === true) {
    const records = await findMany(spec.tableName, spec.tableOptions);
    expect(records).toHaveLength(BATCH_SIZE);
    expect(records.find(record => record.id === BATCH_SIZE)).toMatchObject({
      id: BATCH_SIZE,
      secret: `secret-${BATCH_SIZE - 1}`,
    });
  }

  return summarize(spec.scenario, runs);
};

const runReadScenario = async (spec: TableScenario): Promise<ScenarioResult> => {
  await removeTable(spec.tableName, spec.tableOptions);
  await createTable(spec.tableName);
  await insert(spec.tableName, buildRecords());
  await expect(countTable(spec.tableName, spec.tableOptions)).resolves.toBe(BATCH_SIZE);

  const runs: number[] = [];
  for (let runIndex = 0; runIndex < WARMUP_RUNS + MEASURED_RUNS; runIndex += 1) {
    const { durationMs, value } = await measure(() => findMany(spec.tableName));
    expect(value).toHaveLength(BATCH_SIZE);

    if (runIndex >= WARMUP_RUNS) {
      runs.push(durationMs);
    }
  }

  return summarize(spec.scenario, runs);
};

describe('bulk-write throughput gate (file-system engine)', () => {
  beforeAll(async () => {
    configManager.resetConfig();
    await init({ engine: 'file-system' });
  });

  afterEach(async () => {
    for (const { tableName, tableOptions } of ALL_TABLES) {
      try {
        await removeTable(tableName, tableOptions);
      } catch {
        // ignore
      }
    }
  });

  afterAll(() => {
    console.log('PERFGATE ' + JSON.stringify(results));
  });

  it('plain-5000 stays above the bulk-write throughput floor', async () => {
    const result = await runWriteScenario(PLAIN_SCENARIO);
    results.push(result);
    expectThroughputFloor(result);
  });

  it('field-encrypted-5000 stays above the bulk-write throughput floor', async () => {
    const result = await runWriteScenario(FIELD_ENCRYPTED_SCENARIO);
    results.push(result);
    expectThroughputFloor(result);
  });

  it('full-encrypted-5000 stays above the bulk-write throughput floor', async () => {
    const result = await runWriteScenario(FULL_ENCRYPTED_SCENARIO);
    results.push(result);
    expectThroughputFloor(result);
  });

  it('read-scan-5000 stays above the warm-cache read throughput floor', async () => {
    const result = await runReadScenario(READ_SCENARIO);
    results.push(result);
    expectThroughputFloor(result);
  });
});
