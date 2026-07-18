# Expo Lite Data Store 架构设计

[README 入口](../README.md) | [English](./ARCHITECTURE.en.md) | [消费者指南](../README.zh-CN.md)

## 1. 系统概述

Expo Lite Data Store 是基于 Expo File System 的轻量本地数据库方案，支持单文件和分片存储模式，并提供 CRUD、进程内事务、缓存、索引、API 路由和数据加密能力。

## 2. 分层架构

| 层级       | 职责                   | 主要组件                                                                 |
| ---------- | ---------------------- | ------------------------------------------------------------------------ |
| 接口层     | 对外提供统一 API       | FileSystemStorageAdapter、EncryptedStorageAdapter、StorageAdapterFactory |
| 数据访问层 | 处理数据读写           | DataReader、DataWriter、QueryEngine                                      |
| 缓存层     | 提供缓存以提高查询性能 | CacheManager                                                             |
| 索引层     | 提供索引以加速查询     | IndexManager                                                             |
| 加密层     | 提供数据加密和密钥管理 | EncryptedStorageAdapter、crypto-gcm、cryptoProvider                      |
| 存储层     | 负责数据的物理存储     | ChunkedFileHandler、SingleFileHandler                                    |
| 元数据层   | 管理数据库元数据       | MetadataManager                                                          |
| 监控层     | 监控系统性能和缓存状态 | PerformanceMonitor、CacheMonitor                                         |
| 工具层     | 提供通用基础能力       | FileOperationManager、withTimeout、logger                                |

## 3. 核心模块设计

### 3.1 接口层

#### FileSystemStorageAdapter

- 表管理：创建、删除和列出表
- 数据读写：插入、更新、删除和查询
- 事务管理：开始、提交和回滚
- 批量操作和存储模式迁移

#### EncryptedStorageAdapter

- AES-256-GCM 加密，符合 NIST SP 800-38D
- 字段级和整表加密
- 基于 PBKDF2 + HKDF 的两级密钥派生

#### 访问表面与严格认证

- 根入口的 `db` facade 与命名 API 是公开调用面；`plainStorage` 不是公开导出。
- 以 `encrypted: true` 创建的表只能通过加密表面访问。明文表面请求会以 `PERMISSION_DENIED` fail-closed，而不会暴露密文或创建平行的明文数据。
- 以 `requireAuthOnAccess: true` 创建的严格表绑定独立认证密钥作用域。该标记会隐式选择加密表面，调用方通常应显式传入 `encrypted: true, requireAuthOnAccess: true`；常规加密表面不能读取严格表，也不能把既有常规加密表原地重新解释为严格表。
- 当元数据中存在严格表时，`listTables()` 同样要求严格表面，否则会以 `PERMISSION_DENIED` 拒绝，而不会返回部分表名。
- 升级到严格认证需要由应用显式迁移并验证数据，再退役原有常规表和密钥。

#### StorageAdapterFactory

- 根据配置创建合适的存储适配器
- 支持 FILE_SYSTEM 和 ENCRYPTED 适配器类型

### 3.2 数据访问层

#### DataReader

- 读取表数据，并支持过滤和分页
- 集成 LRU/LFU 缓存策略
- 使用索引优化查询

#### DataWriter

- 对表执行插入、覆盖、更新和删除
- 自动创建表
- 数据校验和索引更新
- 使用操作锁进行并发控制

#### QueryEngine

- 复杂查询条件：$eq、$ne、$gt、$gte、$lt、$lte、$in、$nin、$like、$and、$or
- 多种排序算法：default、fast、counting、merge、slow
- 基于 skip/limit 的分页

### 3.3 加密层

#### crypto.ts / crypto-gcm.ts

- 默认并推荐使用 AES-256-GCM
- 向后兼容 AES-256-CTR + HMAC
- PBKDF2 密钥派生，配置默认值为 600,000；Expo Go 可使用文档约定的运行时降档
- 使用 HKDF 快速派生单记录密钥
- 字段级和批量加解密

#### cryptoProvider.ts

- Expo Go 通过 `crypto-js` 使用纯 JavaScript 路径
- 可选使用 react-native-quick-crypto 原生加速
- 集成 expo-crypto 生成安全随机字节

### 3.4 存储层

#### ChunkedFileHandler

- 建表时初始数据估算值超过配置 `chunkSize` 的一半会自动选择分片模式（默认超过 2.5 MiB）
- 通过临时文件和 rename 实现原子发布
- 使用 overwrite 和 append 恢复日志
- 追加失败时清理已经写出的部分 chunk
- 基于哈希校验数据完整性
- 并行读取并缓存 chunk

#### SingleFileHandler

- 使用单文件保存小型数据集
- 通过临时文件和 rename 实现原子发布
- 文件锁错误的重试机制

#### FileHandlerFactory

- 根据存储模式创建对应的文件处理器
- 根据数据大小自动选择模式

### 3.5 缓存层

#### CacheManager

- LRU（Least Recently Used）策略
- LFU（Least Frequently Used）策略
- 通过空值缓存防止缓存穿透
- 通过随机 TTL 抖动降低缓存雪崩风险
- 通过异步互斥锁降低缓存击穿风险
- 使用最小堆跟踪过期项，以 O(k log n) 清理
- 基于 JSON 的近似大小计算

### 3.6 索引层

#### IndexManager

- 唯一和非唯一字段索引
- 复合索引
- 批量重建索引
- 基于索引优化查询

### 3.7 元数据层

#### MetadataManager

- 管理表 schema
- 对低优先级变化使用延迟加载和防抖保存
- 即时 flush 使用串行化临时文件原子发布
- 元数据版本字段和预留迁移 hook
- 自动持久化元数据

