/**
 * 加密工具模块
 * 2025 年 11 月 17 日 Expo SDK 54 合规版（AES-256-CTR + HMAC-SHA512 模拟 GCM）
 * 2025-11-17 Expo SDK 54 compliant version (AES-256-CTR + HMAC-SHA512 emulates GCM)
 * 依赖：expo-crypto (随机) + crypto-js (加密 + HMAC)
 * Dependencies: expo-crypto (randomness) + crypto-js (encryption & HMAC)
 */
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import config from "../liteStore.config.js";

/**
 * 加密错误类
 * 用于处理加密相关的错误
 */
export class CryptoError extends Error {
    /**
     * 构造函数
     * @param message 错误消息
     * @param code 错误代码
     * @param error 原始错误对象（可选）
     */
    constructor(
        message: string,
        public code: "ENCRYPT_FAILED" | "DECRYPT_FAILED" | "KEY_DERIVE_FAILED" | "HMAC_MISMATCH" | "HASH_FAILED" | "VERIFY_FAILED",
        error?: unknown
    ) {
        super(message);
        this.name = "CryptoError";
        if (error) {
            this.message += `:\n${error}`;
        }
    }
}



/**
 * AES加密负载接口
 */
interface EncryptedPayload {
    salt: string; // Base64编码的盐值
    iv: string;   // Base64编码的初始化向量
    ciphertext: string; // Base64编码的密文
    hmac: string; // HMAC-SHA512（Base64，模拟GCM标签）
}

/**
 * 主密钥别名
 */
const MASTER_KEY_ALIAS = "expo_litedb_master_key_v2025";

/**
 * 密钥派生迭代次数
 * 2025 HK推荐值（防暴力破解）
 * 从配置文件读取，确保一致性
 */
const getIterations = (): number => {
    // 使用配置中的迭代次数
    const iterations = config.encryption.keyIterations;
    // 确保迭代次数在安全范围内
    return Math.max(10000, Math.min(iterations, 1000000)); // 限制在10000-1000000之间
};

/**
 * 密钥大小（256位）
 */
const KEY_SIZE = 256 / 32;

/**
 * 智能密钥缓存 - LRU缓存机制，避免内存溢出
 */
interface CachedKeyEntry {
    aesKey: CryptoJS.lib.WordArray;
    hmacKey: CryptoJS.lib.WordArray;
    accessCount: number;
    lastAccessTime: number;
    createdAt: number;
}

class SmartKeyCache {
    private cache = new Map<string, CachedKeyEntry>();
    private maxSize: number;
    private maxAge: number; // 最大缓存时间（毫秒）

    constructor(maxSize = 100, maxAge = 30 * 60 * 1000) { // 默认30分钟
        this.maxSize = maxSize;
        this.maxAge = maxAge;
    }

    set(key: string, value: CachedKeyEntry): void {
        // 如果缓存已满，移除最少使用的条目
        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }

        this.cache.set(key, value);
    }

    get(key: string): CachedKeyEntry | undefined {
        const entry = this.cache.get(key);
        if (entry) {
            // 更新访问统计
            entry.accessCount++;
            entry.lastAccessTime = Date.now();
            return entry;
        }
        return undefined;
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    // 清理过期条目
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.createdAt > this.maxAge) {
                this.cache.delete(key);
            }
        }
    }

    // 移除最少使用的条目
    private evictLRU(): void {
        let lruKey: string | undefined;
        let lruScore = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            // 评分 = 访问频率 * (当前时间 - 最后访问时间)
            const score = entry.accessCount * (Date.now() - entry.lastAccessTime);
            if (score < lruScore) {
                lruScore = score;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
        }
    }

    size(): number {
        return this.cache.size;
    }
}

const keyCache = new SmartKeyCache(50, 30 * 60 * 1000); // 50个条目，30分钟过期

/**
 * 清除密钥缓存（用于登出或重置）
 */
export const clearKeyCache = (): void => {
    keyCache.clear();
};

/**
 * 密钥缓存自动清理间隔（10分钟）
 */
const KEY_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

// 保存定时器 ID - 兼容 Node.js 和浏览器环境
// Node.js 中 setInterval 返回 number，浏览器中返回 Timeout 对象
let keyCacheCleanupTimer: number | NodeJS.Timeout | undefined;

/**
 * 初始化密钥缓存自动清理
 */
