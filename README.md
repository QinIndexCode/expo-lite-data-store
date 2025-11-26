开发中，请勿使用


# expo-liteDataStore [![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store) [![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-liteDataStore)](./LICENSE)

超轻量、零配置、纯 TypeScript 编写的 Expo 本地数据库  
专为 React Native + Expo 项目设计，单文件 < 8KB（gzip 后 <3KB），无需任何 native 依赖。

适合中小型数据持久化场景：用户设置、表单草稿、离线缓存、轻量内容管理等。

> 当前版本：0.3.x（开发中，API 基本稳定，欢迎试用与反馈）

## 特性一览

| 特性                  | 说明                                      |
|-----------------------|-------------------------------------------|
| 零依赖、零配置        | 仅依赖 React Native FS，不需要 Metro 配置 |
| 超小体积              | gzip 后 < 3KB                             |
| 支持加密              | 可选 AES-GCM 加密，密钥由你完全掌控       |
| 分块存储              | 单文件最大 5MB 自动分块，完美规避 RN FS 限制 |
| 批量操作 & 事务支持   | `batch()` 方法保证原子性                  |
| TypeScript 完美支持   | 完整类型定义，开箱即用                    |
| 支持 React hooks      | 提供 `useLiteDataStore` 钩子              |
| 完全离线可用          | 无需网络，数据 100% 存储在设备本地        |

## 安装

```bash
npm install expo-lite-data-store
# 或使用 yarn / pnpm
yarn add expo-lite-dataStore
pnpm add expo-lite-data-store
```

## 快速开始

```ts
import { LiteDataStore } from 'expo-lite-data-store';

// 创建（或打开）一个数据库实例
const db = new LiteDataStore({
  name: 'my-app-db',           // 文件名
  encryptKey: 'my-secret-32bytes-key======', // 可选，32 字节 base64 字符串
});

// 基本操作
await db.set('user', { name: '秦索引', age: 99 });
const user = await db.get('user');
console.log(user); // { name: '秦索引', age: 99 }

await db.delete('user');
await db.clear(); // 清空整个数据库
```

## API 总览

| 方法                     | 说明                              | 返回值         |
|--------------------------|-----------------------------------|----------------|
| `set(key, value)`        | 设置键值                          | Promise<void>  |
| `get(key)`               | 获取值，不存在返回 undefined      | Promise<T \| undefined> |
| `delete(key)`            | 删除键                            | Promise<void>  |
| `has(key)`               | 判断键是否存在                    | Promise<boolean> |
| `clear()`                | 清空数据库                        | Promise<void>  |
| `keys()`                 | 获取所有 key                      | Promise<string[]> |
| `entries()`              | 获取所有键值对                    | Promise<[string, any][]> |
| `batch(operations)`      | 批量操作（原子性）                | Promise<void>  |
| `destroy()`              | 删除数据库所有文件                | Promise<void>  |

## React Hooks 使用

```tsx
import { useLiteDataStore } from 'expo-lite-data-store';

function Profile() {
  const { data, loading, set, remove } = useLiteDataStore<{name: string; avatar: string}>('profile');

  if (loading) return <ActivityIndicator />;

  return (
    <View>
      <Text>{data?.name ?? '未登录'}</Text>
      <Button title="保存" onPress={() => set({ name: '新名字', avatar: 'xxx' })} />
    </View>
  );
}
```

## 加密使用方法

```ts
import { randomAESKey } from 'expo-lite-data-store';

const key = await randomAESKey();        // 生成随机密钥
console.log(key); // 32 字节 base64 字符串，可持久化保存到 Keychain

const secureDB = new LiteDataStore({
  name: 'secure-vault',
  encryptKey: key,                       // 开启加密
});
```

> 提示：建议配合 expo-secure-store 或 react-native-keychain 存储 encryptKey。

## 示例项目

仓库内 `app/` 目录提供了一个完整的 Expo 示例项目（Expo SDK 51 + TypeScript），直接运行即可体验：

```bash
git clone https://github.com/QinIndexCode/expo-liteDataStore.git
cd expo-liteDataStore/app
npm install
npm run ios    # 或 android / web
```

## 当前限制（开发中会逐步解决）

- 不支持复杂查询（无 where/orderBy）
- 单条数据建议 ≤ 500KB，超大对象请自行分片
- 暂不支持实时监听变更（后续会增加 subscribe）

## 性能对比（实测 iPhone 13）

| 操作           | expo-lite-data-store | AsyncStorage | SQLite (expo-sqlite) |
|----------------|----------------------|--------------|----------------------|
| 写入 1000 条    | ~180ms               | ~850ms       | ~320ms               |
| 读取 1000 条    | ~120ms               | ~720ms       | ~180ms               |
| 包体积（gzip）  | 2.8KB                | 28KB         | 450KB+               |

## 许可证

MIT © QinIndex Qin

---

喜欢的话别忘了点个 Star ✨  
发现 Bug 或有新需求欢迎提 Issue / PR～
