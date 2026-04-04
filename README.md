# expo-lite-data-store 🍃

> A lightweight, secure local data store for Expo/React Native applications.

[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.73+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

---

## Quick Start

```bash
npm install expo-lite-data-store
```

```typescript
import { db } from 'expo-lite-data-store';

await db.init();
await db.createTable('users', { columns: { name: 'string', email: 'string' } });
await db.insert('users', { name: 'Alice', email: 'alice@example.com' });
const users = await db.findMany('users', { name: 'Alice' });
```

## Core Features

| Feature | Description |
|---------|-------------|
| 🚀 **Zero Configuration** | Works out of the box with Expo Go |
| 🔒 **AES-256-GCM Encryption** | NIST SP 800-38D compliant, PBKDF2 + HKDF two-tier key derivation |
| 📦 **Intelligent Chunking** | Automatically handles >5MB files |
| 🔄 **Transaction Support** | ACID-compliant transactions with rollback |
| 📝 **TypeScript Native** | Complete type definitions |
| 🔍 **Advanced Queries** | $eq, $ne, $gt, $lt, $in, $like, $and, $or operators |
| 📱 **Fully Offline** | 100% local data storage |
| 🎯 **Smart Sorting** | 5 algorithms, auto-selected based on data size |
| ⏰ **Auto Sync** | Periodic dirty data synchronization |
| 📊 **Performance Monitoring** | Built-in metrics and health checks |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System architecture and module design
- [API Reference](docs/API.md) - Complete API documentation
- [Changelog](docs/CHANGELOG.md) - Version history
- [Comment Specification](docs/COMMENT_SPECIFICATION.md) - Code comment standards
- [中文文档](README.zh-CN.md) | [English Detailed Doc](README.en.md)

## Security

- AES-256-GCM encryption (NIST SP 800-38D compliant)
- PBKDF2 key derivation with 600,000 iterations (OWASP 2026)
- HKDF for fast per-record key derivation (~3μs vs ~2s)
- Field-level and table-level encryption
- Biometric authentication support (optional)

## Performance

| Operation | Time |
|-----------|------|
| Cache hit read | <1ms |
| Uncached read (1K records) | 5-20ms |
| Single write | 10-50ms |
| Batch write (100 items) | 50-200ms |
| GCM encryption (first) | ~2s |
| GCM encryption (subsequent) | ~3μs |

## Expo Go Compatibility

✅ Fully compatible with Expo Go
✅ Pure JavaScript fallback for crypto operations
✅ No native dependencies required

## Architecture

```
Public API Layer (expo-lite-data-store.ts)
    ↓
Instance Management (core/db.ts)
    ↓
Adapter Layer (FileSystemStorageAdapter / EncryptedStorageAdapter)
    ↓
Service Layer (core/service/)
    ↓
Core Components (cache, index, meta, query, data, file)
    ↓
File System Layer (expo-file-system)
```

## License

[MIT](LICENSE.txt) © QinIndexCode

---

## Contributors

Thanks to all contributors!

<a href="https://github.com/QinIndexCode/expo-lite-data-store/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=QinIndexCode/expo-lite-data-store&s=200&columns=12" />
</a>

Welcome more developers to join and improve the project! 🚀

If you like it, don't forget to give it a ⭐ Star!
