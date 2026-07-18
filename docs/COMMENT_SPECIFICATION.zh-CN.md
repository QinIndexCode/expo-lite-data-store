# 代码注释与测试风格

[README 入口](../README.md) | [English](./COMMENT_SPECIFICATION.en.md) | [贡献指南](../CONTRIBUTING.zh-CN.md)

## 适用范围与语言

本规范适用于仓库维护的 TypeScript 源码、测试和测试辅助代码。代码注释与 TSDoc 统一使用英文，使同一条代码路径只有一种可检索语言；面向用户的文档仍按仓库文档政策维护中英文版本。

作者和变更历史应由 Git 记录。不要在源码注释中手工维护创建日期、最后修改日期或发布版本号。生成文件和第三方代码不在本规范范围内。

## 何时需要注释

仅当注释能保留代码本身无法表达的信息时才添加：

- 公开包 API 存在不直观的契约、副作用、生命周期或失败方式；
- 安全、持久化、兼容性或并发不变量解释了实现为何必须保持当前结构；
- 某个分支、缓存或恢复路径刻意处理边界情况，否则看起来会像冗余代码。

不要仅因符号被导出就添加文件头、类注释或逐行旁白。清晰的命名、类型和小函数才是默认文档方式。

## 公开 API 的 TSDoc

当导出 API 的行为无法从名称和类型直接看出时，使用简洁 TSDoc。首句为完整句子；仅在签名无法表达关键契约时添加 `@param`、`@returns` 或 `@throws`。

```typescript
/**
 * Replays a committed append journal before exposing table records.
 *
 * @throws StorageError when the journal cannot be reconciled safely.
 */
export async function recoverAppendJournal(tableName: string): Promise<void> {
  // ...
}
```

避免重复的 `@description`、同一内容的双语副本，以及会过期的 `@since` 或 `@version` 标签。

## 行内注释

行内注释应解释**为什么**、不变量或有意保留的非直观取舍。它必须紧邻所说明的代码，并在代码变化时同步删除或更新。

```typescript
// Only the current expiry entry may evict this key: a refresh leaves an older heap entry behind.
if (item.expiry !== heapEntry.expiry) {
  continue;
}
```

不要重复下一行代码的字面含义，例如在 `index += 1` 前写“递增索引”。

## TODO

TODO 必须带有稳定的负责人或跟踪引用，并说明剩余工作：

```typescript
// TODO(#123): Replace the legacy decoder after the migration window closes.
// TODO(maintainer): Remove this compatibility path when v2 metadata is no longer supported.
```

不要在维护中的代码里保留匿名、仅带日期或已经完成的 TODO。

## 测试风格

- 以被测单元组织 `describe`；`describe`、`it` 和 `test` 标题统一使用英文，直接描述可观察结果和条件，例如 `it('rejects traversal segments in table names', ...)`，避免使用 `should ...` 这类预期式措辞。
- 每个测试遵循 arrange、act、assert 顺序，并用空行分隔阶段；只有 fixture 或断言目的不直观时才添加注释。
- 优先使用有类型的 fixture、helper 和泛型 mock。禁止显式 `any`；不可信边界使用 `unknown`，并在使用前收窄。
- 在 `afterEach` 或 `finally` 中恢复 spy、环境变量、计时器和模块状态；删除测试创建的临时目录与生成文件。
- 除非断言的是行为而非机器相关阈值，否则性能测量不得混入确定性功能测试套件。

## 审查清单

- 注释说明持久意图，而不是实现旁白或 Git 历史。
- 在需要处记录公开契约、持久化不变量和失败行为。
- 测试隔离、确定、类型完整，并清理其创建的所有资源。
