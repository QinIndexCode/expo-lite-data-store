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
| 工具层     | 提供通用基础能力       | PathHelper、withTimeout、logger                                          |

## 3. 核心模块设计

### 3.1 接口层

#### FileSystemStorageAdapter

- 表管理：创建、删除和列出表
- 数据读写：插入、更新、删除和查询
- 事务管理：开始、提交和回滚
- 批量操作和存储模式迁移
- 每轮 adapter runtime 初始化都会探测存储权限；并发探测只共享当前 in-flight 工作，不永久缓存结果，写入热路径不重复执行文件系统预检

#### EncryptedStorageAdapter

- AES-256-GCM 加密，符合 NIST SP 800-38D
- 字段级和整表加密
- 基于 PBKDF2 + HKDF 的两级密钥派生

#### StorageAdapterFactory

- 根据配置创建合适的存储适配器
- 支持 FILE_SYSTEM 和 ENCRYPTED 适配器类型

### 3.2 数据访问层

#### DataReader

- 读取表数据，并支持过滤和分页
- 集成 LRU/LFU 缓存策略
- 索引查询优先使用字符串或有限数值形式的 `id`，缺失时回退到 `_id`
- 兼容索引中只要存在没有稳定标识符的行，就不会参与加速，读取会执行全表扫描
- 共享元数据 mutation epoch 会让不同 adapter 失效陈旧的存储表示、缓存 namespace 与索引；读取会在有界次数内重试，直到观察到稳定代际

#### DataWriter

- 对表执行插入、覆盖、更新和删除
- 自动创建表
- 数据校验和索引更新
- FIFO 表锁按存储根目录和表名在 DataWriter 实例间共享
- 锁等待上限为 30 秒；超时等待者只释放自己的 gate，不截断后续等待者，操作槽交接仍执行配置的并发上限
- 删除表时先提交元数据不存在状态；提交失败会恢复元数据且不触碰数据，提交后的清理失败则保留逻辑不存在状态，后续删除或同名建表会重试/清除孤立工件

#### QueryEngine

- 复杂查询条件：$eq、$ne、$gt、$gte、$lt、$lte、$in、$nin、$like、$and、$or
- 多种排序算法：default、fast、counting、merge、slow
- 所有算法在升序和降序下都保持 `null`、`undefined` 稳定并置于末尾
- 基于 skip/limit 的分页

### 3.3 加密层

#### crypto.ts / crypto-gcm.ts

- 默认并推荐使用 AES-256-GCM
- 向后兼容 AES-256-CTR + HMAC
- PBKDF2 密钥派生，配置默认值为 600,000；Expo Go 可使用文档约定的运行时降档
- 使用 HKDF 快速派生单记录密钥
- 字段级和批量加解密
- legacy CTR / 当前 GCM 混合批量解密会按 provider 分组并恢复原始顺序

#### cryptoProvider.ts

- Expo Go 通过 `crypto-js` 使用纯 JavaScript 路径
- 可选使用 react-native-quick-crypto 原生加速
- 集成 expo-crypto 生成安全随机字节

### 3.4 存储层

#### FileHandlerBase

- 单文件与分片处理器的不同实例会按物理路径共享同一个进程内 FIFO 队列
- 路径锁等待上限为 30 秒；超时等待者会释放自己的队列 gate，并在队尾结束后移除
- 该锁只协调当前进程，不提供跨进程文件系统锁

#### ChunkedFileHandler

- 建表时初始数据估算值超过配置 `chunkSize` 的一半会自动选择分片模式（默认超过 2.5 MiB）
- 通过临时文件和日志实现可恢复发布；不假设 Expo 各平台都能原子替换既有目标
- 有界 overwrite-v2 日志只记录旧计数和 chunk 状态，旧 chunk 移入 `<table>.overwrite-backup/`；`.ready` 表示备份已完整准备
- 删除 overwrite 日志是提交点；提交后残留的备份只会在后续访问校验当前 chunk 集合后清理
- single-to-chunked 迁移先发布并校验新 chunk 集合，再切换元数据 mode；mode 切换提交迁移，之后清理旧单文件失败不能回滚
- append 使用独立日志，并在任何待处理 overwrite 之前恢复
- 读写、范围读取、预加载和清空都会在共享表目录路径锁内执行涉及恢复的工作
- 写入失败时清理部分 chunk、已完成回滚的日志和临时 staging 文件
- 基于哈希校验数据完整性
- 并行读取并缓存 chunk

