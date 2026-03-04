# Semantic Similarity in bDS

Surface thematically related posts as an impulse — "Have I written something similar?" — inspired by Luhmann's Zettelkasten. Cross-domain connections across 10k+ posts over 20 years are the point, not a flaw. The algorithm finds the surface. The human finds the depth.

**Status: Not yet implemented.** No packages installed, no engine, no IPC, no UI integration.

---

## Integration Point

**InsertModal** (`src/renderer/components/InsertModal/InsertModal.tsx`), link mode.

When the search field is empty (`query.length < 2`), instead of showing "type at least 2 characters", show 3–5 semantically similar posts to the currently edited post. These are default suggestions — "posts you might want to link to."

The InsertModal currently accepts these props:
```ts
interface InsertModalProps {
  mode: InsertMode;
  onInsertLink: (url: string, text?: string) => void;
  onInsertImage: (url: string, alt: string, mediaId?: string) => void;
  onClose: () => void;
  initialText?: string;
  currentPostTags?: string[];
  currentPostCategories?: string[];
  // currentPostId is NOT yet threaded through — needs to be added
}
```

`currentPostId` must be added to this interface and threaded from `Editor.tsx`.

Note: The InsertModal now also has a **"Create post" option** — when `query.length >= 2` and no exact title match exists, it shows a `+` button to create a new post with that title and inherit the current post's tags/categories. This is the only UI addition since the original spec; it doesn't conflict with the semantic similarity integration.

---

## Stack

| Purpose | Library | npm | Notes |
|---|---|---|---|
| Embeddings | Hugging Face Transformers.js | `@huggingface/transformers` | ONNX, local, no API key |
| Vector index | USearch | `usearch` | HNSW, native C++ via N-API, prebuilt binaries |

Neither package is installed yet.

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

File does not exist yet. Create it.

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

### EngineBundle (`src/main/engine/EngineBundle.ts`)

Add `embeddingEngine: EmbeddingEngine` to the `EngineBundle` interface. The current bundle contains:
`postEngine`, `mediaEngine`, `scriptEngine`, `templateEngine`, `metaEngine`, `menuEngine`, `tagEngine`, `postMediaEngine`, `projectEngine`, `gitEngine`, `gitApiAdapter`, `blogGenerationEngine`, `publishEngine`, `metadataDiffEngine`, `taskManager`, `blogmarkTransformService`, `mcpServer`, `blogmarkPythonWorkerRuntime`, `pythonMacroWorkerRuntime`, `publishApiAdapter`, `appApiAdapter`.

### IPC layer (`src/main/ipc/`)

The IPC layer now has five files:
- `handlers.ts` — main handler file (posts, media, project, meta, tags, templates, scripts, blog generation, publishing, preview, site validation, import, settings, model catalog, tasks, notifications)
- `chatHandlers.ts` — AI chat streaming & tool use
- `blogHandlers.ts` — blog generation & publishing
- `publishHandlers.ts` — publishing
- `metadataDiffHandlers.ts` — metadata diff
- `index.ts` — module exports

