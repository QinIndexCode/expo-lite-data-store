
/**
 * 1. 原生 slice + sort（默认实现，稳定，小数据量友好）
 *    en: Default implementation using slice and sort, stable and suitable for small datasets.
 */
export function sortByColumn<T>(data: T[], column: keyof T, order: "asc" | "desc" = "asc"): T[] {
    if (!data || data.length === 0) return [];

    const asc = order === "asc" ? 1 : -1;

    return data.slice().sort((a, b) => {
        const va = a[column];
        const vb = b[column];
        if (va === undefined || vb === undefined) return 0;
        if (va === null) return -asc;
        if (vb === null) return asc;
        return va < vb ? -asc : va > vb ? asc : 0;
    });
}

/**
 * 2. 极简比较（不做 null/undefined 特殊处理，纯字符串比较，最快但最粗糙）
 *    适合已知无脏数据、追求极限速度的场景
 *    en: Fast comparison sort, suitable for scenarios with clean data and high performance requirements.
 */
export function sortByColumnFast<T>(data: T[], column: keyof T, order: "asc" | "desc" = "asc"): T[] {
    if (!data || data.length === 0) return [];

    const asc = order === "asc" ? 1 : -1;

    return data.slice().sort((a, b) => {
        const va = String(a[column]);
        const vb = String(b[column]);
        return va === vb ? 0 : va < vb ? -asc : asc;
    });
}

/**
 * 3. 稳定计数排序（仅适用于取值范围有限且可枚举的列，如状态码、星级等）
 *    en: Stable counting sort, suitable for columns with a limited range of values, such as status codes or star ratings.
 *    时间复杂度 O(n + k)，空间换时间，大数据量优势明显
 */
export function sortByColumnCounting<T>(data: T[], column: keyof T, order: "asc" | "desc" = "asc"): T[] {
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

    if (order === "desc") keys.reverse();

    const result: T[] = [];
    for (const k of keys) {
        const items = map.get(k)!;
        // 使用循环而不是展开运算符，避免大数据量时的栈溢出
        for (let i = 0; i < items.length; i++) {
            result.push(items[i]);
        }
    }
    return result;
}

/**
 * 4. 归并排序（自实现，稳定，适合链式结构或需稳定顺序的大数组）
 * en: Merge sort implementation, stable, suitable for linked lists or stable order requirements.
 */
export function sortByColumnMerge<T>(data: T[], column: keyof T, order: "asc" | "desc" = "asc"): T[] {
    if (!data || data.length === 0) return [];

    const asc = order === "asc" ? 1 : -1;

    function merge(left: T[], right: T[]): T[] {
        const res: T[] = [];
        let i = 0, j = 0;
        while (i < left.length && j < right.length) {
            const a = left[i][column];
            const b = right[j][column];
            const cmp = a === undefined ? -1 : b === undefined ? 1 : a === null ? -1 : b === null ? 1 : a < b ? -1 : a > b ? 1 : 0;
            if (cmp * asc <= 0) res.push(left[i++]);
            else res.push(right[j++]);
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
 * 5. 慢速兜底（完整 localeCompare，支持中文、特殊符号，性能最低但最通用）
 * en: Slow fallback using localeCompare, supports Chinese and special symbols, least performant but most versatile.
 */
export function sortByColumnSlow<T>(data: T[], column: keyof T, order: "asc" | "desc" = "asc"): T[] {
    if (!data || data.length === 0) return [];

    const asc = order === "asc" ? 1 : -1;

    return data.slice().sort((a, b) => {
        const va = a[column];
        const vb = b[column];
        if (va === undefined || vb === undefined) return 0;
        if (va === null) return -asc;
        if (vb === null) return asc;
        return String(va).localeCompare(String(vb)) * asc;
    });
}


