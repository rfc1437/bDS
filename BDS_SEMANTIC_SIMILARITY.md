# Semantic Similarity in bDS

Surface thematically related posts as an impulse — "Have I written something similar?" — inspired by Luhmann's Zettelkasten. Cross-domain connections across 10k+ posts over 20 years are the point, not a flaw. The algorithm finds the surface. The human finds the depth.

**Status: Not yet implemented.** No packages installed, no engine, no IPC, no UI integration.

---

## Feasibility Assessment

### What's solid
- **Codebase hooks verified**: `PostEngine` emits all 5 expected events (`postCreated`, `postUpdated`, `postDeleted`, `rebuildStarted`, `databaseRebuilt`). `TaskManager` exists with progress/cancellation support. `EngineBundle` pattern is established (21 members). Tab system supports adding new types (currently 14).
- **Architecture fits the codebase**: engine → IPC → renderer separation is consistent with existing patterns (e.g., `MetadataDiffEngine` → `metadataDiffHandlers.ts` → `MetadataDiffView`). Menu-triggered tabs follow `validateSite` → `SiteValidationView` precedent.
- **`@huggingface/transformers`**: Viable for Electron main process. Supports `onnxruntime-node` (N-API) with WASM fallback (`onnxruntime-web`) if native binaries fail. Widely used, Electron-compatible.
- **Multilingual model choice**: `multilingual-e5-small` is correct for mixed DE/EN content. `all-MiniLM-L6-v2` would fail on German.

### Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **USearch N-API binaries missing for Electron ABI** | High | Spike first (Phase 0). If prebuildify targets don't cover Electron ABI: fall back to `vectra` (pure JS, JSON storage, zero build issues). |
| **`onnxruntime-node` N-API mismatch with Electron** | Medium | `onnxruntime-node` has broad N-API support including Electron. Fallback: use `onnxruntime-web` (WASM) — slower (~3x) but zero native dependencies. |
| **470 MB model download on first enable** | Medium | Must show download progress. Consider: allow user to cancel, resume on next enable. |
| **~300 MB RAM for model at runtime** | Low | Model loads once, shared across projects. Only the index swaps on project switch. Acceptable for a desktop app. Document in settings UI. |
| **17 min initial indexing (10k posts)** | Low | Background task with progress via `TaskManager`. Incremental — only unindexed posts processed on subsequent launches. |

### Decisions to make before implementation

1. **USearch Electron ABI**: Must spike in Phase 0 to confirm prebuilt binaries ship for Electron's N-API version on all target platforms (macOS arm64/x64, Windows x64/arm64, Linux x64). If they don't, fallback to `vectra`.
2. **Model size vs. quality**: `multilingual-e5-small` (470 MB) is the right choice for multilingual. No smaller alternative with adequate DE/EN quality exists. Accept the download size.

---

## Stack

| Purpose | Library | npm | Notes |
|---|---|---|---|
| Embeddings | Hugging Face Transformers.js v3 | `@huggingface/transformers` | ONNX, local, no API key |
| Vector index | USearch | `usearch` | HNSW, native C++ via N-API, prebuilt binaries, SIMD, <1ms queries |

Neither package is installed yet.

**Embedding model:** `multilingual-e5-small` — 384 dimensions, 512-token context, ~470 MB on disk, ~200–300 MB RAM, ~100ms/post inference. Natively multilingual (100+ languages incl. DE/EN) — critical for a mixed-language blog. The model downloads to `~/.cache/huggingface/` on first use.

### Why USearch

- `sqlite-vec` — requires `loadExtension()` on the SQLite driver; bDS uses `@libsql/client` which doesn't expose it. Eliminated.
- `hnswlib-node` — no prebuilt binaries, requires `node-gyp` compile. Last published 2 years ago. Risk with Electron packaging.
- `vectra` — pure JS, zero build issues, but JSON storage (~30 MB for 10k posts). Acceptable fallback if USearch fails.
- **USearch** — prebuilt binaries via `prebuildify` (matches `sharp`, `@libsql/client` pattern), actively maintained, HNSW with SIMD, <1ms queries, binary persistence (~6 MB for 10k×384).

