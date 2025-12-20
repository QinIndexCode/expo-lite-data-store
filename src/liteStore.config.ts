/**
 * LiteStore Configuration File
 * Configuration is loaded from this file directly
 * To modify configuration, edit the bundled file at: 
 * node_modules/expo-lite-data-store/dist/js/liteStore.config.js
 */
import { LiteStoreConfig } from './types/config';
import logger from './utils/logger';

// Default Configuration
const defaultConfig: LiteStoreConfig = {
  // Basic Configuration
  chunkSize: 5 * 1024 * 1024, // 5MB - Chunk size
  storageFolder: 'expo-litedatastore',
  sortMethods: 'default', // fast, counting, merge, slow
  timeout: 10000, // 10 seconds

  encryption: {
    // Core Encryption Parameters
    algorithm: 'AES-CTR', // CTR mode (supports parallelism, suitable for mobile)
    keySize: 256, // AES-256 (highest security)

    // HMAC Integrity Protection
    hmacAlgorithm: 'SHA-512', // SHA-512 (resistant to length extension attacks)

    // Key Derivation (anti-brute force)
    keyIterations: 120_000, // 2025 recommended: ≥120,000

    // Field Level Encryption
    encryptedFields: ['password', 'email', 'phone'], // Default fields to encrypt
    requireAuthOnAccess: false, // Require authentication when accessing encrypted data

    // Key Cache Optimization
    cacheTimeout: 30_000, // Auto-clear masterKey from memory after 30 seconds
    maxCacheSize: 50, // LRU cache for derived keys

    // Bulk Operations
    useBulkOperations: true, // Keep enabled for 5~10x performance improvement
  },

  // Performance Configuration
  performance: {
    enableQueryOptimization: true, // Enable query optimization (indexes)
    maxConcurrentOperations: 5, // Maximum concurrent operations
    enableBatchOptimization: true, // Enable batch operation optimization
    memoryWarningThreshold: 0.8, // Memory warning threshold (80%)
  },

  // Cache Configuration
  cache: {
    maxSize: 1000,
    defaultExpiry: 3600_000, // 1 hour
    enableCompression: false, // Enable cache compression (adjust based on device performance)
    cleanupInterval: 300_000, // 5 minutes
    memoryWarningThreshold: 0.8, // Memory warning threshold (80%)
  },

  // Monitoring Configuration
  monitoring: {
    enablePerformanceTracking: true, // Enable performance tracking
    enableHealthChecks: true, // Enable health checks
    metricsRetention: 86_400_000, // 24 hours
  },

  // Auto Sync Configuration
  autoSync: {
    enabled: true, // Enable auto sync by default
    interval: 5000, // 5 seconds sync interval
    minItems: 1, // Minimum items to trigger sync
    batchSize: 100, // Batch size for sync operations
  },
};

// Current Configuration Object
const config: LiteStoreConfig = { ...defaultConfig };

// Configuration Initialization Log
logger.success('✅ Configuration initialized with default settings'); // Log default settings

// Export Configuration
// Note: Configuration is immutable in runtime. To modify, edit the bundled file directly.
export default config;

export { defaultConfig };