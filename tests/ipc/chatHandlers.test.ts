/**
 * chatHandlers IPC streaming tests
 *
 * Post-Phase 2: chatHandlers uses ChatService.sendMessage, not OpenCodeManager.
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
const chatServiceInstances: Array<Record<string, any>> = [];
const secureKeyStoreInstances: Array<Record<string, any>> = [];

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
        store: vi.fn(async () => undefined),
        retrieve: vi.fn(async () => 'stored-key'),
        remove: vi.fn(async () => undefined),
        cleanupPlainTextKey: vi.fn(async () => undefined),
      };
      secureKeyStoreInstances.push(instance);
      return instance;
    }
  },
}));

vi.mock('../../src/main/engine/ai/providers', () => ({
  ProviderRegistry: class {
    constructor() { /* no-op */ }
    setOpencodeKey = vi.fn();
    getOpencodeKey = vi.fn(() => 'abc12345');
    setMistralKey = vi.fn();
    getMistralKey = vi.fn(() => '');
    isReady = vi.fn(() => true);
    isProviderKeySet = vi.fn(() => true);
    getProviderStatus = vi.fn(() => ({ opencode: true, mistral: false }));
    resolveModel = vi.fn();
    getAvailableModels = vi.fn(async () => []);
    validateOpencodeKey = vi.fn(async () => ({ isValid: true, models: [] }));
    validateMistralKey = vi.fn(async () => ({ isValid: true, models: [] }));
    invalidateModelCache = vi.fn();
    getModelCatalogEngine = vi.fn(() => ({ refresh: vi.fn(async () => ({})), getAll: vi.fn(async () => []) }));
  },
  detectProvider: vi.fn(() => 'anthropic'),
  createOpenCodeGateway: vi.fn(),
}));

vi.mock('../../src/main/engine/ai/chat', () => ({
  ChatService: class {
    constructor() {
      const instance = {
        sendMessage: vi.fn(async (_conversationId: string, _message: string, callbacks: any) => {
          callbacks?.onDelta?.('stream-delta');
          callbacks?.onToolCall?.({ name: 'search_posts', args: { query: 'q' } });
          callbacks?.onToolResult?.({ name: 'search_posts', result: { ok: true } });
          callbacks?.onTokenUsage?.({
            inputTokens: 100, outputTokens: 50,
            cacheReadTokens: 80, cacheWriteTokens: 20, totalTokens: 250,
            cumulativeInputTokens: 100, cumulativeOutputTokens: 50,
            cumulativeCacheReadTokens: 80, cumulativeCacheWriteTokens: 20,
            cumulativeTotalTokens: 250,
          });
          return { success: true, message: 'assistant reply' };
        }),
        abortMessage: vi.fn(async () => ({ success: true })),
        stop: vi.fn(async () => undefined),
      };
      chatServiceInstances.push(instance);
      return instance;
    }
  },
}));

vi.mock('../../src/main/engine/ai/tasks', () => ({
  OneShotTasks: class {
    constructor() { /* no-op */ }
    analyzeTaxonomy = vi.fn(async () => ({ success: true }));
    analyzeMediaImage = vi.fn(async () => ({ success: true }));
  },
}));

describe('chatHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    webContentsSend.mockReset();
    chatEngineInstances.length = 0;
    chatServiceInstances.length = 0;
    secureKeyStoreInstances.length = 0;
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    await mod.cleanupChatHandlers();
  });

  it('streams sendMessage callbacks through main window events', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    const mockBundle = {
      postEngine: {},
      mediaEngine: {},
      postMediaEngine: {},
    };
    mod.initializeChatHandlers(() => mainWindowMock as never, mockBundle as any);
    mod.registerChatHandlers();

    const handler = registeredHandlers.get('chat:sendMessage');
    expect(handler).toBeDefined();

    const result = await handler!(
      undefined,
      'conversation-1',
      'hello assistant',
      { surface: 'sidebar' },
    );

    expect(result.success).toBe(true);

    const service = chatServiceInstances[0];
    expect(service.sendMessage).toHaveBeenCalledWith(
      'conversation-1',
      'hello assistant',
      expect.objectContaining({
        onDelta: expect.any(Function),
        onToolCall: expect.any(Function),
        onToolResult: expect.any(Function),
        onTokenUsage: expect.any(Function),
      }),
    );

    expect(webContentsSend).toHaveBeenCalledWith('chat-stream-delta', {
      conversationId: 'conversation-1',
      delta: 'stream-delta',
    });
    expect(webContentsSend).toHaveBeenCalledWith('chat-tool-call', {
      conversationId: 'conversation-1',
      toolCall: { name: 'search_posts', args: { query: 'q' } },
    });
    expect(webContentsSend).toHaveBeenCalledWith('chat-tool-result', {
      conversationId: 'conversation-1',
      result: { name: 'search_posts', result: { ok: true } },
    });
    expect(webContentsSend).toHaveBeenCalledWith('chat-token-usage', expect.objectContaining({
      conversationId: 'conversation-1',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 80,
    }));
  });
});
