// 引入所有排序实现
const {
    sortByColumn,
    sortByColumnFast,
    sortByColumnCounting,
    sortByColumnMerge,
    sortByColumnSlow,
} = require("./src/utils/sortingTools");

// 生成测试数据
const testData = require("./test_data.json");
const bigData = testData.concat(
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData,
    testData
);
const bigBetterData = bigData.concat(
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData,
    bigData
);

const biggestData = bigBetterData.concat(
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData,
    bigBetterData
);

// 通用计时函数（返回毫秒数字）
const getSortTime = (
    sortFn: Function,
    data: any[],
    column: string,
    order: "asc" | "desc" = "asc"
): number => {
    const copy = data.slice(); // 避免污染原数组
    const start = Date.now();
    sortFn(copy, column, order);
    return Date.now() - start;
};

// 工具：把结果写 JSON 文件
const fs = require("fs");
const path = require("path");
const writeResult = (fileName: string, obj: any) => {
    const target = path.join(__dirname, fileName);
    fs.writeFileSync(target, JSON.stringify(obj, null, 2));
};

// 需要测试的列
const columns = ["id", "name", "date", "isActive"];

// 需要测试的排序算法
const algorithms = {
    default: sortByColumn,
    fast: sortByColumnFast,
    counting: sortByColumnCounting,
    merge: sortByColumnMerge,
    slow: sortByColumnSlow,
};

// 数据集配置
const datasets = [
    { name: 'bigData', data: bigData, size: bigData.length },
    { name: 'bigBetterData', data: bigBetterData, size: bigBetterData.length },
    { name: 'biggestData', data: biggestData, size: biggestData.length }
];

// 存储所有测试结果用于最终对比
const allResults: any = {};

// 用户体验评估函数
const userExperience = (t: number) =>
    t <= 100 ? "排序速度快,用户几乎感觉不到延迟" :
    t <= 200 ? "排序结果慢,用户可以接受延迟" :
    "排序结果非常慢,用户需要等待较长时间";

// 依次测试每种算法在不同数据量下的性能
for (const [algoName, sortFn] of Object.entries(algorithms)) {
    allResults[algoName] = {};
    
    for (const dataset of datasets) {
        console.log(`\n========== 正在测试 ${algoName} 算法 (数据集: ${dataset.name}, 数据量: ${dataset.size}) ==========`);

        const timestamp = new Date().toISOString();
        const record: any = { [timestamp]: {} };

        // 每列正序 & 倒序
        for (const col of columns) {
            const tAsc = getSortTime(sortFn, dataset.data, col, "asc");
            const tDesc = getSortTime(sortFn, dataset.data, col, "desc");
            record[timestamp][col] = `${tAsc}ms`;
            record[timestamp][`${col}_desc`] = `${tDesc}ms`;
        }

        // 写独立文件
        const fileName = `sortingEnd_${algoName}_${dataset.name}.json`;
        writeResult(fileName, record);
        console.log(`${algoName} (${dataset.name}) 结果已写入 ${fileName}`);

        // 计算平均耗时
        const avg: any = {};
        for (const col of columns) {
            const asc = parseInt(record[timestamp][col]);
            const desc = parseInt(record[timestamp][`${col}_desc`]);
            avg[col] = (asc + desc) / 2;
        }
        console.log(`${algoName} (${dataset.name}) 每列平均耗时:`, avg);

        // 用户体验
        for (const col of columns) {
            console.log(`${algoName} (${dataset.name}) ${col}列排序体验:`, userExperience(avg[col]));
        }

        // 综合性能分析
        const scores: Record<string, number> = {};
        let total = 0;
        for (const col of columns) {
            const t = avg[col];
            let s = 20;
            if (t <= 50) s = 100;
            else if (t <= 100) s = 80;
            else if (t <= 200) s = 60;
            else if (t <= 500) s = 40;
            scores[col] = s;
            total += s;
        }
        const avgScore = total / columns.length;
        const slowest = columns.reduce((a, b) => (avg[a] > avg[b] ? a : b));

        console.log(`\n${algoName} (${dataset.name}) 整体性能评分：${avgScore.toFixed(1)}/100`);
        console.log(`${algoName} (${dataset.name}) 性能瓶颈列：${slowest}（平均 ${avg[slowest].toFixed(2)} ms）`);
        if (avgScore >= 90) console.log("✅ 当前排序性能优秀，无需优化。");
        else if (avgScore >= 70) console.log("⚠️  建议对瓶颈列开启索引或分页加载。");
        else if (avgScore >= 50) console.log("⚠️  强烈建议开启虚拟滚动 + 索引 + 分页，减少一次性排序数据量。");
        else console.log("❌ 性能严重不足，必须采用服务端排序或 Web Worker，避免主线程阻塞。");

        console.log(`${algoName} (${dataset.name}) 各列评分：`);
        for (const col of columns) {
            console.log(`  ${col.padEnd(8)} : ${scores[col]} 分 (${userExperience(avg[col])})`);
        }

        // 保存结果用于最终对比
        allResults[algoName][dataset.name] = {
            avg,
            avgScore,
            size: dataset.size
        };
    }
}
//各算法性能排序对比

