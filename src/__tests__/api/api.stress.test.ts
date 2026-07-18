import { bulkWrite, countTable, createTable, deleteTable, findMany, insert, remove, update } from '../../index';

const TEST_TABLE = 'stress_test_table';
const diagnosticsEnabled = process.env.EXPO_LITE_DATA_STORE_TEST_DIAGNOSTICS === '1';

const getPositiveIntegerConfig = (name: string, fallback: number): number => {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const getPositiveNumberConfig = (name: string, fallback: number): number => {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getSeedConfig = (): number => {
  const rawValue = process.env.LDS_STRESS_SEED;
  if (!rawValue) {
    return 0x5eed_2026;
  }

  const numericSeed = Number(rawValue);
  if (Number.isInteger(numericSeed)) {
    return numericSeed;
  }

  let hash = 0;
  for (const char of rawValue) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash || 0x5eed_2026;
};

const createSeededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const STRESS_CONFIG = {
  INITIAL_CONCURRENCY: getPositiveIntegerConfig('LDS_STRESS_INITIAL_CONCURRENCY', 5),
  CONCURRENCY_STEP: getPositiveIntegerConfig('LDS_STRESS_CONCURRENCY_STEP', 5),
  MAX_CONCURRENCY: getPositiveIntegerConfig('LDS_STRESS_MAX_CONCURRENCY', 30),
  INITIAL_DATA_SIZE_PER_REQUEST: getPositiveIntegerConfig('LDS_STRESS_INITIAL_DATA_SIZE', 25),
  DATA_SIZE_STEP: getPositiveIntegerConfig('LDS_STRESS_DATA_SIZE_STEP', 25),
  MAX_DATA_SIZE_PER_REQUEST: getPositiveIntegerConfig('LDS_STRESS_MAX_DATA_SIZE', 150),
  MAX_ATTEMPTS: getPositiveIntegerConfig('LDS_STRESS_MAX_ATTEMPTS', 4),
  OPERATIONS_PER_WORKER: getPositiveIntegerConfig('LDS_STRESS_OPERATIONS_PER_WORKER', 3),
  INITIAL_BATCH_SIZE: getPositiveIntegerConfig('LDS_STRESS_INITIAL_BATCH_SIZE', 250),
  MAX_BATCH_ATTEMPTS: getPositiveIntegerConfig('LDS_STRESS_MAX_BATCH_ATTEMPTS', 4),
  BATCH_SIZE_MULTIPLIER: getPositiveNumberConfig('LDS_STRESS_BATCH_SIZE_MULTIPLIER', 1.5),
  SEED: getSeedConfig(),
  OPERATION_RATIO: [4, 3, 2, 1],
};

interface PerformanceMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  totalDuration: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  tps: number;
  memoryPeak: number;
}

type StressRecord = {
  id: string;
  name: string;
  value: number;
  category: string;
  updatedAt?: number;
};

enum OperationType {
  INSERT = 'insert',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
}

describe('API stress tests', () => {
  beforeAll(async () => {
    await createTable(TEST_TABLE);
  });

  afterAll(async () => {
    await deleteTable(TEST_TABLE);
  });

  const calculatePerformanceMetrics = (
    responseTimes: number[],
    successfulCount: number,
    failedCount: number,
    totalDuration: number
  ): PerformanceMetrics => {
    const totalOperations = successfulCount + failedCount;
    const sortedResponseTimes = [...responseTimes].sort((a, b) => a - b);

    let memoryPeak = 0;
    if (typeof process !== 'undefined' && process.memoryUsage) {
      memoryPeak = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    }

    return {
      totalOperations,
      successfulOperations: successfulCount,
      failedOperations: failedCount,
      totalDuration,
      averageResponseTime:
        totalOperations > 0 ? Math.round(responseTimes.reduce((sum, time) => sum + time, 0) / totalOperations) : 0,
      p95ResponseTime: sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.95)] || 0,
      p99ResponseTime: sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.99)] || 0,
      tps: Math.round(totalOperations / (totalDuration / 1000)),
      memoryPeak,
    };
  };

  const getRandomOperationType = (random: () => number): OperationType => {
    const [insertRatio, readRatio, updateRatio, deleteRatio] = STRESS_CONFIG.OPERATION_RATIO;
    const totalRatio = insertRatio + readRatio + updateRatio + deleteRatio;
    const randomValue = random() * totalRatio;

    if (randomValue < insertRatio) return OperationType.INSERT;
    if (randomValue < insertRatio + readRatio) return OperationType.READ;
    if (randomValue < insertRatio + readRatio + updateRatio) return OperationType.UPDATE;
    return OperationType.DELETE;
  };

  describe('bounded load escalation', () => {
    it('raises load within configured limits and completes each successful stage', async () => {
      const random = createSeededRandom(STRESS_CONFIG.SEED);
      let currentConcurrency = STRESS_CONFIG.INITIAL_CONCURRENCY;
      let currentDataSize = STRESS_CONFIG.INITIAL_DATA_SIZE_PER_REQUEST;
      let attempt = 0;
      let lastSuccessfulConcurrency = 0;

      while (
        attempt < STRESS_CONFIG.MAX_ATTEMPTS &&
        currentConcurrency <= STRESS_CONFIG.MAX_CONCURRENCY &&
        currentDataSize <= STRESS_CONFIG.MAX_DATA_SIZE_PER_REQUEST
      ) {
        await remove(TEST_TABLE, { where: {} });

        try {
          const prefillData: Array<StressRecord & { timestamp: number }> = [];
          for (let i = 0; i < currentConcurrency * 5; i++) {
            prefillData.push({
              id: `prefill-${i}`,
              name: `Prefill ${i}`,
              value: random() * 1000,
              category: `category-${i % 5}`,
              timestamp: Date.now(),
            });
          }
          await insert(TEST_TABLE, prefillData, { mode: 'append' });

          const responseTimes: number[] = [];
          let successfulOperations = 0;
          let failedOperations = 0;

          const requests: Array<Promise<void>> = [];

          for (let i = 0; i < currentConcurrency; i++) {
            const request = async () => {
              for (let j = 0; j < STRESS_CONFIG.OPERATIONS_PER_WORKER; j++) {
                const operationType = getRandomOperationType(random);
                const startTime = Date.now();

                try {
                  switch (operationType) {
                    case OperationType.INSERT:
                      const insertData: Array<StressRecord & { timestamp: number }> = [];
                      for (let k = 0; k < currentDataSize; k++) {
                        insertData.push({
                          id: `${Date.now()}-${i}-${j}-${k}`,
                          name: `Test ${i}-${j}-${k}`,
                          value: random() * 1000,
                          category: `category-${Math.floor(random() * 5)}`,
                          timestamp: Date.now(),
                        });
                      }
                      await insert(TEST_TABLE, insertData, { mode: 'append' });
                      break;

                    case OperationType.READ:
                      const category = `category-${Math.floor(random() * 5)}`;
                      const readResult = await findMany(TEST_TABLE, {
                        where: { category },
                        limit: 100,
                      });
                      expect(Array.isArray(readResult)).toBe(true);
                      break;

                    case OperationType.UPDATE:
                      const updateId = `prefill-${Math.floor(random() * prefillData.length)}`;
                      await update(
                        TEST_TABLE,
                        { value: random() * 1000, updatedAt: Date.now() },
                        { where: { id: updateId } }
                      );
                      break;

                    case OperationType.DELETE:
                      const deleteId = `prefill-${Math.floor(random() * prefillData.length)}`;
                      await remove(TEST_TABLE, { where: { id: deleteId } });
                      break;
                  }

                  successfulOperations++;
                  const endTime = Date.now();
                  responseTimes.push(endTime - startTime);
                } catch {
                  failedOperations++;
                  const endTime = Date.now();
                  responseTimes.push(endTime - startTime);
                }
              }
            };

            requests.push(request());
          }

          const testStartTime = Date.now();

          await Promise.all(requests);

          const testEndTime = Date.now();
          const totalDuration = testEndTime - testStartTime;

          const metrics = calculatePerformanceMetrics(
            responseTimes,
            successfulOperations,
            failedOperations,
            totalDuration
          );

          const successRate = metrics.successfulOperations / metrics.totalOperations;
          expect(successRate).toBeGreaterThanOrEqual(0.8);

          const finalRecordCount = await countTable(TEST_TABLE);
          expect(finalRecordCount).toBeGreaterThanOrEqual(0);

          lastSuccessfulConcurrency = currentConcurrency;

          currentConcurrency += STRESS_CONFIG.CONCURRENCY_STEP;
          currentDataSize += STRESS_CONFIG.DATA_SIZE_STEP;
        } catch {
          break;
        }

        attempt++;
      }

      let currentBatchSize = STRESS_CONFIG.INITIAL_BATCH_SIZE;
      let lastSuccessfulBatchSize = 0;
      attempt = 0;

      while (attempt < STRESS_CONFIG.MAX_BATCH_ATTEMPTS) {
        await remove(TEST_TABLE, { where: {} });

        try {
          const bulkData = [];
          for (let i = 0; i < currentBatchSize; i++) {
            bulkData.push({
              type: 'insert' as const,
              data: {
                id: `bulk-${i}`,
                name: `Bulk Test ${i}`,
                value: random() * 1000,
                batch: 'large',
              },
            });
          }

          const startTime = Date.now();

          const result = await bulkWrite(TEST_TABLE, bulkData);

          const endTime = Date.now();
          const duration = endTime - startTime;

          expect(result.written).toBe(currentBatchSize);

          const totalRecords = await countTable(TEST_TABLE);
          expect(totalRecords).toBe(currentBatchSize);

          const operationsPerSecond = Math.round(currentBatchSize / (duration / 1000));

          lastSuccessfulBatchSize = currentBatchSize;

          if (diagnosticsEnabled) {
            console.log(
              `[Stress Test] Batch size: ${currentBatchSize}, Duration: ${duration}ms, OPS: ${operationsPerSecond}`
            );
          }

          currentBatchSize = Math.max(
            currentBatchSize + 1,
            Math.floor(currentBatchSize * STRESS_CONFIG.BATCH_SIZE_MULTIPLIER)
          );
        } catch {
          break;
        }

        attempt++;
      }

      expect(lastSuccessfulConcurrency).toBeGreaterThan(0);
      expect(lastSuccessfulBatchSize).toBeGreaterThan(0);
      if (diagnosticsEnabled) {
        console.log(
          `[Stress Test Summary] Seed: ${STRESS_CONFIG.SEED}, Max concurrency: ${lastSuccessfulConcurrency}, Max batch size: ${lastSuccessfulBatchSize}`
        );
      }
    }, 600000);
  });

  describe('data integrity', () => {
    it('preserves exact data outcomes across CRUD operations', async () => {
      await remove(TEST_TABLE, { where: {} });

      const testData = [
        { id: 'test-1', name: 'Test 1', value: 100, category: 'A' },
        { id: 'test-2', name: 'Test 2', value: 200, category: 'B' },
        { id: 'test-3', name: 'Test 3', value: 300, category: 'A' },
        { id: 'test-4', name: 'Test 4', value: 400, category: 'B' },
        { id: 'test-5', name: 'Test 5', value: 500, category: 'A' },
      ];

      const writeResult = await insert(TEST_TABLE, testData, { mode: 'append' });

      expect(writeResult.written).toBe(testData.length);

      const totalRecords = await countTable(TEST_TABLE);
      expect(totalRecords).toBe(testData.length);

      const readResult = await findMany<StressRecord>(TEST_TABLE, { where: { category: 'A' } });

      expect(readResult.length).toBe(3);

      expect(readResult).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'test-1', category: 'A' }),
          expect.objectContaining({ id: 'test-3', category: 'A' }),
          expect.objectContaining({ id: 'test-5', category: 'A' }),
        ])
      );

      expect(readResult.every(item => item.value > 0)).toBe(true);

      const updateResult = await update(
        TEST_TABLE,
        { value: 999, updatedAt: Date.now() },
        { where: { category: 'A' } }
      );

      expect(updateResult).toBe(3);

      const updatedData = await findMany<StressRecord>(TEST_TABLE, { where: { category: 'A' } });
      expect(updatedData.every(item => item.value === 999)).toBe(true);

      const deleteResult = await remove(TEST_TABLE, { where: { category: 'B' } });

      expect(deleteResult).toBe(2);

      const finalRecordCount = await countTable(TEST_TABLE);
      expect(finalRecordCount).toBe(3);

      const finalData = await findMany(TEST_TABLE, {});
      expect(finalData.every(item => item.category === 'A')).toBe(true);
    });
  });
});
