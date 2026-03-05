import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { EmbeddingEngine, type EmbeddingPipeline } from '../../src/main/engine/EmbeddingEngine';

// ── In-memory DB store ─────────────────────────────────────────────────────

interface KeyRow {
  label: bigint;
  postId: string;
  projectId: string;
  contentHash: string;
}

interface DismissedRow {
  id: string;
  projectId: string;
  postIdA: string;
  postIdB: string;
  dismissedAt: Date;
}

interface PostRow {
  id: string;
  title: string;
  slug?: string;
  content: string | null;
  tags?: string;
  publishedAt?: Date | null;
}

let keyRowsStore: KeyRow[] = [];
let dismissedRowsStore: DismissedRow[] = [];
let postRowsStore: PostRow[] = [];

// Drizzle stores the SQL table name at this symbol
const DRIZZLE_NAME = Symbol.for('drizzle:Name');
const DRIZZLE_BASE_NAME = Symbol.for('drizzle:BaseName');

function getTableName(table: unknown): string {
  if (table && typeof table === 'object') {
    const t = table as Record<symbol, unknown>;
    return (t[DRIZZLE_NAME] as string) || (t[DRIZZLE_BASE_NAME] as string) || '';
  }
  return '';
}

const mockDb = {
  selectFn: vi.fn(),
  insertFn: vi.fn(),
  deleteFn: vi.fn(),

  select() {
    // Returns a drizzle-like query chain
    let tableName = '';

    const chain: Record<string, unknown> = {
      from: vi.fn((table: unknown) => {
        tableName = getTableName(table);
        return chain;
      }),
      where: vi.fn((_cond: unknown) => {
        // Return the appropriate store based on table
        let rows: unknown[] = [];
        if (tableName === 'embedding_keys') {
          rows = keyRowsStore;
        } else if (tableName === 'dismissed_duplicate_pairs') {
          rows = dismissedRowsStore;
        } else if (tableName === 'posts') {
          rows = postRowsStore;
        }
        return Promise.resolve(rows);
      }),
    };
    return chain;
  },

  insert(_table: unknown) {
    const tableName = getTableName(_table);
    return {
      values: vi.fn((row: unknown) => {
        if (tableName === 'embedding_keys') {
          keyRowsStore.push(row as KeyRow);
        } else if (tableName === 'dismissed_duplicate_pairs') {
          dismissedRowsStore.push(row as DismissedRow);
        }
        return { onConflictDoNothing: vi.fn().mockResolvedValue([]) };
      }),
    };
  },

  delete(_table: unknown) {
    return {
      where: vi.fn((_cond: unknown) => {
        return Promise.resolve([]);
      }),
    };
  },
};

vi.mock('../../src/main/database', () => ({
  getDatabase: () => ({
    getLocal: () => mockDb,
  }),
}));

// ── Deterministic mock pipeline ────────────────────────────────────────────

let embedCallCount = 0;

function makeEmbedFn() {
  return vi.fn().mockImplementation(async (text: string): Promise<Float32Array> => {
    embedCallCount++;
    const arr = new Float32Array(384).fill(0);
    // Produce unique vector per text
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    arr[Math.abs(hash) % 384] = 1;
    arr[(Math.abs(hash * 31) % 383 + 1) % 384] = 0.7;
    // Normalize
    const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < arr.length; i++) {
      arr[i] = arr[i]! / norm;
    }
    return arr;
  });
}

