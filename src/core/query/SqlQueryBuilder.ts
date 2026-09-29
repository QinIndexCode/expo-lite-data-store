import type { FilterCondition, SortField, SortOrder, StorageRecord } from '../../types/storageTypes';
import { isStorageRecord } from '../../types/storageTypes';
import logger from '../../utils/logger';

const SAFE_FIELD_REGEX = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
const SUPPORTED_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$like']);
// Android SQLite historically caps bound variables at 999. Stay well below the
// ceiling so WHERE plus ORDER BY bindings never exhaust the budget; larger
// candidate lists fall back to in-memory filtering.
const MAX_PUSHDOWN_IN_PARAMS = 500;

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
    const formatted = field.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
    return `$.${formatted}`;
  }

  /**
   * Derives every JSON path form that can address a validated field.
   *
   * A numeric segment such as `a.0.c` is ambiguous in JSON, and SQLite reads
   * the two readings as mutually exclusive paths: the bracket form
   * (`$.a[0].c`) matches only records where `a` is an array, the dot form
   * (`$.a.0.c`) matches only records where `a` is an object with a `"0"` key,
   * and the losing form evaluates to SQL NULL (probed against node:sqlite;
   * never an error, even for scalar/`null` containers). The in-memory engine
   * resolves both readings with `split('.')` plus property access, so SQL
   * pushdown must evaluate both variants to keep the engines aligned.
   *
   * The bracket form comes first (it is the `getJsonPath` / index DDL form);
   * fields without numeric segments collapse to that single path. Returns
   * `null` when the field fails `isSafeField`, keeping `getJsonPath`'s
   * failure semantics.
   *
   * Fields with *two or more* numeric segments (such as `a.0.1`) also return
   * `null`: the mutual exclusivity above only holds while exactly one
   * segment decides the container shape. With two numeric segments and mixed
   * containers the in-memory engine still walks through step by step (array
   * index then object key, or the reverse), but *both* SQL forms fall short -
   * `$.a[0][1]` needs array -> array while `$.a.0.1` needs object -> object,
   * so a mixed walk resolves to SQL NULL in both of them and the guarded
   * dual branch would evaluate the record as "missing" (misses for equality,
   * over-matches for `$ne`/`$nin`). Covering every container combination
   * would take 2^k branches, so pushdown is refused here - before any
   * variant is derived - and every consumer (WHERE, ORDER BY, and the query
   * builders on top) falls back to in-memory filtering, the semantic oracle.
   * Index DDL (`getJsonPath`) keeps the single bracket form regardless.
   *
   * A numeric segment with a leading zero (such as `a.01`) is refused the
   * same way, before variant derivation: `getJsonPath` rewrites `.01` to the
   * bracket index `[01]`, which SQLite evaluates as array index 1, while the
   * in-memory engine walks `split('.')` and reads the literal property key
   * `'01'` - the same record matches on one engine and not on the other
   * (worst case a delete removes rows the other engine keeps). A lone `0`
   * (`a.0`) and segments without a leading zero stay pushdown-eligible. The
   * refusal rule is therefore: two or more numeric segments, or any
   * leading-zero numeric segment -> `null` (memory fallback).
   */
  static getJsonPathVariants(field: string): string[] | null {
    const bracketPath = this.getJsonPath(field);
    if (!bracketPath) {
      return null;
    }
    const numericSegments = field.match(/\.(\d+)(?=\.|$)/g);
    if (numericSegments && numericSegments.length >= 2) {
      logger.warn(
        `SqlQueryBuilder: field '${field}' has ${numericSegments.length} numeric segments; ` +
          `multi-numeric-segment paths are not pushed down, falling back to in-memory filtering.`
      );
      return null;
    }
    if (/\.0\d+(?=\.|$)/.test(field)) {
      logger.warn(
        `SqlQueryBuilder: field '${field}' has a leading-zero numeric segment; ` +
          `leading-zero numeric segments are not pushed down, falling back to in-memory filtering.`
      );
      return null;
    }
    const dotPath = `$.${field}`;
    return bracketPath === dotPath ? [bracketPath] : [bracketPath, dotPath];
  }

  /**
   * Builds the `json_extract` expression for an already-derived JSON path.
   */
  private static extractExprForPath(path: string): string {
    return `json_extract(payload, '${path}')`;
  }

  /**
   * Builds the `json_type` expression for an already-derived JSON path.
   */
  private static typeExprForPath(path: string): string {
    return `json_type(payload, '${path}')`;
  }

  /**
   * Generates a SQL expression representing the extracted JSON field value.
   */
  static getJsonExtractExpr(field: string): string | null {
    const path = this.getJsonPath(field);
    if (!path) {
      return null;
    }
    return this.extractExprForPath(path);
  }

  /**
   * Generates the JSON type-tag expression for a validated field path.
   *
   * `json_type` distinguishes the three states the in-memory engine treats
   * differently: a missing path yields SQL NULL, an explicit JSON null yields
   * the text 'null', and real values yield their type tag ('text',
   * 'integer', 'real', 'true', 'false', 'array', 'object'). The extracted
   * value alone collapses "missing" and "null" into a single SQL NULL, so
   * every null-sensitive predicate needs this companion expression.
   */
  static getJsonTypeExpr(field: string): string | null {
    const path = this.getJsonPath(field);
    if (!path) {
      return null;
    }
    return this.typeExprForPath(path);
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
   * Builds a single type-faithful equality predicate that mirrors the
   * in-memory engine's `deepEquals` semantics for one literal value:
   *
   * - `undefined` matches only a missing path (`json_type IS NULL`), because
   *   `deepEquals(undefined, <any stored value>)` is false and
   *   `deepEquals(undefined, undefined)` is true.
   * - `null` matches only an explicit JSON null (`json_type = 'null'`), never
   *   a missing path: `deepEquals(undefined, null)` is false.
   * - booleans match only the matching json_type tag. `json_extract` folds
   *   JSON true/false to 1/0, so a bare `json_extract = 1` would also match
   *   the number 1, while `deepEquals(true, 1)` is false.
   * - strings/numbers guard with json_type so a missing path, JSON null or
   *   boolean can never satisfy the comparison through SQL's three-valued
   *   logic, while the `json_extract = ?` comparison stays sargable for
   *   expression indexes.
   *
   * Returns null when the value has no equivalent SQL form: bigints (JSON
   * cannot persist them and `deepEquals` never equates a bigint with a
   * number), objects, arrays and functions (matched by deep/reference
   * equality only in memory). Callers fall back to in-memory filtering.
   */
  private static buildEqualityExpr(path: string, value: unknown): { sql: string; params: SqlBindValue[] } | null {
    const typeExpr = this.typeExprForPath(path);
    const extractExpr = this.extractExprForPath(path);
    if (value === undefined) {
      return { sql: `${typeExpr} IS NULL`, params: [] };
    }
    if (value === null) {
      return { sql: `${typeExpr} = 'null'`, params: [] };
    }
    if (typeof value === 'boolean') {
      return { sql: `${typeExpr} = '${value ? 'true' : 'false'}'`, params: [] };
    }
    if (typeof value === 'string') {
      return { sql: `(${typeExpr} = 'text' AND ${extractExpr} = ?)`, params: [value] };
    }
    if (typeof value === 'number') {
      // NaN normalizes to a bound NULL, which never compares equal - the same
      // outcome as deepEquals against persisted data (JSON has no NaN).
      return {
        sql: `(${typeExpr} IN ('integer', 'real') AND ${extractExpr} = ?)`,
        params: [this.normalizeParam(value)],
      };
    }
    return null;
  }

  /**
   * Builds the membership predicate shared by `$in` and `$nin`, aligned with
   * the in-memory engine:
   *
   * - array field -> element intersection over `json_each`,
   * - scalar field -> value equality against the extracted value,
   * - missing path -> only when the list contains `undefined`,
   * - explicit null -> only when the list contains `null`.
   *
   * Every value group is guarded by its JSON type tag: `json_extract` folds
   * JSON true/false to 1/0 and serializes containers to text, so an
   * unguarded `IN (1)` would also match `true` (`Set.has` would not). The
   * array branch feeds `json_each` through a `CASE` so it only ever receives
   * array JSON (or NULL), which never raises "malformed JSON" for scalar or
   * object fields regardless of expression-evaluation order.
   *
   * The same values are bound twice (array branch and scalar branch), so the
   * shared parameter cap is checked against twice the value count. Numeric
   * path fields multiply the bindings once more per path variant; that total
   * is caught by the combined-condition cap in `buildCondition`, which falls
   * back to in-memory filtering. Returns
   * null when the list has no equivalent SQL form - `bigint`, object or array
   * operands, or an over-cap list - so callers fall back to memory; the cap
   * case logs a hint.
   */
  private static buildMembershipExpr(path: string, values: unknown[]): { sql: string; params: SqlBindValue[] } | null {
    const typeExpr = this.typeExprForPath(path);
    const extractExpr = this.extractExprForPath(path);

    const hasNull = values.some(v => v === null);
    const hasUndefined = values.some(v => v === undefined);
    const scalars: Array<string | number | boolean> = [];
    for (const entry of values) {
      if (entry === null || entry === undefined) {
        continue;
      }
      if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
        scalars.push(entry);
        continue;
      }
      // bigint / object / array / function operands: no equivalent SQL form.
      return null;
    }

    if (scalars.length === 0 && !hasNull && !hasUndefined) {
      // Empty lists are turned into literal `1 = 0` / `1 = 1` by callers.
      return null;
    }

    if (scalars.length * 2 > MAX_PUSHDOWN_IN_PARAMS) {
      logger.warn(
        `SqlQueryBuilder: $in/$nin list of ${values.length} values needs ${scalars.length * 2} bound parameters ` +
          `(cap ${MAX_PUSHDOWN_IN_PARAMS}); condition on '${path}' falls back to in-memory filtering.`
      );
      return null;
    }

    const strings = scalars.filter((v): v is string => typeof v === 'string');
    const numbers = scalars.filter((v): v is number => typeof v === 'number');
    const booleans = scalars.filter((v): v is boolean => typeof v === 'boolean');
    const placeholders = (count: number): string => new Array(count).fill('?').join(', ');
    const branchParams: SqlBindValue[] = [...strings, ...numbers, ...booleans].map(v => this.normalizeParam(v));

    // Scalar branch: guarded equality against the extracted value, plus the
    // missing/null sentinels for `undefined` / `null` list entries.
    const scalarClauses: string[] = [];
    if (hasUndefined) {
      scalarClauses.push(`${typeExpr} IS NULL`);
    }
    if (hasNull) {
      scalarClauses.push(`${typeExpr} = 'null'`);
    }
    if (strings.length > 0) {
      scalarClauses.push(`(${typeExpr} = 'text' AND ${extractExpr} IN (${placeholders(strings.length)}))`);
    }
    if (numbers.length > 0) {
      scalarClauses.push(
        `(${typeExpr} IN ('integer', 'real') AND ${extractExpr} IN (${placeholders(numbers.length)}))`
      );
    }
    if (booleans.length > 0) {
      scalarClauses.push(`(${typeExpr} IN ('true', 'false') AND ${extractExpr} IN (${placeholders(booleans.length)}))`);
    }
    if (scalarClauses.length === 0) {
      return null;
    }
    const scalarBranch = `(${scalarClauses.join(' OR ')})`;

    // Array branch: element intersection over json_each. `undefined` never
    // appears inside a persisted array, so only `null` needs an element
    // clause; when no element clause is needed the branch is omitted.
    const elemClauses: string[] = [];
    if (hasNull) {
      elemClauses.push(`json_each.type = 'null'`);
    }
    if (strings.length > 0) {
      elemClauses.push(`(json_each.type = 'text' AND json_each.value IN (${placeholders(strings.length)}))`);
    }
    if (numbers.length > 0) {
      elemClauses.push(
        `(json_each.type IN ('integer', 'real') AND json_each.value IN (${placeholders(numbers.length)}))`
      );
    }
    if (booleans.length > 0) {
      elemClauses.push(
        `(json_each.type IN ('true', 'false') AND json_each.value IN (${placeholders(booleans.length)}))`
      );
    }

    if (elemClauses.length === 0) {
      // No element clause is needed (e.g. a list of only `undefined`): only
      // the scalar branch exists, so its values are bound exactly once.
      return { sql: scalarBranch, params: branchParams };
    }

    const arrayBranch =
      `EXISTS (SELECT 1 FROM json_each(CASE WHEN ${typeExpr} = 'array' THEN ${extractExpr} END) ` +
      `WHERE ${elemClauses.join(' OR ')})`;

    return {
      // Same values are bound in both branches; parameter order follows the
      // SQL: array branch first, scalar branch second.
      sql: `(${arrayBranch} OR ${scalarBranch})`,
      params: [...branchParams, ...branchParams],
    };
  }

  /**
   * Translates a single field condition into SQL, covering every JSON path
   * variant of the field (see `getJsonPathVariants`).
   *
   * A field with a numeric segment compiles to a whole-predicate dual
   * branch: `(bracket-predicate OR dot-predicate)`, each branch generated
   * from its own path's `json_type` / `json_extract` expressions with the
   * parameters merged branch by branch. The variants are mutually exclusive
   * per record, so each branch is guarded by its own resolution - the bracket
   * path is resolved (`json_type IS NOT NULL`) for the first branch, and not
   * resolved for the second. The guard is what keeps predicates that are
   * TRUE for a missing path (`$ne`, `$nin`, `field: undefined`, `$in` lists
   * containing `undefined`) exact: without it, the losing variant would
   * evaluate as "missing" and flip a non-match into a hit. When neither
   * variant resolves, the dot branch still sees a missing path and therefore
   * reproduces the in-memory `undefined` semantics by construction.
   *
   * Semantics follow the in-memory `QueryEngine` exactly; anything that has
   * no equivalent SQL form (notably `$like`, whose Unicode case folding
   * SQLite cannot reproduce) returns `canPushdown: false` so the caller
   * filters with the in-memory engine instead. Deriving path variants never
   * flips an otherwise pushdown-eligible field away from pushdown: the only
   * refusals they cause are the deliberate ones for multi-numeric-segment
   * and leading-zero paths (see `getJsonPathVariants`), which fall back to
   * in-memory filtering.
   */
  private static buildFieldCondition(field: string, value: unknown): SqlConditionResult {
    const variants = this.getJsonPathVariants(field);
    if (!variants) {
      return { sql: '', params: [], canPushdown: false };
    }

    const branches = variants.map(path => this.buildFieldConditionForPath(path, value));
    for (const branch of branches) {
      if (!branch.canPushdown) {
        return { sql: '', params: [], canPushdown: false };
      }
    }

    if (branches.length === 1) {
      return branches[0]!;
    }

    const bracketBranch = branches[0]!;
    const dotBranch = branches[1]!;
    if (bracketBranch.sql === dotBranch.sql) {
      // Path-independent predicate (e.g. the `1 = 0` empty-$in form): both
      // variants compile to identical SQL and identical parameters, so the
      // OR would only duplicate bindings.
      return bracketBranch;
    }

    const bracketType = this.typeExprForPath(variants[0]!);
    return {
      sql:
        `((${bracketType} IS NOT NULL AND ${bracketBranch.sql}) OR ` + `(${bracketType} IS NULL AND ${dotBranch.sql}))`,
      params: [...bracketBranch.params, ...dotBranch.params],
      canPushdown: true,
    };
  }

  /**
   * Translates a single operator or equality condition against one concrete
   * JSON path into SQL.
   *
   * Semantics follow the in-memory `QueryEngine` exactly; anything that has
   * no equivalent SQL form (notably `$like`, whose Unicode case folding
   * SQLite cannot reproduce) returns `canPushdown: false` so the caller
   * filters with the in-memory engine instead.
   */
  private static buildFieldConditionForPath(path: string, value: unknown): SqlConditionResult {
    const typeExpr = this.typeExprForPath(path);
    const extractExpr = this.extractExprForPath(path);

    if (!isStorageRecord(value)) {
      // Direct literal equality (null / undefined / boolean / number /
      // string). Everything else - arrays, bigints, functions - has no
      // equivalent SQL predicate and falls back to the in-memory engine.
      const equality = this.buildEqualityExpr(path, value);
      if (!equality) {
        return { sql: '', params: [], canPushdown: false };
      }
      return { sql: equality.sql, params: equality.params, canPushdown: true };
    }

    const keys = Object.keys(value);
    if (keys.length === 0) {
      // An empty object is a value to match by deep equality (not a
      // wildcard). Pushdown would turn it into an unconditional match, so
      // fall back to the in-memory engine instead.
      return { sql: '', params: [], canPushdown: false };
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
          const equality = this.buildEqualityExpr(path, opVal);
          if (!equality) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(equality.sql);
          opParams.push(...equality.params);
          break;
        }

        case '$ne': {
          // `$ne` is the exact complement of `$eq` in the in-memory engine,
          // including for missing fields, where `!deepEquals(undefined, x)`
          // is a hit. SQL's `NOT` would evaluate those rows to NULL and drop
          // them, so the predicate is negated with IS NOT TRUE: FALSE and
          // NULL both become a hit, while an exact match stays out.
          const equality = this.buildEqualityExpr(path, opVal);
          if (!equality) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(`(${equality.sql}) IS NOT TRUE`);
          opParams.push(...equality.params);
          break;
        }

        case '$gt': {
          if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(`(${typeExpr} IN ('integer', 'real') AND ${extractExpr} > ?)`);
          opParams.push(opVal);
          break;
        }

        case '$gte': {
          if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(`(${typeExpr} IN ('integer', 'real') AND ${extractExpr} >= ?)`);
          opParams.push(opVal);
          break;
        }

        case '$lt': {
          if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(`(${typeExpr} IN ('integer', 'real') AND ${extractExpr} < ?)`);
          opParams.push(opVal);
          break;
        }

        case '$lte': {
          if (typeof opVal !== 'number' || Number.isNaN(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(`(${typeExpr} IN ('integer', 'real') AND ${extractExpr} <= ?)`);
          opParams.push(opVal);
          break;
        }

        case '$in': {
          if (!Array.isArray(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          if (opVal.length === 0) {
            // An empty candidate set matches nothing in the in-memory engine.
            opClauses.push('1 = 0');
            break;
          }
          const membership = this.buildMembershipExpr(path, opVal);
          if (!membership) {
            return { sql: '', params: [], canPushdown: false };
          }
          opClauses.push(membership.sql);
          opParams.push(...membership.params);
          break;
        }

        case '$nin': {
          if (!Array.isArray(opVal)) {
            return { sql: '', params: [], canPushdown: false };
          }
          if (opVal.length === 0) {
            // The complement of an empty candidate set matches everything.
            opClauses.push('1 = 1');
            break;
          }
          const membership = this.buildMembershipExpr(path, opVal);
          if (!membership) {
            return { sql: '', params: [], canPushdown: false };
          }
          // `$nin` is the exact complement of `$in` - a missing path must
          // still be a hit unless the list contains `undefined`. The
          // membership predicate is NULL (not FALSE) for missing paths, and
          // SQL's `NOT NULL` would drop them, so IS NOT TRUE maps both FALSE
          // and NULL to a hit, mirroring the in-memory engine.
          opClauses.push(`(${membership.sql}) IS NOT TRUE`);
          opParams.push(...membership.params);
          break;
        }

        case '$like': {
          // Never pushed down: SQLite's LIKE case-folds ASCII letters only
          // (Unicode folding requires an ICU build that device SQLite does
          // not guarantee), while the in-memory engine lowercases both sides
          // with toLowerCase() - full Unicode folding ('É' matches 'é', 'Ω'
          // matches 'ω'). No equivalent SQL predicate exists, so any
          // condition containing $like falls back to in-memory filtering and
          // both engines return the same rows.
          return { sql: '', params: [], canPushdown: false };
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

  /**
   * Compiles an arbitrary FilterCondition into a SQL expression and parameter
   * array. Conditions that cannot be expressed equivalently in SQL - `$like`
   * (Unicode case folding), values without a SQL form, lists over the
   * parameter cap - return `canPushdown: false` so callers evaluate them
   * with the in-memory `QueryEngine` and both engines agree on the result.
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

    // Cross-field guard: several individually capped conditions could add up
    // past the bound-variable budget once combined, and numeric path fields
    // bind each branch's parameters twice (bracket/dot variant). This runs
    // after every clause - variants included - has been assembled, so the
    // doubled bindings are counted here too. Stay at or below the cap
    // (table name and LIMIT/OFFSET add a few more, far below the 999
    // ceiling).
    if (params.length > MAX_PUSHDOWN_IN_PARAMS) {
      logger.warn(
        `SqlQueryBuilder: combined condition needs ${params.length} bound parameters ` +
          `(cap ${MAX_PUSHDOWN_IN_PARAMS}); falling back to in-memory filtering.`
      );
      return { sql: '', params: [], canPushdown: false };
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

      const variants = this.getJsonPathVariants(field);
      if (!variants) {
        return { sql: '', canPushdown: false };
      }

      const bracketExpr = this.extractExprForPath(variants[0]!);
      // A numeric path field can hold an array element (bracket form) or an
      // object numeric key (dot form); COALESCE picks whichever resolves, and
      // yields NULL - sorted last via NULLS LAST - when neither does, which
      // is exactly the in-memory "nullish sorts last" behaviour.
      const keyExpr =
        variants.length === 1 ? bracketExpr : `COALESCE(${bracketExpr}, ${this.extractExprForPath(variants[1]!)})`;

      const fieldOrder = orders[i] || 'asc';
      const dir = fieldOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      clauses.push(`${keyExpr} ${dir} NULLS LAST`);
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
