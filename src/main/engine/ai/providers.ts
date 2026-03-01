/**
 * Provider registry — single source of truth for AI provider routing.
 *
 * Two provider sources:
 *   1. OpenCode Zen gateway — routes claude* → Anthropic Messages API,
 *      everything else → OpenAI Chat Completions API
 *   2. Mistral direct — uses Mistral's native API
 *
 * Model listing uses raw HTTP (AI SDK has no listing API).
 *
 * IMPORTANT: OpenAI SDK v6 defaults to Responses API (/responses).
 * OpenCode Zen only supports Chat Completions. Use provider.chat(modelId).
 */

import { customProvider } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import type { LanguageModel, Provider } from 'ai';
import { ModelCatalogEngine } from '../ModelCatalogEngine';
import type { ChatModel } from '../../shared/electronApi';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
export const MISTRAL_MODELS_URL = 'https://api.mistral.ai/v1/models';

const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Gateway factory
// ---------------------------------------------------------------------------

/**
 * Creates the OpenCode Zen gateway custom provider.
 * Routes claude* → Anthropic Messages API, everything else → OpenAI Chat Completions.
 */
export function createOpenCodeGateway(apiKey: string): Provider {
  const anthropicProvider = createAnthropic({
    baseURL: ZEN_BASE_URL,
    apiKey,
  });
  const openaiProvider = createOpenAI({
    baseURL: ZEN_BASE_URL,
    apiKey,
  });

  // Build a ProviderV3 that routes claude* → Anthropic, else → OpenAI Chat Completions
  const gatewayRouter: import('@ai-sdk/provider').ProviderV3 = {
    specificationVersion: 'v3',
    languageModel: (modelId: string) => {
      if (modelId.startsWith('claude')) {
        return anthropicProvider(modelId);
      }
      // Use .chat() for Chat Completions — Zen doesn't support Responses API
      return openaiProvider.chat(modelId);
    },
    embeddingModel: () => {
      throw new Error('Embeddings not supported via OpenCode gateway');
    },
    imageModel: () => {
      throw new Error('Image models not supported via OpenCode gateway');
    },
  };

  return customProvider({
    languageModels: {},
    fallbackProvider: gatewayRouter,
  });
}

// ---------------------------------------------------------------------------
// Provider detection — shared utility
// ---------------------------------------------------------------------------

/** Determine which provider backend a model ID belongs to. */
export function detectProvider(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gpt') || id.startsWith('o3') || id.startsWith('o4')) return 'openai';
  if (id.startsWith('gemini')) return 'google';
  if (
    id.startsWith('mistral') ||
    id.startsWith('ministral') ||
    id.startsWith('devstral') ||
    id.startsWith('codestral') ||
    id.startsWith('pixtral')
  ) return 'mistral';
  return 'other';
}

