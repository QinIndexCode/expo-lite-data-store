const isRecord = (value: object): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getSortValue = (record: object, column: string): unknown => {
  if (!isRecord(record)) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, column)) return record[column];
  if (!column.includes('.')) return record[column];

  const parts = column.split('.');
  let current: unknown = record;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const compareNullishValues = (left: unknown, right: unknown): number | undefined => {
  const leftIsNullish = left === null || left === undefined;
  const rightIsNullish = right === null || right === undefined;

  if (leftIsNullish && rightIsNullish) return 0;
  if (leftIsNullish) return 1;
  if (rightIsNullish) return -1;
  return undefined;
};

/**
 * Compares two strings in Unicode code point order — the same total order as
 * SQLite's BINARY collation over UTF-8, so in-memory sorting matches the SQL
 * pushdown `ORDER BY`. Neither alternative agrees with it: the engine's former
 * locale-sensitive comparison reordered case, accents and CJK per locale, and
 * plain UTF-16 code-unit comparison (`<`) puts astral-plane characters such as
 * '😀' (U+1F600, lead surrogate 0xD83D) before U+E000–U+FFFF, while code
 * point order puts them after.
 */
const compareCodePointOrder = (left: string, right: string): number => {
  if (left === right) return 0;

  const leftLength = left.length;
  const rightLength = right.length;
  const sharedLength = leftLength < rightLength ? leftLength : rightLength;

  let leftIndex = 0;
  let rightIndex = 0;

  // ASCII fast path: an ASCII code unit is its own code point, so equal units
  // stay equal and differing units compare identically in code point order.
  // Anything at or above 0x80 falls through to code point resolution below.
  while (leftIndex < sharedLength) {
    const leftUnit = left.charCodeAt(leftIndex);
    const rightUnit = right.charCodeAt(rightIndex);
    if (leftUnit !== rightUnit) {
      if (leftUnit < 0x80 && rightUnit < 0x80) return leftUnit < rightUnit ? -1 : 1;
      break;
    }
    if (leftUnit > 0x7f) break;
    leftIndex++;
    rightIndex++;
  }

  if (leftIndex >= sharedLength) {
    // The shared prefix is ASCII and identical: the shorter string sorts first.
    return leftLength === rightLength ? 0 : leftLength < rightLength ? -1 : 1;
  }

  while (leftIndex < leftLength && rightIndex < rightLength) {
    const leftCode = left.codePointAt(leftIndex)!;
    const rightCode = right.codePointAt(rightIndex)!;
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
    // A matched code point occupies two UTF-16 units only when it is a
    // surrogate pair, and then on both sides; otherwise one.
    const step = leftCode > 0xffff ? 2 : 1;
    leftIndex += step;
    rightIndex += step;
  }

  if (leftIndex >= leftLength && rightIndex >= rightLength) return 0;
  return leftIndex >= leftLength ? -1 : 1;
};

const compareSortValues = (left: unknown, right: unknown, order: 'asc' | 'desc' = 'asc'): number => {
  const nullishComparison = compareNullishValues(left, right);
  if (nullishComparison !== undefined) return nullishComparison;

  if (left === right) return 0;

  let comparison: number;

  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left)) comparison = Number.isNaN(right) ? 0 : 1;
    else if (Number.isNaN(right)) comparison = -1;
    else comparison = left < right ? -1 : 1;
  } else if (typeof left === 'bigint' && typeof right === 'bigint') {
    comparison = left < right ? -1 : 1;
  } else if (left instanceof Date && right instanceof Date) {
    comparison = compareSortValues(left.getTime(), right.getTime());
  } else if (typeof left === 'string' && typeof right === 'string') {
    comparison = compareCodePointOrder(left, right);
  } else {
    comparison = compareCodePointOrder(String(left), String(right));
  }

  return order === 'desc' ? -comparison : comparison;
};

/**
 * Native slice and sort implementation.
 * @example
 * // Sort user array by age ascending
 * const sortedUsers = sortByColumn(users, 'age', 'asc');
 */
export function sortByColumn<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  return data.slice().sort((a, b) => {
    const va = getSortValue(a, column);
    const vb = getSortValue(b, column);

    return compareSortValues(va, vb, order);
  });
}

/**
 * String-comparison sort for clean, homogeneous data.
 * Non-string pairs (numbers, bigints, dates) delegate to the shared
 * value-aware comparator so numeric columns sort by magnitude, not by
 * code-unit order; string pairs go through the shared code point comparator
 * (SQLite BINARY order), which stays ASCII-fast without becoming locale
 * sensitive.
 * @example
 * // Fast sort clean array by name
 * const sortedItems = sortByColumnFast(items, 'name', 'desc');
 */
export function sortByColumnFast<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = getSortValue(a, column);
    const vb = getSortValue(b, column);

    const nullishComparison = compareNullishValues(va, vb);
    if (nullishComparison !== undefined) return nullishComparison;

    if (typeof va !== 'string' || typeof vb !== 'string') {
      return compareSortValues(va, vb, order);
    }

    return compareCodePointOrder(va, vb) * asc;
  });
}

/**
 * Stable bucket sort for columns with a small value domain.
 * @example
 * // Sort order array by status code (limited range)
 * const sortedOrders = sortByColumnCounting(orders, 'status', 'asc');
 */
export function sortByColumnCounting<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const map = new Map<unknown, T[]>();
  const nullishItems: T[] = [];
  for (const item of data) {
    const key = getSortValue(item, column);
    if (key === null || key === undefined) {
      nullishItems.push(item);
      continue;
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  const keys = Array.from(map.keys()).sort((left, right) => compareSortValues(left, right, order));

  const result: T[] = [];
  for (const k of keys) {
    const items = map.get(k)!;
    // Avoid spread here because a large bucket can exceed the call-stack argument limit.
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item !== undefined) {
        result.push(item);
      }
    }
  }
  for (const item of nullishItems) {
    result.push(item);
  }
  return result;
}

/**
 * Stable merge sort for larger collections.
 * @example
 * // Sort large array by date, maintain stable order
 * const sortedLogs = sortByColumnMerge(logs, 'timestamp', 'desc');
 */
export function sortByColumnMerge<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  function merge(left: T[], right: T[]): T[] {
    const res: T[] = [];
    let i = 0,
      j = 0;
    while (i < left.length && j < right.length) {
      const a = getSortValue(left[i]!, column);
      const b = getSortValue(right[j]!, column);

      const cmp = compareSortValues(a, b, order);

      if (cmp <= 0) res.push(left[i++]!);
      else res.push(right[j++]!);
    }
    return res.concat(left.slice(i)).concat(right.slice(j));
  }

  function mergeSort(arr: T[]): T[] {
    if (arr.length <= 1) return arr;
    const mid = Math.floor(arr.length / 2);
    return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));
  }

  return mergeSort(data.slice());
}

/**
 * String-focused fallback sort for user-facing text.
 * Non-string pairs delegate to the shared value-aware comparator so numeric
 * columns sort by magnitude; string pairs compare in deterministic Unicode
 * code point order (the SQLite BINARY collation), so the result never varies
 * with the host locale.
 * @example
 * // Sort array with Chinese names
 * const sortedProducts = sortByColumnSlow(products, 'name', 'asc');
 */
export function sortByColumnSlow<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = getSortValue(a, column);
    const vb = getSortValue(b, column);

    const nullishComparison = compareNullishValues(va, vb);
    if (nullishComparison !== undefined) return nullishComparison;

    if (typeof va !== 'string' || typeof vb !== 'string') {
      return compareSortValues(va, vb, order);
    }

    return compareCodePointOrder(va, vb) * asc;
  });
}
