# 变更日志

本文件记录本项目所有值得说明的重要变更。

[English](./CHANGELOG.md) | [消费者文档](../README.zh-CN.md) | [API 参考](./API.zh-CN.md)

## [2.0.0-beta.5] - 2026-04-04

### 新增
- AES-256-GCM 加密模式，符合 NIST SP 800-38D 与 OWASP MASVS 2026
- PBKDF2 + HKDF 两级密钥派生，默认 600,000 次迭代，初次派生约 2 秒，后续单条记录约 3μs
- 自动识别加密版本，新数据默认使用 GCM，旧数据继续兼容 CTR+HMAC
- 用于 GCM 批量加密的 `crypto-gcm.ts` 模块
- 用于共享错误定义的 `crypto-errors.ts`
- 用于加密类型定义的 `crypto-types.ts`
- 用于独立路径管理的 `PathHelper.ts`，解决循环依赖
- 用于集中环境检测的 `envUtils.ts`
- `.prettierignore` 文件
- `TransactionService` 测试，23 个测试用例
- `SingleFileHandler` 测试，13 个测试用例
- `withTimeout` 测试，10 个测试用例
- 加密性能基准测试
- `docs/ARCHITECTURE.md` 统一架构文档
- `docs/API.md` 完整 API 参考
- `docs/CHANGELOG.md` 统一变更日志
- `docs/COMMENT_SPECIFICATION.md` 统一注释规范

### 变更
- PBKDF2 默认迭代次数从 120,000 提升到 600,000，遵循 OWASP 2026 建议
- `encryption.algorithm` 现支持 `'AES-CTR' | 'AES-GCM' | 'auto'`，默认值为 `'auto'`
- 通过 `PathHelper` 解决 `ConfigManager` 与 `ROOTPath` 的循环依赖
- 将重复的 `ErrorHandler` 类整合为 `StorageErrorHandler` 与 `ApiErrorHandler`
- `StorageAdapterFactory` 现支持创建 `EncryptedStorageAdapter`
- 新建 `tsconfig.base.json` 统一所有 TypeScript 配置
- 修复跨平台构建脚本，将 Windows `del` 替换为 `rimraf`
- 将 `CryptoService` 移动到 `core/crypto/` 目录
- 将 `react-native-quick-crypto` 改为可选 `peerDependency`
- 将 761+ 条内联注释统一为英文
- 将 59 个文件头统一为 JSDoc `@module` 格式
- 通过预编译正则优化 `$like` 查询
- 通过递归 key 排序优化缓存 key 生成
- 通过最小堆优化缓存过期清理，复杂度从 O(n) 降为 O(k log n)
- 通过 JSON 近似法优化缓存大小计算，提速 10 到 100 倍
- 通过批处理优化索引重建，提速 3 到 5 倍
- 使用 `Set` 优化 `QueryEngine` 的 `$or` 去重
- 用新的简化结构更新 `README.md`
- 合并并清理中英文文档
- 清理 `.gitignore`、`.npmignore`、`.prettierignore`，统一忽略策略
- 修复 `package.json` 中重复的 `peerDependencies`
- 将 `eslint.config.mjs` 注释统一为英文
- 删除 7 个死代码模块：`CacheCoordinator`、`RestController`、`FileService`、`CacheController`、`KeyManager`、`envUtils`、`taskQueueExample`
- 将 `StorageError`、`StorageErrorCode`、`LiteStoreConfig`、`CryptoError`、`DeepPartial` 加入公共 API 导出
- 将 `sortAlgorithm` 的类型从 `any` 收紧为联合类型

### 修复
- 修复 3 个文件中导入扩展名不一致的问题，统一 `.js` 与 `.ts`
- 修复跨平台构建脚本中的 Windows `del` 命令依赖
- 修复 `ConfigManager` 与 `ROOTPath` 的循环依赖
- 修复 Expo Go 下的 `SecureStore` 回退链，形成三层回退：biometric -> non-biometric -> in-memory
- 将性能基准测试中的 `Buffer` 使用替换为 `atob`
- 修复 `config_loading.test.ts` 中的单例重置问题
- 修复 `expo-file-system` mock 中的递归删除与目录移动操作
- 修复 `hkdfDerive` 函数的测试 mock

### 性能
- `$like` 查询：通过预编译正则提速 20% 到 50%
- 缓存过期清理：通过最小堆提速 5 到 10 倍
- 缓存大小计算：通过 JSON 近似法提速 10 到 100 倍
- 索引重建：通过批处理提速 3 到 5 倍
- GCM 加密：首次 PBKDF2 派生后，每条记录约 3μs
- 总体加密操作：提升约 30% 到 50%

