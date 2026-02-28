import { TaskQueue, TaskPriority, Task, TaskProcessor } from '../taskQueue';

class TestProcessor implements TaskProcessor {
  private delay: number;
  private shouldFail: boolean;

  constructor(delay = 100, shouldFail = false) {
    this.delay = delay;
    this.shouldFail = shouldFail;
  }

  async process(_task: Task): Promise<any> {
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
  });

  describe('基本功能测试', () => {
    it('应该能够创建任务队列实例', () => {
      expect(taskQueue).toBeInstanceOf(TaskQueue);
    });

    it('应该能够启动和停止队列', async () => {
      taskQueue.start();
      expect(taskQueue.getStatus()).toEqual({ pending: 0, running: 0, total: 0 });
      
      await taskQueue.stop();
    });

    it('应该能够获取队列状态', () => {
      const status = taskQueue.getStatus();
      expect(status).toHaveProperty('pending');
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('total');
    });
  });

  describe('任务添加和处理测试', () => {
    it('应该能够添加任务到队列', () => {
      const processor = new TestProcessor();
      taskQueue.addProcessor(processor);
      
      const taskId = taskQueue.addTask('test', { value: 42 });
      expect(typeof taskId).toBe('string');
      expect(taskId.startsWith('task-')).toBe(true);
    });
  });

  describe('优先级测试', () => {
    it('应该能够添加不同优先级的任务', () => {
      const processor = new TestProcessor();
      taskQueue.addProcessor(processor);
      
      taskQueue.addTask('test', { id: 'low' }, { priority: TaskPriority.LOW });
      taskQueue.addTask('test', { id: 'critical' }, { priority: TaskPriority.CRITICAL });
      taskQueue.addTask('test', { id: 'normal' }, { priority: TaskPriority.NORMAL });
      
      const status = taskQueue.getStatus();
      expect(status.pending).toBe(3);
    });
  });

  describe('任务取消测试', () => {
    it('应该能够取消待处理的任务', () => {
      const processor = new TestProcessor();
      taskQueue.addProcessor(processor);
      
      let callbackCalled = false;
      let callbackTaskStatus: string | undefined;
      const taskId = taskQueue.addTask('test', { value: 42 }, {
        callback: (task) => { 
          callbackCalled = true; 
          callbackTaskStatus = task.status;
        }
      });
      
      const cancelled = taskQueue.cancelTask(taskId);
      expect(cancelled).toBe(true);
      expect(callbackCalled).toBe(true);
      expect(callbackTaskStatus).toBe('cancelled');
    });

    it('应该能够清空队列', async () => {
      const processor = new TestProcessor();
      taskQueue.addProcessor(processor);
      
      taskQueue.addTask('test', { value: 1 });
      taskQueue.addTask('test', { value: 2 });
      taskQueue.addTask('test', { value: 3 });
      
      taskQueue.clear();
      
      const status = taskQueue.getStatus();
      expect(status.pending).toBe(0);
    });
  });
});
