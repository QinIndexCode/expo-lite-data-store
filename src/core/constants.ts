// src/core/constants.ts
// 应用程序常量定义，用于消除魔法数字和硬编码值
// 创建于: 2025-12-03
// 最后修改: 2025-12-12

/**
 * 限流相关常量
 * 用于配置API请求的速率限制策略
 */
export const RATE_LIMIT = {
  DEFAULT_RATE: 100, // 默认每秒允许的请求数
  DEFAULT_CAPACITY: 200, // 默认令牌桶容量，用于处理突发流量
  DEFAULT_RESET_TIME: 1000, // 默认令牌桶重置时间（毫秒）
} as const;

/**
 * 缓存相关常量
 * 用于配置缓存系统的各项参数
 */
export const CACHE = {
  DEFAULT_MAX_SIZE: 1000, // 默认缓存最大条目数
  DEFAULT_EXPIRY: 3600000, // 默认缓存过期时间（1小时，毫秒）
  CLEANUP_INTERVAL: 300000, // 定期清理过期缓存的间隔（5分钟，毫秒）
  AVALANCHE_PROTECTION_RANGE: [0, 300000] as [number, number], // 缓存雪崩保护的随机过期范围（0-5分钟）
  MEMORY_THRESHOLD: 0.8, // 内存使用阈值，超过此值将触发缓存清理（80%）
  PENETRATION_PROTECTION_TTL: 60000, // 缓存穿透保护的TTL（1分钟，毫秒）
} as const;

/**
 * 文件操作相关常量
 * 用于配置文件系统操作的各项参数
 */
export const FILE_OPERATION = {
  DEFAULT_CHUNK_SIZE: 5 * 1024 * 1024, // 默认文件分片大小（5MB）
  MAX_TABLE_NAME_LENGTH: 100, // 表名的最大允许长度
  OPERATION_TIMEOUT: 10000, // 文件操作的超时时间（10秒，毫秒）
  RETRY_DELAY: 100, // 文件操作失败后的重试延迟（100毫秒）
} as const;

/**
 * 查询相关常量
 * 用于配置查询引擎的各项参数
 */
export const QUERY = {
  DEFAULT_PAGE_SIZE: 100, // 默认查询分页大小
  MAX_PAGE_SIZE: 1000, // 最大允许的查询分页大小
  COUNTING_SORT_THRESHOLD: 100, // 适用计数排序的数据集大小阈值
  MERGE_SORT_THRESHOLD: 10000, // 适用归并排序的数据集大小阈值
} as const;

/**
 * 性能监控相关常量
 * 用于配置性能监控系统的各项参数
 */
export const MONITORING = {
  DEFAULT_INTERVAL: 60000, // 性能监控的默认采样间隔（1分钟，毫秒）
  MAX_HISTORY_RECORDS: 100, // 性能监控历史记录的最大保留数量
} as const;

/**
 * 正则表达式常量
 * 用于数据验证和格式检查
 */
export const REGEX = {
  TABLE_NAME: /^[a-zA-Z][a-zA-Z0-9_]*$/, // 表名格式验证：字母开头，仅允许字母、数字和下划线
  VALID_CHARS: /^[a-zA-Z0-9_\-]+$/, // 有效字符验证：仅允许字母、数字、下划线和连字符
} as const;
