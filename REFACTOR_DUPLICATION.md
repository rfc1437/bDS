# Refactor Plan: Duplication Reduction

Date: 2026-02-15  
Scope: Reduce high-impact code duplication in production and test-adjacent areas while preserving behavior.

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

### Acceptance Criteria
- Single source of truth for `electronAPI` contract shape.
- No contract mismatch between preload and renderer types.
- Typecheck/build pass with no API regressions.

### Risks / Notes
- Ambient type import patterns in `.d.ts` files can be tricky; keep changes minimal and explicit.

---

## Phase 2 — Extract Common Tag Mutation Workflow

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

### Acceptance Criteria
- Public method behavior and events unchanged.
- Reduced duplicate blocks in `TagEngine`.
- Existing and new tests pass.

### Risks / Notes
- Must preserve task progress percentages/messages expected by UI.

---

## Phase 3 — Unify Single/Batch Post-Media Operations

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

### Acceptance Criteria
- No behavior regressions in link/unlink semantics.
- Event behavior preserved (`mediaLinked`/`mediaUnlinked` vs batch events).
- Duplicate logic materially reduced.

### Risks / Notes
- Preserve ordering and skip logic for already-linked media.

---

## Phase 4 — Consolidate Project Mapping and Guard Clauses

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

1. Phase 1 (API contract)
2. Phase 2 (TagEngine)
3. Phase 3 (PostMediaEngine)
4. Phase 4 (ProjectEngine)
5. Phase 5 (MetadataDiffEngine)
6. Phase 6 (Renderer utility)

Rationale: start with highest blast-radius drift risk, then engine-level duplication, then UI utility cleanup.

---

## Definition of Done (overall)

- All phases merged with passing tests/build at each step.
- No unresolved failing tests.
- Clone report shows meaningful reduction in production hotspots.
- Public behavior remains stable unless a change is explicitly approved.
