/**
 * @module constants
 * @description Application constants to eliminate magic numbers and hardcoded values
 * @since 2025-12-03
 * @version 1.0.0
 */

/**
 * 限流相关常量
 * 用于配置API请求的速率限制策略
 */
export const RATE_LIMIT = {
  DEFAULT_RATE: 100, // Default requests per second allowed
  DEFAULT_CAPACITY: 200, // Default token bucket capacity for burst traffic
  DEFAULT_RESET_TIME: 1000, // Default token bucket reset time (ms)
} as const;

/**
 * 缓存相关常量
 * 用于配置缓存系统的各项参数
 */
export const CACHE = {
  DEFAULT_MAX_SIZE: 1000, // Default max cache entries
  DEFAULT_EXPIRY: 3600000, // Default cache expiry (1 hour, ms)
  CLEANUP_INTERVAL: 300000, // Cleanup interval for expired cache (5 min, ms)
  AVALANCHE_PROTECTION_RANGE: [0, 300000] as [number, number], // Cache雪崩保护的随机过期范围（0-5分钟）
  MEMORY_THRESHOLD: 0.8, // Memory threshold to trigger cache cleanup (80%)
  PENETRATION_PROTECTION_TTL: 60000, // Cache穿透保护的TTL（1分钟，毫秒）
} as const;

/**
 * 文件操作相关常量
 * 用于配置文件系统操作的各项参数
 */
export const FILE_OPERATION = {
  DEFAULT_CHUNK_SIZE: 5 * 1024 * 1024, // Default file chunk size (5MB)
  MAX_TABLE_NAME_LENGTH: 100, // Max allowed table name length
  OPERATION_TIMEOUT: 10000, // File operation timeout (10s, ms)
  RETRY_DELAY: 100, // Retry delay after file operation failure (100ms)
} as const;

/**
 * 查询相关常量
 * 用于配置查询引擎的各项参数
 */
export const QUERY = {
  DEFAULT_PAGE_SIZE: 100, // Default query page size
  MAX_PAGE_SIZE: 1000, // Max allowed query page size
  COUNTING_SORT_THRESHOLD: 100, // Dataset size threshold for counting sort
  MERGE_SORT_THRESHOLD: 10000, // Dataset size threshold for merge sort
} as const;

/**
 * 性能监控相关常量
 * 用于配置性能监控系统的各项参数
 */
export const MONITORING = {
  DEFAULT_INTERVAL: 60000, // Default sampling interval for performance monitoring (1 min, ms)
  MAX_HISTORY_RECORDS: 100, // Max retained records in performance monitoring history
} as const;

/**
 * 正则表达式常量
 * 用于数据验证和格式检查
 */
export const REGEX = {
  TABLE_NAME: /^[a-zA-Z][a-zA-Z0-9_]*$/, // Table name validation: starts with letter, only letters, digits, underscores
  VALID_CHARS: /^[a-zA-Z0-9_\-]+$/, // Valid chars: only letters, digits, underscores, hyphens
} as const;