const initializeKeyCacheCleanup = (): void => {
    // 定期清理过期密钥缓存（10分钟一次）
    keyCacheCleanupTimer = setInterval(() => {
        keyCache.cleanup();
    }, KEY_CACHE_CLEANUP_INTERVAL);

    // 页面卸载时清理缓存
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', clearKeyCache);
    }
};

/**
 * 停止密钥缓存清理定时器
 */
export const stopKeyCacheCleanup = (): void => {
    // 清除定时器
    if (keyCacheCleanupTimer) {
        clearInterval(keyCacheCleanupTimer);
        keyCacheCleanupTimer = undefined;
    }

    // 清除页面卸载事件监听器
    if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', clearKeyCache);
    }
};

// 初始化时启动自动清理
initializeKeyCacheCleanup();

/**
 * 从masterKey + salt派生AES + HMAC密钥（PBKDF2 + SHA512）
 * @param masterKey 主密钥
 * @param salt 盐值
 * @returns Promise<{ aesKey: CryptoJS.lib.WordArray; hmacKey: CryptoJS.lib.WordArray }> 派生的AES密钥和HMAC密钥
 */
const deriveKey = async (
    masterKey: string,
    salt: Uint8Array
): Promise<{ aesKey: CryptoJS.lib.WordArray; hmacKey: CryptoJS.lib.WordArray }> => {
    try {
        // 生成缓存键 - 使用masterKey的哈希值以提高缓存命中率和安全性
        const saltStr = CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(salt));
        // 使用SHA-256哈希masterKey，确保相同的masterKey生成相同的缓存键
        // 同时避免直接暴露masterKey的任何部分
        const masterKeyHash = CryptoJS.SHA256(masterKey).toString(CryptoJS.enc.Hex).substring(0, 16);
        const cacheKey = `${masterKeyHash}_${saltStr}_${config.encryption.keyIterations}`;

        // 检查智能缓存
        const cachedEntry = keyCache.get(cacheKey);
        if (cachedEntry) {
            return {
                aesKey: cachedEntry.aesKey,
                hmacKey: cachedEntry.hmacKey
            };
        }

        // 获取当前环境的迭代次数
        const iterations = getIterations();

        // 优化：使用SHA-256进行PBKDF2，在安全性和性能之间取得平衡
        // SHA-256比SHA-512更快，且对于PBKDF2来说安全性仍然足够
        // 我们将派生的密钥分为两部分：前半部分用于AES加密，后半部分用于HMAC校验
        const derived = CryptoJS.PBKDF2(masterKey, CryptoJS.lib.WordArray.create(salt), {
            keySize: KEY_SIZE * 2, // 双倍大小（前半AES，后半HMAC）
            iterations: iterations,
            hasher: CryptoJS.algo.SHA256, // 使用SHA-256提高性能，安全性仍然足够
        });

        // 优化：直接分割，避免不必要的克隆操作
        const halfSize = KEY_SIZE; // 字数 (words)
        const halfSigBytes = halfSize * 4; // 字节数

        const result = {
            aesKey: CryptoJS.lib.WordArray.create(
                derived.words.slice(0, halfSize),
                halfSigBytes
            ),
            hmacKey: CryptoJS.lib.WordArray.create(
                derived.words.slice(halfSize),
                halfSigBytes
            ),
        };

        // 使用智能缓存
        keyCache.set(cacheKey, {
            aesKey: result.aesKey,
            hmacKey: result.hmacKey,
            accessCount: 1,
            lastAccessTime: Date.now(),
            createdAt: Date.now()
        });

        return result;
    } catch (error) {
        throw new CryptoError(
            `Key derivation failed with iterations=${getIterations()} and keySize=${KEY_SIZE * 2}`,
            "KEY_DERIVE_FAILED",
            error
        );
    }
};

/**
 * 加密文本
 * @param plainText 要加密的明文
 * @param masterKey 主密钥
 * @returns Promise<string> 加密后的文本（Base64编码）
 */
