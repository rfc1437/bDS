# Activity/Sidebar/Editor Behavior Migration Plan

## Goal
Create one shared behavior system for Activity Bar buttons, sidebar ownership, and editor/tab opening rules so all activities behave consistently by default.

## Scope
- Renderer only (`src/renderer/**`)
- Activity Bar button behavior
- Sidebar switching/ownership
- Editor panel opening via tabs
- Tab policy for singleton tools (settings/tags/style/docs/etc.)

## Non-goals
- Re-designing visuals
- Changing i18n copy beyond parity fixes
- Rewriting store architecture in one step

---

## Current Behavior Exceptions (as-is)

### A. Activity icon active-state exceptions
1. No known per-activity active-state exceptions in `ActivityBar`.
   - All activity icons now use `sidebar-owner` active behavior.

### B. Click behavior exceptions
1. No known per-activity click behavior exceptions in `ActivityBar`.
   - Activity buttons now follow one shared posts-style switch/toggle pattern.
2. Remaining coupling is in sidebar section navigation (`SettingsNav`/`TagsNav`) and is planned for unified section activation API migration.

### C. Sidebar content exceptions
1. **Posts/Pages** sidebars are mounted in wrappers with `display: none` when inactive.
2. **Media/Settings/Tags/Chat/Import/Git** sidebars are conditionally mounted.
3. **SettingsNav/TagsNav** perform section scrolling and can auto-open corresponding tabs before scroll.

### D. Editor content exceptions
1. Editor is primarily tab-driven for tool views (`settings`, `tags`, `chat`, `import`, etc.).
2. Sidebar ownership (`activeView`) and editor content (active tab) are intentionally decoupled.
3. Some menu commands open tabs directly without harmonizing sidebar ownership.

### E. API shape exceptions
1. Multiple places directly implement activity behavior logic instead of shared rules.
2. Open-tab semantics for singleton activities are duplicated across components.

---

## Decisions (confirmed)

1. **Active strategy is unified**
   - Keep only `sidebar-owner`.
   - Remove `sidebar-or-tab` special case.
   - Consequence: Settings icon is active only when Settings owns the visible sidebar.

2. **Click behavior is unified to Posts behavior**
   - All activity buttons follow the same switch/toggle sidebar logic pattern.
   - `import`, `settings`, and `tags` should not have unique click semantics.
   - If a view needs to open/ensure a tab, that responsibility moves outside button-click special cases (e.g., explicit nav/editor actions), not activity click branching.

3. **Sidebar/editor decoupling stays**
   - Sidebar owner (`activeView`) and editor content (active tab) remain intentionally independent.
   - Menu actions opening editors directly are valid and remain supported.

4. **Editor tab management should be centralized next**
   - Add shared tab policy/behavior layer to remove per-editor inconsistencies.

5. **API-shape exception outlook**
   - Most API-shape exceptions should disappear as behavior is centralized.
   - A few explicit policy descriptors will still remain (not exceptions): e.g., tab kind, transience defaults, singleton keys.

6. **Unified section activation API is required**
   - Introduce one shared section activation API for editor/tool views.
   - Sidebars should trigger section activation through that API instead of ad-hoc per-view scroll/open logic.

7. **Sidebar mounting strategy is Variant B (conditional mount)**
   - Mount only the currently active sidebar; unmount inactive sidebars.
   - Rationale: simplest and most consistent behavior model now.
   - Performance tuning can be revisited later if real bottlenecks appear.
   - Given expected limited content sizes, this is acceptable as default.

8. **Sidebar section actions always activate/open corresponding editor**
   - Clicking a sidebar section/navigation action must always ensure the matching editor tab is active.
   - If the editor tab is not open, it should be auto-opened first, then section activation should run.

---

## Proposed Target Architecture

## 1) Activity Registry (single source of truth)
A declarative registry describing each activity:
- `id`
- `sidebarView`
- `placement` (`top`/`bottom`)
- `labelKey` (i18n)
- `activeStrategy` (`sidebar-owner` only)
- `clickStrategy` (single unified strategy for all activity buttons)