#### SingleFileHandler

- 替换主文件前会发布绑定表名的 v2 commit marker，记录前后两代内部 `storageCommitToken`、SHA-256 hash 和物理记录数
- 重启恢复直接从 metadata 文件解析持久化 token，不信任 adapter 缓存。canonical v1 marker 仅作为兼容证据；临时证据只有在 v2、`committed` 且表名/token/hash/count 全部匹配持久化目标代际时才权威有效
- 使用单文件保存小型数据集
- 在相关元数据完成前，采用保留经校验 `.bak` 上一代的可恢复发布
- 从可恢复发布开始一直持有共享路径锁，直到显式 commit 或 rollback
- 不可取消的 mutation 超过截止时间时，会等待其结束并回滚后再释放锁
- 校验主文件/备份文件，无可验证备份时对损坏数据 fail-closed
- 文件锁错误的重试机制

### 3.5 缓存层

#### CacheManager

- LRU（Least Recently Used）策略
- LFU（Least Frequently Used）策略
- 通过空值缓存防止缓存穿透
- 通过随机 TTL 抖动降低缓存雪崩风险
- 通过异步互斥锁降低缓存击穿风险
- 使用最小堆跟踪过期项，以 O(k log n) 清理
- 基于 JSON 的近似大小计算
- 通过有界表命名空间版本让失效后的读取键无需扫描全部缓存即可不可达；旧值仍按正常淘汰策略释放

### 3.6 索引层

#### IndexManager

- 唯一、非唯一和复合字段索引
- 索引仅是进程内内存加速器；查询只使用已就绪且兼容的索引，否则回退为全表扫描
- 稳定标识符优先使用 `id` 并回退到 `_id`；任一行两者都没有时，该索引在覆盖完整前不会参与加速
- 增量写只暂存受影响 bucket 的 delta，重建则暂存完整替换映射；两者都在触碰物理存储前校验 `UNIQUE` 约束
- 仅在存储成功后应用暂存 delta 或替换映射，因此实时查询不会看到部分更新的索引
- 支持批量重建索引和基于索引优化查询

### 3.7 元数据层

#### MetadataManager

- 管理表 schema
- 对低优先级变化使用延迟加载和防抖保存
- 即时 flush 使用串行化的临时文件/备份可恢复发布，不承诺跨平台原子移动
- metadata 主文件缺失时可恢复结构有效的 backup；主文件存在但损坏时绝不回退，且发布/恢复只有在成功移除旧 backup 后才完成
- 管理器实例按元数据路径共享 FIFO，锁等待上限为 30 秒；超时等待者不能越过当前 owner，也不能释放后续等待者
- 每次 flush 都重读最新磁盘快照；update/delete 要求匹配预期 `createdAt`，upsert 要求表名仍缺失，既保留其他实例的无关变更，也阻止陈旧 mutation 修改同名新代际；失败 mutation 会保留等待重试
- 成功发布会推进进程级 mutation epoch，让其他 manager 实例刷新快照
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

- 提供带 read-your-writes 行为的进程内排队事务；`read`、`countTable`、`findOne` 和 `findMany` 均基于暂存投影视图执行，查询过滤、排序和分页也使用该视图
- `beginTransaction()` 会捕获 owner 身份，其他适配器不能读取、追加、提交或回滚该活动事务
- commit 执行与 commit 失败后的快照恢复携带模块私有 symbol capability 进行直接写，公开 options 无法伪造该绕过能力
- 提交部分失败时恢复快照，并移除事务中新建的表
- 事务数据缓存和计算
- 排队的可序列化记录输入、对象形式的查询值和事务查询结果与调用方后续的对象修改相隔离
- 活动事务 owner 的匹配存储表面上的公开 `createTable`、`deleteTable` 和 `migrateToChunked` 会以 `TRANSACTION_OPERATION_NOT_SUPPORTED` 被拒绝，因为 schema 元数据和文件会立即持久化；其他 adapter 或表面会先触发事务 guard