export const encrypt = async (
    plainText: string,
    masterKey: string
): Promise<string> => {
    try {
        // 随机salt和iv
        const saltBytes = Crypto.getRandomBytes(16);
        const ivBytes = Crypto.getRandomBytes(16); // CTR用16字节IV

        // 派生密钥
        // Derive keys
        const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);

        // AES-CTR 加密
        // AES-CTR encryption
        const encrypted = CryptoJS.AES.encrypt(plainText, aesKey, {
            iv: CryptoJS.lib.WordArray.create(ivBytes),
            mode: CryptoJS.mode.CTR, // CTR 模式（内置，支持） // CTR mode (built-in, supported)
            padding: CryptoJS.pad.NoPadding,
        });

        // 将密文转换为 Base64 字符串
        // Convert ciphertext to Base64 string
        const ciphertextBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);

        // HMAC 校验（模拟 GCM tag）- 使用配置中的HMAC算法
        // HMAC for integrity (emulates GCM tag)
        // 使用 Base64 字符串计算 HMAC，确保与解密时一致
        // Use Base64 string to calculate HMAC, ensure consistency with decryption
        const hmac = config.encryption.hmacAlgorithm === 'SHA-512' ?
            CryptoJS.HmacSHA512(ciphertextBase64, hmacKey) :
            CryptoJS.HmacSHA256(ciphertextBase64, hmacKey);

        // 组装 payload（Base64 安全存储）
        // Assemble payload (Base64 for safe storage)
        const payload: EncryptedPayload = {
            salt: CryptoJS.enc.Base64.stringify(
                CryptoJS.lib.WordArray.create(saltBytes)
            ),
            iv: CryptoJS.enc.Base64.stringify(
                CryptoJS.lib.WordArray.create(ivBytes)
            ),
            ciphertext: ciphertextBase64,
            hmac: hmac.toString(CryptoJS.enc.Base64),
        };

        return CryptoJS.enc.Base64.stringify(
            CryptoJS.enc.Utf8.parse(JSON.stringify(payload))
        );
    } catch (error) {
        throw new CryptoError("Encryption failed", "ENCRYPT_FAILED", error);
    }
};

// 解密
// Decrypt
export const decrypt = async (
    encryptedBase64: string,
    masterKey: string
): Promise<string> => {
    try {
        // 解析 payload
        // Parse payload
        const payloadStr = CryptoJS.enc.Utf8.stringify(
            CryptoJS.enc.Base64.parse(encryptedBase64)
        );
        const payload: EncryptedPayload = JSON.parse(payloadStr);

        // 优化：简化盐值转换，避免多次转换
        const saltUint8Array = new Uint8Array(
            Array.from(CryptoJS.enc.Base64.parse(payload.salt).words)
                .flatMap(word => [
                    (word >> 24) & 0xff,
                    (word >> 16) & 0xff,
                    (word >> 8) & 0xff,
                    word & 0xff
                ])
                .slice(0, 16) // 确保只有16字节
        );

        const iv = CryptoJS.enc.Base64.parse(payload.iv);

        // 派生密钥
        // Derive keys
        const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

        // 先 HMAC 校验（防篡改）- 使用配置中的HMAC算法
        // Verify HMAC first (tamper detection)
        const computedHmac = config.encryption.hmacAlgorithm === 'SHA-512' ?
            CryptoJS.HmacSHA512(payload.ciphertext, hmacKey) :
            CryptoJS.HmacSHA256(payload.ciphertext, hmacKey);
        // 修复：用 toString(CryptoJS.enc.Base64) 比较（与加密时一致的格式）
        // Fix: compare with toString(CryptoJS.enc.Base64) for consistent format with encryption
        if (computedHmac.toString(CryptoJS.enc.Base64) !== payload.hmac) {
            throw new CryptoError(
                "HMAC mismatch: data tampered or wrong key",
                "HMAC_MISMATCH"
            );
        }

        // AES-CTR 解密
        // AES-CTR decryption
        const decrypted = CryptoJS.AES.decrypt(
            payload.ciphertext,
            aesKey,
            {
                iv,
                mode: CryptoJS.mode.CTR,
                padding: CryptoJS.pad.NoPadding,
            }
        );

        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        throw new CryptoError(
            "Decryption failed (wrong key or corrupted data)",
            "DECRYPT_FAILED",
            error
        );
    }
};

// 获取主密钥（SecureStore + 生物识别）
// Get master key (SecureStore + biometrics)
export const getMasterKey = async (): Promise<string> => {
    let key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS, {
        requireAuthentication: true,
        authenticationPrompt: "验证身份访问数据库", // Authenticate to access database
    });

    if (!key) {
        key = await generateMasterKey();
        await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
            requireAuthentication: true,
            authenticationPrompt: "设置加密密钥", // Set encryption key
        });
    }

    return key;
};

// resetMasterKey 重置主密钥（登出/重置用）
// Reset master key (for logout/reset)
export const resetMasterKey = async (): Promise<void> => {
    await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS);
    // 清除密钥缓存
    clearKeyCache();
};

/**
 * 生成主密钥（32 字节随机）
 * @returns 主密钥
 */
