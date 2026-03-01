/**
 * ModelCatalogEngine Tests
 *
 * Tests the model catalog engine that fetches and caches
 * model metadata from models.dev for ALL providers.
 * Three normalised tables: providers → models → modalities.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chainable Drizzle mock with onConflictDoUpdate ──

function createSelectChain(mockData: unknown[] = []) {
  const chain: Record<string, unknown> = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    then: (resolve: (v: unknown) => void) => Promise.resolve(mockData).then(resolve),
  };
  return chain;
}

// Per-table mock data keyed by table name reference
let modelMockData: unknown[] = [];
let modalityMockData: unknown[] = [];
let providerMockData: unknown[] = [];
let metaMockData: unknown[] = [];
const insertedValues: unknown[] = [];

function createDrizzleMock() {
  return {
    select: vi.fn(() => {
      // Returns a chain whose `.from()` picks the right dataset by table reference
      const chain: Record<string, unknown> = {
        from: vi.fn().mockImplementation((table: unknown) => {
          let data: unknown[];
          if (table === modelCatalogModalities) {
            data = modalityMockData;
          } else if (table === modelCatalogProviders) {
            data = providerMockData;
          } else if (table === modelCatalogMeta) {
            data = metaMockData;
          } else {
            data = modelMockData;
          }
          const inner = createSelectChain(data);
          return inner;
        }),
        where: vi.fn().mockImplementation(() => chain),
        then: (resolve: (v: unknown) => void) => Promise.resolve(modelMockData).then(resolve),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((data: unknown) => {
        insertedValues.push(data);
        return {
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
          then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
  })),
}));

import { ModelCatalogEngine, DEFAULT_MAX_OUTPUT_TOKENS } from '../../src/main/engine/ModelCatalogEngine';
import { modelCatalog, modelCatalogModalities, modelCatalogProviders, modelCatalogMeta } from '../../src/main/database/schema';

// ── Sample models.dev response (multi-provider) ──

function sampleModelsDevResponse() {
  return {
    opencode: {
      id: 'opencode',
      name: 'OpenCode Zen',
      env: ['OPENCODE_API_KEY'],
      npm: '@ai-sdk/openai-compatible',
      api: 'https://opencode.ai/zen/v1',
      doc: 'https://opencode.ai/docs/zen',
      models: {
        'claude-sonnet-4-5': {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          family: 'claude-sonnet',
          attachment: true,
          reasoning: false,
          tool_call: true,
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          cost: { input: 3, output: 15, cache_read: 0.3 },
          limit: { context: 200000, output: 64000 },
        },
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT 5',
          family: 'gpt',
          attachment: true,
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          cost: { input: 1.07, output: 8.5, cache_read: 0.107 },
          limit: { context: 400000, input: 272000, output: 128000 },
        },
        'model-no-cost': {
          id: 'model-no-cost',
          name: 'Free Model',
          family: 'free',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 32000, output: 4096 },
        },
      },
    },
    mistral: {
      id: 'mistral',
      name: 'Mistral AI',
      env: ['MISTRAL_API_KEY'],
      npm: '@mistralai/mistralai',
      api: 'https://api.mistral.ai/v1',
      doc: 'https://docs.mistral.ai',
      models: {
        'mistral-large-latest': {
          id: 'mistral-large-latest',
          name: 'Mistral Large',
          family: 'mistral',
          attachment: true,
          reasoning: false,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          cost: { input: 2, output: 6 },
          limit: { context: 128000, output: 8192 },
        },
      },
    },
  };
}

describe('ModelCatalogEngine', () => {
  let engine: ModelCatalogEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    modelMockData = [];
    modalityMockData = [];
    providerMockData = [];
    metaMockData = [];
    insertedValues.length = 0;
    engine = new ModelCatalogEngine();
  });

  describe('getAll', () => {
    it('returns all cached model catalog entries with modalities', async () => {
      modelMockData = [
        {
          provider: 'opencode', modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5',
          family: 'claude-sonnet', attachment: true, reasoning: false, toolCall: true,
          structuredOutput: false, temperature: false, knowledge: null,
          releaseDate: null, lastUpdatedDate: null, openWeights: false,
          contextWindow: 200000, maxInputTokens: null, maxOutputTokens: 64000,
          inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: null,
          interleaved: null, status: null, providerNpm: null,
        },
      ];
      modalityMockData = [
        { provider: 'opencode', modelId: 'claude-sonnet-4-5', direction: 'input', modality: 'text' },
        { provider: 'opencode', modelId: 'claude-sonnet-4-5', direction: 'input', modality: 'image' },
        { provider: 'opencode', modelId: 'claude-sonnet-4-5', direction: 'output', modality: 'text' },
      ];

      const result = await engine.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('claude-sonnet-4-5');
      expect(result[0].provider).toBe('opencode');
      expect(result[0].maxOutputTokens).toBe(64000);
      expect(result[0].inputPrice).toBe(3);
      expect(result[0].inputModalities).toEqual(['text', 'image']);
      expect(result[0].outputModalities).toEqual(['text']);
    });

    it('returns empty array when no catalog entries exist', async () => {
      const result = await engine.getAll();
      expect(result).toEqual([]);
    });
  });

  describe('getModel', () => {
    it('returns a specific model by ID (cross-provider search)', async () => {
      modelMockData = [{
        provider: 'opencode', modelId: 'gpt-5', name: 'GPT 5', family: 'gpt',
        attachment: true, reasoning: true, toolCall: true,
        structuredOutput: false, temperature: false, knowledge: null,
        releaseDate: null, lastUpdatedDate: null, openWeights: false,
        contextWindow: 400000, maxInputTokens: 272000, maxOutputTokens: 128000,
        inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107, cacheWritePrice: null,
        interleaved: null, status: null, providerNpm: null,
      }];
      modalityMockData = [
        { provider: 'opencode', modelId: 'gpt-5', direction: 'input', modality: 'text' },
        { provider: 'opencode', modelId: 'gpt-5', direction: 'input', modality: 'image' },
      ];

      const result = await engine.getModel('gpt-5');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('GPT 5');
      expect(result!.maxOutputTokens).toBe(128000);
      expect(result!.inputModalities).toEqual(['text', 'image']);
    });

    it('returns null for unknown model', async () => {
      modelMockData = [];
      modalityMockData = [];
      const result = await engine.getModel('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getMaxOutputTokens', () => {
    it('returns output tokens from catalog when available', async () => {
      modelMockData = [{
        provider: 'opencode', modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5',
        family: 'claude-sonnet', attachment: true, reasoning: false, toolCall: true,
        structuredOutput: false, temperature: false, knowledge: null,
        releaseDate: null, lastUpdatedDate: null, openWeights: false,
        contextWindow: 200000, maxInputTokens: null, maxOutputTokens: 64000,
        inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: null,
        interleaved: null, status: null, providerNpm: null,
      }];
      modalityMockData = [];

      const result = await engine.getMaxOutputTokens('claude-sonnet-4-5');
      expect(result).toBe(64000);
    });

    it('returns DEFAULT_MAX_OUTPUT_TOKENS for uncatalogued model', async () => {
      modelMockData = [];
      modalityMockData = [];
      const result = await engine.getMaxOutputTokens('unknown-model');
      expect(result).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('returns DEFAULT_MAX_OUTPUT_TOKENS when model has null maxOutputTokens', async () => {
      modelMockData = [{
        provider: 'opencode', modelId: 'weird-model', name: 'Weird', family: null,
        attachment: false, reasoning: false, toolCall: false,
        structuredOutput: false, temperature: false, knowledge: null,
        releaseDate: null, lastUpdatedDate: null, openWeights: false,
        contextWindow: null, maxInputTokens: null, maxOutputTokens: null,
        inputPrice: null, outputPrice: null, cacheReadPrice: null, cacheWritePrice: null,
        interleaved: null, status: null, providerNpm: null,
      }];
      modalityMockData = [];

      const result = await engine.getMaxOutputTokens('weird-model');
      expect(result).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
  });

  describe('hasInputModality', () => {
    it('returns true when model has the modality', async () => {
      modelMockData = [{
        provider: 'opencode', modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5',
        family: 'claude-sonnet', attachment: true, reasoning: false, toolCall: true,
        structuredOutput: false, temperature: false, knowledge: null,
        releaseDate: null, lastUpdatedDate: null, openWeights: false,
        contextWindow: 200000, maxInputTokens: null, maxOutputTokens: 64000,
        inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: null,
        interleaved: null, status: null, providerNpm: null,
      }];
      modalityMockData = [
        { provider: 'opencode', modelId: 'claude-sonnet-4-5', direction: 'input', modality: 'image' },
      ];

      const result = await engine.hasInputModality('claude-sonnet-4-5', 'image');
      expect(result).toBe(true);
    });

    it('returns false when model lacks the modality', async () => {
      modelMockData = [{
        provider: 'opencode', modelId: 'text-only', name: 'Text Only',
        family: null, attachment: false, reasoning: false, toolCall: false,
        structuredOutput: false, temperature: false, knowledge: null,
        releaseDate: null, lastUpdatedDate: null, openWeights: false,
        contextWindow: 32000, maxInputTokens: null, maxOutputTokens: 4096,
        inputPrice: null, outputPrice: null, cacheReadPrice: null, cacheWritePrice: null,
        interleaved: null, status: null, providerNpm: null,
      }];
      modalityMockData = [
        { provider: 'opencode', modelId: 'text-only', direction: 'input', modality: 'text' },
      ];

      const result = await engine.hasInputModality('text-only', 'image');
      expect(result).toBe(false);
    });

    it('returns false for unknown model', async () => {
      modelMockData = [];
      modalityMockData = [];
      const result = await engine.hasInputModality('nonexistent', 'image');
      expect(result).toBe(false);
    });
  });

  describe('refresh', () => {
    it('parses multi-provider models.dev response and inserts all providers and models', async () => {
      const mockResponse = sampleModelsDevResponse();
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(mockResponse),
        headers: { etag: '"abc123"' },
      });

      metaMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(true);
      // 3 opencode models + 1 mistral model = 4
      expect(result.modelsUpdated).toBe(4);
      expect(result.notModified).toBeUndefined();

      // Should have inserted provider rows and model rows and modality rows
      expect(insertedValues.length).toBeGreaterThan(0);
    });

    it('sends If-None-Match header when ETag is cached', async () => {
      const httpGetSpy = vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 304,
        body: '',
        headers: {},
      });

      // Return stored etag on first getMeta call
      let metaCallCount = 0;
      const origSelect = mockLocalDb.select;
      mockLocalDb.select = vi.fn(() => {
        metaCallCount++;
        if (metaCallCount === 1) {
          // getMeta('etag') → picks up model_catalog_meta table
          const chain = createSelectChain([{ key: 'etag', value: '"old-etag"' }]);
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(chain), ...chain }), ...chain };
        }
        return createSelectChain([]);
      }) as any;

      const result = await engine.refresh();

      expect(result.success).toBe(true);
      expect(result.notModified).toBe(true);
      expect(httpGetSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ 'If-None-Match': '"old-etag"' }),
      );

      mockLocalDb.select = origSelect;
    });

    it('handles HTTP errors gracefully', async () => {
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 500,
        body: 'Internal Server Error',
        headers: {},
      });
      metaMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('handles network errors gracefully', async () => {
      vi.spyOn(engine as any, 'httpGet').mockRejectedValue(new Error('ECONNREFUSED'));
      metaMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('handles invalid response (no providers)', async () => {
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({}),
        headers: {},
      });
      metaMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toContain('no providers');
    });

    it('handles malformed JSON gracefully', async () => {
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: 'not valid json {{{',
        headers: {},
      });
      metaMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