#### AutoSyncService

- 定期同步脏数据
- 带随机抖动的指数退避重试
- 按表限制脏缓存条目的批处理，不拆分整表覆盖
- 活动事务会延迟 AutoSync 存储写，并保留脏条目给后续定时或显式 sync
- 支持优雅关闭

#### CacheService

- 表级缓存失效
- 缓存键管理

### 3.10 工具层

#### PathHelper

- 校验配置的存储目录名，并解析当前根目录和历史根目录
- 仅在当前根目录不存在或实际为空时迁移历史默认根目录
- legacy 迁移前先删除空 bootstrap 根目录，避免正确性依赖 move 覆盖既有目录
- 将不可读或格式损坏的当前 `meta.ldb` 视为已占用，避免迁移覆盖受损的当前元数据

#### logger

- `EXPO_LITE_DATA_STORE_LOG_LEVEL` 支持 `silent`、`error`、`warn`、`info`、`debug`，非测试环境默认 `warn`
- 测试默认静默；`EXPO_LITE_DATA_STORE_TEST_LOGS=1` 用于开启诊断性的 `debug` 输出

## 4. 数据流

### 4.1 写入流程

1. 客户端调用公开的 `insert`、`overwrite`、`update`、`remove`、`clearTable` 或 `bulkWrite`
2. FileSystemStorageAdapter 校验输入
3. DataWriter 校验数据并确保表存在
4. 暂存增量索引 bucket delta 或完整重建映射并校验 `UNIQUE` 约束，不修改实时索引
5. 使用单文件或分片模式执行写入；整表加密会区分物理 envelope 数与逻辑行数
6. 同次发布暂存索引、逻辑计数与 storage generation；若最终化失败，则回滚可恢复的单文件上一代
7. 返回结果

### 4.2 读取流程

1. 客户端调用 `read`、`findOne` 或 `findMany`
2. 刷新当前元数据与存储 mode；若其他 adapter 推进了 mutation epoch，则失效缓存 namespace 与索引
3. 仅在已就绪兼容索引覆盖的每一行都有稳定 `id` 或 `_id` 时使用索引，否则回退为全表扫描
4. 从存储读取数据
5. `findOne`/`findMany` 应用过滤、排序和分页；原始 `read` 返回存储记录
6. 再次核对元数据；代际已变化时按最新存储表示重试
7. 对非高风险数据缓存结果并返回

### 4.3 事务流程

1. 客户端调用 `beginTransaction()`，事务捕获该适配器的 owner 身份
2. 同一 owner 的写入进入队列而不立即执行；`read`、`countTable`、`findOne` 和 `findMany` 会把队列投影为 owner 的暂存视图，其他适配器会被拒绝
3. 事务活动期间 AutoSync 保留脏条目但不执行写入
4. 客户端调用 `commit()`，通过模块私有 direct-write capability 按顺序执行全部操作
5. 公开 `rollback()` 只丢弃排队操作而不写入；commit 部分失败时使用同一 capability 恢复快照

事务只协调一个适配器实例中的进程内操作。它不是持久化 write-ahead log，也不承诺崩溃恢复或跨进程 ACID 隔离。

在活动事务 owner 的匹配存储表面上，公开的 `createTable()`、`deleteTable()` 和 `migrateToChunked()` 不会进入事务队列：它们会以 `TRANSACTION_OPERATION_NOT_SUPPORTED` 失败，因为每个操作都可能立即持久化 schema 元数据或文件。其他 adapter 或表面会先触发事务 guard。

### 4.4 删除表流程

1. `deleteTable()` 先校验事务表面；若匹配表面存在活动事务则拒绝该调用，随后才在共享表锁内快照当前元数据
2. flush 元数据删除；若失败，会在删除任何工件前恢复并重新 flush 快照
3. 元数据提交成功后，删除内存索引以及全部表、日志和 overwrite-backup 工件
4. 清理失败会返回错误，但表保持逻辑不存在；元数据缺失阻止工件让表复活，后续删除或同名建表会重试/清除孤立工件

## 5. 性能特征

