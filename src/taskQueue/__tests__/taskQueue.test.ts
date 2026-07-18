import { TaskPriority, TaskQueue, type Task, type TaskProcessor } from '../taskQueue';

type TaskQueuePrivateAccess = {
  queue: Task[];
  retryTimers: Set<ReturnType<typeof setTimeout>>;
};

const getTaskQueuePrivateAccess = (queue: TaskQueue): TaskQueuePrivateAccess =>
  queue as unknown as TaskQueuePrivateAccess;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

class TestProcessor implements TaskProcessor {
  constructor(
    private readonly delay = 100,
    private readonly shouldFail = false
  ) {}

  async process(_task: Task): Promise<unknown> {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    if (this.shouldFail) {
      throw new Error('Task failed intentionally');
    }

    return { processed: true };
  }

  supports(taskType: string): boolean {
    return taskType === 'test';
  }
}

describe('TaskQueue', () => {
  let taskQueue: TaskQueue;

  beforeEach(() => {
    taskQueue = new TaskQueue({ maxConcurrentTasks: 2, defaultTimeout: 5000, defaultMaxRetries: 2 });
  });

  afterEach(async () => {
    await taskQueue.cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('lifecycle', () => {
    it('creates a queue instance', () => {
      expect(taskQueue).toBeInstanceOf(TaskQueue);
    });

    it('starts and stops with an empty status', async () => {
      taskQueue.start();

      expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 0, total: 0 });

      await taskQueue.stop();
    });

    it('reports pending, running, and total task counts', () => {
      expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 0, total: 0 });
    });
  });

  describe('task scheduling', () => {
    it('adds a typed task with a generated identifier', () => {
      taskQueue.addProcessor(new TestProcessor());

      const taskId = taskQueue.addTask('test', { value: 42 });

      expect(taskId).toMatch(/^task-/);
    });

    it('orders pending tasks by priority', () => {
      taskQueue.addProcessor(new TestProcessor());

      taskQueue.addTask('test', { id: 'low' }, { priority: TaskPriority.LOW });
      taskQueue.addTask('test', { id: 'critical' }, { priority: TaskPriority.CRITICAL });
      taskQueue.addTask('test', { id: 'normal' }, { priority: TaskPriority.NORMAL });

      expect(getTaskQueuePrivateAccess(taskQueue).queue.map(task => task.priority)).toEqual([
        TaskPriority.CRITICAL,
        TaskPriority.NORMAL,
        TaskPriority.LOW,
      ]);
    });

    it('preserves explicit low priority and zero retries', () => {
      taskQueue.addProcessor(new TestProcessor());

      taskQueue.addTask('test', { id: 'explicit-options' }, { priority: TaskPriority.LOW, maxRetries: 0 });

      const [task] = getTaskQueuePrivateAccess(taskQueue).queue;
      expect(task.priority).toBe(TaskPriority.LOW);
      expect(task.maxRetries).toBe(0);
    });

    it('starts a waiting task after a retry releases the only concurrency slot', async () => {
      jest.useFakeTimers();
      taskQueue = new TaskQueue({ maxConcurrentTasks: 1, defaultTimeout: 5000, defaultMaxRetries: 0 });

      let processCalls = 0;
      let resolveWaitingTask: ((value: unknown) => void) | undefined;
      const waitingTask = new Promise<unknown>(resolve => {
        resolveWaitingTask = resolve;
      });
      const processor: TaskProcessor = {
        process: async (): Promise<unknown> => {
          processCalls += 1;
          if (processCalls === 1) {
            throw new Error('retry once');
          }

          return waitingTask;
        },
        supports: taskType => taskType === 'test',
      };
      taskQueue.addProcessor(processor);
      taskQueue.start();

      try {
        taskQueue.addTask('test', { id: 'retry' }, { maxRetries: 1 });
        taskQueue.addTask('test', { id: 'waiting' });

        await flushMicrotasks();

        expect(processCalls).toBe(2);
        expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 1, total: 1 });
      } finally {
        resolveWaitingTask?.({ processed: true });
        await flushMicrotasks();
      }
    });

    it('cancels delayed retries during cleanup', async () => {
      jest.useFakeTimers();
      taskQueue = new TaskQueue({ maxConcurrentTasks: 1, defaultTimeout: 5000, defaultMaxRetries: 1 });
      const processor: TaskProcessor = {
        process: async (): Promise<unknown> => {
          throw new Error('retry once');
        },
        supports: taskType => taskType === 'test',
      };
      const processSpy = jest.spyOn(processor, 'process');
      taskQueue.addProcessor(processor);
      taskQueue.start();

      taskQueue.addTask('test', { id: 'retry' });
      await flushMicrotasks();

      expect(getTaskQueuePrivateAccess(taskQueue).retryTimers.size).toBe(1);

      await taskQueue.cleanup();
      jest.advanceTimersByTime(2000);
      await flushMicrotasks();

      expect(getTaskQueuePrivateAccess(taskQueue).retryTimers.size).toBe(0);
      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 0, total: 0 });
    });
  });

  describe('cancellation', () => {
    it('cancels a pending task and invokes its callback', () => {
      taskQueue.addProcessor(new TestProcessor());

      let callbackCalled = false;
      let callbackTaskStatus: string | undefined;
      const taskId = taskQueue.addTask(
        'test',
        { value: 42 },
        {
          callback: task => {
            callbackCalled = true;
            callbackTaskStatus = task.status;
          },
        }
      );

      const cancelled = taskQueue.cancelTask(taskId);

      expect(cancelled).toBe(true);
      expect(callbackCalled).toBe(true);
      expect(callbackTaskStatus).toBe('cancelled');
    });

    it('clears all pending tasks', () => {
      taskQueue.addProcessor(new TestProcessor());
      taskQueue.addTask('test', { value: 1 });
      taskQueue.addTask('test', { value: 2 });
      taskQueue.addTask('test', { value: 3 });

      taskQueue.clear();

      expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 0, total: 0 });
    });
  });
});
