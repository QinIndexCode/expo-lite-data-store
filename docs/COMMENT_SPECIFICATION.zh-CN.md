# 注释规范 / Comment Specification

[README 入口](../README.md) | [English](./COMMENT_SPECIFICATION.en.md) | [消费者文档](../README.zh-CN.md)

## 1. 文件头注释 / File Header Comment

每个源文件应包含文件头注释，说明文件用途、创建日期和最后修改日期。

```typescript
// src/core/example/ExampleModule.ts
// 模块描述，简要说明该模块的功能
// 创建于: YYYY-MM-DD
// 最后修改: YYYY-MM-DD
```

## 2. JSDoc 注释 / JSDoc Comments

公共 API（导出的类、函数、接口）应使用 JSDoc 格式注释。

````typescript
/**
 * 函数简要描述
 *
 * @param paramName 参数描述
 * @returns 返回值描述
 * @throws ErrorType 异常描述（如有）
 * @example
 * ```typescript
 * const result = exampleFunction('param');
 * ```
 */
export function exampleFunction(paramName: string): string {
  // ...
}
````

## 3. 类注释 / Class Comments

公共类应包含类级别注释，说明类的用途和使用方式。

```typescript
/**
 * 类简要描述
 *
 * @description 详细描述类的功能、设计模式和使用场景
 * @since 版本号
 * @version 当前版本
 */
export class ExampleClass {
  // ...
}
```

## 4. 行内注释 / Inline Comments

- 行内注释应简洁明了，解释"为什么"而非"是什么"
- 复杂逻辑必须添加注释说明
- 使用中文注释，保持项目一致性

```typescript
// 好的注释：解释为什么这样做
if (cache.size > MAX_SIZE) {
  // 超过缓存上限时触发清理，避免内存溢出
  cache.clear();
}

// 不好的注释：重复代码意图
// 如果缓存大小超过最大值，清除缓存
if (cache.size > MAX_SIZE) {
  cache.clear();
}
```

## 5. TODO 注释 / TODO Comments

使用标准格式的 TODO 注释，便于追踪。

```typescript
// TODO(username): 描述待完成的工作
// TODO: 短期任务描述 - 预计完成日期
```

## 6. 模块导出注释 / Module Export Comments

在 index.ts 或主导出文件中，为每个导出项添加简要说明。

```typescript
/**
 * 创建表
 * @param tableName 表名
 * @param options 创建表选项
 * @returns Promise<void>
 */
export const createTable = async (tableName: string, options?: CreateTableOptions): Promise<void> => {
  // ...
};
```
