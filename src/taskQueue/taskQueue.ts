// src/taskQueue/taskQueue.ts
// 任务队列管理系统
//

//
/**
//  * 任务优先级枚举
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 任务接口
 */
export interface Task<T = any> {
  /**
   * 任务唯一标识符
   */
  id: string;

  /**
   * 任务类型
   */
  type: string;

  /**
   * 任务数据
   */
  data: any;

  /**
   * 任务优先级
   */
  priority: TaskPriority;

  /**
   * 任务创建时间
   */
  createdAt: number;

  /**
   * 任务开始时间
   */
  startedAt?: number;

  /**
   * 任务完成时间
   */
  completedAt?: number;

  /**
   * 任务状态
   */
  status: TaskStatus;

  /**
   * 任务结果
   */
  result?: T;

  /**
   * 任务错误
   */
  error?: any;

  /**
   * 重试次数
   */
  retryCount: number;

  /**
   * 最大重试次数
   */
  maxRetries: number;

  /**
   * 任务超时时间（毫秒）
   */
  timeout?: number;
}

/**
 * 任务处理器接口
 */
export interface TaskProcessor {
  /**
   * 处理任务
   * @param task 任务对象
   */
  process(task: Task): Promise<any>;

  /**
   * 支持的任务类型
   */
  supports(taskType: string): boolean;
}

/**
 * 任务队列配置接口
 */
export interface TaskQueueConfig {
  /**
   * 最大并发任务数
   */
  maxConcurrentTasks: number;

  /**
   * 任务超时时间（毫秒）
   */
  defaultTimeout: number;

  /**
   * 最大重试次数
   */
  defaultMaxRetries: number;
}

/**
 * 任务队列类
 *
 * 设计模式：
 * - 生产者-消费者模式：任务生产者添加任务，消费者线程处理任务
 * - 优先级队列：支持不同优先级的任务
 * - 观察者模式：支持任务完成后的回调通知
 */
export class TaskQueue {
  /**
   * 任务队列配置
   */
  private config: TaskQueueConfig;

  /**
   * 任务队列，按优先级排序
   */
  private queue: Task[] = [];

  /**
   * 当前运行的任务
   */
  private runningTasks: Set<string> = new Set();

  /**
   * 任务处理器映射
   */
  private processors: Map<string, TaskProcessor> = new Map();

  /**
   * 任务完成回调映射
   */
  private taskCallbacks: Map<string, ((task: Task) => void)[]> = new Map();

  /**
   * 队列是否正在运行
   */
  private isRunning = false;

  /**
   * 构造函数
   * @param queueConfig 任务队列配置
   */
  constructor(queueConfig: Partial<TaskQueueConfig> = {}) {
    this.config = {
      maxConcurrentTasks: queueConfig.maxConcurrentTasks || 5,
      defaultTimeout: queueConfig.defaultTimeout || 30000,
      defaultMaxRetries: queueConfig.defaultMaxRetries || 3,
    };
  }

