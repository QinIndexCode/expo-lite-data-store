import logger from '../utils/logger';

export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Task<T = unknown> {
  id: string;
  type: string;
  data: unknown;
  priority: TaskPriority;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: TaskStatus;
  result?: T;
  error?: unknown;
  retryCount: number;
  maxRetries: number;
  timeout?: number;
}

export interface TaskProcessor {
  process(task: Task): Promise<unknown>;
  supports(taskType: string): boolean;
}

export interface TaskQueueConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  defaultMaxRetries: number;
}

/** Runs typed tasks by priority while bounding concurrent processor calls. */
export class TaskQueue {
  private config: TaskQueueConfig;
  private queue: Task[] = [];
  private runningTasks = new Set<string>();
  private processors = new Map<string, TaskProcessor>();
  private taskCallbacks = new Map<string, ((task: Task) => void)[]>();
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private isRunning = false;

  constructor(queueConfig: Partial<TaskQueueConfig> = {}) {
    this.config = {
      maxConcurrentTasks: queueConfig.maxConcurrentTasks || 5,
      defaultTimeout: queueConfig.defaultTimeout || 30000,
      defaultMaxRetries: queueConfig.defaultMaxRetries || 3,
    };
  }

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      // Keep test runs deterministic by requiring explicit processNextInTest calls.
      if (!(typeof process !== 'undefined' && process.env.NODE_ENV === 'test')) {
        this.processNext();
      }
    }
  }

  async stop(options: { force?: boolean; timeout?: number } = {}): Promise<void> {
    const { force = false, timeout = 30000 } = options;
    this.isRunning = false;
    this.clearRetryTimers();

    if (force) {
      this.runningTasks.clear();
      return;
    }

    const startTime = Date.now();
    while (this.runningTasks.size > 0) {
      if (Date.now() - startTime > timeout) {
        logger.warn(`TaskQueue stop timed out after ${timeout}ms, forcing stop`);
        this.runningTasks.clear();
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async cleanup(): Promise<void> {
    await this.stop({ force: true });
    this.queue = [];
    this.runningTasks.clear();
    this.taskCallbacks.clear();
  }

  processNextInTest(): void {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      this.processNext();
    }
  }

  addProcessor(processor: TaskProcessor): void {
    this.processors.set(processor.constructor.name, processor);
  }

  addTask<T = unknown>(
    taskType: string,
    data: unknown,
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
      priority: options.priority ?? TaskPriority.NORMAL,
      createdAt: Date.now(),
      status: TaskStatus.PENDING,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      timeout: options.timeout ?? this.config.defaultTimeout,
    };

    this.enqueue(task);

    if (options.callback) {
      const callbacks = this.taskCallbacks.get(task.id) ?? [];
      callbacks.push(options.callback as (task: Task) => void);
      this.taskCallbacks.set(task.id, callbacks);
    }

    this.processNext();
    return task.id;
  }

  private enqueue(task: Task): void {
    let inserted = false;
    for (let index = 0; index < this.queue.length; index++) {
      const existingTask = this.queue[index];
      if (
        task.priority > existingTask.priority ||
        (task.priority === existingTask.priority && task.createdAt < existingTask.createdAt)
      ) {
        this.queue.splice(index, 0, task);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queue.push(task);
    }
  }

  private processNext(): void {
    if (!this.isRunning || this.runningTasks.size >= this.config.maxConcurrentTasks || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    this.runningTasks.add(task.id);

    let processor: TaskProcessor | undefined;
    for (const candidate of this.processors.values()) {
      if (candidate.supports(task.type)) {
        processor = candidate;
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

    const timeout = task.timeout ?? this.config.defaultTimeout;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeout}ms`));
      }, timeout);
    });

    Promise.race([processor.process(task), timeoutPromise])
      .then(result => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.completeTask(task, { status: TaskStatus.COMPLETED, result });
      })
      .catch(error => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (task.retryCount < task.maxRetries && this.isRunning) {
          task.retryCount++;
          task.status = TaskStatus.PENDING;
          task.error = error;

          const backoffTime = Math.pow(2, task.retryCount - 1) * 1000;
          const jitter = Math.random() * 500;
          const totalBackoff = backoffTime + jitter;

          const retryTimer = setTimeout(() => {
            this.retryTimers.delete(retryTimer);
            if (!this.isRunning) {
              return;
            }
            this.enqueue(task);
            this.processNext();
          }, totalBackoff);
          this.retryTimers.add(retryTimer);

          this.runningTasks.delete(task.id);
          // A delayed retry must not hold a slot while other work is queued.
          this.processNext();
        } else {
          this.completeTask(task, { status: TaskStatus.FAILED, error });
        }
      });
  }

  private invokeCallbacks(task: Task): void {
    const callbacks = this.taskCallbacks.get(task.id);
    if (!callbacks) {
      return;
    }

    for (const callback of callbacks) {
      try {
        callback(task);
      } catch (error) {
        logger.error('Error in task callback:', error);
      }
    }
    this.taskCallbacks.delete(task.id);
  }

  private clearRetryTimers(): void {
    for (const retryTimer of this.retryTimers) {
      clearTimeout(retryTimer);
    }
    this.retryTimers.clear();
  }

  private completeTask(
    task: Task,
    result: {
      status: TaskStatus;
      result?: unknown;
      error?: unknown;
    }
  ): void {
    task.status = result.status;
    task.completedAt = Date.now();
    if ('result' in result) {
      task.result = result.result;
    }
    if ('error' in result) {
      task.error = result.error;
    }

    this.runningTasks.delete(task.id);
    this.invokeCallbacks(task);
    this.processNext();
  }

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

  cancelTask(taskId: string): boolean {
    const taskIndex = this.queue.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return false;
    }

    const task = this.queue.splice(taskIndex, 1)[0];
    task.status = TaskStatus.CANCELLED;
    task.completedAt = Date.now();
    this.invokeCallbacks(task);
    return true;
  }

  clear(): void {
    this.clearRetryTimers();
    for (const task of this.queue) {
      task.status = TaskStatus.CANCELLED;
      task.completedAt = Date.now();
      this.invokeCallbacks(task);
    }

    this.queue = [];
  }
}

export const taskQueue = new TaskQueue();
