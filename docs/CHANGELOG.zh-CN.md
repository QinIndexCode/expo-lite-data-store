# 变更日志

本文件记录本项目所有值得说明的重要变更。

[README 入口](../README.md) | [English](./CHANGELOG.en.md) | [API 参考](./API.zh-CN.md)

## [未发布]

## [4.0.0] - 2026-09-29

### 新增

- **file-system 引擎的完整索引生命周期**：`createTable({ indexes })` 现在会真正创建并构建声明的索引（此前该选项被接受但被静默忽略）；`createIndex` 在持有表写锁期间立即基于现有数据构建索引，唯一约束与查询加速从下一次操作即生效；持久化的索引声明会在 adapter 初始化阶段、任何公开 API 调用之前重新登记并重建——唯一约束执行与索引加速读取跨重启保留。声明会先校验（字段名为空报 `TABLE_INDEX_INVALID`），带声明的建表失败不会留下半成品表。
- **`import/no-cycle` 循环依赖门禁**：接入 `eslint-plugin-import` 并在 ESLint 扁平配置中启用 `import/no-cycle: error`（仅此一条规则，不引入其余 import 规则集），同时声明 `import/resolver` 与 `import/extensions` 的 `.ts`/`.tsx` 扩展名，使规则能解析并遍历 TypeScript 模块（缺省只认 `.js`/`.mjs`/`.cjs`，对 TS 模块会静默失效）。存量的两处值导入环——`AutoSyncService` 与 `StorageTaskProcessor` 对 `FileSystemStorageAdapter` 的反向引用——改用 `import type` 断开，二者均为纯类型引用，运行时语义不变。
- **导出面锁定测试与 API 类型补录**：新增 `src/__tests__/unit/export-surface.test.ts`，用显式键名清单对 `Object.keys(...).sort()` 做全等断言，正向锁定三套公开导出面——主入口 41 个 named 运行时导出加 `default`（共 42 个可枚举键）、`db` facade 的 23 个键、`default` 导出对象的 30 个键——并同时锁定 `package.json` `exports` 的子路径键集合（`.`、`./js`、`./cjs`、`./utils/*`）与 `src/index.ts` 的 `export *` 转出口，任何意外的导出增删都会让该套件变红（有意变更需同步更新清单与 CHANGELOG）；API 参考（中英文）的导出分组表补录此前未记载的 6 个 type-only 类型：`Catalog`、`ColumnDefinition`、`SortAlgorithm`、`SortField`、`SortOrder`、`TableMeta`。

### 修复

