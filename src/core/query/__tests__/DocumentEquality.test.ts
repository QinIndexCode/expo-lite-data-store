import { QueryEngine } from '../QueryEngine';
import { SqlQueryBuilder } from '../SqlQueryBuilder';
import { deepEquals } from '../../../utils/deepEquality';

describe('deep document equality in queries', () => {
  const testData = [
    { id: 1, profile: { city: 'Paris', zip: '75001' }, tags: ['a', 'b'], score: 10 },
    { id: 2, profile: { city: 'Berlin', zip: '10115' }, tags: ['b', 'c'], score: 20 },
    { id: 3, profile: {}, tags: [], score: 30 },
    { id: 4, profile: { zip: '75001', city: 'Paris' }, tags: ['b', 'a'], score: 40 },
  ];

  describe('plain object filter values', () => {
    it('matches object values by structural equality regardless of key order', () => {
      const result = QueryEngine.filter(testData, { profile: { city: 'Paris', zip: '75001' } });
      expect(result.map(r => r.id).sort()).toEqual([1, 4]);
    });

    it('treats an empty object value as a literal match, not a wildcard', () => {
      const result = QueryEngine.filter(testData, { profile: {} });
      expect(result.map(r => r.id)).toEqual([3]);
    });

    it('requires nested object equality', () => {
      expect(deepEquals({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
      expect(deepEquals({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
      expect(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEquals([1, 2, 3], [1, 3, 2])).toBe(false);
      expect(deepEquals({ a: 1 }, [1])).toBe(false);
      expect(deepEquals({ a: NaN }, { a: NaN })).toBe(true);
    });

    it('fails closed on cyclic values instead of overflowing', () => {
      const cyclic: Record<string, unknown> = { id: 1 };
      cyclic.self = cyclic;
      const other: Record<string, unknown> = { id: 1 };
      other.self = other;
      expect(deepEquals(cyclic, other)).toBe(false);
    });
  });

  describe('$eq / $ne with object operands', () => {
    it('$eq matches structurally equal documents', () => {
      const result = QueryEngine.filter(testData, { profile: { $eq: { zip: '75001', city: 'Paris' } } });
      expect(result.map(r => r.id).sort()).toEqual([1, 4]);
    });

    it('$ne excludes structurally equal documents', () => {
      const result = QueryEngine.filter(testData, { profile: { $ne: { city: 'Berlin', zip: '10115' } } });
      expect(result.map(r => r.id).sort()).toEqual([1, 3, 4]);
    });
  });

  describe('array filter values', () => {
    it('matches arrays by element-wise equality', () => {
      const result = QueryEngine.filter(testData, { tags: ['a', 'b'] });
      expect(result.map(r => r.id)).toEqual([1]);
    });
  });

  describe('SQL pushdown guards', () => {
    it('does not push down an empty object value', () => {
      const result = SqlQueryBuilder.buildCondition({ profile: {} });
      expect(result).toEqual({ sql: '', params: [], canPushdown: false });
    });

    it('does not push down a non-operator object value', () => {
      const result = SqlQueryBuilder.buildCondition({ profile: { city: 'Paris' } });
      expect(result).toEqual({ sql: '', params: [], canPushdown: false });
    });

    it('still pushes down $eq with an object operand as non-scalar fallback', () => {
      const result = SqlQueryBuilder.buildCondition({ profile: { $eq: { city: 'Paris' } } });
      expect(result.canPushdown).toBe(false);
    });

    it('does not push down oversized $in lists', () => {
      const manyValues = Array.from({ length: 501 }, (_, i) => i);
      const result = SqlQueryBuilder.buildCondition({ id: { $in: manyValues } });
      expect(result.canPushdown).toBe(false);
    });

    it('still pushes down bounded $in lists', () => {
      const values = Array.from({ length: 100 }, (_, i) => i);
      const result = SqlQueryBuilder.buildCondition({ id: { $in: values } });
      expect(result.canPushdown).toBe(true);
    });

    it('falls back to asc when a multi-sort order entry is missing', () => {
      const result = SqlQueryBuilder.buildOrderByClause(['score', 'id'], ['desc']);
      expect(result.canPushdown).toBe(true);
      expect(result.sql).toContain("'$.score') DESC");
      // The second field has no explicit order and must default to asc, not
      // inherit desc from the first entry.
      expect(result.sql).toContain("'$.id') ASC");
    });
  });

  describe('end-to-end find fallback', () => {
    it('filters empty-object queries through the in-memory engine', () => {
      const result = QueryEngine.filter(testData, { profile: {} });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3);
    });
  });
});
