# Refactor Plan: Duplication Reduction

Date: 2026-02-15  
Scope: Reduce high-impact code duplication in production and test-adjacent areas while preserving behavior.

## Current Status (after latest duplicate scan)

| Phase | Area | Status | Notes |
|---|---|---|---|
| 1 | Electron API contract | ✅ Completed | Shared contract now covers renderer store data interfaces too. |
| 2 | Tag mutation workflow | ✅ Completed | Shared task workflow now used by delete/merge/rename paths. |
| 3 | Post-media single/batch ops | ✅ Completed | Single/batch link and unlink now share common internals. |
| 4 | Project mapping + delete guards | ✅ Completed | Guard + mapper extracted and used in target methods. |
| 5 | Metadata sync loop scaffolding | ✅ Completed | `runSyncLoop` extracted and reused by both sync directions. |
| 6 | Shared color utility | ✅ Completed | Shared `getContrastColor` utility is in use. |

### Retired Phases (do not revisit unless regressions appear)

- Phase 4
- Phase 5
- Phase 6

## Objectives

- Eliminate high-risk duplication that can cause drift or inconsistent behavior.
- Keep changes incremental and reviewable via phase-based PRs.
- Follow strict TDD and repository requirements (`npm test` and `npm run build` green at each phase).

## Working Rules (applies to every phase)

1. Write failing tests first (Red).
2. Implement minimal code to pass (Green).
3. Refactor while staying green.
4. Run full test suite: `npm test`.
5. Run full build: `npm run build`.
6. Do not change behavior unless explicitly planned in acceptance criteria.

---

## Phase 1 — Consolidate Electron API Contract (Highest ROI)

Status: ✅ Completed

### Problem
`electronAPI` shape is duplicated across multiple files and can drift:
- `src/main/preload.ts`
- `src/renderer/types/electron.d.ts`
- Overlapping app/store type surfaces in `src/renderer/store/appStore.ts`

### Goal
Create one canonical API contract and consume it from both preload and renderer type declarations.

### Tasks
- Add shared contract module (suggested: `src/shared/electronApi.ts`).
- Move reusable API interfaces/types there.
- Update `src/main/preload.ts` to use the shared type(s) where applicable.
- Update `src/renderer/types/electron.d.ts` to reference the shared contract.
- Remove duplicate preload-local `ElectronAPI` declarations if no longer needed.

### Progress Check
- Completed: shared contract module exists and is imported by preload and renderer ambient types.
- Completed: overlapping data-shape duplication was removed by sourcing store data interfaces from shared contract types.

### Acceptance Criteria
- Single source of truth for `electronAPI` contract shape.
- No contract mismatch between preload and renderer types.
- Typecheck/build pass with no API regressions.

### Risks / Notes
- Ambient type import patterns in `.d.ts` files can be tricky; keep changes minimal and explicit.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/main/preload.ts`: not instrumented in coverage output (`MISSING`), so direct statement/branch confidence is low.
- `tests/engine/PreloadContract.test.ts`: 1 contract test; good smoke check, but narrow for refactor safety.
- `src/renderer/store/appStore.ts`: 63.33% statements, 53.25% functions, 56.25% branches.
- `tests/renderer/store/appStore.test.ts`: 14 tests; moderate confidence for store behavior, limited for API-contract drift.

### Impact (size/criticality)
- **Critical / Medium**: cross-process API/type drift can break renderer↔main integration and is hard to diagnose.

---

## Phase 2 — Extract Common Tag Mutation Workflow

Status: ✅ Completed

### Problem
`TagEngine` repeats similar logic in:
- `deleteTag`
- `mergeTags`
- `renameTag`

Repeated steps include finding posts, parsing/updating tags JSON, syncing published files, and progress reporting.

### Goal
Refactor shared behavior into private helpers while preserving all task/event semantics.

### Tasks
- In `src/main/engine/TagEngine.ts`, add private helpers for:
  - query posts containing a tag,
  - transform tag arrays,
  - persist post tag updates + file sync,
  - shared progress calculation/reporting.
- Update `deleteTag`, `mergeTags`, and `renameTag` to compose helpers.
- Expand/adjust tests in `tests/engine/TagEngine.test.ts` to protect behavior.

### Progress Check
- Completed: helper extraction has started (`queryPostsContainingTag`, `updatePostTagsAndSync`, and shared update path usage).
- Completed: duplicate progress/task scaffolding was consolidated across `deleteTag` / `mergeTags` / `renameTag` via shared task workflow.

### Acceptance Criteria
- Public method behavior and events unchanged.
- Reduced duplicate blocks in `TagEngine`.
- Existing and new tests pass.

### Risks / Notes
- Must preserve task progress percentages/messages expected by UI.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/main/engine/TagEngine.ts`: 95.98% statements, 98.00% functions, 77.89% branches.
- `tests/engine/TagEngine.test.ts`: 48 tests covering create/update/delete/merge/rename flows and edge cases.
- Quality is generally strong; remaining risk is branch-level behavior around progress/task scaffolding that still has partial gaps.

