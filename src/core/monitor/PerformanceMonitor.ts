// src/core/monitor/PerformanceMonitor.ts

/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
    /**
     * 操作类型
     */
    operation: string;
    /**
     * 操作耗时（毫秒）
     */
    duration: number;
    /**
     * 操作时间戳
     */
    timestamp: number;
    /**
     * 操作是否成功
     */
    success: boolean;
    /**
     * 操作数据量（如记录数）
     */
    dataSize?: number;
    /**
     * 错误信息（如果失败）
     */
    error?: string;
}

/**
 * 性能统计信息
 */
export interface PerformanceStats {
    /**
     * 操作总数
     */
    totalOperations: number;
    /**
     * 成功操作数
     */
    successfulOperations: number;
    /**
     * 失败操作数
     */
    failedOperations: number;
    /**
     * 平均耗时（毫秒）
     */
    averageDuration: number;
    /**
     * 最小耗时（毫秒）
     */
    minDuration: number;
    /**
     * 最大耗时（毫秒）
     */
    maxDuration: number;
    /**
     * 总耗时（毫秒）
     */
    totalDuration: number;
    /**
     * 成功率（百分比）
     */
    successRate: number;
}

/**
 * 性能监控器类
 * 用于收集和统计性能指标
 */
export class PerformanceMonitor {
    /**
     * 性能指标历史记录（保留最近1000条）
     */
    private metrics: PerformanceMetrics[] = [];
    
    /**
     * 最大保留记录数
     */
    private readonly maxRecords = 1000;
    
    /**
     * 操作统计（按操作类型分组）
     */
    private operationStats = new Map<string, PerformanceStats>();
    
    /**
     * 是否启用监控
     */
    private enabled: boolean = true;
    
    /**
     * 记录性能指标
     */
    record(metrics: PerformanceMetrics): void {
        if (!this.enabled) {
            return;
        }
        
        // 添加到历史记录
        this.metrics.push(metrics);
        
        // 限制记录数量
        if (this.metrics.length > this.maxRecords) {
            this.metrics.shift();
        }
        
        // 更新操作统计
        this.updateOperationStats(metrics);
    }
    
    /**
     * 更新操作统计
     */
    private updateOperationStats(metrics: PerformanceMetrics): void {
        const stats = this.operationStats.get(metrics.operation) || {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageDuration: 0,
            minDuration: Infinity,
            maxDuration: 0,
            totalDuration: 0,
            successRate: 0
        };
        
        stats.totalOperations++;
        if (metrics.success) {
            stats.successfulOperations++;
        } else {
            stats.failedOperations++;
        }
        
        stats.totalDuration += metrics.duration;
        stats.averageDuration = stats.totalDuration / stats.totalOperations;
        stats.minDuration = Math.min(stats.minDuration, metrics.duration);
        stats.maxDuration = Math.max(stats.maxDuration, metrics.duration);
        stats.successRate = (stats.successfulOperations / stats.totalOperations) * 100;
        
        this.operationStats.set(metrics.operation, stats);
    }
    
    /**
     * 获取所有性能指标
     */
    getMetrics(): PerformanceMetrics[] {
        return [...this.metrics];
    }
    
    /**
     * 获取操作统计信息
     */
    getOperationStats(operation?: string): PerformanceStats | Map<string, PerformanceStats> {
        if (operation) {
            return this.operationStats.get(operation) || {
                totalOperations: 0,
                successfulOperations: 0,
                failedOperations: 0,
                averageDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                totalDuration: 0,
                successRate: 0
            };
        }
        return new Map(this.operationStats);
    }
    
    /**
     * 获取总体统计信息
     */
    getOverallStats(): PerformanceStats {
        const allMetrics = this.metrics;
        if (allMetrics.length === 0) {
            return {
                totalOperations: 0,
                successfulOperations: 0,
                failedOperations: 0,
                averageDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                totalDuration: 0,
                successRate: 0
            };
        }
        
        const successful = allMetrics.filter(m => m.success).length;
        const totalDuration = allMetrics.reduce((sum, m) => sum + m.duration, 0);
        const durations = allMetrics.map(m => m.duration);
        
        return {
            totalOperations: allMetrics.length,
            successfulOperations: successful,
            failedOperations: allMetrics.length - successful,
            averageDuration: totalDuration / allMetrics.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
            totalDuration,
            successRate: (successful / allMetrics.length) * 100
        };
    }
    
    /**
     * 清除所有指标
     */
    clear(): void {
        this.metrics = [];
        this.operationStats.clear();
    }
    
    /**
     * 启用/禁用监控
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    
    /**
     * 是否启用监控
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}

/**
 * 全局性能监控器实例
 */
export const performanceMonitor = new PerformanceMonitor();

