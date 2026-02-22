# Python Scripting Integration Plan (Electron + Pyodide)

## 1. Goal and Scope

Primary goal: all render-time macros run in Python, with predictable performance and safe sandboxing.

Secondary goals:
- User-editable Python scripts with project persistence (`scripts/` folder + DB index).
- Python scripting reuse in bookmarklet/post-processing pipelines.
- Keep architecture consistent with existing `main/engine` + `ipc` + `renderer` boundaries.

This document defines a staged path from MVP to full scope.

---

## 2. Viability Summary (Realistic Expectations)

### Is this realistic?
Yes, if we optimize for **low bridge overhead** and **stable execution contracts**.

Key reality checks:
- Pyodide in a worker is viable for user scripting and sandboxing.
- Macro execution in render loops can be fast enough if we avoid frequent JS↔Python conversions.
- `< 1ms` per macro call is possible only for simple macros with precompiled code and minimal marshaling; it must be treated as a benchmark target, not a guarantee.
- For heavy loops, the work should stay inside Python once called (coarse-grained calls), not bounce per item between JS and Python.

Decision:
- Keep Pyodide as the default engine.
- Design a strict, minimal ABI (Application Binary Interface-like contract) for macro inputs/outputs.
- Use preloading, precompilation, and caching before adding advanced optimizations.

---

## 3. Architecture Fit for bDS

### 3.1 Layering

Keep existing project boundaries:
- `src/main/engine`: script metadata, script storage/indexing, render orchestration, benchmark/logging.
- `src/main/ipc`: typed handlers for script CRUD, run, and diagnostics.
- `src/renderer`: script editor UI, run controls, output panel integration.
- Python runtime (Pyodide) stays in renderer-side worker context; main process never executes untrusted script code.

### 3.2 Runtime Placement

- Host a long-lived `PythonRuntimeWorker` in renderer.
- Initialize Pyodide once per app session (or lazily on first script run).
- Maintain an in-memory registry of loaded scripts and compiled callables.

### 3.3 Macro Execution Contract (Performance-Critical)

Use one narrow contract for all macros:

Python side:
```python
def render(context: dict) -> dict:
		...
```

Contract rules:
- Input `context` is plain JSON-compatible data only.
- Output is plain JSON-compatible data only.
- No Node/Electron direct access from Python.
- No per-token/per-node callbacks into JS while rendering.

### 3.4 Bridge Strategy (Keep Conversions Simple)

- Preferred: pass compact JSON payloads (single call in, single result out).
- Avoid dynamic proxy-style JS objects in hot paths.
- Avoid `toPy()/toJs()` inside tight loops.
- Use `pyodide.globals` only for stable utility bindings set once during worker startup.

### 3.5 Security Model

- Scripts execute only in worker.
- Hard timeout + termination + runtime restart on runaway scripts.
- Allowlist API surface exposed to Python (pure functions where possible).
- Validate and sanitize all script outputs in JS before applying to render pipeline.

---

## 4. Staged Delivery Plan

## Phase 0 — Technical Spike (timeboxed)

Objective: prove runtime viability before product surface growth.

Deliverables:
- [x] Add `pyodide` dependency and worker boot sequence.
- [x] Run a sample script end-to-end (`run_script`, timeout, captured stdout).
- [x] Benchmark baseline cold start + warm run + repeated macro calls.
- [x] Define initial macro ABI (`render(context) -> result`) and schema docs.

Exit criteria:
- Warm script execution is stable. ✅
- Timeout recovery works. ✅
- Measured baseline captured in repo docs. ✅

Baseline benchmark (22 Feb 2026, local macOS run):
- Command: `npm run bench:python-runtime -- 200`
- Cold start: `701.11 ms`
- Warm run: `5.74 ms`
- Repeated macro (200 calls): `p50 0.17 ms`, `p95 0.29 ms`, `mean 0.19 ms`
- Notes: one-machine baseline only; use trend comparisons for regressions.

## Phase 1 — MVP (Minimal but Usable)

Objective: user can create/run scripts and see output.

Deliverables:
- [ ] Script storage model (DB index + filesystem source in `scripts/*.py`).
- [ ] CRUD APIs in `main/engine` + `ipc` handlers.
- [ ] Renderer scripts list + editor + run button.
- [ ] Console/output capture in existing bottom output area.
- [ ] Project rebuild picks up `scripts/` changes.