### Impact (size/criticality)
- **High / Medium-Large**: duplication sits in mutation workflows; drift can cause inconsistent tag edits across posts.

---

## Phase 3 — Unify Single/Batch Post-Media Operations

Status: ✅ Completed

### Problem
`PostMediaEngine` duplicates linking/unlinking logic across single and batch methods:
- `linkMediaToPost` vs `linkManyToPost`
- `unlinkMediaFromPost` vs `unlinkManyFromPost`

### Goal
Create common primitives and make single/batch methods compose them.

### Tasks
- In `src/main/engine/PostMediaEngine.ts`, extract private primitives:
  - create/delete relation rows,
  - update media sidecar `linkedPostIds` (add/remove),
  - shared sort-order handling where applicable.
- Refactor single and batch methods to reuse primitives.
- Add parity tests in `tests/engine/PostMediaEngine.test.ts`.

### Progress Check
- Completed: shared primitives exist (`createPostMediaLink`, `removePostMediaLink`, sidecar helpers).
- Completed: remaining single/batch duplicate link/unlink segments were collapsed into shared internal paths.

### Acceptance Criteria
- No behavior regressions in link/unlink semantics.
- Event behavior preserved (`mediaLinked`/`mediaUnlinked` vs batch events).
- Duplicate logic materially reduced.

