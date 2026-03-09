# Worker Threads Architecture for Blog Generation

## Problem

Cmd-R (Render Site) is slow with 10k+ posts / ~20k pages. The rendering pipeline is **CPU-bound** (Liquid templates + Markdown parsing). All current `Promise.all` parallelism just interleaves I/O on a single core. Actual multi-core parallelism via `worker_threads` is needed.

## Current Architecture

```
blogHandlers.ts (IPC entry)
  → preloadGenerationData() — loads all posts, translations, menu
  → Promise.all([5 section tasks])  ← runs on ONE CPU core
      ├── core     (root pages, sitemap, feeds, assets)
      ├── single   (one page per post — THE bottleneck, ~20k pages)
      ├── category (paginated category index pages)
      ├── tag      (paginated tag index pages)
      └── date     (year/month/day archive pages)

Each section calls BlogGenerationEngine.generate() which:
  1. Builds GenerationPostIndex (tags, categories, date buckets)
  2. Bulk-loads file hashes from DB
  3. Creates route renderer (Liquid + PreviewServer + cached engines)
  4. Renders pages sequentially/batched → writes files if hash changed
```

**Shared mutable state across sections:**
- SQLite database (libsql, WAL mode) — singleton connection
- File system output directory (but sections write to disjoint paths)
- Template caches (Liquid `cache: true`) — populated once, read-only after
- PreloadedGenerationData — read-only after creation

**Existing worker_threads usage:** Pyodide macro workers (`pythonMacro.worker.ts`, `BlogmarkPythonWorkerRuntime.ts`) already use `worker_threads` successfully.

## Target Architecture

```
MAIN THREAD                              WORKER THREADS (N = cpu_count - 1)
───────────                              ──────────────────────────────────
blogHandlers.ts                          
  preloadGenerationData()               
  serialize + partition posts            
       │                                 
       ├──► Worker 1: posts[0..chunk]    → own DB conn, own Liquid, render + write
       ├──► Worker 2: posts[chunk..2chunk] → own DB conn, own Liquid, render + write
       ├──► Worker 3: posts[2chunk..3chunk] → own DB conn, own Liquid, render + write
       └──► Worker N: posts[...rest]     → own DB conn, own Liquid, render + write
       │
       ├── receive progress messages → TaskManager.emit()
       ├── receive results → merge stats
       └── return merged BlogGenerationResult
```

## Phased Implementation

### Phase 1 — Single Post Worker Pool (highest impact)

Move `generateSinglePostPages` to a worker pool. Single posts are the bottleneck (~20k of ~20k pages). Other sections stay in main thread.

#### 1.1 Spike: Verify dependencies work in worker_threads
- [ ] Test `@libsql/client` opens a second connection in a worker thread (WAL mode)
- [ ] Test `liquidjs` renders a template in a worker thread
- [ ] Measure memory overhead per worker with 10k post metadata

#### 1.2 Create `generation.worker.ts`
New worker entry point that:
- Receives via `workerData`: serialized options, post chunk, template roots, DB path, hash cache
- Opens its own `@libsql/client` connection (WAL mode allows concurrent readers/writers)
- Creates its own `Liquid` instance with `cache: true` + registers custom filters
- Creates its own `PageRenderer`, `PreviewServer`, route renderer
- Renders assigned posts → writes HTML files + updates file hashes in DB
- Sends progress via `parentPort.postMessage({ type: 'progress', ... })`
- Sends result via `parentPort.postMessage({ type: 'result', stats })`

#### 1.3 Serialize `PreloadedGenerationData`
- `PostData[]` contains `Date` objects → serialize to ISO strings, parse back in worker
- Post content is lazy-loaded from filesystem → workers read post files directly
- `HtmlRewriteContext` maps → pass as plain `Record<string, string>` (already partially converted)
- Each worker bulk-loads its own `generatedHashCache` from DB

#### 1.4 Extract `PageRenderer` factory for workers
- Extract filter registration (markdown, i18n) into a shared `createPageRenderer(config)` function
- Workers call this with their own DB-backed engines
- Keep `macroTemplateCache` and `macroLiquid` as worker-local singletons (they self-populate)

#### 1.5 Create `GenerationWorkerPool`
New class that:
- Spawns N workers (`os.cpus().length - 1`, configurable, min 1)
- Distributes post chunks to workers (round-robin or equal split)
- Collects progress messages → relays to `onProgress` callback
- Collects results → merges stats (pagesWritten, pagesSkipped)
- Handles worker errors/crashes gracefully
- Tears down workers when generation completes

