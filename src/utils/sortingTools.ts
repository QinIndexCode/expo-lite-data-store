const isRecord = (value: object): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getSortValue = (record: object, column: string): unknown => (isRecord(record) ? record[column] : undefined);

const compareNullishValues = (left: unknown, right: unknown): number | undefined => {
  const leftIsNullish = left === null || left === undefined;
  const rightIsNullish = right === null || right === undefined;

  if (leftIsNullish && rightIsNullish) return 0;
  if (leftIsNullish) return 1;
  if (rightIsNullish) return -1;
  return undefined;
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
    comparison = left.localeCompare(right);
  } else {
    comparison = String(left).localeCompare(String(right));
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

    const strA = String(va);
    const strB = String(vb);
    return strA === strB ? 0 : strA < strB ? -asc : asc;
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
 * Locale-aware fallback sort for user-facing text.
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

    return String(va).localeCompare(String(vb)) * asc;
  });
}