### Risks / Notes
- Preserve ordering and skip logic for already-linked media.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/main/engine/PostMediaEngine.ts`: 99.12% statements, 100.00% functions, 86.67% branches.
- `tests/engine/PostMediaEngine.test.ts`: 35 tests across single/batch link-unlink paths, events, ordering, and dedupe behavior.
- Very good safety net; branch coverage indicates some untested conditional paths remain.

### Impact (size/criticality)
- **High / Medium**: affects media linking integrity and batch operation consistency in editing workflows.

---

## Phase 4 — Consolidate Project Mapping and Guard Clauses

Status: ✅ Completed (retired)

### Problem
`ProjectEngine` repeats:
- default-project delete protection checks,
- DB row → `ProjectData` mapping in several methods.

### Goal
Centralize repetitive mapping and guard logic.

### Tasks
- In `src/main/engine/ProjectEngine.ts`, add:
  - `assertDeletableProject(id)` (or equivalent guard helper),
  - `mapDbProjectToProjectData(row)` mapper.
- Replace repeated mapping/guard code in:
  - `deleteProject`, `deleteProjectWithData`,
  - `getProject`, `getAllProjects`, `getActiveProject`.
- Validate with `tests/engine/ProjectEngine.test.ts`.

### Acceptance Criteria
- Same return shapes and delete behavior as before.
- Less repeated mapping/guard logic.

### Risks / Notes
- Keep null/undefined normalization unchanged for optional fields.

---

## Phase 5 — Extract Metadata Sync Loop Scaffolding

Status: ✅ Completed (retired)

### Problem
`MetadataDiffEngine` has near-identical loop scaffolding in:
- `syncDbToFile`
- `syncFileToDb`

Includes progress reporting, success/failure accounting, and event-loop yielding.

### Goal
Abstract common iteration mechanics into one helper with operation-specific callbacks.

### Tasks
- In `src/main/engine/MetadataDiffEngine.ts`, add a generic internal iterator helper that handles:
  - per-item execution,
  - success/fail accounting,
  - periodic progress updates,
  - periodic `setImmediate` yielding.
- Refactor both sync methods to use it.
- Verify with `tests/engine/MetadataDiffEngine.test.ts`.

### Acceptance Criteria
- Same visible progress and final result semantics.
- Reduced duplicated loop/control-flow code.

### Risks / Notes
- Progress message cadence should remain compatible with UI expectations.

---

## Phase 6 — Deduplicate Shared Color Utility in Renderer

Status: ✅ Completed (retired)

### Problem
`getContrastColor` is duplicated in:
- `src/renderer/components/TagInput/TagInput.tsx`
- `src/renderer/components/TagsView/TagsView.tsx`

### Goal
Move color contrast logic into a shared renderer utility.

### Tasks
- Add utility module (suggested: `src/renderer/utils/color.ts`).
- Replace local implementations in both components.
- Add focused tests (suggested: `tests/renderer/utils/color.test.ts`).

### Acceptance Criteria
- No visual behavior change.
- One implementation for contrast-color calculation.

### Risks / Notes
- Verify support for both 3-char and 6-char hex inputs.

---

## Suggested Delivery Sequence

1. Phase 1 (finish API/store type convergence)
2. Phase 2 (finish TagEngine workflow dedup)
3. Phase 3 (finish PostMedia single/batch dedup)
4. ~~Phase 7 (WxrParser repeated parse blocks)~~ ✅ Completed
5. Phase 8 (MetaEngine ↔ TagEngine overlap)
6. Phase 9 (renderer tag event subscription helper)
7. Phase 10 (local UI repeated blocks in component files)

Rationale: complete in-flight high-impact phases first, then address newly detected production hotspots.

---

## Newly Detected Phases (from latest scan)

## Phase 7 — Consolidate WXR Item Parse Blocks

Status: ✅ Completed

### Problem
`WxrParser` contains repeated `pubDate` parsing + return-shape scaffolding in nearby item parse paths.

### Goal
Extract shared `parsePubDate` and/or shared item base builder helper to avoid drift.

### Tasks
- Add small private parser helpers in `src/main/engine/WxrParser.ts`.
- Replace duplicated blocks in both item parse branches.
- Preserve parse semantics with focused tests in `tests/engine/WxrParser.test.ts`.

### Acceptance Criteria
- No behavior change in parsed output.
- Duplicated `pubDate`/return scaffolding materially reduced.

### Progress Check
- Completed: extracted shared `pubDate` parser helper and shared base item builder for post/media parse paths.
- Completed: added branch-focused tests for valid/invalid/missing `pubDate` and post/page parse-branch parity.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/main/engine/WxrParser.ts`: 93.55% statements, 100.00% functions, 67.14% branches.
- `tests/engine/WxrParser.test.ts`: 19 tests covering parse variants, status handling, metadata extraction, and file-read paths.
- Branch coverage is the main gap; refactor should add branch-focused tests around date parsing and branch-specific fallbacks.

### Impact (size/criticality)
- **Medium / Small-Medium**: parser duplication can create subtle import differences, but blast radius is mostly import pipeline quality.

---

## Phase 8 — Merge Shared Taxonomy/Metadata Logic (MetaEngine + TagEngine)

### Problem
A medium-sized duplicate block appears across `MetaEngine` and `TagEngine` for taxonomy/tag-style handling.

### Goal
Extract a shared helper module or internal utility used by both engines.

### Tasks
- Identify exact shared operations (normalization, set/merge/update behavior).
- Add reusable utility in `src/main/engine` (or `src/main/shared` if appropriate).
- Replace both engine-local copies with utility calls.
- Add/adjust tests in `tests/engine/MetaEngine.test.ts` and `tests/engine/TagEngine.test.ts`.

