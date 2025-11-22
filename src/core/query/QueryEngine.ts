// src/core/query/QueryEngine.ts

import type { FilterCondition } from "../../types/storageTypes";

export class QueryEngine {
  static filter<T extends Record<string, any>>(data: T[], condition?: FilterCondition): T[] {
    if (!condition) return data;
    return data.filter(item => this.matches(item, condition));
  }

  private static matches(item: Record<string, any>, condition: FilterCondition): boolean {
    if (typeof condition === "function") return condition(item);
    if ("$or" in condition) return condition.$or!.some((c: FilterCondition) => this.matches(item, c));
    if ("$and" in condition) return condition.$and!.every((c: FilterCondition) => this.matches(item, c));
    return Object.entries(condition).every(([k, v]) => item[k] === v);
  }

  static paginate<T>(data: T[], skip = 0, limit?: number): T[] {
    if (skip > 0) data = data.slice(skip);
    if (limit !== undefined) data = data.slice(0, limit);
    return data;
  }
}