Out of scope for MVP:
- Macro replacement.
- Bookmarklet integration.
- AI assistant tool access from Python.

Exit criteria:
- Scripts can be created, persisted, run, and debugged.
- Script files round-trip correctly with filesystem.

## Phase 2 — Macro Runtime Foundation

Objective: integrate Python macros into renderer loop with low overhead.

Deliverables:
- [ ] Add script type/metadata (`kind: macro | utility | transform`).
- [ ] Resolve macro references from content to script IDs.
- [ ] Implement macro runtime cache: module load once, callable reuse.
- [ ] Convert existing macro parameter parsing into typed context object once per macro invocation.
- [ ] Add perf counters (call count, p50/p95 runtime, timeout count).

Exit criteria:
- Python macro path is feature-equivalent for at least 1–2 existing macros.
- Measured overhead acceptable against baseline.

## Phase 3 — Macro Migration (Full Goal)

Objective: all current built-in macros are Python-backed.

Deliverables:
- [ ] Port each existing macro implementation to Python scripts.
- [ ] Keep default macro scripts versioned in repo and bundled with app.
- [ ] On startup/project init, seed missing default macro scripts into filesystem + DB.
- [ ] Add script-as-macro assignment in metadata and editor UX.
- [ ] Keep parameter typing rules explicit (`"123"` quoted string stays string; unquoted numerics map to int/float).

Exit criteria:
- All built-in macros execute via Python runtime.
- Legacy JS macro path is removed after parity confirmation.

## Phase 4 — Performance Hardening

Objective: reach production-grade speed and stability for render loops.

Deliverables:
- [ ] Precompile/load scripts once per worker lifecycle.
- [ ] Batch render APIs where beneficial (`render_many(contexts)`).
- [ ] Reduce marshaling size (compact context shape, no redundant fields).
- [ ] Optional SharedArrayBuffer experiments only if measured need justifies added complexity.
- [ ] Failure isolation and automatic runtime reset strategy.

Exit criteria:
- Stable long-run benchmarks in CI/manual perf suite.
- No UI thread stalls during heavy generation.

## Phase 5 — Bookmarklet/Post Transform Integration

Objective: reuse Python runtime for post-ingest transformations.

Deliverables:
- [ ] Hook script transforms into bookmarklet pipeline after data sanitization.
- [ ] Input: validated post object; output: transformed validated post object.
- [ ] Add transform-specific script type and error handling/reporting.

Exit criteria:
- Transform scripts can safely modify incoming post content.
- Fallback behavior exists when transform fails.

## Phase 6 — Advanced Capabilities (Optional)

Objective: add power-user features only after core stability.

Candidates:
- [ ] Python-accessible app tools (strict allowlist).
- [ ] AI assistant tooling from Python scripts.
- [ ] Script package/dependency policy for curated modules.

---

## 5. Data and Storage Design

- Source of truth for scripts follows existing pattern: filesystem + DB index.
- Files: `scripts/<slug>.py`.
- Metadata can be stored in:
	- DB columns (preferred for indexing/query), and/or
	- leading Python block comment for file portability.
- Rebuild/meta-diff must include `scripts/` exactly like posts/media flow.

Recommended script metadata:
- `id`, `slug`, `title`, `kind`, `entrypoint`, `enabled`, `version`, `updatedAt`.

---

## 6. Performance Plan (Macro-Critical)

Principles:
- Coarse-grained calls: one macro invocation should do meaningful work in Python.
- Stable ABI: small, predictable context payload.
- Warm runtime reuse: no repeated Pyodide boot.
- Compile/load once, execute many.

Initial target envelope (to validate in Phase 0/2):
- Warm invocation overhead target: low single-digit milliseconds for typical macros.
- p95 render stability target under large generation batches.
- Timeout and memory guardrails for pathological scripts.

Note: The previous strict `<1ms` universal target is replaced by benchmark tiers by macro class (simple/medium/heavy), which is more realistic.

---

## 7. Security and Reliability

- No direct filesystem/network/process APIs in Python runtime.
- Worker watchdog timeout and hard-kill policy.
- Structured errors returned to UI and logs.
- Script output validation before use in rendering.
- Versioned default scripts to ensure deterministic behavior across app updates.

---

## 8. Testing and Rollout Strategy