- **数字键字段路径的 SQLite 下推双分支对齐（读/删/改/排序）**：字段路径含**单个**纯数字片段（如 `a.0.c`，数字段无前导零）时，`sqlite` 下推此前只按数组括号形式（`$.a[0].c`）生成 WHERE 与 ORDER BY，把「对象数字键」记录（`{a: {'0': ...}}`）静默漏掉——跨引擎读/删/改命中集与排序结果分歧，最危险的是漏删/漏改。现在 `SqlQueryBuilder` 派生点形（`$.a.0.c`）与括号形（`$.a[0].c`）两种路径变体：WHERE 以整条谓词为单位、按各自路径是否解析加守卫做 OR 双分支（守卫保证 `$ne`/`$nin`/缺失路径语义不从落空分支泄漏），参数按分支顺序合并、翻倍后仍受 500 绑定参数全局上限约束（超出回退内存过滤）；`ORDER BY` 用 `COALESCE(括号, 点形)` 取先命中的分支，`NULLS LAST` 与末尾 `id ASC` 决胜键不变。含**两个及以上**纯数字片段的路径（如 `a.0.1`、`a.0.b.1`）在容器混用（数组→对象键、对象→数组）时两种路径会同时落空，双分支同样对不齐，因此这类字段整体拒绝下推、自动回退内存过滤（WHERE 与排序皆是）：结果仍与内存引擎完全一致，仅失去下推加速。含**前导零**数字段的路径（如 `a.01`）也整体回退内存：`getJsonPath` 会把 `.01` 改写成下标 `[01]`，SQLite 按数组下标 1 求值、内存按字面键 `'01'` 访问，两者语义不同（回退前会造成读、删分歧），回退后两引擎结果一致。无前导零的单个数字段下推判定不变（仅 `isSafeField` 等既有否决条件才回退），索引 DDL 仍按数组括号形式生成（对象数字键记录不走索引——仅性能、结果不受影响），`SQLiteStorageAdapter` 读下推消费侧与 `customSortAlgorithm` 路径不动。`engine-parity` 新增数组/对象数字键双数据集用例（k=1）与多数字片段回退用例（k≥2 复查反例 + 删除），覆盖 eq、ne（含缺失/null 交互）、range、`$in`/`$nin`、删除与更新命中行数、含 desc 与 null 的排序序一致，并有断言证明对象数字键记录在 sqlite 引擎下确实被读到。
- **`file-system` 与 `sqlite` 引擎的字符串排序序一致**：字符串比较从 locale 敏感的 `localeCompare` 改为确定性的 Unicode 码点序，与 SQLite `BINARY` 排序规则（UTF-8 字节序 ≡ 码点序）对齐——大小写混排、中文/全角、私用区与星平面字符（如 `😀` U+1F600 与 U+E000）在两个引擎、全部五种 `sortAlgorithm` 下返回完全相同的顺序，且不随 locale 或运行环境变化；`QueryEngine.max`/`min` 的字符串比较同步对齐。`sortingTools` 的五个排序实现与 `QueryEngine` 各自持有模块内私有的码点序比较函数，未扩大公共导出面。
- **`timeout` 配置接通 file-system 引擎 I/O 路径**：单文件/分片 I/O 与 `DataWriter.deleteTableArtifact`（表制品删除）等操作现在在每次调用时读取 `timeout` 配置（此前这些路径硬编码为 10000ms，`setConfig({ timeout })` 对其无效）；30 秒读守卫与文件锁等待按设计保持固定，不随该配置变化。
- **按表写入串行化（file-system 引擎）**：所有物理写入路径（`write`、`overwrite`、`delete`、`bulkWrite`、`update` 以及事务 commit/rollback 写入）现在都在按表 FIFO write lock 下执行。并发的读-改-写操作会排队而不是交错执行，update 进行中到达的插入或删除不会再被其替换步骤静默抹掉。持有锁的内部调用方携带模块私有标记，避免自我死锁。
- **SQLite 写入不再与活动事务交错**：SQL 事务打开期间到达的外部写入与 DDL 会排到该事务之后，而不是插入其语句之间执行。此前并发插入可能在事务中途执行并被事务的替换覆盖，或报错 "cannot start a transaction within a transaction"。commit/rollback 的重放嵌套操作仍通过不可伪造的内部标记内联执行。
- **SQLite 读-改-写一致性**：`update`、`delete` 与混合 `bulkWrite` 的回退路径现在在与写入相同的 SQL 事务内读取，读取快照与替换对其他排队操作原子可见。
- **保留的加密信封字段名**：携带 `__enc` 或 `__enc_bulk` 的记录会在每个公开写入入口（`insert`、`overwrite`、`update`、`bulkWrite` 与 `createTable` 的 `initialData`）被以 `FILE_CONTENT_INVALID` 拒绝、先于任何存储触达；此前这类记录会被误判为整表信封并永久破坏该表的读取。
- **引擎迁移目标保护**：`migrateEngine` 遇到目标表已有数据时，会以新的 `MIGRATION_DEST_NOT_EMPTY` 错误码失败而不是静默覆盖；传入 `overwriteExisting: true` 可有意替换目标数据。目标占用量通过新增的可选 `getPhysicalRecordCount()` 适配器方法按物理行数衡量，因为共享元数据会让 `hasTable` 在跨引擎场景下不可靠。
- **持久化引擎偏好**：引擎迁移成功后，所选引擎会跨应用启动持久化；`init()` 或 `configManager` 中显式传入的 `engine` 仍会覆盖持久化标记。
- **跨适配器实例的事务门面保护**：SQLite 引擎会创建相互独立的明文/加密适配器实例，各自持有独立的事务服务。`beginTransaction()` 现在在门面层强制单事务语义，事务安全状态也会对照真正开启事务的适配器（而非默认实例）清理。
- **对齐 Mongo 的 `$pull` 语义**：只有同时匹配全部列出键值对的数组元素才会被移除，对象值按深度相等比较而非引用相等。
- **查询的深度文档相等**：`$eq`、`$ne` 与普通对象值条件现在按深度相等比较。空对象条件只匹配空的存储对象（此前会匹配所有记录），数组比较也不再依赖键顺序。
- **AutoSync 间隔默认值**：`AutoSyncService` 的回退间隔现在与文档化的 `30000` 毫秒默认值一致，不再回退到 `5000` 毫秒。
- **历史载荷解密诊断**：解密未内嵌 PBKDF2 `iterations` 字段的历史载荷时，会一次性告警当前使用的是 `encryption.keyIterations` 配置，使配置漂移导致的解密失败可诊断（CTR 与 GCM、单条与批量路径）。没有持久化 `encryptedFields` 元数据的加密表在回退到全局配置时同样按表告警一次。
- **SQLite `migrateToChunked` 事务守卫**：SQLite 引擎下 `migrateToChunked` 对存储布局是 no-op，但现在遵循公开 schema 变更契约——无事务时立即返回，活动事务期间会以 `TRANSACTION_OPERATION_NOT_SUPPORTED` 被拒绝，与 file-system 引擎一致。
- **既有表的 `createTable({ indexes })` 安全性（file-system 引擎）**：索引声明现在仅在本次调用真正创建表时执行（与 SQLite 一致）。此前对已存在的表，失败或重复的声明会触发新建表回滚、删掉表中已有的数据行。
- **索引声明持久化加固（file-system 引擎）**：`createIndex`/`dropIndex` 现在以 `saveImmediately` 立即刷写声明元数据，而不是留在 200 毫秒防抖窗口内——唯一约束不会因崩溃悄然丢失、已删除的索引也不会复活，与 SQLite 引擎一致。
- **索引构建读取绕过读缓存**：启动重建与 `createIndex` 构建改用 `bypassCache` 读取磁盘快照，不再可能基于陈旧的缓存克隆构建，也不会在缓存中留下整表副本。
- **启动索引重建告警不再泄露存储值**：告警只记录错误码与错误消息；`StorageError` 的 `details`（可能内嵌唯一索引的冲突值）不再透传到控制台。
- **写入路径现在遵循 `encryptedFields`**：携带 `encryptedFields` 而未传 `encrypted: true` 的写入会选择加密表面，在隐式建表时持久化请求的字段列表，并在既有表策略不同时以 `MIGRATION_FAILED` 失败（不再静默落盘明文）。
- **SQLite 引擎不再静默忽略横切配置**：在 `sqlite` 引擎下初始化时，若 `autoSync.enabled` 或 `monitoring.enablePerformanceTracking` 被开启，会输出一条带 `[SQLiteStorageAdapter]` 前缀的一次性告警，注明 `autoSync` 是 `file-system` 引擎专属能力、`monitoring.enablePerformanceTracking` 的存储侧样本也仅由 `file-system` 引擎记录（加密耗时样本两引擎均记录），建议改用 `file-system` 引擎或移除该配置。默认配置零告警；`cache.*` 与默认开启的 `monitoring.enableHealthChecks` 不告警，仅在文档中说明。
- **同一查询在两个存储引擎下返回一致结果（`sqlite` 条件下推语义对齐 `QueryEngine`）**：数组字段的 `$in`/`$nin` 现在同时匹配数组元素与标量字段值（复合条件经 `json_each` 展开，参数绑定保持占位符数组风格）；`json_type` 用于区分字段缺失、JSON `null`、布尔与数字（`active: 1` 或 `$in: [1]` 不再误命中 `true`），`$ne` 对缺失字段命中、直接 `null` 相等不命中缺失字段，`$in`/`$nin` 中的 `null`/`undefined` 成员按基准语义对齐；`$nin`/`$in` 增加单条查询 500 绑定参数上限（超出自动回退内存过滤并输出告警，`$in` 与 `$nin` 各含一份数组分支与标量分支副本）；`$like` 因 SQLite 缺少 Unicode 大小写折叠不再下推、始终由与 `file-system` 引擎相同的内存过滤执行；`$exists`/`$regex`/`$elemMatch`/`$size`/`$notLike` 等非白名单操作符与无 SQL 等价形态的操作数（对象、BigInt）保持回退内存。新增 `engine-parity` 双引擎集成测试，用同一数据集在两个引擎上断言读、删、改结果集一致。
- **`performanceMonitor` 运行时开关接通**：`configManager.set('monitoring.enablePerformanceTracking', ...)` 现在运行时立即生效——`ConfigManager` 在配置成功落地后通知订阅方，`performanceMonitor` 就地刷新 `enabled` 与 `metricsRetention`（此前该值仅在构造时读取一次，之后任何 `set` 都不生效）；通知回调只刷新配置派生字段且不覆盖任何显式设置：`configure()` / `setEnabled()` 的显式设置（含 `enabled` 与 `metricsRetention`）优先于配置变更，`sampleRate`、`maxRecords` 与阈值同样不被配置触及，`resetRuntimeOptions()` 清除显式覆盖、恢复配置权威。
- **SQLite 引擎初始化失败后可正常重试**：打开数据库或建表 DDL（`PRAGMA` / `CREATE TABLE` / `CREATE INDEX`）任一步失败时，SQLite 引擎不再永久停留在半初始化状态——下一次调用会重新执行初始化并补建缺失的 `__elds_records` 表，随后的读写恢复正常（此前初始化一旦失败，所有后续操作都会报 "no such table"，横切配置告警也永不发出）；失败时被放弃的数据库句柄会被关闭，而不是每次重试泄漏一个。

