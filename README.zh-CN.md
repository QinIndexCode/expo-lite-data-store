# expo-lite-data-store

面向 Expo 应用的本地结构化存储库，已针对 Expo SDK 54 下的 Expo Go 与 managed app 运行时做过实际验证。

[English](./README.md) | [English Alias](./README.en.md) | [API 参考](./docs/API.zh-CN.md) | [运行时 QA 指南](./docs/EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./docs/CHANGELOG.zh-CN.md)

## 支持矩阵

| 运行面 | 状态 |
| --- | --- |
| Expo SDK | `54.x` |
| React | `19.1.x` |
| React Native | `0.81.x` |
| Managed App | 支持 |
| Expo Go | 支持本文档定义的运行契约 |
| Native Dev Client / 独立应用 | 支持，且推荐用于原生性能验证 |

## 安装

本库不支持把 `npm install expo-lite-data-store` 当作唯一安装步骤。

对 Expo SDK 54 而言，唯一受支持的基础安装命令是：

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

即使包管理器成功完成安装，也应将“只执行 `npm install expo-lite-data-store`”视为不完整安装。

`react-native-quick-crypto` 为可选 peer 依赖。只有在开发构建或独立应用中需要启用原生旗舰加密提供者时，才需要安装它。

发布包只包含编译后的运行时代码和类型声明。Expo 运行时模块保持为 peer 依赖，以便消费应用自行管理原生依赖树。

### 安装契约

| 契约 | 状态 | 说明 |
| --- | --- | --- |
| `npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store` | 正式支持 | Expo SDK 54 下的 managed-compatible 安装契约 |
| 在上一条基础上额外安装 `react-native-quick-crypto` | 正式支持 | 用于 native dev client 或独立应用中的原生旗舰加密验证 |
| 仅执行 `npm install expo-lite-data-store` | 不支持 | 可能导致 Expo peer 依赖缺失或版本未对齐 |

包元数据刻意将 Expo 运行时模块保留为 `peerDependencies`。这对 Expo 库来说是正确做法，但也意味着正式支持的安装方式是上面的 `expo install`，而不是只用包管理器安装本库本身。

### 运行时缺包提示

如果宿主 Expo 应用缺少必需运行时包，库会抛出 `StorageError`，错误码为 `EXPO_MODULE_MISSING`。

错误详情会指出当前缺失的模块，错误建议会回到唯一受支持的安装命令：

```bash
npx expo install expo-lite-data-store expo-file-system expo-constants expo-crypto expo-secure-store
```

这类错误应被视为消费应用安装契约失败，而不是可忽略的运行时警告。

## 最小示例

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

`db.init()` 是可选且幂等的。所有公开 API 在第一次真实调用时都会走同一套延迟初始化路径。

## 运行契约

### 延迟初始化

- 引入包本身不应立即触发存储访问或强依赖 Expo 原生模块。
- 存储适配器、性能监控器和相关辅助服务会在 `db.init()` 或第一次真实存储操作时再初始化。

### 存储目录

- 默认根目录：`lite-data-store`
- 可通过 `configManager.updateConfig({ storageFolder: 'custom-folder' })` 覆盖存储目录
- 当默认目录不存在而旧目录 `expo-lite-data` 存在时，会自动执行兼容迁移

示例：

```ts
import { configManager } from 'expo-lite-data-store';

configManager.updateConfig({
  storageFolder: 'my-app-store',
});
```

### 既有数据兼容性

历史 beta 版本已经写入设备的数据仍然可读，包括元数据文件、表文件、chunked 表，以及旧版本产生的加密负载格式。

## 安全边界

- 常规加密存储在 Expo Go 中可用。
- `requireAuthOnAccess: true` 采用严格语义；当当前运行时无法真正实现“每次访问都认证”时，会直接抛出 `AUTH_ON_ACCESS_UNSUPPORTED`。
- 因此，Expo Go 适合验证普通加密存储，但不适合验证生物识别或逐次访问认证保证。
- 依赖 `react-native-quick-crypto` 的原生性能验证应在 native dev client 或独立应用中完成，而不是在 Expo Go 中完成。

## 发布验证

仓库提供了明确的发布基线 QA 命令：

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

如需连续执行两条基线：

```bash
npm run qa:baseline:release
```

这些命令会在 `artifacts/expo-runtime-qa/` 下生成工件目录。发布判断应以生成的 `summary.json` 为准，而不是瞬时截图或手动复制的界面结果。

## 文档入口

- API 参考： [docs/API.zh-CN.md](./docs/API.zh-CN.md)
- 英文 API 参考： [docs/API.md](./docs/API.md)
- 运行时 QA 流程、lane 定义、verdict 语义与工件结构： [docs/EXPO_RUNTIME_QA.zh-CN.md](./docs/EXPO_RUNTIME_QA.zh-CN.md)
- 变更日志： [docs/CHANGELOG.zh-CN.md](./docs/CHANGELOG.zh-CN.md)
- 英文变更日志： [docs/CHANGELOG.md](./docs/CHANGELOG.md)
- 架构说明： [docs/ARCHITECTURE.zh-CN.md](./docs/ARCHITECTURE.zh-CN.md)
- 贡献指南： [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)
- 安全策略： [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)
- 英文开发者文档： [README.md](./README.md)

## 许可证

[MIT](./LICENSE.txt)
