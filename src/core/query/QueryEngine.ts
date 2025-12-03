// src/core/query/QueryEngine.ts

import type { FilterCondition } from "../../types/storageTypes";
import {
    sortByColumn,
    sortByColumnCounting,
    sortByColumnFast,
    sortByColumnMerge,
    sortByColumnSlow
} from "../../utils/sortingTools";
import { QUERY } from "../constants";

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
     * 获取排序函数
     * 根据算法类型返回对应的排序函数
     */
    private static getSortFunction(algorithm: string = "default"): Function {
        switch (algorithm) {
            case "fast":
                return sortByColumnFast;
            case "counting":
                return sortByColumnCounting;
            case "merge":
                return sortByColumnMerge;
            case "slow":
                return sortByColumnSlow;
            case "default":
            default:
                return sortByColumn;
        }
    }

    /**
     * 智能选择排序算法
     * 根据数据特征自动选择最合适的排序算法
     */
    private static selectSortAlgorithm(
        requestedAlgorithm: string | undefined,
        data: any[],
        sortBy: string | string[]
    ): string {
        // 如果用户指定了算法，直接使用
        if (requestedAlgorithm && requestedAlgorithm !== "default") {
            return requestedAlgorithm;
        }

        // 智能选择算法
        const dataSize = data.length;
        const sortFields = Array.isArray(sortBy) ? sortBy : [sortBy];

        // 小数据集使用默认算法
        if (dataSize < QUERY.COUNTING_SORT_THRESHOLD) {
            return "default";
        }

        // 大数据集使用归并排序（稳定且高效）
        if (dataSize > QUERY.MERGE_SORT_THRESHOLD) {
            return "merge";
        }

        // 检查是否适合计数排序（字段值范围有限）
        if (sortFields.length === 1 && this.isSuitableForCountingSort(data, sortFields[0])) {
            return "counting";
        }

        // 默认使用归并排序（平衡稳定性和性能）
        return "merge";
    }

    /**
     * 判断字段是否适合计数排序
     */
    private static isSuitableForCountingSort(data: any[], field: string): boolean {
        if (data.length === 0) return false;

        const values = new Set();
        let uniqueCount = 0;

        // 收集唯一值，限制检查数量以提高性能
        const sampleSize = Math.min(data.length, 1000);
        for (let i = 0; i < sampleSize && uniqueCount < 50; i++) {
            const value = data[i][field];
            if (value !== null && value !== undefined) {
                if (!values.has(value)) {
                    values.add(value);
                    uniqueCount++;
                }
            }
        }

        // 如果唯一值数量少于总数的10%，且绝对数量小于阈值，适合计数排序
        return uniqueCount < Math.min(data.length * 0.1, QUERY.COUNTING_SORT_THRESHOLD);
    }

    /**
     * 排序数据
     * 支持多种排序算法和多字段排序
     */
    static sort<T extends Record<string, any>>(
        data: T[],
        sortBy?: string | string[],
        order?: "asc" | "desc" | ("asc" | "desc")[],
        algorithm?: string
    ): T[] {
        if (!sortBy || data.length === 0) return data;

        // 选择排序算法
        const selectedAlgorithm = this.selectSortAlgorithm(algorithm, data, sortBy);
        const sortFunction = this.getSortFunction(selectedAlgorithm);

        // 处理多字段排序
        if (Array.isArray(sortBy)) {
            const sortOrders = Array.isArray(order) ? order : new Array(sortBy.length).fill(order || "asc");

            // 递归应用排序，从最后一个字段开始向前排序
            let sortedData = [...data];
            for (let i = sortBy.length - 1; i >= 0; i--) {
                const field = sortBy[i];
                const fieldOrder = sortOrders[i] || "asc";
                sortedData = sortFunction(sortedData, field, fieldOrder);
            }
            return sortedData;
        } else {
            // 单字段排序
            const sortOrder = Array.isArray(order) ? order[0] : (order || "asc");
            return sortFunction(data, sortBy, sortOrder);
        }
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