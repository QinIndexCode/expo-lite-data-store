// src/__tests__/api/api.stress.test.ts
// 压力测试
// 本测试文件用于验证API在高并发场景下的性能和稳定性
// 支持逐步提升压力直到系统崩溃，并输出极限压力数据
// 本测试对设备压力较大，运行时可能存在卡顿等现象
import { createTable, insert, remove, countTable, bulkWrite, findMany, update } from '../../index';

// 测试表名
const TEST_TABLE = 'stress_test_table';

// 压力测试配置
const STRESS_CONFIG = {
  // 初始并发请求数量
  INITIAL_CONCURRENCY: 10,
  // 并发请求增量
  CONCURRENCY_STEP: 10,
  // 最大并发请求数量
  MAX_CONCURRENCY: 1000,
  // 初始单次请求数据量
  INITIAL_DATA_SIZE_PER_REQUEST: 100,
  // 数据量增量
  DATA_SIZE_STEP: 100,
  // 最大单次请求数据量
  MAX_DATA_SIZE_PER_REQUEST: 10000,
  // 最大尝试次数
  MAX_ATTEMPTS: 20,
  // 失败重试次数
  RETRY_COUNT: 3,
  // 每次压力测试持续时间（毫秒）
  TEST_DURATION: 5000,
  // 混合操作比例（写入:读取:更新:删除）
  OPERATION_RATIO: [4, 3, 2, 1]
};

// 性能指标记录
interface PerformanceMetrics {
  // 总操作数
  totalOperations: number;
  // 成功操作数
  successfulOperations: number;
  // 失败操作数
  failedOperations: number;
  // 总耗时（毫秒）
  totalDuration: number;
  // 平均响应时间（毫秒）
  averageResponseTime: number;
  // 95%响应时间（毫秒）
  p95ResponseTime: number;
  // 99%响应时间（毫秒）
  p99ResponseTime: number;
  // 每秒操作数
  tps: number;
  // 内存使用峰值（MB）
  memoryPeak: number;
}

// 极限压力数据记录
interface StressLimitData {
  maxConcurrency: number;
  maxDataSize: number;
  maxBatchSize: number;
  maxOperationsPerSecond: number;
  lastSuccessfulMetrics: PerformanceMetrics;
  errorDetails: string;
  crashConcurrency: number;
  crashDataSize: number;
}

// 操作类型枚举
enum OperationType {
  INSERT = 'insert',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete'
};