function createMockPipeline(): EmbeddingPipeline {
  return { embed: makeEmbedFn() };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEngine(tmpDir: string): EmbeddingEngine {
  return new EmbeddingEngine({
    getIndexPath: (projectId: string) => path.join(tmpDir, `${projectId}.usearch`),
    createPipeline: async () => createMockPipeline(),
  });
}

// Manually replicate embedPost logic in tests (insert key row, update in-memory state)
// so we can set up test scenarios without relying on DB mock filtering
async function addKeyRow(row: KeyRow): Promise<void> {
  keyRowsStore.push(row);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EmbeddingEngine', () => {
  let tmpDir: string;
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    keyRowsStore = [];
    dismissedRowsStore = [];
    postRowsStore = [];
    embedCallCount = 0;
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'embedding-test-'));
    engine = makeEngine(tmpDir);
    await engine.setProjectContext('proj1');
  });

  afterEach(async () => {
    await engine.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('embedPost', () => {
    it('adds vector to index and persists key row', async () => {
      await engine.embedPost('post-1', 'Hello World', 'This is my first post');

      expect(keyRowsStore.length).toBe(1);
      expect(keyRowsStore[0]!.postId).toBe('post-1');
      expect(keyRowsStore[0]!.projectId).toBe('proj1');
      expect(keyRowsStore[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('skips re-embedding when content hash unchanged', async () => {
      await engine.embedPost('post-1', 'Hello', 'Content');
      const countBefore = embedCallCount;

      // Embed same content again — engine uses in-memory hash check after first embed
      await engine.embedPost('post-1', 'Hello', 'Content');

      // Should not have called embed again (no re-embed on unchanged content)
      expect(embedCallCount).toBe(countBefore);
    });

    it('does not skip re-embedding when content changes', async () => {
      await engine.embedPost('post-1', 'Hello', 'Original');
      const countAfterFirst = embedCallCount;

      // Update content (simulating second call with different content; engine detects hash change)
      // We need to trick the engine by clearing the internal keyRowsStore entry so the
      // DB mock returns empty for the second lookup
      keyRowsStore = [];

      await engine.embedPost('post-1', 'Hello', 'Updated content');

      expect(embedCallCount).toBeGreaterThan(countAfterFirst);
    });
  });

  describe('removePost', () => {
    it('removes post from index and key map', async () => {
      await engine.embedPost('post-1', 'Hello', 'Content');
      expect(keyRowsStore.length).toBe(1);

      await engine.removePost('post-1');

      // Key map should not have post-1 anymore
      // (The delete mock doesn't clear keyRowsStore, but the in-memory map should be cleared)
      const results = await engine.findSimilar('post-1');
      expect(results).toEqual([]);
    });

    it('is a no-op for non-existent post', async () => {
      await engine.removePost('non-existent'); // should not throw
    });
  });

  describe('findSimilar', () => {
    it('returns empty array for non-indexed post', async () => {
      const results = await engine.findSimilar('not-indexed');
      expect(results).toEqual([]);
    });

    it('returns empty when only one post indexed', async () => {
      await engine.embedPost('post-1', 'Only post', 'Content');
      const results = await engine.findSimilar('post-1');
      expect(results).toEqual([]);
    });

    it('returns similar posts ranked by similarity', async () => {
      await engine.embedPost('post-1', 'Machine learning basics', 'Intro to ML and neural nets');
      await engine.embedPost('post-2', 'Deep learning tutorial', 'Advanced ML techniques');
      await engine.embedPost('post-3', 'Cooking recipes', 'How to make pasta');

      const results = await engine.findSimilar('post-1', 5);

      expect(Array.isArray(results)).toBe(true);
      expect(results.every((r) => r.postId !== 'post-1')).toBe(true);
      expect(results.every((r) => r.similarity >= 0 && r.similarity <= 1)).toBe(true);
      // Results should be sorted by similarity descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.similarity).toBeLessThanOrEqual(results[i - 1]!.similarity);
      }
    });
  });

  describe('getIndexingProgress', () => {
    it('returns zero indexed and total when no posts', async () => {
      postRowsStore = [];
      const progress = await engine.getIndexingProgress();
      expect(progress.indexed).toBe(0);
      expect(progress.total).toBe(0);
    });

    it('returns indexed from key map and total from posts table', async () => {
      await engine.embedPost('post-1', 'Title 1', 'Content 1');

      // Set up posts DB to return 3 posts (only 1 indexed)
      postRowsStore = [
        { id: 'post-1', title: 'T1', content: 'C1' },
        { id: 'post-2', title: 'T2', content: 'C2' },
        { id: 'post-3', title: 'T3', content: 'C3' },
      ];

      const progress = await engine.getIndexingProgress();
      expect(progress.indexed).toBe(1); // only post-1 in key map
      expect(progress.total).toBe(3); // 3 posts in DB
    });
  });

  describe('setProjectContext', () => {
    it('clears key map when switching projects', async () => {
      await engine.embedPost('post-1', 'Title', 'Content');

      // Switch to new project — should clear key map
      keyRowsStore = []; // No keys for proj2
      await engine.setProjectContext('proj2');

      // post-1 is no longer in the key map for proj2
      const results = await engine.findSimilar('post-1');
      expect(results).toEqual([]);
    });

    it('is a no-op when called with same project', async () => {
      await engine.embedPost('post-1', 'Title', 'Content');

      await engine.setProjectContext('proj1'); // same project

      // Key map should still have post-1
      expect(engine['postIdToLabel'].has('post-1')).toBe(true);
    });
  });

  describe('save and load', () => {
    it('persists USearch index file to disk', async () => {
      await engine.embedPost('post-1', 'Hello', 'World');
      await engine.save();

      const indexPath = path.join(tmpDir, 'proj1.usearch');
      const stat = await fs.stat(indexPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('loads persisted index after restart', async () => {
      await engine.embedPost('post-1', 'Hello', 'World');
      await engine.embedPost('post-2', 'Goodbye', 'World two');
      await engine.save();
      const savedKeyRows = [...keyRowsStore];

      // Create new engine instance simulating restart
      const engine2 = makeEngine(tmpDir);
      keyRowsStore = savedKeyRows; // Restore DB state
      await engine2.setProjectContext('proj1');

      // Should have loaded the key map
      expect(engine2['postIdToLabel'].has('post-1')).toBe(true);
      expect(engine2['postIdToLabel'].has('post-2')).toBe(true);

      await engine2.shutdown();
    });
  });

  describe('dismissPair', () => {
    it('inserts dismissed pair with canonical ordering', async () => {
      await engine.dismissPair('zzz-post', 'aaa-post');

      expect(dismissedRowsStore.length).toBe(1);
      const row = dismissedRowsStore[0]!;
      // Should be stored with canonical (alphabetical) ordering
      expect(row.postIdA).toBe('aaa-post');
      expect(row.postIdB).toBe('zzz-post');
      expect(row.projectId).toBe('proj1');
    });

    it('stores pair in both orderings consistently', async () => {
      await engine.dismissPair('post-b', 'post-a');
      const row = dismissedRowsStore[0]!;
      expect(row.postIdA).toBe('post-a'); // canonical order
      expect(row.postIdB).toBe('post-b');
    });
  });

  describe('content hash change detection', () => {
    it('detects unchanged content and skips re-embedding', async () => {
      await engine.embedPost('post-1', 'Title', 'Content');
      const embedsAfterFirst = embedCallCount;

      // Second call with same content — in-memory cache should prevent re-embed
      await engine.embedPost('post-1', 'Title', 'Content');
      expect(embedCallCount).toBe(embedsAfterFirst);
    });
  });
});