export const generateMasterKey = async (): Promise<string> => {
    const bytes = Crypto.getRandomBytes(32);
    return CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(bytes));
};



// ==================== bcrypt 密码哈希功能 ====================

/**
 * 生成密码哈希
 * @param password 原始密码
 * @param saltRounds 盐值轮数（默认12轮）
 * @returns 密码哈希
 */
export const hashPassword = async (password: string, saltRounds: number = 12): Promise<string> => {
    try {
        return await bcrypt.hash(password, saltRounds);
    } catch (error) {
        throw new CryptoError(
            "Password hashing failed",
            "HASH_FAILED",
            error
        );
    }
};

/**
 * 验证密码哈希
 * @param password 原始密码
 * @param hash 密码哈希
 * @returns 是否匹配
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
    try {
        return await bcrypt.compare(password, hash);
    } catch (error) {
        throw new CryptoError(
            "Password verification failed",
            "VERIFY_FAILED",
            error
        );
    }
};

/**
 * 生成随机盐值
 * @param rounds 盐值轮数
 * @returns 随机盐值
 */
export const generateSalt = async (rounds: number = 12): Promise<string> => {
    try {
        return await bcrypt.genSalt(rounds);
    } catch (error) {
        throw new CryptoError(
            "Salt generation failed",
            "HASH_FAILED",
            error
        );
    }
};

/**
 * 批量加密接口
 */
interface BulkEncryptionResult {
    encryptedData: string;
    salt: string;
    iv: string;
    hmac: string;
}

/**
 * 批量加密多个文本（重用密钥派生）
 * @param plainTexts 要加密的明文数组
 * @param masterKey 主密钥
 * @returns Promise<string[]> 加密后的文本数组
 */
export const encryptBulk = async (
    plainTexts: string[],
    masterKey: string
): Promise<string[]> => {
    if (plainTexts.length === 0) return [];

    try {
        // 为批量操作生成一次salt和iv
        const saltBytes = Crypto.getRandomBytes(16);
        const ivBytes = Crypto.getRandomBytes(16);

        // 一次派生密钥（重用）
        const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);

        // 批量加密所有文本
        const encryptedResults: BulkEncryptionResult[] = [];

        for (const plainText of plainTexts) {
            // AES-CTR 加密
            const encrypted = CryptoJS.AES.encrypt(plainText, aesKey, {
                iv: CryptoJS.lib.WordArray.create(ivBytes),
                mode: CryptoJS.mode.CTR,
                padding: CryptoJS.pad.NoPadding,
            });

            const ciphertextBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);

            // HMAC 校验 - 使用配置中的HMAC算法
            const hmac = config.encryption.hmacAlgorithm === 'SHA-512' ?
                CryptoJS.HmacSHA512(ciphertextBase64, hmacKey) :
                CryptoJS.HmacSHA256(ciphertextBase64, hmacKey);

            encryptedResults.push({
                encryptedData: ciphertextBase64,
                salt: CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(saltBytes)),
                iv: CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(ivBytes)),
                hmac: hmac.toString(CryptoJS.enc.Base64),
            });
        }

        // 组装最终结果
        return encryptedResults.map(result => {
            const payload: EncryptedPayload = {
                salt: result.salt,
                iv: result.iv,
                ciphertext: result.encryptedData,
                hmac: result.hmac,
            };

            return CryptoJS.enc.Base64.stringify(
                CryptoJS.enc.Utf8.parse(JSON.stringify(payload))
            );
        });

    } catch (error) {
        throw new CryptoError("Bulk encryption failed", "ENCRYPT_FAILED", error);
    }
};

/**
 * 批量解密多个文本
 * @param encryptedTexts 要解密的密文数组
 * @param masterKey 主密钥
 * @returns Promise<string[]> 解密后的明文数组
 */
