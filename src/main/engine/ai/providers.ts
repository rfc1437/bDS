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

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
const MISTRAL_MODELS_URL = 'https://api.mistral.ai/v1/models';
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
export const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';
export const LMSTUDIO_MODELS_URL = 'http://localhost:1234/v1/models';
export const GENERIC_OPENAI_MODELS_PATH = '/models';

const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const OLLAMA_FETCH_TIMEOUT = 3000; // 3 s — fail fast when Ollama isn't running
const LMSTUDIO_FETCH_TIMEOUT = 3000; // 3 s — fail fast when LM Studio isn't running
const GENERIC_OPENAI_FETCH_TIMEOUT = 10000; // 10 s for generic endpoints

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
  if (id.startsWith('claude')) {
    return 'anthropic';
  }
  if (id.startsWith('gpt') || id.startsWith('o3') || id.startsWith('o4')) {
    return 'openai';
  }
  if (id.startsWith('gemini')) {
    return 'google';
  }
  if (
    id.startsWith('mistral') ||
    id.startsWith('ministral') ||
    id.startsWith('devstral') ||
    id.startsWith('codestral') ||
    id.startsWith('pixtral')
  ) {
    return 'mistral';
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// ProviderRegistry — manages keys, providers, model resolution
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private opencodeKey = '';
  private mistralKey = '';
  private ollamaEnabled = false;
  private opencodeGateway: Provider | null = null;
  private mistralProvider: ReturnType<typeof createMistral> | null = null;
  private ollamaProvider: ReturnType<typeof createOpenAI> | null = null;
  private ollamaModelIds = new Set<string>();
  private ollamaCapabilities = new Map<string, { tools: boolean; vision: boolean }>();
  private lmstudioEnabled = false;
  private lmstudioProvider: ReturnType<typeof createOpenAI> | null = null;
  private lmstudioModelIds = new Set<string>();
  private lmstudioCapabilities = new Map<string, { tools: boolean; vision: boolean }>();
  private genericOpenAIEnabled = false;
  private genericOpenAIBaseURL = '';
  private genericOpenAIApiKey = '';
  private genericOpenAIProvider: ReturnType<typeof createOpenAI> | null = null;
  private genericOpenAIModelIds = new Set<string>();
  private genericOpenAICapabilities = new Map<string, { tools: boolean; vision: boolean }>();
  private modelCatalogEngine = new ModelCatalogEngine();
  private _offlineMode = false;

  // Model cache
  private cachedModels: ChatModel[] | null = null;
  private cachedModelsAt = 0;

  // ---- Offline / airplane mode ----

  setOfflineMode(enabled: boolean): void {
    this._offlineMode = enabled;
    this.invalidateModelCache();
  }

  isOfflineMode(): boolean {
    return this._offlineMode;
  }

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

  // ---- Ollama management ----

  setOllamaEnabled(enabled: boolean): void {
    this.ollamaEnabled = enabled;
    this.ollamaProvider = null;
    this.invalidateModelCache();
  }

  isOllamaEnabled(): boolean {
    return this.ollamaEnabled;
  }

  /** Register a model ID as belonging to Ollama. */
  registerOllamaModel(modelId: string): void {
    this.ollamaModelIds.add(modelId);
  }

  /** Check whether a model ID was registered as an Ollama model. */
  isOllamaModel(modelId: string): boolean {
    return this.ollamaModelIds.has(modelId);
  }

  /** Remove all registered Ollama model IDs. */
  clearOllamaModels(): void {
    this.ollamaModelIds.clear();
  }

  // ---- Ollama model capability overrides ----

  /** Get capability overrides for a specific Ollama model (defaults to tools=false, vision=false). */
  getOllamaModelCapabilities(modelId: string): { tools: boolean; vision: boolean } {
    return this.ollamaCapabilities.get(modelId) ?? { tools: false, vision: false };
  }

  /** Set capability overrides for a specific Ollama model. */
  setOllamaModelCapabilities(modelId: string, caps: { tools: boolean; vision: boolean }): void {
    this.ollamaCapabilities.set(modelId, caps);
    this.invalidateModelCache();
  }

  /** Get all stored capability overrides as a plain object. */
  getAllOllamaModelCapabilities(): Record<string, { tools: boolean; vision: boolean }> {
    const result: Record<string, { tools: boolean; vision: boolean }> = {};
    for (const [id, caps] of this.ollamaCapabilities) {
      result[id] = caps;
    }
    return result;
  }

  /** Load capability overrides from a serialized object (e.g. from settings DB). */
  loadOllamaModelCapabilities(data: Record<string, { tools: boolean; vision: boolean }>): void {
    this.ollamaCapabilities.clear();
    for (const [id, caps] of Object.entries(data)) {
      this.ollamaCapabilities.set(id, caps);
    }
  }

  /** Check whether an Ollama model has tools capability enabled. */
  ollamaModelSupportsTools(modelId: string): boolean {
    return this.ollamaCapabilities.get(modelId)?.tools ?? false;
  }

  /** Check whether an Ollama model has vision capability enabled. */
  ollamaModelSupportsVision(modelId: string): boolean {
    return this.ollamaCapabilities.get(modelId)?.vision ?? false;
  }

  // ---- LM Studio management ----

  setLmstudioEnabled(enabled: boolean): void {
    this.lmstudioEnabled = enabled;
    this.lmstudioProvider = null;
    this.invalidateModelCache();
  }

  isLmstudioEnabled(): boolean {
    return this.lmstudioEnabled;
  }

  /** Register a model ID as belonging to LM Studio. */
  registerLmstudioModel(modelId: string): void {
    this.lmstudioModelIds.add(modelId);
  }

  /** Check whether a model ID was registered as an LM Studio model. */
  isLmstudioModel(modelId: string): boolean {
    return this.lmstudioModelIds.has(modelId);
  }

  /** Remove all registered LM Studio model IDs. */
  clearLmstudioModels(): void {
    this.lmstudioModelIds.clear();
  }

  // ---- LM Studio model capability overrides ----

  /** Get capability overrides for a specific LM Studio model (defaults to tools=false, vision=false). */
  getLmstudioModelCapabilities(modelId: string): { tools: boolean; vision: boolean } {
    return this.lmstudioCapabilities.get(modelId) ?? { tools: false, vision: false };
  }

  /** Set capability overrides for a specific LM Studio model. */
  setLmstudioModelCapabilities(modelId: string, caps: { tools: boolean; vision: boolean }): void {
    this.lmstudioCapabilities.set(modelId, caps);
    this.invalidateModelCache();
  }

  /** Get all stored LM Studio capability overrides as a plain object. */
  getAllLmstudioModelCapabilities(): Record<string, { tools: boolean; vision: boolean }> {
    const result: Record<string, { tools: boolean; vision: boolean }> = {};
    for (const [id, caps] of this.lmstudioCapabilities) {
      result[id] = caps;
    }
    return result;
  }

  /** Load LM Studio capability overrides from a serialized object (e.g. from settings DB). */
  loadLmstudioModelCapabilities(data: Record<string, { tools: boolean; vision: boolean }>): void {
    this.lmstudioCapabilities.clear();
    for (const [id, caps] of Object.entries(data)) {
      this.lmstudioCapabilities.set(id, caps);
    }
  }

  /** Check whether an LM Studio model has tools capability enabled. */
  lmstudioModelSupportsTools(modelId: string): boolean {
    return this.lmstudioCapabilities.get(modelId)?.tools ?? false;
  }

  /** Check whether an LM Studio model has vision capability enabled. */
  lmstudioModelSupportsVision(modelId: string): boolean {
    return this.lmstudioCapabilities.get(modelId)?.vision ?? false;
  }

  // ---- Generic OpenAI-compatible endpoint management ----

  setGenericOpenAIEnabled(enabled: boolean): void {
    this.genericOpenAIEnabled = enabled;
    this.genericOpenAIProvider = null;
    this.invalidateModelCache();
  }

  isGenericOpenAIEnabled(): boolean {
    return this.genericOpenAIEnabled;
  }

  setGenericOpenAIBaseURL(baseURL: string): void {
    this.genericOpenAIBaseURL = this.normalizeGenericOpenAIBaseURL(baseURL);
    this.genericOpenAIProvider = null;
    this.invalidateModelCache();
  }

  getGenericOpenAIBaseURL(): string {
    return this.genericOpenAIBaseURL;
  }

  setGenericOpenAIApiKey(apiKey: string): void {
    this.genericOpenAIApiKey = apiKey;
    this.genericOpenAIProvider = null;
    this.invalidateModelCache();
  }

  getGenericOpenAIApiKey(): string {
    return this.genericOpenAIApiKey;
  }

  /** Register a model ID as belonging to the generic OpenAI endpoint. */
  registerGenericOpenAIModel(modelId: string): void {
    this.genericOpenAIModelIds.add(modelId);
  }

  /** Check whether a model ID was registered as a generic OpenAI model. */
  isGenericOpenAIModel(modelId: string): boolean {
    return this.genericOpenAIModelIds.has(modelId);
  }

  /** Remove all registered generic OpenAI model IDs. */
  clearGenericOpenAIModels(): void {
    this.genericOpenAIModelIds.clear();
  }

  /** Get capability overrides for a specific generic OpenAI model. */
  getGenericOpenAIModelCapabilities(modelId: string): { tools: boolean; vision: boolean } {
    return this.genericOpenAICapabilities.get(modelId) ?? { tools: false, vision: false };
  }

  /** Set capability overrides for a specific generic OpenAI model. */
  setGenericOpenAIModelCapabilities(modelId: string, caps: { tools: boolean; vision: boolean }): void {
    this.genericOpenAICapabilities.set(modelId, caps);
    this.invalidateModelCache();
  }

  /** Get all stored generic OpenAI capability overrides. */
  getAllGenericOpenAIModelCapabilities(): Record<string, { tools: boolean; vision: boolean }> {
    const result: Record<string, { tools: boolean; vision: boolean }> = {};
    for (const [id, caps] of this.genericOpenAICapabilities) {
      result[id] = caps;
    }
    return result;
  }

  /** Load generic OpenAI capability overrides from serialized object. */
  loadGenericOpenAIModelCapabilities(data: Record<string, { tools: boolean; vision: boolean }>): void {
    this.genericOpenAICapabilities.clear();
    for (const [id, caps] of Object.entries(data)) {
      this.genericOpenAICapabilities.set(id, caps);
    }
  }

  /** Check whether a generic OpenAI model has tools capability enabled. */
  genericOpenAIModelSupportsTools(modelId: string): boolean {
    return this.genericOpenAICapabilities.get(modelId)?.tools ?? false;
  }

  /** Check whether a generic OpenAI model has vision capability enabled. */
  genericOpenAIModelSupportsVision(modelId: string): boolean {
    return this.genericOpenAICapabilities.get(modelId)?.vision ?? false;
  }

  /**
   * Detect the effective provider for a model ID, checking Ollama, LM Studio,
   * and generic OpenAI registration first, then falling back to prefix-based detection.
   */
  detectModelProvider(modelId: string): string {
    if (this.ollamaModelIds.has(modelId)) {
      return 'ollama';
    }
    if (this.lmstudioModelIds.has(modelId)) {
      return 'lmstudio';
    }
    if (this.genericOpenAIModelIds.has(modelId)) {
      return 'generic-openai';
    }
    return detectProvider(modelId);
  }

  /** Check whether at least one provider key is configured. */
  isReady(): boolean {
    if (this._offlineMode) {
      return !!(this.ollamaEnabled || this.lmstudioEnabled);
    }
    return !!(this.opencodeKey || this.mistralKey || this.ollamaEnabled || this.lmstudioEnabled || this.genericOpenAIEnabled);
  }

  /** Check whether the key for a specific provider is set. */
  isProviderKeySet(provider: string): boolean {
    if (provider === 'ollama') {
      return this.ollamaEnabled;
    }
    if (provider === 'lmstudio') {
      return this.lmstudioEnabled;
    }
    if (provider === 'generic-openai') {
      return this.genericOpenAIEnabled && Boolean(this.genericOpenAIBaseURL);
    }
    // In offline mode, cloud providers are unavailable
    if (this._offlineMode) {
      return false;
    }
    if (provider === 'mistral') {
      return !!this.mistralKey;
    }
    return !!this.opencodeKey;
  }

  /** Returns status of all configured providers. */
  getProviderStatus(): { opencode: boolean; mistral: boolean; ollama: boolean; lmstudio: boolean; genericOpenAI: boolean; offlineMode: boolean } {
    return {
      opencode: !!this.opencodeKey,
      mistral: !!this.mistralKey,
      ollama: this.ollamaEnabled,
      lmstudio: this.lmstudioEnabled,
      genericOpenAI: this.genericOpenAIEnabled,
      offlineMode: this._offlineMode,
    };
  }

  // ---- Provider resolution ----

  /** Resolve a model ID to an AI SDK LanguageModel. */
  resolveModel(modelId: string): LanguageModel {
    // In offline mode, only local providers are allowed
    if (this._offlineMode && !this.ollamaModelIds.has(modelId) && !this.lmstudioModelIds.has(modelId)) {
      throw new Error(`Model '${modelId}' is not available offline. Switch to a local model or disable airplane mode.`);
    }

    // Check if this is a registered Ollama model first
    if (this.ollamaModelIds.has(modelId)) {
      if (!this.ollamaEnabled) {
        throw new Error(`Ollama not configured for model '${modelId}'`);
      }
      if (!this.ollamaProvider) {
        this.ollamaProvider = createOpenAI({
          baseURL: OLLAMA_BASE_URL,
          apiKey: 'ollama', // Ollama doesn't need a real key
        });
      }
      return this.ollamaProvider.chat(modelId);
    }

    // Check if this is a registered LM Studio model
    if (this.lmstudioModelIds.has(modelId)) {
      if (!this.lmstudioEnabled) {
        throw new Error(`LM Studio not configured for model '${modelId}'`);
      }
      if (!this.lmstudioProvider) {
        this.lmstudioProvider = createOpenAI({
          baseURL: LMSTUDIO_BASE_URL,
          apiKey: 'lm-studio', // LM Studio doesn't need a real key
        });
      }
      return this.lmstudioProvider.chat(modelId);
    }

    // Check if this is a registered generic OpenAI model
    if (this.genericOpenAIModelIds.has(modelId)) {
      if (!this.genericOpenAIEnabled || !this.genericOpenAIBaseURL) {
        throw new Error(`Generic OpenAI endpoint not configured for model '${modelId}'`);
      }
      if (!this.genericOpenAIProvider) {
        this.genericOpenAIProvider = createOpenAI({
          baseURL: this.genericOpenAIBaseURL,
          apiKey: this.genericOpenAIApiKey || 'dummy-key',
        });
      }
      return this.genericOpenAIProvider.chat(modelId);
    }

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

  /**
   * Return the first known local model ID, or null if none registered.
   * Used as automatic fallback when no explicit offline model is configured.
   */
  getFirstKnownLocalModelId(): string | null {
    for (const id of this.ollamaModelIds) {
      return id;
    }
    for (const id of this.lmstudioModelIds) {
      return id;
    }
    return null;
  }

  /**
   * Return the first known local vision-capable model ID, or null.
   */
  getFirstKnownLocalVisionModelId(): string | null {
    for (const id of this.ollamaModelIds) {
      if (this.ollamaModelSupportsVision(id)) {
        return id;
      }
    }
    for (const id of this.lmstudioModelIds) {
      if (this.lmstudioModelSupportsVision(id)) {
        return id;
      }
    }
    return null;
  }

  /**
   * Return models already known to belong to local providers (Ollama + LM Studio)
   * from in-memory sets, without any network fetch.
   */
  getKnownLocalModels(): ChatModel[] {
    const models: ChatModel[] = [];
    for (const id of this.ollamaModelIds) {
      models.push({ id, name: id, provider: 'ollama', vision: this.ollamaModelSupportsVision(id) });
    }
    for (const id of this.lmstudioModelIds) {
      models.push({ id, name: id, provider: 'lmstudio', vision: this.lmstudioModelSupportsVision(id) });
    }
    return models;
  }

  /** Get available models across all configured providers (cached 5 min). */
  async getAvailableModels(): Promise<ChatModel[]> {
    if (this.cachedModels && Date.now() - this.cachedModelsAt < MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    // In offline mode, return known local models instantly — no network.
    if (this._offlineMode) {
      const local = this.getKnownLocalModels();
      if (local.length > 0) {
        this.cachedModels = local;
        this.cachedModelsAt = Date.now();
      }
      return local;
    }

    const allModels: ChatModel[] = [];
    let fetched = false;
    const { vision: catalogVision, names: catalogNames } = await this.getCatalogLookups();

    // Fetch OpenCode models (skip in offline mode)
    if (this.opencodeKey && !this._offlineMode) {
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

    // Fetch Mistral models (skip in offline mode)
    if (this.mistralKey && !this._offlineMode) {
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

    // Fetch Ollama models
    if (this.ollamaEnabled) {
      try {
        const models = await this.fetchOllamaModels();
        allModels.push(...models);
        if (models.length > 0) {
          fetched = true;
        }
      } catch {
        // Ollama not running — skip silently
      }
    }

    // Fetch LM Studio models
    if (this.lmstudioEnabled) {
      try {
        const models = await this.fetchLmstudioModels();
        allModels.push(...models);
        if (models.length > 0) {
          fetched = true;
        }
      } catch {
        // LM Studio not running — skip silently
      }
    }

    // Fetch generic OpenAI-compatible endpoint models
    if (this.genericOpenAIEnabled && this.genericOpenAIBaseURL && !this._offlineMode) {
      try {
        const models = await this.fetchGenericOpenAIModels();
        allModels.push(...models);
        if (models.length > 0) {
          fetched = true;
        }
      } catch {
        // Generic OpenAI endpoint not available — skip silently
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
    if (!apiKey || apiKey.length < 3) {
      return { isValid: false, models: [] };
    }

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
    if (!apiKey || apiKey.length < 3) {
      return { isValid: false, models: [] };
    }

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

  // ---- LM Studio model listing ----

  /**
   * Fetch available models from LM Studio's OpenAI-compatible /v1/models endpoint.
   * Returns ChatModel[] and registers the model IDs internally.
   */
  async fetchLmstudioModels(): Promise<ChatModel[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LMSTUDIO_FETCH_TIMEOUT);
      const response = await fetch(LMSTUDIO_MODELS_URL, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      const models: ChatModel[] = data.data.map(m => ({
        id: m.id,
        name: m.id,
        provider: 'lmstudio',
        vision: this.lmstudioModelSupportsVision(m.id),
      }));
      // Only replace registered IDs on successful fetch
      this.clearLmstudioModels();
      for (const m of models) {
        this.registerLmstudioModel(m.id);
      }
      return models;
    } catch {
      return [];
    }
  }

  // ---- Ollama model listing ----

  /**
   * Fetch available models from Ollama's /api/tags endpoint.
   * Returns ChatModel[] and registers the model IDs internally.
   */
  async fetchOllamaModels(): Promise<ChatModel[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OLLAMA_FETCH_TIMEOUT);
      const response = await fetch(OLLAMA_TAGS_URL, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { models?: Array<{ name: string; details?: { family?: string } }> };
      if (!data.models || !Array.isArray(data.models)) {
        return [];
      }

      const models: ChatModel[] = data.models.map(m => ({
        id: m.name,
        name: m.name,
        provider: 'ollama',
        vision: this.ollamaModelSupportsVision(m.name),
      }));
      // Only replace registered IDs on successful fetch
      this.clearOllamaModels();
      for (const m of models) {
        this.registerOllamaModel(m.id);
      }
      return models;
    } catch {
      return [];
    }
  }

  // ---- Generic OpenAI-compatible endpoint model listing ----

  /**
   * Fetch available models from a generic OpenAI-compatible /v1/models endpoint.
   * Returns ChatModel[] and registers the model IDs internally.
   */
  async fetchGenericOpenAIModels(): Promise<ChatModel[]> {
    const normalizedBaseURL = this.normalizeGenericOpenAIBaseURL(this.genericOpenAIBaseURL);
    if (!normalizedBaseURL) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GENERIC_OPENAI_FETCH_TIMEOUT);
      
      const headers: Record<string, string> = {};
      if (this.genericOpenAIApiKey) {
        headers.Authorization = `Bearer ${this.genericOpenAIApiKey}`;
      }
      
      const response = await fetch(`${normalizedBaseURL}${GENERIC_OPENAI_MODELS_PATH}`, {
        method: 'GET', 
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      const models: ChatModel[] = data.data.map(m => ({
        id: m.id,
        name: m.id,
        provider: 'generic-openai',
        vision: this.genericOpenAIModelSupportsVision(m.id),
      }));
      
      // Only replace registered IDs on successful fetch
      this.clearGenericOpenAIModels();
      for (const m of models) {
        this.registerGenericOpenAIModel(m.id);
      }
      return models;
    } catch {
      return [];
    }
  }

  /**
   * Validate generic OpenAI endpoint configuration by fetching models.
   */
  async validateGenericOpenAIConfig(): Promise<{ isValid: boolean; models: ChatModel[]; error?: string }> {
    if (!this.genericOpenAIBaseURL) {
      return { isValid: false, models: [], error: 'Base URL is required' };
    }

    try {
      const models = await this.fetchGenericOpenAIModels();
      return { isValid: true, models };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { isValid: false, models: [], error: errorMessage };
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

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

  private normalizeGenericOpenAIBaseURL(baseURL: string): string {
    const trimmed = baseURL.trim().replace(/\/+$/, '');
    if (!trimmed) {
      return '';
    }
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
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
