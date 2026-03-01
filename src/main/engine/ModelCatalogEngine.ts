/**
 * ModelCatalogEngine — Fetches and caches model metadata from models.dev
 *
 * Provides model output token limits, pricing info, and capabilities
 * for all models available through the OpenCode Zen gateway.
 *
 * Data is persisted in SQLite (model_catalog + model_catalog_meta tables)
 * and refreshed on user action via conditional GET (ETag).
 * Works fully offline after first successful fetch.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { modelCatalog, modelCatalogMeta } from '../database/schema';
import type { ModelCatalogEntry } from '../database/schema';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const PROVIDER_KEY = 'opencode';

// Default max output tokens when no catalog data is available
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

export interface ModelCatalogInfo {
  id: string;
  name: string;
  family: string | null;
  contextWindow: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  supportsAttachments: boolean | null;
  supportsReasoning: boolean | null;
  supportsToolCall: boolean | null;
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
    return rows.map(toInfo);
  }

  /**
   * Get a single model's catalog entry by ID.
   */
  async getModel(modelId: string): Promise<ModelCatalogInfo | null> {
    const db = getDatabase().getLocal();
    const rows = await db.select().from(modelCatalog).where(eq(modelCatalog.id, modelId));
    return rows.length > 0 ? toInfo(rows[0]) : null;
  }

  /**
   * Get the max output tokens for a model (used by OpenCodeManager for max_tokens).
   * Returns DEFAULT_MAX_OUTPUT_TOKENS if the model is not in the catalog.
   */
  async getMaxOutputTokens(modelId: string): Promise<number> {
    const model = await this.getModel(modelId);
    return model?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  /**
   * Refresh the model catalog from models.dev using conditional GET (ETag).
   * Returns the number of models updated, or notModified if the data hasn't changed.
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
      const models = data?.[PROVIDER_KEY]?.models;
      if (!models || typeof models !== 'object') {
        return { success: false, modelsUpdated: 0, error: 'Invalid response: no opencode models found' };
      }

      // Store new ETag
      const newEtag = response.headers['etag'];
      if (typeof newEtag === 'string') {
        await this.setMeta('etag', newEtag);
      }
      await this.setMeta('lastFetchedAt', new Date().toISOString());

      // Upsert all models
      const count = await this.upsertModels(models);

      return { success: true, modelsUpdated: count };
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
   * Parse models.dev model entries and upsert into database.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async upsertModels(models: Record<string, any>): Promise<number> {
    const db = getDatabase().getLocal();
    const now = new Date();
    let count = 0;

    for (const [id, info] of Object.entries(models)) {
      if (!info || typeof info !== 'object') continue;

      const entry = {
        id,
        name: info.name || id,
        family: info.family || null,
        contextWindow: info.limit?.context ?? null,
        maxInputTokens: info.limit?.input ?? null,
        maxOutputTokens: info.limit?.output ?? null,
        inputPrice: info.cost?.input ?? null,
        outputPrice: info.cost?.output ?? null,
        cacheReadPrice: info.cost?.cache_read ?? null,
        supportsAttachments: info.attachment ?? false,
        supportsReasoning: info.reasoning ?? false,
        supportsToolCall: info.tool_call ?? false,
        updatedAt: now,
      };

      await db.insert(modelCatalog)
        .values(entry)
        .onConflictDoUpdate({
          target: modelCatalog.id,
          set: {
            name: entry.name,
            family: entry.family,
            contextWindow: entry.contextWindow,
            maxInputTokens: entry.maxInputTokens,
            maxOutputTokens: entry.maxOutputTokens,
            inputPrice: entry.inputPrice,
            outputPrice: entry.outputPrice,
            cacheReadPrice: entry.cacheReadPrice,
            supportsAttachments: entry.supportsAttachments,
            supportsReasoning: entry.supportsReasoning,
            supportsToolCall: entry.supportsToolCall,
            updatedAt: now,
          },
        });
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

function toInfo(row: ModelCatalogEntry): ModelCatalogInfo {
  return {
    id: row.id,
    name: row.name,
    family: row.family,
    contextWindow: row.contextWindow,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    cacheReadPrice: row.cacheReadPrice,
    supportsAttachments: row.supportsAttachments,
    supportsReasoning: row.supportsReasoning,
    supportsToolCall: row.supportsToolCall,
  };
}
