import {
  sortByColumn,
  sortByColumnCounting,
  sortByColumnFast,
  sortByColumnMerge,
  sortByColumnSlow,
} from '../sortingTools';

type Row = { v: number; name?: string | null };

type SortImplementation = <T extends object>(data: T[], column: string, order?: 'asc' | 'desc') => T[];

/** Every algorithm QueryEngine.getSortFunction can dispatch to. */
const algorithms: Array<[string, SortImplementation]> = [
  ['default', sortByColumn],
  ['fast', sortByColumnFast],
  ['counting', sortByColumnCounting],
  ['merge', sortByColumnMerge],
  ['slow', sortByColumnSlow],
];

const numericRows: Row[] = [{ v: 10 }, { v: 9 }, { v: 100 }, { v: 2 }];

describe('sortingTools numeric columns', () => {
  it.each(algorithms)('%s sorts numbers by magnitude, not lexicographically', (_name, sort) => {
    expect(sort(numericRows, 'v', 'asc').map(row => row.v)).toEqual([2, 9, 10, 100]);
    expect(sort(numericRows, 'v', 'desc').map(row => row.v)).toEqual([100, 10, 9, 2]);
  });

  it('fast keeps the ASCII string fast path', () => {
    const rows = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    expect(sortByColumnFast(rows, 'name', 'asc').map(row => row.name)).toEqual(['a', 'b', 'c']);
  });

  it('slow sorts strings in deterministic code point order', () => {
    const rows = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    expect(sortByColumnSlow(rows, 'name', 'desc').map(row => row.name)).toEqual(['c', 'b', 'a']);
  });
});

/**
 * String ordering must equal Unicode code point order — the same total order
 * as SQLite's BINARY collation (UTF-8 byte order ≡ code point order), so the
 * file-system and sqlite engines return identical result sequences.
 *
 * These cases deliberately lock out both former behaviours:
 * - locale-sensitive ordering, which sorts a CJK ideograph before 'a' and
 *   interleaves case ('a' before 'A'), and
 * - naive UTF-16 code-unit ordering, which sorts the astral-plane '😀'
 *   (lead surrogate 0xD83D) before the private-use '' (U+E000).
 */
describe('sortingTools string columns follow code point order', () => {
  it.each(algorithms)('%s sorts mixed case in code point order', (_name, sort) => {
    const rows = [{ name: 'b' }, { name: 'B' }, { name: 'a' }, { name: 'A' }];
    expect(sort(rows, 'name', 'asc').map(row => row.name)).toEqual(['A', 'B', 'a', 'b']);
  });

  it.each(algorithms)('%s sorts CJK and full-width characters after ASCII', (_name, sort) => {
    const rows = [{ name: '中' }, { name: 'Ｚ' }, { name: 'a' }];
    expect(sort(rows, 'name', 'asc').map(row => row.name)).toEqual(['a', '中', 'Ｚ']);
  });

  it.each(algorithms)('%s orders surrogate pairs by code point, not UTF-16 unit', (_name, sort) => {
    const rows = [{ name: '' }, { name: '😀' }, { name: 'z' }];
    expect(sort(rows, 'name', 'asc').map(row => row.name)).toEqual(['z', '', '😀']);
  });

  it.each(algorithms)('%s puts an empty string before every other string', (_name, sort) => {
    const rows = [{ name: 'a' }, { name: '' }, { name: '中' }];
    expect(sort(rows, 'name', 'asc').map(row => row.name)).toEqual(['', 'a', '中']);
  });

  it.each(algorithms)('%s orders the mixed-case/Unicode probe dataset like SQLite BINARY', (_name, sort) => {
    const names = ['中', 'Ｚ', 'é', 'z', 'b', 'B', 'a', 'A', 'Z', 'e'];
    const rows = names.map(name => ({ name }));
    expect(sort(rows, 'name', 'asc').map(row => row.name)).toEqual([
      'A',
      'B',
      'Z',
      'a',
      'b',
      'e',
      'z',
      'é',
      '中',
      'Ｚ',
    ]);
  });

  it.each(algorithms)('%s descending order is the exact reverse of ascending', (_name, sort) => {
    const names = ['b', 'B', 'a', 'A', '中', 'Ｚ', 'z', '', '😀'];
    const rows = names.map(name => ({ name }));
    const ascending = sort(rows, 'name', 'asc').map(row => row.name);
    const descending = sort(rows, 'name', 'desc').map(row => row.name);

    expect(ascending).toEqual(['A', 'B', 'a', 'b', 'z', '中', '', 'Ｚ', '😀']);
    expect(descending).toEqual([...ascending].reverse());
  });

  it.each(algorithms)('%s keeps null and undefined at the tail in both directions', (_name, sort) => {
    const rows = [{ name: null }, { name: 'b' }, { name: undefined }, { name: 'a' }];

    const ascending = sort(rows, 'name', 'asc').map(row => row.name);
    const descending = sort(rows, 'name', 'desc').map(row => row.name);

    expect(ascending).toStrictEqual(['a', 'b', null, undefined]);
    expect(descending).toStrictEqual(['b', 'a', null, undefined]);
  });

  it.each(algorithms)('%s keeps equal keys in their original order', (_name, sort) => {
    const rows = [
      { name: 'dup', seq: 1 },
      { name: 'alt', seq: 2 },
      { name: 'dup', seq: 3 },
      { name: 'alt', seq: 4 },
      { name: 'dup', seq: 5 },
    ];

    expect(sort(rows, 'name', 'asc').map(row => row.seq)).toEqual([2, 4, 1, 3, 5]);
    expect(sort(rows, 'name', 'desc').map(row => row.seq)).toEqual([1, 3, 5, 2, 4]);
  });
});

