# Expo Lite Data Store 🍃


在独立打包（APK/IPA）中自动启用 react-native-quick-crypto 原生加速以提升 KDF 性能；在 Expo Go 开发环境中自动回退到 JavaScript 实现，并在首次调用时打印一次开发提示信息。

----
[![npm version](https://img.shields.io/npm/v/expo-lite-data-store?color=%23ff5555)](https://www.npmjs.com/package/expo-lite-data-store)
[![GitHub license](https://img.shields.io/github/license/QinIndexCode/expo-lite-data-store)](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.73+-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-50.0+-blue.svg)](https://expo.dev/)

----

## ℹ️ 项目简介 / Project Introduction

**轻量、易配置、纯 TypeScript 编写的 Expo 本地数据库**

**Lightweight, easy-to-configure, pure TypeScript Expo local database**

专为 React Native + Expo 项目设计，默认纯 TypeScript 无原生依赖；在打包后的独立应用中自动启用 react-native-quick-crypto 原生加速（Expo Go 中自动回退到 JavaScript 实现）。提供完整的 CRUD 操作、事务支持、索引优化和智能排序功能。

Designed specifically for React Native + Expo projects: TypeScript-only by default; enables native acceleration via react-native-quick-crypto in standalone builds (falls back to JavaScript in Expo Go). Provides complete CRUD operations, transaction support, index optimization, and intelligent sorting features.

## 📃 文档导航 / Documentation Navigation

### 主要文档 / Main Documentation

- 📖 [中文详细文档](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.zh-CN.md)
- 📖 [English Detailed Document](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/README.en.md)



### 技术文档 / Technical Documentation

- 🏗️ [架构设计文档](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/ARCHITECTURE.zh-CN.md) | [Architecture Design Document](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/ARCHITECTURE.en.md)
- 📝 [注释规范](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/COMMENT_SPECIFICATION.zh-CN.md) | [Comment Specification](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/COMMENT_SPECIFICATION.en.md)
- 📅 [更新日志](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/updatelog.zh-CN.md) | [Update Log](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/docs/updatelog.en.md)

## 🔑 核心特性 / Core Features

| 特性 / Feature                       | 描述 / Description                                           |
| -------------------------- | ---------------------------------------------- |
| 🚀 **易配置使用** / Easy Configuration          | 支持从app.json读取配置，仅依赖 React Native FS，无需 Metro 配置 / Supports reading config from app.json, only depends on React Native FS, no Metro configuration        |
| 🔒 **可选加密** / Optional Encryption            | AES-CTR 加密，支持可选生物识别认证，推荐使用字段级加密 / AES-CTR encryption with optional biometric authentication, field-level encryption recommended         |
| 📦 **智能分块** / Intelligent Chunking            | 自动处理 >5MB 文件 / Automatically handles >5MB files        |
| 🔄 **事务支持** / Transaction Support            | 事务保证，数据一致性有保障 / Transaction support, data consistency ensured                    |
| 📝 **TypeScript 原生支持** / TypeScript Native Support | 完整的类型定义 / Complete type definitions, ready to use                       |
| 🔍 **高级查询** / Advanced Queries            | 支持 where、skip、limit、sort 等查询选项 / Supports where, skip, limit, sort and other query options       |
| 📱 **完全离线** / Fully Offline            | 无需网络，数据 100% 存储在设备本地 / No network required, 100% local data storage             |
| 🎯 **智能排序** / Intelligent Sorting            | 5种排序算法，根据数据量自动选择合适算法 / 5 sorting algorithms, automatically selects appropriate algorithm based on data size        |
| ⏰ **自动同步** / Auto-synchronization            | 定期将缓存中的脏数据同步到磁盘 / Regularly synchronizes dirty data from cache to disk, ensuring data persistence |

## 📜 许可证 / License

[MIT](https://github.com/QinIndexCode/expo-lite-data-store/blob/main/LICENSE.txt) © QinIndexCode

---

## ✨ 贡献者 / Contributors

感谢所有贡献者！/ Thanks to all contributors! 
(按照贡献量排序 / Sorted by contribution quantity)

<a href="https://github.com/QinIndexCode/expo-lite-data-store/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=QinIndexCode/expo-lite-data-store&s=200&columns=12" />
</a>

欢迎更多开发者加入，一起完善项目！/Welcome more developers to join and improve the project! 🚀
---
喜欢的话别忘了点个 ⭐ Star，让更多人发现这个项目！

If you like it, don't forget to give it a ⭐ Star to let more people discover this project!
