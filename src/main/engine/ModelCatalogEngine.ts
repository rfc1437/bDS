/**
 * ModelCatalogEngine — Fetches and caches model metadata from models.dev
 *
 * The full catalog is stored in three normalised SQLite tables:
 *   model_catalog_providers  — one row per provider (opencode, mistral, …)
 *   model_catalog            — one row per (provider, modelId) pair
 *   model_catalog_modalities — junction table with (provider, modelId, direction, modality) tags
 *
 * Data is refreshed on user action via conditional GET (ETag).
 * Works fully offline after first successful fetch.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../database';
import { modelCatalog, modelCatalogMeta, modelCatalogProviders, modelCatalogModalities } from '../database/schema';
import type { ModelCatalogEntry } from '../database/schema';

const MODELS_DEV_URL = 'https://models.dev/api.json';

// Default max output tokens when no catalog data is available
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

/** Provider-level metadata from models.dev. */
export interface ProviderInfo {
  id: string;
  name: string;
  env: string[];
  npm: string | null;
  api: string | null;
  doc: string | null;
}

/** Flattened model info returned by query methods. */
export interface ModelCatalogInfo {
  provider: string;
  id: string;
  name: string;
  family: string | null;
  attachment: boolean;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  temperature: boolean;
  knowledge: string | null;
  releaseDate: string | null;
  lastUpdatedDate: string | null;
  openWeights: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  contextWindow: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  interleaved: string | null;
  status: string | null;
  providerNpm: string | null;
  inputModalities: string[];
  outputModalities: string[];
}

export interface RefreshResult {
  success: boolean;
  modelsUpdated: number;
  notModified?: boolean;
  error?: string;
}

interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export class ModelCatalogEngine {
  /**
   * Get all cached model catalog entries from the database.
   */
  async getAll(): Promise<ModelCatalogInfo[]> {
    const db = getDatabase().getLocal();
    const rows = await db.select().from(modelCatalog);
    const modalities = await db.select().from(modelCatalogModalities);
    return rows.map(r => toInfo(r, modalities));
  }

  /**
   * Get all models for a specific provider.
   */
  async getByProvider(provider: string): Promise<ModelCatalogInfo[]> {
    const db = getDatabase().getLocal();
    const rows = await db.select().from(modelCatalog).where(eq(modelCatalog.provider, provider));
    const modalities = await db.select().from(modelCatalogModalities).where(eq(modelCatalogModalities.provider, provider));
    return rows.map(r => toInfo(r, modalities));
  }

  /**
   * Get a single model by provider and model ID.
   */
  async getModel(modelId: string, provider?: string): Promise<ModelCatalogInfo | null> {
    const db = getDatabase().getLocal();
    let rows: ModelCatalogEntry[];
    if (provider) {
      rows = await db.select().from(modelCatalog).where(
        and(eq(modelCatalog.provider, provider), eq(modelCatalog.modelId, modelId)),
      );
    } else {
      // Search across all providers, return first match
      rows = await db.select().from(modelCatalog).where(eq(modelCatalog.modelId, modelId));
    }
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    const modalities = await db.select().from(modelCatalogModalities).where(
      and(eq(modelCatalogModalities.provider, row.provider), eq(modelCatalogModalities.modelId, row.modelId)),
    );
    return toInfo(row, modalities);
  }

  /**
   * Get all providers from the catalog.
   */
  async getProviders(): Promise<ProviderInfo[]> {
    const db = getDatabase().getLocal();
    const rows = await db.select().from(modelCatalogProviders);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      env: r.env ? JSON.parse(r.env) as string[] : [],
      npm: r.npm,
      api: r.api,
      doc: r.doc,
    }));
  }

  /**
   * Get the max output tokens for a model (used for maxOutputTokens).
   * Returns DEFAULT_MAX_OUTPUT_TOKENS if the model is not in the catalog.
   */
  async getMaxOutputTokens(modelId: string, provider?: string): Promise<number> {
    const model = await this.getModel(modelId, provider);
    return model?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  /**
   * Get the context window size for a model.
   * Returns null if the model is not in the catalog.
   */
  async getContextWindow(modelId: string, provider?: string): Promise<number | null> {
    const model = await this.getModel(modelId, provider);
    return model?.contextWindow ?? null;
  }

  /**
   * Check whether a model supports a specific input modality (e.g. 'image').
   */
  async hasInputModality(modelId: string, modality: string, provider?: string): Promise<boolean> {
    const model = await this.getModel(modelId, provider);
    return model?.inputModalities.includes(modality) ?? false;
  }

  /**
   * Refresh the model catalog from models.dev using conditional GET (ETag).
   * Stores ALL providers and ALL models from the API.
   */
  async refresh(): Promise<RefreshResult> {
    try {
      // Read stored ETag for conditional GET
      const storedEtag = await this.getMeta('etag');

      // Build request headers
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (storedEtag) {
        headers['If-None-Match'] = storedEtag;
      }

      // Fetch from models.dev
      const response = await this.httpGet(MODELS_DEV_URL, headers);

      // 304 Not Modified — data hasn't changed
      if (response.statusCode === 304) {
        await this.setMeta('lastFetchedAt', new Date().toISOString());
        return { success: true, modelsUpdated: 0, notModified: true };
      }

      if (response.statusCode !== 200) {
        return { success: false, modelsUpdated: 0, error: `HTTP ${response.statusCode}` };
      }

      // Parse response
      const data = JSON.parse(response.body);
      if (!data || typeof data !== 'object') {
        return { success: false, modelsUpdated: 0, error: 'Invalid response: not an object' };
      }

      // Count providers with models
      const providerEntries = Object.entries(data).filter(
        ([, v]) => v && typeof v === 'object' && 'models' in (v as Record<string, unknown>),
      );
      if (providerEntries.length === 0) {
        return { success: false, modelsUpdated: 0, error: 'Invalid response: no providers found' };
      }

      // Store new ETag
      const newEtag = response.headers['etag'];
      if (typeof newEtag === 'string') {
        await this.setMeta('etag', newEtag);
      }
      await this.setMeta('lastFetchedAt', new Date().toISOString());

      // Upsert all providers and their models
      let totalModels = 0;
      for (const [providerId, providerData] of providerEntries) {
        const prov = providerData as Record<string, unknown>;
        await this.upsertProvider(providerId, prov);
        const models = prov.models as Record<string, unknown> | undefined;
        if (models && typeof models === 'object') {
          totalModels += await this.upsertModels(providerId, models);
        }
      }

      return { success: true, modelsUpdated: totalModels };
    } catch (error) {
      return { success: false, modelsUpdated: 0, error: (error as Error).message };
    }
  }

  /**
   * Get the last time the catalog was successfully fetched.
   */
  async getLastFetchedAt(): Promise<string | null> {
    return this.getMeta('lastFetchedAt');
  }

  // ── Internal ──

  /**
   * Upsert a provider row.
   */
  private async upsertProvider(id: string, data: Record<string, unknown>): Promise<void> {
    const db = getDatabase().getLocal();
    const now = new Date();
    const env = Array.isArray(data.env) ? JSON.stringify(data.env) : null;

    await db.insert(modelCatalogProviders)
      .values({
        id,
        name: (data.name as string) || id,
        env,
        npm: (data.npm as string) || null,
        api: (data.api as string) || null,
        doc: (data.doc as string) || null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelCatalogProviders.id,
        set: {
          name: (data.name as string) || id,
          env,
          npm: (data.npm as string) || null,
          api: (data.api as string) || null,
          doc: (data.doc as string) || null,
          updatedAt: now,
        },
      });
  }

  /**
   * Parse and upsert model entries for a given provider.
   * Also writes modality rows to the junction table.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async upsertModels(providerId: string, models: Record<string, any>): Promise<number> {
    const db = getDatabase().getLocal();
    const now = new Date();
    let count = 0;

    for (const [id, info] of Object.entries(models)) {
      if (!info || typeof info !== 'object') {
        continue;
      }

      const entry = {
        provider: providerId,
        modelId: id,
        name: info.name || id,
        family: info.family || null,
        attachment: info.attachment ?? false,
        reasoning: info.reasoning ?? false,
        toolCall: info.tool_call ?? false,
        structuredOutput: info.structured_output ?? false,
        temperature: info.temperature ?? false,
        knowledge: info.knowledge || null,
        releaseDate: info.release_date || null,
        lastUpdatedDate: info.last_updated || null,
        openWeights: info.open_weights ?? false,
        inputPrice: info.cost?.input ?? null,
        outputPrice: info.cost?.output ?? null,
        cacheReadPrice: info.cost?.cache_read ?? null,
        cacheWritePrice: info.cost?.cache_write ?? null,
        contextWindow: info.limit?.context ?? null,
        maxInputTokens: info.limit?.input ?? null,
        maxOutputTokens: info.limit?.output ?? null,
        interleaved: info.interleaved ? JSON.stringify(info.interleaved) : null,
        status: info.status || null,
        providerNpm: info.provider?.npm || null,
        updatedAt: now,
      };

      await db.insert(modelCatalog)
        .values(entry)
        .onConflictDoUpdate({
          target: [modelCatalog.provider, modelCatalog.modelId],
          set: {
            name: entry.name,
            family: entry.family,
            attachment: entry.attachment,
            reasoning: entry.reasoning,
            toolCall: entry.toolCall,
            structuredOutput: entry.structuredOutput,
            temperature: entry.temperature,
            knowledge: entry.knowledge,
            releaseDate: entry.releaseDate,
            lastUpdatedDate: entry.lastUpdatedDate,
            openWeights: entry.openWeights,
            inputPrice: entry.inputPrice,
            outputPrice: entry.outputPrice,
            cacheReadPrice: entry.cacheReadPrice,
            cacheWritePrice: entry.cacheWritePrice,
            contextWindow: entry.contextWindow,
            maxInputTokens: entry.maxInputTokens,
            maxOutputTokens: entry.maxOutputTokens,
            interleaved: entry.interleaved,
            status: entry.status,
            providerNpm: entry.providerNpm,
            updatedAt: now,
          },
        });

      // Upsert modality tags
      const mods = info.modalities;
      if (mods && typeof mods === 'object') {
        for (const direction of ['input', 'output'] as const) {
          const tags = mods[direction];
          if (Array.isArray(tags)) {
            for (const modality of tags) {
              if (typeof modality === 'string') {
                await db.insert(modelCatalogModalities)
                  .values({ provider: providerId, modelId: id, direction, modality })
                  .onConflictDoUpdate({
                    target: [
                      modelCatalogModalities.provider,
                      modelCatalogModalities.modelId,
                      modelCatalogModalities.direction,
                      modelCatalogModalities.modality,
                    ],
                    set: { modality }, // no-op update to satisfy ON CONFLICT
                  });
              }
            }
          }
        }
      }

      count++;
    }

    return count;
  }

  private async getMeta(key: string): Promise<string | null> {
    const db = getDatabase().getLocal();
    const rows = await db.select().from(modelCatalogMeta).where(eq(modelCatalogMeta.key, key));
    return rows.length > 0 ? rows[0].value : null;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    const db = getDatabase().getLocal();
    await db.insert(modelCatalogMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: modelCatalogMeta.key, set: { value } });
  }

  private httpGet(
    urlStr: string,
    headers: Record<string, string>,
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(url, {
        method: 'GET',
        headers,
        timeout: 15000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body,
            headers: res.headers as Record<string, string | string[] | undefined>,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.end();
    });
  }
}

// ── Helpers ──

/** Map of (provider, modelId) → { input: string[], output: string[] } for modalities */
type ModalityEntry = { provider: string; modelId: string; direction: string; modality: string };

function toInfo(row: ModelCatalogEntry, allModalities: ModalityEntry[]): ModelCatalogInfo {
  const rowModalities = allModalities.filter(m => m.provider === row.provider && m.modelId === row.modelId);
  return {
    provider: row.provider,
    id: row.modelId,
    name: row.name,
    family: row.family,
    attachment: row.attachment ?? false,
    reasoning: row.reasoning ?? false,
    toolCall: row.toolCall ?? false,
    structuredOutput: row.structuredOutput ?? false,
    temperature: row.temperature ?? false,
    knowledge: row.knowledge,
    releaseDate: row.releaseDate,
    lastUpdatedDate: row.lastUpdatedDate,
    openWeights: row.openWeights ?? false,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    cacheReadPrice: row.cacheReadPrice,
    cacheWritePrice: row.cacheWritePrice ?? null,
    contextWindow: row.contextWindow,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    interleaved: row.interleaved,
    status: row.status,
    providerNpm: row.providerNpm,
    inputModalities: rowModalities.filter(m => m.direction === 'input').map(m => m.modality),
    outputModalities: rowModalities.filter(m => m.direction === 'output').map(m => m.modality),
  };
}