// ---------------------------------------------------------------------------
// ProviderRegistry — manages keys, providers, model resolution
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private opencodeKey = '';
  private mistralKey = '';
  private opencodeGateway: Provider | null = null;
  private mistralProvider: ReturnType<typeof createMistral> | null = null;
  private modelCatalogEngine = new ModelCatalogEngine();

  // Model cache
  private cachedModels: ChatModel[] | null = null;
  private cachedModelsAt = 0;

  // ---- Key management ----

  setOpencodeKey(key: string): void {
    this.opencodeKey = key;
    this.opencodeGateway = null; // rebuild on next use
    this.invalidateModelCache();
  }

  getOpencodeKey(): string {
    return this.opencodeKey;
  }

  setMistralKey(key: string): void {
    this.mistralKey = key;
    this.mistralProvider = null; // rebuild on next use
    this.invalidateModelCache();
  }

  getMistralKey(): string {
    return this.mistralKey;
  }

  /** Check whether at least one provider key is configured. */
  isReady(): boolean {
    return !!(this.opencodeKey || this.mistralKey);
  }

  /** Check whether the key for a specific provider is set. */
  isProviderKeySet(provider: string): boolean {
    if (provider === 'mistral') return !!this.mistralKey;
    return !!this.opencodeKey;
  }

  /** Returns status of all configured providers. */
  getProviderStatus(): { opencode: boolean; mistral: boolean } {
    return {
      opencode: !!this.opencodeKey,
      mistral: !!this.mistralKey,
    };
  }

  // ---- Provider resolution ----

  /** Resolve a model ID to an AI SDK LanguageModel. */
  resolveModel(modelId: string): LanguageModel {
    const provider = detectProvider(modelId);

    if (provider === 'mistral') {
      if (!this.mistralKey) {
        throw new Error(`Mistral API key not configured for model '${modelId}'`);
      }
      if (!this.mistralProvider) {
        this.mistralProvider = createMistral({ apiKey: this.mistralKey });
      }
      return this.mistralProvider(modelId);
    }

    // Everything else goes through the OpenCode gateway
    if (!this.opencodeKey) {
      throw new Error(`OpenCode API key not configured for model '${modelId}'`);
    }
    if (!this.opencodeGateway) {
      this.opencodeGateway = createOpenCodeGateway(this.opencodeKey);
    }
    return this.opencodeGateway.languageModel(modelId);
  }

  // ---- Model listing (raw HTTP — AI SDK has no listing API) ----

  invalidateModelCache(): void {
    this.cachedModels = null;
    this.cachedModelsAt = 0;
  }

  /** Get the model catalog engine for context window lookups. */
  getModelCatalogEngine(): ModelCatalogEngine {
    return this.modelCatalogEngine;
  }

  /** Get available models across all configured providers (cached 5 min). */
  async getAvailableModels(): Promise<ChatModel[]> {
    if (this.cachedModels && Date.now() - this.cachedModelsAt < MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    const allModels: ChatModel[] = [];
    let fetched = false;
    const { vision: catalogVision, names: catalogNames } = await this.getCatalogLookups();

    // Fetch OpenCode models
    if (this.opencodeKey) {
      try {
        const models = await this.fetchModelsFromEndpoint(
          ZEN_MODELS_URL,
          { Authorization: `Bearer ${this.opencodeKey}`, 'x-api-key': this.opencodeKey },
          catalogVision,
          catalogNames,
        );
        allModels.push(...models);
        fetched = true;
      } catch {
        // Fall through
      }
    }

    // Fetch Mistral models
    if (this.mistralKey) {
      try {
        const models = await this.fetchModelsFromEndpoint(
          MISTRAL_MODELS_URL,
          { Authorization: `Bearer ${this.mistralKey}` },
          catalogVision,
          catalogNames,
          'mistral', // only keep mistral-family models
        );
        allModels.push(...models);
        fetched = true;
      } catch {
        // Fall through
      }
    }

    if (fetched && allModels.length > 0) {
      this.cachedModels = allModels;
      this.cachedModelsAt = Date.now();
      return allModels;
    }

    // Fallback: model catalog DB, filtered by available provider keys
    return this.getModelsFromCatalog();
  }

  /** Validate an OpenCode API key against the models endpoint. */
  async validateOpencodeKey(apiKey: string): Promise<{ isValid: boolean; models: ChatModel[] }> {
    if (!apiKey || apiKey.length < 3) return { isValid: false, models: [] };

    const { vision: catalogVision, names: catalogNames } = await this.getCatalogLookups();

    const headerSets: Record<string, string>[] = [
      { Authorization: `Bearer ${apiKey}` },
      { 'x-api-key': apiKey },
    ];

    for (const headers of headerSets) {
      try {
        const models = await this.fetchModelsFromEndpoint(
          ZEN_MODELS_URL, headers, catalogVision, catalogNames,
        );
        return { isValid: true, models };
      } catch {
        // Try next
      }
    }
    return { isValid: false, models: [] };
  }

  /** Validate a Mistral API key against the Mistral models endpoint. */
  async validateMistralKey(apiKey: string): Promise<{ isValid: boolean; models: ChatModel[] }> {
    if (!apiKey || apiKey.length < 3) return { isValid: false, models: [] };

    const { vision: catalogVision, names: catalogNames } = await this.getCatalogLookups();

    try {
      const models = await this.fetchModelsFromEndpoint(
        MISTRAL_MODELS_URL,
        { Authorization: `Bearer ${apiKey}` },
        catalogVision,
        catalogNames,
        'mistral',
      );
      return { isValid: true, models };
    } catch {
      return { isValid: false, models: [] };
    }
  }

  // ---- Private helpers ----

  private async fetchModelsFromEndpoint(
    url: string,
    headers: Record<string, string>,
    catalogVision: Map<string, boolean>,
    catalogNames: Map<string, string>,
    filterProvider?: string,
  ): Promise<ChatModel[]> {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as { data?: Array<{ id: string }> };
    if (!data.data || !Array.isArray(data.data)) return [];

    let models = data.data;
    if (filterProvider) {
      models = models.filter(m => detectProvider(m.id) === filterProvider);
    }

    return models.map(m => ({
      id: m.id,
      name: catalogNames.get(m.id) ?? m.id,
      provider: detectProvider(m.id),
      vision: catalogVision.get(m.id) ?? false,
    }));
  }

  private async getCatalogLookups(): Promise<{ vision: Map<string, boolean>; names: Map<string, string> }> {
    const vision = new Map<string, boolean>();
    const names = new Map<string, string>();
    try {
      const catalog = await this.modelCatalogEngine.getAll();
      for (const m of catalog) {
        vision.set(m.id, m.inputModalities.includes('image'));
        names.set(m.id, m.name);
      }
    } catch {
      // Catalog unavailable
    }
    return { vision, names };
  }

  private async getModelsFromCatalog(): Promise<ChatModel[]> {
    try {
      const catalog = await this.modelCatalogEngine.getAll();
      if (catalog.length > 0) {
        return catalog
          .map(m => ({
            id: m.id,
            name: m.name,
            provider: detectProvider(m.id),
            vision: m.inputModalities.includes('image'),
          }))
          .filter(m => this.isProviderKeySet(m.provider));
      }
    } catch {
      // Fall through
    }
    return [];
  }
}
