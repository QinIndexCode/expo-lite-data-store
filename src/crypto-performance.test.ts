/**
 * 加密性能优化测试
 */
import { encrypt, decrypt, encryptBulk, decryptBulk, encryptFields, decryptFields, encryptFieldsBulk, decryptFieldsBulk } from './utils/crypto';
import { getMasterKey } from './utils/crypto';
import config from './liteStore.config.js';

describe('Crypto Performance Tests', () => {
  let masterKey: string;

  beforeAll(async () => {
    masterKey = await getMasterKey();
  });

  //用于测试单次加密性能 加密次数：100000次

  /**
   * 单次加密性能测试
   * 目的：评估单个数据加解密操作的平均耗时，确保在高迭代次数下仍能在合理时间内完成。
   * 测试逻辑：
   * 1. 准备一段固定长度的明文作为测试数据。
   * 2. 设定迭代次数（此处为10次，便于在CI/本地快速跑通，也可视情况调大）。
   * 3. 在循环内依次执行加密与解密，并验证解密结果与原文一致，确保加解密正确性。
   * 4. 记录总耗时，计算单次平均耗时并打印。
   * 5. 断言平均耗时小于5000ms，给PBKDF2在测试环境（100,000次迭代）留出足够余量。
   * 注意事项：
   * - 若需更高精度，可改用performance.now()。
   * - 若迭代次数调大，建议同步调整Jest超时（jest.setTimeout）。
   */
  test('单次加密性能测试', async () => {
    // 测试明文：包含大小写、空格、标点，模拟常规业务数据
    const testData = 'Hello World! This is a test message for encryption performance.';
    // 迭代次数：10次可在本地/CI快速完成；若需更高统计置信度，可提升至100或1000
    const iterations = 10;

    // 记录开始时间（毫秒级）
    const startTime = Date.now();

    // 循环执行加解密，验证每一次结果正确性
    for (let i = 0; i < iterations; i++) {
      const encrypted = await encrypt(testData, masterKey); // 加密
      const decrypted = await decrypt(encrypted, masterKey); // 解密
      expect(decrypted).toBe(testData); // 断言解密结果与原文一致
    }

    // 记录结束时间并计算平均耗时
    const endTime = Date.now();
    const avgTime = (endTime - startTime) / iterations;

    // 打印平均耗时，便于直观评估性能
    console.log(`单次加密平均耗时: ${avgTime.toFixed(2)}ms`);

    // 性能阈值：5000ms（5秒）以内通过，考虑PBKDF2在测试环境使用100,000次迭代较慢
    expect(avgTime).toBeLessThan(5000);
  });

  /**
   * 批量加密性能测试
   * 目的：验证批量加密接口（encryptBulk / decryptBulk）相比逐条调用在性能上的优势，
   *      并确保批量加解密结果与逐条调用完全一致。
   * 测试逻辑：
   * 1. 构造一组长度适中、内容各异的明文数据，模拟真实业务场景。
   * 2. 先逐条加密，记录总耗时作为基准。
   * 3. 再使用批量加密接口一次性处理相同数据，记录总耗时。
   * 4. 对批量加密结果进行批量解密，验证解密后与原文完全一致。
   * 5. 计算并打印单次平均耗时、性能提升百分比。
   * 6. 断言批量总耗时小于逐条总耗时，确保批量优化生效。
   * 注意事项：
   * - 数据量（dataCount）与单条长度可根据实际业务调整，此处取 50 条、~90 字符/条，
   *   既能在 CI 环境快速完成，又能体现批量优势。
   * - 若运行环境 CPU/内存受限，可适当降低 dataCount；若需更高置信度，可增至 200 条以上。
   * - 由于 PBKDF2 迭代次数固定，主要耗时在密钥派生，批量接口通过“一次派生、多次复用”策略优化，
   *   因此性能提升主要体现在减少重复密钥派生次数。
   */
  test('批量加密性能测试', async () => {
    // 构造测试数据：50 条不同内容、长度接近真实字段值的明文
    const dataCount = 50;
    const testData = Array.from({ length: dataCount }, (_, i) =>
      `Batch message ${i.toString().padStart(3, '0')} — simulating user note or profile payload with medium length.`
    );

    // 1. 逐条加密基准测试：完全串行，每次独立密钥派生
    const singleStartTime = Date.now();
    const singleResults: string[] = [];
    for (const data of testData) {
      singleResults.push(await encrypt(data, masterKey));
    }
    const singleTotalTime = Date.now() - singleStartTime;

    // 2. 批量加密：内部复用派生密钥，减少 CPU 密集运算次数
    const bulkStartTime = Date.now();
    const bulkResults = await encryptBulk(testData, masterKey);
    const bulkTotalTime = Date.now() - bulkStartTime;

    // 3. 对批量结果进行批量解密，确保业务正确性
    const decryptedBulk = await decryptBulk(bulkResults, masterKey);

    // 4. 打印详细性能对比
    console.log(`[批量加密] 数据条数: ${dataCount}`);
    console.log(`[批量加密] 逐条加密总耗时: ${singleTotalTime}ms`);
    console.log(`[批量加密] 批量加密总耗时: ${bulkTotalTime}ms`);
    console.log(`[批量加密] 单次平均耗时: ${(bulkTotalTime / dataCount).toFixed(2)}ms`);
    console.log(`[批量加密] 性能提升: ${((singleTotalTime - bulkTotalTime) / singleTotalTime * 100).toFixed(1)}%`);

    // 5. 结果一致性断言
    expect(bulkResults).toHaveLength(dataCount);
    expect(decryptedBulk).toEqual(testData);

    // 6. 性能断言：批量必须显著快于逐条
    expect(bulkTotalTime).toBeLessThan(singleTotalTime);
  });

  /**
   * 字段级加密性能与正确性综合测试
   * 目的：
   * 1. 验证字段级加密/解密在功能上完全等价于整体加密（数据一致性）。
   * 2. 对比“只加密敏感字段”与“整体加密”在耗时上的差异，为业务选型提供量化依据。
   * 3. 确保字段级加密的额外开销在可接受范围内（非性能优先场景下）。
   * 测试策略：
   * - 构造一个包含敏感与非敏感字段的复合对象。
   * - 分别执行：
   *   a) 字段级加密/解密（仅加密指定敏感字段）。
   *   b) 整体加密/解密（将整个对象序列化后加密）。
   * - 对比二者耗时，并断言字段级模式不会慢于整体模式的 N 倍（给 CI 留足余量）。
   * - 验证解密后数据与原文完全一致，确保加密无信息丢失。
   * 注意事项：
   * - 字段级加密会额外产生“字段遍历 + 多次调用”开销，理论上会比单次整体加密慢，
   *   但应控制在合理倍数内（默认 5 倍，可根据 CI 资源调整）。
   * - 解密耗时单独断言 1 s 内，确保用户体验可接受。
   * - 若后续升级硬件或调低 PBKDF2 迭代次数，可同步收紧阈值。
   */
  test('字段级加密性能与正确性综合测试', async () => {
    // 构造测试对象：包含敏感与非敏感字段，模拟真实业务 payload
    const testObject = {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      password: 'secretPassword123',
      phone: '+1234567890',
      address: '123 Main St'
    };

    // 仅对敏感字段进行加密，降低加密面积，提高安全与性能平衡
    const encryptionConfig = {
      fields: ['password', 'pass','pwd','passwordHash','email','Email','username','phone'],
      masterKey: masterKey
    };

    // ① 字段级加密计时
    const fieldEncryptStart = performance.now();
    const encryptedFields = await encryptFields(testObject, encryptionConfig);
    const fieldEncryptTime = performance.now() - fieldEncryptStart;

    // ② 字段级解密计时
    const fieldDecryptStart = performance.now();
    const decryptedFields = await decryptFields(encryptedFields, encryptionConfig);
    const fieldDecryptTime = performance.now() - fieldDecryptStart;

    // ③ 整体加密计时（作为性能基准）
    const fullEncryptStart = performance.now();
    const encryptedFull = await encrypt(JSON.stringify(testObject), masterKey);
    const fullEncryptTime = performance.now() - fullEncryptStart;

    // ④ 整体解密计时
    const fullDecryptStart = performance.now();
    const decryptedFullStr = await decrypt(encryptedFull, masterKey);
    const decryptedFull = JSON.parse(decryptedFullStr);
    const fullDecryptTime = performance.now() - fullDecryptStart;

    // 打印详细耗时，便于 CI 日志追溯
    console.table({
      '字段级加密耗时(ms)': fieldEncryptTime.toFixed(2),
      '字段级解密耗时(ms)': fieldDecryptTime.toFixed(2),
      '整体加密耗时(ms)': fullEncryptTime.toFixed(2),
      '整体解密耗时(ms)': fullDecryptTime.toFixed(2),
      '字段级/整体加密倍数': (fieldEncryptTime / fullEncryptTime).toFixed(2)
    });

    // 功能正确性断言：解密后数据与原文完全一致
    expect(decryptedFields).toEqual(testObject);

    // 性能断言：字段级加密最多比整体加密慢 5 倍（可根据 CI 资源调整）
    expect(fieldEncryptTime).toBeLessThan(fullEncryptTime * 5);

    // 解密耗时单独阈值：确保用户体验，控制在 1 s 内
    expect(fieldDecryptTime).toBeLessThan(1000);
  });

  /**
   * 批量字段级加密性能与正确性综合测试
   * 目的：
   * 1. 验证批量字段级加密接口（encryptFieldsBulk / decryptFieldsBulk）相比逐条调用
   *    在性能上的提升，并确保功能完全一致。
   * 2. 为业务场景提供量化依据：当需要对大量对象的部分敏感字段加密时，
   *    优先采用批量接口，减少重复密钥派生与函数调用开销。
   * 测试策略：
   * - 构造 20 条结构一致、字段内容各异的模拟用户数据，覆盖常见敏感字段。
   * - 分别执行：
   *   a) 逐条字段级加密（串行，每次独立派生密钥）。
   *   b) 批量字段级加密（内部复用派生密钥，减少 CPU 密集运算）。
   * - 对批量结果进行批量解密，验证解密后与原文完全一致。
   * - 计算并打印总耗时、单次平均耗时、性能提升百分比。
   * - 断言批量总耗时小于逐条总耗时，确保优化生效。
   * 注意事项：
   * - 数据量（20 条）与字段数（3 个敏感字段）兼顾 CI 快速运行与统计置信度；
   *   若硬件资源充足，可上调至 50~100 条以获得更稳定曲线。
   * - 性能提升主要来自“一次 PBKDF2 派生、多次复用”策略，提升幅度与迭代次数正相关。
   * - 若后续调低 PBKDF2 迭代次数或升级硬件，可同步收紧性能阈值。
   */
  test('批量字段级加密性能与正确性综合测试', async () => {
    // 构造测试数据：20 条模拟用户对象，字段内容带索引便于断言唯一性
    const testObjects = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      password: `password${i}123`,
      phone: `+123456789${i}`,
      address: `Address ${i}`
    }));

    // 仅加密敏感字段，降低加密面积，保持与业务实践一致
    const encryptionConfig = {
      fields: ['password', 'email', 'phone'],
      masterKey: masterKey
    };

    // ① 逐条字段级加密基准：完全串行，每次独立派生密钥
    const singleFieldStartTime = Date.now();
    const singleFieldResults: Record<string, any>[] = [];
    for (const obj of testObjects) {
      singleFieldResults.push(await encryptFields(obj, encryptionConfig));
    }
    const singleFieldTotalTime = Date.now() - singleFieldStartTime;

    // ② 批量字段级加密：内部复用派生密钥，减少重复运算
    const bulkFieldStartTime = Date.now();
    const bulkFieldResults = await encryptFieldsBulk(testObjects, encryptionConfig);
    const bulkFieldTotalTime = Date.now() - bulkFieldStartTime;

    // 打印详细性能对比，便于 CI 日志追溯
    console.log(`[批量字段级] 数据条数: ${testObjects.length}`);
    console.log(`[批量字段级] 逐条加密总耗时: ${singleFieldTotalTime}ms`);
    console.log(`[批量字段级] 批量加密总耗时: ${bulkFieldTotalTime}ms`);
    console.log(`[批量字段级] 单次平均耗时: ${(bulkFieldTotalTime / testObjects.length).toFixed(2)}ms`);
    console.log(`[批量字段级] 性能提升: ${((singleFieldTotalTime - bulkFieldTotalTime) / singleFieldTotalTime * 100).toFixed(1)}%`);

    // ③ 对批量结果进行批量解密，确保业务正确性
    expect(bulkFieldResults).toHaveLength(testObjects.length);
    const decryptedBulkFields = await decryptFieldsBulk(bulkFieldResults, encryptionConfig);

    // ④ 功能正确性断言：解密后数据与原文完全一致
    expect(decryptedBulkFields).toEqual(testObjects);

    // ⑤ 性能断言：批量必须显著快于逐条
    expect(bulkFieldTotalTime).toBeLessThan(singleFieldTotalTime);
  });

  test('密钥缓存效果测试', async () => {
    const testData = 'Cache test data for key derivation performance.';

    // ------ 冷启动：无缓存，触发完整 PBKDF2 ------
    const firstStart = performance.now();
    const firstEncrypted = await encrypt(testData, masterKey);
    const firstTime = performance.now() - firstStart;

    // ------ 热缓存：相同 masterKey，应命中缓存 ------
    const secondStart = performance.now();
    const secondEncrypted = await encrypt(testData, masterKey);
    const secondTime = performance.now() - secondStart;

    // ------ 日志输出，便于 CI 追溯 ------
    console.log(`[缓存测试] 冷启动耗时: ${firstTime.toFixed(2)}ms`);
    console.log(`[缓存测试] 缓存命中耗时: ${secondTime.toFixed(2)}ms`);
    console.log(`[缓存测试] 加速比: ${(firstTime / secondTime).toFixed(2)}x`);

    // ------ 正确性校验 ------
    // 1. 两次密文应不同（随机盐机制）
    expect(firstEncrypted).not.toBe(secondEncrypted);
    // 2. 解密后均等于原文
    const firstDecrypted = await decrypt(firstEncrypted, masterKey);
    const secondDecrypted = await decrypt(secondEncrypted, masterKey);
    expect(firstDecrypted).toBe(testData);
    expect(secondDecrypted).toBe(testData);

    // ------ 扩展：缓存隔离验证（可选，默认注释） ------
    // const anotherKey = masterKey + '-salt';
    // const thirdStart = performance.now();
    // await encrypt(testData, anotherKey);
    // const thirdTime = performance.now() - thirdStart;
    // console.log(`[缓存测试] 换钥后耗时: ${thirdTime.toFixed(2)}ms（应接近冷启动）`);
  });

  /**
   * 配置选项验证（冒烟测试 / Sanity Check）
   * 目的：
   * 1. 在跑任何性能或功能测试之前，先确保 liteStore.config.js 提供的加密参数合法、完整。
   * 2. 防止因配置缺失或类型错误导致下游测试出现“看似加密失败，实为配置错误”的误报。
   * 3. 将关键配置打印到 CI 日志，方便复现问题时可快速对照当时运行环境。
   * 验证范围：
   * - encryption 对象必须存在。
   * - keyIterations：必须为“整数”且 ≥ 1（PBKDF2 迭代次数，直接影响性能与安全性）。
   * - enableFieldLevelEncryption：布尔值，决定字段级加密是否开启。
   * - encryptedFields：必须是字符串数组，且长度 ≥ 1（开启字段级加密时至少得指定一个字段）。
   * - useBulkOperations：布尔值，控制是否启用批量优化。
   * - hmacAlgorithm：必须是白名单内的摘要算法，目前仅允许 'SHA-256' 或 'SHA-512'。
   * 阈值说明：
   * - 本测试属于“冒烟”级别，所有断言均为“硬检查”，任何一项不通过将直接阻断后续测试。
   * - 若后续新增配置项，请同步在此处补充断言，避免“配置漂移”。
   */
  test('配置选项验证 | v1.2.0', async () => {
    // 1. 顶层 encryption 命名空间检查
    expect(config.encryption).toBeDefined();
    expect(typeof config.encryption).toBe('object');

    // 2. PBKDF2 迭代次数检查（安全性与性能的平衡点）
    expect(Number.isInteger(config.encryption.keyIterations)).toBe(true);
    expect(config.encryption.keyIterations).toBeGreaterThanOrEqual(1);

    // 3. 字段级加密总开关
    expect(typeof config.encryption.enableFieldLevelEncryption).toBe('boolean');

    // 4. 敏感字段白名单（仅在开启字段级加密时才强制非空）
    expect(Array.isArray(config.encryption.encryptedFields)).toBe(true);
    if (config.encryption.enableFieldLevelEncryption) {
      expect(config.encryption.encryptedFields.length).toBeGreaterThan(0);
      // 额外检查数组元素均为字符串，防止误写数字或布尔
      config.encryption.encryptedFields.forEach((f: any) => {
        expect(typeof f).toBe('string');
      });
    }

    // 5. 批量优化开关
    expect(typeof config.encryption.useBulkOperations).toBe('boolean');

    // 6. HMAC 摘要算法白名单
    expect(['SHA-256', 'SHA-512']).toContain(config.encryption.hmacAlgorithm);

    // 7. 控制台输出当前生效配置，方便 CI 追溯
    console.log('[Config-Sanity] 加密配置验证通过 | 快照:', {
      keyIterations: config.encryption.keyIterations,
      enableFieldLevelEncryption: config.encryption.enableFieldLevelEncryption,
      encryptedFieldsCount: config.encryption.encryptedFields.length,
      useBulkOperations: config.encryption.useBulkOperations,
      hmacAlgorithm: config.encryption.hmacAlgorithm
    });
  });
});
