/**
 * chatHandlers keychain integration tests
 *
 * Tests that API keys are stored/retrieved via SecureKeyStore (encrypted)
 * and that old plain-text keys are cleaned up on startup.
 *
 * Post-Phase 2: chatHandlers uses ProviderRegistry + ChatService, not OpenCodeManager.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

const webContentsSend = vi.fn();
const mainWindowMock = {
  webContents: {
    send: webContentsSend,
  },
};

const chatEngineInstances: Array<Record<string, any>> = [];
const providerRegistryInstances: Array<Record<string, any>> = [];
const secureKeyStoreInstances: Array<Record<string, any>> = [];

// Per-test overrides for SecureKeyStore mock behavior
let secureKeyStoreRetrieveResult: string | null = 'encrypted-stored-key';
let secureKeyStoreStoreError: Error | null = null;
let secureKeyStoreRetrieveError: Error | null = null;
let secureKeyStoreCleanupError: Error | null = null;

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<any>) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/engine/ChatEngine', () => ({
  ChatEngine: class {
    constructor() {
      const instance = {
        getSetting: vi.fn(async () => null),
        setSetting: vi.fn(async () => undefined),
        deleteSetting: vi.fn(async () => undefined),
        getSelectedModel: vi.fn(async () => 'gpt-5'),
        getDefaultSystemPrompt: vi.fn(async () => 'system prompt'),
      };
      chatEngineInstances.push(instance);
      return instance;
    }
  },
}));

vi.mock('../../src/main/engine/SecureKeyStore', () => ({
  SecureKeyStore: class {
    constructor() {
      const instance = {
        isAvailable: vi.fn(() => true),
        store: vi.fn(async (_key: string, _value: string) => {
          if (secureKeyStoreStoreError) throw secureKeyStoreStoreError;
        }),
        retrieve: vi.fn(async () => {
          if (secureKeyStoreRetrieveError) throw secureKeyStoreRetrieveError;
          return secureKeyStoreRetrieveResult;
        }),
        remove: vi.fn(async () => undefined),
        cleanupPlainTextKey: vi.fn(async () => {
          if (secureKeyStoreCleanupError) throw secureKeyStoreCleanupError;
        }),
      };
      secureKeyStoreInstances.push(instance);
      return instance;
    }
  },
}));

vi.mock('../../src/main/engine/ai/providers', () => ({
  ProviderRegistry: class {
    constructor() {
      const instance = {
        setOpencodeKey: vi.fn(),
        getOpencodeKey: vi.fn(() => 'abc12345'),
        setMistralKey: vi.fn(),
        getMistralKey: vi.fn(() => ''),
        isReady: vi.fn(() => true),
        isProviderKeySet: vi.fn(() => true),
        getProviderStatus: vi.fn(() => ({ opencode: true, mistral: false })),
        resolveModel: vi.fn(),
        getAvailableModels: vi.fn(async () => []),
        validateOpencodeKey: vi.fn(async () => ({ isValid: true, models: [] })),
        validateMistralKey: vi.fn(async () => ({ isValid: true, models: [] })),
        invalidateModelCache: vi.fn(),
        getModelCatalogEngine: vi.fn(() => ({ refresh: vi.fn(async () => ({})), getAll: vi.fn(async () => []) })),
      };
      providerRegistryInstances.push(instance);
      return instance;
    }
  },
  detectProvider: vi.fn(() => 'anthropic'),
  createOpenCodeGateway: vi.fn(),
}));

vi.mock('../../src/main/engine/ai/chat', () => ({
  ChatService: class {
    constructor() { /* no-op */ }
    sendMessage = vi.fn(async () => ({ success: true, message: 'reply' }));
    abortMessage = vi.fn(async () => ({ success: true }));
    stop = vi.fn(async () => undefined);
  },
}));

vi.mock('../../src/main/engine/ai/tasks', () => ({
  OneShotTasks: class {
    constructor() { /* no-op */ }
    analyzeTaxonomy = vi.fn(async () => ({ success: true }));
    analyzeMediaImage = vi.fn(async () => ({ success: true }));
  },
}));

