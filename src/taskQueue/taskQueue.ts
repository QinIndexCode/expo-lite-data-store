// 引入或定义 Task 类型
interface Task {
  id: string;
  // 根据实际业务补充其他字段
}

const TASK_QUEUE = new Map<keyof Task, Task[]>();
