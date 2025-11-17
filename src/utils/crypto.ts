// src/utils/crypto.ts
// 2025 年 11 月 17 日 Expo SDK 54 合规版（AES-256-CTR + HMAC-SHA512 模拟 GCM）
// 依赖：expo-crypto (随机) + crypto-js (加密 + HMAC)

// 类型定义
export class CryptoError extends Error {
    constructor(
        message: string,
        public code: "ENCRYPT_FAILED" | "DECRYPT_FAILED" | "KEY_DERIVE_FAILED" | "HMAC_MISMATCH",
        error?: unknown
    ) {
        super(message);
        this.name = "CryptoError";
        if (error) {
            this.message += `:\n${error}`;
        }
    }
}

interface EncryptedPayload {
    salt: string; // Base64
    iv: string;   // Base64
    ciphertext: string; // Base64
    hmac: string; // HMAC-SHA512 (Base64，模拟 GCM tag)
}

// 导入
import * as Crypto from "expo-crypto";
import CryptoJS from "crypto-js";
import * as SecureStore from "expo-secure-store";

const MASTER_KEY_ALIAS = "expo_litedb_master_key_v2025";
const ITERATIONS = 100000; // 2025 HK 推荐（防暴力破解）
const KEY_SIZE = 256 / 32; // 256 bits

// 生成主密钥（32 字节随机）
const generateMasterKey = async (): Promise<string> => {
    const bytes = Crypto.getRandomBytes(32);
    return CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create(bytes));
};

// 从 masterKey + salt 派生 AES + HMAC 密钥（PBKDF2 + SHA512）
const deriveKey = async (
    masterKey: string,
    salt: Uint8Array
): Promise<{ aesKey: CryptoJS.lib.WordArray; hmacKey: CryptoJS.lib.WordArray }> => {
    try {
        const derived = CryptoJS.PBKDF2(masterKey, CryptoJS.lib.WordArray.create(salt), {
            keySize: KEY_SIZE * 2, // 双倍大小（前半 AES，后半 HMAC）
            iterations: ITERATIONS,
            hasher: CryptoJS.algo.SHA512, // 更强哈希
        });

        // 修复：clone 后 clamp (in-place)，然后 slice words 创建子 WordArray
        const clonedDerived = derived.clone();
        clonedDerived.clamp(); // in-place 操作

        const halfSize = KEY_SIZE; // 字数 (words)
        const halfSigBytes = halfSize * 4; // 字节数

        return {
            aesKey: CryptoJS.lib.WordArray.create(
                clonedDerived.words.slice(0, halfSize),
                halfSigBytes
            ),
            hmacKey: CryptoJS.lib.WordArray.create(
                clonedDerived.words.slice(halfSize),
                halfSigBytes
            ),
        };
    } catch (error) {
        throw new CryptoError(
            "Key derivation failed",
            "KEY_DERIVE_FAILED",
            error
        );
    }
};

// 加密
export const encrypt = async (
    plainText: string,
    masterKey: string
): Promise<string> => {
    try {
        // 随机 salt 和 iv
        const saltBytes = Crypto.getRandomBytes(16);
        const ivBytes = Crypto.getRandomBytes(16); // CTR 用 16 字节 IV

        // 派生密钥
        const { aesKey, hmacKey } = await deriveKey(masterKey, saltBytes);

        // AES-CTR 加密
        const encrypted = CryptoJS.AES.encrypt(plainText, aesKey, {
            iv: CryptoJS.lib.WordArray.create(ivBytes),
            mode: CryptoJS.mode.CTR, // CTR 模式（内置，支持）
            padding: CryptoJS.pad.NoPadding,
        });

        // HMAC 校验（模拟 GCM tag）
        const hmac = CryptoJS.HmacSHA512(encrypted.ciphertext, hmacKey);

        // 组装 payload（Base64 安全存储）
        const payload: EncryptedPayload = {
            salt: CryptoJS.enc.Base64.stringify(
                CryptoJS.lib.WordArray.create(saltBytes)
            ),
            iv: CryptoJS.enc.Base64.stringify(
                CryptoJS.lib.WordArray.create(ivBytes)
            ),
            ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
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
export const decrypt = async (
    encryptedBase64: string,
    masterKey: string
): Promise<string> => {
    try {
        // 解析 payload
        const payloadStr = CryptoJS.enc.Utf8.stringify(
            CryptoJS.enc.Base64.parse(encryptedBase64)
        );
        const payload: EncryptedPayload = JSON.parse(payloadStr);

        // 恢复 salt/iv
        const saltBytes = CryptoJS.enc.Base64.parse(payload.salt).toString(
            CryptoJS.enc.Hex
        );
        const salt = CryptoJS.enc.Hex.parse(saltBytes);
        const ivBytes = CryptoJS.enc.Base64.parse(payload.iv).toString(
            CryptoJS.enc.Hex
        );
        const iv = CryptoJS.enc.Hex.parse(ivBytes);

        // 派生密钥
        const { aesKey, hmacKey } = await deriveKey(masterKey, new Uint8Array(salt.sigBytes)); // 转 Uint8Array

        // 先 HMAC 校验（防篡改）
        const computedHmac = CryptoJS.HmacSHA512(
            CryptoJS.enc.Base64.parse(payload.ciphertext),
            hmacKey
        );
        // 修复：用 toString(CryptoJS.enc.Hex) 比较（标准化格式）
        if (computedHmac.toString(CryptoJS.enc.Hex) !== CryptoJS.enc.Base64.parse(payload.hmac).toString(CryptoJS.enc.Hex)) {
            throw new CryptoError(
                "HMAC mismatch: data tampered or wrong key",
                "HMAC_MISMATCH"
            );
        }

        // AES-CTR 解密（修复：第一个参数传 Base64 ciphertext 字符串，cfg 传 { iv, mode, padding }）
        const decrypted = CryptoJS.AES.decrypt(
            payload.ciphertext, // 直接传 Base64 字符串（自动解析为 CipherParams）
            aesKey,
            {
                iv, // WordArray IV
                mode: CryptoJS.mode.CTR, // CTR 模式
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
export const getMasterKey = async (): Promise<string> => {
    let key = await SecureStore.getItemAsync(MASTER_KEY_ALIAS, {
        requireAuthentication: true,
        authenticationPrompt: "验证身份访问数据库",
    });

    if (!key) {
        key = await generateMasterKey();
        await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
            requireAuthentication: true,
            authenticationPrompt: "设置加密密钥",
        });
    }

    return key;
};

// 重置密钥（登出/重置用）
export const resetMasterKey = async (): Promise<void> => {
    await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS);
};