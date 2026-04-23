# 贡献指南

感谢为 `expo-lite-data-store` 做出贡献。本仓库维护的是一个经过真实运行时验证的 Expo 存储库，因此贡献质量不仅以“能编译”为准，还以打包后的 npm 产物在真实 Expo consumer 中是否按契约工作为准。

[English](./CONTRIBUTING.md) | [README](./README.zh-CN.md) | [安全策略](./SECURITY.zh-CN.md) | [运行时 QA 指南](./docs/EXPO_RUNTIME_QA.zh-CN.md)

## 贡献范围

欢迎以下方向的贡献：

- 缺陷修复
- 运行时兼容性加固
- 测试与 QA harness 改进
- 文档与示例完善
- 基于测量数据的性能优化
- 在不破坏既有公开契约前提下的新功能

涉及较大 API 变更或存储格式变更时，建议先通过 Issue 讨论方案。

## 环境要求

请在仓库根目录安装依赖后再开始开发：

```bash
npm install
```

在 Windows PowerShell 下运行脚本时，优先使用 `npm.cmd`。

## 开发流程

1. 基于 `main` 创建新分支。
2. 以小而聚焦的提交实现变更。
3. 代码、测试和文档同步更新。
4. 在本地运行与改动范围匹配的校验命令。
5. 提交 Pull Request，并附上清晰的变更说明、范围和验证证据。

建议的分支前缀：

- `fix/`
- `feat/`
- `docs/`
- `chore/`
- `refactor/`

推荐的提交信息风格：Conventional Commits。

示例：

- `fix(storage): guard legacy folder migration on empty roots`
- `docs(readme): clarify Expo peer dependency contract`

## 必跑校验

所有代码贡献至少应运行以下命令：

```bash
npm test -- --runInBand
npm run typecheck
```

如果改动影响打包、安装契约或 Expo 运行时行为，还应运行：

```bash
npm run smoke:expo-consumer
```

如果改动影响运行时适配器、QA harness、存储初始化或性能敏感路径，还应运行相应基线：

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

如果有命令被有意跳过，请在 Pull Request 中明确说明原因。

## 文档标准

本仓库采用以下文档规则：

- 英文规范文档使用 `.md`
- 简体中文对应文档使用 `.zh-CN.md`
- 只有在“作为英文别名页跳转到规范英文文档”时，才使用 `.en.md`

当公开行为、安装要求、QA 语义或发布策略发生变化时，需要：

- 更新英文规范文档
- 更新简体中文对应文档
- 保持两种语言中的命令、阈值和 verdict 语义一致

## Pull Request 检查清单

提交 Pull Request 前，请确认：

- [ ] 分支基于当前 `main`
- [ ] 改动包含必要测试
- [ ] `npm test -- --runInBand` 通过
- [ ] `npm run typecheck` 通过
- [ ] 涉及打包或运行时行为时，`npm run smoke:expo-consumer` 通过
- [ ] 需要更新的文档已同时覆盖英文和简体中文
- [ ] 没有把 `artifacts/` 产物或 `*.tgz` 之类的生成文件提交进来

## 代码审查重点

维护者会重点审查以下内容：

- Expo Go 与 managed consumer 下的运行时正确性
- 包导出稳定性与安装契约清晰度
- 已持久化数据的向后兼容性
- 错误处理、恢复能力与存储完整性
- 有证据支撑的性能声明
- 文档准确性

## 问题反馈

可复现的功能问题请使用 GitHub Issue 模板提交。涉及安全敏感内容的问题必须遵循 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md) 中的私下披露流程。

## 许可证

向本仓库提交代码即表示你同意按仓库根目录中的 [MIT 许可证](./LICENSE.txt) 对贡献内容进行授权。