#### 1.6 Refactor `BlogGenerationEngine.generate()` coordinator
- Split into coordinator (main thread) + worker payload
- Coordinator: loads data, partitions posts, manages worker pool, merges results
- Multi-language subtree loop: each language pass creates a new set of worker tasks
- Non-single sections (core, category, tag, date) remain in main thread

#### 1.7 Progress reporting
- Workers: `parentPort.postMessage({ type: 'progress', value, message })`
- Main thread: listen on each worker, relay to `TaskManager.emit()` → IPC → renderer
- Aggregate progress across all workers for accurate progress bar

#### 1.8 Testing
- Unit tests: mock worker pool, test coordinator logic
- Integration test: spawn real workers with in-memory SQLite + template files
- Verify existing `BlogGenerationEngine.test.ts` tests still pass (they mock at engine boundary)

### Phase 2 — All Sections in Workers

Move category/tag/date sections to workers too. Each section gets one worker.

- [ ] Category pages → one worker
- [ ] Tag pages → one worker  
- [ ] Date archive pages → one worker
- [ ] Core pages stay in main thread (sitemap/feeds/assets are one-time + small)

### Phase 3 — Python Macro Handling

Handle posts with Python macros across worker boundaries.

**Recommended approach: Pre-expansion pass**
1. Before distributing posts to workers, scan for Python macro markers
2. Expand macros in main thread (Pyodide is already in a worker — reuse existing `PythonMacroWorkerRuntime`)
3. Cache expanded content
4. Pass pre-expanded content to generation workers

**Alternative approaches (if pre-expansion is too slow):**
- Workers send macro calls back to main thread via messages (RPC pattern)
- Workers skip macro posts; main thread renders them in a second pass

## Key Files to Modify

| File | Change |
|---|---|
| `src/main/engine/generation.worker.ts` | **NEW** — worker entry point |
| `src/main/engine/GenerationWorkerPool.ts` | **NEW** — worker pool manager |
| `src/main/engine/BlogGenerationEngine.ts` | Refactor `generate()` into coordinator |
| `src/main/engine/PageRenderer.ts` | Extract filter registration into factory function |
| `src/main/engine/GenerationRouteRendererFactory.ts` | Make usable from worker context |
| `src/main/ipc/blogHandlers.ts` | Pass DB path + template roots to worker pool |
| `src/main/engine/RoutePageGenerationService.ts` | `generateSinglePostPages` moves to worker |
| `vite.config.ts` / `tsconfig.main.json` | Worker entry point build config |

## Data Serialization Requirements

| Data | Size (10k posts) | Strategy |
|---|---|---|
| `BlogGenerationOptions` | ~1KB | Pass as `workerData` (plain object) |
| `PreloadedGenerationData` | ~2-5MB | Serialize Date→ISO string, pass via `workerData` |
| Post content (body) | N/A | Workers read from filesystem (lazy) |
| `HtmlRewriteContext` | ~500KB | Pass as `Record<string, string>` in `workerData` |
| `generatedHashCache` | ~1MB | Each worker bulk-loads from DB independently |
| Template files | ~50KB | Workers read from filesystem |
| Progress updates | tiny | `parentPort.postMessage()` |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@libsql/client` native bindings may not work in workers | Spike first (1.1). Fallback: use `better-sqlite3` directly in workers. |
| Memory pressure (N copies of post metadata) | Measure in spike. Could use `SharedArrayBuffer` or reduce per-worker data. |
| Pyodide macros can't run in generation workers | Phase 3 pre-expansion pass. Most posts don't use Python macros. |
| Worker crashes lose progress | Pool manager catches errors, reports partial results, coordinator can retry failed chunks. |
| Template root paths differ in packaged app | Pass `process.resourcesPath` via `workerData`. Already has CWD fallback. |
| Build configuration for worker entry point | Add worker to Vite/esbuild config (existing pattern from pythonMacro.worker.ts). |

## Success Criteria

- Render Site with 10k posts uses all available CPU cores
- Wall-clock time scales roughly linearly with core count (e.g., 4 cores → ~4x faster)
- No regression in output correctness (identical HTML output)
- Progress bar still works smoothly
- Memory usage stays under 2GB total
