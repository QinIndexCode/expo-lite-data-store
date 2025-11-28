// src/core/api/__tests__/RateLimiter.test.ts
// RateLimiter 单元测试

import { RateLimiter, GlobalRateLimiter } from '../RateLimiter';

describe('RateLimiter', () => {
    let rateLimiter: RateLimiter;
    
    beforeEach(() => {
        // 创建新的RateLimiter实例用于每个测试
        rateLimiter = new RateLimiter({
            rate: 10, // 每秒10个请求
            capacity: 20, // 令牌桶容量20
            enabled: true
        });
    });
    
    describe('基本功能测试', () => {
        it('应该能够检查请求是否允许', () => {
            // 初始状态，应该允许请求
            const result = rateLimiter.check('test-client');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(19); // 消耗了1个令牌
        });
        
        it('应该能够消耗指定数量的令牌', () => {
            // 消耗5个令牌
            const result = rateLimiter.consume('test-client', 5);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(15); // 消耗了5个令牌
        });
        
        it('应该拒绝超出限制的请求', () => {
            // 消耗超过容量的令牌
            const result = rateLimiter.consume('test-client', 30);
            expect(result.allowed).toBe(false);
            expect(result.retryAfter).toBeDefined();
        });
        
        it('应该能够重置客户端限流信息', () => {
            // 消耗一些令牌
            rateLimiter.consume('test-client', 5);
            expect(rateLimiter.getClientInfo('test-client')?.tokens).toBe(15);
            
            // 重置客户端限流信息
            rateLimiter.reset('test-client');
            expect(rateLimiter.getClientInfo('test-client')).toBeUndefined();
        });
        
        it('应该能够清空所有客户端限流信息', () => {
            // 为多个客户端消耗令牌
            rateLimiter.consume('client1', 5);
            rateLimiter.consume('client2', 3);
            rateLimiter.consume('client3', 7);
            
            // 清空所有客户端限流信息
            rateLimiter.clear();
            
            // 检查结果
            expect(rateLimiter.getClientInfo('client1')).toBeUndefined();
            expect(rateLimiter.getClientInfo('client2')).toBeUndefined();
            expect(rateLimiter.getClientInfo('client3')).toBeUndefined();
        });
    });
    
    describe('限流配置测试', () => {
        it('应该能够更新限流配置', () => {
            // 更新配置
            rateLimiter.updateConfig({
                rate: 20,
                capacity: 40
            });
            
            // 检查更新后的配置
            const config = rateLimiter.getConfig();
            expect(config.rate).toBe(20);
            expect(config.capacity).toBe(40);
        });
        
        it('应该能够禁用限流', () => {
            // 禁用限流
            rateLimiter.updateConfig({ enabled: false });
            
            // 检查结果
            const result = rateLimiter.consume('test-client', 100);
            expect(result.allowed).toBe(true);
        });
        
        it('应该能够启用限流', () => {
            // 先禁用限流
            rateLimiter.updateConfig({ enabled: false });
            expect(rateLimiter.consume('test-client', 100).allowed).toBe(true);
            
            // 启用限流
            rateLimiter.updateConfig({ enabled: true });
            expect(rateLimiter.consume('test-client', 100).allowed).toBe(false);
        });
    });
    
    describe('令牌生成测试', () => {
        it('应该能够随时间生成新令牌', () => {
            // 消耗所有令牌
            rateLimiter.consume('test-client', 20);
            expect(rateLimiter.consume('test-client', 1).allowed).toBe(false);
            
            // 模拟时间流逝，生成新令牌
            jest.useFakeTimers();
            
            // 等待1秒，应该生成10个新令牌
            jest.advanceTimersByTime(1000);
            
            // 检查结果
            const result = rateLimiter.consume('test-client', 5);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(5); // 10个新令牌 - 5个消耗 = 5个剩余
            
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
            capacity: 100
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