export const decryptBulk = async (
    encryptedTexts: string[],
    masterKey: string
): Promise<string[]> => {
    if (encryptedTexts.length === 0) return [];

    try {
        // 可以并行处理解密操作
        const decryptPromises = encryptedTexts.map(async (encryptedText) => {
            // 解析 payload
            const payloadStr = CryptoJS.enc.Utf8.stringify(
                CryptoJS.enc.Base64.parse(encryptedText)
            );
            const payload: EncryptedPayload = JSON.parse(payloadStr);

            // 优化：转换salt和iv
            const saltUint8Array = new Uint8Array(
                Array.from(CryptoJS.enc.Base64.parse(payload.salt).words)
                    .flatMap(word => [
                        (word >> 24) & 0xff,
                        (word >> 16) & 0xff,
                        (word >> 8) & 0xff,
                        word & 0xff
                    ])
                    .slice(0, 16)
            );

            const iv = CryptoJS.enc.Base64.parse(payload.iv);

            // 派生密钥（会从缓存中获取）
            const { aesKey, hmacKey } = await deriveKey(masterKey, saltUint8Array);

            // HMAC 校验 - 使用配置中的HMAC算法
            const computedHmac = config.encryption.hmacAlgorithm === 'SHA-512' ?
                CryptoJS.HmacSHA512(payload.ciphertext, hmacKey) :
                CryptoJS.HmacSHA256(payload.ciphertext, hmacKey);
            if (computedHmac.toString(CryptoJS.enc.Base64) !== payload.hmac) {
                throw new CryptoError(
                    "HMAC mismatch: data tampered or wrong key",
                    "HMAC_MISMATCH"
                );
            }

            // AES-CTR 解密
            const decrypted = CryptoJS.AES.decrypt(
                payload.ciphertext,
                aesKey,
                {
                    iv,
                    mode: CryptoJS.mode.CTR,
                    padding: CryptoJS.pad.NoPadding,
                }
            );

            return decrypted.toString(CryptoJS.enc.Utf8);
        });

        // 并行执行所有解密操作
        return await Promise.all(decryptPromises);

    } catch (error) {
        throw new CryptoError("Bulk decryption failed", "DECRYPT_FAILED", error);
    }
};

// ==================== 通用哈希功能 ====================

/**
 * 生成数据哈希
 * @param data 要哈希的数据
 * @param algorithm 哈希算法（默认SHA-512）
 * @returns 哈希值
 */
export const generateHash = async (data: string, algorithm: "SHA-256" | "SHA-512" = "SHA-512"): Promise<string> => {
    try {
        switch (algorithm) {
            case "SHA-256":
                return await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.SHA256,
                    data
                );
            case "SHA-512":
                return await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.SHA512,
                    data
                );
            default:
                throw new CryptoError(
                    `Unsupported hash algorithm: ${algorithm}`,
                    "HASH_FAILED"
                );
        }
    } catch (error) {
        throw new CryptoError(
            "Hash generation failed",
            "HASH_FAILED",
            error
        );
    }
};

/**
 * 字段级加密配置
 */

interface FieldEncryptionConfig {
    [x: string]: any;
    fields: string[]; // 需要加密的字段列表
    masterKey: string; // 主密钥（32字节）
    encryption ?:{
        hmacAlgorithm?: "SHA-256" | "SHA-512";
        encryptionAlgorithm?: "AES-CTR";
        keySize?: 256; // 密钥大小（256位）
    }
}

/**
 * 字段级加密
 * @param data 要加密的对象
 * @param config 加密配置
 * @returns Promise<Record<string, any>> 字段级加密后的对象
 */