### 安全

- **SQLite `deleteTable` 索引前缀 `LIKE` 转义补全**：索引清理前缀的通配符转义类现在在 `_`、`%` 之外同时覆盖反斜杠，与既有 `ESCAPE '\'` 对应，关闭 CodeQL `js/incomplete-sanitization` 告警；上游 `SqlQueryBuilder.cleanIdentifier` 本已剔除反斜杠，此改动属使用点的纵深防御，两引擎行为不变。
- **`js-yaml` override 升级至 4.3.2**：修复 Dependabot 高危告警（`maxTotalMergeKeys` 对空合并源不设 CPU 上限）；该依赖仅存在于 dev 工具链（eslint / @expo/cli / ts-jest），生产依赖 `npm audit --omit=dev` 持续 0 漏洞。

### 移除

- 从 `CreateTableOptions` 中移除死选项 `intermediates`；它出现在文档中但从未被任何代码路径消费。
- 从 `expo-lite-data-store/utils/crypto` 子路径移除 `precomputeCommonKeys()` 导出：它用随机盐派生密钥（没有任何复用效果），且无任何调用方。
- 删除经复证零生产引用的死代码：内部死模块 `src/core/api/` 全簇（`ApiWrapper`、`RateLimiter`、`RateLimitWrapper`、`ValidationWrapper`、`ApiErrorHandler`、`ApiRouter`）、`src/types/apiResponse.ts`、`src/core/monitor/index.ts` barrel 与 `expo-lite-data-store/utils/configValidator` 子路径（`ConfigValidator`/`ConfigValidationResult`/`configValidationResult`/`fixedConfig`），连同它们各自的测试文件；并从仍然存活的模块中摘除零调用方的导出——`expo-lite-data-store/utils/crypto` 的 `hashPassword()`/`verifyPassword()`/`generateSalt()`（连同仅为它们服务的 `import bcrypt from 'bcryptjs'`）、`expo-lite-data-store/utils/specialOperators` 的 `isSpecialOperator()`、`expo-lite-data-store/utils/expoModuleLoader` 的 `getExpoPeerInstallHint()`，以及 `FILE_OPERATION.OPERATION_TIMEOUT` 常量键。历史 CHANGELOG/updatelog 中对这些符号的记载是发布记录，原样保留。

