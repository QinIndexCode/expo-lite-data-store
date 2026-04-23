# Contributing Guide

Thank you for contributing to `expo-lite-data-store`. This repository is maintained as a runtime-verified Expo storage library, so contribution quality is judged by package behavior in real Expo consumers, not by compilation alone.

[简体中文](./CONTRIBUTING.zh-CN.md) | [README](./README.md) | [Security Policy](./SECURITY.md) | [Runtime QA Guide](./docs/EXPO_RUNTIME_QA.md)

## Contribution Scope

Contributions are welcome in the following areas:

- Bug fixes
- Runtime compatibility hardening
- Tests and QA harness improvements
- Documentation and example updates
- Performance improvements backed by measurements
- New features that preserve the documented public contract

Large API or storage-format changes should be discussed in an issue before implementation.

## Environment Expectations

Use the repository root as the working directory and install dependencies before making changes:

```bash
npm install
```

Windows contributors should prefer `npm.cmd` when invoking scripts from PowerShell.

## Development Workflow

1. Create a branch from `main`.
2. Implement the change with focused commits.
3. Update tests and documentation together with the code change.
4. Run the required validation commands locally.
5. Open a pull request with a clear summary, scope, and verification evidence.

Recommended branch prefixes:

- `fix/`
- `feat/`
- `docs/`
- `chore/`
- `refactor/`

Preferred commit style: Conventional Commits.

Examples:

- `fix(storage): guard legacy folder migration on empty roots`
- `docs(readme): clarify Expo peer dependency contract`

## Required Validation

Every code contribution should run the validation commands that match its scope. At minimum:

```bash
npm test -- --runInBand
npm run typecheck
```

When packaging, install-contract, or Expo runtime behavior is affected, also run:

```bash
npm run smoke:expo-consumer
```

When changing runtime adapters, QA harness logic, storage initialization, or performance-sensitive code, run the appropriate runtime baseline:

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

If a command is intentionally skipped, explain why in the pull request.

## Documentation Standard

This repository uses the following documentation policy:

- English canonical files use the `.md` filename.
- Simplified Chinese counterparts use `.zh-CN.md`.
- Optional English alias pages may use `.en.md` only when they intentionally redirect to the canonical English document.

When updating public behavior, installation requirements, QA semantics, or release policy:

- update the English canonical document,
- update the Simplified Chinese counterpart,
- keep commands, thresholds, and verdict semantics aligned across both languages.

## Pull Request Checklist

Before opening a pull request, confirm the following:

- [ ] The branch is based on the current `main`
- [ ] Changes include tests where applicable
- [ ] `npm test -- --runInBand` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run smoke:expo-consumer` passes when packaging or runtime behavior changed
- [ ] Documentation was updated in both English and Simplified Chinese where applicable
- [ ] Generated artifacts such as `artifacts/` output or `*.tgz` files are not included in the commit

## Review Focus

Maintainers review changes against the following priorities:

- Runtime correctness in Expo Go and managed consumers
- Package export stability and install-contract clarity
- Backward compatibility for persisted data
- Error handling, recovery, and storage integrity
- Evidence-backed performance claims
- Documentation accuracy

## Reporting Issues

Use the GitHub issue templates for reproducible bug reports. Security-sensitive issues must follow the private disclosure process in [SECURITY.md](./SECURITY.md).

## License

By contributing to this repository, you agree that your contributions are licensed under the repository [MIT license](./LICENSE.txt).
