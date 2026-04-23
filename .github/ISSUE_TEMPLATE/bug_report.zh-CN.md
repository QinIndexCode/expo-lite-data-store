---
name: 缺陷报告
about: 报告库缺陷、安装契约失败或运行时回退
title: '[bug] '
labels: bug
assignees: ''
---

## 摘要

请清楚、简洁地描述问题。

## 复现步骤

请提供最小且稳定可复现的步骤：

1. 实际使用的安装命令
2. 应用类型，例如 Expo Go、managed app、native dev client 或 standalone build
3. 触发问题的具体步骤
4. 最终结果

## 预期行为

说明本应发生的行为。

## 实际行为

说明实际发生了什么，包括报错、红屏、崩溃或数据损坏现象。

## 环境信息

- `expo-lite-data-store` 版本：
- Expo SDK 版本：
- React Native 版本：
- 平台与设备或模拟器：
- 运行面：`Expo Go` / `managed app` / `native dev client` / `standalone build`
- 加密 provider：`expo-go-js-fallback` / `react-native-quick-crypto` / other

## 安装契约

- 实际使用的安装命令：
- 必需的 Expo peer dependencies 是否通过 `npx expo install` 安装？
- 是否安装了 `react-native-quick-crypto`？

## 日志与工件

请粘贴或附上相关证据：

- Metro 报错输出
- logcat 输出
- 堆栈信息
- `summary.json`
- `events.jsonl`
- 仅在文本日志不足时附截图

## 最小复现

如有可能，请提供最小复现仓库或代码片段。

## 其他上下文

补充任何有助于定位问题的信息。

## 提交前检查

- [ ] 我已在提交前搜索过现有 Issue
- [ ] 我提供了可复现步骤
- [ ] 我提供了版本和运行时信息
- [ ] 如可用，我已附上日志或 QA 工件
