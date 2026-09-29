import { SqlQueryBuilder } from '../SqlQueryBuilder';
import type { FilterCondition, StorageRecord } from '../../../types/storageTypes';
import logger from '../../../utils/logger';

describe('SqlQueryBuilder', () => {
  describe('field safety & index statements', () => {
    it('validates safe field paths and rejects unsafe identifiers', () => {
      expect(SqlQueryBuilder.isSafeField('name')).toBe(true);
      expect(SqlQueryBuilder.isSafeField('user_id')).toBe(true);
      expect(SqlQueryBuilder.isSafeField('profile.age')).toBe(true);
      expect(SqlQueryBuilder.isSafeField('data.deep.val_1')).toBe(true);

      expect(SqlQueryBuilder.isSafeField('name; DROP TABLE users;--')).toBe(false);
      expect(SqlQueryBuilder.isSafeField('name"')).toBe(false);
      expect(SqlQueryBuilder.isSafeField("name'")).toBe(false);
      expect(SqlQueryBuilder.isSafeField('name spaces')).toBe(false);
      expect(SqlQueryBuilder.isSafeField('name-hyphen')).toBe(false);
    });

    it('builds valid CREATE and DROP expression index statements', () => {
      const createSql = SqlQueryBuilder.buildIndexStatement('users', 'email', true);
      expect(createSql).toBe(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users__email ON __elds_records (table_name, json_extract(payload, '$.email'))"
      );

      const nonUniqueSql = SqlQueryBuilder.buildIndexStatement('users', 'profile.age', false);
      expect(nonUniqueSql).toBe(
        "CREATE INDEX IF NOT EXISTS idx_users__profile_age ON __elds_records (table_name, json_extract(payload, '$.profile.age'))"
      );

      const dropSql = SqlQueryBuilder.buildDropIndexStatement('users', 'email');
      expect(dropSql).toBe('DROP INDEX IF EXISTS idx_users__email');

      expect(SqlQueryBuilder.buildIndexStatement('users', 'unsafe;field')).toBeNull();
      expect(SqlQueryBuilder.buildDropIndexStatement('users', 'unsafe;field')).toBeNull();
    });
  });

  describe('parameter normalization', () => {
    it('normalizes booleans to 1 / 0', () => {
      expect(SqlQueryBuilder.normalizeParam(true)).toBe(1);
      expect(SqlQueryBuilder.normalizeParam(false)).toBe(0);
      expect(SqlQueryBuilder.normalizeParam(42)).toBe(42);
      expect(SqlQueryBuilder.normalizeParam('hello')).toBe('hello');
      expect(SqlQueryBuilder.normalizeParam(null)).toBeNull();
      expect(SqlQueryBuilder.normalizeParam(100n)).toBe(100);
    });
  });

  describe('condition building', () => {
    it('handles undefined and empty condition', () => {
      expect(SqlQueryBuilder.buildCondition(undefined)).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });
      expect(SqlQueryBuilder.buildCondition({})).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });
    });

    it('rejects function conditions gracefully', () => {
      const funcCondition: FilterCondition<StorageRecord> = () => true;
      expect(SqlQueryBuilder.buildCondition(funcCondition)).toEqual({
        sql: '',
        params: [],
        canPushdown: false,
      });
    });

    it('translates direct scalar equality with json_type guards', () => {
      const result = SqlQueryBuilder.buildCondition({ name: 'Alice', active: true, age: 30, city: null });
      expect(result.canPushdown).toBe(true);
      expect(result.sql).toBe(
        "((json_type(payload, '$.name') = 'text' AND json_extract(payload, '$.name') = ?) AND " +
          "json_type(payload, '$.active') = 'true' AND " +
          "(json_type(payload, '$.age') IN ('integer', 'real') AND json_extract(payload, '$.age') = ?) AND " +
          "json_type(payload, '$.city') = 'null')"
      );
      // Booleans and nulls are encoded in the json_type tag, not as bindings.
      expect(result.params).toEqual(['Alice', 30]);
    });

    it('distinguishes a missing path from an explicit JSON null', () => {
      // `field: null` must match only explicit nulls: a missing path reports
      // json_type NULL, never 'null' (deepEquals(undefined, null) is false).
      expect(SqlQueryBuilder.buildCondition({ city: null }).sql).toBe("json_type(payload, '$.city') = 'null'");
      // `field: undefined` matches only missing paths.
      expect(SqlQueryBuilder.buildCondition({ city: undefined }).sql).toBe("json_type(payload, '$.city') IS NULL");
    });

    it('translates $eq operator', () => {
      const resVal = SqlQueryBuilder.buildCondition({ name: { $eq: 'Alice' } });
      expect(resVal).toEqual({
        sql: "(json_type(payload, '$.name') = 'text' AND json_extract(payload, '$.name') = ?)",
        params: ['Alice'],
        canPushdown: true,
      });

      const resNull = SqlQueryBuilder.buildCondition({ city: { $eq: null } });
      expect(resNull).toEqual({
        sql: "json_type(payload, '$.city') = 'null'",
        params: [],
        canPushdown: true,
      });

      // JSON true/false must not collapse to 1/0: deepEquals(true, 1) is false.
      const resBool = SqlQueryBuilder.buildCondition({ active: { $eq: true } });
      expect(resBool).toEqual({
        sql: "json_type(payload, '$.active') = 'true'",
        params: [],
        canPushdown: true,
      });
    });

    it('translates $ne operator with proper null handling', () => {
      // The in-memory engine negates with !deepEquals, which hits missing
      // fields; SQL's NOT would drop them as NULL, so IS NOT TRUE is used.
      const resVal = SqlQueryBuilder.buildCondition({ role: { $ne: 'admin' } });
      expect(resVal).toEqual({
        sql: "((json_type(payload, '$.role') = 'text' AND json_extract(payload, '$.role') = ?)) IS NOT TRUE",
        params: ['admin'],
        canPushdown: true,
      });

      // $ne: null keeps missing-field documents (json_type IS NULL evaluates
      // to NULL under the IS NOT TRUE negation) and excludes only explicit nulls.
      const resNull = SqlQueryBuilder.buildCondition({ role: { $ne: null } });
      expect(resNull).toEqual({
        sql: "(json_type(payload, '$.role') = 'null') IS NOT TRUE",
        params: [],
        canPushdown: true,
      });
    });

    it('translates numeric range operators ($gt, $gte, $lt, $lte)', () => {
      const res = SqlQueryBuilder.buildCondition({
        age: { $gte: 18, $lt: 65 },
      });
      expect(res.canPushdown).toBe(true);
      expect(res.sql).toBe(
        "((json_type(payload, '$.age') IN ('integer', 'real') AND json_extract(payload, '$.age') >= ?) AND " +
          "(json_type(payload, '$.age') IN ('integer', 'real') AND json_extract(payload, '$.age') < ?))"
      );
      expect(res.params).toEqual([18, 65]);

      const invalidNonNumber = SqlQueryBuilder.buildCondition({ age: { $gt: 'twenty' as unknown as number } });
      expect(invalidNonNumber.canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ age: { $gt: NaN } }).canPushdown).toBe(false);
    });

    it('translates $in and $nin operators', () => {
      const resIn = SqlQueryBuilder.buildCondition({ category: { $in: ['tech', 'news'] } });
      expect(resIn).toEqual({
        sql:
          "(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(payload, '$.category') = 'array' " +
          "THEN json_extract(payload, '$.category') END) WHERE (json_each.type = 'text' AND json_each.value IN (?, ?))) " +
          "OR ((json_type(payload, '$.category') = 'text' AND json_extract(payload, '$.category') IN (?, ?))))",
        // Values are bound once for the array-element branch and once for the
        // scalar branch, in that order.
        params: ['tech', 'news', 'tech', 'news'],
        canPushdown: true,
      });

      const resInNull = SqlQueryBuilder.buildCondition({ category: { $in: ['tech', null] } });
      expect(resInNull).toEqual({
        sql:
          "(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(payload, '$.category') = 'array' " +
          "THEN json_extract(payload, '$.category') END) " +
          "WHERE json_each.type = 'null' OR (json_each.type = 'text' AND json_each.value IN (?))) " +
          "OR (json_type(payload, '$.category') = 'null' " +
          "OR (json_type(payload, '$.category') = 'text' AND json_extract(payload, '$.category') IN (?))))",
        params: ['tech', 'tech'],
        canPushdown: true,
      });

      const resInEmpty = SqlQueryBuilder.buildCondition({ category: { $in: [] } });
      expect(resInEmpty).toEqual({
        sql: '1 = 0',
        params: [],
        canPushdown: true,
      });

      const resNin = SqlQueryBuilder.buildCondition({ category: { $nin: ['spam', 'junk'] } });
      expect(resNin).toEqual({
        sql:
          "((EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(payload, '$.category') = 'array' " +
          "THEN json_extract(payload, '$.category') END) WHERE (json_each.type = 'text' AND json_each.value IN (?, ?))) " +
          "OR ((json_type(payload, '$.category') = 'text' AND json_extract(payload, '$.category') IN (?, ?))))) IS NOT TRUE",
        params: ['spam', 'junk', 'spam', 'junk'],
        canPushdown: true,
      });

      const resNinNull = SqlQueryBuilder.buildCondition({ category: { $nin: ['spam', null] } });
      expect(resNinNull).toEqual({
        sql:
          "((EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(payload, '$.category') = 'array' " +
          "THEN json_extract(payload, '$.category') END) " +
          "WHERE json_each.type = 'null' OR (json_each.type = 'text' AND json_each.value IN (?))) " +
          "OR (json_type(payload, '$.category') = 'null' " +
          "OR (json_type(payload, '$.category') = 'text' AND json_extract(payload, '$.category') IN (?))))) IS NOT TRUE",
        params: ['spam', 'spam'],
        canPushdown: true,
      });

      const resNinEmpty = SqlQueryBuilder.buildCondition({ category: { $nin: [] } });
      expect(resNinEmpty).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });
    });

    it('never pushes down $like (SQLite lacks Unicode case folding)', () => {
      // QueryEngine lowercases both sides with toLowerCase(); SQLite's LIKE
      // folds ASCII only, so no equivalent predicate exists and the whole
      // condition falls back to in-memory filtering.
      expect(SqlQueryBuilder.buildCondition({ name: { $like: '%alice%' } })).toEqual({
        sql: '',
        params: [],
        canPushdown: false,
      });
      expect(SqlQueryBuilder.buildCondition({ name: { $like: 123 as unknown as string } }).canPushdown).toBe(false);
      expect(
        SqlQueryBuilder.buildCondition({ $or: [{ name: { $like: '%a%' } }, { age: { $gt: 1 } }] }).canPushdown
      ).toBe(false);
    });

    it('translates compound $and and $or conditions', () => {
      const resAnd = SqlQueryBuilder.buildCondition({
        $and: [{ age: { $gt: 20 } }, { active: true }],
      });
      expect(resAnd.canPushdown).toBe(true);
      expect(resAnd.sql).toBe(
        "((json_type(payload, '$.age') IN ('integer', 'real') AND json_extract(payload, '$.age') > ?) " +
          "AND json_type(payload, '$.active') = 'true')"
      );
      expect(resAnd.params).toEqual([20]);

      const resOr = SqlQueryBuilder.buildCondition({
        $or: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      expect(resOr.canPushdown).toBe(true);
      expect(resOr.sql).toBe(
        "((json_type(payload, '$.name') = 'text' AND json_extract(payload, '$.name') = ?) " +
          "OR (json_type(payload, '$.name') = 'text' AND json_extract(payload, '$.name') = ?))"
      );
      expect(resOr.params).toEqual(['Alice', 'Bob']);

      expect(SqlQueryBuilder.buildCondition({ $and: [] })).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildCondition({ $or: [] })).toEqual({
        sql: '1 = 0',
        params: [],
        canPushdown: true,
      });

      const resMixed = SqlQueryBuilder.buildCondition({
        status: 'active',
        $or: [{ role: 'admin' }, { role: 'editor' }],
      });
      expect(resMixed.canPushdown).toBe(true);
      expect(resMixed.sql).toBe(
        "((json_type(payload, '$.status') = 'text' AND json_extract(payload, '$.status') = ?) AND " +
          "((json_type(payload, '$.role') = 'text' AND json_extract(payload, '$.role') = ?) " +
          "OR (json_type(payload, '$.role') = 'text' AND json_extract(payload, '$.role') = ?)))"
      );
      expect(resMixed.params).toEqual(['active', 'admin', 'editor']);
    });

    it('rejects unsupported complex conditions', () => {
      expect(
        SqlQueryBuilder.buildCondition({ nested: { $unsupportedOp: 1 } as Record<string, unknown> }).canPushdown
      ).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ tags: ['a', 'b'] as unknown as StorageRecord }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ age: { $gt: NaN } }).canPushdown).toBe(false);

      // Deeply nested condition exceeding depth 10
      let deepCondition: FilterCondition<StorageRecord> = { active: true };
      for (let i = 0; i < 12; i++) {
        deepCondition = { $and: [deepCondition] };
      }
      expect(SqlQueryBuilder.buildCondition(deepCondition).canPushdown).toBe(false);
    });
  });

  describe('engine-parity pushdown guards', () => {
    it('builds the array-element branch (json_each) for $in', () => {
      const res = SqlQueryBuilder.buildCondition({ tags: { $in: ['alpha'] } });
      expect(res.canPushdown).toBe(true);
      expect(res.sql).toContain('json_each');
      expect(res.sql).toContain("json_each.type = 'text' AND json_each.value IN (?)");
      expect(res.sql).toContain(
        "CASE WHEN json_type(payload, '$.tags') = 'array' THEN json_extract(payload, '$.tags') END"
      );
      // Bound once per branch: array-element branch first, scalar branch second.
      expect(res.params).toEqual(['alpha', 'alpha']);
    });

    it('keeps missing fields for $ne: null via IS NOT TRUE', () => {
      const res = SqlQueryBuilder.buildCondition({ tags: { $ne: null } });
      expect(res).toEqual({
        sql: "(json_type(payload, '$.tags') = 'null') IS NOT TRUE",
        params: [],
        canPushdown: true,
      });
      // The negation of `json_type = 'null'` evaluates to NULL for a missing
      // path, and IS NOT TRUE turns that into a hit - matching QueryEngine.
      expect(SqlQueryBuilder.buildCondition({ tags: null }).sql).toBe("json_type(payload, '$.tags') = 'null'");
    });

    it('guards boolean values from collapsing into numbers', () => {
      const res = SqlQueryBuilder.buildCondition({ active: { $in: [true] } });
      expect(res.canPushdown).toBe(true);
      expect(res.sql).toContain("json_type(payload, '$.active') IN ('true', 'false')");
      expect(res.params).toEqual([1, 1]);

      const resNe = SqlQueryBuilder.buildCondition({ active: { $ne: 1 } });
      expect(resNe.canPushdown).toBe(true);
      expect(resNe.sql).toContain("(json_type(payload, '$.active') IN ('integer', 'real')");
    });

    it('falls back when an $in/$nin list exceeds the parameter cap', () => {
      // Each value is bound twice (array + scalar branch), so 251 values
      // already need 502 parameters - over the shared 500 cap.
      const overLimit = Array.from({ length: 251 }, (_, i) => `v${i}`);
      expect(SqlQueryBuilder.buildCondition({ field: { $in: overLimit } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ field: { $nin: overLimit } }).canPushdown).toBe(false);

      const atLimit = Array.from({ length: 250 }, (_, i) => `v${i}`);
      expect(SqlQueryBuilder.buildCondition({ field: { $in: atLimit } }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildCondition({ field: { $nin: atLimit } }).canPushdown).toBe(true);
    });

    it('falls back when combined conditions exceed the parameter cap', () => {
      const left = Array.from({ length: 250 }, (_, i) => `a${i}`);
      const right = Array.from({ length: 250 }, (_, i) => `b${i}`);
      // 2 x (250 values x 2 branches) = 1000 bound parameters in total.
      expect(SqlQueryBuilder.buildCondition({ left: { $in: left }, right: { $in: right } }).canPushdown).toBe(false);
    });

    it('falls back for list operands without an SQL-equivalent form', () => {
      expect(SqlQueryBuilder.buildCondition({ id: { $in: [1n] } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ id: { $nin: [1n] } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ id: { $in: [{ a: 1 }] } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ id: { $ne: 1n as unknown as number } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ id: 1n }).canPushdown).toBe(false);
    });

    it('pushes down $in lists containing undefined as a missing-path match', () => {
      const res = SqlQueryBuilder.buildCondition({ id: { $in: [undefined] } });
      expect(res).toEqual({
        sql: "(json_type(payload, '$.id') IS NULL)",
        params: [],
        canPushdown: true,
      });
    });
  });

  describe('numeric path variants (array index vs object numeric key)', () => {
    const TB = "json_type(payload, '$.a[0].c')";
    const EB = "json_extract(payload, '$.a[0].c')";
    const TD = "json_type(payload, '$.a.0.c')";
    const ED = "json_extract(payload, '$.a.0.c')";

    it('derives bracket and dot variants, collapsing to one path without numeric segments', () => {
      // Both readings of `a.0.c` are needed: the bracket form addresses array
      // elements, the dot form addresses object keys named "0".
      expect(SqlQueryBuilder.getJsonPathVariants('a.0.c')).toEqual(['$.a[0].c', '$.a.0.c']);
      expect(SqlQueryBuilder.getJsonPathVariants('items.12')).toEqual(['$.items[12]', '$.items.12']);
      // No numeric segment: both derivations agree, so a single path is returned.
      expect(SqlQueryBuilder.getJsonPathVariants('profile.age')).toEqual(['$.profile.age']);
      expect(SqlQueryBuilder.getJsonPathVariants('data.deep.val_1')).toEqual(['$.data.deep.val_1']);
      // Unsafe fields keep getJsonPath's failure semantics.
      expect(SqlQueryBuilder.getJsonPathVariants('unsafe;field')).toBeNull();
      expect(SqlQueryBuilder.getJsonPathVariants('a b.0')).toBeNull();
      // The bracket form stays the single index DDL path.
      expect(SqlQueryBuilder.getJsonPath('a.0.c')).toBe('$.a[0].c');
      expect(SqlQueryBuilder.buildIndexStatement('users', 'a.0.c')).toBe(
        "CREATE INDEX IF NOT EXISTS idx_users__a_0_c ON __elds_records (table_name, json_extract(payload, '$.a[0].c'))"
      );
    });

    it('wraps a whole-predicate dual branch for numeric-path equality', () => {
      const res = SqlQueryBuilder.buildCondition({ 'a.0.c': 10 });
      expect(res).toEqual({
        sql:
          `((${TB} IS NOT NULL AND (${TB} IN ('integer', 'real') AND ${EB} = ?)) OR ` +
          `(${TB} IS NULL AND (${TD} IN ('integer', 'real') AND ${ED} = ?)))`,
        params: [10, 10],
        canPushdown: true,
      });
      // The whole predicate - not just json_extract - is duplicated per branch.
      expect(res.sql).toContain(`(${TB} IS NOT NULL AND `);
      expect(res.sql).toContain(` OR (${TB} IS NULL AND `);
    });

    it('dual-branches explicit null and missing-path equality', () => {
      // Explicit JSON null: only the resolving branch can report type 'null'.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': null })).toEqual({
        sql: `((${TB} IS NOT NULL AND ${TB} = 'null') OR (${TB} IS NULL AND ${TD} = 'null'))`,
        params: [],
        canPushdown: true,
      });
      // `undefined` matches only a path that resolves on neither variant.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': undefined })).toEqual({
        sql: `((${TB} IS NOT NULL AND ${TB} IS NULL) OR (${TB} IS NULL AND ${TD} IS NULL))`,
        params: [],
        canPushdown: true,
      });
    });

    it('dual-branches $ne with each branch negating its own path', () => {
      // The guard is what keeps `$ne` exact: an array record must not leak a
      // "missing" hit from the dot branch (and vice versa), or SQLite would
      // over-match where the in-memory engine does not.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $ne: 10 } })).toEqual({
        sql:
          `((${TB} IS NOT NULL AND ((${TB} IN ('integer', 'real') AND ${EB} = ?)) IS NOT TRUE) OR ` +
          `(${TB} IS NULL AND ((${TD} IN ('integer', 'real') AND ${ED} = ?)) IS NOT TRUE))`,
        params: [10, 10],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $ne: null } })).toEqual({
        sql:
          `((${TB} IS NOT NULL AND (${TB} = 'null') IS NOT TRUE) OR ` +
          `(${TB} IS NULL AND (${TD} = 'null') IS NOT TRUE))`,
        params: [],
        canPushdown: true,
      });
    });

    it('dual-branches numeric range operators as one AND-ed predicate per path', () => {
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $gt: 15, $lt: 55 } })).toEqual({
        sql:
          `((${TB} IS NOT NULL AND ` +
          `((${TB} IN ('integer', 'real') AND ${EB} > ?) AND (${TB} IN ('integer', 'real') AND ${EB} < ?))) OR ` +
          `(${TB} IS NULL AND ` +
          `((${TD} IN ('integer', 'real') AND ${ED} > ?) AND (${TD} IN ('integer', 'real') AND ${ED} < ?))))`,
        params: [15, 55, 15, 55],
        canPushdown: true,
      });
    });

    it('dual-branches $in including the json_each array branch per path', () => {
      const membershipFor = (type: string, extract: string): string =>
        `(EXISTS (SELECT 1 FROM json_each(CASE WHEN ${type} = 'array' THEN ${extract} END) ` +
        `WHERE json_each.type = 'null' OR (json_each.type IN ('integer', 'real') AND json_each.value IN (?))) ` +
        `OR (${type} = 'null' OR (${type} IN ('integer', 'real') AND ${extract} IN (?))))`;

      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $in: [10, null] } })).toEqual({
        sql: `((${TB} IS NOT NULL AND ${membershipFor(TB, EB)}) OR ` + `(${TB} IS NULL AND ${membershipFor(TD, ED)}))`,
        // Four bindings: each branch binds its value once for json_each and
        // once for the scalar comparison.
        params: [10, 10, 10, 10],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $nin: [10, null] } })).toEqual({
        sql:
          `((${TB} IS NOT NULL AND (${membershipFor(TB, EB)}) IS NOT TRUE) OR ` +
          `(${TB} IS NULL AND (${membershipFor(TD, ED)}) IS NOT TRUE))`,
        params: [10, 10, 10, 10],
        canPushdown: true,
      });

      // A list of only `undefined` has no element branch; the missing-path
      // match still has to resolve on both variants.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $in: [undefined] } })).toEqual({
        sql: `((${TB} IS NOT NULL AND (${TB} IS NULL)) OR (${TB} IS NULL AND (${TD} IS NULL)))`,
        params: [],
        canPushdown: true,
      });

      // Path-independent predicates compile identically on both variants, so
      // the empty-list short forms are not wrapped in a redundant OR.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $in: [] } })).toEqual({
        sql: '1 = 0',
        params: [],
        canPushdown: true,
      });
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $nin: [] } })).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });
    });

    it('keeps numeric-path conditions pushdown-eligible', () => {
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': 10 }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $gt: 1 } }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $like: '%x%' } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ 'a b.0.c': 1 }).canPushdown).toBe(false);
    });

    it('falls back to memory once variant bindings exceed the combined parameter cap', () => {
      // Per branch the local $in cap sees 2 bindings per value; the variant
      // doubling happens on top, and the combined-condition cap in
      // buildCondition is what catches the total.
      const atCap = Array.from({ length: 125 }, (_, i) => `v${i}`); // 2 x 2 x 125 = 500
      const atCapResult = SqlQueryBuilder.buildCondition({ 'a.0.c': { $in: atCap } });
      expect(atCapResult.canPushdown).toBe(true);
      expect(atCapResult.params).toHaveLength(500);

      const overCap = Array.from({ length: 200 }, (_, i) => `v${i}`); // 2 x 2 x 200 = 800
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $in: overCap } }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': { $nin: overCap } }).canPushdown).toBe(false);
    });

    it('orders by COALESCE of both variants with id ASC as the final tie-break', () => {
      expect(SqlQueryBuilder.buildOrderByClause('a.0.c', 'asc')).toEqual({
        sql: `ORDER BY COALESCE(${EB}, ${ED}) ASC NULLS LAST, id ASC`,
        canPushdown: true,
      });
      expect(SqlQueryBuilder.buildOrderByClause('a.0.c', 'desc')).toEqual({
        sql: `ORDER BY COALESCE(${EB}, ${ED}) DESC NULLS LAST, id ASC`,
        canPushdown: true,
      });
      expect(SqlQueryBuilder.buildOrderByClause(['a.0.c', 'name'], ['desc', 'asc'])).toEqual({
        sql:
          `ORDER BY COALESCE(${EB}, ${ED}) DESC NULLS LAST, ` +
          "json_extract(payload, '$.name') ASC NULLS LAST, id ASC",
        canPushdown: true,
      });
      // Paths without numeric segments keep the single-expression order key.
      expect(SqlQueryBuilder.buildOrderByClause('profile.age', 'asc')).toEqual({
        sql: "ORDER BY json_extract(payload, '$.profile.age') ASC NULLS LAST, id ASC",
        canPushdown: true,
      });
      expect(SqlQueryBuilder.buildOrderByClause('unsafe;field', 'asc').canPushdown).toBe(false);
    });

    it('builds composite queries that stay pushdown-eligible with doubled bindings', () => {
      const query = SqlQueryBuilder.buildFindQuery(
        'users',
        { 'a.0.c': 10 },
        { sortBy: 'a.0.c', order: 'asc', skip: 0, limit: 5 }
      );
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe(
        'SELECT id, payload FROM __elds_records WHERE table_name = ? AND ' +
          `((${TB} IS NOT NULL AND (${TB} IN ('integer', 'real') AND ${EB} = ?)) OR ` +
          `(${TB} IS NULL AND (${TD} IN ('integer', 'real') AND ${ED} = ?))) ` +
          `ORDER BY COALESCE(${EB}, ${ED}) ASC NULLS LAST, id ASC LIMIT ? OFFSET ?`
      );
      expect(query.params).toEqual(['users', 10, 10, 5, 0]);

      const deleteQuery = SqlQueryBuilder.buildDeleteQuery('users', { 'a.0.c': { $gt: 15 } });
      expect(deleteQuery.canPushdown).toBe(true);
      expect(deleteQuery.params).toEqual(['users', 15, 15]);
    });

    it('refuses multi-numeric-segment fields before deriving variants (k >= 2)', () => {
      // Two numeric segments make the container shape ambiguous per segment:
      // a mixed walk resolves in memory but in neither SQL path form, so no
      // safe variant pair exists and both fields are refused outright.
      expect(SqlQueryBuilder.getJsonPathVariants('a.0.1')).toBeNull();
      expect(SqlQueryBuilder.getJsonPathVariants('a.0.b.1')).toBeNull();
      // The single-form helpers are untouched - index DDL keeps the bracket path.
      expect(SqlQueryBuilder.getJsonPath('a.0.1')).toBe('$.a[0][1]');
      expect(SqlQueryBuilder.buildIndexStatement('users', 'a.0.1')).toBe(
        "CREATE INDEX IF NOT EXISTS idx_users__a_0_1 ON __elds_records (table_name, json_extract(payload, '$.a[0][1]'))"
      );
    });

    it('refuses WHERE and ORDER BY pushdown for multi-numeric-segment fields', () => {
      // WHERE: refusal happens before variant derivation, so the condition
      // comes back empty with canPushdown false and callers filter in memory.
      expect(SqlQueryBuilder.buildCondition({ 'a.0.1': 9 })).toEqual({ sql: '', params: [], canPushdown: false });
      expect(SqlQueryBuilder.buildCondition({ 'a.0.b.1': { $ne: 42 } })).toEqual({
        sql: '',
        params: [],
        canPushdown: false,
      });
      // One refused field poisons the whole compound condition.
      expect(SqlQueryBuilder.buildCondition({ $and: [{ 'a.0.1': 9 }, { score: 1 }] }).canPushdown).toBe(false);

      // ORDER BY: same refusal, before any COALESCE key is assembled.
      expect(SqlQueryBuilder.buildOrderByClause('a.0.1', 'asc')).toEqual({ sql: '', canPushdown: false });
      expect(SqlQueryBuilder.buildOrderByClause('a.0.b.1', 'desc')).toEqual({ sql: '', canPushdown: false });
      // A pushdown-eligible first key does not rescue a refused second key.
      expect(SqlQueryBuilder.buildOrderByClause(['score', 'a.0.1'], ['asc', 'desc']).canPushdown).toBe(false);
    });

    it('refuses every query builder for multi-numeric-segment fields', () => {
      expect(SqlQueryBuilder.buildFindQuery('users', { 'a.0.1': 9 }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildFindQuery('users', {}, { sortBy: 'a.0.1', order: 'asc' }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildDeleteQuery('users', { 'a.0.1': 9 }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildCountQuery('users', { 'a.0.1': 9 }).canPushdown).toBe(false);
    });

    it('refuses leading-zero numeric segments but keeps a lone 0 and huge segments eligible', () => {
      // SQLite reads the rewritten `[01]` as array index 1 while the
      // in-memory engine reads the literal key '01' - refuse before deriving
      // variants so WHERE and ORDER BY both fall back to memory.
      expect(SqlQueryBuilder.getJsonPathVariants('a.01')).toBeNull();
      expect(SqlQueryBuilder.getJsonPathVariants('a.007')).toBeNull();
      expect(SqlQueryBuilder.getJsonPathVariants('a.01.c')).toBeNull();
      expect(SqlQueryBuilder.buildCondition({ 'a.01': 'y' })).toEqual({ sql: '', params: [], canPushdown: false });
      expect(SqlQueryBuilder.buildCondition({ 'a.01.c': 'mid' }).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildOrderByClause('a.01', 'asc')).toEqual({ sql: '', canPushdown: false });
      expect(SqlQueryBuilder.buildDeleteQuery('users', { 'a.01': 'y' }).canPushdown).toBe(false);

      // No leading zero: a single 0 and a huge segment stay pushdown-eligible.
      expect(SqlQueryBuilder.getJsonPathVariants('a.0')).toEqual(['$.a[0]', '$.a.0']);
      expect(SqlQueryBuilder.buildCondition({ 'a.0': 1 }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildCondition({ 'a.99999999999999999999': 1 }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildOrderByClause('a.99999999999999999999', 'asc').canPushdown).toBe(true);
    });

    it('logs a fallback warning when a path is refused and stays silent for k = 1 paths', () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      SqlQueryBuilder.buildCondition({ 'a.0.1': 9 });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("'a.0.1'");
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('falling back to in-memory filtering');

      warnSpy.mockClear();
      SqlQueryBuilder.buildOrderByClause('a.01', 'asc');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("'a.01'");
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('falling back to in-memory filtering');

      // Pushdown-eligible paths must not log anything.
      warnSpy.mockClear();
      expect(SqlQueryBuilder.buildCondition({ 'a.0.c': 10 }).canPushdown).toBe(true);
      expect(SqlQueryBuilder.buildOrderByClause('a.0.c', 'asc').canPushdown).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('order by and pagination', () => {
    it('builds order by clause with NULLS LAST', () => {
      const resSingle = SqlQueryBuilder.buildOrderByClause('age', 'desc');
      expect(resSingle).toEqual({
        sql: "ORDER BY json_extract(payload, '$.age') DESC NULLS LAST, id ASC",
        canPushdown: true,
      });

      const resMulti = SqlQueryBuilder.buildOrderByClause(['name', 'age'], ['asc', 'desc']);
      expect(resMulti).toEqual({
        sql: "ORDER BY json_extract(payload, '$.name') ASC NULLS LAST, json_extract(payload, '$.age') DESC NULLS LAST, id ASC",
        canPushdown: true,
      });

      const resDefault = SqlQueryBuilder.buildOrderByClause();
      expect(resDefault).toEqual({
        sql: 'ORDER BY id ASC',
        canPushdown: true,
      });

      const resUnsafe = SqlQueryBuilder.buildOrderByClause('unsafe;field');
      expect(resUnsafe.canPushdown).toBe(false);
    });

    it('builds pagination clauses with validation', () => {
      expect(SqlQueryBuilder.buildPaginationClause(10, 20)).toEqual({
        sql: 'LIMIT ? OFFSET ?',
        params: [20, 10],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildPaginationClause(undefined, 20)).toEqual({
        sql: 'LIMIT ?',
        params: [20],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildPaginationClause(10, undefined)).toEqual({
        sql: 'LIMIT -1 OFFSET ?',
        params: [10],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildPaginationClause()).toEqual({
        sql: '',
        params: [],
        canPushdown: true,
      });

      expect(SqlQueryBuilder.buildPaginationClause(-1, 10).canPushdown).toBe(false);
      expect(SqlQueryBuilder.buildPaginationClause(0, -5).canPushdown).toBe(false);
    });
  });

  describe('composite queries (find, count, delete)', () => {
    it('builds full find query with where, order, limit, offset', () => {
      const query = SqlQueryBuilder.buildFindQuery(
        'users',
        { active: true, age: { $gte: 21 } },
        { sortBy: 'age', order: 'desc', skip: 20, limit: 10 }
      );
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe(
        'SELECT id, payload FROM __elds_records WHERE table_name = ? AND ' +
          "(json_type(payload, '$.active') = 'true' AND " +
          "(json_type(payload, '$.age') IN ('integer', 'real') AND json_extract(payload, '$.age') >= ?)) " +
          "ORDER BY json_extract(payload, '$.age') DESC NULLS LAST, id ASC LIMIT ? OFFSET ?"
      );
      // The boolean half of the condition is encoded in the type tag.
      expect(query.params).toEqual(['users', 21, 10, 20]);
    });

    it('builds count query', () => {
      const query = SqlQueryBuilder.buildCountQuery('users', { active: false });
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe(
        "SELECT COUNT(*) AS count FROM __elds_records WHERE table_name = ? AND json_type(payload, '$.active') = 'false'"
      );
      expect(query.params).toEqual(['users']);
    });

    it('builds delete query', () => {
      const query = SqlQueryBuilder.buildDeleteQuery('users', { id: 42 });
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe(
        'DELETE FROM __elds_records WHERE table_name = ? AND ' +
          "(json_type(payload, '$.id') IN ('integer', 'real') AND json_extract(payload, '$.id') = ?)"
      );
      expect(query.params).toEqual(['users', 42]);
    });
  });
});
