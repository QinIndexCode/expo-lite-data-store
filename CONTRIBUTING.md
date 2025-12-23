# 贡献指南

感谢你对 expo-lite-data-store 的兴趣和贡献！本项目为 React Native + Expo 提供轻量、纯 TypeScript 的本地数据存储方案。为了保持代码质量与协作效率，请在贡献前阅读本指南。

## 目录
- 我可以贡献什么？
- 贡献前准备
- 报告 bug / 提建议
- 分支与提交规范
- 本地开发与运行
- 测试、校验与持续集成
- 提交 Pull Request（PR）
- 代码审查要点
- 文档、示例与国际化
- 行为守则
- 版权与许可证

---

## 我可以贡献什么？
- 修复 bug
- 完善或新增测试
- 优化性能或 API 设计
- 增加/改进文档或示例
- 增加新功能（与维护者沟通后）
- 改进代码风格、类型定义或构建配置

---

## 贡献前准备
1. Fork 本仓库并克隆到本地。
2. 安装依赖（仓库使用的包管理器可能是 npm / yarn / pnpm）：
   - npm: npm install
   - yarn: yarn
   - pnpm: pnpm install
3. 建立本地分支，分支命名建议：
   - fix/短描述（修复）
   - feat/短描述（新功能）
   - docs/短描述（文档）
   - chore/短描述（构建/维护）
   例如： git checkout -b feat/transaction-batch

如果仓库包含示例 app（用于手动验证），可以按照 README 启动示例。

---

## 报告 bug / 提建议
请在创建 Issue 前搜索已有 Issue，避免重复提交。

当提交 Bug 报告，请提供：
- 复现步骤（最小可复现示例）
- 期望行为与实际行为
- 所用版本（库版本、Expo 版本、React Native 版本）
- 日志或错误堆栈（如有）
- 如为平台相关问题，请说明平台（iOS/Android/Expo/模拟器）

建议/新功能请求请说明用例、设计思路与向后兼容性考虑。

---

## 分支与提交规范
- 基于 main（或默认主分支）开新分支开发。
- 合并时使用 Pull Request，并请求至少一位维护者审查。
- 使用语义化提交／Conventional Commits（推荐）：
  - feat: 新功能
  - fix: 修复 bug
  - docs: 文档变更
  - style: 格式（不影响逻辑）
  - refactor: 重构（不改变行为）
  - test: 测试相关
  - chore: 杂项（构建、工具等）

提交示例：
- feat(index): add index-based query API
- fix(transaction): ensure rollback on error

若仓库启用 commitlint/husky，请遵守其规则。

---

## 本地开发与运行（常用命令示例）
（以下命令根据项目实际 package.json 脚本调整）
- 安装依赖： npm install
- 运行示例： npm run example
- 构建库： npm run build
- 运行测试： npm test
- 运行 lint： npm run lint
- 格式化： npm run format

如果你不确定具体命令，请查看 package.json 的 scripts，并在 PR 描述中明确说明你运行的命令。

---

## 测试、校验与持续集成
- 新增功能或修复必须包含相应的测试（单元测试/集成测试）。
- 运行全部测试，确保本地 CI（如 GitHub Actions）通过。
- 保持类型检查无错误（tsc --noEmit）。
- 修复或新增代码请同时通过 lint 和格式化工具（ESLint / Prettier）。

---

## 提交 Pull Request（PR）流程
1. 从主分支创建功能分支。
2. 进行开发并在本地运行测试与 lint。
3. 提交清晰的 commit（参考提交规范）。
4. 创建 PR，填写下列信息：
   - 变更的简要描述（何改变、为何改变）
   - 复现步骤或示例代码（若适用）
   - 是否影响破坏性更改（breaking change）
   - 关联 Issue（若有）
5. 在 PR 页面请求审阅者并等待 CI 通过与审查意见。

PR 模板（示例检查项）：
- [ ] 我已阅读贡献指南并在新分支上开发
- [ ] 变更包含测试（如适用）
- [ ] 本地已运行并通过全部测试
- [ ] 已更新或添加必要文档
- [ ] commit 信息遵循 Conventional Commits

---

## 代码审查要点（审查者参考）
- 是否存在类型错误或 any 滥用
- API 是否清晰且向后兼容
- 边界条件与错误处理是否完善（事务、回滚、并发）
- 性能考虑（索引、查询优化）
- 测试覆盖率是否足够
- 文档与示例是否更新

---

## 文档与示例
- 所有公开 API 变更必须更新 README 和示例代码。
- 如果新增功能，需要在文档中给出最小使用示例（代码片段）和迁移说明（若破坏性变更）。
- 国际化：README 以中文为主，重要文档建议提供英文摘要或 en/ 目录。

---

## 行为守则
本项目遵循社区友好、尊重与包容的行为守则。参与时请保持尊重，避免人身攻击。对于违反行为守则的行为，维护者有权关闭 Issue/PR 并采取相应措施。

建议同时添加一个简短的 CODE_OF_CONDUCT.md（如 Contributor Covenant）。

---

## 版权与许可证
本项目遵循仓库根目录的 LICENSE。贡献即表示你同意以当前 LICENSE 授权方式贡献代码（或在 PR 中明确说明来源/授权）。

---

## 需要我帮忙吗？
我可以：
- 将本 CONTRIBUTING.md 添加到仓库（请告知目标分支）。
- 生成 Issue/PR 模板、CODE_OF_CONDUCT.md 或 PR 模板文件。
- 基于仓库 package.json 自动填充脚本命令（需要我读取仓库内容）。

要我把 CONTRIBUTING.md 直接添加到仓库吗？如果要，请确认目标分支（默认 main）并告知是否同时创建 CODE_OF_CONDUCT.md / PR 模板等。
