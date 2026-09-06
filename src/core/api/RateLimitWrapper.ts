import { RATE_LIMIT } from '../constants';
import { configManager } from '../config/ConfigManager';
import { RateLimiter } from './RateLimiter';
import type { RateLimitStatus } from './RateLimiter';

/**
 * Adapts API wrapper options to a token-bucket limiter for each wrapper instance.
 *
 * Precedence for each field: explicit constructor options win, then the global
 * `api.rateLimit` config (`requestsPerSecond` maps to `rate`, `burstCapacity`
 * maps to `capacity`), then the hardcoded `RATE_LIMIT` constants.
 */
export class RateLimitWrapper {
  private rateLimiter: RateLimiter;

  constructor(
    options: {
      rate?: number;
      capacity?: number;
      enabled?: boolean;
    } = {}
  ) {
    const configured = configManager.getConfig().api?.rateLimit;
    this.rateLimiter = new RateLimiter({
      rate: options.rate ?? configured?.requestsPerSecond ?? RATE_LIMIT.DEFAULT_RATE,
      capacity: options.capacity ?? configured?.burstCapacity ?? RATE_LIMIT.DEFAULT_CAPACITY,
      enabled: options.enabled ?? configured?.enabled ?? true,
    });
  }

  checkRateLimit(clientId: string = 'default', tokens: number = 1): RateLimitStatus {
    return this.rateLimiter.consume(clientId, tokens);
  }

  reset(clientId: string = 'default'): void {
    this.rateLimiter.reset(clientId);
  }
}
