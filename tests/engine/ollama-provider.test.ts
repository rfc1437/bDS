/**
 * Tests for Ollama provider integration in ProviderRegistry.
 *
 * Ollama provides an OpenAI-compatible API at http://localhost:11434/v1
 * and a native /api/tags endpoint for model listing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry, detectProvider, OLLAMA_BASE_URL, OLLAMA_TAGS_URL } from '../../src/main/engine/ai/providers';

// Mock ModelCatalogEngine — no DB in unit tests
vi.mock('../../src/main/engine/ModelCatalogEngine', () => ({
  ModelCatalogEngine: class {
    getAll = vi.fn().mockResolvedValue([]);
    getContextWindow = vi.fn().mockResolvedValue(null);
  },
}));

describe('Ollama provider support', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  // ---- Constants ----

  it('exports Ollama URL constants', () => {
    expect(OLLAMA_BASE_URL).toBe('http://localhost:11434/v1');
    expect(OLLAMA_TAGS_URL).toBe('http://localhost:11434/api/tags');
  });

  // ---- detectProvider ----

  it('detectProvider returns "ollama" for ollama-prefixed model IDs', () => {
    // Ollama model IDs don't have a fixed prefix — they're arbitrary names.
    // detectProvider won't match them. Instead, ProviderRegistry tracks which
    // models came from Ollama separately. detectProvider returns 'other' for unknown.
    expect(detectProvider('llama3:latest')).toBe('other');
    expect(detectProvider('qwen2.5-coder:7b')).toBe('other');
  });

  // ---- Ollama enable/disable ----

  it('is not enabled by default', () => {
    expect(registry.isOllamaEnabled()).toBe(false);
  });

  it('can be enabled and disabled', () => {
    registry.setOllamaEnabled(true);
    expect(registry.isOllamaEnabled()).toBe(true);
    registry.setOllamaEnabled(false);
    expect(registry.isOllamaEnabled()).toBe(false);
  });

  it('enabling Ollama invalidates model cache', () => {
    // Populate cache
    registry['cachedModels'] = [{ id: 'test', name: 'test', provider: 'other' }];
    registry['cachedModelsAt'] = Date.now();

    registry.setOllamaEnabled(true);

    expect(registry['cachedModels']).toBeNull();
    expect(registry['cachedModelsAt']).toBe(0);
  });

  // ---- Provider status ----

  it('getProviderStatus includes ollama field', () => {
    const status = registry.getProviderStatus();
    expect(status).toHaveProperty('ollama');
    expect(status.ollama).toBe(false);

    registry.setOllamaEnabled(true);
    expect(registry.getProviderStatus().ollama).toBe(true);
  });

  // ---- isReady includes ollama ----

  it('isReady returns true when only Ollama is enabled', () => {
    expect(registry.isReady()).toBe(false);
    registry.setOllamaEnabled(true);
    expect(registry.isReady()).toBe(true);
  });

  // ---- isProviderKeySet for ollama ----

  it('isProviderKeySet returns ollama enabled state for provider "ollama"', () => {
    expect(registry.isProviderKeySet('ollama')).toBe(false);
    registry.setOllamaEnabled(true);
    expect(registry.isProviderKeySet('ollama')).toBe(true);
  });

  // ---- resolveModel for ollama ----

  it('resolveModel creates an OpenAI-compatible model for Ollama models', () => {
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3:latest');

    const model = registry.resolveModel('llama3:latest');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('llama3:latest');
  });

  it('resolveModel throws when Ollama is disabled', () => {
    registry.registerOllamaModel('llama3:latest');
    expect(() => registry.resolveModel('llama3:latest')).toThrow(/not configured/i);
  });

  // ---- Ollama model registration ----

  it('tracks registered Ollama model IDs', () => {
    expect(registry.isOllamaModel('llama3:latest')).toBe(false);
    registry.registerOllamaModel('llama3:latest');
    expect(registry.isOllamaModel('llama3:latest')).toBe(true);
  });

  it('clearOllamaModels removes all registered models', () => {
    registry.registerOllamaModel('llama3:latest');
    registry.registerOllamaModel('qwen2.5-coder:7b');
    registry.clearOllamaModels();
    expect(registry.isOllamaModel('llama3:latest')).toBe(false);
    expect(registry.isOllamaModel('qwen2.5-coder:7b')).toBe(false);
  });

  // ---- fetchOllamaModels ----

  it('fetchOllamaModels calls the Ollama tags endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:latest', details: { family: 'llama' } },
          { name: 'qwen2.5-coder:7b', details: { family: 'qwen2' } },
        ],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.fetchOllamaModels();
      expect(mockFetch).toHaveBeenCalledWith(
        OLLAMA_TAGS_URL,
        expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
      );
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({ id: 'llama3:latest', name: 'llama3:latest', provider: 'ollama' });
      expect(models[1]).toMatchObject({ id: 'qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', provider: 'ollama' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchOllamaModels returns empty array on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.fetchOllamaModels();
      expect(models).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchOllamaModels registers returned models', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3:latest', details: {} }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await registry.fetchOllamaModels();
      expect(registry.isOllamaModel('llama3:latest')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---- getAvailableModels includes Ollama when enabled ----

  it('getAvailableModels includes Ollama models when enabled', async () => {
    registry.setOllamaEnabled(true);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3:latest', details: {} }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.getAvailableModels();
      const ollamaModels = models.filter(m => m.provider === 'ollama');
      expect(ollamaModels.length).toBeGreaterThanOrEqual(1);
      expect(ollamaModels[0].id).toBe('llama3:latest');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('getAvailableModels excludes Ollama models when disabled', async () => {
    registry.setOllamaEnabled(false);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3:latest', details: {} }] }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.getAvailableModels();
      const ollamaModels = models.filter(m => m.provider === 'ollama');
      expect(ollamaModels).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---- Ollama model capability overrides ----

  describe('model capability overrides', () => {
    it('returns default capabilities (tools=false, vision=false) for unknown model', () => {
      const caps = registry.getOllamaModelCapabilities('unknown-model');
      expect(caps).toEqual({ tools: false, vision: false });
    });

    it('stores and retrieves capability overrides for a model', () => {
      registry.setOllamaModelCapabilities('llama3:latest', { tools: true, vision: false });
      expect(registry.getOllamaModelCapabilities('llama3:latest')).toEqual({ tools: true, vision: false });
    });

    it('stores vision capability override', () => {
      registry.setOllamaModelCapabilities('llava:latest', { tools: false, vision: true });
      expect(registry.getOllamaModelCapabilities('llava:latest')).toEqual({ tools: false, vision: true });
    });

    it('supports both capabilities enabled', () => {
      registry.setOllamaModelCapabilities('qwen2.5:latest', { tools: true, vision: true });
      expect(registry.getOllamaModelCapabilities('qwen2.5:latest')).toEqual({ tools: true, vision: true });
    });

    it('getAllOllamaModelCapabilities returns all stored overrides', () => {
      registry.setOllamaModelCapabilities('model-a', { tools: true, vision: false });
      registry.setOllamaModelCapabilities('model-b', { tools: false, vision: true });
      const all = registry.getAllOllamaModelCapabilities();
      expect(all).toEqual({
        'model-a': { tools: true, vision: false },
        'model-b': { tools: false, vision: true },
      });
    });

    it('getAllOllamaModelCapabilities returns empty object when no overrides', () => {
      expect(registry.getAllOllamaModelCapabilities()).toEqual({});
    });

    it('loadOllamaModelCapabilities restores from serialized JSON', () => {
      const data = { 'llama3:latest': { tools: true, vision: false } };
      registry.loadOllamaModelCapabilities(data);
      expect(registry.getOllamaModelCapabilities('llama3:latest')).toEqual({ tools: true, vision: false });
    });

    it('ollamaModelSupportsTools returns false by default', () => {
      expect(registry.ollamaModelSupportsTools('unknown')).toBe(false);
    });

    it('ollamaModelSupportsTools returns true when override is set', () => {
      registry.setOllamaModelCapabilities('qwen2.5:latest', { tools: true, vision: false });
      expect(registry.ollamaModelSupportsTools('qwen2.5:latest')).toBe(true);
    });

    it('ollamaModelSupportsVision returns false by default', () => {
      expect(registry.ollamaModelSupportsVision('unknown')).toBe(false);
    });

    it('ollamaModelSupportsVision returns true when override is set', () => {
      registry.setOllamaModelCapabilities('llava:latest', { tools: false, vision: true });
      expect(registry.ollamaModelSupportsVision('llava:latest')).toBe(true);
    });

    it('fetchOllamaModels applies vision overrides to returned models', async () => {
      registry.setOllamaModelCapabilities('llava:latest', { tools: false, vision: true });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3:latest', details: {} },
            { name: 'llava:latest', details: {} },
          ],
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const models = await registry.fetchOllamaModels();
        expect(models).toHaveLength(2);
        expect(models.find(m => m.id === 'llama3:latest')?.vision).toBe(false);
        expect(models.find(m => m.id === 'llava:latest')?.vision).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
