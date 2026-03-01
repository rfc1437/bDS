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

**Embedding model:** `Xenova/all-MiniLM-L6-v2` — 384 dimensions, ~90 MB on disk, ~150–200 MB RAM, ~100ms/post inference, handles mixed DE/EN.

**Why USearch over alternatives:**
- `sqlite-vec` — requires `loadExtension()` on the SQLite driver; bDS uses `@libsql/client` which doesn't expose it. Eliminated.
- `hnswlib-node` — no prebuilt binaries, requires `node-gyp` compile. Last published 2 years ago. Risk with Electron packaging.
- `vectra` — pure JS, zero build issues, but JSON storage (~30 MB for 10k posts). Acceptable fallback.
- Brute-force in JS — works at 10k (~15ms for the math) but requires loading all embeddings from DB first. DB read overhead with `@libsql/client` FFI is unknown and potentially dominant.
- **USearch** — prebuilt binaries via `prebuildify` (matches `sharp`, `@libsql/client` pattern), actively maintained, HNSW with SIMD, <1ms queries, binary persistence (~6 MB for 10k×384).

**USearch specifics:**
- Keys are `BigUint64Array` — need a `Map<bigint, string>` (numeric label → post UUID) persisted alongside the index
- `index.load()` loads everything into RAM (~6 MB). `index.save()` is a full rewrite. Fine for this scale.
- No incremental flush / WAL — acceptable since mutations are one-at-a-time post edits

---

## Architecture

### Files on disk

```
<project-dir>/.bds/
  embeddings.usearch       # USearch binary index
  embeddings-keys.json     # { [numericLabel]: postId } mapping
```

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
  async save(): Promise<void>
}
```

### IPC

```
embeddings:findSimilar(postId: string, k?: number) → SimilarPost[]
embeddings:getProgress() → { indexed: number; total: number }
```

### Hook into existing post lifecycle

Post create/update/delete events already exist in `PostEngine`. On post content change → call `embeddingEngine.embedPost()`. On delete → call `embeddingEngine.removePost()`. Save index after each mutation.

### Initial indexing (10k+ posts)

- ~100ms per post × 10k = **~17 minutes** one-time background job
- Must run as a low-priority background task after app startup
- Emit progress events so UI can show "Indexing 3,421 / 10,247…"
- On git sync to new machine, file watchers fire for all posts → triggers full reindex automatically
- Model download (~90 MB) on first run — needs progress indicator or opt-in preference

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
2. **SQLite key map** — persist the `bigint → postId` mapping (simple JSON file or a small Drizzle table)
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
- Model cached in `~/.cache/huggingface/`, index in project `.bds/` directory
- .bds/ directory inside project directory must be added to .gitignore (cache is kept local not versioned)
- Total added footprint: ~140 MB on disk (onnxruntime-node ~50 MB + model ~90 MB), ~200 MB RAM at runtime for model + index
