// src/core/query/__tests__/QueryEngineSorting.test.ts
// QueryEngine 排序功能测试

import { QueryEngine } from '../QueryEngine';

describe('QueryEngine Sorting', () => {
  const testData = [
    { id: 1, name: 'Alice', age: 25, score: 85.5, active: true, category: 'A' },
    { id: 2, name: 'Bob', age: 30, score: 92.0, active: false, category: 'B' },
    { id: 3, name: 'Charlie', age: 20, score: 78.3, active: true, category: 'A' },
    { id: 4, name: 'Diana', age: 35, score: 88.7, active: true, category: 'C' },
    { id: 5, name: 'Eve', age: 28, score: 91.2, active: false, category: 'B' },
  ];

  describe('Basic Sorting', () => {
    it('should sort by single field ascending', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc');
      expect(result[0].age).toBe(20);
      expect(result[1].age).toBe(25);
      expect(result[2].age).toBe(28);
      expect(result[3].age).toBe(30);
      expect(result[4].age).toBe(35);
    });

    it('should sort by single field descending', () => {
      const result = QueryEngine.sort(testData, 'age', 'desc');
      expect(result[0].age).toBe(35);
      expect(result[1].age).toBe(30);
      expect(result[2].age).toBe(28);
      expect(result[3].age).toBe(25);
      expect(result[4].age).toBe(20);
    });

    it('should sort by string field', () => {
      const result = QueryEngine.sort(testData, 'name', 'asc');
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
      expect(result[2].name).toBe('Charlie');
      expect(result[3].name).toBe('Diana');
      expect(result[4].name).toBe('Eve');
    });

    it('should sort by number field', () => {
      const result = QueryEngine.sort(testData, 'score', 'desc');
      expect(result[0].score).toBe(92.0);
      expect(result[1].score).toBe(91.2);
      expect(result[2].score).toBe(88.7);
      expect(result[3].score).toBe(85.5);
      expect(result[4].score).toBe(78.3);
    });

    it('should sort by boolean field', () => {
      const result = QueryEngine.sort(testData, 'active', 'asc');
      // false values come first
      expect(result[0].active).toBe(false);
      expect(result[1].active).toBe(false);
      expect(result.slice(2).every(item => item.active === true)).toBe(true);
    });
  });

  describe('Multi-field Sorting', () => {
    it('should sort by multiple fields', () => {
      const data = [
        { name: 'Alice', age: 25, score: 85 },
        { name: 'Bob', age: 30, score: 90 },
        { name: 'Alice', age: 20, score: 95 },
        { name: 'Bob', age: 25, score: 80 },
      ];

      const result = QueryEngine.sort(data, ['name', 'age'], ['asc', 'asc']);

      // First by name asc, then by age asc
      expect(result[0]).toEqual({ name: 'Alice', age: 20, score: 95 });
      expect(result[1]).toEqual({ name: 'Alice', age: 25, score: 85 });
      expect(result[2]).toEqual({ name: 'Bob', age: 25, score: 80 });
      expect(result[3]).toEqual({ name: 'Bob', age: 30, score: 90 });
    });

    it('should handle mixed sort orders', () => {
      const data = [
        { category: 'A', score: 80 },
        { category: 'A', score: 90 },
        { category: 'B', score: 85 },
        { category: 'B', score: 75 },
      ];

      const result = QueryEngine.sort(data, ['category', 'score'], ['asc', 'desc']);

      // Category asc, then score desc within each category
      expect(result[0]).toEqual({ category: 'A', score: 90 });
      expect(result[1]).toEqual({ category: 'A', score: 80 });
      expect(result[2]).toEqual({ category: 'B', score: 85 });
      expect(result[3]).toEqual({ category: 'B', score: 75 });
    });
  });

  describe('Algorithm Selection', () => {
    it('should use default algorithm when not specified', () => {
      const result = QueryEngine.sort(testData, 'age');
      expect(result[0].age).toBe(20);
      expect(result[4].age).toBe(35);
    });

    it('should use specified algorithm', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc', 'merge');
      expect(result[0].age).toBe(20);
      expect(result[4].age).toBe(35);
    });

    it('should handle empty data', () => {
      const result = QueryEngine.sort([], 'age');
      expect(result).toEqual([]);
    });

    it('should handle undefined sortBy', () => {
      const result = QueryEngine.sort(testData);
      expect(result).toEqual(testData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', () => {
      const dataWithNulls = [
        { name: 'Alice', age: null },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: undefined },
        { name: 'Diana', age: 20 },
      ];

      const result = QueryEngine.sort(dataWithNulls, 'age', 'asc');
      // null/undefined should be treated consistently
      expect(result[0].name).toBe('Diana'); // age: 20
      expect(result[1].name).toBe('Bob'); // age: 25
    });

    it('should handle mixed data types', () => {
      const mixedData = [{ value: 'text' }, { value: 100 }, { value: null }, { value: 'abc' }];

      const result = QueryEngine.sort(mixedData, 'value', 'asc');
      // Should sort consistently without errors
      expect(result).toHaveLength(4);
    });
  });
});
