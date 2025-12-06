/**
 * 排序工具模块
 * 提供多种排序算法，适用于不同场景
 */

/**
 * 1. 原生 slice + sort（默认实现，稳定）
 * @param data 要排序的数据数组
 * @param column 排序的列名
 * @param order 排序顺序（asc 升序，desc 降序），默认升序
 * @returns T[] 排序后的新数组（原数组不变）
 * @example
 * // 对用户数组按年龄升序排序
 * const sortedUsers = sortByColumn(users, 'age', 'asc');
 */
export function sortByColumn<T>(data: T[], column: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = a[column];
    const vb = b[column];

    // Handle null/undefined values - they should be at the end
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

    return va < vb ? -asc : va > vb ? asc : 0;
  });
}

/**
 * 2. 极简比较（不做 null/undefined 特殊处理，纯字符串比较，最快但最粗糙）
 * 适合已知无脏数据、追求极限速度的场景
 * @param data 要排序的数据数组
 * @param column 排序的列名
 * @param order 排序顺序（asc 升序，desc 降序），默认升序
 * @returns T[] 排序后的新数组（原数组不变）
 * @example
 * // 对已知无脏数据的数组按名称快速排序
 * const sortedItems = sortByColumnFast(items, 'name', 'desc');
 */
export function sortByColumnFast<T>(data: T[], column: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = a[column];
    const vb = b[column];

    // Handle null/undefined values - they should be at the end
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

    const strA = String(va);
    const strB = String(vb);
    return strA === strB ? 0 : strA < strB ? -asc : asc;
  });
}

/**
 * 3. 稳定计数排序（仅适用于取值范围有限且可枚举的列，如状态码、星级等）
 * 时间复杂度 O(n + k)，空间换时间，大数据量优势明显
 * @param data 要排序的数据数组
 * @param column 排序的列名
 * @param order 排序顺序（asc 升序，desc 降序），默认升序
 * @returns T[] 排序后的新数组（原数组不变）
 * @example
 * // 对订单数组按状态码排序（状态码取值范围有限）
 * const sortedOrders = sortByColumnCounting(orders, 'status', 'asc');
 */
export function sortByColumnCounting<T>(data: T[], column: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const map = new Map<any, T[]>();
  for (const item of data) {
    const key = item[column];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  if (order === 'desc') keys.reverse();

  const result: T[] = [];
  for (const k of keys) {
    const items = map.get(k)!;
    // 使用循环而不是展开运算符，避免大数据量时的栈溢出
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
 * 4. 归并排序（自实现，稳定，适合链式结构或需稳定顺序的大数组）
 * @param data 要排序的数据数组
 * @param column 排序的列名
 * @param order 排序顺序（asc 升序，desc 降序），默认升序
 * @returns T[] 排序后的新数组（原数组不变）
 * @example
 * // 对大数据量数组按日期排序，保持稳定顺序
 * const sortedLogs = sortByColumnMerge(logs, 'timestamp', 'desc');
 */
export function sortByColumnMerge<T>(data: T[], column: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  /**
   * 合并两个已排序的数组
   * @param left 左侧已排序数组
   * @param right 右侧已排序数组
   * @returns T[] 合并后的已排序数组
   */
  function merge(left: T[], right: T[]): T[] {
    const res: T[] = [];
    let i = 0,
      j = 0;
    while (i < left.length && j < right.length) {
      const a = left[i]![column];
      const b = right[j]![column];

      // Handle null/undefined values - they should be at the end
      let cmp: number;
      if ((a === null || a === undefined) && (b === null || b === undefined)) {
        cmp = 0;
      } else if (a === null || a === undefined) {
        cmp = 1; // a is null/undefined, should come after b
      } else if (b === null || b === undefined) {
        cmp = -1; // b is null/undefined, a should come before b
      } else {
        cmp = a < b ? -1 : a > b ? 1 : 0;
      }

      if (cmp * asc <= 0) res.push(left[i++]!);
      else res.push(right[j++]!);
    }
    return res.concat(left.slice(i)).concat(right.slice(j));
  }

  /**
   * 递归执行归并排序
   * @param arr 要排序的数组
   * @returns T[] 排序后的数组
   */
  function mergeSort(arr: T[]): T[] {
    if (arr.length <= 1) return arr;
    const mid = Math.floor(arr.length / 2);
    return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));
  }

  return mergeSort(data.slice());
}

/**
 * 5. 慢速兜底（完整 localeCompare，支持中文、特殊符号，性能最低但最通用）
 * @param data 要排序的数据数组
 * @param column 排序的列名
 * @param order 排序顺序（asc 升序，desc 降序），默认升序
 * @returns T[] 排序后的新数组（原数组不变）
 * @example
 * // 对包含中文名称的数组排序
 * const sortedProducts = sortByColumnSlow(products, 'name', 'asc');
 */
export function sortByColumnSlow<T>(data: T[], column: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  if (!data || data.length === 0) return [];

  const asc = order === 'asc' ? 1 : -1;

  return data.slice().sort((a, b) => {
    const va = a[column];
    const vb = b[column];

    // Handle null/undefined values - they should be at the end
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

    return String(va).localeCompare(String(vb)) * asc;
  });
}
