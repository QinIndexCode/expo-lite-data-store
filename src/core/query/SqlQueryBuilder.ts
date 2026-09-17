import type { FilterCondition, SortField, SortOrder, StorageRecord } from '../../types/storageTypes';
import { isStorageRecord } from '../../types/storageTypes';

const SAFE_FIELD_REGEX = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
const SUPPORTED_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$like']);

export type SqlBindValue = string | number | null;

export interface SqlConditionResult {
  sql: string;
  params: SqlBindValue[];
  canPushdown: boolean;
}

export interface SqlFindQueryResult {
  sql: string;
  params: SqlBindValue[];
  canPushdown: boolean;
}

export interface SqlOrderByResult {
  sql: string;
  canPushdown: boolean;
}

export interface SqlPaginationResult {
  sql: string;
  params: number[];
  canPushdown: boolean;
}

export class SqlQueryBuilder {
  /**
   * Sanitizes table and field names for safe index identifier naming.
   */
  static cleanIdentifier(identifier: string): string {
    return identifier.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Validates whether a field path can be safely converted to a SQLite JSON path.
   */
  static isSafeField(field: string): boolean {
    return typeof field === 'string' && SAFE_FIELD_REGEX.test(field);
  }

  /**
   * Generates a literal SQLite JSON1 path expression for a validated field name.
   */
  static getJsonPath(field: string): string | null {
    if (!this.isSafeField(field)) {
      return null;
    }
    return `$.${field}`;
  }

  /**
   * Generates a SQL expression representing the extracted JSON field value.
   */
  static getJsonExtractExpr(field: string): string | null {
    const path = this.getJsonPath(field);
    if (!path) {
      return null;
    }
    return `json_extract(payload, '${path}')`;
  }

  /**
   * Generates a DDL statement to create a native SQLite expression index on a JSON payload field.
   */
  static buildIndexStatement(tableName: string, field: string, unique = false): string | null {
    if (!this.isSafeField(field)) {
      return null;
    }
    const cleanTable = this.cleanIdentifier(tableName);
    const cleanField = this.cleanIdentifier(field);
    const indexName = `idx_${cleanTable}__${cleanField}`;
    const uniquePrefix = unique ? 'UNIQUE ' : '';
    const extractExpr = this.getJsonExtractExpr(field);
    return `CREATE ${uniquePrefix}INDEX IF NOT EXISTS ${indexName} ON __elds_records (table_name, ${extractExpr})`;
  }

  /**
   * Generates a DDL statement to drop an expression index.
   */
  static buildDropIndexStatement(tableName: string, field: string): string | null {
    if (!this.isSafeField(field)) {
      return null;
    }
    const cleanTable = this.cleanIdentifier(tableName);
    const cleanField = this.cleanIdentifier(field);
    const indexName = `idx_${cleanTable}__${cleanField}`;
    return `DROP INDEX IF EXISTS ${indexName}`;
  }

  /**
   * Normalizes parameter values for SQLite binding (e.g. converting booleans to 1 / 0).
   */
  static normalizeParam(val: unknown): SqlBindValue {
    if (typeof val === 'boolean') {
      return val ? 1 : 0;
    }
    if (typeof val === 'bigint') {
      return Number(val);
    }
    if (typeof val === 'number') {
      return Number.isNaN(val) ? null : val;
    }
    if (typeof val === 'string') {
      return val;
    }
    return null;
  }

  /**
   * Translates a single operator or equality condition into SQL.
   */
  private static buildFieldCondition(field: string, value: unknown): SqlConditionResult {
    if (!this.isSafeField(field)) {
      return { sql: '', params: [], canPushdown: false };
    }

    const extractExpr = this.getJsonExtractExpr(field);
    if (!extractExpr) {
      return { sql: '', params: [], canPushdown: false };
    }

    if (value === null || value === undefined) {
      return {
        sql: `${extractExpr} IS NULL`,
        params: [],
        canPushdown: true,
      };
    }

    if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string' ||
      typeof value === 'bigint'
    ) {
      return {
        sql: `${extractExpr} = ?`,
        params: [this.normalizeParam(value)],
        canPushdown: true,
      };
    }

    if (isStorageRecord(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return { sql: '1 = 1', params: [], canPushdown: true };
      }

      const isAllOperators = keys.every(k => k.startsWith('$'));
      if (!isAllOperators) {
        return { sql: '', params: [], canPushdown: false };
      }

      const opClauses: string[] = [];
      const opParams: SqlBindValue[] = [];

      for (const [op, opVal] of Object.entries(value)) {
        if (!SUPPORTED_OPERATORS.has(op)) {
          return { sql: '', params: [], canPushdown: false };
        }

        switch (op) {
          case '$eq': {
            if (opVal === null || opVal === undefined) {
              opClauses.push(`${extractExpr} IS NULL`);
            } else if (
              typeof opVal === 'boolean' ||
              typeof opVal === 'number' ||
              typeof opVal === 'string' ||
              typeof opVal === 'bigint'
            ) {
              opClauses.push(`${extractExpr} = ?`);
              opParams.push(this.normalizeParam(opVal));
            } else {
              return { sql: '', params: [], canPushdown: false };
            }
            break;
          }

          case '$ne': {
            if (opVal === null || opVal === undefined) {
              opClauses.push(`${extractExpr} IS NOT NULL`);
            } else if (
              typeof opVal === 'boolean' ||
              typeof opVal === 'number' ||
              typeof opVal === 'string' ||
              typeof opVal === 'bigint'
            ) {
              opClauses.push(`(${extractExpr} IS NULL OR ${extractExpr} != ?)`);
              opParams.push(this.normalizeParam(opVal));
            } else {
              return { sql: '', params: [], canPushdown: false };
            }
            break;
          }

          case '$gt': {
            if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            opClauses.push(`(typeof(${extractExpr}) IN ('integer', 'real') AND ${extractExpr} > ?)`);
            opParams.push(opVal);
            break;
          }

          case '$gte': {
            if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            opClauses.push(`(typeof(${extractExpr}) IN ('integer', 'real') AND ${extractExpr} >= ?)`);
            opParams.push(opVal);
            break;
          }

          case '$lt': {
            if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            opClauses.push(`(typeof(${extractExpr}) IN ('integer', 'real') AND ${extractExpr} < ?)`);
            opParams.push(opVal);
            break;
          }

          case '$lte': {
            if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            opClauses.push(`(typeof(${extractExpr}) IN ('integer', 'real') AND ${extractExpr} <= ?)`);
            opParams.push(opVal);
            break;
          }

          case '$in': {
            if (!Array.isArray(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            if (opVal.length === 0) {
              opClauses.push('1 = 0');
              break;
            }

            const hasNull = opVal.some(v => v === null || v === undefined);
            const nonNullValues = opVal.filter(v => v !== null && v !== undefined);

            if (nonNullValues.length === 0) {
              opClauses.push(`${extractExpr} IS NULL`);
            } else {
              const placeholders = nonNullValues.map(() => '?').join(', ');
              const inExpr = `${extractExpr} IN (${placeholders})`;
              opParams.push(...nonNullValues.map(v => this.normalizeParam(v)));

              if (hasNull) {
                opClauses.push(`(${extractExpr} IS NULL OR ${inExpr})`);
              } else {
                opClauses.push(inExpr);
              }
            }
            break;
          }

          case '$nin': {
            if (!Array.isArray(opVal)) {
              return { sql: '', params: [], canPushdown: false };
            }
            if (opVal.length === 0) {
              opClauses.push('1 = 1');
              break;
            }

            const hasNull = opVal.some(v => v === null || v === undefined);
            const nonNullValues = opVal.filter(v => v !== null && v !== undefined);

            if (nonNullValues.length === 0) {
              opClauses.push(`${extractExpr} IS NOT NULL`);
            } else {
              const placeholders = nonNullValues.map(() => '?').join(', ');
              const notInExpr = `${extractExpr} NOT IN (${placeholders})`;
              opParams.push(...nonNullValues.map(v => this.normalizeParam(v)));

              if (hasNull) {
                opClauses.push(`(${extractExpr} IS NOT NULL AND ${notInExpr})`);
              } else {
                opClauses.push(`(${extractExpr} IS NULL OR ${notInExpr})`);
              }
            }
            break;
          }

          case '$like': {
            if (typeof opVal !== 'string') {
              return { sql: '', params: [], canPushdown: false };
            }
            opClauses.push(`(typeof(${extractExpr}) = 'text' AND ${extractExpr} LIKE ?)`);
            opParams.push(opVal);
            break;
          }

          default:
            return { sql: '', params: [], canPushdown: false };
        }
      }

      if (opClauses.length === 1) {
        return {
          sql: opClauses[0]!,
          params: opParams,
          canPushdown: true,
        };
      }

      return {
        sql: `(${opClauses.join(' AND ')})`,
        params: opParams,
        canPushdown: true,
      };
    }

    return { sql: '', params: [], canPushdown: false };
  }

  /**
   * Compiles an arbitrary FilterCondition into a SQL expression and parameter array.
   */
  static buildCondition(condition?: FilterCondition<StorageRecord>, depth = 0): SqlConditionResult {
    if (depth > 10) {
      return { sql: '', params: [], canPushdown: false };
    }

    if (!condition) {
      return { sql: '1 = 1', params: [], canPushdown: true };
    }

    if (typeof condition === 'function') {
      return { sql: '', params: [], canPushdown: false };
    }

    if (!isStorageRecord(condition)) {
      return { sql: '', params: [], canPushdown: false };
    }

    const record = condition as StorageRecord;
    const entries = Object.entries(record);
    if (entries.length === 0) {
      return { sql: '1 = 1', params: [], canPushdown: true };
    }

    const clauses: string[] = [];
    const params: SqlBindValue[] = [];

    for (const [field, value] of entries) {
      if (field === '$and') {
        if (!Array.isArray(value)) {
          return { sql: '', params: [], canPushdown: false };
        }
        if (value.length === 0) {
          clauses.push('1 = 1');
          continue;
        }
        const subClauses: string[] = [];
        for (const sub of value) {
          const built = this.buildCondition(sub as FilterCondition<StorageRecord>, depth + 1);
          if (!built.canPushdown) {
            return { sql: '', params: [], canPushdown: false };
          }
          subClauses.push(built.sql);
          params.push(...built.params);
        }
        clauses.push(`(${subClauses.join(' AND ')})`);
      } else if (field === '$or') {
        if (!Array.isArray(value)) {
          return { sql: '', params: [], canPushdown: false };
        }
        if (value.length === 0) {
          clauses.push('1 = 0');
          continue;
        }
        const subClauses: string[] = [];
        for (const sub of value) {
          const built = this.buildCondition(sub as FilterCondition<StorageRecord>, depth + 1);
          if (!built.canPushdown) {
            return { sql: '', params: [], canPushdown: false };
          }
          subClauses.push(built.sql);
          params.push(...built.params);
        }
        clauses.push(`(${subClauses.join(' OR ')})`);
      } else {
        const fieldBuilt = this.buildFieldCondition(field, value);
        if (!fieldBuilt.canPushdown) {
          return { sql: '', params: [], canPushdown: false };
        }
        clauses.push(fieldBuilt.sql);
        params.push(...fieldBuilt.params);
      }
    }

    if (clauses.length === 1) {
      return {
        sql: clauses[0]!,
        params,
        canPushdown: true,
      };
    }

    return {
      sql: `(${clauses.join(' AND ')})`,
      params,
      canPushdown: true,
    };
  }

  /**
   * Compiles sorting criteria into an ORDER BY clause.
   */
  static buildOrderByClause(
    sortBy?: SortField<StorageRecord> | SortField<StorageRecord>[],
    order?: SortOrder | SortOrder[]
  ): SqlOrderByResult {
    if (!sortBy) {
      return { sql: 'ORDER BY id ASC', canPushdown: true };
    }

    const fields = Array.isArray(sortBy) ? sortBy : [sortBy];
    const orders = Array.isArray(order) ? order : [order];

    if (fields.length === 0) {
      return { sql: 'ORDER BY id ASC', canPushdown: true };
    }

    const clauses: string[] = [];

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field || typeof field !== 'string') {
        return { sql: '', canPushdown: false };
      }

      const extractExpr = this.getJsonExtractExpr(field);
      if (!extractExpr) {
        return { sql: '', canPushdown: false };
      }

      const fieldOrder = orders[i] || orders[0] || 'asc';
      const dir = fieldOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      clauses.push(`${extractExpr} ${dir} NULLS LAST`);
    }

    clauses.push('id ASC');
    return {
      sql: `ORDER BY ${clauses.join(', ')}`,
      canPushdown: true,
    };
  }