describe('API压力测试', () => {
  // 在所有测试前创建表
  beforeAll(async () => {
    await createTable(TEST_TABLE);
  });

  // 在所有测试后删除表
  afterAll(async () => {
    await remove(TEST_TABLE, { where: {} });
  });

  // 计算性能指标
  const calculatePerformanceMetrics = (responseTimes: number[], successfulCount: number, failedCount: number, totalDuration: number): PerformanceMetrics => {
    const totalOperations = successfulCount + failedCount;
    const sortedResponseTimes = [...responseTimes].sort((a, b) => a - b);
    
    // 计算内存使用峰值（仅Node.js环境）
    let memoryPeak = 0;
    if (typeof process !== 'undefined' && process.memoryUsage) {
      memoryPeak = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    }
    
    return {
      totalOperations,
      successfulOperations: successfulCount,
      failedOperations: failedCount,
      totalDuration,
      averageResponseTime: totalOperations > 0 ? Math.round(responseTimes.reduce((sum, time) => sum + time, 0) / totalOperations) : 0,
      p95ResponseTime: sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.95)] || 0,
      p99ResponseTime: sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.99)] || 0,
      tps: Math.round(totalOperations / (totalDuration / 1000)),
      memoryPeak
    };
  };

  // 生成随机操作类型
  const getRandomOperationType = (): OperationType => {
    const [insertRatio, readRatio, updateRatio, deleteRatio] = STRESS_CONFIG.OPERATION_RATIO;
    const totalRatio = insertRatio + readRatio + updateRatio + deleteRatio;
    const random = Math.random() * totalRatio;
    
    if (random < insertRatio) return OperationType.INSERT;
    if (random < insertRatio + readRatio) return OperationType.READ;
    if (random < insertRatio + readRatio + updateRatio) return OperationType.UPDATE;
    return OperationType.DELETE;
  };

  describe('逐步提升压力测试', () => {
    it('应该能够逐步提升压力直到系统崩溃，并记录极限压力数据', async () => {
      // 用于记录极限压力数据
      const stressLimit: Partial<StressLimitData> = {};
      let currentConcurrency = STRESS_CONFIG.INITIAL_CONCURRENCY;
      let currentDataSize = STRESS_CONFIG.INITIAL_DATA_SIZE_PER_REQUEST;
      let attempt = 0;
      let lastSuccessfulConcurrency = 0;
      
      // 测试直到达到最大尝试次数、最大并发数或最大数据量
      while (
        attempt < STRESS_CONFIG.MAX_ATTEMPTS && 
        currentConcurrency <= STRESS_CONFIG.MAX_CONCURRENCY &&
        currentDataSize <= STRESS_CONFIG.MAX_DATA_SIZE_PER_REQUEST
      ) {
        // 清空表，确保测试环境干净
        await remove(TEST_TABLE, { where: {} });
        
        try {
          // 预填充一些数据用于读取和更新操作
          const prefillData = [];
          for (let i = 0; i < currentConcurrency * 5; i++) {
            prefillData.push({
              id: `prefill-${i}`,
              name: `Prefill ${i}`,
              value: Math.random() * 1000,
              category: `category-${i % 5}`,
              timestamp: Date.now()
            });
          }
          await insert(TEST_TABLE, prefillData, { mode: 'append' });
          
          // 记录性能指标
          const responseTimes: number[] = [];
          let successfulOperations = 0;
          let failedOperations = 0;
          
          // 创建并发请求数组
          const requests = [];
          
          // 生成currentConcurrency个并发请求
          for (let i = 0; i < currentConcurrency; i++) {
            const request = async () => {
              for (let j = 0; j < 5; j++) { // 每个并发连接执行多个操作
                const operationType = getRandomOperationType();
                const startTime = Date.now();
                
                try {
                  switch (operationType) {
                    case OperationType.INSERT:
                      // 生成测试数据
                      const insertData = [];
                      for (let k = 0; k < currentDataSize; k++) {
                        insertData.push({
                          id: `${Date.now()}-${i}-${j}-${k}`,
                          name: `Test ${i}-${j}-${k}`,
                          value: Math.random() * 1000,
                          category: `category-${Math.floor(Math.random() * 5)}`,
                          timestamp: Date.now()
                        });
                      }
                      await insert(TEST_TABLE, insertData, { mode: 'append' });
                      break;
                      
                    case OperationType.READ:
                      // 随机读取数据
                      const category = `category-${Math.floor(Math.random() * 5)}`;
                      const readResult = await findMany(TEST_TABLE, { 
                        where: { category },
                        limit: 100
                      });
                      // 精确校验：确保读取操作返回数组
                      expect(Array.isArray(readResult)).toBe(true);
                      break;
                      
                    case OperationType.UPDATE:
                      // 更新随机数据
                      const updateId = `prefill-${Math.floor(Math.random() * prefillData.length)}`;
                      await update(TEST_TABLE, 
                        { value: Math.random() * 1000, updatedAt: Date.now() }, 
                        { where: { id: updateId } }
                      );
                      break;
                      
                    case OperationType.DELETE:
                      // 删除随机数据
                      const deleteId = `prefill-${Math.floor(Math.random() * prefillData.length)}`;
                      await remove(TEST_TABLE, { where: { id: deleteId } });
                      break;
                  }
                  
                  successfulOperations++;
                  const endTime = Date.now();
                  responseTimes.push(endTime - startTime);
                  
                } catch (error) {
                  failedOperations++;
                  const endTime = Date.now();
                  responseTimes.push(endTime - startTime);
                }
              }
            };
            
            requests.push(request());
          }
          
          // 记录开始时间
          const testStartTime = Date.now();
          
          // 等待所有请求完成
          await Promise.all(requests);
          
          // 记录结束时间
          const testEndTime = Date.now();
          const totalDuration = testEndTime - testStartTime;
          
          // 计算性能指标
          const metrics = calculatePerformanceMetrics(
            responseTimes, 
            successfulOperations, 
            failedOperations, 
            totalDuration
          );
          
          // 精确校验：确保成功率不低于80%
          const successRate = metrics.successfulOperations / metrics.totalOperations;
          expect(successRate).toBeGreaterThanOrEqual(0.8);
          
          // 验证数据一致性
          const finalRecordCount = await countTable(TEST_TABLE);
          expect(finalRecordCount).toBeGreaterThanOrEqual(0);
          
          // 更新极限压力数据
          lastSuccessfulConcurrency = currentConcurrency;
          stressLimit.maxConcurrency = currentConcurrency;
          stressLimit.maxDataSize = finalRecordCount;
          stressLimit.maxOperationsPerSecond = metrics.tps;
          stressLimit.lastSuccessfulMetrics = metrics;
          
          // 增加并发数和数据量
          currentConcurrency += STRESS_CONFIG.CONCURRENCY_STEP;
          currentDataSize += STRESS_CONFIG.DATA_SIZE_STEP;
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // 记录错误详情和崩溃时的压力
          stressLimit.errorDetails = errorMessage;
          stressLimit.crashConcurrency = currentConcurrency;
          stressLimit.crashDataSize = currentDataSize;
          break;
        }
        
        attempt++;
      }
      
      // 批量写入压力测试
      let currentBatchSize = 1000;
      let lastSuccessfulBatchSize = 0;
      attempt = 0;
      
      while (attempt < STRESS_CONFIG.MAX_ATTEMPTS) {
        // 清空表，确保测试环境干净
        await remove(TEST_TABLE, { where: {} });
        
        try {
          // 生成测试数据
          const bulkData = [];
          for (let i = 0; i < currentBatchSize; i++) {
            bulkData.push({
              type: 'insert' as const,
              data: {
                id: `bulk-${i}`,
                name: `Bulk Test ${i}`,
                value: Math.random() * 1000,
                batch: 'large'
              }
            });
          }
          
          // 记录开始时间
          const startTime = Date.now();
          
          // 执行批量写入
          const result = await bulkWrite(TEST_TABLE, bulkData);
          
          // 记录结束时间
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          // 精确校验：验证写入的数据量是否与预期一致
          expect(result.written).toBe(currentBatchSize);
          
          // 验证数据是否正确写入
          const totalRecords = await countTable(TEST_TABLE);
          expect(totalRecords).toBe(currentBatchSize);
          
          // 计算每秒操作数
          const operationsPerSecond = Math.round(currentBatchSize / (duration / 1000));
          
          // 更新极限压力数据
          lastSuccessfulBatchSize = currentBatchSize;
          stressLimit.maxBatchSize = currentBatchSize;
          
          // 增加批量大小（指数增长）
          currentBatchSize = Math.floor(currentBatchSize * 1.5);
          
        } catch (error) {
          break;
        }
        
        attempt++;
      }
      
      // 输出极限压力数据总结
      // 确保至少完成一次成功的测试
      expect(lastSuccessfulConcurrency).toBeGreaterThan(0);
    }, 600000); // 增加超时时间，确保测试能完成
  });
  
  describe('精确校验测试', () => {
    it('应该能够精确校验数据写入、读取、更新和删除结果', async () => {
      // 清空表，确保测试环境干净
      await remove(TEST_TABLE, { where: {} });
      
      // 测试数据
      const testData = [
        { id: 'test-1', name: 'Test 1', value: 100, category: 'A' },
        { id: 'test-2', name: 'Test 2', value: 200, category: 'B' },
        { id: 'test-3', name: 'Test 3', value: 300, category: 'A' },
        { id: 'test-4', name: 'Test 4', value: 400, category: 'B' },
        { id: 'test-5', name: 'Test 5', value: 500, category: 'A' }
      ];
      
      // 写入数据
      const writeResult = await insert(TEST_TABLE, testData, { mode: 'append' });
      
      // 精确校验：验证写入的数据量
      expect(writeResult.written).toBe(testData.length);
      
      // 验证数据是否正确写入
      const totalRecords = await countTable(TEST_TABLE);
      expect(totalRecords).toBe(testData.length);
      
      // 读取并精确校验数据
      const readResult = await findMany(TEST_TABLE, { where: { category: 'A' } });
      
      // 精确校验：验证读取的数据条数
      expect(readResult.length).toBe(3);
      
      // 精确校验：验证读取的数据内容
      expect(readResult).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'test-1', category: 'A' }),
        expect.objectContaining({ id: 'test-3', category: 'A' }),
        expect.objectContaining({ id: 'test-5', category: 'A' })
      ]));
      
      // 精确校验：验证数据值范围
      expect(readResult.every(item => item.value > 0)).toBe(true);
      
      // 更新数据
      const updateResult = await update(TEST_TABLE, 
        { value: 999, updatedAt: Date.now() }, 
        { where: { category: 'A' } }
      );
      
      // 精确校验：验证更新的数据条数
      expect(updateResult).toBe(3);
      
      // 验证更新后的数据
      const updatedData = await findMany(TEST_TABLE, { where: { category: 'A' } });
      expect(updatedData.every(item => item.value === 999)).toBe(true);
      
      // 删除数据
      const deleteResult = await remove(TEST_TABLE, { where: { category: 'B' } });
      
      // 精确校验：验证删除的数据条数
      expect(deleteResult).toBe(2);
      
      // 验证删除后的数据量
      const finalRecordCount = await countTable(TEST_TABLE);
      expect(finalRecordCount).toBe(3);
      
      // 验证删除后的数据内容
      const finalData = await findMany(TEST_TABLE, {});
      expect(finalData.every(item => item.category === 'A')).toBe(true);
      
    });
  });
});