## 2) Shared Activity Behavior Engine
Pure functions that compute:
- `isActivityActive(snapshot, activityId)`
- `getActivityClickActions(snapshot, activityId)`

No UI code inside this engine. Output is action descriptors consumed by UI components.

## 3) Reusable Render Adapters
- `ActivityBar` renders from registry + icon map
- `Sidebar` picks section from registry/sidebar view mapping
- Later: `Editor` tool-tab mapping can also be declared instead of chained conditionals

## 4) Shared Tab Policy Layer (new)
Pure tab-policy helpers that decide:
- singleton vs multi-instance
- transient vs pinned defaults
- promotion rules (transient -> pinned)
- when tab-open should happen from sidebar actions vs explicit editor/menu actions

---

## Sidebar Mounting Variants: Behavior Tradeoffs

### Variant A — Keep-mounted sidebars (hidden with CSS)
**How it works**: all sidebar components stay mounted; inactive ones are hidden.

**Benefits**
- Preserves in-component UI state (expanded sections, scroll position, local filters) without extra persistence code.
- Fast switching (no remount cost).

**Costs**
- Higher memory usage.
- More background effects/subscriptions unless each component guards itself.
- Risk of inactive sidebars still doing work.

### Variant B — Conditionally mounted sidebars (mount/unmount)
**How it works**: only current sidebar component is mounted.

**Benefits**
- Lower memory/CPU baseline.
- Clear lifecycle boundaries and fewer hidden side effects.
- Simpler mental model for ownership.

**Costs**
- Local UI state resets unless persisted explicitly.
- Potentially more reload work when switching back.

### Variant C — Hybrid (current)
**How it works**: some sidebars keep-mounted, others conditional.

**Benefits**
- Tactical optimization where needed.

**Costs**
- Inconsistent behavior and harder debugging.
- More “why is this one different?” maintenance overhead.

### Recommendation for consistency
- Pick **A** or **B** globally.
- If preserving local sidebar UI state is important, pick **A**.
- If simplicity + lower background work is the priority, pick **B**.
- Avoid **C** long-term.

---

## Phased Migration Plan

## Phase 0 — Baseline Contract Tests (safety net)
- Add behavior tests that lock target UX for all activities.
- Remove/replace tests that validate deprecated exceptions.
- Outcome: refactor-safe baseline.

## Phase 1 — Extract Activity Behavior Core (start here)
- [x] Add shared activity behavior module + typed activity registry for activity buttons.
- [x] Migrate `ActivityBar` to use shared behavior engine.
- [x] Keep visible behavior unchanged.
- [x] Add/adjust tests for helper + `ActivityBar` integration.

## Phase 1b — Enforce Unified Activity Rules (new)
- [x] Remove `sidebar-or-tab` from activity behavior.
- [x] Make settings active-state `sidebar-owner` only.
- [x] Unify click behavior for `import/settings/tags` to posts pattern.
- [x] Update/expand contract tests for unified activity behavior and `ActivityBar` integration.

## Phase 2 — Normalize Sidebar Mounting + Ownership Mapping
- [x] Introduce a sidebar view registry mapping in one place.
- [x] Pick one global mounting strategy (A or B) and apply to all sidebars.
- [x] Add explicit state persistence for remount-safe sidebar section UX where needed.
- [x] Introduce unified section activation API and migrate `SettingsNav`/`TagsNav` to use it.

## Phase 3 — Centralize Editor/Tab Management (expanded)
- [x] Implement shared tab policy layer for singleton tool tabs.
- [x] Centralize singleton tab policies (`settings`, `tags`, `style`, `documentation`, `metadata-diff`, `site-validation`).
- Centralize transient/pin lifecycle rules (including promotion behavior).
- Remove duplicated tab-open logic from sidebars/nav components where possible.
- [x] Ensure site-validation tab reopens with persisted last report and refreshes only on explicit validation trigger.