### Acceptance Criteria
- Equivalent behavior in both engines.
- Single implementation for overlapping logic.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/main/engine/MetaEngine.ts`: 95.03% statements, 96.55% functions, 77.59% branches.
- `src/main/engine/TagEngine.ts`: 95.98% statements, 98.00% functions, 77.89% branches.
- Tests are extensive (`MetaEngine`: 53 tests, `TagEngine`: 48 tests), but mostly engine-local; cross-engine shared-helper contracts are not explicitly asserted yet.

### Impact (size/criticality)
- **High / Medium**: duplicate taxonomy logic across engines is a drift risk for metadata/tag consistency.

---

## Phase 9 — Renderer Tag Event Subscription Dedup

### Problem
`TagInput` and `TagsView` duplicate tag-event subscription setup/teardown scaffolding.

### Goal
Introduce a small shared renderer utility/hook for tag event subscriptions.

### Tasks
- Add a focused helper/hook under `src/renderer/utils` or `src/renderer/components`.
- Replace duplicated subscribe/unsubscribe code in both components.
- Keep event coverage differences explicit where needed (e.g., `tag:updated` in `TagsView`).

### Acceptance Criteria
- Same runtime behavior and refresh triggers.
- One canonical subscription implementation.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/renderer/components/TagInput/TagInput.tsx`: 0% statements/functions/branches.
- `src/renderer/components/TagsView/TagsView.tsx`: 0% statements/functions/branches.
- No dedicated renderer component tests found for these files; refactor safety currently relies on manual behavior checks.

### Impact (size/criticality)
- **Medium / Medium**: mostly UX/event-refresh consistency risk; low data-corruption risk but high chance of regressions in UI responsiveness.

---

## Phase 10 — Local UI Component Block Dedup (Low Risk)

### Problem
Small duplicated blocks exist within individual components (`ProjectSelector`, `CredentialsPanel`, `AISuggestionsModal`, and parts of `App.tsx`).

### Goal
Reduce repeated local code with tiny helpers while preserving readability.

### Tasks
- Consolidate repeated JSX/control-flow blocks per component.
- Keep changes local and minimal; avoid broad redesign.
- Add/adjust nearby renderer tests where behavior could regress.

### Acceptance Criteria
- Lower clone count in affected files.
- No UX or behavior changes.

### Coverage & Test Quality (fresh run: `npm run test:coverage`)
- `src/renderer/components/ProjectSelector/ProjectSelector.tsx`: 0% statements/functions/branches.
- `src/renderer/components/CredentialsPanel/CredentialsPanel.tsx`: 0% statements/functions/branches.
- `src/renderer/components/AISuggestionsModal/AISuggestionsModal.tsx`: 0% statements/functions/branches.
- `src/renderer/App.tsx`: 0% statements/functions/branches.
- No dedicated component tests found for these phase-10 targets.

### Impact (size/criticality)
- **Medium-Low / Small-Medium**: local duplications with limited architectural risk, but high regression risk without renderer tests.

---

## Test Plan (Open Phases)

Goal: provide a concrete Red-Green checklist for remaining phases so refactors are protected by behavior-first tests.

### Phase 1 — Electron API Contract

Add/extend tests in:
- `tests/engine/PreloadContract.test.ts`
- `tests/renderer/store/appStore.test.ts`

Planned test cases:
- [ ] `preload exposes shared contract keys only`: assert `contextBridge.exposeInMainWorld` receives exactly the shared API shape.
- [ ] `contract import parity`: assert preload and renderer ambient declarations both resolve to shared contract types (compile-time fixture test pattern).
- [ ] `store contract boundary`: add a test that verifies store-side API data assumptions match shared contract field names and optionality.

### Phase 2 — TagEngine Workflow Dedup

Add/extend tests in:
- `tests/engine/TagEngine.test.ts`