export const encryptFields = async (
    data: Record<string, any>,
    fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>> => {
    const result = { ...data };

    const promises = fieldConfig.fields.map(async (field) => {
        if (result[field] === undefined || result[field] === null) return;

        const valueToEncrypt = typeof result[field] === 'string'
            ? result[field]                    // 字符串直接加密（不加引号）
            : JSON.stringify(result[field]);   // 对象、数字等才序列化

        result[field] = await encrypt(valueToEncrypt, fieldConfig.masterKey);
    });

    await Promise.all(promises);
    return result;
};
/**
 * 字段级解密
 * @param data 要解密的对象
 * @param config 解密配置
 * @returns Promise<Record<string, any>> 字段级解密后的对象
 */
export const decryptFields = async (
    data: Record<string, any>,
    fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>> => {
    const result = { ...data };
    const fieldsToDecrypt = fieldConfig.fields.filter(field => 
        result[field] !== undefined && result[field] !== null && typeof result[field] === 'string'
    );

    if (fieldsToDecrypt.length === 0) return result;

    // 1. 批量处理所有加密字段
    const decryptPromises = fieldsToDecrypt.map(async (field) => {
        try {
            const encryptedValue = result[field] as string;
            
            // 2. 使用现有的解密函数（它会利用缓存）
            const decryptedStr = await decrypt(encryptedValue, fieldConfig.masterKey);
            
            // 3. 类型恢复逻辑保持不变
            if (/^[\{\[]/.test(decryptedStr.trim())) {
                result[field] = JSON.parse(decryptedStr);
            } else {
                const trimmed = decryptedStr.trim();
                if (/^true$/i.test(trimmed)) result[field] = true;
                else if (/^false$/i.test(trimmed)) result[field] = false;
                else if (/^null$/i.test(trimmed)) result[field] = null;
                else if (/^[-+]?\d*\.?\d+([eE][-+]?\d+)?$/.test(trimmed) && !trimmed.startsWith('+0')) {
                    if (decryptedStr.includes('+') && !decryptedStr.startsWith('+0')) {
                        result[field] = decryptedStr;
                    } else {
                        result[field] = Number(decryptedStr);
                    }
                } else {
                    result[field] = decryptedStr;
                }
            }
        } catch (error) {
            console.warn(`字段 ${field} 解密失败:`, error);
            // 保留原始加密值，不抛出错误
        }
    });

    await Promise.all(decryptPromises);
    return result;
};
/**
 * 批量字段级加密
 * @param dataArray 要加密的对象数组
 * @param fieldConfig 加密配置
 * @returns Promise<Record<string, any>[]> 批量字段级加密后的对象数组
 */
export const encryptFieldsBulk = async (
    dataArray: Record<string, any>[],
    fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>[]> => {
    if (dataArray.length === 0) return dataArray;

    // 为所有字段收集需要加密的值
    const fieldValues: { [field: string]: string[] } = {};

    fieldConfig.fields.forEach(field => {
        fieldValues[field] = dataArray
            .map(item => item[field])
            .filter(value => value !== undefined && value !== null)
            .map(value => JSON.stringify(value));
    });

    // 批量加密每个字段的值
    const encryptionPromises: Promise<void>[] = [];
    const encryptedValues: { [field: string]: string[] } = {};

    for (const [field, values] of Object.entries(fieldValues)) {
        encryptionPromises.push(
            encryptBulk(values, fieldConfig.masterKey).then(encrypted => {
                encryptedValues[field] = encrypted;
            })
        );
    }

    await Promise.all(encryptionPromises);

    // 重建结果数组
    return dataArray.map((item, index) => {
        const result = { ...item };

        fieldConfig.fields.forEach(field => {
            if (item[field] !== undefined && item[field] !== null) {
                const fieldIndex = dataArray.slice(0, index + 1)
                    .filter(i => i[field] !== undefined && i[field] !== null)
                    .length - 1;

                if (encryptedValues[field] && encryptedValues[field][fieldIndex]) {
                    result[field] = encryptedValues[field][fieldIndex];
                }
            }
        });

        return result;
    });
};

/**
 * 批量字段级解密
 * @param dataArray 要解密的对象数组
 * @param config 解密配置
 * @returns Promise<Record<string, any>[]> 批量字段级解密后的对象数组
 */
export const decryptFieldsBulk = async (
    dataArray: Record<string, any>[],
    fieldConfig: FieldEncryptionConfig
): Promise<Record<string, any>[]> => {
    if (dataArray.length === 0) return dataArray;

    // 为所有字段收集需要解密的值
    const fieldValues: { [field: string]: string[] } = {};

    fieldConfig.fields.forEach(field => {
        fieldValues[field] = dataArray
            .map(item => item[field])
            .filter(value => value !== undefined && value !== null && typeof value === 'string');
    });

    // 批量解密每个字段的值
    const decryptionPromises: Promise<void>[] = [];
    const decryptedValues: { [field: string]: any[] } = {};

    for (const [field, values] of Object.entries(fieldValues)) {
        decryptionPromises.push(
            decryptBulk(values, fieldConfig.masterKey).then(decrypted => {
                decryptedValues[field] = decrypted.map(val => {
                    try {
                        return JSON.parse(val);
                    } catch {
                        return val; // 如果不是JSON，保持原值
                    }
                });
            })
        );
    }

    await Promise.all(decryptionPromises);

    // 重建结果数组
    return dataArray.map((item, index) => {
        const result = { ...item };

        fieldConfig.fields.forEach(field => {
            if (item[field] !== undefined && item[field] !== null && typeof item[field] === 'string') {
                const fieldIndex = dataArray.slice(0, index + 1)
                    .filter(i => i[field] !== undefined && i[field] !== null && typeof i[field] === 'string')
                    .length - 1;

                if (decryptedValues[field] && decryptedValues[field][fieldIndex] !== undefined) {
                    result[field] = decryptedValues[field][fieldIndex];
                }
            }
        });

        return result;
    });
};