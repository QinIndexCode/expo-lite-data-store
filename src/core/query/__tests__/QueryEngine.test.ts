// src/core/query/__tests__/QueryEngine.test.ts

import { QueryEngine } from '../QueryEngine';

describe('QueryEngine', () => {
    // 测试数据
    const testData = [
        { id: 1, name: 'test1', age: 20, score: 85, active: true, tags: ['a', 'b'] },
        { id: 2, name: 'test2', age: 25, score: 90, active: false, tags: ['b', 'c'] },
        { id: 3, name: 'test3', age: 30, score: 75, active: true, tags: ['a', 'c'] },
        { id: 4, name: 'test4', age: 35, score: 95, active: true, tags: ['d'] },
        { id: 5, name: 'test5', age: 40, score: 80, active: false, tags: ['a', 'b', 'c'] }
    ];

    describe('过滤功能测试', () => {
        it('应该能够处理等于操作符', () => {
            const result = QueryEngine.filter(testData, { id: 1 });
            expect(result).toEqual([testData[0]]);
        });

        it('应该能够处理不等于操作符', () => {
            const result = QueryEngine.filter(testData, { id: { $ne: 1 } });
            expect(result.length).toBe(4);
            expect(result).not.toContain(testData[0]);
        });

        it('应该能够处理大于操作符', () => {
            const result = QueryEngine.filter(testData, { age: { $gt: 25 } });
            expect(result.length).toBe(3);
            result.forEach(item => expect(item.age).toBeGreaterThan(25));
        });

        it('应该能够处理大于等于操作符', () => {
            const result = QueryEngine.filter(testData, { age: { $gte: 25 } });
            expect(result.length).toBe(4);
            result.forEach(item => expect(item.age).toBeGreaterThanOrEqual(25));
        });

        it('应该能够处理小于操作符', () => {
            const result = QueryEngine.filter(testData, { age: { $lt: 25 } });
            expect(result.length).toBe(1);
            result.forEach(item => expect(item.age).toBeLessThan(25));
        });

        it('应该能够处理小于等于操作符', () => {
            const result = QueryEngine.filter(testData, { age: { $lte: 25 } });
            expect(result.length).toBe(2);
            result.forEach(item => expect(item.age).toBeLessThanOrEqual(25));
        });

        it('应该能够处理IN操作符', () => {
            const result = QueryEngine.filter(testData, { id: { $in: [1, 3, 5] } });
            expect(result.length).toBe(3);
            expect(result).toContain(testData[0]);
            expect(result).toContain(testData[2]);
            expect(result).toContain(testData[4]);
        });

        it('应该能够处理NIN操作符', () => {
            const result = QueryEngine.filter(testData, { id: { $nin: [1, 3, 5] } });
            expect(result.length).toBe(2);
            expect(result).toContain(testData[1]);
            expect(result).toContain(testData[3]);
        });

        it('应该能够处理LIKE操作符', () => {
            const result = QueryEngine.filter(testData, { name: { $like: 'test%' } });
            expect(result.length).toBe(5);
            
            const result2 = QueryEngine.filter(testData, { name: { $like: '%2' } });
            expect(result2).toEqual([testData[1]]);
        });

        it('应该能够处理布尔值过滤', () => {
            const result = QueryEngine.filter(testData, { active: true });
            expect(result.length).toBe(3);
            result.forEach(item => expect(item.active).toBe(true));
        });

        it('应该能够处理数组包含过滤', () => {
            const result = QueryEngine.filter(testData, { tags: { $in: ['a'] } });
            expect(result.length).toBe(3);
            result.forEach(item => expect(item.tags).toContain('a'));
        });
    });

    describe('复合查询测试', () => {
        it('应该能够处理AND查询', () => {
            const result = QueryEngine.filter(testData, { $and: [{ active: true }, { age: { $gt: 25 } }] });
            expect(result.length).toBe(2);
            result.forEach(item => {
                expect(item.active).toBe(true);
                expect(item.age).toBeGreaterThan(25);
            });
        });

        it('应该能够处理OR查询', () => {
            const result = QueryEngine.filter(testData, { $or: [{ id: 1 }, { id: 5 }] });
            expect(result.length).toBe(2);
            expect(result).toContain(testData[0]);
            expect(result).toContain(testData[4]);
        });

        it('应该能够处理复杂复合查询', () => {
            const result = QueryEngine.filter(testData, {
                $and: [
                    { active: true },
                    { $or: [{ age: { $lt: 25 } }, { score: { $gt: 90 } }] }
                ]
            });
            expect(result.length).toBe(2);
            expect(result).toContain(testData[0]);
            expect(result).toContain(testData[3]);
        });
    });

    describe('分页功能测试', () => {
        it('应该能够处理基本分页', () => {
            const result = QueryEngine.paginate(testData, 1, 2);
            expect(result).toEqual([testData[1], testData[2]]);
        });

        it('应该能够处理跳过所有数据的情况', () => {
            const result = QueryEngine.paginate(testData, 10);
            expect(result).toEqual([]);
        });

        it('应该能够处理没有限制的情况', () => {
            const result = QueryEngine.paginate(testData, 2);
            expect(result.length).toBe(3);
            expect(result).toEqual([testData[2], testData[3], testData[4]]);
        });

        it('应该能够处理跳过0条数据的情况', () => {
            const result = QueryEngine.paginate(testData, 0, 3);
            expect(result).toEqual([testData[0], testData[1], testData[2]]);
        });
    });

    describe('排序功能测试', () => {
        it('应该能够处理升序排序', () => {
            const result = QueryEngine.sort(testData, 'age', 'asc');
            expect(result[0].age).toBe(20);
            expect(result[result.length - 1].age).toBe(40);
        });

        it('应该能够处理降序排序', () => {
            const result = QueryEngine.sort(testData, 'score', 'desc');
            expect(result[0].score).toBe(95);
            expect(result[result.length - 1].score).toBe(75);
        });

        it('应该能够处理多字段排序', () => {
            const result = QueryEngine.sort(testData, ['active', 'age'], ['desc', 'asc']);
            // 先按active降序，再按age升序
            expect(result[0].active).toBe(true);
            expect(result[0].age).toBe(20);
        });
    });

    describe('聚合功能测试', () => {
        it('应该能够计算总和', () => {
            const result = QueryEngine.sum(testData, 'age');
            expect(result).toBe(20 + 25 + 30 + 35 + 40);
        });

        it('应该能够计算平均值', () => {
            const result = QueryEngine.avg(testData, 'score');
            const expectedAvg = (85 + 90 + 75 + 95 + 80) / 5;
            expect(result).toBe(expectedAvg);
        });

        it('应该能够计算最大值', () => {
            const result = QueryEngine.max(testData, 'age');
            expect(result).toBe(40);
        });

        it('应该能够计算最小值', () => {
            const result = QueryEngine.min(testData, 'score');
            expect(result).toBe(75);
        });

        it('应该能够处理空数据的聚合计算', () => {
            expect(QueryEngine.sum([], 'age')).toBe(0);
            expect(QueryEngine.avg([], 'age')).toBe(0);
            expect(QueryEngine.max([], 'age')).toBeUndefined();
            expect(QueryEngine.min([], 'age')).toBeUndefined();
        });
    });

    describe('分组功能测试', () => {
        it('应该能够按字段分组', () => {
            const result = QueryEngine.groupBy(testData, 'active');
            expect(Object.keys(result)).toEqual(['true', 'false']);
            expect(result['true'].length).toBe(3);
            expect(result['false'].length).toBe(2);
        });
    });

    describe('边界条件测试', () => {
        it('应该能够处理空条件', () => {
            const result = QueryEngine.filter(testData, undefined);
            expect(result).toEqual(testData);
        });

        it('应该能够处理不存在的字段', () => {
            const result = QueryEngine.filter(testData, { nonExistentField: 'value' });
            expect(result).toEqual([]);
        });

        it('应该能够处理函数条件', () => {
            const result = QueryEngine.filter(testData, (item) => item.age > 30 && item.score > 80);
            expect(result.length).toBe(1);
            expect(result).toEqual([testData[3]]);
        });
    });
});