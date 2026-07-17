# CI/CD 运维手册

[README 入口](../README.md) | [English](./CI_CD.en.md) | [运行时 QA](./EXPO_RUNTIME_QA.zh-CN.md) | [变更日志](./CHANGELOG.zh-CN.md)

本文面向需要验证改动、排查 GitHub Actions 或发布 npm 包的维护者。Workflow YAML 与 `package.json` scripts 是可执行事实源；本文负责说明如何安全地操作这些流程。

## Workflow 地图

| Workflow                                             | 触发条件                                              | 用途                                                            | Secret               |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| `CI`（`.github/workflows/ci.yml`）                   | push 到 `main`、面向 `main` 的 Pull Request、手动触发 | 安装、类型检查、测试、构建、Expo consumer 验证和 npm 包内容检查 | 无                   |
| `Release package`（`.github/workflows/release.yml`） | push `vX.Y.Z` 或预发布 tag                            | 重跑完整发布门禁并携带 provenance 发布对应 npm 版本             | `NPM_TOKEN`          |
| CodeQL / OpenSSF Scorecard                           | push 与定时任务                                       | 安全分析和仓库安全姿态检查                                      | 适用时由 GitHub 管理 |

Pull Request 不会获得 npm 发布凭据，也不能触发包发布。

## 推送前本地门禁

普通改动至少执行：

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build:all
npm test -- --runInBand --coverage=false
```

涉及打包、存储运行时、Expo 兼容性、依赖或发布流程时，执行完整门禁：

```bash
npm run prepublishOnly
npm pack --dry-run --ignore-scripts
```

`prepublishOnly` 包含依赖审计、类型检查、干净的可分发构建、全部维护中的测试分组、lint 和临时 Expo consumer smoke。构建有意安排在测试前，因为 package export 与 built artifact 契约会检查 `dist/`。超出 consumer smoke 的真机运行证据请参考 [EXPO_RUNTIME_QA.zh-CN.md](./EXPO_RUNTIME_QA.zh-CN.md)。

## 仓库一次性配置

发布 workflow 要求存在名为 `NPM_TOKEN` 的 GitHub Actions repository secret。应使用具备发布权限、同时尽可能缩小 npm 账户和包作用域的 token。不要把 token 写进 workflow YAML、仓库文件、命令输出或 Issue 评论。

通过已认证的 GitHub CLI 交互式设置：

```bash
gh secret set NPM_TOKEN
gh secret list --app actions
```

第二条命令应能列出 `NPM_TOKEN`，但不会显示它的值。npm 凭据变更或撤销后需要同步轮换该 Secret。

## main 分支 CI 操作流程

1. 把审查后的提交推送到 `main`，或合并 Pull Request。
2. 查找对应 run：

   ```bash
   gh run list --workflow CI --limit 5
   ```

3. 等待明确的终态：

   ```bash
   gh run watch RUN_ID --exit-status
   ```

4. 若失败，先只读取失败日志：

   ```bash
   gh run view RUN_ID --log-failed
   ```

对应提交的 `main` CI 没有变绿前，不要创建发布 tag。

## npm 发布流程

1. 将 `package.json` 更新为目标版本，并同步更新中英文 changelog。
2. 在本地执行完整发布门禁并检查 dry-run 包内容。
3. 提交发布准备改动并推送到 `main`。
4. 等待该提交对应的 `CI` 通过。
5. 读取版本：

   ```bash
   node -p "require('./package.json').version"
   ```

6. 创建并推送与该版本完全一致的 annotated tag。以下 POSIX shell 示例从 `package.json` 读取版本，避免手工填写过期 tag：

   ```bash
   VERSION="$(node -p "require('./package.json').version")"
   git tag -a "v${VERSION}" -m "Release v${VERSION}"
   git push origin "v${VERSION}"
   ```

   在 PowerShell 中可使用等价写法：

   ```powershell
   $version = node -p "require('./package.json').version"
   git tag -a "v$version" -m "Release v$version"
   git push origin "v$version"
   ```

7. 观察 `Release package`，成功后核对 registry：

   ```bash
   gh run list --workflow "Release package" --limit 5
   npm view expo-lite-data-store version
   ```

以下情况会被发布 workflow 明确拒绝：

- tag 不等于 `v` 加 `package.json` 版本；
- tag 指向的提交不属于 `origin/main`；
- 缺少 `NPM_TOKEN`；
- 发布门禁、包内容检查或 npm publish 失败。

Workflow 不会自动修改版本、创建提交、创建 tag 或创建 GitHub Release。

## 故障排查

| 现象                     | 检查项                                                               | 安全处理方式                                                   |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| push 后没有 `CI` run     | 确认提交已到达 `main`，且远端默认分支存在 `.github/workflows/ci.yml` | 推送正确提交，或检查仓库 Actions policy                        |
| Release 没有启动         | 确认 tag 已推送且匹配 `vX.Y.Z` 或 `vX.Y.Z-prerelease`                | 仅在 main CI 通过后推送正确 tag                                |
| tag/version 校验失败     | 对比 `GITHUB_REF_NAME` 和 `package.json`                             | 准备新的正确版本/tag，不发布不匹配源码                         |
| main 归属校验失败        | 确认 tag 提交属于 `origin/main`                                      | 先把发布提交合入或推到 `main`，再准备正确且不可变的 tag        |
| 认证检查失败             | 运行 `gh secret list --app actions`，确认存在 `NPM_TOKEN`            | 设置或轮换 Secret，禁止打印 token                              |
| npm 报告版本已存在       | 运行 `npm view expo-lite-data-store versions --json`                 | 提升版本并创建新 tag；npm 版本不可覆盖                         |
| Expo consumer smoke 失败 | 阅读 run 中失败的安装、`expo-doctor` 或 Metro 阶段                   | 先用 `npm run smoke:expo-consumer` 本地复现，不要先改 workflow |

如果修复的是外部凭据或临时 runner 故障，可以只重跑失败 job：

```bash
gh run rerun RUN_ID --failed
```

已发布 npm 版本和发布 tag 都应视为不可变发布记录。不要移动或复用已经发布的 tag；应提升版本向前修复。

## 安全与维护规则

- 第三方 Actions 固定到审查过的 commit SHA。
- 默认权限保持只读，只在发布 job 中授予 `id-token: write`。
- 不要在会执行仓库代码的 workflow 中引入 `pull_request_target`。
- 不要为了让发布变绿而绕过 `prepublishOnly`。
- 发布行为变化时，同步维护本文中英文版本、两个 workflow、`package.json` scripts 和中英文 changelog。
