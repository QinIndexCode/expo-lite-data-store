const isRecord = (value: object): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getSortValue = (record: object, column: string): unknown => (isRecord(record) ? record[column] : undefined);

const compareSortValues = (left: unknown, right: unknown): number => {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;
    if (Number.isNaN(right)) return -1;
    return left < right ? -1 : 1;
  }

  if (typeof left === 'bigint' && typeof right === 'bigint') {
    return left < right ? -1 : 1;
  }

  if (left instanceof Date && right instanceof Date) {
    return compareSortValues(left.getTime(), right.getTime());
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }

  return String(left).localeCompare(String(right));
};

/**
 * Native slice and sort implementation.
 * @example
 * // Sort user array by age ascending
 * const sortedUsers = sortByColumn(users, 'age', 'asc');
 */
export function sortByColumn<T extends object>(data: T[], column: string, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = getSortValue(a, column);
    const vb = getSortValue(b, column);

    return compareSortValues(va, vb) * asc;
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

    // Handle null/undefined values - they should be at the end
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

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
  for (const item of data) {
    const key = getSortValue(item, column);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  const keys = Array.from(map.keys()).sort(compareSortValues);

  if (order === 'desc') keys.reverse();

  const result: T[] = [];
  for (const k of keys) {
    const items = map.get(k)!;
    // Use loop instead of spread to avoid stack overflow on large data
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item !== undefined) {
        result.push(item);
      }
    }
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

  const asc = order === 'asc' ? 1 : -1;

  function merge(left: T[], right: T[]): T[] {
    const res: T[] = [];
    let i = 0,
      j = 0;
    while (i < left.length && j < right.length) {
      const a = getSortValue(left[i]!, column);
      const b = getSortValue(right[j]!, column);

      const cmp = compareSortValues(a, b);

      if (cmp * asc <= 0) res.push(left[i++]!);
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

    // Handle null/undefined values - they should be at the end
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

    return String(va).localeCompare(String(vb)) * asc;
  });
}
