# TODO List

## 加密性能优化

### 问题描述
当前PBKDF2密钥派生在移动设备上仍然较慢，每次加密需要3-4秒（5000次迭代）。

### 性能数据
- PBKDF2密钥派生时间：3-4秒（5000次迭代）
- 加密数据集成测试耗时：约13秒（包含2次密钥派生）

### 优化方向

#### 1. 进一步降低迭代次数（弃用）
- 当前：5000次迭代
- 建议：降低到1000-2000次迭代
- 预期效果：每次加密时间降低到0.5-1秒
- 安全性影响：仍然提供足够的安全性

#### 2. 使用Web Crypto API
- 在支持的浏览器环境中使用原生加密API
- 预期效果：显著提高加密性能
- 兼容性：需要检测环境支持情况

#### 3. 硬件加速
- 利用移动设备的硬件加密能力
- 预期效果：大幅提高加密性能
- 实现难度：需要平台特定代码

#### 4. 异步密钥派生
- 避免阻塞主线程
- 预期效果：改善用户体验
- 实现方式：使用Web Workers或后台线程

#### 5. 密钥缓存优化
- 当前已实现密钥缓存，但可以进一步优化
- 预期效果：减少重复密钥派生
- 实现方式：增加缓存大小，优化缓存策略

### 优先级
- 高优先级：进一步降低迭代次数（快速见效）
- 中优先级：使用Web Crypto API（需要环境检测）
- 低优先级：硬件加速、异步密钥派生（需要更多开发工作）

### 参考资料
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [Expo Secure Store](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [PBKDF2性能优化](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

### 更新日期
2026-01-25

---

## 其他待办事项

### 1. 移除DEBUG输出
- 移除EncryptedStorageAdapter.ts中的DEBUG输出
- 移除crypto.ts中的DEBUG输出
- 只保留必要的错误日志

### 2. 优化查询性能
- 进一步优化索引查询性能
- 优化复杂查询（如$and、$or操作符）

### 3. 添加更多测试用例
- 添加边界条件测试
- 添加性能测试
- 添加安全测试