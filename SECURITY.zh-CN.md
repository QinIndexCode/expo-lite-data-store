# 安全策略

`expo-lite-data-store` 是一个面向 Expo 应用的本地存储库。安全问题应通过私下渠道报告，在维护者确认披露时间之前，不应先公开发布 GitHub Issue。

[English](./SECURITY.md) | [README](./README.zh-CN.md) | [贡献指南](./CONTRIBUTING.zh-CN.md)

## 支持版本

只有当前稳定主线会接收安全修复。

| 版本 | 是否支持 |
| --- | --- |
| `2.0.x` | 是 |
| `< 2.0.0` | 否 |

## 漏洞报告方式

请通过邮件发送到 [qinindexcode@gmail.com](mailto:qinindexcode@gmail.com)。

建议邮件主题格式：

```text
[expo-lite-data-store][security] 简短摘要
```

请尽量提供以下信息：

- 受影响的包版本，
- Expo SDK、React Native 和平台信息，
- 当前运行面，例如 Expo Go、managed app、native dev client 或 standalone build，
- 当前使用的加密 provider，例如 `expo-go-js-fallback` 或 `react-native-quick-crypto`，
- 复现步骤或最小复现仓库，
- 相关日志、`summary.json`、`events.jsonl` 或堆栈信息，
- 漏洞可能造成的影响说明。

在协调披露达成之前，请不要公开发布 PoC、截图或复现仓库。

## 响应目标

维护者当前的目标响应窗口如下：

- 2 个工作日内确认收到报告，
- 7 个自然日内完成严重级别和影响范围初判，
- 在修复进行期间至少每 14 天提供一次状态更新。

这些是维护目标，不构成法律承诺，但项目不应在无说明的情况下长期不回应安全报告。

## 协调披露

当报告被确认属于安全问题时，项目遵循协调披露流程：

1. 维护者私下确认问题。
2. 准备修复或缓解方案。
3. 更新受支持版本。
4. 在修复可用后发布公开披露或安全公告。

如果研究者希望署名，可以在 release note 或安全公告中注明贡献。

## 典型纳入范围

以下问题在可复现且影响真实 consumer 时，一般会被视为安全问题：

- 未授权访问加密或受保护数据，
- 密钥处理错误或秘密泄露，
- 允许静默篡改数据的完整性缺陷，
- 导致敏感内容泄漏的存储路径或临时文件暴露，
- 使错误运行时安全行为进入发布包的打包或安装契约问题。

## 典型不纳入范围

以下问题通常应走普通缺陷流程，除非它们同时构成明确的可利用路径：

- 不带来安全影响的性能回退，
- 不受支持的运行时配置，
- 在不受支持的安装流程中缺失可选原生依赖，
- 不涉及安全后果的文档措辞问题。

## 面向使用者的安全提示

使用者需要注意以下约束：

- Expo Go 可用于验证加密存储，但不能保证每次访问都进行身份认证。
- 当当前运行时无法强制执行该保证时，`requireAuthOnAccess: true` 会主动抛出 `AUTH_ON_ACCESS_UNSUPPORTED`。
- 原生性能和原生加密能力的验证应在 native dev client 或 standalone build 中完成。
