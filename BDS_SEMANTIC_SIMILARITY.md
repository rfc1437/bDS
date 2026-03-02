# Semantic Similarity in bDS

Surface thematically related posts as an impulse — "Have I written something similar?" — inspired by Luhmann's Zettelkasten. Cross-domain connections across 10k+ posts over 20 years are the point, not a flaw. The algorithm finds the surface. The human finds the depth.

---

## Integration Point

**InsertModal** (`src/renderer/components/InsertModal/InsertModal.tsx`), link mode.

When the search field is empty (`query.length < 2`), instead of showing "type at least 2 characters", show 3–5 semantically similar posts to the currently edited post. These are default suggestions — "posts you might want to link to."

Requires threading `currentPostId` from `Editor.tsx` → `InsertModal` (currently only passes `currentPostTags` / `currentPostCategories`).

---

## Stack

| Purpose | Library | npm | Notes |
|---|---|---|---|
| Embeddings | Hugging Face Transformers.js | `@huggingface/transformers` | ONNX, local, no API key |
| Vector index | USearch | `usearch` | HNSW, native C++ via N-API, prebuilt binaries |

**Embedding model:** `multilingual-e5-small` — 384 dimensions, 512-token context, ~470 MB on disk, ~200–300 MB RAM, ~100ms/post inference. Natively multilingual (100+ languages incl. DE/EN) — critical for a mixed-language blog. `all-MiniLM-L6-v2` (~90 MB) was considered but is EN-trained with weak DE transfer; not suitable for nuanced cross-language similarity.

**Why USearch over alternatives:**
- `sqlite-vec` — requires `loadExtension()` on the SQLite driver; bDS uses `@libsql/client` which doesn't expose it. Eliminated.
- `hnswlib-node` — no prebuilt binaries, requires `node-gyp` compile. Last published 2 years ago. Risk with Electron packaging.
- `vectra` — pure JS, zero build issues, but JSON storage (~30 MB for 10k posts). Acceptable fallback.
- Brute-force in JS — works at 10k (~15ms for the math) but requires loading all embeddings from DB first. DB read overhead with `@libsql/client` FFI is unknown and potentially dominant.
- **USearch** — prebuilt binaries via `prebuildify` (matches `sharp`, `@libsql/client` pattern), actively maintained, HNSW with SIMD, <1ms queries, binary persistence (~6 MB for 10k×384).

**USearch specifics:**
- Keys are `BigUint64Array` — need a `Map<bigint, string>` (numeric label → post UUID) persisted in a small Drizzle table (`embedding_keys`)
- `index.load()` loads everything into RAM (~6 MB). `index.save()` is a full rewrite. Fine for this scale.
- No incremental flush / WAL — acceptable since mutations are one-at-a-time post edits

**Electron packaging risk:** USearch uses N-API, but verify that its `prebuildify` targets include the Electron ABI for all platforms (macOS arm64/x64, Windows x64/arm64, Linux x64) before committing. Spike this first — if binaries are missing, fall back to `vectra`.

---

## Architecture

### Files on disk

```
{userData}/projects/{projectId}/
  embeddings.usearch       # USearch binary index
```

The `bigint → postId` key mapping lives in a Drizzle table (`embedding_keys`), not a JSON file — avoids `bigint` JSON serialization issues and stays atomic with the existing DB.

### Engine: `EmbeddingEngine` (`src/main/engine/EmbeddingEngine.ts`)

Responsibilities:
- Load/save USearch index + key map on startup/shutdown
- Embed post content via `@huggingface/transformers`
- Add/update/remove embeddings when posts change
- Query: given a post ID, return top-k similar post IDs with distances

Key interface:
```ts
class EmbeddingEngine {
  async initialize(): Promise<void>           // load index + model
  async embedPost(postId: string, content: string): Promise<void>
  async removePost(postId: string): Promise<void>
  async findSimilar(postId: string, k?: number): Promise<SimilarPost[]>
  async getIndexingProgress(): Promise<{ indexed: number; total: number }>
  async reindexAll(): Promise<void>           // after databaseRebuilt
  async setProjectContext(projectId: string): Promise<void>  // load/unload on switch
  async save(): Promise<void>
}
```

