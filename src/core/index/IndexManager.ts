// src/core/index/IndexManager.ts
import { MetadataManagerInfc } from "../../types/metadataManagerInfc";
import { StorageError } from "../../types/storageErrorInfc";
/**
 * 索引类型枚举
 */
export enum IndexType {
    UNIQUE = "unique",
    NORMAL = "normal"
}

/**
 * 索引项接口
 */
export interface IndexItem {
    value: any;
    id: string | number;
}

/**
 * 索引接口
 */
export interface Index {
    name: string;
    type: IndexType;
    fields: string[]; // 支持复合索引，多个字段
    data: Map<string, IndexItem[]>; // 使用字符串化的复合值作为键
}

/**
 * 索引管理器类，用于管理索引的创建、查询和更新
 */
export class IndexManager {
    /**
     * 索引缓存
     */
    private indexCache = new Map<string, Map<string, Index>>(); // tableName -> indexName -> Index
    
    /**
     * 元数据管理器实例
     */
    private metadataManager: MetadataManagerInfc;
    
    /**
     * 构造函数
     */
    constructor(metadataManager: MetadataManagerInfc) {
        this.metadataManager = metadataManager;
    }
    
    /**
     * 创建索引
     */
    async createIndex(
        tableName: string,
        fields: string | string[],
        type: IndexType = IndexType.NORMAL
    ): Promise<void> {
        if (!tableName?.trim()) {
            throw new StorageError(
                "Table name cannot be empty",
                "TABLE_NAME_INVALID",
                {
                    details: "Table name is required to create an index",
                    suggestion: "Please provide a valid table name"
                }
            );
        }
        
        const indexFields = Array.isArray(fields) ? fields : [fields];
        
        if (indexFields.length === 0) {
            throw new StorageError(
                "Field name cannot be empty",
                "TABLE_INDEX_INVALID",
                {
                    details: "Field name is required to create an index",
                    suggestion: "Please provide a valid field name or array of field names"
                }
            );
        }
        
        for (const field of indexFields) {
            if (!field?.trim()) {
                throw new StorageError(
                    "Field name cannot be empty",
                    "TABLE_INDEX_INVALID",
                    {
                        details: "All field names must be non-empty strings",
                        suggestion: "Please provide valid field names"
                    }
                );
            }
        }
        
        if (!this.metadataManager.get(tableName)) {
            throw new StorageError(
                `Table ${tableName} not found`,
                "TABLE_NOT_FOUND",
                {
                    details: `Cannot create index on non-existent table: ${tableName}`,
                    suggestion: "Create the table first before creating an index"
                }
            );
        }
        
        const indexName = `${indexFields.join('_')}_${type}`;
        
        if (!this.indexCache.has(tableName)) {
            this.indexCache.set(tableName, new Map());
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        if (tableIndexes.has(indexName)) {
            throw new StorageError(
                `Index ${indexName} already exists on table ${tableName}`,
                "TABLE_INDEX_ALREADY_EXISTS",
                {
                    details: `An index with name ${indexName} already exists on table ${tableName}`,
                    suggestion: "Use different field names or drop the existing index first"
                }
            );
        }
        
        const index: Index = {
            name: indexName,
            type,
            fields: indexFields,
            data: new Map()
        };
        
        tableIndexes.set(indexName, index);
        
        const tableMeta = this.metadataManager.get(tableName);
        if (tableMeta) {
            this.metadataManager.update(tableName, {
                indexes: {
                    ...tableMeta.indexes,
                    [indexName]: type
                }
            });
        }
    }
    
    /**
     * 删除索引
     */
    async dropIndex(tableName: string, fields: string | string[], type: IndexType = IndexType.NORMAL): Promise<void> {
        if (!tableName?.trim()) {
            throw new StorageError(
                "Table name cannot be empty",
                "TABLE_NAME_INVALID"
            );
        }
        
        const indexFields = Array.isArray(fields) ? fields : [fields];
        
        if (indexFields.length === 0) {
            throw new StorageError(
                "Field name cannot be empty",
                "TABLE_INDEX_INVALID"
            );
        }
        
        const indexName = `${indexFields.join('_')}_${type}`;
        
        if (!this.indexCache.has(tableName)) {
            throw new StorageError(
                `Index ${indexName} not found on table ${tableName}`,
                "TABLE_INDEX_NOT_FOUND"
            );
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        if (!tableIndexes.has(indexName)) {
            throw new StorageError(
                `Index ${indexName} not found on table ${tableName}`,
                "TABLE_INDEX_NOT_FOUND"
            );
        }
        
        tableIndexes.delete(indexName);
        
        const tableMeta = this.metadataManager.get(tableName);  
        if (tableMeta?.indexes) {
            const newIndexes = { ...tableMeta.indexes };
            delete newIndexes[indexName];
            this.metadataManager.update(tableName, {
                indexes: newIndexes
            });
        }
    }
    
    /**
     * 生成复合索引键
     */
    private generateCompositeKey(values: any[]): string {
        return JSON.stringify(values);
    }
    
    /**
     * 为数据添加索引
     */
    addToIndex(tableName: string, data: Record<string, any>): void {
        if (!this.indexCache.has(tableName)) {
            return;
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        const id = data.id;
        
        if (!id) {
            return;
        }
        
        for (const [indexName, index] of tableIndexes.entries()) {
            // 获取索引的所有字段值
            const fieldValues = index.fields.map(field => data[field]);
            
            // 如果任何字段值为undefined，跳过该索引
            if (fieldValues.some(value => value === undefined)) {
                continue;
            }
            
            // 生成复合键
            const compositeKey = this.generateCompositeKey(fieldValues);
            
            if (!index.data.has(compositeKey)) {
                index.data.set(compositeKey, []);
            }
            
            const indexItems = index.data.get(compositeKey)!;
            
            if (index.type === IndexType.UNIQUE) {
                // 对于唯一索引，检查是否已存在相同的复合值
                if (indexItems.length > 0) {
                    throw new StorageError(
                        `Unique constraint violated for index ${indexName} on fields ${index.fields.join(', ')}`,
                        "TABLE_INDEX_NOT_UNIQUE",
                        {
                            details: `Value '${compositeKey}' already exists in unique index ${indexName}`,
                            suggestion: "Use a different combination of values for the fields or drop the unique constraint"
                        }
                    );
                }
            }
            
            indexItems.push({
                value: fieldValues.length === 1 ? fieldValues[0] : fieldValues,
                id
            });
        }
    }
    
    /**
     * 从索引中删除数据
     */
    removeFromIndex(tableName: string, data: Record<string, any>): void {
        if (!this.indexCache.has(tableName)) {
            return;
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        const id = data.id;
        
        if (!id) {
            return;
        }
        
        for (const [, index] of tableIndexes.entries()) {
            // 获取索引的所有字段值
            const fieldValues = index.fields.map(field => data[field]);
            
            // 如果任何字段值为undefined，跳过该索引
            if (fieldValues.some(value => value === undefined)) {
                continue;
            }
            
            // 生成复合键
            const compositeKey = this.generateCompositeKey(fieldValues);
            
            if (!index.data.has(compositeKey)) {
                continue;
            }
            
            const indexItems = index.data.get(compositeKey)!;
            const indexToRemove = indexItems.findIndex(item => item.id === id);
            
            if (indexToRemove !== -1) {
                indexItems.splice(indexToRemove, 1);
            }
            
            if (indexItems.length === 0) {
                index.data.delete(compositeKey);
            }
        }
    }
    
    /**
     * 更新索引
     */
    updateIndex(tableName: string, oldData: Record<string, any>, newData: Record<string, any>): void {
        this.removeFromIndex(tableName, oldData);
        this.addToIndex(tableName, newData);
    }
    
    /**
     * 使用索引查询数据ID
     */
    queryIndex(tableName: string, fields: string | string[], values: any | any[]): string[] | number[] {
        if (!this.indexCache.has(tableName)) {
            return [];
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        const queryFields = Array.isArray(fields) ? fields : [fields];
        const queryValues = Array.isArray(values) ? values : [values];
        
        // 找到匹配的索引
        let matchingIndex: Index | undefined;
        for (const [, index] of tableIndexes.entries()) {
            // 检查索引字段是否与查询字段完全匹配
            if (index.fields.length === queryFields.length) {
                const fieldsMatch = index.fields.every((field, idx) => field === queryFields[idx]);
                if (fieldsMatch) {
                    matchingIndex = index;
                    break;
                }
            }
        }
        
        if (!matchingIndex) {
            return [];
        }
        
        // 生成复合键
        const compositeKey = this.generateCompositeKey(queryValues);
        
        const indexItems = matchingIndex.data.get(compositeKey);
        if (!indexItems || indexItems.length === 0) {
            return [];
        }
        
        const firstId = indexItems[0].id;
        if (typeof firstId === 'string') {
            return indexItems.map(item => item.id as string);
        } else {
            return indexItems.map(item => item.id as number);
        }
    }
    
    /**
     * 获取表的所有索引
     */
    getTableIndexes(tableName: string): Index[] {
        if (!this.indexCache.has(tableName)) {
            return [];
        }
        
        return Array.from(this.indexCache.get(tableName)!.values());
    }
    
    /**
     * 检查字段或字段组合是否有索引
     */
    hasIndex(tableName: string, fields: string | string[]): boolean {
        if (!this.indexCache.has(tableName)) {
            return false;
        }
        
        const tableIndexes = this.indexCache.get(tableName)!;
        const checkFields = Array.isArray(fields) ? fields : [fields];
        
        for (const [, index] of tableIndexes.entries()) {
            // 检查索引字段是否与查询字段完全匹配
            if (index.fields.length === checkFields.length) {
                const fieldsMatch = index.fields.every((field, idx) => field === checkFields[idx]);
                if (fieldsMatch) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * 清除表的所有索引
     */
    clearTableIndexes(tableName: string): void {
        this.indexCache.delete(tableName);
        
        const tableMeta = this.metadataManager.get(tableName);
        if (tableMeta) {
            this.metadataManager.update(tableName, {
                indexes: {}
            });
        }
    }
}

// 单例导出，使用全局meta实例
import { meta } from "../meta/MetadataManager";
export const indexManager = new IndexManager(meta);
