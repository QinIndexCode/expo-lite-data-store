/**
 * @module RateLimiter
 * @description API rate limiter using token bucket algorithm
 * @since 2025-11-28
 * @version 3.0.0
 */

import { RATE_LIMIT } from '../constants';

/**
 * 限流配置接口
 */
export interface RateLimitConfig {
  /**
   * 每秒生成的令牌数（速率）
   */
  rate: number;

  /**
   * 令牌桶容量
   */
  capacity: number;

  /**
   * 是否启用限流
   */
  enabled: boolean;
}

/**
 * 限流状态接口
 */
export interface RateLimitStatus {
  /**
   * 是否允许请求
   */
  allowed: boolean;

  /**
   * 剩余令牌数
   */
  remaining: number;

  /**
   * 重置时间（毫秒）
   */
  resetTime: number;

  /**
   * 重试时间（毫秒），如果请求被拒绝
   */
  retryAfter?: number;
}

/**
 * 客户端限流信息接口
 */
export interface ClientRateLimitInfo {
  /**
   * 最后一次请求时间
   */
  lastRequestTime: number;

  /**
   * 剩余令牌数
   */
  tokens: number;

  /** Last observed request time, used only for bounded idle cleanup. */
  lastSeenAt?: number;
}

const MAX_TRACKED_CLIENTS = 1024;
const MAX_CLIENT_ID_LENGTH = 128;
const CLIENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OVERFLOW_CLIENT_ID = '\u0000rate-limit-overflow';
const MAX_TRACKED_LIMITERS = 256;
const MAX_LIMITER_KEY_LENGTH = 128;
const OVERFLOW_LIMITER_KEY = '\u0000global-rate-limit-overflow';

/**
 * API限流类，基于令牌桶算法
 */
export class RateLimiter {
  /**
   * 限流配置
   */
  private config: RateLimitConfig;

  /**
   * 客户端限流信息映射
   */
  private clientLimits = new Map<string, ClientRateLimitInfo>();

  private static normalizeConfig(config: Partial<RateLimitConfig>): RateLimitConfig {
    const defaultRate = RateLimiter.getDefaultRate();
    const defaultCapacity = RateLimiter.getDefaultCapacity();

    return {
      rate: Number.isFinite(config.rate) && (config.rate as number) > 0 ? (config.rate as number) : defaultRate,
      capacity:
        Number.isSafeInteger(config.capacity) && (config.capacity as number) > 0
          ? (config.capacity as number)
          : defaultCapacity,
      enabled: config.enabled !== false && RateLimiter.isEnabledByDefault(),
    };
  }

  private invalidTokenCostStatus(): RateLimitStatus {
    const now = Date.now();
    return {
      allowed: false,
      remaining: 0,
      resetTime: now + 1000,
      retryAfter: 1000,
    };
  }

  private normalizeClientId(clientId: unknown): string | undefined {
    if (
      typeof clientId !== 'string' ||
      clientId.length === 0 ||
      clientId.length > MAX_CLIENT_ID_LENGTH ||
      clientId === OVERFLOW_CLIENT_ID
    ) {
      return undefined;
    }

    return clientId;
  }

  private pruneIdleClients(now: number): void {
    for (const [clientId, clientInfo] of this.clientLimits) {
      const lastSeenAt = clientInfo.lastSeenAt ?? clientInfo.lastRequestTime;
      if (now - lastSeenAt >= CLIENT_IDLE_TIMEOUT_MS) {
        this.clientLimits.delete(clientId);
      }
    }
  }

  private resolveClientId(clientId: unknown, now: number): string {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) {
      return OVERFLOW_CLIENT_ID;
    }

    if (this.clientLimits.has(normalizedClientId)) {
      return normalizedClientId;
    }