### 3.8 监控层

#### PerformanceMonitor

- 操作耗时和统计信息
- 默认 10% 采样
- 健康检查
- 可配置指标保留策略

#### CacheMonitor

- 缓存命中率监控
- 内存使用跟踪
- 淘汰统计

### 3.9 服务层

#### TransactionService

- 提供带 read-your-writes 行为的进程内排队事务
- 提交部分失败时恢复快照，并移除事务中新建的表
- 事务数据缓存和计算

#### AutoSyncService

- 定期同步脏数据
- 带随机抖动的指数退避重试
- 按表限制脏缓存条目的批处理，不拆分整表覆盖
- 支持优雅关闭

#### CacheService

- 表级缓存失效
- 缓存键管理

## 4. 数据流

### 4.1 写入流程

1. 客户端调用公开的 `insert`、`overwrite` 或 `bulkWrite`
2. FileSystemStorageAdapter 校验输入
3. DataWriter 校验数据并确保表存在
4. 使用单文件或分片模式执行写入
5. 更新索引
6. 更新元数据，并对表和写入元数据变化执行 flush
7. 返回结果

### 4.2 读取流程

1. 客户端调用 `read`、`findOne` 或 `findMany`
2. 在未要求 bypass 时检查缓存
3. 在可用时使用索引
4. 从存储读取数据
5. `findOne`/`findMany` 应用过滤、排序和分页；原始 `read` 返回存储记录
6. 对非高风险数据缓存结果
7. 返回结果

### 4.3 事务流程

1. 客户端调用 `beginTransaction()`
2. 操作进入队列，不立即执行
3. 客户端调用 `commit()`，按顺序执行全部操作
4. 或调用 `rollback()` 丢弃全部排队操作

事务只协调一个适配器实例中的进程内操作。它不是持久化 write-ahead log，也不承诺崩溃恢复或跨进程 ACID 隔离。

## 5. 性能特征

| 操作               | 特征                           | 说明                                                   |
| ------------------ | ------------------------------ | ------------------------------------------------------ |
| 缓存命中读取       | 内存查找                       | LRU/LFU 之外仍会受到 payload 复制和设备运行时影响      |
| 未缓存读取         | 随存储 payload 增长            | 分片模式限制单个文件大小，但不会让全表扫描变成常数时间 |
| 覆盖写             | 随最终表大小增长               | 使用原子发布，并可能重写整表                           |
| 批量写入           | 分摊初始化和持久化成本         | 业务允许批处理时，优先于大量独立写入                   |
| 索引查询           | 建立 O(n) 索引后执行 O(1) 查找 | 仅在存在兼容索引时成立                                 |
| 首次加密操作       | 主要成本来自 PBKDF2            | 强烈依赖运行时 provider、迭代配置和设备                |
| 后续单记录密钥派生 | 使用 HKDF 扩展和密钥缓存       | 不会消除加密、序列化和 I/O 成本                        |

这些是实现特征，不是跨设备延迟保证。发布判断应使用目标环境中的运行时 QA 和性能测试证据。

## 6. 安全设计

### 6.1 加密

- AES-256-GCM（NIST SP 800-38D）
- PBKDF2 密钥派生，默认 600,000 次迭代
- 使用 HKDF 快速派生单记录密钥
- 字段级和整表加密模式
- 可选生物识别认证

### 6.2 数据完整性

- 读取时执行 SHA-256 哈希校验
- 原子写入避免发布部分文件
- append journal 回滚部分写出的 chunk 集合
- 自动检测数据损坏

### 6.3 密钥管理

- 通过 expo-secure-store 安全保存密钥
- 内存密钥回退仅限测试环境；运行时密钥存储失败时会拒绝继续
- 带 LRU 清理的密钥缓存
- 支持主密钥重置，用于退出登录或数据重置

## 7. Expo Go 兼容性

| 能力         | Expo Go                           | 独立 APK/IPA                 |
| ------------ | --------------------------------- | ---------------------------- |
| 文件系统     | ✅ expo-file-system               | ✅ expo-file-system          |
| 加密         | ✅ crypto-js/native helpers（JS） | ✅ 支持原生加速              |
| Secure Store | ✅ expo-secure-store              | ✅ expo-secure-store         |
| Constants    | ✅ expo-constants                 | ✅ expo-constants            |
| 原生加密     | ❌，回退到 JS                     | ✅ react-native-quick-crypto |

## 8. 配置

配置来源按优先级从高到低排列：

1. 配置管理器的程序化覆盖项（`setConfig()`、`updateConfig()` 或 `set()`）。
2. React Native / Expo（以及测试）环境中第一个可用的运行时配置来源：`global.__expoConfig.extra.liteStore`、`expo-constants` 读取到的 `app.json` / app config `extra.liteStore`、`global.expo.extra.liteStore`、`global.liteStoreConfig`。这些是按上述顺序的回退来源，不会彼此合并。
3. `LITE_STORE_*` 环境变量。
4. 默认配置。

在非 React Native / Expo 且非测试的运行时，不会探测第 2 项，配置只由默认值、环境变量和程序化覆盖项组成。

关键配置项：

- `chunkSize`：分片目标大小，默认 5 MiB；初始数据自动选分片的门槛为其一半
- `encryption.algorithm`：`'auto' | 'AES-GCM' | 'AES-CTR'`
- `encryption.keyIterations`：PBKDF2 迭代次数，默认 600,000
- `cache.maxSize`：最大缓存项数
- `performance.maxConcurrentOperations`：最大并发操作数，默认 5
- `autoSync.enabled`：后台脏缓存同步开关，默认 false