- Unit tests for engine-level script registry, metadata, and macro resolution.
- Integration tests for worker protocol and timeout recovery.
- Golden tests to compare macro output parity before/after migration.
- Performance regression checks for macro hot paths.
- Feature flag for staged rollout before removing legacy macro path.

---

## 9. Coding Agent Execution Pack

This section makes the plan directly executable by coding agents.

### 9.1 Working Rules for Agents

- Work one phase at a time; do not start the next phase before exit criteria pass.
- Keep changes layered by architecture boundary (`main/engine`, `main/ipc`, `renderer`).
- For each task: write/adjust tests first where feasible, then implement minimal code.
- Keep runtime contract stable once introduced; changes require updating ABI docs and tests.
- Do not add broad API exposure from JS/Electron into Python; only allowlisted calls.

### 9.2 Definition of Done (Per Phase)

Each phase is done only if all are true:
- [ ] Deliverables implemented.
- [ ] Exit criteria verified.
- [ ] Relevant tests pass.
- [ ] Full test suite passes (`npm test`).
- [ ] Full build passes (`npm run build`).
- [ ] Plan document updated with decisions/benchmarks where applicable.

### 9.3 Task Card Template (Use for Every Agent Task)

```md
Task:
Scope:
Files expected to change:
Out of scope:
Acceptance checks:
Commands to run:
Notes/Risks:
```

### 9.4 Phase-by-Phase Agent Backlog (Suggested)

#### Phase 0 backlog

1. Runtime bootstrap spike
- Scope: add Pyodide dependency and worker startup path only.
- Files likely: `package.json`, new worker file under `src/renderer/`.
- Acceptance: worker initializes once, reports ready state.

2. Safe execute protocol
- Scope: request/response protocol (`run`, `stdout`, `error`, `timeout`).
- Files likely: renderer runtime manager + worker + related types.
- Acceptance: sample script run succeeds; timeout kills and recovers runtime.

3. Baseline benchmark harness
- Scope: cold start, warm run, repeated macro invoke metrics.
- Files likely: engine/diagnostic service or dedicated benchmark utility + docs.
- Acceptance: numbers recorded in this document or linked benchmark doc.

4. ABI v1 spec
- Scope: formal JSON schema for macro `context` and `result`.
- Files likely: shared type definitions + docs.
- Acceptance: schema used by both caller and worker-side validator.

#### Phase 1 backlog

1. Script persistence model
- Scope: DB + filesystem mapping for `scripts/*.py`.
- Acceptance: create/update/delete round-trips both stores.

2. Main engine + IPC CRUD
- Scope: add script engine methods and typed IPC handlers.
- Acceptance: renderer can list/read/write scripts through IPC only.

3. Renderer MVP UI
- Scope: scripts list, editor panel, run button, output panel integration.
- Acceptance: user edits script, runs it, sees stdout/errors.

4. Rebuild/meta-diff integration
- Scope: include scripts in existing rebuild and metadata diff flow.
- Acceptance: external file changes in `scripts/` are detected and synchronized.

#### Phase 2 backlog

1. Macro script typing + mapping
- Scope: `kind` metadata and mapping from macro token to script id.
- Acceptance: at least one macro resolved to Python script.

2. Runtime cache path
- Scope: load/compile once; callable reuse.
- Acceptance: repeated macro invocations avoid re-init/re-import.

3. Context adapter
- Scope: convert existing macro params into ABI v1 `context` once per invocation.
- Acceptance: typed values obey conversion rules.

4. Perf counters
- Scope: call count, p50/p95, timeout/error counts.
- Acceptance: counters visible in logs/diagnostics.

#### Phase 3 backlog

1. Built-in macro parity migration
- Scope: port each macro to Python scripts and add parity tests.
- Acceptance: output parity with legacy macros for baseline fixtures.

2. Default script seeding/versioning
- Scope: bundle defaults, seed missing scripts on init.
- Acceptance: clean project bootstraps required macro scripts automatically.

3. Legacy path removal
- Scope: remove JS macro implementations after parity gate.
- Acceptance: tests pass with Python-only macro path.

#### Phase 4–6 backlog

- Keep as optimization/integration tracks only after parity and stability gates pass.

### 9.5 Anti-Patterns for Agents (Do Not Do)