Planned test cases:
- [ ] `deleteTag progress sequence remains stable`: verify progress/message checkpoints across multi-post delete.
- [ ] `mergeTags progress sequence remains stable`: same assertion pattern for merge path.
- [ ] `renameTag progress sequence remains stable`: same assertion pattern for rename path.
- [ ] `shared helper parity`: same input set through delete/merge/rename keeps DB/file updates and emitted events identical to pre-refactor behavior.
- [ ] `single-write-per-post invariant`: explicit assertion that duplicated result rows never cause duplicate writes.

### Phase 3 — PostMedia Single/Batch Unification

Add/extend tests in:
- `tests/engine/PostMediaEngine.test.ts`

Planned test cases:
- [ ] `single vs batch link parity`: linking one item via single API and batch API yields identical row + sidecar state.
- [ ] `single vs batch unlink parity`: unlinking one item via both paths yields identical state.
- [ ] `already-linked/skip parity`: same skip semantics and counters between paths.
- [ ] `event contract parity`: preserve single-event vs batch-event distinctions after helper consolidation.
- [ ] `sort-order parity`: batch and single operations preserve expected incremental ordering rules.

### Phase 7 — WxrParser Parse Block Consolidation

Add/extend tests in:
- `tests/engine/WxrParser.test.ts`

Planned test cases:
- [ ] `pubDate variants`: valid RFC822, invalid date, and missing date all map to same outputs as before.
- [ ] `item branch parity`: duplicated parse branches produce identical base item fields after helper extraction.
- [ ] `fallback timestamp behavior`: explicitly verify fallback behavior for empty/invalid date nodes.
- [ ] `mixed content regression`: ensure post/page/media classification remains unchanged when helper is introduced.

### Phase 8 — MetaEngine + TagEngine Shared Taxonomy Logic

Add/extend tests in:
- `tests/engine/MetaEngine.test.ts`
- `tests/engine/TagEngine.test.ts`

Planned test cases:
- [ ] `shared normalization contract`: same tag/category normalization outputs in both engines for a shared fixture matrix.
- [ ] `cross-engine consistency`: tag/category sets derived from identical post inputs are equivalent across engines.
- [ ] `event invariants preserved`: no change to emitted event names/payloads while shared helper is adopted.
- [ ] `file-persistence invariants`: persistence behavior remains engine-specific where intended (no accidental cross-responsibility).

### Phase 9 — Renderer Tag Event Subscription Dedup

Add tests in (new files expected):
- `tests/renderer/components/TagInput.test.tsx`
- `tests/renderer/components/TagsView.test.tsx`

Planned test cases:
- [ ] `subscribe on mount / unsubscribe on unmount`: helper registers and cleans up listeners exactly once.
- [ ] `TagInput refresh triggers`: relevant tag events trigger refresh/update behavior.
- [ ] `TagsView refresh triggers`: includes `tag:updated` path specific to view behavior.
- [ ] `duplicate listener prevention`: re-render does not leak or double-register listeners.

### Phase 10 — Local UI Block Dedup

Add tests in (new files expected):
- `tests/renderer/components/ProjectSelector.test.tsx`
- `tests/renderer/components/CredentialsPanel.test.tsx`
- `tests/renderer/components/AISuggestionsModal.test.tsx`
- `tests/renderer/App.test.tsx`

Planned test cases:
- [ ] `ProjectSelector repeated-branch parity`: same render/action outcomes for duplicated conditional blocks.
- [ ] `CredentialsPanel validation/render parity`: unchanged validation and submit enablement behavior.
- [ ] `AISuggestionsModal action parity`: unchanged accept/reject/apply flows.
- [ ] `App.tsx orchestration parity`: deduped local helper paths preserve top-level view switching and wiring behavior.

### Execution Order for Tests

1. Add phase-local failing tests first.
2. Refactor only that phase until tests pass.
3. Run targeted suite for touched area.
4. Run full suite: `npm test`.
5. Run full coverage: `npm run test:coverage`.
6. Run build: `npm run build`.

---

## Definition of Done (overall)

- All phases merged with passing tests/build at each step.
- No unresolved failing tests.
- Clone report shows meaningful reduction in production hotspots.
- Public behavior remains stable unless a change is explicitly approved.