// 综合对比各个算法在不同数据量下的性能
console.log("\n\n========== 各算法性能综合对比 ==========");

// 按数据量分组进行对比
for (const dataset of datasets) {
    console.log(`\n----- ${dataset.name} (数据量: ${dataset.size}) -----`);
    console.log(`算法名称\t平均耗时(ms)\t性能评分`);
    console.log(`----------------------------------------`);
    
    // 计算每种算法的总体平均耗时（所有列的平均值）
    const algoStats: any = {};
    for (const [algoName, results] of Object.entries(allResults)) {
        if ((results as Record<string, any>)[dataset.name]) {
            const avgTimes = (results as Record<string, any>)[dataset.name].avg;
            const totalAvg = Object.values(avgTimes as Record<string, number>)
                .reduce((sum: number, val: number) => sum + val, 0) / columns.length;
            algoStats[algoName] = {
                totalAvg,
                score: (results as Record<string, any>)[dataset.name].avgScore
            };
        }
    }
    
    // 按平均耗时排序并输出
    Object.entries(algoStats)
        .sort(([,a], [,b]) => (a as { totalAvg: number }).totalAvg - (b as { totalAvg: number }).totalAvg)
        .forEach(([algoName, stats]) => {
            console.log(`${algoName.padEnd(10)}\t${(stats as { totalAvg: number; score: number }).totalAvg.toFixed(2)}\t\t${(stats as { totalAvg: number; score: number }).score.toFixed(1)}/100`);
        });
}

// 总结不同数据量下的最优算法
console.log("\n\n========== 数据量扩展性能对比 ==========");
for (const [algoName, results] of Object.entries(allResults)) {
    console.log(`\n${algoName} 算法在不同数据量下的表现：`);
    datasets.forEach(dataset => {
        if ((results as Record<string, any>)[dataset.name]) {
            const totalAvg = Object.values((results as Record<string, any>)[dataset.name].avg as Record<string, number>)
                .reduce((sum: number, val: number) => sum + val, 0) / columns.length;
            console.log(`  ${dataset.name}: ${totalAvg.toFixed(2)}ms (评分: ${(results as Record<string, any>)[dataset.name].avgScore.toFixed(1)}/100)`);
        }
    });
}

console.log("\n全部算法测试和对比完成！");


// 保存综合对比结果
writeResult("sortingComparisonSummary.json", allResults);
console.log("综合对比结果已保存到 sortingComparisonSummary.json");
// 最佳算法选择
console.log("\n\n========== 最佳算法选择 ==========");
datasets.forEach(dataset => {
    // 在当前 dataset 作用域内重新计算 algoStats
    const algoStats: any = {};
    for (const [algoName, results] of Object.entries(allResults)) {
        if ((results as Record<string, any>)[dataset.name]) {
            const avgTimes = (results as Record<string, any>)[dataset.name].avg;
            const totalAvg = Object.values(avgTimes as Record<string, number>)
                .reduce((sum: number, val: number) => sum + val, 0) / columns.length;
            algoStats[algoName] = {
                totalAvg,
                score: (results as Record<string, any>)[dataset.name].avgScore
            };
        }
    }

    const bestAlgo = Object.entries(algoStats)
        .sort(([,a], [,b]) => (b as { totalAvg: number; score: number }).score - (a as { totalAvg: number; score: number }).score)
        .map(([name]) => name)[0];
    console.log(`${dataset.name} 最佳算法: ${bestAlgo} (平均耗时: ${algoStats[bestAlgo].totalAvg.toFixed(2)}ms, 评分: ${algoStats[bestAlgo].score.toFixed(1)}/100)`);
});
