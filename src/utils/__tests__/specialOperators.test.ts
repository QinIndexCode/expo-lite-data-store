import { processUpdateOperators, separateUpdateOperators, isUpdateOperator } from '../specialOperators';

describe('processUpdateOperators', () => {
  describe('$pull', () => {
    it('removes scalar elements by value', () => {
      const result = processUpdateOperators({ tags: ['a', 'b', 'a', 'c'] }, { $pull: { tags: 'a' } });
      expect(result.tags).toEqual(['b', 'c']);
    });

    it('removes elements matching a single-key object condition', () => {
      const original = {
        items: [
          { id: 1, label: 'x' },
          { id: 2, label: 'y' },
        ],
      };
      const result = processUpdateOperators(original, { $pull: { items: { id: 1 } } });
      expect(result.items).toEqual([{ id: 2, label: 'y' }]);
    });

    it('removes elements matching ALL key/value pairs (Mongo semantics)', () => {
      const original = {
        items: [
          { id: 1, label: 'x' },
          { id: 1, label: 'y' },
          { id: 2, label: 'x' },
        ],
      };
      const result = processUpdateOperators(original, { $pull: { items: { id: 1, label: 'x' } } });
      // Only the element matching both pairs is removed.
      expect(result.items).toEqual([
        { id: 1, label: 'y' },
        { id: 2, label: 'x' },
      ]);
    });

    it('compares nested object values by deep equality', () => {
      const original = {
        entries: [
          { id: 1, meta: { city: 'Paris' } },
          { id: 2, meta: { city: 'Berlin' } },
        ],
      };
      const result = processUpdateOperators(original, { $pull: { entries: { id: 1, meta: { city: 'Paris' } } } });
      expect(result.entries).toEqual([{ id: 2, meta: { city: 'Berlin' } }]);
    });

    it('does not mutate the original record', () => {
      const original = { tags: ['a', 'b'] };
      const result = processUpdateOperators(original, { $pull: { tags: 'a' } });
      expect(original.tags).toEqual(['a', 'b']);
      expect(result.tags).toEqual(['b']);
    });

    it('leaves non-array fields untouched', () => {
      const result = processUpdateOperators({ count: 5 }, { $pull: { count: 5 } });
      expect(result.count).toBe(5);
    });
  });

  describe('$push / $addToSet / $inc / $set / $unset', () => {
    it('applies the full operator set in canonical order', () => {
      const result = processUpdateOperators(
        { tags: ['a'], set: [1], counter: 1, keep: 'yes', drop: 'gone', plain: 'old' },
        {
          $push: { tags: 'b' },
          $addToSet: { set: 1 },
          $inc: { counter: 4 },
          $set: { plain: 'new' },
          $unset: ['drop'],
        }
      );
      expect(result).toEqual({ tags: ['a', 'b'], set: [1], counter: 5, keep: 'yes', plain: 'new' });
    });

    it('appends duplicates with $addToSet only when absent', () => {
      const result = processUpdateOperators({ values: [1, 2] }, { $addToSet: { values: 2 } });
      expect(result.values).toEqual([1, 2]);
      const added = processUpdateOperators({ values: [1, 2] }, { $addToSet: { values: 3 } });
      expect(added.values).toEqual([1, 2, 3]);
    });
  });

  describe('separateUpdateOperators', () => {
    it('splits special operators from plain fields', () => {
      const { operators, regularFields } = separateUpdateOperators({
        name: 'Alice',
        $set: { age: 30 },
        $inc: { logins: 1 },
      });
      expect(operators).toEqual({ $set: { age: 30 }, $inc: { logins: 1 } });
      expect(regularFields).toEqual({ name: 'Alice' });
    });
  });

  describe('isUpdateOperator', () => {
    it('recognizes only update operators', () => {
      expect(isUpdateOperator('$pull')).toBe(true);
      expect(isUpdateOperator('$set')).toBe(true);
      expect(isUpdateOperator('$gt')).toBe(false);
      expect(isUpdateOperator('name')).toBe(false);
    });
  });
});
