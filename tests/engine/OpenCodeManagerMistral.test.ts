/**
 * OpenCodeManager Mistral Integration Tests
 *
 * Tests for Mistral AI as a first-class alternative provider:
 * - detectProvider() for Mistral model prefixes
 * - Mistral API key storage and retrieval
 * - checkReady() multi-provider support
 * - getAvailableModels() merge from both providers
 * - getProviderConfig() helper
 * - isProviderKeySet() helper
 * - MODEL_CONTEXT_BUDGETS correctness
 * - MODEL_CAPABILITIES (vision flags)
 * - validateMistralApiKey()
 * - Provider-aware routing in sendOpenAIMessage()
 * - generateConversationTitle() provider routing
 * - analyzeMediaImage() provider-aware routing
 * - analyzeTaxonomy() provider-aware guards
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before importing the class
vi.mock('../../src/main/engine/ChatEngine', () => ({
  ChatEngine: class {
    getSetting = vi.fn().mockResolvedValue(null);
    setSetting = vi.fn().mockResolvedValue(undefined);
    deleteSetting = vi.fn().mockResolvedValue(undefined);
    getSelectedModel = vi.fn().mockResolvedValue('claude-sonnet-4-5');
    getDefaultSystemPrompt = vi.fn().mockResolvedValue('You are a helpful assistant.');
    getConversation = vi.fn();
    addMessage = vi.fn();
    updateConversation = vi.fn();
  },
}));

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({})),
}));

import { OpenCodeManager, type ModelInfo } from '../../src/main/engine/OpenCodeManager';

// Helper to create manager with mocked httpRequest
function createManager(): OpenCodeManager {
  const manager = new OpenCodeManager(
    {
      getSetting: vi.fn().mockResolvedValue(null),
      setSetting: vi.fn().mockResolvedValue(undefined),
      deleteSetting: vi.fn().mockResolvedValue(undefined),
      getSelectedModel: vi.fn().mockResolvedValue('claude-sonnet-4-5'),
      getDefaultSystemPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    () => null,
  );
  return manager;
}

// Mock Mistral models API response
function createMistralModelResponse(ids: string[]) {
  return {
    object: 'list',
    data: ids.map(id => ({
      id,
      object: 'model',
      created: 1772132920,
      owned_by: 'mistralai',
    })),
  };
}

// Mock Zen models API response
function createZenModelResponse(ids: string[]) {
  return {
    object: 'list',
    data: ids.map(id => ({
      id,
      object: 'model',
      created: 1772132920,
      owned_by: 'opencode',
    })),
  };
}

describe('OpenCodeManager Mistral integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('detectProvider', () => {
    it('detects mistral model prefixes', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('mistral-large-latest')).toBe('mistral');
      expect(detect('mistral-medium-latest')).toBe('mistral');
      expect(detect('mistral-small-latest')).toBe('mistral');
    });

    it('detects devstral model prefix', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('devstral-small-latest')).toBe('mistral');
      expect(detect('devstral-large-latest')).toBe('mistral');
    });

    it('detects codestral model prefix', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('codestral-latest')).toBe('mistral');
    });

    it('detects pixtral model prefix', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('pixtral-large-latest')).toBe('mistral');
    });

    it('detects ministral model prefix', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('ministral-8b-latest')).toBe('mistral');
    });

    it('still detects anthropic, openai, google providers', () => {
      const manager = createManager();
      const detect = (manager as any).detectProvider.bind(manager);

      expect(detect('claude-sonnet-4')).toBe('anthropic');
      expect(detect('gpt-5')).toBe('openai');
      expect(detect('gemini-3-pro')).toBe('google');
    });
  });

  describe('Mistral API key management', () => {
    it('stores and retrieves Mistral API key', () => {
      const manager = createManager();

      expect(manager.getMistralApiKey()).toBe('');

      manager.setMistralApiKey('mist-test-key-123');
      expect(manager.getMistralApiKey()).toBe('mist-test-key-123');
    });

    it('invalidates model cache when Mistral key changes', async () => {
      const manager = createManager();
      manager.setApiKey('opencode-key');

      // Prime the cache
      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(createZenModelResponse(['claude-sonnet-4'])),
      });
      await manager.getAvailableModels();

      // Set Mistral key — should clear cache
      manager.setMistralApiKey('mist-key');
      expect((manager as any).cachedModels).toBeNull();
    });
  });

  describe('checkReady', () => {
    it('returns ready when only OpenCode key is set', async () => {
      const manager = createManager();
      manager.setApiKey('opencode-key');

      const result = await manager.checkReady();
      expect(result.ready).toBe(true);
      expect(result.providers?.opencode).toBe(true);
      expect(result.providers?.mistral).toBe(false);
    });

    it('returns ready when only Mistral key is set', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mistral-key');

      const result = await manager.checkReady();
      expect(result.ready).toBe(true);
      expect(result.providers?.opencode).toBe(false);
      expect(result.providers?.mistral).toBe(true);
    });

    it('returns ready when both keys are set', async () => {
      const manager = createManager();
      manager.setApiKey('opencode-key');
      manager.setMistralApiKey('mistral-key');

      const result = await manager.checkReady();
      expect(result.ready).toBe(true);
      expect(result.providers?.opencode).toBe(true);
      expect(result.providers?.mistral).toBe(true);
    });

    it('returns not ready when no keys are set', async () => {
      const manager = createManager();

      const result = await manager.checkReady();
      expect(result.ready).toBe(false);
      expect(result.providers?.opencode).toBe(false);
      expect(result.providers?.mistral).toBe(false);
    });
  });

  describe('isProviderKeySet', () => {
    it('checks OpenCode key availability', () => {
      const manager = createManager();
      const check = (manager as any).isProviderKeySet.bind(manager);

      expect(check('opencode')).toBe(false);
      expect(check('anthropic')).toBe(false);
      expect(check('openai')).toBe(false);

      manager.setApiKey('key');
      expect(check('opencode')).toBe(true);
      expect(check('anthropic')).toBe(true);
      expect(check('openai')).toBe(true);
      expect(check('google')).toBe(true);
      expect(check('other')).toBe(true);
    });

    it('checks Mistral key availability', () => {
      const manager = createManager();
      const check = (manager as any).isProviderKeySet.bind(manager);

      expect(check('mistral')).toBe(false);

      manager.setMistralApiKey('key');
      expect(check('mistral')).toBe(true);
    });
  });

  describe('getProviderConfig', () => {
    it('returns OpenCode config for anthropic provider', () => {
      const manager = createManager();
      manager.setApiKey('oc-key');
      const config = (manager as any).getProviderConfig.call(manager, 'anthropic');

      expect(config.apiKey).toBe('oc-key');
    });

    it('returns Mistral config for mistral provider', () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key');
      const config = (manager as any).getProviderConfig.call(manager, 'mistral');

      expect(config.apiKey).toBe('mist-key');
      expect(config.apiUrl).toContain('mistral.ai');
      expect(config.options?.parallelToolCalls).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('returns only OpenCode models when only OpenCode key is set', async () => {
      const manager = createManager();
      manager.setApiKey('oc-key');

      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(createZenModelResponse(['claude-sonnet-4', 'gpt-5'])),
      });

      const models = await manager.getAvailableModels();
      const providers = new Set(models.map((m: ModelInfo) => m.provider));
      expect(providers.has('mistral')).toBe(false);
    });

    it('returns only Mistral models when only Mistral key is set', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key');

      (manager as any).httpRequest = vi.fn().mockImplementation((url: string) => {
        if (url.includes('mistral.ai')) {
          return Promise.resolve({
            statusCode: 200,
            body: JSON.stringify(createMistralModelResponse([
              'mistral-large-latest',
              'mistral-small-latest',
            ])),
          });
        }
        return Promise.reject(new Error('No key'));
      });

      const models = await manager.getAvailableModels();
      expect(models.length).toBe(2);
      expect(models.every((m: ModelInfo) => m.provider === 'mistral')).toBe(true);
    });

    it('merges models from both providers when both keys are set', async () => {
      const manager = createManager();
      manager.setApiKey('oc-key');
      manager.setMistralApiKey('mist-key');

      let callCount = 0;
      (manager as any).httpRequest = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('mistral.ai')) {
          return Promise.resolve({
            statusCode: 200,
            body: JSON.stringify(createMistralModelResponse([
              'mistral-large-latest',
              'mistral-small-latest',
            ])),
          });
        }
        return Promise.resolve({
          statusCode: 200,
          body: JSON.stringify(createZenModelResponse(['claude-sonnet-4', 'gpt-5'])),
        });
      });

      const models = await manager.getAvailableModels();
      expect(models.length).toBe(4);

      const providers = new Set(models.map((m: ModelInfo) => m.provider));
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('mistral')).toBe(true);
    });

    it('includes vision field on models', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key');

      (manager as any).httpRequest = vi.fn().mockImplementation((url: string) => {
        if (url.includes('mistral.ai')) {
          return Promise.resolve({
            statusCode: 200,
            body: JSON.stringify(createMistralModelResponse([
              'mistral-large-latest',
              'devstral-small-latest',
            ])),
          });
        }
        return Promise.reject(new Error('No key'));
      });

      const models = await manager.getAvailableModels();
      const large = models.find((m: ModelInfo) => m.id === 'mistral-large-latest');
      const devstral = models.find((m: ModelInfo) => m.id === 'devstral-small-latest');

      expect(large?.vision).toBe(true);
      expect(devstral?.vision).toBe(false);
    });

    it('fallback model list filters by available provider keys', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key');
      // No OpenCode key set

      (manager as any).httpRequest = vi.fn().mockRejectedValue(new Error('Network error'));

      const models = await manager.getAvailableModels();
      // Should only have Mistral models from fallback
      const providers = new Set(models.map((m: ModelInfo) => m.provider));
      expect(providers.has('mistral')).toBe(true);
      expect(providers.has('anthropic')).toBe(false);
      expect(providers.has('openai')).toBe(false);
    });
  });

  describe('validateMistralApiKey', () => {
    it('validates a correct Mistral API key', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(createMistralModelResponse(['mistral-large-latest'])),
      });

      const result = await manager.validateMistralApiKey('valid-key');
      expect(result.isValid).toBe(true);
      expect(result.models.length).toBeGreaterThan(0);
    });

    it('rejects an invalid Mistral API key', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 401,
        body: '{"message":"Unauthorized"}',
      });

      const result = await manager.validateMistralApiKey('bad-key');
      expect(result.isValid).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('rejects empty key', async () => {
      const manager = createManager();
      const result = await manager.validateMistralApiKey('');
      expect(result.isValid).toBe(false);
    });
  });

  describe('MODEL_DISPLAY_NAMES includes Mistral models', () => {
    it('has display names for all target Mistral models', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('mistral-large-latest')).toBe('Mistral Large');
      expect(format('mistral-medium-latest')).toBe('Mistral Medium');
      expect(format('mistral-small-latest')).toBe('Mistral Small');
      expect(format('devstral-small-latest')).toBe('Devstral Small');
      expect(format('devstral-large-latest')).toBe('Devstral Large');
    });
  });

  describe('generateConversationTitle provider routing', () => {
    it('uses Mistral API when conversation model is a Mistral model', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key');

      const httpMock = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          choices: [{ message: { content: 'Travel Blog' } }],
        }),
      });
      (manager as any).httpRequest = httpMock;

      // Set the title model to mistral
      (manager as any).chatEngine.getSetting = vi.fn().mockImplementation(async (key: string) => {
        if (key === 'chat_title_model') return 'mistral-small-latest';
        return null;
      });

      await (manager as any).generateConversationTitle('conv-1', 'Hello world', 'Response');

      expect(httpMock).toHaveBeenCalled();
      const callUrl = httpMock.mock.calls[0][0];
      expect(callUrl).toContain('mistral.ai');
    });

    it('uses Anthropic API when title model is an Anthropic model', async () => {
      const manager = createManager();
      manager.setApiKey('oc-key');

      const httpMock = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          content: [{ type: 'text', text: 'Travel Blog' }],
        }),
      });
      (manager as any).httpRequest = httpMock;

      // No title model set — defaults to claude-haiku-4-5
      await (manager as any).generateConversationTitle('conv-1', 'Hello world', 'Response');

      expect(httpMock).toHaveBeenCalled();
      const callUrl = httpMock.mock.calls[0][0];
      expect(callUrl).toContain('opencode.ai');
    });
  });

  describe('analyzeTaxonomy provider-aware guards', () => {
    it('returns error when model is Mistral but no Mistral key is set', async () => {
      const manager = createManager();
      manager.setApiKey('oc-key'); // only OpenCode key

      const result = await manager.analyzeTaxonomy(
        [{ name: 'Travel', slug: 'travel', existsInProject: true }],
        [],
        'mistral-large-latest'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key');
    });

    it('returns error when model is OpenCode but no OpenCode key is set', async () => {
      const manager = createManager();
      manager.setMistralApiKey('mist-key'); // only Mistral key

      const result = await manager.analyzeTaxonomy(
        [{ name: 'Travel', slug: 'travel', existsInProject: true }],
        [],
        'claude-sonnet-4'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key');
    });
  });

  describe('analyzeMediaImage provider-aware routing', () => {
    it('returns error when no API key is available for the configured model', async () => {
      const manager = createManager();
      // No keys set at all

      const result = await manager.analyzeMediaImage('media-1', 'en');
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key');
    });
  });
});
