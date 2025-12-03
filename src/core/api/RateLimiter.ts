// src/core/api/RateLimiter.ts
// API限流机制，基于令牌桶算法

import { RATE_LIMIT } from "../constants";

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
}

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
    
    /**
     * 构造函数
     * @param config 限流配置
     */
    constructor(config: Partial<RateLimitConfig> = {}) {
        this.config = {
            rate: config.rate || RATE_LIMIT.DEFAULT_RATE, // 默认每秒请求数
            capacity: config.capacity || RATE_LIMIT.DEFAULT_CAPACITY, // 默认令牌桶容量
            enabled: config.enabled !== false // 默认启用限流
        };
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
                resetTime: Date.now() + 1000
            };
        }
        
        const now = Date.now();
        let clientInfo = this.clientLimits.get(clientId);
        
        if (!clientInfo) {
            // 新客户端，初始化令牌桶
            clientInfo = {
                lastRequestTime: now,
                tokens: this.config.capacity - 1 // 消耗一个令牌
            };
            this.clientLimits.set(clientId, clientInfo);
            
            return {
                allowed: true,
                remaining: clientInfo.tokens,
                resetTime: now + 1000
            };
        }
        
        // 计算时间差，生成新令牌
        const timeElapsed = now - clientInfo.lastRequestTime;
        const newTokens = Math.floor((timeElapsed / 1000) * this.config.rate);
        
        if (newTokens > 0) {
            // 更新令牌数，不超过容量
            clientInfo.tokens = Math.min(
                clientInfo.tokens + newTokens,
                this.config.capacity
            );
            clientInfo.lastRequestTime = now;
        }
        
        if (clientInfo.tokens > 0) {
            // 有令牌，允许请求
            clientInfo.tokens--;
            this.clientLimits.set(clientId, clientInfo);
            
            return {
                allowed: true,
                remaining: clientInfo.tokens,
                resetTime: now + 1000
            };
        } else {
            // 没有令牌，拒绝请求
            // 计算需要等待的时间
            const retryAfter = Math.ceil((1 - (timeElapsed / 1000)) * 1000);
            
            return {
                allowed: false,
                remaining: 0,
                resetTime: now + 1000,
                retryAfter: retryAfter > 0 ? retryAfter : 1000
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
        if (!this.config.enabled) {
            return {
                allowed: true,
                remaining: this.config.capacity,
                resetTime: Date.now() + 1000
            };
        }
        
        const now = Date.now();
        let clientInfo = this.clientLimits.get(clientId);
        
        if (!clientInfo) {
            // 新客户端，初始化令牌桶
            clientInfo = {
                lastRequestTime: now,
                tokens: this.config.capacity
            };
        }
        
        // 计算时间差，生成新令牌
        const timeElapsed = now - clientInfo.lastRequestTime;
        const newTokens = Math.floor((timeElapsed / 1000) * this.config.rate);
        
        if (newTokens > 0) {
            // 更新令牌数，不超过容量
            clientInfo.tokens = Math.min(
                clientInfo.tokens + newTokens,
                this.config.capacity
            );
            clientInfo.lastRequestTime = now;
        }
        
        if (clientInfo.tokens >= tokens) {
            // 有足够令牌，允许请求
            clientInfo.tokens -= tokens;
            this.clientLimits.set(clientId, clientInfo);
            
            return {
                allowed: true,
                remaining: clientInfo.tokens,
                resetTime: now + 1000
            };
        } else {
            // 没有足够令牌，拒绝请求
            // 计算需要等待的时间
            const tokensNeeded = tokens - clientInfo.tokens;
            const retryAfter = Math.ceil((tokensNeeded / this.config.rate) * 1000);
            
            return {
                allowed: false,
                remaining: clientInfo.tokens,
                resetTime: now + 1000,
                retryAfter
            };
        }
    }
    
    /**
     * 重置客户端限流信息
     * @param clientId 客户端ID
     */
    reset(clientId: string): void {
        this.clientLimits.delete(clientId);
    }
    
    /**
     * 获取客户端限流信息
     * @param clientId 客户端ID
     * @returns 客户端限流信息，如果不存在则返回undefined
     */
    getClientInfo(clientId: string): ClientRateLimitInfo | undefined {
        return this.clientLimits.get(clientId);
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
        this.config = {
            ...this.config,
            ...config
        };
    }
    
    /**
     * 获取当前限流配置
     * @returns 当前限流配置
     */
    getConfig(): RateLimitConfig {
        return { ...this.config };
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
        rate: 100,
        capacity: 200,
        enabled: true
    };
    
    /**
     * 获取或创建限流实例
     * @param key 限流实例键
     * @param config 限流配置
     * @returns 限流实例
     */
    getLimiter(key: string, config?: Partial<RateLimitConfig>): RateLimiter {
        if (!this.limiters.has(key)) {
            this.limiters.set(key, new RateLimiter({
                ...this.defaultConfig,
                ...config
            }));
        }
        
        return this.limiters.get(key)!;
    }
    
    /**
     * 更新默认限流配置
     * @param config 新的默认限流配置
     */
    updateDefaultConfig(config: Partial<RateLimitConfig>): void {
        this.defaultConfig = {
            ...this.defaultConfig,
            ...config
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
        this.limiters.delete(key);
    }
    
    /**
     * 清除所有限流实例
     */
    clear(): void {
        this.limiters.clear();
    }
}

// 全局限流管理器实例
export const globalRateLimiter = new GlobalRateLimiter();
