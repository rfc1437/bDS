/**
 * EmbeddingEngine
 *
 * Provides semantic similarity features using local ONNX embeddings (multilingual-e5-small)
 * and HNSW vector search via USearch. All processing is fully local — no external API calls.
 *
 * Features:
 * - findSimilar: Find thematically related posts (InsertModal, "have I written this?")
 * - suggestTags: Infer tags from similar posts
 * - findDuplicates: Audit tool for near-duplicate post detection
 *
 * Architecture:
 * - Model stays loaded across project switches (one model, multiple indexes)
 * - USearch index file per project: {userData}/projects/{projectId}/embeddings.usearch
 * - Label→postId mapping in `embedding_keys` DB table (avoids bigint JSON issues)
 * - Vector cache keyed by postId (in-memory only; re-computed after restart from post content)
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, inArray } from 'drizzle-orm';
import { getDatabase } from '../database';
import { embeddingKeys, dismissedDuplicatePairs, posts } from '../database/schema';

export interface SimilarPost {
  postId: string;
  similarity: number; // cosine similarity 0-1
}

export interface TagSuggestion {
  name: string;
  score: number; // weighted frequency
}

export interface DuplicatePair {
  postA: { id: string; title: string; slug: string; publishedAt?: Date };
  postB: { id: string; title: string; slug: string; publishedAt?: Date };
  similarity: number;
}

// Injected dependencies for testability
export interface EmbeddingEngineDeps {
  /** Return the path to the USearch index file for a project */
  getIndexPath: (projectId: string) => string;
  /** Create the embedding pipeline (dependency-injected for tests) */
  createPipeline?: () => Promise<EmbeddingPipeline>;
}

export interface EmbeddingPipeline {
  embed(text: string): Promise<Float32Array>;
}

export class EmbeddingEngine extends EventEmitter {
  private deps: EmbeddingEngineDeps;
  private pipeline: EmbeddingPipeline | null = null;
  private pipelineLoadPromise: Promise<EmbeddingPipeline> | null = null;

  // USearch index (lazily loaded per-project)
  private index: import('usearch').Index | null = null;
  private currentProjectId: string | null = null;

  // Label->postId map (backed by DB, kept in memory for fast lookup)
  private labelToPostId: Map<bigint, string> = new Map();
  private postIdToLabel: Map<string, bigint> = new Map();
  private nextLabel: bigint = 1n;

  // In-memory vector cache -- populated when posts are embedded this session.
  // After restart, vectors must be re-computed on demand from post content.
  private vectorCache: Map<string, Float32Array> = new Map(); // postId -> vector

  // Debounced save timer
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 5000;

  // Model dimensions
  private readonly DIMENSIONS = 384;
  private readonly MODEL_ID = 'Xenova/multilingual-e5-small';

  constructor(deps: EmbeddingEngineDeps) {
    super();
    this.deps = deps;
  }

