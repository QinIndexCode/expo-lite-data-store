# Code Comment and Test Style

[README Entry](../README.md) | [Simplified Chinese](./COMMENT_SPECIFICATION.zh-CN.md) | [Contributing Guide](../CONTRIBUTING.en.md)

## Scope and Language

This guide applies to maintained TypeScript source, tests, and test helpers. Write code comments and TSDoc in English so a single code path has one searchable language. User-facing documentation remains bilingual under the repository documentation policy.

Git records authorship and change history. Do not add or update manual creation dates, last-modified dates, or release-version tags in source comments. Generated files and third-party code are out of scope.

## When to Comment

Add a comment only when it preserves information that code alone cannot express:

- a public package API has a non-obvious contract, side effect, lifecycle, or failure mode;
- a security, persistence, compatibility, or concurrency invariant explains why an implementation must remain structured as it is;
- a branch, cache, or recovery path intentionally handles an edge case that would otherwise look redundant.

Do not add file headers, class comments, or line-by-line narration merely because a symbol is exported. Clear names, types, and small functions are the default documentation.

## TSDoc for Public APIs

Use concise TSDoc for exported APIs whose behavior is not obvious from their type and name. Start with a sentence ending in a period. Add `@param`, `@returns`, or `@throws` only when they communicate a meaningful contract that the signature does not already make clear.

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

Avoid duplicate `@description` blocks, bilingual copies of the same text, and stale `@since` or `@version` tags.

## Inline Comments

Inline comments explain **why**, an invariant, or a deliberately non-obvious trade-off. Keep them adjacent to the code they justify and remove them when the code changes.

```typescript
// Only the current expiry entry may evict this key: a refresh leaves an older heap entry behind.
if (item.expiry !== heapEntry.expiry) {
  continue;
}
```

Avoid comments that restate the next line, such as `// increment index` before `index += 1`.

## TODOs

Use a stable owner or tracker reference and state the remaining work:

```typescript
// TODO(#123): Replace the legacy decoder after the migration window closes.
// TODO(maintainer): Remove this compatibility path when v2 metadata is no longer supported.
```

Do not leave anonymous, date-based, or already-resolved TODOs in maintained code.

## Test Style

- Use `describe` for groups and `it` for cases. Write titles in English as direct observable outcomes under a condition: `it('rejects traversal segments in table names', ...)`. Do not mix in `test(...)`, commit focused or skipped cases, or use expectation phrasing such as `should ...`.
- Keep each test in arrange, act, assert order. Use blank lines to separate the phases; add comments only when a fixture or assertion has a non-obvious purpose.
- Prefer typed fixtures, helpers, and generic mocks. Do not use explicit `any`; use `unknown` at untrusted boundaries and narrow it before use.
- Restore spies, environment variables, timers, and module state in `afterEach` or `finally`. Remove temporary directories and generated files created by a test.
- Keep performance measurements out of deterministic functional suites unless the assertion is about behavior rather than a machine-dependent threshold.

## Review Checklist

- Comments describe durable intent rather than implementation narration or Git history.
- Public contracts, persistence invariants, and failure behavior are documented where needed.
- Tests are isolated, deterministic, typed, and clean up every resource they create.
