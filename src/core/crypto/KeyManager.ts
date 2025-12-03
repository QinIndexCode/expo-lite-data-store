// src/core/crypto/KeyManager.ts
// 密钥管理系统，用于安全存储和管理加密密钥

import * as SecureStore from "expo-secure-store";
import { generateMasterKey } from "../../utils/crypto.js";

/**
 * 密钥类型枚举
 */
export enum KeyType {
    AES = "aes",
    HMAC = "hmac",
    MASTER = "master"
}

/**
 * 密钥元数据接口
 */
export interface KeyMetadata {
    /**
     * 密钥ID
     */
    id: string;
    
    /**
     * 密钥类型
     */
    type: KeyType;
    
    /**
     * 密钥算法
     */
    algorithm: string;
    
    /**
     * 密钥大小（位）
     */
    size: number;
    
    /**
     * 密钥创建时间
     */
    createdAt: number;
    
    /**
     * 密钥过期时间（可选）
     */
    expiresAt?: number;
    
    /**
     * 密钥版本
     */
    version: number;
    
    /**
     * 密钥描述
     */
    description?: string;
}

/**
 * 密钥管理系统类
 */
export class KeyManager {
    /**
     * 密钥存储前缀
     */
    private readonly KEY_PREFIX = "expo_litedb_key_";
    
    /**
     * 密钥元数据存储键
     */
    private readonly METADATA_KEY = "expo_litedb_key_metadata";
    
    /**
     * 获取密钥存储键
     * @param keyId 密钥ID
     * @returns 密钥存储键
     */
    private getKeyStorageKey(keyId: string): string {
        return `${this.KEY_PREFIX}${keyId}`;
    }
    
    /**
     * 保存密钥到安全存储
     * @param keyId 密钥ID
     * @param key 密钥内容
     * @param metadata 密钥元数据
     * @returns 保存是否成功
     */
    async saveKey(keyId: string, key: string, metadata: Omit<KeyMetadata, "id" | "createdAt" | "version">): Promise<boolean> {
        try {
            // 保存密钥内容
            await SecureStore.setItemAsync(this.getKeyStorageKey(keyId), key, {
                requireAuthentication: true,
                authenticationPrompt: "验证身份访问密钥"
            });
            
            // 保存密钥元数据
            const metadataWithId: KeyMetadata = {
                ...metadata,
                id: keyId,
                createdAt: Date.now(),
                version: 1
            };
            
            await this.saveKeyMetadata(metadataWithId);
            
            return true;
        } catch (error) {
            console.error("Failed to save key:", error);
            return false;
        }
    }
    
    /**
     * 从安全存储获取密钥
     * @param keyId 密钥ID
     * @returns 密钥内容，如果不存在则返回undefined
     */
    async getKey(keyId: string): Promise<string | undefined> {
        try {
            const result = await SecureStore.getItemAsync(this.getKeyStorageKey(keyId), {
                requireAuthentication: true,
                authenticationPrompt: "验证身份访问密钥"
            });
            return result || undefined;
        } catch (error) {
            console.error("Failed to get key:", error);
            return undefined;
        }
    }
    
    /**
     * 删除密钥
     * @param keyId 密钥ID
     * @returns 删除是否成功
     */
    async deleteKey(keyId: string): Promise<boolean> {
        try {
            // 删除密钥内容
            await SecureStore.deleteItemAsync(this.getKeyStorageKey(keyId));
            
            // 删除密钥元数据
            await this.deleteKeyMetadata(keyId);
            
            return true;
        } catch (error) {
            console.error("Failed to delete key:", error);
            return false;
        }
    }
    
    /**
     * 检查密钥是否存在
     * @param keyId 密钥ID
     * @returns 密钥是否存在
     */
    async hasKey(keyId: string): Promise<boolean> {
        try {
            const key = await this.getKey(keyId);
            return key !== undefined;
        } catch (error) {
            console.error("Failed to check key existence:", error);
            return false;
        }
    }
    
    /**
     * 保存密钥元数据
     * @param metadata 密钥元数据
     */
    private async saveKeyMetadata(metadata: KeyMetadata): Promise<void> {
        try {
            const allMetadata = await this.getAllKeyMetadata();
            allMetadata[metadata.id] = metadata;
            await SecureStore.setItemAsync(this.METADATA_KEY, JSON.stringify(allMetadata));
        } catch (error) {
            console.error("Failed to save key metadata:", error);
            throw error;
        }
    }
    
    /**
     * 获取所有密钥元数据
     * @returns 所有密钥元数据
     */
    async getAllKeyMetadata(): Promise<Record<string, KeyMetadata>> {
        try {
            const metadataStr = await SecureStore.getItemAsync(this.METADATA_KEY);
            return metadataStr ? JSON.parse(metadataStr) : {};
        } catch (error) {
            console.error("Failed to get all key metadata:", error);
            return {};
        }
    }
    
    /**
     * 获取单个密钥元数据
     * @param keyId 密钥ID
     * @returns 密钥元数据，如果不存在则返回undefined
     */
    async getKeyMetadata(keyId: string): Promise<KeyMetadata | undefined> {
        try {
            const allMetadata = await this.getAllKeyMetadata();
            return allMetadata[keyId];
        } catch (error) {
            console.error("Failed to get key metadata:", error);
            return undefined;
        }
    }
    
