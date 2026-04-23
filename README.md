# expo-lite-data-store

Local structured storage for Expo applications, with runtime-tested support for Expo Go and managed apps on Expo SDK 54.

[简体中文](./README.zh-CN.md) | [English Alias](./README.en.md) | [API Reference](./docs/API.md) | [Runtime QA Guide](./docs/EXPO_RUNTIME_QA.md) | [Changelog](./docs/CHANGELOG.md)

## Support Matrix

| Surface | Status |
| --- | --- |
| Expo SDK | `54.x` |
| React | `19.1.x` |
| React Native | `0.81.x` |
| Managed apps | Supported |
| Expo Go | Supported for the documented contract below |
| Native dev client / standalone app | Supported; recommended for native performance validation |

## Installation

This package does not support `npm install expo-lite-data-store` as a standalone installation step.

The only supported base install command for Expo SDK 54 is:

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

Treat `npm install expo-lite-data-store` on its own as an incomplete installation, even if the package manager finishes without error.

`react-native-quick-crypto` is an optional peer dependency. Install it only when the application is expected to run with the native flagship crypto provider in a development build or standalone app.

The published package ships compiled runtime bundles and type declarations. Expo runtime modules remain peer dependencies so the consumer application retains control over its native dependency tree.

### Installation Contract

| Contract | Status | Notes |
| --- | --- | --- |
| `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store` | Supported | Required managed-compatible contract for Expo SDK 54 |
| Previous command plus `react-native-quick-crypto` | Supported | Required for native flagship validation in a dev client or standalone build |
| `npm install expo-lite-data-store` only | Not supported | May leave Expo peer dependencies missing or version-misaligned |

The package metadata intentionally keeps Expo runtime modules in `peerDependencies`. This is the correct model for Expo libraries, but it also means the supported consumer workflow is the explicit `expo install` command above rather than a package-manager-only install.

### Missing Runtime Packages

If the host Expo application is missing a required runtime package, the library throws `StorageError` with code `EXPO_MODULE_MISSING`.

The error details identify the missing module, and the suggestion points back to the supported install command:

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

This error should be treated as an installation-contract failure in the consumer app, not as a recoverable runtime warning.

## Minimal Example

```ts
import { db } from 'expo-lite-data-store';

await db.init();

await db.createTable('users', {
  columns: {
    id: 'string',
    name: 'string',
    email: 'string',
  },
});

await db.insert('users', {
  id: '1',
  name: 'Alice',
  email: 'alice@example.com',
});

const user = await db.findOne('users', {
  where: { id: '1' },
});
```

`db.init()` is optional and idempotent. All public APIs follow the same lazy-initialization path on first real use.

## Runtime Contract

### Lazy initialization

- Importing the package must not require storage access or Expo native modules immediately.
- Storage adapters, runtime monitors, and auxiliary services initialize lazily through `db.init()` or the first storage operation.

### Storage folder

- Default root folder: `lite-data-store`
- Storage folder overrides are supported through `configManager.updateConfig({ storageFolder: 'custom-folder' })`
- Existing data under the legacy root `expo-lite-data` is migrated automatically when the default root does not already exist

Example:

```ts
import { configManager } from 'expo-lite-data-store';

configManager.updateConfig({
  storageFolder: 'my-app-store',
});
```

### Compatibility with existing on-device data

Existing beta artifacts remain readable, including metadata files, table files, chunked tables, and encrypted payload variants already produced by earlier beta builds.

## Security Boundary

- Regular encrypted storage works in Expo Go.
- `requireAuthOnAccess: true` is strict. When the current runtime cannot enforce per-access authentication, the library throws `AUTH_ON_ACCESS_UNSUPPORTED`.
- Expo Go is therefore suitable for encrypted storage validation, but not for validating biometric or per-access authentication guarantees.
- Native-performance validation with `react-native-quick-crypto` belongs in a native dev client or standalone app, not in Expo Go.

## Release Validation

The repository ships explicit QA baselines for release and prepublish validation:

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

To run both baselines in sequence:

```bash
npm run qa:baseline:release
```

These commands generate artifact bundles under `artifacts/expo-runtime-qa/`. The release source of truth is the generated `summary.json`, not a transient device screenshot or manual clipboard capture.

## Documentation

- Consumer and maintainer API reference: [docs/API.md](./docs/API.md)
- Simplified Chinese API reference: [docs/API.zh-CN.md](./docs/API.zh-CN.md)
- Runtime QA process, lanes, verdict semantics, and artifact layout: [docs/EXPO_RUNTIME_QA.md](./docs/EXPO_RUNTIME_QA.md)
- Changelog: [docs/CHANGELOG.md](./docs/CHANGELOG.md)
- Simplified Chinese changelog: [docs/CHANGELOG.zh-CN.md](./docs/CHANGELOG.zh-CN.md)
- Architecture notes: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Contributing guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security policy: [SECURITY.md](./SECURITY.md)
- Simplified Chinese guide: [README.zh-CN.md](./README.zh-CN.md)

## License

[MIT](./LICENSE.txt)
