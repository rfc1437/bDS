# Python Scripting — Remaining Work (Implementation-First)

Last verified: 27 Feb 2026

This document is intentionally reduced to **what is still left to implement**.
When plan and code differ, code is the source of truth.

## Implemented (checked)

- [x] Pyodide dependency integrated.
- [x] Renderer worker runtime exists (`pythonRuntime.worker.ts`) with ready/error/stdout/run protocol.
- [x] Runtime timeout watchdog + reset/recovery implemented in `PythonRuntimeManager`.
- [x] Renderer runtime request queueing implemented (concurrent calls are serialized in manager).
- [x] ABI v1 schemas and validation for macro context/result implemented (`abiV1.ts`).
- [x] Benchmark harness implemented (`npm run bench:python-runtime -- <iterations>`).
- [x] Script persistence model implemented (`scripts` DB table + `scripts/*.py` files).
- [x] Script metadata model implemented (`kind`, `entrypoint`, `enabled`, `version`, etc.).
- [x] Main process script CRUD engine + IPC handlers implemented.
- [x] Preload + shared API typings for scripts implemented.
- [x] Renderer scripts UX implemented (sidebar list, editor, save, run, delete).
- [x] Script syntax check + entrypoint discovery integrated in editor UX.
- [x] Blogmark transform pipeline executes Python transform scripts (`kind='transform'`) via a queued worker runtime by default.
- [x] Project preference `pythonRuntimeMode` added with Settings → Technology section.

## Confirmed Deviations from Original Plan

These are current realities and should be treated as authoritative unless we explicitly decide to change them.

1. **Transform runtime is now configurable (project-level)**
   - Default: `webworker` (worker-thread based Python runtime with queued requests).
   - Optional fallback: `main-thread` legacy execution mode.

2. **Built-in render-time macros remain JS-based by design**
   - Existing JS macro path remains valid (`PageRenderer.renderMacro` and renderer macro registry/definitions).
   - Python macro support is additive for new macros, not a migration requirement.

3. **Macro ABI is now wired for Python macro execution in both preview and production render paths**
   - ABI v1 + runtime manager support exist.
   - Main page generation path now supports Python macro rendering via `PythonMacroWorkerRuntime`.
   - Renderer preview path supports Python macro rendering via `PythonRuntimeManager`.
   - JS built-in macros always take priority; Python macros only resolve for names not in the JS registry.

4. **Scripts rebuild/sync parity is implemented (simple policy)**
   - `ScriptEngine.rebuildDatabaseFromFiles()` now rebuilds DB metadata from `scripts/*.py`.
   - `ScriptEngine.reconcileScriptsFromGitChanges()` now handles added/modified/deleted/renamed script files after git pull.
   - Settings → Data now includes **Rebuild Scripts** button (`scripts:rebuildFromFiles`) for manual parity with posts/media rebuild.

## Remaining Work Only

## 1) Python runtime boundary (P0) — Implemented

- [x] Worker model introduced for Blogmark transform execution with queued communication.
- [x] Runtime mode made project-configurable via Settings → Technology (`pythonRuntimeMode`).
- [x] Legacy main-thread mode retained as explicit fallback option.

## 2) Add scripts file-system rebuild/sync (P1) — Implemented

- [x] Implement rebuild/meta-diff style synchronization for `scripts/` so external file edits are detected.
- [x] Define conflict handling policy between DB metadata and script file frontmatter/body.
- [x] Add tests for create/edit/delete performed outside app while app is closed/open.

### Implemented policy (simple)

- Source of truth: script file + docstring frontmatter when present/valid.
- Rebuild path: delete current `scripts` rows for active project and re-import from `scripts/*.py`.
- Reconcile path (git pull): apply file deltas (`added|modified|deleted|renamed`) and upsert/delete rows.
- Conflict behavior: prefer file metadata/body; fall back to safe defaults when values are missing/invalid.

## 3) Additive Python macro support in render pipeline (P1) — Implemented

- [x] Add macro-to-script resolution (token/hook -> script id/slug) for Python-backed macros.
- [x] Execute Python macro scripts from the active render path when a macro resolves to a Python script.
- [x] Preserve existing JS macro behavior for built-in/current macros.
- [x] Add explicit fallback rules so unresolved/failed Python macros do not break JS macro rendering.
- [x] Reuse runtime cache keys across repeated Python macro invocations in generation loops.
- [x] Add guardrails for timeout/error fallback during render.

### Implementation details

- **Calling convention**: Python macro entrypoints use a two-argument signature: `def render(context, post)`. `context` is the macro context dict (with `params`, `language`, `post_slug`, etc.). `post` is the full `PostData` dict for the post containing the macro (with `title`, `slug`, `content`, `tags`, `categories`, `createdAt`, etc.), or `None` if post data is unavailable.

- **Production path**: `PageRenderer` now accepts an optional `PythonMacroRendererContract`. Macro replacement in the Liquid `markdown` filter is async via `replaceAllMacrosAsync()`. When an unknown macro name is encountered and a Python macro renderer is provided, the renderer resolves enabled macro scripts by slug and executes them via `PythonMacroWorkerRuntime` (Node.js worker thread + Pyodide). Script resolution only occurs when at least one non-built-in macro is present in the content, avoiding overhead for posts with only JS macros. PostData is serialized per-post via `serializePostDataForMacro()` and threaded through the Liquid `markdown` filter as `post_data_json_by_id`.

