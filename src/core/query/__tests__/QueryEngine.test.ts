import { QueryEngine } from '../QueryEngine';
import { isQueryOperator, isUpdateOperator } from '../../../utils/specialOperators';

describe('QueryEngine', () => {
  const testData = [
    { id: 1, name: 'test1', age: 20, score: 85, active: true, tags: ['a', 'b'] },
    { id: 2, name: 'test2', age: 25, score: 90, active: false, tags: ['b', 'c'] },
    { id: 3, name: 'test3', age: 30, score: 75, active: true, tags: ['a', 'c'] },
    { id: 4, name: 'test4', age: 35, score: 95, active: true, tags: ['d'] },
    { id: 5, name: 'test5', age: 40, score: 80, active: false, tags: ['a', 'b', 'c'] },
  ];

  describe('Filtering Functionality Tests', () => {
    it('matches equality conditions', () => {
      const result = QueryEngine.filter(testData, { id: 1 });
      expect(result).toEqual([testData[0]]);
    });

    it('matches inequality conditions', () => {
      const result = QueryEngine.filter(testData, { id: { $ne: 1 } });
      expect(result.length).toBe(4);
      expect(result).not.toContain(testData[0]);
    });

    it('matches greater-than conditions', () => {
      const result = QueryEngine.filter(testData, { age: { $gt: 25 } });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.age).toBeGreaterThan(25));
    });

    it('matches greater-than-or-equal conditions', () => {
      const result = QueryEngine.filter(testData, { age: { $gte: 25 } });
      expect(result.length).toBe(4);
      result.forEach(item => expect(item.age).toBeGreaterThanOrEqual(25));
    });

    it('matches less-than conditions', () => {
      const result = QueryEngine.filter(testData, { age: { $lt: 25 } });
      expect(result.length).toBe(1);
      result.forEach(item => expect(item.age).toBeLessThan(25));
    });

    it('matches less-than-or-equal conditions', () => {
      const result = QueryEngine.filter(testData, { age: { $lte: 25 } });
      expect(result.length).toBe(2);
      result.forEach(item => expect(item.age).toBeLessThanOrEqual(25));
    });

    it('matches IN conditions', () => {
      const result = QueryEngine.filter(testData, { id: { $in: [1, 3, 5] } });
      expect(result.length).toBe(3);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[2]);
      expect(result).toContain(testData[4]);
    });

    it('matches NIN conditions', () => {
      const result = QueryEngine.filter(testData, { id: { $nin: [1, 3, 5] } });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[1]);
      expect(result).toContain(testData[3]);
    });

    it('matches LIKE conditions', () => {
      const result = QueryEngine.filter(testData, { name: { $like: 'test%' } });
      expect(result.length).toBe(5);

      const result2 = QueryEngine.filter(testData, { name: { $like: '%2' } });
      expect(result2).toEqual([testData[1]]);
    });

    it('matches wildcard-heavy LIKE patterns without regular-expression backtracking', () => {
      const pattern = `${'%a'.repeat(24)}%b`;
      const result = QueryEngine.filter([{ value: 'a'.repeat(48) }], { value: { $like: pattern } });

      expect(result).toEqual([]);
    });

    it('filters boolean values', () => {
      const result = QueryEngine.filter(testData, { active: true });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.active).toBe(true));
    });

    it('matches array inclusion conditions', () => {
      const result = QueryEngine.filter(testData, { tags: { $in: ['a'] } });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.tags).toContain('a'));
    });
  });

  describe('Compound Query Tests', () => {
    it('matches AND conditions', () => {
      const result = QueryEngine.filter(testData, { $and: [{ active: true }, { age: { $gt: 25 } }] });
      expect(result.length).toBe(2);
      result.forEach(item => {
        expect(item.active).toBe(true);
        expect(item.age).toBeGreaterThan(25);
      });
    });

    it('matches OR conditions', () => {
      const result = QueryEngine.filter(testData, { $or: [{ id: 1 }, { id: 5 }] });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[4]);
    });

    it('evaluates complex compound conditions', () => {
      const result = QueryEngine.filter(testData, {
        $and: [{ active: true }, { $or: [{ age: { $lt: 25 } }, { score: { $gt: 90 } }] }],
      });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[3]);
    });

    it('evaluates nested compound conditions', () => {
      const result = QueryEngine.filter(testData, {
        $and: [
          { active: true },
          { $or: [{ age: { $lt: 25 } }, { $and: [{ score: { $gt: 85 } }, { tags: { $in: ['d'] } }] }] },
        ],
      });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[3]);
    });
  });

  describe('Pagination Functionality Tests', () => {
    it('paginates data with an offset and limit', () => {
      const result = QueryEngine.paginate(testData, 1, 2);
      expect(result).toEqual([testData[1], testData[2]]);
    });

    it('returns no records when the offset skips all data', () => {
      const result = QueryEngine.paginate(testData, 10);
      expect(result).toEqual([]);
    });

    it('returns remaining records when no limit is set', () => {
      const result = QueryEngine.paginate(testData, 2);
      expect(result.length).toBe(3);
      expect(result).toEqual([testData[2], testData[3], testData[4]]);
    });

    it('returns initial records when the offset is zero', () => {
      const result = QueryEngine.paginate(testData, 0, 3);
      expect(result).toEqual([testData[0], testData[1], testData[2]]);
    });

    it('returns all records for a large limit', () => {
      const result = QueryEngine.paginate(testData, 0, 100);
      expect(result.length).toBe(5);
      expect(result).toEqual(testData);
    });
  });

  describe('Sorting Functionality Tests', () => {
    it('sorts data in ascending order', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc');
      expect(result[0].age).toBe(20);
      expect(result[result.length - 1].age).toBe(40);
    });

    it('sorts data in descending order', () => {
      const result = QueryEngine.sort(testData, 'score', 'desc');
      expect(result[0].score).toBe(95);
      expect(result[result.length - 1].score).toBe(75);
    });

    it('sorts data by multiple fields', () => {
      const result = QueryEngine.sort(testData, ['active', 'age'], ['desc', 'asc']);
      expect(result[0].active).toBe(true);
      expect(result[0].age).toBe(20);
    });

    it('preserves order when the sort field is missing', () => {
      const result = QueryEngine.sort(testData, 'nonExistentField', 'asc');
      expect(result).toEqual(testData);
    });

    it('returns an empty array when sorting empty data', () => {
      const result = QueryEngine.sort([], 'age', 'asc');
      expect(result).toEqual([]);
    });
  });

  describe('Aggregation Functionality Tests', () => {
    it('calculates a sum', () => {
      const result = QueryEngine.sum(testData, 'age');
      expect(result).toBe(20 + 25 + 30 + 35 + 40);
    });

    it('calculates an average', () => {
      const result = QueryEngine.avg(testData, 'score');
      const expectedAvg = (85 + 90 + 75 + 95 + 80) / 5;
      expect(result).toBe(expectedAvg);
    });

    it('calculates a maximum', () => {
      const result = QueryEngine.max(testData, 'age');
      expect(result).toBe(40);
    });

    it('calculates a minimum', () => {
      const result = QueryEngine.min(testData, 'score');
      expect(result).toBe(75);
    });

    it('returns empty-data aggregation defaults', () => {
      expect(QueryEngine.sum([], 'age')).toBe(0);
      expect(QueryEngine.avg([], 'age')).toBe(0);
      expect(QueryEngine.max([], 'age')).toBeUndefined();
      expect(QueryEngine.min([], 'age')).toBeUndefined();
    });

    it('returns aggregation defaults for nonnumeric data', () => {
      expect(QueryEngine.sum(testData, 'name')).toBe(0);
      expect(QueryEngine.avg(testData, 'name')).toBe(0);
      expect(QueryEngine.max(testData, 'name')).toBe('test5');
      expect(QueryEngine.min(testData, 'name')).toBe('test1');
    });
  });

  describe('Grouping Functionality Tests', () => {
    it('groups data by a field', () => {
      const result = QueryEngine.groupBy(testData, 'active');
      expect(Object.keys(result)).toEqual(['true', 'false']);
      expect(result['true'].length).toBe(3);
      expect(result['false'].length).toBe(2);
    });

    it('groups nonexistent-field values under an empty key', () => {
      const result = QueryEngine.groupBy(testData, 'nonExistentField');
      expect(Object.keys(result)).toEqual(['']);
      expect(result[''].length).toBe(5);
    });

    it('keeps prototype-like group keys as ordinary groups', () => {
      const result = QueryEngine.groupBy(
        [
          { kind: '__proto__', id: 1 },
          { kind: '__proto__', id: 2 },
        ],
        'kind'
      );

      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
      expect(result['__proto__']).toHaveLength(2);
    });
  });

  describe('Edge Case Tests', () => {
    it('does not mutate source arrays when applying array update operators', () => {
      const original = { id: 'record-1', tags: ['existing'] };

      const pushed = QueryEngine.update(original, { $push: { tags: 'pushed' } });
      const added = QueryEngine.update(original, { $addToSet: { tags: 'added' } });

      expect(original.tags).toEqual(['existing']);
      expect(pushed.tags).toEqual(['existing', 'pushed']);
      expect(added.tags).toEqual(['existing', 'added']);
    });

    it('does not treat inherited object properties as operators', () => {
      expect(isQueryOperator('toString')).toBe(false);
      expect(isUpdateOperator('__proto__')).toBe(false);
    });

    it('rejects prototype keys in update payloads', () => {
      const payload = JSON.parse('{"$set":{"__proto__":{"isAdmin":true}}}');

      expect(() => QueryEngine.update({ id: 'record-1' }, payload)).toThrow('Unsafe update field: __proto__');
    });

    it('returns all records for empty conditions', () => {
      const result = QueryEngine.filter(testData, undefined);
      expect(result).toEqual(testData);
    });

    it('returns no records for an unknown field', () => {
      const result = QueryEngine.filter(testData, { nonExistentField: 'value' });
      expect(result).toEqual([]);
    });

    it('filters records with a function condition', () => {
      const result = QueryEngine.filter(testData, item => item.age > 30 && item.score > 80);
      expect(result.length).toBe(1);
      expect(result).toEqual([testData[3]]);
    });

    it('returns no records from empty data', () => {
      const result = QueryEngine.filter([], { active: true });
      expect(result).toEqual([]);
    });

    it('matches null values when data contains null and undefined fields', () => {
      const dataWithNulls = [...testData, { id: 6, name: null, age: undefined, active: true, tags: [] }];
      const result = QueryEngine.filter(dataWithNulls, { name: null });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(6);
    });
  });

  describe('Combined Functionality Tests', () => {
    it('combines filtering, sorting, and pagination', () => {
      let result = QueryEngine.filter(testData, { active: true });
      result = QueryEngine.sort(result, 'age', 'desc');
      result = QueryEngine.paginate(result, 0, 2);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe(4);
      expect(result[1].id).toBe(3);
    });

    it('evaluates a complex query with multiple operations', () => {
      const result = QueryEngine.filter(testData, {
        $and: [
          { score: { $gte: 80 } },
          { tags: { $in: ['a', 'b'] } },
          { $or: [{ age: { $lt: 30 } }, { active: true }] },
        ],
      });

      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[1]);
    });
  });
});
