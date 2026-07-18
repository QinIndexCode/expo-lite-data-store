/**
 * Storage strategy contract.
 *
 * Strategies select a storage layout without inspecting individual fields.
 */
export interface StorageStrategy {
  /**
   * Stable strategy identifier.
   */
  name: string;

  /**
   * Determines whether a collection is suitable for this strategy.
   */
  isSuitable(data: readonly object[]): boolean;

  /**
   * Returns a priority where larger values are preferred.
   */
  getPriority(): number;
}

/**
 * Stores small collections in one file.
 */
export class SingleFileStrategy implements StorageStrategy {
  name = 'single_file';

  /**
   * Maximum estimated payload size in bytes.
   */
  private readonly MAX_SIZE = 1024 * 1024;

  isSuitable(data: readonly object[]): boolean {
    const estimatedSize = data.reduce((acc, item) => acc + (JSON.stringify(item)?.length ?? 0), 0);

    // Use single file strategy when data < 1MB
    return estimatedSize < this.MAX_SIZE;
  }

  getPriority(): number {
    return 10;
  }
}

/**
 * Stores large collections across chunk files.
 */
export class ChunkedFileStrategy implements StorageStrategy {
  name = 'chunked_file';

  /**
   * Minimum estimated payload size in bytes.
   */
  private readonly MIN_SIZE = 512 * 1024;

  isSuitable(data: readonly object[]): boolean {
    const estimatedSize = data.reduce((acc, item) => acc + (JSON.stringify(item)?.length ?? 0), 0);

    // Use chunked strategy when data > 512KB
    return estimatedSize >= this.MIN_SIZE;
  }

  getPriority(): number {
    return 20;
  }
}

/**
 * Registers and selects storage strategies.
 */
export class StorageStrategyManager {
  /**
   * Registered strategies ordered by priority.
   */
  private strategies: StorageStrategy[] = [];

  constructor() {
    // Register default strategy
    this.registerStrategy(new SingleFileStrategy());
    this.registerStrategy(new ChunkedFileStrategy());
  }

  /**
   * Registers a strategy and keeps the preferred strategy first.
   */
  registerStrategy(strategy: StorageStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority, higher priority first
    this.strategies.sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * Selects the first compatible strategy for a collection.
   */
  selectStrategy<T extends object>(data: readonly T[]): StorageStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.isSuitable(data)) {
        return strategy;
      }
    }

    // If no matching strategy, return highest priority
    return this.strategies[0] || null;
  }

  /**
   * Returns registered strategies in selection order.
   */
  getAllStrategies(): StorageStrategy[] {
    return [...this.strategies];
  }

  /**
   * Finds a strategy by its stable identifier.
   */
  getStrategy(name: string): StorageStrategy | null {
    return this.strategies.find(strategy => strategy.name === name) || null;
  }
}
