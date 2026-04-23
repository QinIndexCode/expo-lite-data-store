# Security Policy

`expo-lite-data-store` is a local storage library for Expo applications. Security reports are handled privately and should not be opened as public GitHub issues until the maintainers confirm disclosure timing.

[简体中文](./SECURITY.zh-CN.md) | [README](./README.md) | [Contributing Guide](./CONTRIBUTING.md)

## Supported Versions

Only the current stable major line receives security fixes.

| Version | Supported |
| --- | --- |
| `2.0.x` | Yes |
| `< 2.0.0` | No |

## Reporting a Vulnerability

Report vulnerabilities by email to [qinindexcode@gmail.com](mailto:qinindexcode@gmail.com).

Use a subject line similar to:

```text
[expo-lite-data-store][security] short summary
```

Include the following information whenever possible:

- affected package version,
- Expo SDK, React Native, and platform details,
- runtime surface such as Expo Go, managed app, native dev client, or standalone build,
- crypto provider in use, for example `expo-go-js-fallback` or `react-native-quick-crypto`,
- reproduction steps or a minimal repository,
- relevant logs, `summary.json`, `events.jsonl`, or stack traces,
- a description of potential impact.

Please do not publish proof-of-concept exploits, screenshots, or reproduction repositories in public before coordinated disclosure is agreed.

## Response Targets

The maintainers currently aim for the following response windows:

- initial acknowledgment within 2 business days,
- severity and scope triage within 7 calendar days,
- status updates at least every 14 days while a fix is in progress.

These are targets, not legal guarantees, but reports should not remain unanswered without notice.

## Coordinated Disclosure

When a report is accepted as a security issue, the project follows coordinated disclosure:

1. The maintainers confirm the issue privately.
2. A fix or mitigation is prepared.
3. Supported releases are updated.
4. A public disclosure or advisory is published after the fix is available.

Researchers may be credited in release notes or the advisory if they request attribution.

## In-Scope Examples

The following are generally treated as security issues when they are reproducible and impact real consumers:

- unauthorized access to encrypted or protected data,
- incorrect key handling or secret exposure,
- integrity failures that allow silent data tampering,
- storage path or temporary-file exposure that leaks sensitive content,
- packaging or install-contract issues that cause the wrong runtime security behavior to be shipped.

## Out-of-Scope Examples

The following usually belong in the normal bug tracker unless they also create a concrete exploit path:

- performance regressions without a security impact,
- unsupported runtime configurations,
- missing optional native dependencies in an unsupported install flow,
- documentation wording issues without a security consequence.

## Consumer Guidance

Consumers should keep the following constraints in mind:

- Expo Go supports encrypted storage validation, but it does not guarantee per-access authentication.
- `requireAuthOnAccess: true` intentionally throws `AUTH_ON_ACCESS_UNSUPPORTED` when the current runtime cannot enforce that guarantee.
- Native-performance and native-crypto validation should be performed in a native dev client or standalone build.