- **Preview path**: The renderer macro registry (`registry.ts`) supports `setPythonMacroResolver()`. When a macro is not found in the JS registry, the Python resolver is consulted. If a matching script is found, the renderer delegates to `PythonMacroRendererFn` which uses the existing `PythonRuntimeManager` (web worker + Pyodide).

- **`bds_api` module**: Python macros can call app APIs via the `bds_api` module. In the main-process worker (`PythonMacroWorkerRuntime`), API calls are dispatched via `mainProcessPythonApiInvoker.ts` which routes to engine methods directly. In the renderer worker, API calls go through the existing IPC bridge. The `bds_api` module is auto-generated by `generatePythonApiModuleV1.ts` and installed in both workers at bootstrap.

- **Python API namespaces wired to engines (v1.7.0)**:
  - `sync` → `GitApiAdapter` (wraps `GitEngine`, auto-resolves `projectPath` from active project). 9 methods: `checkAvailability`, `getRepoState`, `getStatus`, `getHistory`, `getRemoteState`, `fetch`, `pull`, `push`, `commitAll`. All git write operations (`fetch`, `pull`, `push`, `commitAll`) are available to utility scripts.
  - `publish` → `PublishApiAdapter` (wraps `PublishEngine` + `TaskManager`). 1 method: `uploadSite(credentials)` — runs 3 parallel SSH upload tasks (HTML, thumbnails, media) and returns aggregate result.
  - `app` → `AppApiAdapter`. 4 methods: `getDataPaths`, `getSystemLanguage`, `getDefaultProjectPath`, `readProjectMetadata`. Read-only app-level utilities useful for scripts that need project paths or locale info.
  - `chat` — **intentionally excluded** from the Python API contract. AI/chat features (`sendMessage`, `analyzeTaxonomy`, `analyzeMediaImage`, etc.) are expensive external API calls that require user oversight and interactive streaming UI. The chat namespace remains fully functional in the app UI and IPC layer — it is only excluded from the Python scripting bridge. This can be revisited in a future version if AI-from-Python becomes a supported use case with proper rate limiting, cost controls, and non-interactive execution patterns.

- **Editor macro detection**: The editor macro plugin uses `hasMacro()` to distinguish known macros from unknown ones. `hasMacro()` checks both the JS macro registry and a set of known Python macro slugs fetched via `scripts:getEnabledMacroSlugs` IPC. The slug set is refreshed on startup and whenever scripts change (`BDS_EVENT_SCRIPTS_CHANGED`).

- **Precedence**: JS built-in macros (youtube, vimeo, gallery, photo_archive, tag_cloud) always take priority over Python scripts with the same slug. Python macros only activate for names not registered in the JS macro registry.

- **Error handling**: Python macro execution errors are caught and result in empty string output, preserving the rest of the document. Script resolution errors are also caught gracefully.

- **Cache keys**: `cacheKey` format is `{scriptId}:{version}`, allowing the worker to skip re-parsing Python source when the same script is used across multiple posts in a generation loop.

## 4) Coexistence hardening + tests (P2) — Implemented

- [x] Add integration tests proving Python-based and JS-based macros can be used together in one post/page.
- [x] Add fixtures/golden tests for mixed macro rendering stability.
- [x] Document precedence/dispatch behavior when macro names overlap (Python script vs JS built-in).

### Test coverage

- `tests/engine/PageRenderer.pythonMacros.test.ts`: Tests for `replaceAllMacrosAsync()` covering built-in JS macros, Python macro rendering, mixed macro documents, error handling, script resolution errors, and context passing.
- `tests/renderer/macros/pythonMacroCoexistence.test.ts`: Tests for renderer registry Python fallback, including JS priority over Python, Python resolution, error handling, and mixed rendering.
- `tests/engine/PythonMacroWorkerRuntime.test.ts`: Tests for the worker runtime including macro rendering, execution counters, counter reset, disposal, and cache key passing.
- `tests/engine/ScriptEngine.test.ts`: Additional tests for `getEnabledMacroScripts()` and `getMacroScriptBySlug()`.

## 5) Diagnostics and performance visibility (P3) — Implemented

- [x] Add macro execution counters (count, timeout/error counts) for real render path.
- [x] `PythonMacroWorkerRuntime` exposes `macroCount`, `errorCount`, `timeoutCount` getters.
- [x] `resetCounters()` method for clean state between generation runs.

## Acceptance Gate Before Marking Python Scripting “Complete”

- [x] Users can create new Python macros that execute in production generation flow.
- [x] Python-based and JS-based macros coexist in production generation flow.
- [x] Scripts directory external changes are synchronized reliably.
- [x] Runtime boundary decision implemented and protected by tests.
- [x] Coexistence/dispatch behavior is documented and covered by tests.
- [x] `npm test` and `npm run build` pass.