  // Lifecycle

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.pipelineLoadPromise) {
      await this.pipelineLoadPromise;
      return;
    }
    this.pipelineLoadPromise = this.loadPipeline();
    this.pipeline = await this.pipelineLoadPromise;
  }

  private async loadPipeline(): Promise<EmbeddingPipeline> {
    if (this.deps.createPipeline) {
      return this.deps.createPipeline();
    }

    // Dynamic import to avoid loading heavy ONNX runtime at startup
    const { pipeline, env } = await import('@huggingface/transformers');

    // Configure cache for Electron -- use ~/.cache/huggingface
    env.useFSCache = true;

    const extractor = await pipeline('feature-extraction', this.MODEL_ID, {
      dtype: 'fp32',
    });

    return {
      embed: async (text: string): Promise<Float32Array> => {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        // v3: output.data is Float32Array
        return output.data as Float32Array;
      },
    };
  }

  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.index && this.currentProjectId) {
      await this.save();
    }
    this.index = null;
    this.currentProjectId = null;
    this.labelToPostId.clear();
    this.postIdToLabel.clear();
    this.vectorCache.clear();
    this.nextLabel = 1n;
    this.pipeline = null;
    this.pipelineLoadPromise = null;
  }

  // Project switching

  async setProjectContext(projectId: string): Promise<void> {
    if (this.currentProjectId === projectId) return;

    // Save and unload current index
    if (this.index && this.currentProjectId) {
      await this.save();
    }
    this.index = null;
    this.labelToPostId.clear();
    this.postIdToLabel.clear();
    this.vectorCache.clear();
    this.nextLabel = 1n;

    this.currentProjectId = projectId;

    // Load (or create) index for new project
    await this.ensureIndexLoaded();
  }

  private async ensureIndexLoaded(): Promise<void> {
    if (this.index) return;
    if (!this.currentProjectId) return;

    const { Index, MetricKind, ScalarKind } = await import('usearch');
    this.index = new Index({
      metric: MetricKind.Cos,
      quantization: ScalarKind.F32,
      dimensions: this.DIMENSIONS,
      connectivity: 16,
      expansion_add: 128,
      expansion_search: 64,
      multi: false,
    });

    const indexPath = this.deps.getIndexPath(this.currentProjectId);
    try {
      await fs.access(indexPath);
      this.index.load(indexPath);
    } catch {
      // No index file yet -- start fresh
    }

    // Load key mapping from DB
    await this.loadKeyMapFromDb(this.currentProjectId);
  }

  private async loadKeyMapFromDb(projectId: string): Promise<void> {
    const db = getDatabase().getLocal();
    const rows = await db
      .select()
      .from(embeddingKeys)
      .where(eq(embeddingKeys.projectId, projectId));

    this.labelToPostId.clear();
    this.postIdToLabel.clear();
    this.nextLabel = 1n;

    for (const row of rows) {
      const label = BigInt(row.label);
      this.labelToPostId.set(label, row.postId);
      this.postIdToLabel.set(row.postId, label);
      if (label >= this.nextLabel) {
        this.nextLabel = label + 1n;
      }
    }
  }

  // Core operations

  async embedPost(postId: string, title: string, content: string): Promise<void> {
    await this.initialize();
    await this.ensureIndexLoaded();

    if (!this.index || !this.pipeline || !this.currentProjectId) return;

    const rawText = `${title}\n\n${content}`;
    const hash = this.computeHash(rawText);

    // Check if already indexed with same hash (no-op)
    const db = getDatabase().getLocal();
    const existing = await db
      .select()
      .from(embeddingKeys)
      .where(
        and(
          eq(embeddingKeys.postId, postId),
          eq(embeddingKeys.projectId, this.currentProjectId),
        ),
      );

    if (existing.length > 0 && existing[0]!.contentHash === hash) {
      return; // Unchanged, skip re-embedding
    }

    // Remove old vector if exists
    if (existing.length > 0) {
      const oldLabel = BigInt(existing[0]!.label);
      try {
        this.index.remove(oldLabel);
      } catch {
        // Ignore remove errors -- label may not be in index
      }
      this.labelToPostId.delete(oldLabel);
      this.postIdToLabel.delete(postId);
      this.vectorCache.delete(postId);
      await db.delete(embeddingKeys).where(
        and(
          eq(embeddingKeys.postId, postId),
          eq(embeddingKeys.projectId, this.currentProjectId),
        ),
      );
    }

    // Compute embedding
    const text = `query: ${rawText}`;
    const vector = await this.embedText(text);

    // Assign new label
    const label = this.nextLabel++;
    this.index.add(label, vector);
    this.labelToPostId.set(label, postId);
    this.postIdToLabel.set(postId, label);
    this.vectorCache.set(postId, vector);

    // Persist key mapping (label is bigint in-memory, stored as number in SQLite)
    await db.insert(embeddingKeys).values({
      label: Number(label),
      postId,
      projectId: this.currentProjectId,
      contentHash: hash,
    });

    this.scheduleSave();
  }

  async removePost(postId: string): Promise<void> {
    await this.ensureIndexLoaded();
    if (!this.index || !this.currentProjectId) return;

    const label = this.postIdToLabel.get(postId);
    if (label === undefined) return;

    try {
      this.index.remove(label);
    } catch {
      // Ignore remove errors
    }
    this.labelToPostId.delete(label);
    this.postIdToLabel.delete(postId);
    this.vectorCache.delete(postId);

    const db = getDatabase().getLocal();
    await db.delete(embeddingKeys).where(
      and(
        eq(embeddingKeys.postId, postId),
        eq(embeddingKeys.projectId, this.currentProjectId),
      ),
    );

    this.scheduleSave();
  }

  async findSimilar(postId: string, k = 5): Promise<SimilarPost[]> {
    await this.ensureIndexLoaded();
    if (!this.index || !this.currentProjectId) return [];

    if (!this.postIdToLabel.has(postId)) return [];

    // Guard against empty index (USearch throws on empty index search)
    if (this.postIdToLabel.size < 2) return [];

    // Get or compute vector for this post
    const vector = await this.getOrComputeVector(postId);
    if (!vector) return [];

    // Search for k+1 (to exclude self) with HNSW
    const result = this.index.search(vector, k + 1, 0);
    if (!result) return [];

    const results: SimilarPost[] = [];
    for (let i = 0; i < result.keys.length; i++) {
      const foundLabel = result.keys[i]!;
      const foundPostId = this.labelToPostId.get(foundLabel);
      if (!foundPostId || foundPostId === postId) continue;

      const distance = result.distances[i]!;
      // USearch cosine metric returns distance (0=identical), convert to similarity
      const similarity = Math.max(0, 1 - distance);
      results.push({ postId: foundPostId, similarity });
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, k);
  }

  // Derived features

  async suggestTags(postId: string, excludeTags: string[]): Promise<TagSuggestion[]> {
    const similar = await this.findSimilar(postId, 10);
    if (similar.length === 0) return [];

    if (!this.currentProjectId) return [];

    // Get tags for similar posts
    const similarPostIds = similar.map((s) => s.postId);
    const db = getDatabase().getLocal();
    const postRows = await db
      .select({ id: posts.id, tags: posts.tags })
      .from(posts)
      .where(inArray(posts.id, similarPostIds));

    const excludeSet = new Set(excludeTags.map((t) => t.toLowerCase()));
    const tagScores = new Map<string, number>();

    for (const row of postRows) {
      const simItem = similar.find((s) => s.postId === row.id);
      if (!simItem) continue;

      const postTags: string[] = JSON.parse(row.tags || '[]');
      for (const tag of postTags) {
        if (excludeSet.has(tag.toLowerCase())) continue;
        const current = tagScores.get(tag) || 0;
        tagScores.set(tag, current + simItem.similarity);
      }
    }

    return Array.from(tagScores.entries())
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  async findDuplicates(threshold = 0.92): Promise<DuplicatePair[]> {
    await this.ensureIndexLoaded();
    if (!this.index || !this.currentProjectId) return [];

    const projectId = this.currentProjectId;
    const db = getDatabase().getLocal();

    // Get dismissed pairs
    const dismissed = await db
      .select()
      .from(dismissedDuplicatePairs)
      .where(eq(dismissedDuplicatePairs.projectId, projectId));

    const dismissedSet = new Set<string>();
    for (const d of dismissed) {
      dismissedSet.add(this.pairKey(d.postIdA, d.postIdB));
    }

    // Get post info for all indexed posts
    const allPostIds = Array.from(this.postIdToLabel.keys());
    if (allPostIds.length === 0) return [];

    const postRows = await db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(inArray(posts.id, allPostIds));

    const postMap = new Map(postRows.map((p) => [p.id, p]));

    const pairs: DuplicatePair[] = [];
    const seenPairs = new Set<string>();

    for (const postId of allPostIds) {
      const vector = await this.getOrComputeVector(postId);
      if (!vector) continue;

      const result = this.index.search(vector, 21, 0);
      if (!result) continue;

      for (let i = 0; i < result.keys.length; i++) {
        const otherLabel = result.keys[i]!;
        const otherPostId = this.labelToPostId.get(otherLabel);
        if (!otherPostId || otherPostId === postId) continue;

        const distance = result.distances[i]!;
        const similarity = Math.max(0, 1 - distance);
        if (similarity < threshold) continue;

        const key = this.pairKey(postId, otherPostId);
        if (seenPairs.has(key) || dismissedSet.has(key)) continue;
        seenPairs.add(key);

        const postA = postMap.get(postId);
        const postB = postMap.get(otherPostId);
        if (!postA || !postB) continue;

        pairs.push({
          postA: {
            id: postA.id,
            title: postA.title,
            slug: postA.slug,
            publishedAt: postA.publishedAt ?? undefined,
          },
          postB: {
            id: postB.id,
            title: postB.title,
            slug: postB.slug,
            publishedAt: postB.publishedAt ?? undefined,
          },
          similarity,
        });
      }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
  }

  async dismissPair(postIdA: string, postIdB: string): Promise<void> {
    if (!this.currentProjectId) return;
    const db = getDatabase().getLocal();
    const [a, b] = this.sortedPairIds(postIdA, postIdB);
    await db.insert(dismissedDuplicatePairs).values({
      id: uuidv4(),
      projectId: this.currentProjectId,
      postIdA: a,
      postIdB: b,
      dismissedAt: new Date(),
    }).onConflictDoNothing();
  }

  // Indexing management

  async getIndexingProgress(): Promise<{ indexed: number; total: number }> {
    if (!this.currentProjectId) return { indexed: 0, total: 0 };
    await this.ensureIndexLoaded();

    const db = getDatabase().getLocal();
    const indexed = this.labelToPostId.size;

    const allPosts = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));

    return { indexed, total: allPosts.length };
  }

  async reindexAll(): Promise<void> {
    await this.ensureIndexLoaded();
    if (!this.currentProjectId) return;

    const db = getDatabase().getLocal();

    // Clear existing index
    await db.delete(embeddingKeys).where(eq(embeddingKeys.projectId, this.currentProjectId));
    const { Index, MetricKind, ScalarKind } = await import('usearch');
    this.index = new Index({
      metric: MetricKind.Cos,
      quantization: ScalarKind.F32,
      dimensions: this.DIMENSIONS,
      connectivity: 16,
      expansion_add: 128,
      expansion_search: 64,
      multi: false,
    });
    this.labelToPostId.clear();
    this.postIdToLabel.clear();
    this.vectorCache.clear();
    this.nextLabel = 1n;

    await this.indexUnindexedPosts();
  }

  async indexUnindexedPosts(onProgress?: (indexed: number, total: number) => void): Promise<void> {
    await this.initialize();
    await this.ensureIndexLoaded();
    if (!this.currentProjectId) return;

    const db = getDatabase().getLocal();
    const allPosts = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
      })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));

    // Get current hashes from DB for change detection
    const keyRows = await db
      .select()
      .from(embeddingKeys)
      .where(eq(embeddingKeys.projectId, this.currentProjectId));

    const hashMap = new Map(keyRows.map((r) => [r.postId, r.contentHash]));

    const toIndex = allPosts.filter((p) => {
      const raw = `${p.title}\n\n${p.content || ''}`;
      const hash = this.computeHash(raw);
      return hashMap.get(p.id) !== hash;
    });

    let count = 0;
    let batchCount = 0;
    const BATCH_SAVE_INTERVAL = 100;

    for (const post of toIndex) {
      const content = post.content || '';
      await this.embedPost(post.id, post.title, content);
      count++;
      batchCount++;
      onProgress?.(count, toIndex.length);

      if (batchCount >= BATCH_SAVE_INTERVAL) {
        await this.save();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await this.save();
    }
  }

  // Persistence

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.index || !this.currentProjectId) return;

    const indexPath = this.deps.getIndexPath(this.currentProjectId);
    const dir = path.dirname(indexPath);
    await fs.mkdir(dir, { recursive: true });
    this.index.save(indexPath);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch((err) => console.error('[EmbeddingEngine] save error:', err));
    }, this.SAVE_DEBOUNCE_MS);
  }

  // Helpers

  /**
   * Get vector for a postId from session cache, or re-compute it from post content.
   * After a restart, vectors must be re-computed since USearch has no get-by-label API.
   */
  private async getOrComputeVector(postId: string): Promise<Float32Array | null> {
    const cached = this.vectorCache.get(postId);
    if (cached) return cached;

    // Re-embed from post content
    await this.initialize();
    if (!this.pipeline || !this.currentProjectId) return null;

    const db = getDatabase().getLocal();
    const postRows = await db
      .select({ title: posts.title, content: posts.content })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.projectId, this.currentProjectId)));

    if (postRows.length === 0) return null;

    const post = postRows[0]!;
    const rawText = `${post.title}\n\n${post.content || ''}`;
    const text = `query: ${rawText}`;
    const vector = await this.embedText(text);
    this.vectorCache.set(postId, vector);
    return vector;
  }

  private async embedText(text: string): Promise<Float32Array> {
    if (!this.pipeline) throw new Error('EmbeddingEngine not initialized');
    return this.pipeline.embed(text);
  }

  private computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  private pairKey(idA: string, idB: string): string {
    const [a, b] = this.sortedPairIds(idA, idB);
    return `${a}::${b}`;
  }

  private sortedPairIds(idA: string, idB: string): [string, string] {
    return idA < idB ? [idA, idB] : [idB, idA];
  }
}
