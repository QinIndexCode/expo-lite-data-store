import { sortByColumn, sortByColumnFast, sortByColumnSlow } from '../sortingTools';

type Row = { v: number; name?: string };

const numericRows: Row[] = [{ v: 10 }, { v: 9 }, { v: 100 }, { v: 2 }];

describe('sortingTools numeric columns', () => {
  it.each([
    ['default', sortByColumn],
    ['fast', sortByColumnFast],
    ['slow', sortByColumnSlow],
  ] as const)('%s sorts numbers by magnitude, not lexicographically', (_name, sort) => {
    expect(sort(numericRows, 'v', 'asc').map(row => row.v)).toEqual([2, 9, 10, 100]);
    expect(sort(numericRows, 'v', 'desc').map(row => row.v)).toEqual([100, 10, 9, 2]);
  });

  it('fast keeps the branch-free string fast path', () => {
    const rows = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    expect(sortByColumnFast(rows, 'name', 'asc').map(row => row.name)).toEqual(['a', 'b', 'c']);
  });

  it('slow keeps locale-aware string ordering', () => {
    const rows = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    expect(sortByColumnSlow(rows, 'name', 'desc').map(row => row.name)).toEqual(['c', 'b', 'a']);
  });
});
