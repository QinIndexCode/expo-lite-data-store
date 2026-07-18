import { GlobalRateLimiter, RateLimiter } from '../RateLimiter';
import type { ClientRateLimitInfo } from '../RateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      rate: 10,
      capacity: 20,
      enabled: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('token consumption', () => {
    it('allows the first request and consumes one token', () => {
      const result = rateLimiter.check('test-client');

      expect(result).toMatchObject({ allowed: true, remaining: 19 });
    });

    it('consumes a requested number of tokens', () => {
      const result = rateLimiter.consume('test-client', 5);

      expect(result).toMatchObject({ allowed: true, remaining: 15 });
    });

    it('rejects a request that exceeds the available capacity', () => {
      const result = rateLimiter.consume('test-client', 30);

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
    });

    it('uses the configured refill rate for check retry delays', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const limiter = new RateLimiter({ rate: 10, capacity: 1, enabled: true });

      expect(limiter.check('client').allowed).toBe(true);

      jest.advanceTimersByTime(50);

      expect(limiter.check('client')).toMatchObject({
        allowed: false,
        retryAfter: 50,
      });
    });

    it('preserves fractional refill time between requests', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const limiter = new RateLimiter({ rate: 3, capacity: 3, enabled: true });

      expect(limiter.consume('client', 3).allowed).toBe(true);

      jest.advanceTimersByTime(334);
      expect(limiter.consume('client', 1).allowed).toBe(true);

      jest.advanceTimersByTime(333);
      expect(limiter.consume('client', 1)).toMatchObject({ allowed: true, remaining: 0 });
    });

    it('resets client rate-limit state', () => {
      rateLimiter.consume('test-client', 5);

      rateLimiter.reset('test-client');

      expect(rateLimiter.getClientInfo('test-client')).toBeUndefined();
    });

    it('clears state for every client', () => {
      rateLimiter.consume('client-1', 5);
      rateLimiter.consume('client-2', 3);
      rateLimiter.consume('client-3', 7);

      rateLimiter.clear();

      expect(rateLimiter.getClientInfo('client-1')).toBeUndefined();
      expect(rateLimiter.getClientInfo('client-2')).toBeUndefined();
      expect(rateLimiter.getClientInfo('client-3')).toBeUndefined();
    });

    it('bounds untrusted client identity state and returns snapshots', () => {
      const oversizedClientId = 'x'.repeat(129);
      expect(rateLimiter.consume(oversizedClientId, 1).allowed).toBe(true);
      expect(rateLimiter.getClientInfo(oversizedClientId)).toBeUndefined();

      for (let index = 0; index < 1100; index++) {
        rateLimiter.consume(`client-${index}`, 1);
      }

      const trackedClients = (rateLimiter as unknown as { clientLimits: Map<string, ClientRateLimitInfo> })
        .clientLimits;
      expect(trackedClients.size).toBeLessThanOrEqual(1024);

      const snapshot = rateLimiter.getClientInfo('client-0');
      expect(snapshot).toBeDefined();
      snapshot!.tokens = 999;
      expect(rateLimiter.getClientInfo('client-0')?.tokens).not.toBe(999);
    });

    it('rejects invalid token costs without changing bucket state', () => {
      const before = rateLimiter.getClientInfo('test-client');

      for (const tokens of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const result = rateLimiter.consume('test-client', tokens);
        expect(result.allowed).toBe(false);
        expect(Number.isFinite(result.retryAfter)).toBe(true);
      }

      expect(rateLimiter.getClientInfo('test-client')).toEqual(before);
    });
  });

  describe('configuration', () => {
    it('updates rate-limit configuration', () => {
      rateLimiter.updateConfig({ rate: 20, capacity: 40 });

      expect(rateLimiter.getConfig()).toMatchObject({ rate: 20, capacity: 40 });
    });

    it('caps existing client buckets when capacity is reduced', () => {
      rateLimiter.consume('test-client', 1);

      rateLimiter.updateConfig({ capacity: 5 });

      expect(rateLimiter.getClientInfo('test-client')?.tokens).toBe(5);
    });

    it('disables rate limiting when configured', () => {
      rateLimiter.updateConfig({ enabled: false });

      expect(rateLimiter.consume('test-client', 100).allowed).toBe(true);
    });

    it('re-enables rate limiting after a disabled period', () => {
      rateLimiter.updateConfig({ enabled: false });
      expect(rateLimiter.consume('test-client', 100).allowed).toBe(true);

      rateLimiter.updateConfig({ enabled: true });

      expect(rateLimiter.consume('test-client', 100).allowed).toBe(false);
    });
  });
});

describe('GlobalRateLimiter', () => {
  let globalRateLimiter: GlobalRateLimiter;

  beforeEach(() => {
    globalRateLimiter = new GlobalRateLimiter();
  });

  it('returns the same limiter for a repeated key', () => {
    const first = globalRateLimiter.getLimiter('test-limiter');
    const second = globalRateLimiter.getLimiter('test-limiter');

    expect(first).toBe(second);
  });

  it('uses updated normalized defaults for new limiters', () => {
    globalRateLimiter.updateDefaultConfig({ rate: 50, capacity: 100 });

    expect(globalRateLimiter.getLimiter('new-limiter').getConfig()).toMatchObject({ rate: 50, capacity: 100 });
  });

  it('creates a replacement after a limiter is deleted', () => {
    const first = globalRateLimiter.getLimiter('test-limiter');

    globalRateLimiter.deleteLimiter('test-limiter');

    expect(globalRateLimiter.getLimiter('test-limiter')).not.toBe(first);
  });

  it('removes every named limiter when cleared', () => {
    const first = globalRateLimiter.getLimiter('limiter-1');
    globalRateLimiter.getLimiter('limiter-2');

    globalRateLimiter.clear();

    expect(globalRateLimiter.getLimiter('limiter-1')).not.toBe(first);
  });

  it('bounds state for arbitrary limiter keys', () => {
    globalRateLimiter.getLimiter('x'.repeat(129));

    for (let index = 0; index < 300; index++) {
      globalRateLimiter.getLimiter(`limiter-${index}`);
    }

    const limiters = (globalRateLimiter as unknown as { limiters: Map<string, RateLimiter> }).limiters;
    expect(limiters.size).toBeLessThanOrEqual(256);
  });
});