### 文档

- README/API/ARCHITECTURE（中英文）中的 AutoSync 描述诚实化：同步定时器只属于 `file-system` 引擎、只在应用运行期间触发，且不存在公开的"显式 sync" API；`$eq`/`$pull` 语义已精确说明。
- 在常见错误码表中补充 `FILE_CONTENT_INVALID` 与 `MIGRATION_DEST_NOT_EMPTY`，说明 `migrateEngine` 的目标占用保护与引擎持久化行为，并在 README 中说明按表写入串行化保证。
- 索引章节按实现后的生命周期重写：声明校验与回滚、基于现有数据的即时构建、启动时对持久化声明的重建（API/README/ARCHITECTURE，中英文）；`migrateToChunked` 补充 SQLite no-op 行为说明。
- README 配置表新增 `engine`（`'file-system' | 'sqlite' | 'auto'`）行，错误码表补充 `TABLE_INDEX_*`，导出表补充 type-only `IStorageAdapter`/`IStorageEngine`；API 参考移除死选项 `intermediates`。
- ARCHITECTURE（中英文）：移除不存在的 `ApiRouter`/`ApiWrapper` 组件与"API 路由"表述，弱化 SQLite 引擎夸大的"ACID transaction isolation"措辞，中文版补上缺失的 `requireAuthOnAccess` 隐式选择加密表面一句。
- 中文 ARCHITECTURE 与英文版的 SQLite ACID 弱化措辞对齐；两文均更正语句串行化范围——FIFO 链按适配器实例而非进程级。
- 移除中文 README 中"页面隐藏期间也不会执行同步"的说法——项目并无可见性监听器，仅保证进程挂起期间不同步，与英文 README 一致。
- API 错误码表：将 `TABLE_INDEX_NOT_UNIQUE` 与 `TABLE_INDEX_ALREADY_EXISTS` 限定到文件系统引擎（SQLite 抛出数据库原生约束错误，且同字段表达式的重复声明是幂等 no-op）；文档说明 `createTable` 对已存在的表会忽略索引声明，并补充唯一约束不要声明在加密字段上的警示（每次加密产生不同密文）。

## [3.1.1] - 2026-09-19

### 新增

- **SQLite 高性能底层存储引擎全面升级**：将 SQLite 从实验性适配器升级为正式支持的高性能引擎，保持公共 API 表面 100% 兼容。通过 `init({ engine: 'sqlite' })` 或配置管理器全局启用。
- **SQL 查询与分页下推（SQL Pushdown）**：新增 `SqlQueryBuilder`，将 NoSQL 条件（`$eq`、`$ne`、`$gt`、`$gte`、`$lt`、`$lte`、`$in`、`$nin`、`$like`、`$and`、`$or`）直接转换为 SQLite JSON1 `json_extract(payload, '$.field')` 表达式，并将排序（`ORDER BY ... NULLS LAST`）与分页（`LIMIT ? OFFSET ?`）下推到底层 SQL 执行，消除了全表数据读取与内存反序列化瓶颈。
- **原生 JSON 表达式索引（Expression Indexes）**：在 `createTable` 及新增的 `createIndex`/`dropIndex` API 中支持字段索引，自动在 SQLite 中建立 `CREATE [UNIQUE] INDEX IF NOT EXISTS idx_<clean_table>_<clean_field> ON __elds_records (table_name, json_extract(payload, '$.<field>'))`，使 JSON 字段查询直接享受 B-tree 二分加速，并在唯一索引冲突时在底层拦截。
- **按需分页解密（On-Demand Decryption）**：在字段级加密表中，当查询过滤与排序命中明文字段时，查询与分页完整下推到底层引擎，解密层仅对当前切片结果（如 20 条）调用 `decryptFieldsBulk`，大幅降低 CPU 开销与内存峰值。
- **双向引擎在线迁移服务（`migrateEngine`）**：支持在 `'file-system'` 与 `'sqlite'` 之间进行零数据丢失的双向全库迁移，自动复制表定义、数据记录与表达式索引，并在行数严格校验一致后自动切换活动引擎配置；支持 `cleanSource: true` 自动清理源数据。
- **公开索引管理 API**：导出 `createIndex(tableName, field, options?)` 和 `dropIndex(tableName, field, options?)`。

