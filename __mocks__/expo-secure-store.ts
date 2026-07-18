const mockSecureStore: Record<string, string> = {};

const getItemAsync = async (
  key: string,
  _options?: { requireAuthentication?: boolean; authenticationPrompt?: string }
): Promise<string | null> => {
  return mockSecureStore[key] || null;
};

const setItemAsync = async (
  key: string,
  value: string,
  _options?: { requireAuthentication?: boolean; authenticationPrompt?: string }
): Promise<void> => {
  mockSecureStore[key] = value;
};

const deleteItemAsync = async (key: string): Promise<void> => {
  delete mockSecureStore[key];
};

const isAvailableAsync = async (): Promise<boolean> => {
  return true;
};

module.exports = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
};

module.exports.default = module.exports;
