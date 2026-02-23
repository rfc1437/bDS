# Python Scripting — Remaining Work (Implementation-First)

Last verified: 23 Feb 2026

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

2. **Render-time macro migration has not happened yet**
   - Original plan: all render-time macros become Python-backed.
   - Actual implementation: render-time macros are still JS-based (`PageRenderer.renderMacro` and renderer macro registry/definitions).

3. **Macro ABI exists but is not the production render path**
   - ABI v1 + runtime manager support exist.
   - Main page generation path still uses existing JS macro rendering.

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

## 3) Wire Python macros into render pipeline (P1)

- [ ] Add macro-to-script resolution (token/hook -> script id/slug).
- [ ] Execute Python macro scripts from the active render path.
- [ ] Reuse runtime cache keys across repeated macro invocations in generation loops.
- [ ] Add guardrails for timeout/error fallback during render.

## 4) Macro parity migration + cleanup (P2)

- [ ] Port built-in macros to Python scripts with parity fixtures.
- [ ] Keep fixtures/golden tests for parity verification.
- [ ] Remove legacy JS macro path only after parity is proven.

## 5) Default script seeding/versioning (P2)

- [ ] Bundle default scripts in repo/app resources.
- [ ] Seed missing defaults on project init/startup deterministically.
- [ ] Add versioned update strategy for default scripts.

## 6) Diagnostics and performance visibility (P3)

- [ ] Add macro execution counters (count, timeout/error counts, p50/p95) for real render path.
- [ ] Define regression thresholds based on benchmark trends.

## Out of Scope Until Core Gaps Close

- [ ] AI assistant tooling exposure from Python scripts.
- [ ] General Python package/dependency policy expansion.
- [ ] Advanced bridge optimizations (only if metrics prove need).

## Acceptance Gate Before Marking Python Scripting “Complete”

- [ ] Render-time macros run through Python script path in production generation flow.
- [x] Scripts directory external changes are synchronized reliably.
- [x] Runtime boundary decision implemented and protected by tests.
- [ ] Legacy JS macro path removed (or explicitly retained with documented rationale).
- [x] `npm test` and `npm run build` pass.
