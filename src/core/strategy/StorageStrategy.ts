// src/core/strategy/StorageStrategy.ts

// 定义存储记录类型
type RecordType = Record<string, any>;

/**
 * 存储策略接口
 *
 * 设计模式：策略模式
 * 用途：定义不同存储策略的统一接口，允许在运行时切换不同的存储策略
 * 优势：
 * - 封装了不同的存储算法
 * - 允许在运行时动态切换策略
 * - 便于扩展新的存储策略
 * - 提高了代码的灵活性和可维护性
 */
export interface StorageStrategy {
  /**
   * 策略名称
   */
  name: string;

  /**
   * 检查数据是否适合使用该策略
   *
   * @param data - 要检查的数据
   * @returns 是否适合使用该策略
   */
  isSuitable(data: RecordType[]): boolean;

  /**
   * 获取策略的优先级
   *
   * @returns 优先级，数值越大优先级越高
   */
  getPriority(): number;
}

/**
 * 单文件存储策略
 *
 * 适用场景：小数据量，读写速度快
 * 特点：所有数据存储在单个文件中
 */
export class SingleFileStrategy implements StorageStrategy {
  name = 'single_file';

  /**
   * 单文件策略的最大数据大小（字节）
   * 默认1MB
   */
  private readonly MAX_SIZE = 1024 * 1024;

  isSuitable(data: RecordType[]): boolean {
    // 估算数据大小
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);

    // 数据大小小于1MB时适合使用单文件策略
    return estimatedSize < this.MAX_SIZE;
  }

  getPriority(): number {
    return 10;
  }
}

/**
 * 分片存储策略
 *
 * 适用场景：大数据量，减少内存占用
 * 特点：数据被分成多个文件存储
 */
export class ChunkedFileStrategy implements StorageStrategy {
  name = 'chunked_file';

  /**
   * 分片策略的最小数据大小（字节）
   * 默认512KB
   */
  private readonly MIN_SIZE = 512 * 1024;

  isSuitable(data: RecordType[]): boolean {
    // 估算数据大小
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);

    // 数据大小大于512KB时适合使用分片策略
    return estimatedSize >= this.MIN_SIZE;
  }

  getPriority(): number {
    return 20;
  }
}

/**
 * 存储策略管理器
 *
 * 用途：管理和选择合适的存储策略
 */
export class StorageStrategyManager {
  /**
   * 可用的存储策略列表
   */
  private strategies: StorageStrategy[] = [];

  constructor() {
    // 注册默认策略
    this.registerStrategy(new SingleFileStrategy());
    this.registerStrategy(new ChunkedFileStrategy());
  }

  /**
   * 注册存储策略
   *
   * @param strategy - 要注册的存储策略
   */
  registerStrategy(strategy: StorageStrategy): void {
    this.strategies.push(strategy);
    // 按优先级排序，优先级高的策略排在前面
    this.strategies.sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * 选择合适的存储策略
   *
   * @param data - 要存储的数据
   * @returns 合适的存储策略，如果没有合适的策略则返回null
   */
  selectStrategy(data: RecordType[]): StorageStrategy | null {
    // 遍历所有策略，返回第一个适合的策略
    for (const strategy of this.strategies) {
      if (strategy.isSuitable(data)) {
        return strategy;
      }
    }

    // 如果没有合适的策略，返回优先级最高的策略
    return this.strategies[0] || null;
  }

  /**
   * 获取所有可用的存储策略
   *
   * @returns 所有可用的存储策略列表
   */
  getAllStrategies(): StorageStrategy[] {
    return [...this.strategies];
  }

  /**
   * 根据名称获取存储策略
   *
   * @param name - 策略名称
   * @returns 对应的存储策略，如果找不到则返回null
   */
  getStrategy(name: string): StorageStrategy | null {
    return this.strategies.find(strategy => strategy.name === name) || null;
  }
}