  /**
   * Compiles pagination criteria into LIMIT / OFFSET clauses.
   */
  static buildPaginationClause(skip?: number, limit?: number): SqlPaginationResult {
    if (skip !== undefined) {
      if (!Number.isSafeInteger(skip) || skip < 0) {
        return { sql: '', params: [], canPushdown: false };
      }
    }
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        return { sql: '', params: [], canPushdown: false };
      }
    }

    if (limit !== undefined && skip !== undefined) {
      return {
        sql: 'LIMIT ? OFFSET ?',
        params: [limit, skip],
        canPushdown: true,
      };
    }

    if (limit !== undefined) {
      return {
        sql: 'LIMIT ?',
        params: [limit],
        canPushdown: true,
      };
    }

    if (skip !== undefined) {
      return {
        sql: 'LIMIT -1 OFFSET ?',
        params: [skip],
        canPushdown: true,
      };
    }

    return {
      sql: '',
      params: [],
      canPushdown: true,
    };
  }

  /**
   * Builds the complete SELECT query for findMany / findOne pushdown.
   */
  static buildFindQuery(
    tableName: string,
    condition?: FilterCondition<StorageRecord>,
    options?: {
      sortBy?: SortField<StorageRecord> | SortField<StorageRecord>[];
      order?: SortOrder | SortOrder[];
      skip?: number;
      limit?: number;
    }
  ): SqlFindQueryResult {
    const whereBuilt = this.buildCondition(condition);
    if (!whereBuilt.canPushdown) {
      return { sql: '', params: [], canPushdown: false };
    }

    const orderBuilt = this.buildOrderByClause(options?.sortBy, options?.order);
    if (!orderBuilt.canPushdown) {
      return { sql: '', params: [], canPushdown: false };
    }

    const pageBuilt = this.buildPaginationClause(options?.skip, options?.limit);
    if (!pageBuilt.canPushdown) {
      return { sql: '', params: [], canPushdown: false };
    }

    const whereClause = `table_name = ? AND ${whereBuilt.sql}`;
    const queryParts = [`SELECT id, payload FROM __elds_records WHERE ${whereClause}`, orderBuilt.sql];

    if (pageBuilt.sql) {
      queryParts.push(pageBuilt.sql);
    }

    return {
      sql: queryParts.join(' '),
      params: [tableName, ...whereBuilt.params, ...pageBuilt.params],
      canPushdown: true,
    };
  }

  /**
   * Builds the pushdown COUNT query.
   */
  static buildCountQuery(tableName: string, condition?: FilterCondition<StorageRecord>): SqlConditionResult {
    const whereBuilt = this.buildCondition(condition);
    if (!whereBuilt.canPushdown) {
      return { sql: '', params: [], canPushdown: false };
    }

    return {
      sql: `SELECT COUNT(*) AS count FROM __elds_records WHERE table_name = ? AND ${whereBuilt.sql}`,
      params: [tableName, ...whereBuilt.params],
      canPushdown: true,
    };
  }

  /**
   * Builds the pushdown DELETE query.
   */
  static buildDeleteQuery(tableName: string, condition?: FilterCondition<StorageRecord>): SqlConditionResult {
    const whereBuilt = this.buildCondition(condition);
    if (!whereBuilt.canPushdown) {
      return { sql: '', params: [], canPushdown: false };
    }

    return {
      sql: `DELETE FROM __elds_records WHERE table_name = ? AND ${whereBuilt.sql}`,
      params: [tableName, ...whereBuilt.params],
      canPushdown: true,
    };
  }
}