### 修复与安全加固

- **敏感信息日志防泄露**：重构 `CryptoError` 构造器，仅在 `cause` 中保留原始异常对象，`message` 中仅输出 `error.name`，彻底避免明文数据和解密异常堆栈泄露。
- **DDL 索引前缀隔离**：在 `deleteTable` 中对索引前缀匹配执行字符转义（`idx_${escaped}__%`），杜绝同前缀表名（如 `users` 与 `users_backup`）之间的索引误删。
- **跨引擎安全访问策略穿透**：修复 `assertTableAccessPolicy` 与 `listTables` 的检查器解析，确保 SQLite 引擎加密表完全执行权限校验与隔离策略。
- **加密深层字段查询安全路由**：在 `EncryptedStorageAdapter` 中增加祖先/子孙字段双向判定，杜绝加密嵌套字段在 SQL 层的误下推。
- **并发任务队列安全保护**：加固 `SQLiteStorageAdapter.enqueue`，在事务深度大于 0 时统一返回 Promise 避免同步异常悬挂。
- **可选依赖与动态加载**：`expo-sqlite` 标记为可选 peer 依赖并按需动态加载，默认引擎保持 `'file-system'`，未安装 `expo-sqlite` 的工程可直接打包运行。

## [3.1.0] - 2026-09-06

### 修复

- 收敛 `TransactionError` 到 `StorageError`：事务生命周期失败现在携带 `category: 'transaction'`，可用 `instanceof StorageError` 捕获；补齐缺失的 `SNAPSHOT_FAILED` 错误码。
- 修复 `PerformanceMonitor` 把未设置的 `enablePerformanceTracking` 当成开启；现在与文档默认一致，保持关闭直到显式开启。
- 对齐 SQLite 引擎在事务内的缺表行为与文件系统引擎（暂存空视图、提交时隐式建表，保留 `encryptedFields`/`columns` 与提交期 direct-write 能力）；公开 `read()` 的 `TABLE_NOT_FOUND` 契约不变。
- `DataWriter.verifyCount()` 对整表加密表跳过计数修正，物理信封计数不再覆盖逻辑计数。
- `bulkWrite()` 参数放宽到 `WriteOptions`（`encryptFullTable` 用于路由与隐式建表），文件系统 `bulkWrite()` 隐式建表时透传 options。
- 修复 `fast`/`slow` 排序对数字、bigint、日期按字典序比较的问题；非字符串统一走共享的值感知比较器。
- `LOCK_TIMEOUT` 改归类为 timeout，不再是 unknown。
- `RateLimitWrapper` 在构造参数缺省时回退到全局 `api.rateLimit` 配置；`api.retry` 明确为保留项（仅校验、不消费，`ApiWrapper` 不做自动重试）。
- Expo consumer smoke 对 pinned 的 Expo SDK 56 消费应用容忍 expo-doctor 的已知 Hermes V1 提示（仅当它是唯一失败项时警告并继续）；其它 doctor 失败仍然导致 smoke 失败。

### 变更

- 澄清 v3 深层导入禁令仅针对字面 `dist/...` 路径，并文档化受支持的 `./js`、`./cjs`、`./utils/*` 子路径。
- 修正 `CryptoService` 描述为其实际 re-export 的三个提供者原语（`deriveKey`、`randomBytes`、`hash`）。
- 补齐 `SNAPSHOT_FAILED`、`TRANSACTION_ROLLBACK_FAILED` 错误码、`fast`/`slow` 按大小排序以及 `bulkWrite()` 接受 `WriteOptions` 的文档。

## [3.0.1] - 2026-08-10

### 新增

- 实验性 SQLite 存储引擎基础设施：`IStorageEngine` 引擎契约、`SQLiteStorageAdapter`（逻辑表共享单一物理表 `__elds_records`，以 `table_name` + 自增 id 为键，payload 以 JSON 存储）以及 `StorageAdapterFactory` 对 `SQLITE` / `SQLITE_ENCRYPTED` 的支持。尚未从包根入口导出，文件系统引擎仍为默认。应用层 `TransactionService` 事务映射到真实 SQLite BEGIN/COMMIT，所有语句经过进程内 FIFO 链串行化。

### 变更

