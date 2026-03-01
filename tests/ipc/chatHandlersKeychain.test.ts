/**
 * chatHandlers keychain integration tests
 *
 * Tests that API keys are stored/retrieved via SecureKeyStore (encrypted)
 * and that old plain-text keys are cleaned up on startup.
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
const openCodeManagerInstances: Array<Record<string, any>> = [];
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

vi.mock('../../src/main/engine/OpenCodeManager', () => ({
  OpenCodeManager: class {
    constructor() {
      const instance = {
        setApiKey: vi.fn(),
        checkReady: vi.fn(async () => ({ ready: true })),
        validateApiKey: vi.fn(async () => ({ isValid: true, models: [] })),
        getApiKey: vi.fn(() => 'abc12345'),
        getAvailableModels: vi.fn(async () => []),
        sendMessage: vi.fn(async () => ({ success: true, message: 'reply' })),
        abortMessage: vi.fn(async () => ({ success: true })),
        analyzeTaxonomy: vi.fn(async () => ({ success: true })),
        analyzeMediaImage: vi.fn(async () => ({ success: true })),
        stop: vi.fn(async () => undefined),
      };
      openCodeManagerInstances.push(instance);
      return instance;
    }
  },
}));

describe('chatHandlers keychain integration', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    webContentsSend.mockReset();
    chatEngineInstances.length = 0;
    openCodeManagerInstances.length = 0;
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

    const manager = openCodeManagerInstances[0];
    expect(manager.setApiKey).toHaveBeenCalledWith('encrypted-stored-key');
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

    const manager = openCodeManagerInstances[0];
    expect(manager.setApiKey).toHaveBeenCalledWith('sk-new-secret-key');
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

    const manager = openCodeManagerInstances[0];
    // setApiKey should NOT have been called since there's no stored key
    expect(manager.setApiKey).not.toHaveBeenCalled();
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

    const manager = openCodeManagerInstances[0];
    expect(manager.setApiKey).not.toHaveBeenCalled();
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
    const manager = openCodeManagerInstances[0];
    expect(manager.setApiKey).toHaveBeenCalledWith('encrypted-stored-key');
  });

  it('returns error when store() throws on chat:setApiKey', async () => {
    secureKeyStoreStoreError = new Error('encryption unavailable');

    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = { postEngine: {}, mediaEngine: {}, postMediaEngine: {} };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:setApiKey');
    const result = await handler!(undefined, 'sk-new-key');

    expect(result.success).toBe(false);
    expect(result.error).toContain('encryption unavailable');
  });
});