    this.pruneIdleClients(now);
    return this.clientLimits.size >= MAX_TRACKED_CLIENTS - 1 ? OVERFLOW_CLIENT_ID : normalizedClientId;
  }

  /**
   * 构造函数
   * @param config 限流配置
   */
  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = RateLimiter.normalizeConfig(config);
  }

  /**
   * 检查请求是否允许
   * @param clientId 客户端ID
   * @returns 限流状态
   */
  check(clientId: string): RateLimitStatus {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.capacity,
        resetTime: Date.now() + 1000,
      };
    }

    const now = Date.now();
    const resolvedClientId = this.resolveClientId(clientId, now);
    let clientInfo = this.clientLimits.get(resolvedClientId);

    if (!clientInfo) {
      // New client, initialize token bucket
      clientInfo = {
        lastRequestTime: now,
        tokens: this.config.capacity - 1, // Consume one token
        lastSeenAt: now,
      };
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    }

    // Calculate时间差，生成新令牌
    const timeElapsed = now - clientInfo.lastRequestTime;
    clientInfo.lastSeenAt = now;
    const newTokens = Math.floor((timeElapsed / 1000) * this.config.rate);

    if (newTokens > 0) {
      // Update令牌数，不超过容量
      clientInfo.tokens = Math.min(clientInfo.tokens + newTokens, this.config.capacity);
      clientInfo.lastRequestTime = now;
    }

    if (clientInfo.tokens > 0) {
      // Has tokens, allow request
      clientInfo.tokens--;
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    } else {
      // No tokens, reject request
      // Wait only for the next token at the configured refill rate. `timeElapsed`
      // is safe to use here because no whole token was added in this branch.
      const retryAfter = Math.ceil(1000 / this.config.rate - timeElapsed);

      return {
        allowed: false,
        remaining: 0,
        resetTime: now + 1000,
        retryAfter: retryAfter > 0 ? retryAfter : 1000,
      };
    }
  }

  /**
   * 消耗令牌
   * @param clientId 客户端ID
   * @param tokens 消耗的令牌数
   * @returns 限流状态
   */
  consume(clientId: string, tokens: number = 1): RateLimitStatus {
    if (!Number.isSafeInteger(tokens) || tokens < 1) {
      return this.invalidTokenCostStatus();
    }

    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.capacity,
        resetTime: Date.now() + 1000,
      };
    }

    const now = Date.now();
    const resolvedClientId = this.resolveClientId(clientId, now);
    let clientInfo = this.clientLimits.get(resolvedClientId);

    if (!clientInfo) {
      // New client, initialize token bucket
      clientInfo = {
        lastRequestTime: now,
        tokens: this.config.capacity,
        lastSeenAt: now,
      };
    }

    // Calculate时间差，生成新令牌
    const timeElapsed = now - clientInfo.lastRequestTime;
    clientInfo.lastSeenAt = now;
    const newTokens = Math.floor((timeElapsed / 1000) * this.config.rate);

    if (newTokens > 0) {
      // Update令牌数，不超过容量
      clientInfo.tokens = Math.min(clientInfo.tokens + newTokens, this.config.capacity);
      clientInfo.lastRequestTime = now;
    }

    if (clientInfo.tokens >= tokens) {
      // Sufficient tokens, allow request
      clientInfo.tokens -= tokens;
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    } else {
      // Insufficient tokens, reject request
      // Calculate需要等待的时间
      const tokensNeeded = tokens - clientInfo.tokens;
      const retryAfter = Math.ceil((tokensNeeded / this.config.rate) * 1000);

      return {
        allowed: false,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
        retryAfter,
      };
    }
  }

  /**
   * 重置客户端限流信息
   * @param clientId 客户端ID
   */
  reset(clientId: string): void {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (normalizedClientId) {
      this.clientLimits.delete(normalizedClientId);
    }
  }

  /**
   * 获取客户端限流信息
   * @param clientId 客户端ID
   * @returns 客户端限流信息，如果不存在则返回undefined
   */
  getClientInfo(clientId: string): ClientRateLimitInfo | undefined {
    const normalizedClientId = this.normalizeClientId(clientId);
    const clientInfo = normalizedClientId ? this.clientLimits.get(normalizedClientId) : undefined;
    return clientInfo ? { ...clientInfo } : undefined;
  }

  /**
   * 清除所有客户端限流信息
   */
  clear(): void {
    this.clientLimits.clear();
  }

  /**
   * 更新限流配置
   * @param config 新的限流配置
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = RateLimiter.normalizeConfig({ ...this.config, ...config });
  }

  /**
   * 获取当前限流配置
   * @returns 当前限流配置
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * 从配置文件获取默认限流速率
   * @returns 默认限流速率（每秒令牌数）
   */
  static getDefaultRate(): number {
    return RATE_LIMIT.DEFAULT_RATE;
  }

  /**
   * 从配置文件获取默认令牌桶容量
   * @returns 默认令牌桶容量
   */
  static getDefaultCapacity(): number {
    return RATE_LIMIT.DEFAULT_CAPACITY;
  }

  /**
   * 从配置文件获取默认是否启用限流
   * @returns 默认是否启用限流
   */
  static isEnabledByDefault(): boolean {
    return true;
  }

  /**
   * 从配置文件获取默认重试次数
   * @returns 默认重试次数
   */
  static getDefaultMaxAttempts(): number {
    return 3;
  }

  /**
   * 从配置文件获取默认重试退避乘数
   * @returns 默认重试退避乘数
   */
  static getDefaultBackoffMultiplier(): number {
    return 2;
  }
}

