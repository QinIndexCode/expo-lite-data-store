import { RATE_LIMIT } from "../constants";
import { RateLimiter, RateLimitStatus } from "./RateLimiter.js";

/**
 * 限流包装器，负责API限流逻辑
 */
export class RateLimitWrapper {
    private rateLimiter: RateLimiter;

    /**
     * 构造函数
     * @param options 限流配置选项
     */
    constructor(options: {
        rate?: number;
        capacity?: number;
        enabled?: boolean;
    } = {}) {
        this.rateLimiter = new RateLimiter({
            rate: options.rate || RATE_LIMIT.DEFAULT_RATE,
            capacity: options.capacity || RATE_LIMIT.DEFAULT_CAPACITY,
            enabled: options.enabled !== false
        });
    }

    /**
     * 检查限流状态
     * @param clientId 客户端ID
     * @param tokens 请求的令牌数
     * @returns 限流状态
     */
    checkRateLimit(clientId: string = "default", tokens: number = 1): RateLimitStatus {
        return this.rateLimiter.consume(clientId, tokens);
    }

    /**
     * 重置限流器
     * @param clientId 客户端ID，默认为"default"
     */
    reset(clientId: string = "default"): void {
        this.rateLimiter.reset(clientId);
    }
}
