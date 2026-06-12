import { decryptFields, getMasterKey } from '../crypto';

describe('field encryption failure handling', () => {
  it('rejects an undecryptable field instead of returning it as normal data', async () => {
    await expect(
      decryptFields(
        { id: 1, secret: 'not-valid-ciphertext' },
        {
          fields: ['secret'],
          masterKey: 'test-master-key',
        }
      )
    ).rejects.toBeDefined();
  });

  it('refuses an in-memory master key fallback outside tests', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const mutableEnv = process.env as Record<string, string | undefined>;
    const secureStore = require('expo-secure-store') as any;
    const originalGetItemAsync = secureStore.getItemAsync;
    secureStore.getItemAsync = jest.fn().mockRejectedValueOnce(new Error('secure store down'));

    mutableEnv.NODE_ENV = 'production';
    try {
      await expect(getMasterKey(false)).rejects.toMatchObject({ code: 'KEY_DERIVE_FAILED' });
    } finally {
      mutableEnv.NODE_ENV = originalNodeEnv;
      secureStore.getItemAsync = originalGetItemAsync;
    }
  });
});
