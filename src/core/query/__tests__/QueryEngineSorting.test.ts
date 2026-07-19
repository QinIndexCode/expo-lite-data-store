import { QueryEngine } from '../QueryEngine';

describe('QueryEngine sorting', () => {
  const testData = [
    { id: 1, name: 'Alice', age: 25, score: 85.5, active: true, category: 'A' },
    { id: 2, name: 'Bob', age: 30, score: 92.0, active: false, category: 'B' },
    { id: 3, name: 'Charlie', age: 20, score: 78.3, active: true, category: 'A' },
    { id: 4, name: 'Diana', age: 35, score: 88.7, active: true, category: 'C' },
    { id: 5, name: 'Eve', age: 28, score: 91.2, active: false, category: 'B' },
  ];

  describe('basic sorting', () => {
    it('sorts records by one field in ascending order', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc');
      expect(result[0].age).toBe(20);
      expect(result[1].age).toBe(25);
      expect(result[2].age).toBe(28);
      expect(result[3].age).toBe(30);
      expect(result[4].age).toBe(35);
    });

    it('sorts records by one field in descending order', () => {
      const result = QueryEngine.sort(testData, 'age', 'desc');
      expect(result[0].age).toBe(35);
      expect(result[1].age).toBe(30);
      expect(result[2].age).toBe(28);
      expect(result[3].age).toBe(25);
      expect(result[4].age).toBe(20);
    });

    it('sorts records by a string field', () => {
      const result = QueryEngine.sort(testData, 'name', 'asc');
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
      expect(result[2].name).toBe('Charlie');
      expect(result[3].name).toBe('Diana');
      expect(result[4].name).toBe('Eve');
    });

    it('sorts records by a numeric field', () => {
      const result = QueryEngine.sort(testData, 'score', 'desc');
      expect(result[0].score).toBe(92.0);
      expect(result[1].score).toBe(91.2);
      expect(result[2].score).toBe(88.7);
      expect(result[3].score).toBe(85.5);
      expect(result[4].score).toBe(78.3);
    });

    it('sorts records by a boolean field', () => {
      const result = QueryEngine.sort(testData, 'active', 'asc');
      expect(result[0].active).toBe(false);
      expect(result[1].active).toBe(false);
      expect(result.slice(2).every(item => item.active === true)).toBe(true);
    });
  });

  describe('multi-field sorting', () => {
    it('sorts records by multiple fields', () => {
      const data = [
        { name: 'Alice', age: 25, score: 85 },
        { name: 'Bob', age: 30, score: 90 },
        { name: 'Alice', age: 20, score: 95 },
        { name: 'Bob', age: 25, score: 80 },
      ];

      const result = QueryEngine.sort(data, ['name', 'age'], ['asc', 'asc']);

      expect(result[0]).toEqual({ name: 'Alice', age: 20, score: 95 });
      expect(result[1]).toEqual({ name: 'Alice', age: 25, score: 85 });
      expect(result[2]).toEqual({ name: 'Bob', age: 25, score: 80 });
      expect(result[3]).toEqual({ name: 'Bob', age: 30, score: 90 });
    });

    it('applies mixed sort orders', () => {
      const data = [
        { category: 'A', score: 80 },
        { category: 'A', score: 90 },
        { category: 'B', score: 85 },
        { category: 'B', score: 75 },
      ];

      const result = QueryEngine.sort(data, ['category', 'score'], ['asc', 'desc']);

      expect(result[0]).toEqual({ category: 'A', score: 90 });
      expect(result[1]).toEqual({ category: 'A', score: 80 });
      expect(result[2]).toEqual({ category: 'B', score: 85 });
      expect(result[3]).toEqual({ category: 'B', score: 75 });
    });
  });

  describe('algorithm selection', () => {
    it('uses the default algorithm when none is specified', () => {
      const result = QueryEngine.sort(testData, 'age');
      expect(result[0].age).toBe(20);
      expect(result[4].age).toBe(35);
    });

    it('uses a specified algorithm', () => {
      const result = QueryEngine.sort(testData, 'age', 'asc', 'merge');
      expect(result[0].age).toBe(20);
      expect(result[4].age).toBe(35);
    });

    it('returns empty data unchanged', () => {
      const result = QueryEngine.sort([], 'age');
      expect(result).toEqual([]);
    });

    it('returns data unchanged when no sort field is provided', () => {
      const result = QueryEngine.sort(testData);
      expect(result).toEqual(testData);
    });
  });

  describe('algorithm consistency', () => {
    const algorithms = ['default', 'fast', 'counting', 'merge', 'slow'] as const;
    const dataWithNullishValues = [
      { id: 'null-first', value: null },
      { id: 'b', value: 'b' },
      { id: 'undefined-middle', value: undefined },
      { id: 'a', value: 'a' },
      { id: 'null-late', value: null },
      { id: 'c', value: 'c' },
      { id: 'undefined-late', value: undefined },
    ];
    const nullishIds = ['null-first', 'undefined-middle', 'null-late', 'undefined-late'];

    it.each(algorithms)('keeps nullish values stable and last with the %s algorithm', algorithm => {
      const ascending = QueryEngine.sort(dataWithNullishValues, 'value', 'asc', algorithm);
      const descending = QueryEngine.sort(dataWithNullishValues, 'value', 'desc', algorithm);

      expect(ascending.map(item => item.id)).toEqual(['a', 'b', 'c', ...nullishIds]);
      expect(descending.map(item => item.id)).toEqual(['c', 'b', 'a', ...nullishIds]);
    });
  });

  describe('edge cases', () => {
    it('orders null and undefined values consistently', () => {
      const dataWithNulls = [
        { name: 'Alice', age: null },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: undefined },
        { name: 'Diana', age: 20 },
      ];

      const result = QueryEngine.sort(dataWithNulls, 'age', 'asc');
      expect(result[0].name).toBe('Diana');
      expect(result[1].name).toBe('Bob');
    });

    it('sorts mixed data types consistently', () => {
      const mixedData = [{ value: 'text' }, { value: 100 }, { value: null }, { value: 'abc' }];

      const result = QueryEngine.sort(mixedData, 'value', 'asc');
      expect(result).toHaveLength(4);
    });
  });

  describe('pagination validation', () => {
    it('rejects invalid skip and limit boundaries', () => {
      const invalidBoundaries = [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1];

      for (const boundary of invalidBoundaries) {
        expect(() => QueryEngine.paginate(testData, boundary)).toThrow(RangeError);
        expect(() => QueryEngine.paginate(testData, 0, boundary)).toThrow(RangeError);
      }
    });
  });
});
