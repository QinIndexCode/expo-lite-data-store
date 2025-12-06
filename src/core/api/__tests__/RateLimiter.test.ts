// src/core/api/__tests__/RateLimiter.test.ts
// RateLimiter 单元测试

import { GlobalRateLimiter, RateLimiter } from '../RateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    // 创建新的RateLimiter实例用于每个测试
    rateLimiter = new RateLimiter({
      rate: 10, // 每秒10个请求
      capacity: 20, // 令牌桶容量20
      enabled: true,
    });
  });

  describe('Basic Functionality Tests', () => {
    it('should be able to check if request is allowed', () => {
      // Initial state, should allow request
      const result = rateLimiter.check('test-client');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(19); // Consumed 1 token
    });

    it('should be able to consume specified number of tokens', () => {
      // Consume 5 tokens
      const result = rateLimiter.consume('test-client', 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(15); // Consumed 5 tokens
    });

    it('should reject requests that exceed limits', () => {
      // Consume more tokens than capacity
      const result = rateLimiter.consume('test-client', 30);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
    });

    it('should be able to reset client rate limiting info', () => {
      // Consume some tokens
      rateLimiter.consume('test-client', 5);
      expect(rateLimiter.getClientInfo('test-client')?.tokens).toBe(15);

      // Reset client rate limiting info
      rateLimiter.reset('test-client');
      expect(rateLimiter.getClientInfo('test-client')).toBeUndefined();
    });

    it('should be able to clear all client rate limiting info', () => {
      // Consume tokens for multiple clients
      rateLimiter.consume('client1', 5);
      rateLimiter.consume('client2', 3);
      rateLimiter.consume('client3', 7);

      // Clear all client rate limiting info
      rateLimiter.clear();

      // Check results
      expect(rateLimiter.getClientInfo('client1')).toBeUndefined();
      expect(rateLimiter.getClientInfo('client2')).toBeUndefined();
      expect(rateLimiter.getClientInfo('client3')).toBeUndefined();
    });
  });

  describe('Rate Limiting Configuration Tests', () => {
    it('should be able to update rate limiting configuration', () => {
      // Update configuration
      rateLimiter.updateConfig({
        rate: 20,
        capacity: 40,
      });

      // Check updated configuration
      const config = rateLimiter.getConfig();
      expect(config.rate).toBe(20);
      expect(config.capacity).toBe(40);
    });

    it('should be able to disable rate limiting', () => {
      // Disable rate limiting
      rateLimiter.updateConfig({ enabled: false });

      // Check result
      const result = rateLimiter.consume('test-client', 100);
      expect(result.allowed).toBe(true);
    });

    it('should be able to enable rate limiting', () => {
      // First disable rate limiting
      rateLimiter.updateConfig({ enabled: false });
      expect(rateLimiter.consume('test-client', 100).allowed).toBe(true);

      // Enable rate limiting
      rateLimiter.updateConfig({ enabled: true });
      expect(rateLimiter.consume('test-client', 100).allowed).toBe(false);
    });
  });

  describe('Token Generation Tests', () => {
    it('should be able to generate new tokens over time', () => {
      // Consume all tokens
      rateLimiter.consume('test-client', 20);
      expect(rateLimiter.consume('test-client', 1).allowed).toBe(false);

      // Simulate time passing, generating new tokens
      jest.useFakeTimers();

      // Wait 1 second, should generate 10 new tokens
      jest.advanceTimersByTime(1000);

      // Check result
      const result = rateLimiter.consume('test-client', 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5); // 10 new tokens - 5 consumed = 5 remaining

      jest.useRealTimers();
    });
  });
});

describe('GlobalRateLimiter', () => {
  let globalRateLimiter: GlobalRateLimiter;

  beforeEach(() => {
    globalRateLimiter = new GlobalRateLimiter();
  });

  it('应该能够获取或创建限流实例', () => {
    // 获取限流实例
    const limiter1 = globalRateLimiter.getLimiter('test-limiter');
    const limiter2 = globalRateLimiter.getLimiter('test-limiter');

    // 应该返回同一个实例
    expect(limiter1).toBe(limiter2);
  });

  it('应该能够更新默认限流配置', () => {
    // 更新默认配置
    globalRateLimiter.updateDefaultConfig({
      rate: 50,
      capacity: 100,
    });

    // 获取新的限流实例，应该使用更新后的默认配置
    const limiter = globalRateLimiter.getLimiter('new-limiter');
    const config = limiter.getConfig();
    expect(config.rate).toBe(50);
    expect(config.capacity).toBe(100);
  });

  it('应该能够删除限流实例', () => {
    // 创建限流实例
    globalRateLimiter.getLimiter('test-limiter');

    // 删除限流实例
    globalRateLimiter.deleteLimiter('test-limiter');

    // 再次获取，应该返回新的实例
    const limiter1 = globalRateLimiter.getLimiter('test-limiter');
    const limiter2 = globalRateLimiter.getLimiter('test-limiter');
    expect(limiter1).toBe(limiter2);
  });

  it('应该能够清空所有限流实例', () => {
    // 创建多个限流实例
    globalRateLimiter.getLimiter('limiter1');
    globalRateLimiter.getLimiter('limiter2');
    globalRateLimiter.getLimiter('limiter3');

    // 清空所有限流实例
    globalRateLimiter.clear();

    // 再次获取，应该返回新的实例
    const limiter1 = globalRateLimiter.getLimiter('limiter1');
    const limiter2 = globalRateLimiter.getLimiter('limiter1');
    expect(limiter1).toBe(limiter2);
  });
});