| 操作               | 特征                           | 说明                                                         |
| ------------------ | ------------------------------ | ------------------------------------------------------------ |
| 缓存命中读取       | 内存查找                       | LRU/LFU 之外仍会受到 payload 复制和设备运行时影响            |
| 未缓存读取         | 随存储 payload 增长            | 分片模式限制单个文件大小，但不会让全表扫描变成常数时间       |
| 覆盖写             | 随最终表大小增长               | 使用可恢复发布，并可能重写整表；不是跨文件系统的严格原子事务 |
| 批量写入           | 分摊初始化和持久化成本         | 业务允许批处理时，优先于大量独立写入                         |
| 索引查询           | 建立 O(n) 索引后执行 O(1) 查找 | 仅在兼容索引具备稳定标识符覆盖时成立，否则执行全表扫描       |
| 首次加密操作       | 主要成本来自 PBKDF2            | 强烈依赖运行时 provider、迭代配置和设备                      |
| 后续单记录密钥派生 | 使用 HKDF 扩展和密钥缓存       | 不会消除加密、序列化和 I/O 成本                              |

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
- 单文件和元数据采用可恢复发布，在相关状态完成前保留经校验的上一代；不承诺跨平台原子移动。metadata 仅在主文件缺失时恢复，主文件存在但损坏时绝不回退
- 单文件可恢复 mutation 会持锁直到 commit 或 rollback，包括超过截止时间后完成的 mutation 回滚
- append 与有界 overwrite-v2 日志解决中断的分片写入。overwrite 旧 chunk 保存在带标记的备份目录中，直到删除日志提交新一代；失败路径会清理部分 chunk 和临时 staging 工件
- 自动检测数据损坏；无有效备份时 fail-closed

### 6.3 密钥管理

- 通过 expo-secure-store 安全保存密钥
- 内存密钥回退仅限测试环境；运行时密钥存储失败时会拒绝继续
- 带 LRU 清理的密钥缓存
- 支持主密钥重置，用于退出登录或数据重置

### 6.4 访问绑定的表策略

- 支持的公开表面是根 `db` facade 和命名导出；不再导出 `plainStorage`。
- 以 `encrypted: true` 创建的表必须通过同样带 `encrypted: true` 的调用访问；弱表面会以 `PERMISSION_DENIED` 拒绝，而不会暴露密文或追加明文。
- 非空 `encryptedFields` 会隐式选择加密 facade；事务写入在 commit 隐式建表时会保留解析后的字段列表。
- 新字段级加密表以 `encryptAllFields: true` 与 `encryptedFields: []` 的精确组合表示动态全字段策略，只有该组合具有此语义；非空配置列表会去重后快照。早期 v3 元数据没有该 marker，空列表或字段缺失仍按 legacy 全局配置回退，避免尝试解密混合记录中的明文字段。
- 模块私有 Symbol option 会在排队写入中传递已解析的动态策略与整表逻辑计数，而不扩大公开选项。`DataWriter` 将这些值和物理写入的 storage generation 同次发布。整表 envelope 的物理计数为 1，但逻辑计数独立保存；事务快照也保留该逻辑计数，以便单步回滚。
- 整表解密缓存按表键控，只有在绑定当前精确 ciphertext 时才可命中；timeout 为 0 时禁用。
- `requireAuthOnAccess: true` 绑定独立严格认证密钥作用域，不能原地升级常规加密表；应用必须迁移并验证数据，绝不静默替换密钥。
- `encrypted`、`encryptFullTable`、`encryptedFields` 和 `requireAuthOnAccess` 是持久化表策略。既有加密表遇到冲突的建表/写入选项会以 `MIGRATION_FAILED` 拒绝，而不会静默改变保护方式。
- 为避免泄露严格表元数据，只要存在 `requireAuthOnAccess: true` 的表，`listTables()` 就必须传入严格表面选项，否则以 `PERMISSION_DENIED` fail-closed。

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

Logger 环境变量独立于配置合并：`EXPO_LITE_DATA_STORE_LOG_LEVEL` 选择 `silent|error|warn|info|debug`（非测试默认 `warn`）；测试默认静默，除非设置 `EXPO_LITE_DATA_STORE_TEST_LOGS=1`。