## [2.0.0-beta.4] - 2026-01-28

### 变更
- 在 Expo Go 环境下降低 PBKDF2 迭代次数
- 为原生 KDF 加速新增 `react-native-quick-crypto`
- 缓存原生模块加载，避免重复 `require`
- 从原生 PBKDF2 路径中移除 `Buffer` 依赖
- 统一处理 `ExpoCrypto.getRandomBytes` 返回类型
- 哈希输入统一使用 `TextEncoder` 编码

### 新增
- 针对 Expo Go 下迭代次数降低行为的测试

## [2.0.0-beta.3] - 2026-01-22

### 变更
- 从 `crypto-es` 迁移到 `@noble/ciphers` 与 `@noble/hashes`
- 简化包管理结构，统一为单个 `package.json`
- 实现 AES-256-CTR + HMAC-SHA512 加密
- 通过动态迭代调整优化 PBKDF2 密钥派生
- 新增加密 key 的 LRU 智能缓存清理策略

## [2.0.0-beta.2] - 2025-12-24

### 修复
- 修复 `ConfigManager.ts` 中的原型污染漏洞
- 新增 key 名校验，防止恶意键值修改

### 新增
- 符合 GitHub 标准的 `SECURITY.md`
- 更新中英文架构文档

## [2.0.0-beta.1] - 2025-12-18

### 变更
- 增强字段级加密逻辑
- 删除 `enableFieldLevelEncryption` 配置项，改为基于 `encryptedFields` 自动判断
- 优化加密 key 管理与缓存
- 为 ES Module 支持新增 `"type": "module"`
- 更新 API 版本管理，默认值为 `2.0.0`
- 提升生物识别认证测试覆盖
- 修复 JEST 配置中的 ES Module 兼容性

## [1.1.0] - 2025-12-16

### 变更
- 删除 npm install 时的配置生成脚本
- 修复 Expo 项目中的配置文件使用方式
- 移除配置 API，改为直接编辑配置文件
- 优化生物识别与密码认证触发逻辑
- 统一文档语言

### 修复
- 修复 `CacheManager` 对已删除的 `cache.enableCompression` 属性的处理
- 移除对已删除 `requireAuthOnAccess` 属性的引用
- 修复首次启动时 `delete from table app_settings failed` 错误

## [1.0.5] - 2025-12-12

### 修复
- 修复更新与删除操作中的缓存问题
- 修复缺失的接口方法

## [1.0.0] - 2025-12-08

### 变更
- 实现安全的 npm 发布工作流
- 重构 npm 发布流程
- 更新文档与代码
- 新增 yarn 与 pnpm 安装说明
- 澄清安装文档

## [1.0.0] - 2025-12-07

### 变更
- 提升 `README.md` 质量
- 增强功能说明
- 移除提交中的测试覆盖目录
- 修复 API 实现错误与性能问题

## [1.0.0] - 2025-12-06

### 新增
- Wiki 文档
- 提升架构与系统稳定性

### 修复
- 修复主入口未正确调用部分功能的问题

## [1.0.0] - 2025-12-03

### 变更
- 优化加密字段处理，保证读写过程中的正确加解密

## [0.1.0] - 2025-11-29

### 新增
- 更新测试文件与配置
- 新增 `src/index.ts` 的默认导出
- 新增英文 README 链接

### 变更
- 将 `chunkSize` 调整为 5MB
- 更新 `README.md` 中的 MIT 许可证链接

## [0.1.0] - 2025-11-28

### 变更
- 重构核心架构，形成完整存储引擎
- 更新文档与加密存储适配器
- 新增 API 测试
- 删除未使用文件

## [0.1.0] - 2025-11-27

### 变更
- 为提升性能与稳定性进行代码修改

## [0.1.0] - 2025-11-26

### 新增
- 缓存适配器接口
- 存储错误码接口
- 数据排序工具
- 数据与缓存合并工具

### 变更
- 修复加密装饰器、文件系统适配器与分块文件处理器
- 将 `ldb.config.js` 重命名为 `liteStore.config.js`

## [0.1.0] - 2025-11-25

### 新增
- 文件系统适配器
- 分块文件处理器
- 单文件处理器
- 索引管理器
- 元数据管理器
- 查询引擎
- 加密存储适配器，基于 AES-CTR 模式

## [0.0.1] - 2025-11-23

### 新增
- 文件系统存储适配器
- 核心存储
- 分块文件处理器
- 单文件处理器
- 索引管理器
- 元数据管理器