- 将库内表读取安全阀从 10 秒提升到 30 秒（DataReader、DataWriter），使大体积 chunked 文档（最高 50MB）在较慢运行时（如使用 JS fallback provider 的 Expo Go）下仍可查询。
- 依据真实 MuMu + Expo Go 56 运行时基线校准 Expo Go QA 性能阈值（25MB 场景约 45s、50MB 约 90s、plain-5000 批量吞吐 ≥ 20000 ops/s），并把 business 大文档 QA case 收窄到 25MB 以留在库内读取安全阀内；50MB 矩阵样本改为用写入返回的计数断言，不再执行全表读取。

- 删除未使用的 `FileOperationManager`、`FileHandlerFactory`、`FileInfoCache`、`StorageStrategy` 与 legacy `ICacheAdapter` 模块，并把存储权限探测移到 adapter 初始化阶段，避免写入热路径重复执行文件系统检查。
- 通过 `EXPO_LITE_DATA_STORE_LOG_LEVEL` 增加有界 logger 级别（`silent|error|warn|info|debug`）；非测试默认 `warn`，测试默认静默，除非设置 `EXPO_LITE_DATA_STORE_TEST_LOGS=1`。
- 在受版本控制的 TypeScript `types` 配置中加入 `expo/types`，并停止依赖被忽略的本地 `expo-env.d.ts`，使干净 checkout 中的 `process.env` 类型可复现。
- 删除冗余的本地 `publish:safe` 与 `publish:force` 包装命令，避免 package scripts 宣传绕过受支持发布工作流中 tag、`main` 祖先关系和 provenance 校验的路径。

### 修复

- 让事务内的 `findOne()`、`findMany()` 读取暂存视图，让事务内 `remove()` 返回该视图的实际命中数，并隔离排队的可序列化记录输入、对象形式的查询值和事务查询结果，避免受调用方后续对象修改影响；同时在匹配的活动事务表面上以 `TRANSACTION_OPERATION_NOT_SUPPORTED` 拒绝公开的 `createTable()`、`deleteTable()` 和 `migrateToChunked()` 调用。
- 保留分页输入校验失败的原始 `RangeError`，不再包装为 `StorageError`。
- 恢复加密 `findMany()` 未传 `sortBy` 时按 `id` 升序的确定性排序。
- 通过文件处理器实例间共享的进程内 FIFO 队列串行处理同路径的单文件与分片操作；锁等待上限为 30 秒，超时等待者会从队列中清理。
- DataWriter 按存储根目录和表名在 writer 实例间共享 FIFO 表锁；超时等待者不会截断后续队列链，操作槽交接仍遵守配置的并发上限。
- 按元数据路径在管理器实例间串行 flush，FIFO 等待上限为 30 秒；合并受 `createdAt` 保护的 update/delete 与 expected-absent upsert 前重读最新磁盘快照，推进共享 mutation epoch 以刷新跨 adapter 的表示/缓存/索引，并保留失败 mutation 供重试。
- metadata 仅在主文件缺失时从 backup 恢复；主文件存在但损坏时 fail-closed，且发布和恢复都以成功移除旧 backup 为完成条件。
- 单文件可恢复 mutation 会持锁直到 commit 或 rollback。超过截止时间后才完成的 mutation 会被观察至结束，并在释放锁前回滚。
- v2 单文件 commit marker 绑定表名以及前后代 token、hash、物理计数；恢复读取持久化 metadata token，兼容 canonical v1，并只在 v2 committed 临时证据的全部字段匹配时采信。
- 用有界 v2 日志和带标记备份目录替代复制旧行的 chunked overwrite 恢复，将日志删除定义为提交点，并在重试残留备份清理前验证已提交数据。
- 先解决待处理 append、再解决待处理 overwrite，校验日志与完整 chunk 集合，并清理失败的日志和临时文件工件。
- 增量写暂存受影响 bucket delta，重建暂存完整映射；物理写入前校验 `UNIQUE`，标识符优先 `id` 再回退 `_id`，覆盖不完整时禁用索引加速。
- 所有排序算法在升序和降序下都保持 `null`、`undefined` 稳定并置于末尾。
- `deleteTable()` 先提交权威的元数据不存在状态；提交失败恢复元数据，提交后清理失败可重试且不会让表重新出现，同名建表前会清理孤立工件。
- single-to-chunked 在 chunk 发布/校验后以 metadata mode 切换作为提交点；旧单文件清理不能再回滚已提交模式。
- 使用模块私有 symbol capability 保护事务提交/恢复写，活动事务期间延迟 AutoSync 写入且不丢弃脏条目。
- 将非空 `encryptedFields` 路由到加密 facade，持久化动态全字段精确 marker，让整表逻辑计数与物理代际同次提交、解密缓存绑定精确 ciphertext，在事务隐式建表时传递策略，将活动事务绑定到创建它的适配器，并拒绝冲突的安全表面或原地修改策略。
- 字段批量解密会逐条识别并分组处理混合的 legacy CTR / 当前 GCM payload，同时保持输入顺序。
- 要求查询 `skip` 与 `limit` 为非负安全整数，并用有界命名空间版本替代缓存键扫描。
- 旧根目录探测时将不可读或格式损坏的当前 `meta.ldb` 视为已占用，并在迁移前删除空 bootstrap 根目录，避免正确性依赖 move 覆盖既有目录。