/**
 * 全局限流管理器类，用于管理多个限流实例
 */
export class GlobalRateLimiter {
  /**
   * 限流实例映射
   */
  private limiters = new Map<string, RateLimiter>();

  /**
   * 默认限流配置
   */
  private defaultConfig: RateLimitConfig = {
    rate: RateLimiter.getDefaultRate(),
    capacity: RateLimiter.getDefaultCapacity(),
    enabled: RateLimiter.isEnabledByDefault(),
  };

  private normalizeLimiterKey(key: unknown): string | undefined {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      key.length > MAX_LIMITER_KEY_LENGTH ||
      key === OVERFLOW_LIMITER_KEY
    ) {
      return undefined;
    }

    return key;
  }

  private resolveLimiterKey(key: unknown): string {
    const normalizedKey = this.normalizeLimiterKey(key);
    if (!normalizedKey) {
      return OVERFLOW_LIMITER_KEY;
    }

    if (this.limiters.has(normalizedKey)) {
      return normalizedKey;
    }

    return this.limiters.size >= MAX_TRACKED_LIMITERS - 1 ? OVERFLOW_LIMITER_KEY : normalizedKey;
  }

  /**
   * 获取或创建限流实例
   * @param key 限流实例键
   * @param config 限流配置
   * @returns 限流实例
   */
  getLimiter(key: string, config?: Partial<RateLimitConfig>): RateLimiter {
    const limiterKey = this.resolveLimiterKey(key);

    if (!this.limiters.has(limiterKey)) {
      this.limiters.set(
        limiterKey,
        new RateLimiter({
          ...this.defaultConfig,
          ...config,
        })
      );
    }

    return this.limiters.get(limiterKey)!;
  }

  /**
   * 更新默认限流配置
   * @param config 新的默认限流配置
   */
  updateDefaultConfig(config: Partial<RateLimitConfig>): void {
    this.defaultConfig = {
      ...this.defaultConfig,
      ...config,
    };
  }

  /**
   * 获取默认限流配置
   * @returns 默认限流配置
   */
  getDefaultConfig(): RateLimitConfig {
    return { ...this.defaultConfig };
  }

  /**
   * 删除限流实例
   * @param key 限流实例键
   */
  deleteLimiter(key: string): void {
    const normalizedKey = this.normalizeLimiterKey(key);
    if (normalizedKey) {
      this.limiters.delete(normalizedKey);
    }
  }

  /**
   * 清除所有限流实例
   */
  clear(): void {
    this.limiters.clear();
  }
}

// Global限流管理器实例
export const globalRateLimiter = new GlobalRateLimiter();
