// src/core/query/QueryEngine.ts

import type { FilterCondition } from "../../types/storageTypes";

/**
 * 查询操作符类型
 */
type Operator = "$eq" | "$ne" | "$gt" | "$gte" | "$lt" | "$lte" | "$in" | "$nin" | "$like" | "$and" | "$or";

/**
 * 操作符映射表，将操作符映射到对应的比较函数
 */
const operators: Record<Operator, (a: any, b: any) => boolean> = {
    $eq: (a, b) => a === b,
    $ne: (a, b) => a !== b,
    $gt: (a, b) => a > b,
    $gte: (a, b) => a >= b,
    $lt: (a, b) => a < b,
    $lte: (a, b) => a <= b,
    $in: (a, b) => {
        if (!Array.isArray(b)) return false;
        if (Array.isArray(a)) {
            // 字段值是数组，检查是否有交集
            return a.some(item => b.includes(item));
        }
        // 字段值不是数组，检查是否在查询数组中
        return b.includes(a);
    },
    $nin: (a, b) => {
        if (!Array.isArray(b)) return true;
        if (Array.isArray(a)) {
            // 字段值是数组，检查是否没有交集
            return !a.some(item => b.includes(item));
        }
        // 字段值不是数组，检查是否不在查询数组中
        return !b.includes(a);
    },
    $like: (a, b) => {
        if (typeof a !== "string" || typeof b !== "string") return false;
        // 简单的LIKE实现，支持%通配符
        const pattern = b.replace(/%/g, ".*");
        const regex = new RegExp(`^${pattern}$`, "i");
        return regex.test(a);
    },
    $and: () => false, // 特殊处理，不在这里使用
    $or: () => false    // 特殊处理，不在这里使用
};

/**
 * 查询计划类型定义
 */
const QueryPlan = {
    FunctionPlan: "function",
    OrPlan: "or",
    AndPlan: "and",
    OperatorPlan: "operator"
} as const;

/**
 * 查询计划类型
 */
type QueryPlanType = typeof QueryPlan;

/**
 * 查询计划接口
 */
type QueryPlan = {
    type: typeof QueryPlan[keyof typeof QueryPlan];
};

/**
 * 函数查询计划
 */
type FunctionQueryPlan = QueryPlan & {
    type: typeof QueryPlan.FunctionPlan;
    condition: (item: any) => boolean;
};

/**
 * OR查询计划
 */
type OrQueryPlan = QueryPlan & {
    type: typeof QueryPlan.OrPlan;
    conditions: QueryPlan[];
};

/**
 * AND查询计划
 */
type AndQueryPlan = QueryPlan & {
    type: typeof QueryPlan.AndPlan;
    conditions: QueryPlan[];
};

/**
 * 操作符查询计划
 */
type OperatorQueryPlan = QueryPlan & {
    type: typeof QueryPlan.OperatorPlan;
    key: string;
    operator: Operator;
    value: any;
};

export class QueryEngine {
    /**
     * 过滤数据，支持多种查询操作符
     */
    static filter<T extends Record<string, any>>(data: T[], condition?: FilterCondition): T[] {
        if (!condition) return data;
        
        // 生成查询计划
        const queryPlan = this.generateQueryPlan(condition);
        
        // 执行查询计划
        return data.filter(item => this.executeQueryPlan(item, queryPlan));
    }

    /**
     * 生成查询计划，将条件转换为更高效的执行结构
     */
    private static generateQueryPlan(condition: FilterCondition): QueryPlan {
        if (typeof condition === "function") {
            return {
                type: QueryPlan.FunctionPlan,
                condition
            } as FunctionQueryPlan;
        }
        
        if ("$or" in condition) {
            return {
                type: QueryPlan.OrPlan,
                conditions: condition.$or!.map((c: FilterCondition) => this.generateQueryPlan(c))
            } as OrQueryPlan;
        }
        
        if ("$and" in condition) {
            return {
                type: QueryPlan.AndPlan,
                conditions: condition.$and!.map((c: FilterCondition) => this.generateQueryPlan(c))
            } as AndQueryPlan;
        }
        
        // 处理普通条件，转换为操作符条件
        const processedConditions: QueryPlan[] = [];
        
        for (const [key, value] of Object.entries(condition)) {
            // 如果值是对象，检查是否包含操作符
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                for (const [op, opValue] of Object.entries(value)) {
                    if (op in operators) {
                        processedConditions.push({
                            type: QueryPlan.OperatorPlan,
                            key,
                            operator: op as Operator,
                            value: opValue
                        } as OperatorQueryPlan);
                    }
                }
            } else {
                // 默认为等于操作
                processedConditions.push({
                    type: QueryPlan.OperatorPlan,
                    key,
                    operator: "$eq",
                    value
                } as OperatorQueryPlan);
            }
        }
        
