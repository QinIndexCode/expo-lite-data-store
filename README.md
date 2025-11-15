
# expo-litedataStore

**Lightweight, zero-config local storage for Expo apps**
**超轻量、零配置的 Expo 本地存储**

npx expo install expo-litedataStore

Simple JSON-based storage using `expo-file-system` + encrypted storage with `expo-secure-store`. No SQL, no native code — works in **Expo Go**.

使用 `expo-file-system` 的简易 JSON 存储 + `expo-secure-store` 加密存储。无 SQL、无原生代码，**Expo Go 完美运行**。

### Usage | 使用

```ts
import { liteDataStore } from 'expo-litedataStore';

// Save data / 保存数据
await liteDataStore.set('user', { name: 'Alice' });

// Load data / 读取数据
const user = await liteDataStore.get('user');

// Secure storage / 加密存储
await liteDataStore.secure.set('token', 'abc123');
const token = await liteDataStore.secure.get('token');
```

### Features | 特性
- < 3 KB bundle size  
  体积 < 3 KB  
- Zero config, auto-initialized  
  零配置，自动初始化  
- TypeScript ready  
  完整 TypeScript 支持  
- 100% local, privacy-first  
  100% 本地，隐私优先  


npx expo install expo-liteDataStore

*Simple. Fast. Local.*
```
