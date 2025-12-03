// __mocks__/expo-secure-store.ts
// Mock implementation for expo-secure-store

// Mock secure store data
const mockSecureStore = {};

// Mock getItemAsync function
const getItemAsync = async (
    key: string,
    options?: { requireAuthentication?: boolean; authenticationPrompt?: string }
): Promise<string | null> => {
    // Simple mock implementation that returns stored value
    return (mockSecureStore as Record<string, string>)[key] || null;
};

// Mock setItemAsync function
const setItemAsync = async (
    key: string,
    value: string,
    options?: { requireAuthentication?: boolean; authenticationPrompt?: string }
): Promise<void> => {
    // Simple mock implementation that stores value
    (mockSecureStore as Record<string, string>)[key] = value;
};

// Mock deleteItemAsync function
const deleteItemAsync = async (
    key: string
): Promise<void> => {
    // Simple mock implementation that deletes value
    delete (mockSecureStore as Record<string, string>)[key];
};

// Mock isAvailableAsync function
const isAvailableAsync = async (): Promise<boolean> => {
    // Always available in mock
    return true;
};

// Export all mock functions using CommonJS syntax
module.exports = {
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
    isAvailableAsync,
};

// Also export as named exports for TypeScript compatibility
module.exports.default = module.exports;