        return {
            type: QueryPlan.AndPlan,
            conditions: processedConditions
        } as AndQueryPlan;
    }

    /**
     * 执行查询计划
     */
    private static executeQueryPlan(item: Record<string, any>, queryPlan: QueryPlan): boolean {
        switch (queryPlan.type) {
            case QueryPlan.FunctionPlan:
                return (queryPlan as FunctionQueryPlan).condition(item);
            
            case QueryPlan.OrPlan:
                return (queryPlan as OrQueryPlan).conditions.some((condition: QueryPlan) => this.executeQueryPlan(item, condition));
            
            case QueryPlan.AndPlan:
                return (queryPlan as AndQueryPlan).conditions.every((condition: QueryPlan) => this.executeQueryPlan(item, condition));
            
            case QueryPlan.OperatorPlan:
                const { key, operator, value } = queryPlan as OperatorQueryPlan;
                const itemValue = item[key];
                
                // 处理undefined值的情况
                if (itemValue === undefined) {
                    return false;
                }
                
                // 使用操作符映射表执行比较
                return operators[operator](itemValue, value);
            
            default:
                return false;
        }
    }

    /**
     * 分页处理，优化切片操作
     */
    static paginate<T>(data: T[], skip = 0, limit?: number): T[] {
        // 优化：如果skip大于等于数据长度，直接返回空数组
        if (skip >= data.length) {
            return [];
        }
        
        // 优化：计算实际需要的结束索引
        const startIndex = skip;
        const endIndex = limit !== undefined ? Math.min(startIndex + limit, data.length) : data.length;
        
        // 优化：如果startIndex为0且endIndex为数据长度，直接返回原数组
        if (startIndex === 0 && endIndex === data.length) {
            return data;
        }
        
        return data.slice(startIndex, endIndex);
    }

    /**
     * 排序数据
     */
    static sort<T extends Record<string, any>>(data: T[], sortBy?: string | string[], order?: "asc" | "desc" | ("asc" | "desc")[]): T[] {
        if (!sortBy) return data;
        
        const sortFields = Array.isArray(sortBy) ? sortBy : [sortBy];
        const sortOrder = Array.isArray(order) ? order : [order || "asc"];
        
        return [...data].sort((a, b) => {
            for (let i = 0; i < sortFields.length; i++) {
                const field = sortFields[i];
                const dir = sortOrder[i] || "asc";
                
                if (a[field] < b[field]) return dir === "asc" ? -1 : 1;
                if (a[field] > b[field]) return dir === "asc" ? 1 : -1;
            }
            return 0;
        });
    }

    /**
     * 聚合查询，计算总和
     */
    static sum<T extends Record<string, any>>(data: T[], field: string): number {
        return data.reduce((acc, item) => {
            const value = item[field];
            return acc + (typeof value === "number" ? value : 0);
        }, 0);
    }

    /**
     * 聚合查询，计算平均值
     */
    static avg<T extends Record<string, any>>(data: T[], field: string): number {
        if (data.length === 0) return 0;
        const sum = this.sum(data, field);
        return sum / data.length;
    }

    /**
     * 聚合查询，计算最大值
     */
    static max<T extends Record<string, any>>(data: T[], field: string): any {
        if (data.length === 0) return undefined;
        return data.reduce((max, item) => {
            const value = item[field];
            return (max === undefined || value > max) ? value : max;
        }, undefined);
    }

    /**
     * 聚合查询，计算最小值
     */
    static min<T extends Record<string, any>>(data: T[], field: string): any {
        if (data.length === 0) return undefined;
        return data.reduce((min, item) => {
            const value = item[field];
            return (min === undefined || value < min) ? value : min;
        }, undefined);
    }

    /**
     * 分组查询
     */
    static groupBy<T extends Record<string, any>>(data: T[], groupBy: string | string[]): Record<string, T[]> {
        const groups: Record<string, T[]> = {};
        const groupFields = Array.isArray(groupBy) ? groupBy : [groupBy];
        
        for (const item of data) {
            // 生成分组键
            const key = groupFields.map(field => item[field]).join("_");
            
            if (!groups[key]) {
                groups[key] = [];
            }
            
            groups[key].push(item);
        }
        
        return groups;
    }
}