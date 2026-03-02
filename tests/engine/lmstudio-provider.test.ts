/**
 * Tests for LM Studio provider integration in ProviderRegistry.
 *
 * LM Studio provides an OpenAI-compatible API at http://localhost:1234/v1
 * with a standard /v1/models endpoint for model listing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry, LMSTUDIO_BASE_URL, LMSTUDIO_MODELS_URL } from '../../src/main/engine/ai/providers';

// Mock ModelCatalogEngine — no DB in unit tests
vi.mock('../../src/main/engine/ModelCatalogEngine', () => ({
  ModelCatalogEngine: class {
    getAll = vi.fn().mockResolvedValue([]);
    getContextWindow = vi.fn().mockResolvedValue(null);
  },
}));

describe('LM Studio provider support', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  // ---- Constants ----

  it('exports LM Studio URL constants', () => {
    expect(LMSTUDIO_BASE_URL).toBe('http://localhost:1234/v1');
    expect(LMSTUDIO_MODELS_URL).toBe('http://localhost:1234/v1/models');
  });

  // ---- LM Studio enable/disable ----

  it('is not enabled by default', () => {
    expect(registry.isLmstudioEnabled()).toBe(false);
  });

  it('can be enabled and disabled', () => {
    registry.setLmstudioEnabled(true);
    expect(registry.isLmstudioEnabled()).toBe(true);
    registry.setLmstudioEnabled(false);
    expect(registry.isLmstudioEnabled()).toBe(false);
  });

  it('enabling LM Studio invalidates model cache', () => {
    // Populate cache
    registry['cachedModels'] = [{ id: 'test', name: 'test', provider: 'other' }];
    registry['cachedModelsAt'] = Date.now();

    registry.setLmstudioEnabled(true);

    expect(registry['cachedModels']).toBeNull();
    expect(registry['cachedModelsAt']).toBe(0);
  });

  // ---- Provider status ----

  it('getProviderStatus includes lmstudio field', () => {
    const status = registry.getProviderStatus();
    expect(status).toHaveProperty('lmstudio');
    expect(status.lmstudio).toBe(false);

    registry.setLmstudioEnabled(true);
    expect(registry.getProviderStatus().lmstudio).toBe(true);
  });

  // ---- isReady includes lmstudio ----

  it('isReady returns true when only LM Studio is enabled', () => {
    expect(registry.isReady()).toBe(false);
    registry.setLmstudioEnabled(true);
    expect(registry.isReady()).toBe(true);
  });

  // ---- isProviderKeySet for lmstudio ----

  it('isProviderKeySet returns lmstudio enabled state for provider "lmstudio"', () => {
    expect(registry.isProviderKeySet('lmstudio')).toBe(false);
    registry.setLmstudioEnabled(true);
    expect(registry.isProviderKeySet('lmstudio')).toBe(true);
  });

  // ---- resolveModel for lmstudio ----

  it('resolveModel creates an OpenAI-compatible model for LM Studio models', () => {
    registry.setLmstudioEnabled(true);
    registry.registerLmstudioModel('lmstudio-community/Meta-Llama-3-8B');

    const model = registry.resolveModel('lmstudio-community/Meta-Llama-3-8B');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('lmstudio-community/Meta-Llama-3-8B');
  });

  it('resolveModel throws when LM Studio is disabled', () => {
    registry.registerLmstudioModel('lmstudio-community/Meta-Llama-3-8B');
    expect(() => registry.resolveModel('lmstudio-community/Meta-Llama-3-8B')).toThrow(/not configured/i);
  });

  // ---- LM Studio model registration ----

  it('tracks registered LM Studio model IDs', () => {
    expect(registry.isLmstudioModel('some-model')).toBe(false);
    registry.registerLmstudioModel('some-model');
    expect(registry.isLmstudioModel('some-model')).toBe(true);
  });

  it('clearLmstudioModels removes all registered models', () => {
    registry.registerLmstudioModel('model-a');
    registry.registerLmstudioModel('model-b');
    registry.clearLmstudioModels();
    expect(registry.isLmstudioModel('model-a')).toBe(false);
    expect(registry.isLmstudioModel('model-b')).toBe(false);
  });

  // ---- detectModelProvider ----

  it('detectModelProvider returns "lmstudio" for registered LM Studio models', () => {
    registry.registerLmstudioModel('some-local-model');
    expect(registry.detectModelProvider('some-local-model')).toBe('lmstudio');
  });

  it('detectModelProvider returns "ollama" for registered Ollama models (not lmstudio)', () => {
    registry.registerOllamaModel('llama3:latest');
    registry.registerLmstudioModel('some-model');
    expect(registry.detectModelProvider('llama3:latest')).toBe('ollama');
    expect(registry.detectModelProvider('some-model')).toBe('lmstudio');
  });

  // ---- fetchLmstudioModels ----

  it('fetchLmstudioModels calls the LM Studio models endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'lmstudio-community/Meta-Llama-3-8B' },
          { id: 'TheBloke/Mistral-7B-v0.1-GGUF' },
        ],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.fetchLmstudioModels();
      expect(mockFetch).toHaveBeenCalledWith(
        LMSTUDIO_MODELS_URL,
        expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
      );
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({ id: 'lmstudio-community/Meta-Llama-3-8B', provider: 'lmstudio' });
      expect(models[1]).toMatchObject({ id: 'TheBloke/Mistral-7B-v0.1-GGUF', provider: 'lmstudio' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchLmstudioModels returns empty array on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.fetchLmstudioModels();
      expect(models).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchLmstudioModels registers returned models', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'my-local-model' }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await registry.fetchLmstudioModels();
      expect(registry.isLmstudioModel('my-local-model')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---- getAvailableModels includes LM Studio when enabled ----

  it('getAvailableModels includes LM Studio models when enabled', async () => {
    registry.setLmstudioEnabled(true);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'my-local-model' }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.getAvailableModels();
      const lmModels = models.filter(m => m.provider === 'lmstudio');
      expect(lmModels.length).toBeGreaterThanOrEqual(1);
      expect(lmModels[0].id).toBe('my-local-model');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('getAvailableModels excludes LM Studio models when disabled', async () => {
    registry.setLmstudioEnabled(false);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'my-local-model' }] }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.getAvailableModels();
      const lmModels = models.filter(m => m.provider === 'lmstudio');
      expect(lmModels).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---- LM Studio model capability overrides ----

  describe('model capability overrides', () => {
    it('returns default capabilities (tools=false, vision=false) for unknown model', () => {
      const caps = registry.getLmstudioModelCapabilities('unknown-model');
      expect(caps).toEqual({ tools: false, vision: false });
    });

    it('stores and retrieves capability overrides for a model', () => {
      registry.setLmstudioModelCapabilities('my-model', { tools: true, vision: false });
      expect(registry.getLmstudioModelCapabilities('my-model')).toEqual({ tools: true, vision: false });
    });

    it('stores vision capability override', () => {
      registry.setLmstudioModelCapabilities('vision-model', { tools: false, vision: true });
      expect(registry.getLmstudioModelCapabilities('vision-model')).toEqual({ tools: false, vision: true });
    });

    it('supports both capabilities enabled', () => {
      registry.setLmstudioModelCapabilities('full-model', { tools: true, vision: true });
      expect(registry.getLmstudioModelCapabilities('full-model')).toEqual({ tools: true, vision: true });
    });

    it('getAllLmstudioModelCapabilities returns all stored overrides', () => {
      registry.setLmstudioModelCapabilities('model-a', { tools: true, vision: false });
      registry.setLmstudioModelCapabilities('model-b', { tools: false, vision: true });
      const all = registry.getAllLmstudioModelCapabilities();
      expect(all).toEqual({
        'model-a': { tools: true, vision: false },
        'model-b': { tools: false, vision: true },
      });
    });

    it('getAllLmstudioModelCapabilities returns empty object when no overrides', () => {
      expect(registry.getAllLmstudioModelCapabilities()).toEqual({});
    });

    it('loadLmstudioModelCapabilities restores from serialized JSON', () => {
      const data = { 'my-model': { tools: true, vision: false } };
      registry.loadLmstudioModelCapabilities(data);
      expect(registry.getLmstudioModelCapabilities('my-model')).toEqual({ tools: true, vision: false });
    });

    it('lmstudioModelSupportsTools returns false by default', () => {
      expect(registry.lmstudioModelSupportsTools('unknown')).toBe(false);
    });

    it('lmstudioModelSupportsTools returns true when override is set', () => {
      registry.setLmstudioModelCapabilities('my-model', { tools: true, vision: false });
      expect(registry.lmstudioModelSupportsTools('my-model')).toBe(true);
    });

    it('lmstudioModelSupportsVision returns false by default', () => {
      expect(registry.lmstudioModelSupportsVision('unknown')).toBe(false);
    });

    it('lmstudioModelSupportsVision returns true when override is set', () => {
      registry.setLmstudioModelCapabilities('vision-model', { tools: false, vision: true });
      expect(registry.lmstudioModelSupportsVision('vision-model')).toBe(true);
    });

    it('fetchLmstudioModels applies vision overrides to returned models', async () => {
      registry.setLmstudioModelCapabilities('vision-model', { tools: false, vision: true });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'text-model' },
            { id: 'vision-model' },
          ],
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const models = await registry.fetchLmstudioModels();
        expect(models).toHaveLength(2);
        expect(models.find(m => m.id === 'text-model')?.vision).toBe(false);
        expect(models.find(m => m.id === 'vision-model')?.vision).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
