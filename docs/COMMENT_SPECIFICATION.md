# Comment Specification

[简体中文](./COMMENT_SPECIFICATION.zh-CN.md) | [English Alias](./COMMENT_SPECIFICATION.en.md) | [Consumer Guide](../README.md)

## 1. File Header Comment

Every source file should include a file header comment describing the file's purpose, creation date, and last modified date.

```typescript
/**
 * @module module-name
 * @description Brief description in English
 * @since YYYY-MM-DD
 * @version semver
 */
```

## 2. JSDoc Comments

Public APIs (exported classes, functions, interfaces) should use JSDoc format comments.

```typescript
/**
 * Brief function description
 *
 * @param paramName Parameter description
 * @returns Return value description
 * @throws ErrorType Exception description (if applicable)
 * @example
 * ```typescript
 * const result = exampleFunction('param');
 * ```
 */
export function exampleFunction(paramName: string): string {
  // ...
}
```

## 3. Class Comments

Public classes should include class-level comments explaining the class's purpose and usage.

```typescript
/**
 * Brief class description
 *
 * @description Detailed description of the class's functionality, design patterns, and use cases
 * @since Version number
 * @version Current version
 */
export class ExampleClass {
  // ...
}
```

## 4. Inline Comments

- Inline comments should be concise and explain "why" rather than "what"
- Complex logic must include explanatory comments
- Use English comments for consistency

```typescript
// Good comment: explains why this is done
if (cache.size > MAX_SIZE) {
  // Trigger cleanup when cache exceeds limit to prevent memory overflow
  cache.clear();
}

// Bad comment: repeats code intent
// If cache size exceeds max, clear cache
if (cache.size > MAX_SIZE) {
  cache.clear();
}
```

## 5. TODO Comments

Use standard format for TODO comments for easy tracking.

```typescript
// TODO(username): Description of pending work
// TODO: Short-term task description - Expected completion date
```

## 6. Module Export Comments

In index.ts or main export files, add brief descriptions for each exported item.

```typescript
/**
 * Create a table
 * @param tableName Table name
 * @param options Create table options
 * @returns Promise<void>
 */
export const createTable = async (tableName: string, options?: CreateTableOptions): Promise<void> => {
  // ...
};
```
