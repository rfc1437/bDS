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

  describe('formatModelName', () => {
    it('formats Claude model IDs with proper spacing', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('claude-opus-4-6')).toBe('Claude Opus 4.6');
      expect(format('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5');
      expect(format('claude-sonnet-4')).toBe('Claude Sonnet 4');
      expect(format('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
      expect(format('claude-3-5-haiku')).toBe('Claude 3.5 Haiku');
    });

    it('formats GPT model IDs with uppercase prefix', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('gpt-5')).toBe('GPT 5');
      expect(format('gpt-5.1')).toBe('GPT 5.1');
      expect(format('gpt-5.1-codex')).toBe('GPT 5.1 Codex');
      expect(format('gpt-5.1-codex-max')).toBe('GPT 5.1 Codex Max');
      expect(format('gpt-5.1-codex-mini')).toBe('GPT 5.1 Codex Mini');
      expect(format('gpt-5-nano')).toBe('GPT 5 Nano');
      expect(format('gpt-5.3-codex')).toBe('GPT 5.3 Codex');
    });

    it('formats GLM model IDs with uppercase prefix', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('glm-5')).toBe('GLM 5');
      expect(format('glm-4.7')).toBe('GLM 4.7');
      expect(format('glm-4.6')).toBe('GLM 4.6');
    });

    it('formats Gemini model IDs properly', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('gemini-3-pro')).toBe('Gemini 3 Pro');
      expect(format('gemini-3-flash')).toBe('Gemini 3 Flash');
      expect(format('gemini-3.1-pro')).toBe('Gemini 3.1 Pro');
    });

    it('formats free/preview suffixes', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('gpt-5-nano')).toBe('GPT 5 Nano');
      expect(format('minimax-m2.5-free')).toBe('MiniMax M2.5 Free');
      expect(format('kimi-k2.5-free')).toBe('Kimi K2.5 Free');
      expect(format('trinity-large-preview-free')).toBe('Trinity Large Preview Free');
    });

    it('formats other provider model IDs', () => {
      const manager = createManager();
      const format = (manager as any).formatModelName.bind(manager);

      expect(format('minimax-m2.5')).toBe('MiniMax M2.5');
      expect(format('minimax-m2.1')).toBe('MiniMax M2.1');
      expect(format('kimi-k2.5')).toBe('Kimi K2.5');
      expect(format('kimi-k2')).toBe('Kimi K2');
      expect(format('kimi-k2-thinking')).toBe('Kimi K2 Thinking');
      expect(format('qwen3-coder')).toBe('Qwen3 Coder');
      expect(format('big-pickle')).toBe('Big Pickle');
    });
  });

  describe('getAvailableModels', () => {
    it('returns models from API with proper names and providers', async () => {
      const manager = createManager();
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

    it('falls back to known models when API fails', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockRejectedValue(new Error('Network error'));

      const models = await manager.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      // Should include well-known models from the display name map
      const ids = models.map((m: ChatModel) => m.id);
      expect(ids).toContain('claude-sonnet-4');
      expect(ids).toContain('gpt-5');
      // Every model should have proper provider detection
      const claudeModel = models.find((m: ChatModel) => m.id === 'claude-sonnet-4');
      expect(claudeModel?.provider).toBe('anthropic');
      const gptModel = models.find((m: ChatModel) => m.id === 'gpt-5');
      expect(gptModel?.provider).toBe('openai');
    });

    it('falls back when API returns non-200 status', async () => {
      const manager = createManager();
      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 401,
        body: '{"error":"unauthorized"}',
      });

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

    it('handles unknown model IDs from API with auto-formatting', async () => {
      const manager = createManager();
      const zenResponse = createZenModelResponse(['some-new-model-v3']);

      (manager as any).httpRequest = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(zenResponse),
      });

      const models = await manager.getAvailableModels();

      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('Some New Model V3');
      expect(models[0].provider).toBe('other');
    });

    it('falls back to known models when no API key is set', async () => {
      const manager = createManager();
      (manager as any).apiKey = '';
      // Set a key so fallback filtering works (at least one provider must have a key)
      manager.setMistralApiKey('test-key');

      const models = await manager.getAvailableModels();

      // Only Mistral models will be in fallback since only Mistral key is set
      expect(models.length).toBeGreaterThan(0);
      const providers = new Set(models.map((m: ChatModel) => m.provider));
      expect(providers.has('mistral')).toBe(true);
    });
  });
});
