// src/core/query/__tests__/QueryEngine.test.ts

import { QueryEngine } from '../QueryEngine';

describe('QueryEngine', () => {
  // 测试数据
  const testData = [
    { id: 1, name: 'test1', age: 20, score: 85, active: true, tags: ['a', 'b'] },
    { id: 2, name: 'test2', age: 25, score: 90, active: false, tags: ['b', 'c'] },
    { id: 3, name: 'test3', age: 30, score: 75, active: true, tags: ['a', 'c'] },
    { id: 4, name: 'test4', age: 35, score: 95, active: true, tags: ['d'] },
    { id: 5, name: 'test5', age: 40, score: 80, active: false, tags: ['a', 'b', 'c'] },
  ];

  describe('Filtering Functionality Tests', () => {
    it('should handle equality operator', () => {
      const result = QueryEngine.filter(testData, { id: 1 });
      expect(result).toEqual([testData[0]]);
    });

    it('should handle not equal operator', () => {
      const result = QueryEngine.filter(testData, { id: { $ne: 1 } });
      expect(result.length).toBe(4);
      expect(result).not.toContain(testData[0]);
    });

    it('should handle greater than operator', () => {
      const result = QueryEngine.filter(testData, { age: { $gt: 25 } });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.age).toBeGreaterThan(25));
    });

    it('should handle greater than or equal operator', () => {
      const result = QueryEngine.filter(testData, { age: { $gte: 25 } });
      expect(result.length).toBe(4);
      result.forEach(item => expect(item.age).toBeGreaterThanOrEqual(25));
    });

    it('should handle less than operator', () => {
      const result = QueryEngine.filter(testData, { age: { $lt: 25 } });
      expect(result.length).toBe(1);
      result.forEach(item => expect(item.age).toBeLessThan(25));
    });

    it('should handle less than or equal operator', () => {
      const result = QueryEngine.filter(testData, { age: { $lte: 25 } });
      expect(result.length).toBe(2);
      result.forEach(item => expect(item.age).toBeLessThanOrEqual(25));
    });

    it('should handle IN operator', () => {
      const result = QueryEngine.filter(testData, { id: { $in: [1, 3, 5] } });
      expect(result.length).toBe(3);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[2]);
      expect(result).toContain(testData[4]);
    });

    it('should handle NIN operator', () => {
      const result = QueryEngine.filter(testData, { id: { $nin: [1, 3, 5] } });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[1]);
      expect(result).toContain(testData[3]);
    });

    it('should handle LIKE operator', () => {
      const result = QueryEngine.filter(testData, { name: { $like: 'test%' } });
      expect(result.length).toBe(5);

      const result2 = QueryEngine.filter(testData, { name: { $like: '%2' } });
      expect(result2).toEqual([testData[1]]);
    });

    it('should handle boolean filtering', () => {
      const result = QueryEngine.filter(testData, { active: true });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.active).toBe(true));
    });

    it('should handle array inclusion filtering', () => {
      const result = QueryEngine.filter(testData, { tags: { $in: ['a'] } });
      expect(result.length).toBe(3);
      result.forEach(item => expect(item.tags).toContain('a'));
    });
  });

  describe('Compound Query Tests', () => {
    it('should handle AND queries', () => {
      const result = QueryEngine.filter(testData, { $and: [{ active: true }, { age: { $gt: 25 } }] });
      expect(result.length).toBe(2);
      result.forEach(item => {
        expect(item.active).toBe(true);
        expect(item.age).toBeGreaterThan(25);
      });
    });

    it('should handle OR queries', () => {
      const result = QueryEngine.filter(testData, { $or: [{ id: 1 }, { id: 5 }] });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[4]);
    });

    it('should handle complex compound queries', () => {
      const result = QueryEngine.filter(testData, {
        $and: [{ active: true }, { $or: [{ age: { $lt: 25 } }, { score: { $gt: 90 } }] }],
      });
      expect(result.length).toBe(2);
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[3]);
    });

    it('should handle nested compound queries', () => {
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
    it('should handle basic pagination', () => {
      const result = QueryEngine.paginate(testData, 1, 2);
      expect(result).toEqual([testData[1], testData[2]]);
    });

    it('should handle skipping all data', () => {
      const result = QueryEngine.paginate(testData, 10);
      expect(result).toEqual([]);
    });

    it('should handle no limit specified', () => {
      const result = QueryEngine.paginate(testData, 2);
      expect(result.length).toBe(3);
      expect(result).toEqual([testData[2], testData[3], testData[4]]);
    });

    it('should handle skipping 0 data', () => {
      const result = QueryEngine.paginate(testData, 0, 3);
      expect(result).toEqual([testData[0], testData[1], testData[2]]);
    });

    it('should handle pagination with large limit', () => {
      const result = QueryEngine.paginate(testData, 0, 100);
      expect(result.length).toBe(5);
      expect(result).toEqual(testData);
    });
  });

  describe('Sorting Functionality Tests', () => {
    it('should handle ascending sorting', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc');
      expect(result[0].age).toBe(20);
      expect(result[result.length - 1].age).toBe(40);
    });

    it('should handle descending sorting', () => {
      const result = QueryEngine.sort(testData, 'score', 'desc');
      expect(result[0].score).toBe(95);
      expect(result[result.length - 1].score).toBe(75);
    });

    it('should handle multi-field sorting', () => {
      const result = QueryEngine.sort(testData, ['active', 'age'], ['desc', 'asc']);
      // First sort by active descending, then by age ascending
      expect(result[0].active).toBe(true);
      expect(result[0].age).toBe(20);
    });

    it('should handle sorting with invalid field', () => {
      const result = QueryEngine.sort(testData, 'nonExistentField', 'asc');
      expect(result).toEqual(testData);
    });

    it('should handle sorting with empty data', () => {
      const result = QueryEngine.sort([], 'age', 'asc');
      expect(result).toEqual([]);
    });
  });

  describe('Aggregation Functionality Tests', () => {
    it('should calculate sum', () => {
      const result = QueryEngine.sum(testData, 'age');
      expect(result).toBe(20 + 25 + 30 + 35 + 40);
    });

    it('should calculate average', () => {
      const result = QueryEngine.avg(testData, 'score');
      const expectedAvg = (85 + 90 + 75 + 95 + 80) / 5;
      expect(result).toBe(expectedAvg);
    });

    it('should calculate maximum', () => {
      const result = QueryEngine.max(testData, 'age');
      expect(result).toBe(40);
    });

    it('should calculate minimum', () => {
      const result = QueryEngine.min(testData, 'score');
      expect(result).toBe(75);
    });

    it('should handle aggregation on empty data', () => {
      expect(QueryEngine.sum([], 'age')).toBe(0);
      expect(QueryEngine.avg([], 'age')).toBe(0);
      expect(QueryEngine.max([], 'age')).toBeUndefined();
      expect(QueryEngine.min([], 'age')).toBeUndefined();
    });

    it('should handle aggregation on non-numeric data', () => {
      expect(QueryEngine.sum(testData, 'name')).toBe(0);
      expect(QueryEngine.avg(testData, 'name')).toBe(0);
      expect(QueryEngine.max(testData, 'name')).toBe('test5');
      expect(QueryEngine.min(testData, 'name')).toBe('test1');
    });
  });

  describe('Grouping Functionality Tests', () => {
    it('should group by field', () => {
      const result = QueryEngine.groupBy(testData, 'active');
      expect(Object.keys(result)).toEqual(['true', 'false']);
      expect(result['true'].length).toBe(3);
      expect(result['false'].length).toBe(2);
    });

    it('should group by non-existent field', () => {
      const result = QueryEngine.groupBy(testData, 'nonExistentField');
      expect(Object.keys(result)).toEqual(['']);
      expect(result[''].length).toBe(5);
    });
  });

  describe('Edge Case Tests', () => {
    it('should handle empty conditions', () => {
      const result = QueryEngine.filter(testData, undefined);
      expect(result).toEqual(testData);
    });

    it('should handle non-existent fields', () => {
      const result = QueryEngine.filter(testData, { nonExistentField: 'value' });
      expect(result).toEqual([]);
    });

    it('should handle function conditions', () => {
      const result = QueryEngine.filter(testData, item => item.age > 30 && item.score > 80);
      expect(result.length).toBe(1);
      expect(result).toEqual([testData[3]]);
    });

    it('should handle empty data array', () => {
      const result = QueryEngine.filter([], { active: true });
      expect(result).toEqual([]);
    });

    it('should handle null and undefined values in data', () => {
      const dataWithNulls = [...testData, { id: 6, name: null, age: undefined, active: true, tags: [] }];
      const result = QueryEngine.filter(dataWithNulls, { name: null });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(6);
    });
  });

  describe('Combined Functionality Tests', () => {
    it('should handle filter, sort and pagination together', () => {
      // First filter, then sort, then paginate
      let result = QueryEngine.filter(testData, { active: true });
      result = QueryEngine.sort(result, 'age', 'desc');
      result = QueryEngine.paginate(result, 0, 2);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe(4); // age 35
      expect(result[1].id).toBe(3); // age 30
    });

    it('should handle complex query with multiple operations', () => {
      const result = QueryEngine.filter(testData, {
        $and: [
          { score: { $gte: 80 } },
          { tags: { $in: ['a', 'b'] } },
          { $or: [{ age: { $lt: 30 } }, { active: true }] },
        ],
      });

      expect(result.length).toBe(2);
      // testData[0]: id 1, score 85, tags ['a', 'b'], age 20 (matches all conditions)
      // testData[1]: id 2, score 90, tags ['b', 'c'], age 25 (matches all conditions)
      // testData[4]: id 5, score 80, tags ['a', 'b', 'c'], active false, age 40 (fails $or condition)
      expect(result).toContain(testData[0]);
      expect(result).toContain(testData[1]);
    });
  });
});
