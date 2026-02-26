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
        getSetting: vi.fn(async (key: string) => (key === 'opencode_api_key' ? 'stored-key' : null)),
        setSetting: vi.fn(async () => undefined),
        getSelectedModel: vi.fn(async () => 'gpt-5'),
        getDefaultSystemPrompt: vi.fn(async () => 'system prompt'),
      };
      chatEngineInstances.push(instance);
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
        sendMessage: vi.fn(async (_conversationId: string, _message: string, options: any) => {
          options?.onDelta?.('stream-delta');
          options?.onToolCall?.({ name: 'search_posts', args: { query: 'q' } });
          options?.onToolResult?.({ name: 'search_posts', result: { ok: true } });
          return {
            success: true,
            message: 'assistant reply',
          };
        }),
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

describe('chatHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    webContentsSend.mockReset();
    chatEngineInstances.length = 0;
    openCodeManagerInstances.length = 0;
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    await mod.cleanupChatHandlers();
  });

  it('streams sendMessage callbacks through main window events', async () => {
    const mod = await import('../../src/main/ipc/chatHandlers');
    mod.initializeChatHandlers(() => mainWindowMock as never);
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

    const manager = openCodeManagerInstances[0];
    expect(manager.setApiKey).toHaveBeenCalledWith('stored-key');
    expect(manager.sendMessage).toHaveBeenCalledWith(
      'conversation-1',
      'hello assistant',
      expect.objectContaining({
        metadata: { surface: 'sidebar' },
        onDelta: expect.any(Function),
        onToolCall: expect.any(Function),
        onToolResult: expect.any(Function),
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
  });
});
