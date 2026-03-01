/**
 * SecureKeyStore Unit Tests
 *
 * Tests the REAL SecureKeyStore class with mocked Electron safeStorage
 * and ChatEngine dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Track mock state
let safeStorageAvailable = true;

// Mock Electron's safeStorage
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageAvailable,
    encryptString: (plainText: string) => {
      // Simulate encryption by reversing + prefixing with marker
      const buf = Buffer.from(`ENC:${plainText}`);
      return buf;
    },
    decryptString: (encrypted: Buffer) => {
      const str = encrypted.toString();
      if (!str.startsWith('ENC:')) {
        throw new Error('Failed to decrypt');
      }
      return str.slice(4);
    },
  },
}));

// Mock ChatEngine
const mockSettings = new Map<string, string>();

const mockChatEngine = {
  getSetting: vi.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  deleteSetting: vi.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
};

describe('SecureKeyStore', () => {
  let SecureKeyStore: typeof import('../../src/main/engine/SecureKeyStore').SecureKeyStore;

  beforeEach(async () => {
    safeStorageAvailable = true;
    mockSettings.clear();
    vi.clearAllMocks();

    // Fresh import to reset module state
    const mod = await import('../../src/main/engine/SecureKeyStore');
    SecureKeyStore = mod.SecureKeyStore;
  });

  describe('isAvailable', () => {
    it('returns true when safeStorage encryption is available', () => {
      const store = new SecureKeyStore(mockChatEngine as any);
      expect(store.isAvailable()).toBe(true);
    });

    it('returns false when safeStorage encryption is not available', () => {
      safeStorageAvailable = false;
      const store = new SecureKeyStore(mockChatEngine as any);
      expect(store.isAvailable()).toBe(false);
    });
  });

  describe('store', () => {
    it('encrypts and stores a value as base64 in settings', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await store.store('api_key', 'sk-test-12345');

      expect(mockChatEngine.setSetting).toHaveBeenCalledWith(
        '__encrypted_api_key',
        expect.any(String),
      );

      // The stored value should be a base64 string
      const storedValue = mockSettings.get('__encrypted_api_key');
      expect(storedValue).toBeDefined();

      // Verify it's valid base64
      const decoded = Buffer.from(storedValue!, 'base64');
      expect(decoded.toString()).toContain('ENC:');
    });

    it('throws when safeStorage is not available', async () => {
      safeStorageAvailable = false;
      const store = new SecureKeyStore(mockChatEngine as any);

      await expect(store.store('api_key', 'sk-test-12345')).rejects.toThrow(
        'Secure storage is not available',
      );
    });

    it('stores different keys independently', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await store.store('opencode_key', 'sk-opencode-123');
      await store.store('mistral_key', 'sk-mistral-456');

      expect(mockSettings.has('__encrypted_opencode_key')).toBe(true);
      expect(mockSettings.has('__encrypted_mistral_key')).toBe(true);
    });

    it('overwrites existing value for the same key', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await store.store('api_key', 'old-value');
      await store.store('api_key', 'new-value');

      // Retrieve should return the new value
      const retrieved = await store.retrieve('api_key');
      expect(retrieved).toBe('new-value');
    });
  });

  describe('retrieve', () => {
    it('retrieves and decrypts a previously stored value', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await store.store('api_key', 'sk-secret-key');
      const retrieved = await store.retrieve('api_key');

      expect(retrieved).toBe('sk-secret-key');
    });

    it('returns null when key does not exist', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      const retrieved = await store.retrieve('nonexistent_key');
      expect(retrieved).toBeNull();
    });

    it('throws when safeStorage is not available', async () => {
      // First store with safeStorage available
      const store = new SecureKeyStore(mockChatEngine as any);
      await store.store('api_key', 'sk-test');

      // Then try to retrieve with safeStorage unavailable
      safeStorageAvailable = false;

      await expect(store.retrieve('api_key')).rejects.toThrow(
        'Secure storage is not available',
      );
    });

    it('round-trips correctly for various key values', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      const testValues = [
        'sk-simple',
        'sk-with-special-chars!@#$%^&*()',
        'a'.repeat(500), // long key
        '', // empty string
        'sk-with spaces and\nnewlines',
      ];

      for (const value of testValues) {
        await store.store('test_key', value);
        const retrieved = await store.retrieve('test_key');
        expect(retrieved).toBe(value);
      }
    });
  });

  describe('remove', () => {
    it('removes a stored key', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await store.store('api_key', 'sk-to-delete');
      await store.remove('api_key');

      expect(mockChatEngine.deleteSetting).toHaveBeenCalledWith('__encrypted_api_key');

      const retrieved = await store.retrieve('api_key');
      expect(retrieved).toBeNull();
    });

    it('does not throw when removing a nonexistent key', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await expect(store.remove('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('cleanupPlainTextKey', () => {
    it('deletes a plain-text key from settings', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);
      mockSettings.set('opencode_api_key', 'sk-plain-text-secret');

      await store.cleanupPlainTextKey('opencode_api_key');

      expect(mockChatEngine.deleteSetting).toHaveBeenCalledWith('opencode_api_key');
    });

    it('is safe to call when the plain-text key does not exist', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      await expect(store.cleanupPlainTextKey('opencode_api_key')).resolves.not.toThrow();
      expect(mockChatEngine.deleteSetting).toHaveBeenCalledWith('opencode_api_key');
    });
  });

  describe('retrieve with corrupted data', () => {
    it('throws when stored base64 decodes to invalid ciphertext', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      // Simulate corrupted data: valid base64 but not a valid encrypted buffer
      mockSettings.set('__encrypted_api_key', Buffer.from('CORRUPT:garbage').toString('base64'));

      await expect(store.retrieve('api_key')).rejects.toThrow('Failed to decrypt');
    });

    it('throws when stored value is not valid base64', async () => {
      const store = new SecureKeyStore(mockChatEngine as any);

      // Not valid base64 — Buffer.from tolerates this but decryptString will reject it
      mockSettings.set('__encrypted_api_key', '!!!not-base64!!!');

      await expect(store.retrieve('api_key')).rejects.toThrow('Failed to decrypt');
    });
  });
});