**USearch specifics:**
- Keys are `BigUint64Array` — need a `Map<bigint, string>` (numeric label → post UUID) persisted in a Drizzle table (`embedding_keys`)
- `index.load()` loads everything into RAM (~6 MB). `index.save()` is a full rewrite. Fine for this scale.
- No incremental flush / WAL — acceptable since mutations are one-at-a-time post edits

**Electron packaging risk:** Must be spiked in Phase 0 — verify that USearch `prebuildify` targets include the Electron ABI for all platforms (macOS arm64/x64, Windows x64/arm64, Linux x64). If binaries are missing, fall back to `vectra`.

---

## Architecture

### Files on disk

```
{userData}/projects/{projectId}/
  embeddings.usearch       # USearch binary index (~6 MB for 10k posts)
```

The `bigint → postId` key mapping lives in a Drizzle table (`embedding_keys`), not a JSON file — avoids `bigint` JSON serialization issues and stays atomic with the existing DB.

### Database tables

Add to `src/main/database/schema.ts`:

```ts
export const embeddingKeys = sqliteTable('embedding_keys', {
  label: integer('label', { mode: 'bigint' }).primaryKey(), // USearch bigint key
  postId: text('post_id').notNull(),
  projectId: text('project_id').notNull(),
  contentHash: text('content_hash').notNull(), // SHA-256 of title+content, for change detection
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

Run `npm run db:generate` after adding.

The `contentHash` column enables efficient change detection: on startup, compare each post's hash against its stored hash to identify what needs re-embedding, without loading all content.

### Engine: `EmbeddingEngine` (`src/main/engine/EmbeddingEngine.ts`)

Create new file.

```ts
interface SimilarPost {
  postId: string;
  similarity: number; // cosine similarity 0–1
}

interface TagSuggestion {
  name: string;
  score: number; // weighted frequency, not shown in UI
}

interface DuplicatePair {
  postA: { id: string; title: string; slug: string; publishedAt?: Date };
  postB: { id: string; title: string; slug: string; publishedAt?: Date };
  similarity: number;
}

class EmbeddingEngine extends EventEmitter {
  // Lifecycle
  async initialize(): Promise<void>             // Load model (lazy — only when feature enabled)
  async shutdown(): Promise<void>               // Release model from memory

  // Core operations
  async embedPost(postId: string, title: string, content: string): Promise<void>
  async removePost(postId: string): Promise<void>
  async findSimilar(postId: string, k?: number): Promise<SimilarPost[]>  // default k=5

  // Derived features
  async suggestTags(postId: string, excludeTags: string[]): Promise<TagSuggestion[]>
  async findDuplicates(threshold?: number): Promise<DuplicatePair[]>     // default 0.92

  // Indexing management
  async getIndexingProgress(): Promise<{ indexed: number; total: number }>
  async reindexAll(): Promise<void>
  async indexUnindexedPosts(): Promise<void>     // Differential — only missing/changed posts

  // Project switching
  async setProjectContext(projectId: string): Promise<void>  // save + unload index, load new project's index

