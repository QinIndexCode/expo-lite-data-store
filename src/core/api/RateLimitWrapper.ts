import { RATE_LIMIT } from '../constants';
import { RateLimiter } from './RateLimiter';
import type { RateLimitStatus } from './RateLimiter';

/** Adapts API wrapper options to a token-bucket limiter for each wrapper instance. */
export class RateLimitWrapper {
  private rateLimiter: RateLimiter;

  constructor(
    options: {
      rate?: number;
      capacity?: number;
      enabled?: boolean;
    } = {}
  ) {
    this.rateLimiter = new RateLimiter({
      rate: options.rate ?? RATE_LIMIT.DEFAULT_RATE,
      capacity: options.capacity ?? RATE_LIMIT.DEFAULT_CAPACITY,
      enabled: options.enabled !== false,
    });
  }

  checkRateLimit(clientId: string = 'default', tokens: number = 1): RateLimitStatus {
    return this.rateLimiter.consume(clientId, tokens);
  }

  reset(clientId: string = 'default'): void {
    this.rateLimiter.reset(clientId);
  }
}
