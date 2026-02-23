# Python Scripting — Remaining Work (Implementation-First)

Last verified: 23 Feb 2026

This document is intentionally reduced to **what is still left to implement**.
When plan and code differ, code is the source of truth.

## Implemented (checked)

- [x] Pyodide dependency integrated.
- [x] Renderer worker runtime exists (`pythonRuntime.worker.ts`) with ready/error/stdout/run protocol.
- [x] Runtime timeout watchdog + reset/recovery implemented in `PythonRuntimeManager`.
- [x] ABI v1 schemas and validation for macro context/result implemented (`abiV1.ts`).
- [x] Benchmark harness implemented (`npm run bench:python-runtime -- <iterations>`).
- [x] Script persistence model implemented (`scripts` DB table + `scripts/*.py` files).
- [x] Script metadata model implemented (`kind`, `entrypoint`, `enabled`, `version`, etc.).
- [x] Main process script CRUD engine + IPC handlers implemented.
- [x] Preload + shared API typings for scripts implemented.
- [x] Renderer scripts UX implemented (sidebar list, editor, save, run, delete).
- [x] Script syntax check + entrypoint discovery integrated in editor UX.
- [x] Blogmark transform pipeline executes Python transform scripts (`kind='transform'`).

## Confirmed Deviations from Original Plan

These are current realities and should be treated as authoritative unless we explicitly decide to change them.

1. **Transform script runtime location differs**
   - Original plan: untrusted Python runs in renderer worker only.
   - Actual implementation: Blogmark transform scripts run in **main process** Pyodide (`BlogmarkTransformService`).

2. **Render-time macro migration has not happened yet**
   - Original plan: all render-time macros become Python-backed.
   - Actual implementation: render-time macros are still JS-based (`PageRenderer.renderMacro` and renderer macro registry/definitions).

3. **Macro ABI exists but is not the production render path**
   - ABI v1 + runtime manager support exist.
   - Main page generation path still uses existing JS macro rendering.

4. **Scripts rebuild/meta-diff sync is still missing**
   - Script CRUD works via app APIs.
   - No implemented project-wide “rebuild from files” parity for `scripts/` equivalent to posts/media rebuild flows.

## Remaining Work Only

## 1) Decide and enforce Python runtime boundary (P0)

- [ ] Decide if `transform` scripts should stay in main process or move to renderer worker.
- [ ] If staying in main process: add explicit timeout/kill/recovery safeguards equivalent to worker watchdog behavior.
- [ ] If moving to worker: route transform execution through typed IPC/worker bridge and remove main-process execution path.
- [ ] Document final security model in this file after decision.

## 2) Add scripts file-system rebuild/sync (P1)

- [ ] Implement rebuild/meta-diff style synchronization for `scripts/` so external file edits are detected.
- [ ] Define conflict handling policy between DB metadata and script file frontmatter/body.
- [ ] Add tests for create/edit/delete performed outside app while app is closed/open.

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
- [ ] Scripts directory external changes are synchronized reliably.
- [ ] Runtime boundary decision implemented and protected by tests.
- [ ] Legacy JS macro path removed (or explicitly retained with documented rationale).
- [ ] `npm test` and `npm run build` pass.
