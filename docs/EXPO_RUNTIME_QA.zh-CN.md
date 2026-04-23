# Expo 运行时 QA 指南

本文档说明 `expo-lite-data-store` 当前维护的运行时 QA 基线，面向贡献者与发布维护者。目标是用工件和运行时证据证明：打包后的 npm 产物在 Expo Go 和原生旗舰配置下确实按契约工作。

[English](./EXPO_RUNTIME_QA.md) | [消费者文档](../README.zh-CN.md) | [API 参考](./API.zh-CN.md) | [变更日志](./CHANGELOG.zh-CN.md)

## 适用范围

QA harness 会在 Android 上创建临时 Expo consumer 应用，并在其中验证打包后的 npm tarball。它主要回答三个发布问题：

1. 发布包是否能按文档中的消费契约正确安装？
2. managed Expo Go 运行时在首次启动、重载和强杀恢复之后是否仍然正确？
3. 原生旗舰 profile 是否在真实 native client 中验证了 `react-native-quick-crypto`？

正式支持的消费契约以 [README.zh-CN.md](../README.zh-CN.md) 中的 `expo install` 命令为准。仅安装 `expo-lite-data-store` 本身，不构成发布就绪证据，因为 Expo peer 依赖可能缺失或版本不匹配。

## QA Lane 定义

### Channel

- `single-package`
  只安装 `expo-lite-data-store`，用于验证零配置下限。
- `managed-compatible`
  安装 `expo-lite-data-store` 与 README 中要求的 Expo peer 依赖，用于验证正式安装契约。

### Profile

- `expo-go-js`
  在 Expo Go 中运行，使用 JavaScript fallback 加密提供者。
- `native-quick-crypto`
  在原生 dev client 中运行，使用 `react-native-quick-crypto`。

### Mode

- `probe`
  验证应用可启动、运行契约可读取、QA runner 已正确接线。
- `runtime`
  运行 functional、edge、security、large-file、concurrency、business 分组。
- `recovery`
  验证 managed-compatible 应用在强杀后重新启动的恢复能力。
- `soak`
  可选的长时间稳定性循环，期间会周期性重启应用。

## 标准命令

推荐的发布顺序：

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

如需顺序执行两条基线：

```bash
npm run qa:baseline:release
```

其他常用入口：

```bash
npm run qa:expo-go:contract
npm run qa:expo-go:mumu
npm run qa:expo-go:mumu:full
npm run qa:flagship:native
```

如需针对单一组合做定向复测，可直接调用脚本：

```bash
node ./scripts/expo-runtime-qa.cjs --layers=contract,runtime --channels=managed-compatible --profiles=expo-go-js --groups=functional,security
```

## 事件与 Summary 契约

设备端发出的每条 QA 事件都带有稳定的 lane 身份字段：

- `channel`
- `mode`
- `profile`
- `runId`
- `laneId`

harness 只接受与当前 phase 身份完全匹配的事件，因此旧 logcat、上一轮运行结果或无关的手动重跑都不会污染当前 phase 的 summary。

`summary.json` 采用 request-aware 语义：

- 未请求的 lane 记为 `not-requested`
- 已请求但缺少证据的 lane 记为 `blocked`
- 即使 `native_client_probe` 失败，只要同一轮中的 `runtime` 与 `recovery` 都验证了 `react-native-quick-crypto`，`nativeFlagshipVerdict` 仍可判定为通过

## 工件结构

每次运行都会在以下目录下生成一个时间戳工件包：

```text
artifacts/expo-runtime-qa/<timestamp>/
```

关键文件：

- `summary.json`
  当前请求范围的顶层 verdict
- `cases.jsonl`
  所有 lane 的平铺 case 记录
- `environment.json`
  主机、Android 设备、Expo CLI 与 QA 参数信息
- `<channel>/<profile>/dependency-tree.json`
  consumer 安装完成后的依赖快照
- `<channel>/<profile>/expo-doctor.log`
  合同层验证日志
- `<channel>/<profile>/expo-export.log`
  Android export 验证日志
- `<channel>/<profile>/<mode>/events.jsonl`
  仅包含当前 phase、当前 runId 的已接受事件
- `<channel>/<profile>/<mode>/logcat.txt`
  当前 phase 的完整 logcat 捕获
- `<channel>/<profile>/<mode>/screenshots/`
  启动、summary 与失败截图

发布判断应以 `summary.json` 为准，`cases.jsonl` 与各 phase 工件用于进一步定位。

## Verdict 解读

- `zeroConfigVerdict`
  对 `single-package` Expo Go lane 的发布信心。
- `expoGoRuntimeVerdict`
  对 managed-compatible Expo Go 正式安装契约的发布信心。
- `nativeFlagshipVerdict`
  对 managed-compatible 原生 dev client lane 的发布信心。
- `performanceAndStabilityVerdict`
  仅针对本次请求中的 managed-compatible runtime lane 汇总性能与恢复能力证据。

`performanceAndStabilityVerdict` 不会要求未请求 profile 的数据。例如，一次只验证 Expo Go 的运行不应因为没有执行 native flagship 而被误判为 `blocked`。

## 环境前提

### Android 目标设备

- 当前维护的主机环境为 Windows。
- MuMu 是当前 Android 基线环境，但任何能被 adb 识别的 Android 目标都可以使用。
- 使用 MuMu 时，应先确认 `adb devices -l` 已列出模拟器。常见序列号是 `127.0.0.1:7555`，但 harness 以 adb 实际识别到的 serial 为准。

### Expo Go

- 请使用与 Expo SDK 54 对齐的 Expo Go 版本。
- 运行前应确保设备已解锁，并允许前台拉起应用。

### 原生旗舰 profile

- 原生旗舰 lane 会构建或复用 Android dev client。
- 临时 consumer 应用必须能安装 `react-native-quick-crypto`。
- 发布判断依据是应用实际报告的运行时 provider，而不是仅看依赖是否安装成功。

## 已知限制与预期结果

- `requireAuthOnAccess: true` 在 Expo Go 中必须抛出 `AUTH_ON_ACCESS_UNSUPPORTED`；这是预期通过条件，不是失败。
- `single-package` 只验证零配置下限，不代表正式支持的安装契约，也不作为性能基线。
- 在 `single-package` lane 中，如果 `expo-doctor` 只报告 `expo-constants`、`expo-crypto`、`expo-file-system`、`expo-secure-store` 这四个 peer 缺失，而 export 与 Expo Go runtime 仍然通过，则该结果会被记为 warning，而不是阻塞失败。
- QA consumer 界面中的手动按钮适合排查问题，但发布证据仍应以 harness 落盘的 artifact 为准。
- 只有当同一轮中的 `runtime` 与 `recovery` 都成功验证已安装的 native client 时，native probe 失败才可以被忽略。

## 推荐发布检查清单

1. 运行 `npm run qa:baseline:expo-go`
2. 打开 `summary.json`，确认 `zeroConfigVerdict` 与 `expoGoRuntimeVerdict` 均为 `pass`
3. 运行 `npm run qa:baseline:native-flagship`
4. 打开 `summary.json`，确认 `nativeFlagshipVerdict` 与 `performanceAndStabilityVerdict` 均为 `pass`
5. 将本轮 artifact 目录纳入发布记录或发布检查单