## [3.0.0] - 2026-07-18

### 破坏性变更

- 移除公开的 `plainStorage` 导出及不受支持的包内深层导入；请改用根入口的 `db` facade 或命名 API。
- 对以 `encrypted: true` 创建的数据表，所有表操作都必须显式传入 `encrypted: true`。任何会将加密表路由到明文表面的请求现在都会 fail-closed 地被拒绝。
- 一个事务会固定使用单一安全表面。显式在加密和明文表面之间切换的操作会被拒绝，必须放到独立事务中执行。

## [2.0.2] - 2026-06-28

### 变更

- 将本地 React 开发依赖精确对齐到 `19.2.3`，匹配 Expo SDK 56 在 `expo-doctor` 中使用的依赖校验契约
- 增加 push/PR 主 CI：确定性安装、类型检查、测试、构建、Expo consumer smoke 和 npm 包内容校验
- 用新的 tag-only 发布工作流替换远端被手动禁用的旧 npm workflow，并在发布前校验 tag/包版本和 npm 认证
- 增加中英文 CI/CD 运维手册，覆盖仓库 Secret、发布顺序、远端观察和失败恢复
- Expo runtime QA 临时路径现在显式使用 Windows 或 POSIX 语义，确保平台模拟测试在 GitHub Linux runner 上保持确定性
- 干净 checkout 门禁现在会先构建 `dist/`，再运行 package export 与 built artifact 测试，并移除确定性套件中最后一个仅适用于 Windows 的分隔符断言
- Expo consumer 打包解析器现在允许 Linux npm 在 `--json` payload 前输出 lifecycle 消息
- 默认关闭自动同步，避免库导入或初始化时启动后台脏缓存定时器；需要时由宿主应用显式开启

### 修复

- 修复 npm 将 React 解析到更新 patch 版本后被 Expo SDK 56 拒绝，导致 Expo consumer smoke 失败的问题
- 让 GitHub 发布工作流在执行 `npm publish --ignore-scripts --access public --provenance` 前与文档化发布门禁保持一致
- 修复没有 `id` 或 `_id` 字段的记录在 `where` 更新、删除、批量操作和事务路径中被错误匹配的问题
- 增加 chunked 追加写恢复日志和部分 chunk 清理，确保追加失败后旧表内容仍可读取
- 修复加密表在 `encryptedFields` 为空时“写入全字段加密、读取不解密”的不一致
- 建表和写入元数据变更后立即落盘，并保留 chunked `initialData` 的真实 chunk 数
- 将元数据改为串行化可恢复发布，避免重叠 flush 丢失较晚的表更新
- 分片追加在删除恢复日志前先提交元数据，并在读取时拒绝不完整 chunk 集合
- 分片迁移保留 schema 与加密元数据，且不经过解密后重写窗口
- 提交部分失败时移除事务中新建表；显式回滚只丢弃排队操作，不重写磁盘

## [2.0.1] - 2026-06-12

### 变更

- 将正式支持的 Expo 安装契约升级到 Expo SDK 56
- 将 Expo 运行时 peer 依赖和本地开发依赖对齐到 `expo@~56.0.12`、`expo-constants@~56.0.18`、`expo-crypto@~56.0.4`、`expo-file-system@~56.0.8`、`expo-secure-store@~56.0.4`、React 19.2、React Native 0.85 和 TypeScript 6.0
- 同步更新 README、运行时 QA、包元数据和源码头信息，确保 2.0.1 / SDK 56 发布候选信息一致
- 将 `package-lock.json` 纳入发布依赖面，并在发布门禁中加入生产依赖审计和 no-high 审计检查

### 修复

- 加固分块覆盖写恢复、分块缓存失效、元数据损坏处理、单文件损坏处理和事务回滚快照等存储可靠性路径
- 加固安全行为：表名在适配器边界被拒绝，生产环境下 SecureStore 或安全随机数不可用时加密流程失败即拒绝
- 将压力测试改为默认有界且可复现，同时保留通过环境变量放大规模的能力

## [2.0.0] - 2026-04-23

### 新增

- 在根文档中正式定义 Expo SDK 54 的消费者安装契约，明确 managed-compatible 与 native flagship 两条依赖路径
- 新增加面向 Expo consumer 打包流程的 smoke 回归测试

### 变更

- 将包从 beta 阶段提升到稳定版 `2.0.0`
- 统一根 README、API 参考、运行时 QA 指南、变更日志与更新日志的开发者文档体系
- 显式声明 `babel-preset-expo` 与 `@babel/plugin-transform-modules-commonjs`，确保本地 Jest 运行可复现

### 修复

