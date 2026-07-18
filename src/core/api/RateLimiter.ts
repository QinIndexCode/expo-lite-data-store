import { RATE_LIMIT } from '../constants';

export interface RateLimitConfig {
  rate: number;
  capacity: number;
  enabled: boolean;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export interface ClientRateLimitInfo {
  lastRequestTime: number;
  tokens: number;
  /** Used only to remove idle client buckets. */
  lastSeenAt?: number;
}

const MAX_TRACKED_CLIENTS = 1024;
const MAX_CLIENT_ID_LENGTH = 128;
const CLIENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OVERFLOW_CLIENT_ID = '\u0000rate-limit-overflow';
const MAX_TRACKED_LIMITERS = 256;
const MAX_LIMITER_KEY_LENGTH = 128;
const OVERFLOW_LIMITER_KEY = '\u0000global-rate-limit-overflow';

/** Token-bucket limiter with bounded state for untrusted client identifiers. */
export class RateLimiter {
  private config: RateLimitConfig;
  private clientLimits = new Map<string, ClientRateLimitInfo>();

  private static normalizeConfig(config: Partial<RateLimitConfig>): RateLimitConfig {
    const rate = config.rate;
    const capacity = config.capacity;

    return {
      rate: typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : RateLimiter.getDefaultRate(),
      capacity:
        typeof capacity === 'number' && Number.isSafeInteger(capacity) && capacity > 0
          ? capacity
          : RateLimiter.getDefaultCapacity(),
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

  private refill(clientInfo: ClientRateLimitInfo, now: number): void {
    const elapsed = now - clientInfo.lastRequestTime;
    const tokensToAdd = Math.floor((elapsed / 1000) * this.config.rate);

    if (tokensToAdd > 0) {
      clientInfo.tokens = Math.min(clientInfo.tokens + tokensToAdd, this.config.capacity);
      // Preserve fractional elapsed time so low refill rates do not lose credit.
      clientInfo.lastRequestTime += (tokensToAdd / this.config.rate) * 1000;
    }

    clientInfo.lastSeenAt = now;
  }

  private getRetryAfter(clientInfo: ClientRateLimitInfo, now: number, missingTokens: number): number {
    const elapsed = now - clientInfo.lastRequestTime;
    const waitTime = (missingTokens / this.config.rate) * 1000 - elapsed;
    return Math.max(1, Math.ceil(waitTime));
  }

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = RateLimiter.normalizeConfig(config);
  }

  /** Consumes one token for a client. */
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
      clientInfo = {
        lastRequestTime: now,
        tokens: this.config.capacity - 1,
        lastSeenAt: now,
      };
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    }

    this.refill(clientInfo, now);

    if (clientInfo.tokens > 0) {
      clientInfo.tokens--;
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    }

    const retryAfter = this.getRetryAfter(clientInfo, now, 1);
    return {
      allowed: false,
      remaining: 0,
      resetTime: now + retryAfter,
      retryAfter,
    };
  }

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
      clientInfo = {
        lastRequestTime: now,
        tokens: this.config.capacity,
        lastSeenAt: now,
      };
    }

    this.refill(clientInfo, now);

    if (clientInfo.tokens >= tokens) {
      clientInfo.tokens -= tokens;
      this.clientLimits.set(resolvedClientId, clientInfo);

      return {
        allowed: true,
        remaining: clientInfo.tokens,
        resetTime: now + 1000,
      };
    }

    const retryAfter = this.getRetryAfter(clientInfo, now, tokens - clientInfo.tokens);
    return {
      allowed: false,
      remaining: clientInfo.tokens,
      resetTime: now + retryAfter,
      retryAfter,
    };
  }

  reset(clientId: string): void {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (normalizedClientId) {
      this.clientLimits.delete(normalizedClientId);
    }
  }

  getClientInfo(clientId: string): ClientRateLimitInfo | undefined {
    const normalizedClientId = this.normalizeClientId(clientId);
    const clientInfo = normalizedClientId ? this.clientLimits.get(normalizedClientId) : undefined;
    return clientInfo ? { ...clientInfo } : undefined;
  }

  clear(): void {
    this.clientLimits.clear();
  }

  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = RateLimiter.normalizeConfig({ ...this.config, ...config });
    for (const clientInfo of this.clientLimits.values()) {
      clientInfo.tokens = Math.min(clientInfo.tokens, this.config.capacity);
    }
  }

  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  static getDefaultRate(): number {
    return RATE_LIMIT.DEFAULT_RATE;
  }

  static getDefaultCapacity(): number {
    return RATE_LIMIT.DEFAULT_CAPACITY;
  }

  static isEnabledByDefault(): boolean {
    return true;
  }

  static getDefaultMaxAttempts(): number {
    return 3;
  }

  static getDefaultBackoffMultiplier(): number {
    return 2;
  }
}

/** Stores bounded, named rate limiters. */
export class GlobalRateLimiter {
  private limiters = new Map<string, RateLimiter>();
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

  updateDefaultConfig(config: Partial<RateLimitConfig>): void {
    this.defaultConfig = new RateLimiter({ ...this.defaultConfig, ...config }).getConfig();
  }

  getDefaultConfig(): RateLimitConfig {
    return { ...this.defaultConfig };
  }

  deleteLimiter(key: string): void {
    const normalizedKey = this.normalizeLimiterKey(key);
    if (normalizedKey) {
      this.limiters.delete(normalizedKey);
    }
  }

  clear(): void {
    this.limiters.clear();
  }
}

export const globalRateLimiter = new GlobalRateLimiter();
