import { SqlQueryBuilder } from '../SqlQueryBuilder';
import type { FilterCondition, StorageRecord } from '../../../types/storageTypes';

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

    it('translates direct scalar equality', () => {
      const result = SqlQueryBuilder.buildCondition({ name: 'Alice', active: true, age: 30, city: null });
      expect(result.canPushdown).toBe(true);
      expect(result.sql).toBe(
        "(json_extract(payload, '$.name') = ? AND json_extract(payload, '$.active') = ? AND json_extract(payload, '$.age') = ? AND json_extract(payload, '$.city') IS NULL)"
      );
      expect(result.params).toEqual(['Alice', 1, 30]);
    });

    it('translates $eq operator', () => {
      const resVal = SqlQueryBuilder.buildCondition({ name: { $eq: 'Alice' } });
      expect(resVal).toEqual({
        sql: "json_extract(payload, '$.name') = ?",
        params: ['Alice'],
        canPushdown: true,
      });

      const resNull = SqlQueryBuilder.buildCondition({ city: { $eq: null } });
      expect(resNull).toEqual({
        sql: "json_extract(payload, '$.city') IS NULL",
        params: [],
        canPushdown: true,
      });
    });

    it('translates $ne operator with proper null handling', () => {
      const resVal = SqlQueryBuilder.buildCondition({ role: { $ne: 'admin' } });
      expect(resVal).toEqual({
        sql: "(json_extract(payload, '$.role') IS NULL OR json_extract(payload, '$.role') != ?)",
        params: ['admin'],
        canPushdown: true,
      });

      const resNull = SqlQueryBuilder.buildCondition({ role: { $ne: null } });
      expect(resNull).toEqual({
        sql: "json_extract(payload, '$.role') IS NOT NULL",
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
        "((typeof(json_extract(payload, '$.age')) IN ('integer', 'real') AND json_extract(payload, '$.age') >= ?) AND (typeof(json_extract(payload, '$.age')) IN ('integer', 'real') AND json_extract(payload, '$.age') < ?))"
      );
      expect(res.params).toEqual([18, 65]);

      const invalidNonNumber = SqlQueryBuilder.buildCondition({ age: { $gt: 'twenty' as unknown as number } });
      expect(invalidNonNumber.canPushdown).toBe(false);
    });

    it('translates $in and $nin operators', () => {
      const resIn = SqlQueryBuilder.buildCondition({ category: { $in: ['tech', 'news'] } });
      expect(resIn).toEqual({
        sql: "json_extract(payload, '$.category') IN (?, ?)",
        params: ['tech', 'news'],
        canPushdown: true,
      });

      const resInNull = SqlQueryBuilder.buildCondition({ category: { $in: ['tech', null] } });
      expect(resInNull).toEqual({
        sql: "(json_extract(payload, '$.category') IS NULL OR json_extract(payload, '$.category') IN (?))",
        params: ['tech'],
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
        sql: "(json_extract(payload, '$.category') IS NULL OR json_extract(payload, '$.category') NOT IN (?, ?))",
        params: ['spam', 'junk'],
        canPushdown: true,
      });

      const resNinNull = SqlQueryBuilder.buildCondition({ category: { $nin: ['spam', null] } });
      expect(resNinNull).toEqual({
        sql: "(json_extract(payload, '$.category') IS NOT NULL AND json_extract(payload, '$.category') NOT IN (?))",
        params: ['spam'],
        canPushdown: true,
      });

      const resNinEmpty = SqlQueryBuilder.buildCondition({ category: { $nin: [] } });
      expect(resNinEmpty).toEqual({
        sql: '1 = 1',
        params: [],
        canPushdown: true,
      });
    });

    it('translates $like operator', () => {
      const resLike = SqlQueryBuilder.buildCondition({ name: { $like: '%alice%' } });
      expect(resLike).toEqual({
        sql: "(typeof(json_extract(payload, '$.name')) = 'text' AND json_extract(payload, '$.name') LIKE ?)",
        params: ['%alice%'],
        canPushdown: true,
      });

      const resLikeInvalid = SqlQueryBuilder.buildCondition({ name: { $like: 123 as unknown as string } });
      expect(resLikeInvalid.canPushdown).toBe(false);
    });

    it('translates compound $and and $or conditions', () => {
      const resAnd = SqlQueryBuilder.buildCondition({
        $and: [{ age: { $gt: 20 } }, { active: true }],
      });
      expect(resAnd.canPushdown).toBe(true);
      expect(resAnd.sql).toBe(
        "((typeof(json_extract(payload, '$.age')) IN ('integer', 'real') AND json_extract(payload, '$.age') > ?) AND json_extract(payload, '$.active') = ?)"
      );
      expect(resAnd.params).toEqual([20, 1]);

      const resOr = SqlQueryBuilder.buildCondition({
        $or: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      expect(resOr.canPushdown).toBe(true);
      expect(resOr.sql).toBe("(json_extract(payload, '$.name') = ? OR json_extract(payload, '$.name') = ?)");
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
        "(json_extract(payload, '$.status') = ? AND (json_extract(payload, '$.role') = ? OR json_extract(payload, '$.role') = ?))"
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
        "SELECT id, payload FROM __elds_records WHERE table_name = ? AND (json_extract(payload, '$.active') = ? AND (typeof(json_extract(payload, '$.age')) IN ('integer', 'real') AND json_extract(payload, '$.age') >= ?)) ORDER BY json_extract(payload, '$.age') DESC NULLS LAST, id ASC LIMIT ? OFFSET ?"
      );
      expect(query.params).toEqual(['users', 1, 21, 10, 20]);
    });

    it('builds count query', () => {
      const query = SqlQueryBuilder.buildCountQuery('users', { active: false });
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe(
        "SELECT COUNT(*) AS count FROM __elds_records WHERE table_name = ? AND json_extract(payload, '$.active') = ?"
      );
      expect(query.params).toEqual(['users', 0]);
    });

    it('builds delete query', () => {
      const query = SqlQueryBuilder.buildDeleteQuery('users', { id: 42 });
      expect(query.canPushdown).toBe(true);
      expect(query.sql).toBe("DELETE FROM __elds_records WHERE table_name = ? AND json_extract(payload, '$.id') = ?");
      expect(query.params).toEqual(['users', 42]);
    });
  });
});
