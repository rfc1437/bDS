import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStreamText, mockGenerateText } = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockGenerateText: vi.fn(),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    streamText: mockStreamText,
    generateText: mockGenerateText,
    stepCountIs: vi.fn(() => undefined),
  };
});

vi.mock('../../src/main/engine/ModelCatalogEngine', () => ({
  ModelCatalogEngine: class {
    getAll = vi.fn().mockResolvedValue([]);
    getContextWindow = vi.fn().mockResolvedValue(8192);
  },
}));

import { ChatService } from '../../src/main/engine/ai/chat';
import { ProviderRegistry } from '../../src/main/engine/ai/providers';

function createChatEngine() {
  return {
    getConversation: vi.fn(async () => ({
      id: 'conv-1',
      title: 'Untitled',
      model: 'generic-model',
      createdAt: new Date(),
      messages: [],
    })),
    addMessage: vi.fn(async () => undefined),
    getDefaultSystemPrompt: vi.fn(async () => 'You are a helpful assistant'),
    getSetting: vi.fn(async (key: string) => {
      if (key === 'chat_title_model') {
        return 'generic-model';
      }
      return null;
    }),
    updateConversation: vi.fn(async () => undefined),
  } as any;
}

describe('ChatService generic OpenAI endpoint support', () => {
  let registry: ProviderRegistry;
  let chatEngine: ReturnType<typeof createChatEngine>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStreamText.mockResolvedValue({
      response: Promise.resolve(),
      usage: Promise.resolve(undefined),
      text: Promise.resolve('assistant reply'),
    });
    mockGenerateText.mockResolvedValue({ text: 'Generic Title' });

    registry = new ProviderRegistry();
    registry.setGenericOpenAIEnabled(true);
    registry.setGenericOpenAIBaseURL('http://localhost:4000/v1');
    registry.registerGenericOpenAIModel('generic-model');
    vi.spyOn(registry, 'resolveModel').mockReturnValue({ modelId: 'generic-model' } as any);

    chatEngine = createChatEngine();
  });

  it('skips tools for generic models when tools capability is disabled', async () => {
    registry.setGenericOpenAIModelCapabilities('generic-model', { tools: false, vision: false });

    const service = new ChatService(chatEngine, registry, {
      postEngine: {} as any,
      mediaEngine: {} as any,
      postMediaEngine: {} as any,
    }, () => null);

    const result = await service.sendMessage('conv-1', 'Hello');

    expect(result.success).toBe(true);
    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
      tools: undefined,
    }));
  });

  it('generates a title with the configured generic endpoint title model', async () => {
    registry.setGenericOpenAIModelCapabilities('generic-model', { tools: false, vision: false });

    const service = new ChatService(chatEngine, registry, {
      postEngine: {} as any,
      mediaEngine: {} as any,
      postMediaEngine: {} as any,
    }, () => null);

    await (service as any).generateConversationTitle('conv-1', 'Hello');

    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.anything(),
      prompt: 'Topic: Hello',
    }));
    expect(chatEngine.updateConversation).toHaveBeenCalledWith('conv-1', { title: 'Generic Title' });
  });
});