- Do not call JS functions per token/item from Python in hot paths.
- Do not pass large proxy objects through the bridge in render loops.
- Do not introduce direct filesystem/network access in Python runtime.
- Do not couple UI/editor work with macro migration in one PR-sized change.
- Do not remove legacy macro code before golden parity tests pass.

### 9.6 Handoff Checklist (Agent to Agent)

Every handoff should include:
- Completed task cards and remaining task cards.
- Files changed and rationale.
- Test/build command outputs summary.
- Known risks and benchmark deltas.
- Any ABI changes (must be explicit).

### 9.7 Suggested PR Boundaries (One Task, One PR)

Use small PRs with one primary purpose each.

PR-00: Pyodide bootstrap spike
- Includes: dependency, worker init, ready signal.
- Excludes: script persistence, UI/editor.
- Merge gate: runtime initializes and tests/build pass.

PR-01: Worker run protocol + timeout recovery
- Includes: run/stdout/error/timeout messaging, watchdog + restart behavior.
- Excludes: macro integration.
- Merge gate: timeout test and recovery test pass.

PR-02: ABI v1 types + schema validation
- Includes: shared types and validation for `context/result`.
- Excludes: macro migration.
- Merge gate: caller and worker both use ABI validators.

PR-03: Script persistence model
- Includes: DB + filesystem model for `scripts/*.py`.
- Excludes: renderer UI.
- Merge gate: round-trip persistence tests pass.

PR-04: Script engine + IPC CRUD
- Includes: `main/engine` methods and typed `ipc` handlers.
- Excludes: macro runtime.
- Merge gate: IPC integration tests pass.

PR-05: Renderer MVP scripts UI
- Includes: scripts list/editor/run/output integration.
- Excludes: macro substitution.
- Merge gate: end-to-end manual run path works + tests/build pass.

PR-06: Rebuild/meta-diff integration
- Includes: include `scripts/` in rebuild and metadata diff paths.
- Excludes: macro migration.
- Merge gate: external script file changes are detected and synchronized.

PR-07: Macro mapping + runtime cache foundation
- Includes: macro-to-script mapping, callable cache, first Python-backed macro.
- Excludes: full macro parity.
- Merge gate: at least one macro parity fixture passes.

PR-08: Macro parity migration batch A
- Includes: port a small set of built-in macros (e.g., 2–3) + golden tests.
- Excludes: removal of legacy path.
- Merge gate: parity fixtures pass for migrated macros.

PR-09: Macro parity migration batch B (repeat as needed)
- Includes: additional macro ports + fixtures.
- Excludes: removal of legacy path.
- Merge gate: all targeted macro parity tests pass.

PR-10: Default script seeding/versioning
- Includes: bundled default scripts + startup seeding behavior.
- Excludes: advanced scripting APIs.
- Merge gate: clean project gets default scripts deterministically.

PR-11: Legacy JS macro path removal
- Includes: delete legacy macro implementations after full parity.
- Excludes: bookmarklet transforms.
- Merge gate: full test suite and render parity suite pass.

PR-12: Performance hardening
- Includes: benchmark harness refinements, caching improvements, optional batch APIs.
- Excludes: unrelated UI changes.
- Merge gate: regression thresholds (p50/p95) stay within agreed envelope.

PR-13: Bookmarklet transform integration
- Includes: transform script type, pipeline hook, validation/fallback.
- Excludes: optional advanced tool APIs.
- Merge gate: sanitized input/output transform tests pass.

PR-14+: Optional advanced capabilities
- Includes: allowlisted app tools, AI-assistant script tools, curated package policy.
- Merge gate: explicit security review and feature-flag rollout.

---

## 10. Current Status

Status: Phase 0 in progress (MVP-first, full-scope preserved).

Progress update (22 Feb 2026):
- [x] PR-00 complete: Pyodide dependency + renderer worker bootstrap + ready signal.
- [x] PR-01 complete: worker run/stdout/error protocol + timeout watchdog + runtime recovery.
- [x] PR-02 complete: ABI v1 shared types/schemas + caller/worker validation.
- [x] Phase 0 benchmark harness + baseline capture complete.

Recommended next action:
1. Start Phase 1 PR-03: script persistence model (`scripts/*.py` + index metadata).
2. Add round-trip tests for create/update/delete between filesystem and DB.
3. Keep benchmark command in CI/manual perf checks for regressions.