Add the embedding IPC handlers to `handlers.ts` (they're small; no need for a new file):

```
embeddings:findSimilar(postId: string, k?: number) → SimilarPost[]
embeddings:getProgress() → { indexed: number; total: number }
embeddings:findDuplicates(threshold?: number) → DuplicatePair[]
embeddings:dismissPair(postIdA: string, postIdB: string) → void
```

### Database: `embedding_keys` table

Add to `src/main/database/schema.ts`. The current schema has: `projects`, `posts`, `media`, `settings`, `generatedFileHashes`, `postLinks`, `postMedia`, `tags`, `chatConversations`, `chatMessages`, `importDefinitions`, `scripts`, `templates`, `dbNotifications`, `modelCatalogProviders`, `modelCatalog`, `modelCatalogModalities`, `modelCatalogMeta`.

New tables:
```ts
export const embeddingKeys = sqliteTable('embedding_keys', {
  label: integer('label', { mode: 'bigint' }).primaryKey(), // USearch bigint key
  postId: text('post_id').notNull(),
  projectId: text('project_id').notNull(),
});

export const dismissedDuplicatePairs = sqliteTable('dismissed_duplicate_pairs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  postIdA: text('post_id_a').notNull(),
  postIdB: text('post_id_b').notNull(),
  dismissedAt: integer('dismissed_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pairIdx: uniqueIndex('dismissed_pairs_idx').on(table.projectId, table.postIdA, table.postIdB),
}));
```

Create a Drizzle migration (`db:generate` / `db:migrate`) after adding the tables.

### Project switching

The app supports multiple projects. On project switch (`setProjectContext`), the engine must save and unload the current index, then load (or create) the index for the new project. Each project has its own `embeddings.usearch` file and `embedding_keys` table rows (filtered by `projectId`).

### Embedding content

Embed the raw markdown body of each post (title + content). Markdown's lightweight markup (headers, links, emphasis) adds minimal noise and preserves semantic structure well enough for transformer models. No stripping needed.

**Chunking for long posts:** The model's 512-token context (~400 words) covers most posts. For posts exceeding 512 tokens:
1. Split into 512-token chunks with ~50 token overlap
2. Embed each chunk independently
3. Mean-pool the chunk vectors into a single 384-dim embedding
4. Store the single pooled vector in the index

This keeps the index simple (one vector per post, one lookup per query) while preserving semantic coverage of long-form content. The overlap prevents losing context at chunk boundaries.

### Hook into existing post lifecycle

`PostEngine` emits these events (confirmed in current codebase):
- `postCreated` — on create and on import
- `postUpdated` — on update, publish, revert
- `postDeleted` — on delete
- `databaseRebuilt` — emitted after `reconcileFromDisk()` (e.g., git sync replaces entire DB)
- `rebuildStarted` — emitted just before `databaseRebuilt`

On post content change → call `embeddingEngine.embedPost()`. On delete → call `embeddingEngine.removePost()`. On `databaseRebuilt` → trigger a full reindex.

Save strategy: debounce `index.save()` on a timer (e.g., 5s after last mutation). During bulk indexing, batch-save every N posts (e.g., 100) instead of after each one — avoids 10k full file rewrites.

### Initial indexing (10k+ posts)

- ~100ms per post × 10k = **~17 minutes** one-time background job
- Must run as a low-priority background task after app startup (use `TaskManager` for queuing)
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

**When `query.length >= 2`:** existing search behavior, unchanged. (This includes the "Create post" option for link mode.)

**Fallback:** if embeddings aren't ready (indexing in progress, feature disabled), show the existing "type at least 2 characters" message.

---

## Duplication Analysis

A periodic audit tool to surface posts that are so semantically similar they might be unintentional duplicates — the same topic written twice years apart, a post and its draft that both got published, a cross-post that was forgotten. The goal is human review and action, not automated deletion.

### Algorithm

For each indexed post, query the index for its top-k nearest neighbours (k=20). Filter pairs where cosine similarity exceeds a threshold (default: 0.92). Deduplicate symmetric pairs (A→B = B→A). Sort descending by similarity.

This is O(n) queries against the HNSW index — fast even at 10k posts (~20ms total). Run on demand, not continuously.

```ts
interface DuplicatePair {
  postA: { id: string; title: string; slug: string; publishedAt?: Date };
  postB: { id: string; title: string; slug: string; publishedAt?: Date };
  similarity: number; // cosine similarity, 0–1
}
```

New engine method:
```ts
async findDuplicates(threshold?: number): Promise<DuplicatePair[]>
// threshold default: 0.92. Lower = more results, more noise. Higher = only near-identical posts.
```

### Dismissed pairs

When the user reviews a pair and decides it's intentional (e.g., two posts on the same topic that are meaningfully different), they can dismiss it. Store dismissed pairs in a new DB table so they don't reappear:

```ts
export const dismissedDuplicatePairs = sqliteTable('dismissed_duplicate_pairs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  postIdA: text('post_id_a').notNull(),
  postIdB: text('post_id_b').notNull(),
  dismissedAt: integer('dismissed_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pairIdx: uniqueIndex('dismissed_pairs_idx').on(table.projectId, table.postIdA, table.postIdB),
}));
```

`findDuplicates` filters out any pair where both (A, B) and (B, A) appear in `dismissed_duplicate_pairs`.

### New IPC endpoints

Add to `handlers.ts`:
```
embeddings:findDuplicates(threshold?: number) → DuplicatePair[]
embeddings:dismissPair(postIdA: string, postIdB: string) → void
```

### UI placement

The duplication analysis is an administrative, periodic task — not a daily workflow. Don't add it to the activity bar (already 10 entries). Surface it from **Project Settings**, under a "Content Audit" subsection, with a "Find duplicate posts" button.

Results open as a **dedicated tab** (new tab type: `duplicates`) in the main editor area, so the user can keep it open while navigating to individual posts. Tab type should be added to the `Tab` union in `appStore`.

**Duplicates tab layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Potential Duplicates   [Threshold: ▼ 92%]  [Re-run]    │
├─────────────────────────────────────────────────────────┤
│ 97%  "My trip to Berlin" (2019-03)                      │
│      "Berlin travel notes" (2023-08)       [Open both]  │
│                                            [Dismiss]    │
├─────────────────────────────────────────────────────────┤
│ 94%  "Bullet journaling setup" (2018-11)               │
│      "How I use a bullet journal" (2021-02)[Open both]  │
│                                            [Dismiss]    │
└─────────────────────────────────────────────────────────┘
```

- **Threshold slider** — adjustable 80–99%, results update on re-run
- **"Open both"** — opens both posts as sequential editor tabs
- **"Dismiss"** — calls `embeddings:dismissPair`, removes the row from the list
- Results show similarity %, both post titles, and published dates
- If no duplicates found at the current threshold: "No duplicates found above X% similarity"
- If index not ready: "Semantic index is still building…" with progress

### Python API

Add to `bds_api` and `API.md`:
```python
posts.find_duplicates(threshold=0.92)  # → list of DuplicatePair
posts.dismiss_duplicate_pair(post_id_a, post_id_b)  # → None
```

---

## Settings: Opt-In Preference

The feature must be opt-in (model download + 17 min indexing is not a silent default).

Store as a project-level metadata field via `meta:updateProjectMetadata`. Add `semanticSimilarityEnabled: boolean` to `ProjectMetadata`. When the user enables it in Project Settings, start the background indexer. When disabled, skip embedding hooks and hide the UI section.

The model download itself (~470 MB) should show a progress indicator before the indexer starts.

---

## Implementation Steps

1. **Spike USearch packaging** — verify prebuilt binaries exist for all target Electron ABIs before committing. Fall back to `vectra` if they don't.
2. **Test + implement `EmbeddingEngine`** — model loading, embed, add/remove/query against USearch index, save/load persistence
3. **Drizzle key map table** — add `embedding_keys` to `schema.ts`, run `db:generate` + `db:migrate`
4. **Add `semanticSimilarityEnabled` to project metadata** — `ProjectMetadata` type + `meta:updateProjectMetadata` handler + Project Settings UI toggle
5. **Wire into post lifecycle** — hook `postCreated`/`postUpdated`/`postDeleted`/`databaseRebuilt` → embedding updates (guarded by opt-in flag)
6. **Background indexer** — on startup (if enabled), diff indexed vs. existing posts, queue unindexed for background embedding via `TaskManager` with progress events
7. **IPC endpoints** — `embeddings:findSimilar`, `embeddings:getProgress`, `embeddings:findDuplicates`, `embeddings:dismissPair` in `handlers.ts`
8. **Add `embeddingEngine` to `EngineBundle`** — update `EngineBundle.ts` interface and `main.ts` construction
9. **InsertModal integration** — add `currentPostId` prop, thread from `Editor.tsx`, fetch similar on mount, render as default suggestions
10. **Duplicates tab** — add `duplicates` to `Tab` union in `appStore`, implement `DuplicatesView` component, surface "Find duplicate posts" button from Project Settings
11. **I18n** — all new UI strings through locale files (no hardcoded text)
12. **Python API** — add `posts.findRelated(postId, k)`, `posts.find_duplicates(threshold)`, `posts.dismiss_duplicate_pair(a, b)` to `bds_api`, regenerate `API.md`

---

## Constraints

- Feature must be opt-in (model download + 17 min indexing is not a silent default)
- No external API calls — fully local
- Model cached in `~/.cache/huggingface/`, index in internal project directory
- Total added footprint: ~520 MB on disk (onnxruntime-node ~50 MB + model ~470 MB), ~300 MB RAM at runtime for model + index
- Graceful degradation: if USearch native module fails to load (unsupported platform), disable the feature silently — never crash the app
- Follow test-first mandate: write failing tests before implementing `EmbeddingEngine`