### Project switching

The app supports multiple projects. On project switch (`setProjectContext`), the engine must save and unload the current index, then load (or create) the index for the new project. Each project has its own `embeddings.usearch` file and `embedding_keys` table rows.

### IPC

```
embeddings:findSimilar(postId: string, k?: number) → SimilarPost[]
embeddings:getProgress() → { indexed: number; total: number }
```

### Embedding content

Embed the raw markdown body of each post (title + content). Markdown's lightweight markup (headers, links, emphasis) adds minimal noise and preserves semantic structure well enough for transformer models. No stripping needed.

**Chunking for long posts:** The model's 512-token context (~400 words) covers most posts. For posts exceeding 512 tokens:
1. Split into 512-token chunks with ~50 token overlap
2. Embed each chunk independently
3. Mean-pool the chunk vectors into a single 384-dim embedding
4. Store the single pooled vector in the index

This keeps the index simple (one vector per post, one lookup per query) while preserving semantic coverage of long-form content. The overlap prevents losing context at chunk boundaries.

### Hook into existing post lifecycle

Post create/update/delete events already exist in `PostEngine`. On post content change → call `embeddingEngine.embedPost()`. On delete → call `embeddingEngine.removePost()`.

Also listen for `databaseRebuilt` — emitted after `reconcileFromDisk()` (e.g., git sync). This replaces the entire DB, so individual post events don't fire. On `databaseRebuilt` → trigger a full reindex.

Save strategy: debounce `index.save()` on a timer (e.g., 5s after last mutation). During bulk indexing, batch-save every N posts (e.g., 100) instead of after each one — avoids 10k full file rewrites.

### Initial indexing (10k+ posts)

- ~100ms per post × 10k = **~17 minutes** one-time background job
- Must run as a low-priority background task after app startup
- Emit progress events so UI can show "Indexing 3,421 / 10,247…"
- On git sync to new machine, file watchers fire for all posts → triggers full reindex automatically
- Model download (~470 MB) on first run — needs progress indicator or opt-in preference

---

## UI Changes

### InsertModal (link mode, internal tab)

**When `query.length < 2` and `currentPostId` is set:**
1. Call `embeddings:findSimilar(currentPostId, 5)` on mount
2. Show results in the same result list format, with a subtle header like "Related posts"
3. Clicking a suggestion works identically to a search result — inserts the link

**When `query.length >= 2`:** existing search behavior, unchanged.

**Fallback:** if embeddings aren't ready (indexing in progress, feature disabled), show the existing "type at least 2 characters" message.

---

## Implementation Steps

1. **Test + implement `EmbeddingEngine`** — model loading, embed, add/remove/query against USearch index, save/load persistence
2. **Drizzle key map table** — `embedding_keys` table mapping `bigint` label → post UUID
3. **Wire into post lifecycle** — hook create/update/delete → embedding updates
4. **Background indexer** — on startup, diff indexed vs. existing posts, queue unindexed for background embedding with progress events
5. **IPC endpoints** — `findSimilar`, `getProgress`
6. **InsertModal integration** — add `currentPostId` prop, fetch similar on mount, render as default suggestions
7. **Settings** — opt-in preference to enable semantic similarity (triggers model download + initial index)
8. **I18n** — all new UI strings through locale files

---

## Constraints

- Feature must be opt-in (model download + 17 min indexing is not a silent default)
- No external API calls — fully local
- Model cached in `~/.cache/huggingface/`, index in internal project directory
- Total added footprint: ~520 MB on disk (onnxruntime-node ~50 MB + model ~470 MB), ~300 MB RAM at runtime for model + index
- Graceful degradation: if USearch native module fails to load (unsupported platform), disable the feature silently — never crash the app
