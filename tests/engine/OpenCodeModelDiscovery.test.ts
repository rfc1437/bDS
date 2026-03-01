/**
 * OpenCodeManager Model Discovery Tests
 *
 * Tests the model discovery, display name formatting, and caching behavior.
 * Following TDD: these tests describe the expected behavior.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before importing the class
vi.mock('../../src/main/engine/ChatEngine', () => ({
  ChatEngine: class {
    getSetting = vi.fn();
    setSetting = vi.fn();
    getSelectedModel = vi.fn();
    getDefaultSystemPrompt = vi.fn();
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

import { OpenCodeManager } from '../../src/main/engine/OpenCodeManager';
import type { ChatModel } from '../../src/main/shared/electronApi';

// Helper to create manager with mocked httpRequest
function createManager(): OpenCodeManager {
  const manager = new OpenCodeManager(
    { getSetting: vi.fn(), setSetting: vi.fn() } as never,
    {} as never,
    {} as never,
    () => null,
  );
  manager.setApiKey('test-key');
  return manager;
}

// Mock API response in the Zen format (id, object, created, owned_by — no name field)
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

describe('OpenCodeManager model discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getAvailableModels', () => {
    it('returns models from API with catalog names and catalog-derived vision', async () => {
      const manager = createManager();

      // Mock catalog with modality data and display names
      (manager as any).modelCatalogEngine = {
        getAll: vi.fn().mockResolvedValue([
          { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', inputModalities: ['text', 'image', 'pdf'], outputModalities: ['text'] },
          { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', inputModalities: ['text'], outputModalities: ['text'] },
          { id: 'gemini-3-pro', name: 'Gemini 3 Pro', inputModalities: ['text', 'image', 'video'], outputModalities: ['text'] },
        ]),
        getMaxOutputTokens: vi.fn().mockResolvedValue(16384),
        getContextWindow: vi.fn().mockResolvedValue(null),
      };

      const zenResponse = createZenModelResponse([
        'claude-sonnet-4',
        'gpt-5.1-codex',
        'gemini-3-pro',
      ]);

      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(zenResponse),
      });

      const models = await manager.getAvailableModels();

      expect(models).toHaveLength(3);
      expect(models[0]).toEqual({ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', vision: true });
      expect(models[1]).toEqual({ id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', provider: 'openai', vision: false });
      expect(models[2]).toEqual({ id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google', vision: true });
    });

    it('falls back to model catalog when API fails', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockRejectedValue(new Error('Network error'));
      (manager as any).modelCatalogEngine = {
        getAll: vi.fn().mockResolvedValue([
          { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', inputModalities: ['text', 'image'], outputModalities: ['text'] },
          { id: 'gpt-5', name: 'GPT 5', inputModalities: ['text', 'image'], outputModalities: ['text'] },
        ]),
        getMaxOutputTokens: vi.fn().mockResolvedValue(16384),
        getContextWindow: vi.fn().mockResolvedValue(null),
      };

      const models = await manager.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      const ids = models.map((m: ChatModel) => m.id);
      expect(ids).toContain('claude-sonnet-4');
      expect(ids).toContain('gpt-5');
      const claudeModel = models.find((m: ChatModel) => m.id === 'claude-sonnet-4');
      expect(claudeModel?.provider).toBe('anthropic');
      expect(claudeModel?.name).toBe('Claude Sonnet 4');
      const gptModel = models.find((m: ChatModel) => m.id === 'gpt-5');
      expect(gptModel?.provider).toBe('openai');
      expect(gptModel?.name).toBe('GPT 5');
    });

    it('falls back to model catalog when API returns non-200 status', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 401,
        body: '{"error":"unauthorized"}',
      });
      (manager as any).modelCatalogEngine = {
        getAll: vi.fn().mockResolvedValue([
          { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', inputModalities: ['text', 'image'], outputModalities: ['text'] },
        ]),
        getMaxOutputTokens: vi.fn().mockResolvedValue(16384),
        getContextWindow: vi.fn().mockResolvedValue(null),
      };

      const models = await manager.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      const ids = models.map((m: ChatModel) => m.id);
      expect(ids).toContain('claude-sonnet-4');
    });

    it('caches models and does not re-fetch within TTL', async () => {
      const manager = createManager();
      const httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(createZenModelResponse(['claude-sonnet-4'])),
      });
      (manager as any).httpRequest = httpRequest;

      await manager.getAvailableModels();
      await manager.getAvailableModels();

      expect(httpRequest).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache TTL expires', async () => {
      const manager = createManager();
      const httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(createZenModelResponse(['claude-sonnet-4'])),
      });
      (manager as any).httpRequest = httpRequest;

      await manager.getAvailableModels();
      expect(httpRequest).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      vi.advanceTimersByTime(6 * 60 * 1000);

      await manager.getAvailableModels();
      expect(httpRequest).toHaveBeenCalledTimes(2);
    });

    it('handles unknown model IDs from API with raw IDs as fallback names', async () => {
      const manager = createManager();
      const zenResponse = createZenModelResponse(['some-new-model-v3']);

      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(zenResponse),
      });

      const models = await manager.getAvailableModels();

      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('some-new-model-v3');
      expect(models[0].provider).toBe('other');
    });

    it('falls back to model catalog when no API key is set', async () => {
      const manager = createManager();
      (manager as any).apiKey = '';
      manager.setMistralApiKey('test-key');
      (manager as any).modelCatalogEngine = {
        getAll: vi.fn().mockResolvedValue([
          { id: 'mistral-large-latest', name: 'Mistral Large', inputModalities: ['text', 'image'], outputModalities: ['text'] },
          { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', inputModalities: ['text', 'image'], outputModalities: ['text'] },
        ]),
        getMaxOutputTokens: vi.fn().mockResolvedValue(16384),
        getContextWindow: vi.fn().mockResolvedValue(null),
      };

      const models = await manager.getAvailableModels();

      // Only Mistral models will be in fallback since only Mistral key is set
      expect(models.length).toBeGreaterThan(0);
      const providers = new Set(models.map((m: ChatModel) => m.provider));
      expect(providers.has('mistral')).toBe(true);
      // OpenCode/Anthropic models should be filtered out (no OpenCode key)
      expect(providers.has('anthropic')).toBe(false);
    });
  });
});
