/**
 * ModelCatalogEngine Tests
 *
 * Tests the model catalog engine that fetches and caches
 * model metadata from models.dev for the OpenCode provider.
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

let selectMockData: unknown[] = [];
const insertedValues: unknown[] = [];

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain(selectMockData)),
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

// ── Sample models.dev response ──

function sampleModelsDevResponse() {
  return {
    opencode: {
      id: 'opencode',
      models: {
        'claude-sonnet-4-5': {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          family: 'claude-sonnet',
          attachment: true,
          reasoning: false,
          tool_call: true,
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
          cost: { input: 1.07, output: 8.5, cache_read: 0.107 },
          limit: { context: 400000, input: 272000, output: 128000 },
        },
        'model-no-cost': {
          id: 'model-no-cost',
          name: 'Free Model',
          family: 'free',
          limit: { context: 32000, output: 4096 },
        },
      },
    },
  };
}

describe('ModelCatalogEngine', () => {
  let engine: ModelCatalogEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    selectMockData = [];
    insertedValues.length = 0;
    engine = new ModelCatalogEngine();
  });

  describe('getAll', () => {
    it('returns all cached model catalog entries', async () => {
      selectMockData = [
        {
          id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', family: 'claude-sonnet',
          contextWindow: 200000, maxInputTokens: null, maxOutputTokens: 64000,
          inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3,
          supportsAttachments: true, supportsReasoning: false, supportsToolCall: true,
        },
      ];

      const result = await engine.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('claude-sonnet-4-5');
      expect(result[0].maxOutputTokens).toBe(64000);
      expect(result[0].inputPrice).toBe(3);
    });

    it('returns empty array when no catalog entries exist', async () => {
      selectMockData = [];
      const result = await engine.getAll();
      expect(result).toEqual([]);
    });
  });

  describe('getModel', () => {
    it('returns a specific model by ID', async () => {
      selectMockData = [{
        id: 'gpt-5', name: 'GPT 5', family: 'gpt',
        contextWindow: 400000, maxInputTokens: 272000, maxOutputTokens: 128000,
        inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107,
        supportsAttachments: true, supportsReasoning: true, supportsToolCall: true,
      }];

      const result = await engine.getModel('gpt-5');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('GPT 5');
      expect(result!.maxOutputTokens).toBe(128000);
    });

    it('returns null for unknown model', async () => {
      selectMockData = [];
      const result = await engine.getModel('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getMaxOutputTokens', () => {
    it('returns output tokens from catalog when available', async () => {
      selectMockData = [{
        id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', family: 'claude-sonnet',
        contextWindow: 200000, maxInputTokens: null, maxOutputTokens: 64000,
        inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3,
        supportsAttachments: true, supportsReasoning: false, supportsToolCall: true,
      }];

      const result = await engine.getMaxOutputTokens('claude-sonnet-4-5');
      expect(result).toBe(64000);
    });

    it('returns DEFAULT_MAX_OUTPUT_TOKENS for uncatalogued model', async () => {
      selectMockData = [];
      const result = await engine.getMaxOutputTokens('unknown-model');
      expect(result).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('returns DEFAULT_MAX_OUTPUT_TOKENS when model has null maxOutputTokens', async () => {
      selectMockData = [{
        id: 'weird-model', name: 'Weird', family: null,
        contextWindow: null, maxInputTokens: null, maxOutputTokens: null,
        inputPrice: null, outputPrice: null, cacheReadPrice: null,
        supportsAttachments: false, supportsReasoning: false, supportsToolCall: false,
      }];

      const result = await engine.getMaxOutputTokens('weird-model');
      expect(result).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
  });

  describe('refresh', () => {
    it('parses models.dev response and inserts models into DB', async () => {
      const mockResponse = sampleModelsDevResponse();
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify(mockResponse),
        headers: { etag: '"abc123"' },
      });

      // getMeta returns null (no existing etag)
      selectMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(true);
      expect(result.modelsUpdated).toBe(3);
      expect(result.notModified).toBeUndefined();
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
          return createSelectChain([{ key: 'etag', value: '"old-etag"' }]);
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
      selectMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('handles network errors gracefully', async () => {
      vi.spyOn(engine as any, 'httpGet').mockRejectedValue(new Error('ECONNREFUSED'));
      selectMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('handles invalid response (missing opencode provider)', async () => {
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ other_provider: { models: {} } }),
        headers: {},
      });
      selectMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toContain('no opencode models');
    });

    it('handles malformed JSON gracefully', async () => {
      vi.spyOn(engine as any, 'httpGet').mockResolvedValue({
        statusCode: 200,
        body: 'not valid json {{{',
        headers: {},
      });
      selectMockData = [];

      const result = await engine.refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
