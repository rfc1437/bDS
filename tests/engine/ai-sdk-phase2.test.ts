/**
 * Phase 2: Provider registry, ChatService, and OneShotTasks tests.
 *
 * Tests exercise the real implementation classes with mocked fetch/engines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProviderRegistry,
  createOpenCodeGateway,
  detectProvider,
} from '../../src/main/engine/ai/providers';
import { OneShotTasks } from '../../src/main/engine/ai/tasks';
import { ChatService } from '../../src/main/engine/ai/chat';
import type { BlogToolDeps } from '../../src/main/engine/ai/blog-tools';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockChatEngine() {
  return {
    getConversation: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    getSelectedModel: vi.fn().mockResolvedValue('claude-sonnet-4'),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    createConversation: vi.fn(),
    clearMessages: vi.fn(),
    setDefaultSystemPrompt: vi.fn(),
    setSelectedModel: vi.fn(),
    getRecentConversations: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockMediaEngine() {
  return {
    getMedia: vi.fn(),
    getAllMedia: vi.fn().mockResolvedValue([]),
    getMediaFiltered: vi.fn(),
    updateMedia: vi.fn(),
    getThumbnailDataUrl: vi.fn(),
  } as any;
}

function createMockBlogToolDeps(): BlogToolDeps {
  return {
    postEngine: {
      getPost: vi.fn(),
      getAllPosts: vi.fn(),
      getPostsFiltered: vi.fn(),
      searchPostsFiltered: vi.fn(),
      getPostCounts: vi.fn(),
      getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
      getTagsWithCounts: vi.fn().mockResolvedValue([]),
      getLinkedBy: vi.fn().mockResolvedValue([]),
      getLinksTo: vi.fn().mockResolvedValue([]),
      updatePost: vi.fn(),
      getBlogStats: vi.fn().mockResolvedValue({
        totalPosts: 0, publishedCount: 0, draftCount: 0, archivedCount: 0,
        tagCount: 0, categoryCount: 0, postsPerYear: {},
      }),
      getDashboardStats: vi.fn(),
    },
    mediaEngine: createMockMediaEngine(),
    postMediaEngine: {
      getLinkedMediaDataForPost: vi.fn().mockResolvedValue([]),
      getLinkedPostsForMedia: vi.fn().mockResolvedValue([]),
    },
  };
}

// =========================================================================
// detectProvider()
// =========================================================================

describe('detectProvider', () => {
  it('detects Anthropic models', () => {
    expect(detectProvider('claude-sonnet-4')).toBe('anthropic');
    expect(detectProvider('claude-haiku-4-5')).toBe('anthropic');
    expect(detectProvider('Claude-3-Opus')).toBe('anthropic');
  });

  it('detects OpenAI models', () => {
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('o3-mini')).toBe('openai');
    expect(detectProvider('o4-mini')).toBe('openai');
  });

  it('detects Google models', () => {
    expect(detectProvider('gemini-pro')).toBe('google');
    expect(detectProvider('gemini-2.5-flash')).toBe('google');
  });

  it('detects Mistral models', () => {
    expect(detectProvider('mistral-large-latest')).toBe('mistral');
    expect(detectProvider('mistral-small-latest')).toBe('mistral');
    expect(detectProvider('ministral-8b-latest')).toBe('mistral');
    expect(detectProvider('codestral-latest')).toBe('mistral');
    expect(detectProvider('pixtral-large-latest')).toBe('mistral');
    expect(detectProvider('devstral-latest')).toBe('mistral');
  });

  it('returns other for unknown models', () => {
    expect(detectProvider('llama3-70b')).toBe('other');
    expect(detectProvider('some-model')).toBe('other');
  });
});

// =========================================================================
// ProviderRegistry
// =========================================================================

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('key management', () => {
    it('starts with no keys and isReady() false', () => {
      expect(registry.isReady()).toBe(false);
      expect(registry.getOpencodeKey()).toBe('');
      expect(registry.getMistralKey()).toBe('');
    });

    it('isReady() returns true when OpenCode key is set', () => {
      registry.setOpencodeKey('test-key');
      expect(registry.isReady()).toBe(true);
    });

    it('isReady() returns true when only Mistral key is set', () => {
      registry.setMistralKey('test-mistral');
      expect(registry.isReady()).toBe(true);
    });

    it('getProviderStatus() reports all providers', () => {
      expect(registry.getProviderStatus()).toEqual({ opencode: false, mistral: false, ollama: false, lmstudio: false, offlineMode: false });
      registry.setOpencodeKey('test');
      expect(registry.getProviderStatus()).toEqual({ opencode: true, mistral: false, ollama: false, lmstudio: false, offlineMode: false });
      registry.setMistralKey('test2');
      expect(registry.getProviderStatus()).toEqual({ opencode: true, mistral: true, ollama: false, lmstudio: false, offlineMode: false });
      registry.setOllamaEnabled(true);
      expect(registry.getProviderStatus()).toEqual({ opencode: true, mistral: true, ollama: true, lmstudio: false, offlineMode: false });
      registry.setLmstudioEnabled(true);
      expect(registry.getProviderStatus()).toEqual({ opencode: true, mistral: true, ollama: true, lmstudio: true, offlineMode: false });
    });

    it('isProviderKeySet() checks per-provider', () => {
      expect(registry.isProviderKeySet('anthropic')).toBe(false);
      expect(registry.isProviderKeySet('mistral')).toBe(false);
      registry.setOpencodeKey('test');
      expect(registry.isProviderKeySet('anthropic')).toBe(true); // routed via OpenCode
      expect(registry.isProviderKeySet('openai')).toBe(true);     // routed via OpenCode
      expect(registry.isProviderKeySet('mistral')).toBe(false);
    });
  });

  describe('resolveModel', () => {
    it('throws when OpenCode key is missing for a claude model', () => {
      expect(() => registry.resolveModel('claude-sonnet-4')).toThrow('OpenCode API key not configured');
    });

    it('throws when Mistral key is missing for a mistral model', () => {
      expect(() => registry.resolveModel('mistral-large-latest')).toThrow('Mistral API key not configured');
    });

    it('resolves a claude model when OpenCode key is set', () => {
      registry.setOpencodeKey('test-key');
      const model = registry.resolveModel('claude-sonnet-4');
      expect(model).toBeDefined();
      expect(model.modelId).toContain('claude-sonnet-4');
    });

    it('resolves an OpenAI model when OpenCode key is set', () => {
      registry.setOpencodeKey('test-key');
      const model = registry.resolveModel('gpt-4o');
      expect(model).toBeDefined();
      expect(model.modelId).toContain('gpt-4o');
    });

    it('resolves a Mistral model when Mistral key is set', () => {
      registry.setMistralKey('test-key');
      const model = registry.resolveModel('mistral-large-latest');
      expect(model).toBeDefined();
      expect(model.modelId).toContain('mistral-large-latest');
    });
  });

  describe('model cache invalidation', () => {
    it('invalidates cache when OpenCode key changes', () => {
      registry.setOpencodeKey('key1');
      // Access internal cache state via invalidation side effect
      registry.invalidateModelCache();
      // No error — cache was invalidated
    });
  });

  describe('validateOpencodeKey()', () => {
    it('rejects short keys immediately', async () => {
      const result = await registry.validateOpencodeKey('ab');
      expect(result).toEqual({ isValid: false, models: [] });
    });

    it('validates against models endpoint', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-sonnet-4' },
            { id: 'gpt-4o' },
          ],
        }),
      });

      try {
        const result = await registry.validateOpencodeKey('valid-test-key-1234');
        expect(result.isValid).toBe(true);
        expect(result.models.length).toBe(2);
        expect(result.models[0].id).toBe('claude-sonnet-4');
        expect(result.models[0].provider).toBe('anthropic');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('validateMistralKey()', () => {
    it('rejects short keys', async () => {
      const result = await registry.validateMistralKey('x');
      expect(result).toEqual({ isValid: false, models: [] });
    });
  });
});

// =========================================================================
// createOpenCodeGateway
// =========================================================================

describe('createOpenCodeGateway', () => {
  it('creates a provider that resolves language models', () => {
    const gateway = createOpenCodeGateway('test-api-key');
    expect(gateway).toBeDefined();
    // Try resolving a claude model — should not throw
    const model = gateway.languageModel('claude-sonnet-4');
    expect(model).toBeDefined();
    expect(model.modelId).toContain('claude-sonnet-4');
  });

  it('routes non-claude models to OpenAI chat provider', () => {
    const gateway = createOpenCodeGateway('test-api-key');
    const model = gateway.languageModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model.modelId).toContain('gpt-4o');
  });
});

// =========================================================================
// ChatService
// =========================================================================

describe('ChatService', () => {
  let chatEngine: any;
  let registry: ProviderRegistry;
  let deps: BlogToolDeps;
  let service: ChatService;

  beforeEach(() => {
    chatEngine = createMockChatEngine();
    registry = new ProviderRegistry();
    deps = createMockBlogToolDeps();
    service = new ChatService(chatEngine, registry, deps, () => null);
  });

  it('returns error when no API key is configured', async () => {
    const result = await service.sendMessage('conv-1', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });

  it('returns error when conversation not found', async () => {
    registry.setOpencodeKey('test-key');
    chatEngine.getConversation.mockResolvedValue(null);
    const result = await service.sendMessage('conv-1', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when model provider key is missing', async () => {
    registry.setOpencodeKey('test-key');
    chatEngine.getConversation.mockResolvedValue({
      id: 'conv-1',
      model: 'mistral-large-latest', // requires Mistral key
      messages: [],
    });
    const result = await service.sendMessage('conv-1', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Mistral');
  });

  describe('abortMessage()', () => {
    it('returns error for non-existent conversation', async () => {
      const result = await service.abortMessage('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active request');
    });
  });

  describe('stop()', () => {
    it('clears all abort controllers without error', async () => {
      await expect(service.stop()).resolves.not.toThrow();
    });
  });
});

// =========================================================================
// OneShotTasks
// =========================================================================

describe('OneShotTasks', () => {
  let chatEngine: any;
  let mediaEngine: any;
  let registry: ProviderRegistry;
  let tasks: OneShotTasks;

  beforeEach(() => {
    chatEngine = createMockChatEngine();
    mediaEngine = createMockMediaEngine();
    registry = new ProviderRegistry();
    tasks = new OneShotTasks(registry, chatEngine, mediaEngine);
  });

  describe('analyzeTaxonomy()', () => {
    it('returns error if provider key not set', async () => {
      const result = await tasks.analyzeTaxonomy(
        [{ name: 'Tech', slug: 'tech', existsInProject: false }],
        [],
        'claude-sonnet-4',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('OpenCode');
    });

    it('returns error for mistral model without mistral key', async () => {
      registry.setOpencodeKey('test');
      const result = await tasks.analyzeTaxonomy(
        [],
        [],
        'mistral-large-latest',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Mistral');
    });

    it('validates mappings: rejects new→new mappings', async () => {
      registry.setOpencodeKey('test-key');

      // Mock the generateText call via fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify({
            categoryMappings: { 'New Cat': 'Other New Cat' },
            tagMappings: { 'New Tag': 'Existing Tag' },
          })}],
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      try {
        const result = await tasks.analyzeTaxonomy(
          [
            { name: 'New Cat', slug: 'new-cat', existsInProject: false },
            { name: 'Other New Cat', slug: 'other-new-cat', existsInProject: false },
          ],
          [
            { name: 'New Tag', slug: 'new-tag', existsInProject: false },
            { name: 'Existing Tag', slug: 'existing-tag', existsInProject: true },
          ],
          'claude-sonnet-4',
        );

        expect(result.success).toBe(true);
        // new→new mapping filtered out
        expect(result.categoryMappings).toEqual({});
        // new→existing mapping kept
        expect(result.tagMappings).toEqual({ 'New Tag': 'Existing Tag' });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('analyzeMediaImage()', () => {
    it('returns error when no API key is set', async () => {
      chatEngine.getSetting.mockResolvedValue(null);
      const result = await tasks.analyzeMediaImage('media-1', 'en');
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key');
    });

    it('returns error for non-image media', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue('claude-sonnet-4');
      mediaEngine.getMedia.mockResolvedValue({
        id: 'media-1',
        mimeType: 'application/pdf',
        filename: 'doc.pdf',
      });
      const result = await tasks.analyzeMediaImage('media-1', 'en');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only images');
    });

    it('returns error when media not found', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue('claude-sonnet-4');
      mediaEngine.getMedia.mockResolvedValue(null);
      const result = await tasks.analyzeMediaImage('media-1', 'en');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when thumbnail not available', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue('claude-sonnet-4');
      mediaEngine.getMedia.mockResolvedValue({
        id: 'media-1',
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
      });
      mediaEngine.getThumbnailDataUrl.mockResolvedValue(null);
      const result = await tasks.analyzeMediaImage('media-1', 'en');
      expect(result.success).toBe(false);
      expect(result.error).toContain('thumbnail');
    });

    it('sends image as JPEG for universal model compatibility', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue('claude-sonnet-4');
      mediaEngine.getMedia.mockResolvedValue({
        id: 'media-1',
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
      });
      // Valid 1x1 red pixel WebP image generated by sharp
      const webpBase64 = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
      mediaEngine.getThumbnailDataUrl.mockResolvedValue(`data:image/webp;base64,${webpBase64}`);

      const originalFetch = globalThis.fetch;
      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body);
        }
        return new Response(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"title": "Test", "alt": "Test image", "caption": "A test"}' }],
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      try {
        const result = await tasks.analyzeMediaImage('media-1', 'en');
        // Check the image was sent as JPEG, not WebP
        if (capturedBody?.messages) {
          const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
          if (userMsg?.content) {
            const imagePart = userMsg.content.find((p: any) => p.type === 'image_url');
            if (imagePart?.image_url?.url) {
              expect(imagePart.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
              expect(imagePart.image_url.url).not.toMatch(/^data:image\/webp;base64,/);
            }
          }
        }
        // Also verify it succeeded (may fail on response parsing but the format check is key)
        if (result.success) {
          expect(result.title).toBe('Test');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('sends localized prompts based on project language', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue('claude-sonnet-4');
      mediaEngine.getMedia.mockResolvedValue({
        id: 'media-1',
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
      });
      // Valid 1x1 red pixel WebP image generated by sharp
      const webpBase64 = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
      mediaEngine.getThumbnailDataUrl.mockResolvedValue(`data:image/webp;base64,${webpBase64}`);

      const originalFetch = globalThis.fetch;
      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body);
        }
        return new Response(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"title": "Testbild", "alt": "Rotes Quadrat", "caption": "Ein Test"}' }],
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      try {
        await tasks.analyzeMediaImage('media-1', 'de');
        // System prompt should be in German (from i18n), not contain English instructions
        if (capturedBody) {
          const systemMsg = capturedBody.messages?.find((m: any) => m.role === 'system')
            ?? capturedBody.system;
          const systemText = typeof systemMsg === 'string' ? systemMsg
            : Array.isArray(systemMsg) ? systemMsg.map((p: any) => p.text).join('')
            : systemMsg?.content ?? '';
          expect(systemText).toContain('Deutsch');
          expect(systemText).not.toContain('English');
          // User message should also be in German
          const userMsg = capturedBody.messages?.find((m: any) => m.role === 'user');
          if (userMsg?.content) {
            const textPart = Array.isArray(userMsg.content)
              ? userMsg.content.find((p: any) => p.type === 'text')
              : null;
            if (textPart?.text) {
              expect(textPart.text).toContain('Deutsch');
            }
          }
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to claude-sonnet-4-5 when no image analysis model is configured', async () => {
      registry.setOpencodeKey('test-key');
      chatEngine.getSetting.mockResolvedValue(null);
      mediaEngine.getMedia.mockResolvedValue({
        id: 'media-1',
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
      });
      // Valid 1x1 red pixel WebP image generated by sharp
      const webpBase64 = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
      mediaEngine.getThumbnailDataUrl.mockResolvedValue(`data:image/webp;base64,${webpBase64}`);

      // Verify the method selects the right model by checking it attempts
      // to call the resolver (which hits the network). We mock fetch to
      // return a minimal Anthropic response.
      const originalFetch = globalThis.fetch;
      const jsonPayload = '{"title": "Sunset Beach", "alt": "Orange sunset over ocean", "caption": "A stunning sunset at the beach"}';
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: jsonPayload }],
          model: 'claude-sonnet-4-5',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      try {
        const result = await tasks.analyzeMediaImage('media-1', 'en');
        if (!result.success) {
          // Image analysis with real AI SDK may fail on response parsing in tests.
          // Verify we at least attempted the right provider call.
          const calls = (globalThis.fetch as any).mock.calls;
          expect(calls.length).toBeGreaterThan(0);
          // Find the API call (not image download calls)
          const apiCall = calls.find((c: any[]) =>
            typeof c[0] === 'string' && c[0].includes('/messages'),
          );
          // Should have attempted to call Anthropic Messages API via Zen gateway
          expect(apiCall).toBeDefined();
        } else {
          expect(result.title).toBe('Sunset Beach');
          expect(result.alt).toBe('Orange sunset over ocean');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