    /**
     * 删除密钥元数据
     * @param keyId 密钥ID
     */
    private async deleteKeyMetadata(keyId: string): Promise<void> {
        try {
            const allMetadata = await this.getAllKeyMetadata();
            delete allMetadata[keyId];
            await SecureStore.setItemAsync(this.METADATA_KEY, JSON.stringify(allMetadata));
        } catch (error) {
            console.error("Failed to delete key metadata:", error);
            throw error;
        }
    }
    
    /**
     * 生成并保存主密钥
     * @param keyId 密钥ID
     * @returns 生成的主密钥
     */
    async generateAndSaveMasterKey(keyId: string = "master"): Promise<string> {
        try {
            // 生成主密钥
            const masterKey = await generateMasterKey();
            
            // 保存主密钥
            await this.saveKey(keyId, masterKey, {
                type: KeyType.MASTER,
                algorithm: "AES-256",
                size: 256,
                description: "Master encryption key"
            });
            
            return masterKey;
        } catch (error) {
            console.error("Failed to generate and save master key:", error);
            throw error;
        }
    }
    
    /**
     * 获取或生成主密钥
     * @param keyId 密钥ID
     * @returns 主密钥
     */
    async getOrGenerateMasterKey(keyId: string = "master"): Promise<string> {
        try {
            // 尝试获取现有主密钥
            const existingKey = await this.getKey(keyId);
            if (existingKey) {
                return existingKey;
            }
            
            // 生成新的主密钥
            return await this.generateAndSaveMasterKey(keyId);
        } catch (error) {
            console.error("Failed to get or generate master key:", error);
            throw error;
        }
    }
    
    /**
     * 轮换密钥
     * @param keyId 密钥ID
     * @param newKey 新密钥
     * @param metadata 更新的元数据
     * @returns 轮换是否成功
     */
    async rotateKey(keyId: string, newKey: string, metadata?: Partial<KeyMetadata>): Promise<boolean> {
        try {
            // 获取现有密钥元数据
            const existingMetadata = await this.getKeyMetadata(keyId);
            if (!existingMetadata) {
                throw new Error(`Key ${keyId} not found`);
            }
            
            // 更新密钥内容
            await SecureStore.setItemAsync(this.getKeyStorageKey(keyId), newKey, {
                requireAuthentication: true,
                authenticationPrompt: "验证身份更新密钥"
            });
            
            // 更新密钥元数据
            const updatedMetadata: KeyMetadata = {
                ...existingMetadata,
                ...metadata,
                version: existingMetadata.version + 1
            };
            await this.saveKeyMetadata(updatedMetadata);
            
            return true;
        } catch (error) {
            console.error("Failed to rotate key:", error);
            return false;
        }
    }
    
    /**
     * 列出所有密钥
     * @returns 所有密钥的元数据
     */
    async listKeys(): Promise<KeyMetadata[]> {
        try {
            const allMetadata = await this.getAllKeyMetadata();
            return Object.values(allMetadata);
        } catch (error) {
            console.error("Failed to list keys:", error);
            return [];
        }
    }
    
    /**
     * 清除所有密钥
     * @returns 清除是否成功
     */
    async clearAllKeys(): Promise<boolean> {
        try {
            const allMetadata = await this.getAllKeyMetadata();
            
            // 删除所有密钥内容
            for (const keyId of Object.keys(allMetadata)) {
                await SecureStore.deleteItemAsync(this.getKeyStorageKey(keyId));
            }
            
            // 删除密钥元数据
            await SecureStore.deleteItemAsync(this.METADATA_KEY);
            
            return true;
        } catch (error) {
            console.error("Failed to clear all keys:", error);
            return false;
        }
    }
    
    /**
     * 导出密钥（用于备份）
     * @param keyId 密钥ID
     * @returns 导出的密钥数据
     */
    async exportKey(keyId: string): Promise<{
        key: string;
        metadata: KeyMetadata;
    } | undefined> {
        try {
            const key = await this.getKey(keyId);
            const metadata = await this.getKeyMetadata(keyId);
            
            if (key && metadata) {
                return {
                    key,
                    metadata
                };
            }
            
            return undefined;
        } catch (error) {
            console.error("Failed to export key:", error);
            return undefined;
        }
    }
    
    /**
     * 导入密钥（用于恢复）
     * @param keyData 导入的密钥数据
     * @returns 导入是否成功
     */
    async importKey(keyData: {
        key: string;
        metadata: KeyMetadata;
    }): Promise<boolean> {
        try {
            // 保存密钥内容
            await SecureStore.setItemAsync(this.getKeyStorageKey(keyData.metadata.id), keyData.key, {
                requireAuthentication: true,
                authenticationPrompt: "验证身份导入密钥"
            });
            
            // 保存密钥元数据
            await this.saveKeyMetadata(keyData.metadata);
            
            return true;
        } catch (error) {
            console.error("Failed to import key:", error);
            return false;
        }
    }
}

// 密钥管理器单例
export const keyManager = new KeyManager();
