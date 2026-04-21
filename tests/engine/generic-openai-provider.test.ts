/**
 * Tests for generic OpenAI-compatible endpoint support in ProviderRegistry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../../src/main/engine/ai/providers';

vi.mock('../../src/main/engine/ModelCatalogEngine', () => ({
  ModelCatalogEngine: class {
    getAll = vi.fn().mockResolvedValue([]);
    getContextWindow = vi.fn().mockResolvedValue(null);
  },
}));

describe('generic OpenAI-compatible provider support', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('fetchGenericOpenAIModels does not duplicate the v1 path when base URL already ends with /v1', async () => {
    registry.setGenericOpenAIEnabled(true);
    registry.setGenericOpenAIBaseURL('http://localhost:4000/v1');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'custom-model' }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const models = await registry.fetchGenericOpenAIModels();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/v1/models',
        expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
      );
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({ id: 'custom-model', provider: 'generic-openai' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not treat generic endpoint models as local when airplane mode is active', () => {
    registry.setGenericOpenAIEnabled(true);
    registry.setGenericOpenAIBaseURL('http://localhost:4000/v1');
    registry.registerGenericOpenAIModel('custom-model');
    registry.setOfflineMode(true);

    expect(registry.isReady()).toBe(false);
    expect(registry.getKnownLocalModels()).toEqual([]);
    expect(() => registry.resolveModel('custom-model')).toThrow(/not available offline/i);
  });
});