describe('chatHandlers keychain integration', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    webContentsSend.mockReset();
    chatEngineInstances.length = 0;
    providerRegistryInstances.length = 0;
    secureKeyStoreInstances.length = 0;
    secureKeyStoreRetrieveResult = 'encrypted-stored-key';
    secureKeyStoreStoreError = null;
    secureKeyStoreRetrieveError = null;
    secureKeyStoreCleanupError = null;
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    await mod.cleanupChatHandlers();
  });

  it('loads API key from SecureKeyStore on init', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    // Trigger initialization by calling any handler
    const handler = registeredHandlers.get('chat:checkReady');
    await handler!(undefined);

    const keyStore = secureKeyStoreInstances[0];
    expect(keyStore.retrieve).toHaveBeenCalledWith('opencode_api_key');

    const registry = providerRegistryInstances[0];
    expect(registry.setOpencodeKey).toHaveBeenCalledWith('encrypted-stored-key');
  });

  it('cleans up old plain-text key on init', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    // Trigger initialization
    const handler = registeredHandlers.get('chat:checkReady');
    await handler!(undefined);

    const keyStore = secureKeyStoreInstances[0];
    expect(keyStore.cleanupPlainTextKey).toHaveBeenCalledWith('opencode_api_key');
  });

  it('stores API key via SecureKeyStore on chat:setApiKey', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:setApiKey');
    const result = await handler!(undefined, 'sk-new-secret-key');

    expect(result.success).toBe(true);

    const keyStore = secureKeyStoreInstances[0];
    expect(keyStore.store).toHaveBeenCalledWith('opencode_api_key', 'sk-new-secret-key');

    const registry = providerRegistryInstances[0];
    expect(registry.setOpencodeKey).toHaveBeenCalledWith('sk-new-secret-key');
  });

  it('does not use plain-text getSetting for API key', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    // Trigger initialization
    const handler = registeredHandlers.get('chat:checkReady');
    await handler!(undefined);

    const engine = chatEngineInstances[0];
    // getSetting should NOT be called with 'opencode_api_key' (that's the old plain-text path)
    expect(engine.getSetting).not.toHaveBeenCalledWith('opencode_api_key');
  });

  it('does not use plain-text setSetting for API key', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:setApiKey');
    await handler!(undefined, 'sk-new-key');

    const engine = chatEngineInstances[0];
    // setSetting should NOT be called with 'opencode_api_key'
    expect(engine.setSetting).not.toHaveBeenCalledWith('opencode_api_key', expect.anything());
  });

  it('handles missing key gracefully on init (no key stored)', async () => {
    secureKeyStoreRetrieveResult = null;

    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:checkReady');
    const result = await handler!(undefined);
    expect(result.ready).toBe(true);

    const registry = providerRegistryInstances[0];
    // setOpencodeKey should NOT have been called since there's no stored key
    expect(registry.setOpencodeKey).not.toHaveBeenCalled();
  });

  it('still initializes when retrieve() throws on init', async () => {
    secureKeyStoreRetrieveError = new Error('decryption failed');

    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:checkReady');
    const result = await handler!(undefined);
    // Init should complete even if key retrieval fails
    expect(result.ready).toBe(true);

    const registry = providerRegistryInstances[0];
    expect(registry.setOpencodeKey).not.toHaveBeenCalled();
  });

  it('still initializes and loads key when cleanupPlainTextKey() throws on init', async () => {
    secureKeyStoreCleanupError = new Error('delete failed');

    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:checkReady');
    const result = await handler!(undefined);
    // Init should complete even if cleanup fails
    expect(result.ready).toBe(true);

    // The encrypted key should still be loaded despite cleanup failure
    const registry = providerRegistryInstances[0];
    expect(registry.setOpencodeKey).toHaveBeenCalledWith('encrypted-stored-key');
  });

  it('returns error and rolls back in-memory key when store() throws on chat:setApiKey', async () => {
    secureKeyStoreStoreError = new Error('encryption unavailable');

    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    // Trigger init to load the existing key
    const checkHandler = registeredHandlers.get('chat:checkReady');
    await checkHandler!(undefined);

    const registry = providerRegistryInstances[0];
    // After init, the registry has the key from SecureKeyStore
    expect(registry.setOpencodeKey).toHaveBeenCalledWith('encrypted-stored-key');
    registry.setOpencodeKey.mockClear();

    // getOpencodeKey returns the current in-memory key (to be restored on rollback)
    registry.getOpencodeKey.mockReturnValue('encrypted-stored-key');

    const handler = registeredHandlers.get('chat:setApiKey');
    const result = await handler!(undefined, 'sk-new-key');

    expect(result.success).toBe(false);
    expect(result.error).toContain('encryption unavailable');

    // setOpencodeKey should have been called twice:
    // 1) with the new key (optimistic), 2) with the old key (rollback)
    expect(registry.setOpencodeKey).toHaveBeenCalledTimes(2);
    expect(registry.setOpencodeKey).toHaveBeenNthCalledWith(1, 'sk-new-key');
    expect(registry.setOpencodeKey).toHaveBeenNthCalledWith(2, 'encrypted-stored-key');
  });
});