- `smoke:expo-consumer` 现在会在打包前自修复缺失的构建产物，并拒绝缺少 `dist/js`、`dist/cjs` 或 `dist/types` 的 tarball
- 发布验证链现已端到端通过：`npm run prepublishOnly`、当前全量 Jest 用例以及 `npm pack --dry-run --ignore-scripts`

## [2.0.0-beta.5] - 2026-04-04

### 新增

- AES-256-GCM 加密模式，符合 NIST SP 800-38D 与 OWASP MASVS 2026
- PBKDF2 + HKDF 两级密钥派生，默认 600,000 次迭代；派生是一次性成本，耗时取决于设备与运行时，派生结果缓存后供后续加解密复用
- 自动识别加密版本，新数据默认使用 GCM，旧数据继续兼容 CTR+HMAC
- 用于 GCM 批量加密的 `crypto-gcm.ts` 模块
- 用于共享错误定义的 `crypto-errors.ts`
- 用于加密类型定义的 `crypto-types.ts`
- 用于独立路径管理的 `PathHelper.ts`，解决循环依赖
- 用于集中环境检测的 `envUtils.ts`（在同一次发布的死代码清理中又被删除，见下文）
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
- 通过 JSON 近似法优化缓存大小计算，基准测试中观测到明显提升（幅度取决于数据分布与设备）
- 通过批处理优化索引重建，基准测试中观测到明显提升
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

- `$like` 查询：使用预编译正则，基准测试中观测到明显提升（幅度取决于数据分布）
- 缓存过期清理：改用最小堆，基准测试中观测到明显提升
- 缓存大小计算：采用 JSON 近似法，基准测试中观测到明显提升
- 索引重建：采用批处理，基准测试中观测到明显提升
- GCM 加密：密钥派生后单条记录走缓存密钥路径，具体延迟需在目标设备实测，不作跨设备保证
- 总体加密操作：基准测试中观测到明显提升（幅度取决于数据规模与运行时）

## [2.0.0-beta.4] - 2026-02-06

### 变更

- 解决高严重级别依赖审计问题
- 统一依赖范围并清理 TypeScript/ESLint 配置
- 将开发运行时日志统一为英文
- 删除冗余测试与 setup 代码

## [2.0.0-beta.3] - 2026-01-28

### 变更

- 在 Expo Go 环境下降低 PBKDF2 迭代次数
- 为原生 KDF 加速新增 `react-native-quick-crypto`
- 缓存原生模块加载，避免重复 `require`
- 从原生 PBKDF2 路径中移除 `Buffer` 依赖
- 统一处理 `ExpoCrypto.getRandomBytes` 返回类型
- 哈希输入统一使用 `TextEncoder` 编码

### 新增

- 针对 Expo Go 下迭代次数降低行为的测试

## [2.0.0-beta.2] - 2026-01-22

### 2026-01-22

#### 变更

- 从 `crypto-es` 迁移到 `@noble/ciphers` 与 `@noble/hashes`
- 简化包管理结构，统一为单个 `package.json`
- 实现 AES-256-CTR + HMAC-SHA512 加密
- 通过动态迭代调整优化 PBKDF2 密钥派生
- 新增加密 key 的 LRU 智能缓存清理策略

### 2025-12-24

#### 修复

- 修复 `ConfigManager.ts` 中的原型污染漏洞
- 新增 key 名校验，防止恶意键值修改

#### 新增

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

### 2025-12-07

#### 变更

- 提升 `README.md` 质量
- 增强功能说明
- 移除提交中的测试覆盖目录
- 修复 API 实现错误与性能问题

### 2025-12-06

#### 新增

- Wiki 文档
- 提升架构与系统稳定性

#### 修复

- 修复主入口未正确调用部分功能的问题

### 2025-12-03

#### 变更

- 优化加密字段处理，保证读写过程中的正确加解密

## [0.1.0] - 2025-11-29

### 新增

- 更新测试文件与配置
- 新增 `src/index.ts` 的默认导出
- 新增英文 README 链接

### 变更

- 将 `chunkSize` 调整为 5MB
- 更新 `README.md` 中的 MIT 许可证链接

### 2025-11-28

#### 变更

- 重构核心架构，形成完整存储引擎
- 更新文档与加密存储适配器
- 新增 API 测试
- 删除未使用文件

### 2025-11-27

#### 变更

- 为提升性能与稳定性进行代码修改

### 2025-11-26

#### 新增

- 缓存适配器接口
- 存储错误码接口
- 数据排序工具
- 数据与缓存合并工具

#### 变更

- 修复加密装饰器、文件系统适配器与分块文件处理器
- 将 `ldb.config.js` 重命名为 `liteStore.config.js`

### 2025-11-25

#### 新增

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
- 查询引擎

### 2025-11-19

#### 新增

- 加密存储适配器，基于 AES-CTR 模式

### 2025-11-17

#### 新增

- 基础项目骨架
- AES-CTR 加密支持
- 基础 `StorageAdapter` 接口

### 2025-11-15

#### 新增

- 包含项目信息的 `README.md`
- 项目初始提交