### Editor Tab Management Variations (current analysis)
1. **Singleton, pinned tool tabs**
   - `settings`, `tags`, `style`, `documentation` typically open as non-transient singleton tabs.
2. **Ephemeral/transient tabs with promotion**
   - Post/media browsing flows can open transient tabs that become pinned on explicit user action (double-click or pin).
3. **Multi-instance tool tabs**
   - `chat` and `import` create one tab per entity ID (conversation/definition), usually non-transient.
4. **Derived-ID utility tabs**
   - `git-diff` uses structured IDs (`git-diff:<resource>` / commit variants), with special title derivation.
5. **Menu-opened utility tabs**
   - `metadata-diff`, `site-validation`, and others are opened from menu commands with their own transience defaults.

### Standardization target for tab management
- One registry describing for each tab type:
  - `instanceMode`: `singleton | per-entity | per-resource`
  - `defaultTransient`: `true | false`
  - `promotable`: `true | false`
  - `idStrategy`: canonical ID normalization/resolution
  - `titleStrategy`: shared title resolver hooks

## Phase 4 — Editor Routing Registry
- Replace long `if/else` tab-type rendering chain with declarative tab->component mapping.
- Keep special cases explicit (e.g., tab ID transforms such as git-diff commit/file parsing).

## Phase 5 — Menu/Event Harmonization
- Route menu-driven view/tab actions through the same behavior layer where applicable.
- Reduce drift between keyboard/menu/toolbar interactions.

## Phase 6 — Cleanup + Exception Review
- Reassess every exception in this file and decide keep/remove.
- Remove dead paths and duplicate helpers.
- Update tests and docs.

---

## Decision Checklist (updated)
- [x] Remove `sidebar-or-tab`; use `sidebar-owner` only.
- [x] Unify activity click behavior to posts pattern for all activities.
- [x] Keep sidebar/editor decoupling.
- [x] Implement a unified section activation API for editor/tool sections.
- [x] Choose global sidebar mounting variant: **B conditional mount**.
- [x] Define sidebar action rule: section clicks always activate/open corresponding editor.
- [x] Migrate existing `SettingsNav`/`TagsNav` auto-open + delayed scroll to the unified section activation API that enforces this rule.

---

## Work Log
- [x] Documented migration strategy and current exception matrix.
- [x] Phase 1 slice complete: shared activity behavior extracted and wired into `ActivityBar`.
- [x] Decisions captured: unified active strategy, unified click behavior, editor/sidebar decoupling retained.
- [x] Decision captured: unified section activation API required.
- [x] Decision captured: sidebar mounting strategy Variant B (conditional mount).
- [x] Decision captured: sidebar section actions always activate/open corresponding editor.
- [x] Phase 1b complete: removed `sidebar-or-tab`, unified activity click behavior, and updated tests.
- [x] Added `Edit Preferences` menu item (`CmdOrCtrl+,`) to open preferences editor directly.
- [x] Phase 2 slice complete: added shared section activation API and migrated `SettingsNav`/`TagsNav`.
- [x] Phase 2 slice complete: normalized posts/pages sidebar rendering to Variant B conditional mount.
- [x] Phase 2 slice complete: introduced canonical sidebar view registry and applied it across navigation/store/sidebar mapping.
- [x] Phase 2 slice complete: persisted settings/tags active section selection for remount-safe UX.
- [x] Phase 3 slice complete: added singleton tab policy helper and migrated menu/sidebar singleton tool openings to it.
- [x] Phase 3 slice complete: site validation report is persisted per project and reloaded by `SiteValidationView`.
- [x] Phase 3 slice complete: site validation view refreshes via explicit `bds:site-validation-updated` event (no auto-validate on mount).
- [ ] Next implementation slice: Phase 3 continuation (centralize non-singleton tab lifecycle/promotion rules).