  // Persistence
  async save(): Promise<void>                   // Write USearch index to disk
}
```

**Key implementation details:**

- `findSimilar`: Query USearch index for k nearest neighbours of the given post's vector. <1ms at 10k scale with HNSW.
- `embedPost`: Prepend `"query: "` to input text (required by E5 models). For posts exceeding 512 tokens: split into 512-token chunks with 50-token overlap, embed each, mean-pool into single 384-dim vector. Add vector to USearch index with a bigint label, persist label→postId mapping in `embedding_keys` table with SHA-256 content hash.
- `removePost`: Look up bigint label from `embedding_keys`, remove from USearch index, delete DB row.
- `suggestTags`: Find top-10 similar posts → collect their tags → weight by similarity score → sum per tag → exclude already-applied tags → return top 5.
- `findDuplicates`: For each post, query index for top-20 neighbours. Filter pairs above threshold. Deduplicate symmetric pairs. Filter dismissed pairs from DB. Sort by similarity descending.
- **Save strategy**: Debounce `index.save()` on a timer (5s after last mutation). During bulk indexing, batch-save every 100 posts instead of after each — avoids 10k full file rewrites.
- **Key mapping**: Maintain a `Map<bigint, string>` (USearch label → postId) in memory, backed by `embedding_keys` table. Auto-increment bigint counter for new labels.

### EngineBundle

Add `embeddingEngine: EmbeddingEngine` to interface in `src/main/engine/EngineBundle.ts`. Instantiate in `main.ts`.

### IPC endpoints

Add to `src/main/ipc/handlers.ts` (small enough to keep in main file):

| Channel | Params | Returns |
|---|---|---|
| `embeddings:findSimilar` | `postId: string, k?: number` | `SimilarPost[]` |
| `embeddings:getProgress` | — | `{ indexed: number, total: number }` |
| `embeddings:suggestTags` | `postId: string, excludeTags: string[]` | `TagSuggestion[]` |
| `embeddings:findDuplicates` | `threshold?: number` | `DuplicatePair[]` |
| `embeddings:dismissPair` | `postIdA: string, postIdB: string` | `void` |

### Post lifecycle hooks

In `main.ts` (or wherever PostEngine listeners are wired), guarded by `semanticSimilarityEnabled`:

- `postCreated` → `embeddingEngine.embedPost(id, title, content)`
- `postUpdated` → `embeddingEngine.embedPost(id, title, content)` (re-embed; hash check skips if unchanged)
- `postDeleted` → `embeddingEngine.removePost(id)`
- `databaseRebuilt` → `embeddingEngine.reindexAll()`

### Project switching

On `setProjectContext(projectId)`: save current USearch index to disk, unload it. Load (or create) the USearch index for the new project from `{userData}/projects/{projectId}/embeddings.usearch`. Reload `embedding_keys` rows for the new `projectId` into the in-memory key map. The model stays loaded — only the index and key map swap.

### Embedding content

Embed raw markdown: `"query: " + title + "\n\n" + content`. The `"query: "` prefix is required by E5 models for proper similarity computation.

**Chunking** (posts > 512 tokens): Split into overlapping chunks → embed each → mean-pool → store single vector. This keeps queries simple (one vector per post).

### Background indexing

On app startup (if feature enabled):
1. Load USearch index + `embedding_keys` for current project
2. Query all posts, compare against `embedding_keys` (by postId + contentHash)
3. Queue unindexed/changed posts as a `TaskManager` task
4. Embed each post, add to USearch index + `embedding_keys`
5. Emit progress: `taskProgress` events → forwarded to renderer
6. Batch `index.save()` every 100 posts (not after each one)

First-run indexes everything (~17 min for 10k posts). Subsequent launches only process new/changed posts.

---

## Settings: Opt-In Preference

Add `semanticSimilarityEnabled: boolean` to `ProjectMetadata` in `MetaEngine.ts`.

Project Settings UI toggle:
- Label: "Enable semantic similarity" (i18n key)
- Description: explains model download size and indexing time
- When toggled on → trigger model download (with progress) → start background indexing
- When toggled off → skip lifecycle hooks, hide similarity UI, keep embeddings in DB (resume without re-indexing if re-enabled)

---

## UI Changes

### 1. InsertModal (link mode)

**File:** `src/renderer/components/InsertModal/InsertModal.tsx`

Add `currentPostId?: string` to `InsertModalProps`. Thread from `Editor.tsx` (the post editor already has the post ID).

**Behavior when `query.length < 2` and `currentPostId` is set:**
1. Call `embeddings:findSimilar(currentPostId, 5)` on mount (one-time, cached in component state)
2. Render results in same list format as search results, with header "Related posts" (i18n)
3. Clicking a suggestion inserts the link, same as a search result

**When `query.length >= 2`:** existing search behavior, unchanged.

**Fallback (embeddings unavailable):** show current "type at least 2 characters" message. No visible change.

### 2. TagInput

**File:** `src/renderer/components/TagInput/TagInput.tsx`

Add `postId?: string` prop. Thread from whatever renders TagInput for post editing.

**When input is focused, `inputValue` is empty, and `postId` is set:**
1. Call `embeddings:suggestTags(postId, currentTags)` once on focus (cache result)
2. Show "Suggested" section above regular tag list in dropdown
3. Click adds tag identically to any other

**When `inputValue.length > 0`:** existing filter behavior only. Suggested section hidden.

**Fallback:** dropdown behaves exactly as today.

### 3. Duplicates tab

**Menu integration (same pattern as `validateSite`):**
- Add `'findDuplicates'` to `AppMenuAction` in `menuCommands.ts`
- Add menu item in Blog group: `{ label: 'menu.item.findDuplicates', action: 'findDuplicates' }`
- Add event mapping: `findDuplicates: 'menu:findDuplicates'`

**Tab system:**
- Add `'duplicates'` to `TabType` in `appStore.ts`
- Create `DuplicatesView.tsx` component

**DuplicatesView layout:**
- Header with threshold slider (80–99%, default 92%) and "Re-run" button
- List of pairs: similarity %, both titles with dates
- Per-pair actions: "Open both" (opens two editor tabs), "Dismiss" (calls `embeddings:dismissPair`)
- Empty state: "No duplicates found above X% similarity"
- Loading state: "Semantic index is still building…" with progress

### 4. I18n

All new UI strings through locale files. Required keys (add to all locale files):
- `insertModal.relatedPosts` — "Related posts"
- `tagInput.suggested` — "Suggested"
- `menu.item.findDuplicates` — "Find Duplicate Posts"
- `duplicatesView.title` — "Potential Duplicates"
- `duplicatesView.threshold` — "Threshold"
- `duplicatesView.rerun` — "Re-run"
- `duplicatesView.openBoth` — "Open both"
- `duplicatesView.dismiss` — "Dismiss"
- `duplicatesView.empty` — "No duplicates found above {threshold}% similarity"
- `duplicatesView.indexing` — "Semantic index is still building…"
- `settings.semanticSimilarity.label` — "Enable semantic similarity"
- `settings.semanticSimilarity.description` — (explains download/indexing)

### 5. Python API

Add to `bds_api` and regenerate `API.md`:
```python
posts.find_similar(post_id, k=5)                          # → list[SimilarPost]
posts.suggest_tags(post_id, exclude_tags=[])               # → list[TagSuggestion]
posts.find_duplicates(threshold=0.92)                      # → list[DuplicatePair]
posts.dismiss_duplicate_pair(post_id_a, post_id_b)         # → None
```

---

## Implementation Phases

### Phase 0: Validate native dependencies
> Goal: Confirm both `@huggingface/transformers` and `usearch` work in Electron main process.

- [ ] Install `@huggingface/transformers` and `usearch`
- [ ] Write a throwaway script in Electron main process that:
  - Loads `multilingual-e5-small` and embeds a test string → verify 384-dim output
  - Creates a USearch index, adds a vector, queries it → verify results
- [ ] Verify both packages' N-API binaries load in Electron (check ABI compatibility for macOS arm64 at minimum)
- [ ] If `onnxruntime-node` fails: test with `onnxruntime-web` (WASM backend) — note perf difference
- [ ] If USearch fails: test `vectra` as fallback (pure JS, no N-API)
- [ ] **Decision gate**: proceed with confirmed stack. If neither embedding runtime works in Electron, stop and reassess.

### Phase 1: Core engine + database (test-first)
> Goal: `EmbeddingEngine` can embed posts, store/query via USearch, and find similar posts. No UI, no IPC yet.

- [ ] Add `embeddingKeys` and `dismissedDuplicatePairs` tables to `schema.ts`
- [ ] Run `npm run db:generate`
- [ ] Write tests for `EmbeddingEngine`:
  - Embed a post → verify vector in USearch index + key row in `embedding_keys` with correct hash
  - Embed multiple posts → `findSimilar` returns correct ranking
  - Update post content → old vector removed, new vector added, hash updated
  - Remove post → vector removed from index, key row deleted
  - `findSimilar` for non-existent post → empty result
  - Content hash prevents re-embedding unchanged posts
  - `save()` + reload → index and key map survive restart
  - `setProjectContext()` switches index correctly
- [ ] Implement `EmbeddingEngine` to pass tests (mock the transformer model in tests; test the real model in Phase 0 spike)
- [ ] Add `embeddingEngine` to `EngineBundle` interface and `main.ts` construction

### Phase 2: Settings + lifecycle integration
> Goal: Feature is opt-in, embeddings update automatically when posts change.

- [ ] Add `semanticSimilarityEnabled: boolean` to `ProjectMetadata`
- [ ] Add toggle to Project Settings UI (i18n)
- [ ] Wire PostEngine lifecycle events → `EmbeddingEngine` (guarded by enabled flag)
- [ ] Implement background indexer via `TaskManager`:
  - On enable / startup: diff indexed vs. existing posts, queue unindexed
  - Emit progress events
  - Batch DB writes (every 50 posts)
  - Handle model download progress on first enable
- [ ] Add `embeddings:getProgress` IPC endpoint
- [ ] Test: create post while enabled → embedding created. Disable → no embedding on create.

### Phase 3: InsertModal integration
> Goal: Related posts appear as suggestions when opening the link insert modal.

- [ ] Add `currentPostId?: string` to `InsertModalProps`
- [ ] Thread `currentPostId` from `Editor.tsx` (post ID is available in the editor component)
- [ ] Add `embeddings:findSimilar` IPC endpoint
- [ ] In InsertModal: when `query.length < 2` and `currentPostId` set, fetch and display similar posts
- [ ] Fallback: if embeddings unavailable, show existing empty-state message
- [ ] Add i18n keys for "Related posts" header
- [ ] Test: InsertModal renders similar posts. Clicking inserts link. Fallback works.

### Phase 4: Tag suggestions
> Goal: Tags inferred from similar posts appear as suggestions when editing tags.

- [ ] Implement `suggestTags` method in `EmbeddingEngine`
- [ ] Add `embeddings:suggestTags` IPC endpoint
- [ ] Add `postId?: string` prop to `TagInput`
- [ ] Thread from post editor
- [ ] Show "Suggested" section in tag dropdown when input is empty and focused
- [ ] Add i18n key
- [ ] Test: tag suggestion algorithm returns weighted tags, excludes existing tags

### Phase 5: Duplicate detection
> Goal: Audit tool to surface near-duplicate posts for human review.

- [ ] Implement `findDuplicates` method in `EmbeddingEngine`
- [ ] Implement `dismissPair` (insert into `dismissedDuplicatePairs` table)
- [ ] Add `embeddings:findDuplicates` and `embeddings:dismissPair` IPC endpoints
- [ ] Add `'findDuplicates'` to `AppMenuAction`, Blog menu, event map in `menuCommands.ts`
- [ ] Add `'duplicates'` to `TabType` in `appStore.ts`
- [ ] Create `DuplicatesView.tsx` component with threshold slider, pair list, Open both / Dismiss actions
- [ ] Wire `menu:findDuplicates` event to open duplicates tab
- [ ] Add all i18n keys for duplicates UI
- [ ] Test: findDuplicates returns pairs above threshold. Dismissed pairs excluded. Menu opens tab.

### Phase 6: Python API + docs
> Goal: Embeddings features accessible from Python macros.

- [ ] Add `posts.find_similar`, `posts.suggest_tags`, `posts.find_duplicates`, `posts.dismiss_duplicate_pair` to `bds_api`
- [ ] Regenerate `API.md` — verify all params, return types, and sample calls documented
- [ ] Test: API docs match implementation

### Final: Build + full test pass
- [ ] `npm test` — zero failures
- [ ] `npm run build` — successful build
- [ ] Manual smoke test: enable feature → model downloads → indexing completes → InsertModal shows related posts → tag suggestions work → duplicates view works

---

## Constraints

- **Opt-in only** — model download (~470 MB) and initial indexing are not silent defaults
- **Fully local** — no external API calls, no telemetry
- **Model cache**: `~/.cache/huggingface/`. Embeddings in existing SQLite DB.
- **Footprint**: ~520 MB disk (model + onnxruntime), ~300 MB RAM (model loaded), ~6 MB per project USearch index (10k posts).
- **Graceful degradation**: if model fails to load or feature is disabled, all embedding UI elements are hidden — never crash the app
- **Test-first**: write failing tests before implementing each engine method
- **No hardcoded strings**: all UI text through i18n locale files