/**
 * Mixed-type pairs (string vs Date/number/boolean) are compared through the
 * shared comparator's String() fallback, so that fallback must also be code
 * point order. String(date) starts with an uppercase weekday letter (U+0054
 * 'T') while 'apple' starts with lowercase 'a' (U+0061): code point order
 * puts the date first, a locale-sensitive comparison flips the pair, so
 * these cases pin the fallback down in both directions.
 */
describe('sortingTools cross-type fallback follows code point order', () => {
  type MixedRow = { v: string | number | boolean | Date | null | undefined };

  const dateValue = new Date(2026, 8, 29, 10, 30, 0);
  /** Expected date text is derived via String(), never a hand-written literal. */
  const dateText = String(dateValue);

  it.each(algorithms)('%s orders string vs Date by code point order', (_name, sort) => {
    const rows: MixedRow[] = [{ v: 'apple' }, { v: dateValue }];

    const ascending = sort(rows, 'v', 'asc').map(row => String(row.v));
    const descending = sort(rows, 'v', 'desc').map(row => String(row.v));

    expect(ascending).toEqual([dateText, 'apple']);
    expect(descending).toEqual(['apple', dateText]);
  });

  it.each(algorithms)('%s keeps nullish at the tail while the fallback runs', (_name, sort) => {
    const rows: MixedRow[] = [{ v: null }, { v: 'apple' }, { v: dateValue }, { v: undefined }];

    const ascending = sort(rows, 'v', 'asc');
    const descending = sort(rows, 'v', 'desc');

    expect(ascending.slice(0, 2).map(row => String(row.v))).toEqual([dateText, 'apple']);
    expect(ascending.slice(2).map(row => row.v)).toStrictEqual([null, undefined]);
    expect(descending.slice(0, 2).map(row => String(row.v))).toEqual(['apple', dateText]);
    expect(descending.slice(2).map(row => row.v)).toStrictEqual([null, undefined]);
  });

  it.each(algorithms)('%s orders string vs boolean and number by code point order', (_name, sort) => {
    const rows: MixedRow[] = [{ v: 'Zebra' }, { v: 'apple' }, { v: true }, { v: 1000 }];

    const ascending = sort(rows, 'v', 'asc').map(row => row.v);
    const descending = sort(rows, 'v', 'desc').map(row => row.v);

    expect(ascending).toEqual([1000, 'Zebra', 'apple', true]);
    expect(descending).toEqual([true, 'apple', 'Zebra', 1000]);
  });
});
