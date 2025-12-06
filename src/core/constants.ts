/**
 * 应用程序常量定义
 * 用于消除魔法数字和硬编码值
 */

// 限流相关常量
export const RATE_LIMIT = {
  DEFAULT_RATE: 100, // 默认每秒请求数
  DEFAULT_CAPACITY: 200, // 默认令牌桶容量
  DEFAULT_RESET_TIME: 1000, // 默认重置时间（毫秒）
} as const;

// 缓存相关常量
export const CACHE = {
  DEFAULT_MAX_SIZE: 1000, // 默认缓存最大大小
  DEFAULT_EXPIRY: 3600000, // 默认过期时间（1小时）
  CLEANUP_INTERVAL: 300000, // 清理间隔（5分钟）
  AVALANCHE_PROTECTION_RANGE: [0, 300000] as [number, number], // 雪崩保护随机范围（0-5分钟）
  MEMORY_THRESHOLD: 0.8, // 内存使用阈值（80%）
  PENETRATION_PROTECTION_TTL: 60000, // 穿透保护TTL（1分钟）
} as const;

// 文件操作相关常量
export const FILE_OPERATION = {
  DEFAULT_CHUNK_SIZE: 5 * 1024 * 1024, // 默认分块大小（5MB）
  MAX_TABLE_NAME_LENGTH: 100, // 表名最大长度
  OPERATION_TIMEOUT: 10000, // 操作超时时间（10秒）
  RETRY_DELAY: 100, // 重试延迟（100ms）
} as const;

// 查询相关常量
export const QUERY = {
  DEFAULT_PAGE_SIZE: 100, // 默认分页大小
  MAX_PAGE_SIZE: 1000, // 最大分页大小
  COUNTING_SORT_THRESHOLD: 100, // 计数排序阈值
  MERGE_SORT_THRESHOLD: 10000, // 归并排序阈值
} as const;

// 性能监控相关常量
export const MONITORING = {
  DEFAULT_INTERVAL: 60000, // 默认监控间隔（1分钟）
  MAX_HISTORY_RECORDS: 100, // 最大历史记录数
} as const;

// 正则表达式常量
export const REGEX = {
  TABLE_NAME: /^[a-zA-Z][a-zA-Z0-9_]*$/, // 表名格式
  VALID_CHARS: /^[a-zA-Z0-9_\-]+$/, // 有效字符
} as const;