  /**
   * 启动任务队列
   */
  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      // 测试环境也设置isRunning为true，但不自动处理任务，允许手动控制
      if (!(typeof process !== 'undefined' && process.env.NODE_ENV === 'test')) {
        this.processNext();
      }
    }
  }

  /**
   * 停止任务队列
   * @param options 停止选项
   * @param options.force 是否强制停止，默认false（等待正在运行的任务完成）
   * @param options.timeout 等待超时时间（毫秒），默认30000
   */
  async stop(options: { force?: boolean; timeout?: number } = {}): Promise<void> {
    const { force = false, timeout = 30000 } = options;

    // 设置队列状态为停止
    this.isRunning = false;

    if (force) {
      // 强制停止，清理所有运行中的任务
      this.runningTasks.clear();
      return;
    }

    // 等待正在运行的任务完成
    const startTime = Date.now();
    while (this.runningTasks.size > 0) {
      // 检查是否超时
      if (Date.now() - startTime > timeout) {
        console.warn(`TaskQueue stop timed out after ${timeout}ms, forcing stop`);
        this.runningTasks.clear();
        return;
      }

      // 等待一段时间后再次检查
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 清理所有任务和资源（用于测试）
   */
  async cleanup(): Promise<void> {
    // 停止队列
    await this.stop({ force: true });

    // 清理所有任务和回调
    this.queue = [];
    this.runningTasks.clear();
    this.taskCallbacks.clear();
  }

  /**
   * 在测试环境中手动处理下一个任务
   * 用于测试环境中手动控制任务执行
   */
  processNextInTest(): void {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      this.processNext();
    }
  }

  /**
   * 添加任务处理器
   * @param processor 任务处理器
   */
  addProcessor(processor: TaskProcessor): void {
    // 处理器可以支持多种任务类型，这里简化处理
    // 实际实现中应该让处理器返回支持的任务类型列表
    this.processors.set(processor.constructor.name, processor);
  }

  /**
   * 添加任务到队列
   * @param taskType 任务类型
   * @param data 任务数据
   * @param options 任务选项
   * @returns 任务ID
   */
  addTask<T = any>(
    taskType: string,
    data: any,
    options: {
      priority?: TaskPriority;
      timeout?: number;
      maxRetries?: number;
      callback?: (task: Task<T>) => void;
    } = {}
  ): string {
    const task: Task<T> = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: taskType,
      data,
      priority: options.priority || TaskPriority.NORMAL,
      createdAt: Date.now(),
      status: TaskStatus.PENDING,
      retryCount: 0,
      maxRetries: options.maxRetries || this.config.defaultMaxRetries,
      timeout: options.timeout || this.config.defaultTimeout,
    };

    // 添加到优先级队列
    this.enqueue(task);

    // 添加回调
    if (options.callback) {
      if (!this.taskCallbacks.has(task.id)) {
        this.taskCallbacks.set(task.id, []);
      }
      this.taskCallbacks.get(task.id)?.push(options.callback as (task: Task) => void);
    }

    // 开始处理任务
    this.processNext();

    return task.id;
  }

  /**
   * 将任务加入优先级队列
   * @param task 任务对象
   */
  private enqueue(task: Task): void {
    // 按优先级排序，优先级高的任务排在前面
    // 相同优先级的任务按创建时间排序，先创建的排在前面
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      const existingTask = this.queue[i];
      if (
        task.priority > existingTask.priority ||
        (task.priority === existingTask.priority && task.createdAt < existingTask.createdAt)
      ) {
        this.queue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queue.push(task);
    }
  }

  /**
   * 处理下一个任务
   */
  private processNext(): void {
    if (!this.isRunning || this.runningTasks.size >= this.config.maxConcurrentTasks || this.queue.length === 0) {
      return;
    }

    // 获取下一个任务
    const task = this.queue.shift();
    if (!task) return;

    // 标记任务为运行中
    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    this.runningTasks.add(task.id);

    // 查找合适的处理器
    let processor: TaskProcessor | undefined;
    for (const [, p] of this.processors) {
      if (p.supports(task.type)) {
        processor = p;
        break;
      }
    }

    if (!processor) {
      this.completeTask(task, {
        status: TaskStatus.FAILED,
        error: new Error(`No processor found for task type: ${task.type}`),
      });
      return;
    }

    // 处理任务
    const timeout = task.timeout || this.config.defaultTimeout;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeout}ms`));
      }, timeout);
    });

    Promise.race([processor.process(task), timeoutPromise])
      .then(result => {
        // 清理超时定时器
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.completeTask(task, { status: TaskStatus.COMPLETED, result });
      })
      .catch(error => {
        // 清理超时定时器
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (task.retryCount < task.maxRetries) {
          // 重试任务
          task.retryCount++;
          task.status = TaskStatus.PENDING;
          task.error = error;

          // Calculate exponential backoff based on retry count and config
          const backoffTime = Math.pow(2, task.retryCount - 1) * 1000;

          // Add jitter to prevent thundering herd
          const jitter = Math.random() * 500;
          const totalBackoff = backoffTime + jitter;

          // Schedule retry after backoff
          setTimeout(() => {
            this.enqueue(task);
            this.processNext();
          }, totalBackoff);

          this.runningTasks.delete(task.id);
        } else {
          // 任务失败
          this.completeTask(task, { status: TaskStatus.FAILED, error });
        }
      });
  }

  /**
   * 完成任务
   * @param task 任务对象
   * @param result 任务结果
   */
  private completeTask(
    task: Task,
    result: {
      status: TaskStatus;
      result?: any;
      error?: any;
    }
  ): void {
    task.status = result.status;
    task.completedAt = Date.now();
    if (result.result) {
      task.result = result.result;
    }
    if (result.error) {
      task.error = result.error;
    }

    // 移除运行中的任务
    this.runningTasks.delete(task.id);

    // 执行回调
    if (this.taskCallbacks.has(task.id)) {
      const callbacks = this.taskCallbacks.get(task.id);
      callbacks?.forEach(callback => {
        try {
          callback(task);
        } catch (callbackError) {
          console.error(`Error in task callback:`, callbackError);
        }
      });
      this.taskCallbacks.delete(task.id);
    }

    // 处理下一个任务
    this.processNext();
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    pending: number;
    running: number;
    total: number;
  } {
    return {
      pending: this.queue.length,
      running: this.runningTasks.size,
      total: this.queue.length + this.runningTasks.size,
    };
  }

  /**
   * 取消任务
   * @param taskId 任务ID
   */
  cancelTask(taskId: string): boolean {
    // 查找任务
    const taskIndex = this.queue.findIndex(task => task.id === taskId);
    if (taskIndex !== -1) {
      // 从队列中移除
      const task = this.queue.splice(taskIndex, 1)[0];
      task.status = TaskStatus.CANCELLED;
      task.completedAt = Date.now();

      // 执行回调
      if (this.taskCallbacks.has(taskId)) {
        const callbacks = this.taskCallbacks.get(taskId);
        callbacks?.forEach(callback => {
          try {
            callback(task);
          } catch (callbackError) {
            console.error(`Error in task callback:`, callbackError);
          }
        });
        this.taskCallbacks.delete(taskId);
      }

      return true;
    }

    // 检查是否正在运行
    if (this.runningTasks.has(taskId)) {
      // 这里简化处理，实际实现中应该支持取消正在运行的任务
      return false;
    }

    return false;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue.forEach(task => {
      task.status = TaskStatus.CANCELLED;
      task.completedAt = Date.now();

      // 执行回调
      if (this.taskCallbacks.has(task.id)) {
        const callbacks = this.taskCallbacks.get(task.id);
        callbacks?.forEach(callback => {
          try {
            callback(task);
          } catch (callbackError) {
            console.error(`Error in task callback:`, callbackError);
          }
        });
        this.taskCallbacks.delete(task.id);
      }
    });

    this.queue = [];
  }
}

// 全局任务队列实例
export const taskQueue = new TaskQueue();
