# IMPLEMENT_GIT

## Goal
Implement a VS Code-like Git sidebar workflow for the current project in bDS with:
- Left sidebar rail sync icon (bottom section, directly above Settings)
- Sidebar split into upper **Open Changes** and lower **Version History**
- File click to open diff view against repository in editor tabs with transient/persistent behavior
- `Initialize Git` action when no repo exists
- Periodic status polling and remote fetch polling
- Fetch / Pull / Push actions in repo header
- Commit message input + `Commit` button (add-all + commit)

This plan is scoped to the existing Electron architecture:
- Main process business logic in `src/main/engine`
- IPC handlers in `src/main/ipc`
- Typed bridge in `src/main/preload.ts` and `src/main/shared/electronApi`
- Renderer state/UI in `src/renderer/store` and `src/renderer/components`

---

## External Requirements

## 1) Runtime Dependencies
- **Primary library**: `simple-git`
- **System requirement**: `git` CLI installed and available in PATH
- **System requirement**: `git-lfs` CLI installed and available in PATH
- **Optional later**: fallback to bundled Git binary for users without system Git

## 2) OS / Packaging
- Support macOS, Linux, Windows path handling and quoting.
- If bundling Git later, include signing/notarization and license notices in release pipeline.

## 3) Performance Requirements
- Must handle large change sets without list jump/reflow issues.
- Polling and fetch operations must be background/non-blocking and cancellable.

## 4) Security Requirements
- Run all Git commands in main process only.
- Validate project root path before command execution.
- Never allow arbitrary command injection via renderer inputs.

---

## UX and Behavioral Requirements (from spec)

## Sidebar Rail Button
- Add a new Git sync icon button in the left sidebar rail bottom section, directly above the Settings icon.
- Clicking icon opens/closes Git sidebar view similarly to existing views.

## Sidebar Layout (Git view)
- Upper half: **Open Changes** list.
- Lower half: **Version History** list.
- Repo actions in header: **Fetch**, **Pull**, **Push** icons.
- Open Changes area includes:
  - Commit message input field
  - Commit button (does add-all + commit)

## No Repository State
- If current project is not a git repo:
  - show `Initialize Git` button.
  - action runs `git init`, then enables Git LFS and tracks image file types (e.g. `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.svg`, `*.avif`, `*.heic`) so binary image assets are excluded from normal Git object/version storage.
  - if git executable not found, show explicit install guidance message.
  - if Git LFS executable not found, show explicit install guidance message and block completion of initialization.

## Diff Behavior
- Diff views open in tabs in the editor area.
- Single-click on a changed file opens a diff in a transient tab (reused for subsequent single-clicks), matching post transient tab behavior.
- Double-click on a changed file opens a dedicated non-transient diff tab that remains open until explicitly closed by the user.
- Dedicated diff tabs stay open even when other files are clicked in the sidebar.
- Open diff tabs are persisted in app tab state and restored on next app start, same persistence model as post tabs.
- Clicking a changed file opens diff view of working tree vs repository (HEAD/index depending file state).
- Committing changes automatically closes all open diff tabs because the compared diff baseline no longer applies.

## Polling Behavior
- Poll git status regularly (VS Code-like freshness).
- Refresh should be incremental (preserve list item identity/order strategy where possible).
- Preserve scroll position for large lists; avoid jump-to-top.

## Remote Awareness
- If remote exists, perform regular `git fetch` polling.
- Show upstream relationship in version history section:
  - current local HEAD
  - upstream branch tip
  - ahead/behind indicators

---

## Proposed Architecture

## Main Process (new engine)
Create `src/main/engine/GitEngine.ts` with focused methods:
- `checkAvailability(): Promise<{ gitFound: boolean; version?: string }>`
- `getRepoState(projectPath): Promise<RepoState>`
- `initializeRepo(projectPath): Promise<Result>`
- `getStatus(projectPath): Promise<GitStatusDto>`
- `getDiff(projectPath, filePath): Promise<GitDiffDto>`
- `getHistory(projectPath, limit, cursor?): Promise<HistoryDto>`
- `getRemoteState(projectPath): Promise<RemoteStateDto>`
- `fetch(projectPath): Promise<Result>`
- `pull(projectPath): Promise<Result>`
- `push(projectPath): Promise<Result>`
- `commitAll(projectPath, message): Promise<Result>`

Implementation notes:
- Use `simple-git` instance rooted at active project path.
- Distinguish error classes:
  - git missing
  - not a repo
  - auth/network/merge conflict
  - detached HEAD / no upstream
- Normalize file paths to repo-relative format for renderer stability.

## IPC Layer
Add handlers in `src/main/ipc/handlers.ts` and type contracts in shared API:
- `git:checkAvailability`
- `git:getRepoState`
- `git:init`
- `git:status`
- `git:diff`
- `git:history`
- `git:remoteState`
- `git:fetch`
- `git:pull`
- `git:push`
- `git:commitAll`

Expose via `src/main/preload.ts`:
- `window.electronAPI.git.*` methods.

## Renderer State
Extend `src/renderer/store/appStore.ts` with Git slice:
- `activeView` union includes `'git'`
- `git: {`
  - `availability`
  - `repoState`
  - `status` (files + counts)
  - `history`
  - `remoteState` (branch, upstream, ahead, behind, lastFetchAt)
  - `selectedDiffFile`
  - `commitMessage`
  - `loading/action flags`
  - `error`
- `}`

Store actions:
- `setGitStatus`, `mergeGitStatusIncremental`, `setGitHistory`, `setGitRemoteState`
- `setSelectedDiffFile`, `setCommitMessage`
- `setGitPollingState`

Tab behavior extensions:
- Extend `TabType` with `'git-diff'`.
- Use existing transient tab mechanics for single-click diff open.
- Add/ensure explicit pinning path for double-click diff tabs (`isTransient: false`).
- Include diff tabs in persisted tab state (`getTabState` / `restoreTabState`) so they reopen after restart.
- On successful commit action, remove all open `'git-diff'` tabs and clear selected diff state.

## Renderer Components
- Update `src/renderer/components/ActivityBar/ActivityBar.tsx` to place Git icon in the bottom rail group above Settings and wire view toggle.
- Add Git section to `src/renderer/components/Sidebar/Sidebar.tsx` render switch.
- Add dedicated presentational components:
  - `src/renderer/components/GitSidebar/GitSidebar.tsx`
  - `src/renderer/components/GitSidebar/OpenChangesList.tsx`
  - `src/renderer/components/GitSidebar/VersionHistoryList.tsx`
  - `src/renderer/components/GitSidebar/RepoActions.tsx`
- Add diff tab rendering in editor area:
  - new tab type `'git-diff'`
  - diff viewer component `GitDiffView`.
  - single-click handler opens/reuses transient diff tab.
  - double-click handler opens persistent diff tab.

---

## Polling and Update Strategy

## Status Polling (fast)
- Interval: ~2s when Git view visible, ~5–10s when hidden.
- Trigger immediate refresh after commit/fetch/pull/push/init.
- Use in-flight guard to avoid concurrent status calls.

## Remote Polling (slower)
- Run only when remote exists and git is available.
- Interval: ~30–60s with backoff on errors.
- Use `git fetch --prune` equivalent through `simple-git`.

## Scroll/Render Stability
- Keep stable `key` = repo-relative file path.
- Preserve existing array reference for unchanged items when merging updates.
- Update only changed/added/removed entries in store (incremental diff merge).
- Use virtualization (`react-window`) if list grows beyond threshold (e.g., >300 entries).
- Preserve scrollTop by storing/restoring container position if full list replacement is unavoidable.

## Repositioning Rules
- Do not auto-sort on every tick if sort key not changed.
- Insert new items predictably (status-group + path order) to minimize movement.
- Never auto-scroll on status update.

---

## History Model (lower half)

Each history item should include:
- `commitHash`
- `author`
- `date`
- `subject`
- `isHead`
- `isRemoteHead` (where applicable)
- `refs` (branch/tag labels)

Remote awareness section:
- Show `localBranch -> upstreamBranch`
- Show `ahead N / behind M`
- Show last fetch timestamp and fetch errors (if any)

---

## Error Handling UX

## Git Missing
- Detect once on startup/opening Git view and before actions.
- Display clear CTA text: install Git and restart app.

## Not a Repo
- Show empty state with `Initialize Git` button.
- After successful init, auto-refresh status/history.

## Action Failures
- Show concise toast + inline error in Git panel section.
- Keep previous state rendered (no hard reset).

## Auth/Conflict Cases
- For pull/push conflicts/auth failures, show actionable message; do not hide current status/history.

---

## Test-First Delivery Plan (TDD)

Follow strict red-green-refactor per project rules.

## Phase 1: Contracts and engine scaffolding
1. Add failing tests for `GitEngine` availability/repo detection/status parsing.
2. Implement minimal engine methods.
3. Add IPC contract tests for new `git:*` handlers.

## Phase 2: No-repo + init workflow
1. Add renderer tests for no-repo state and `Initialize Git` button.
2. Implement init action and git-missing messaging.
3. Validate with integration-style IPC mock tests.

## Phase 3: Open changes + diff
1. Add tests for open changes list rendering and file selection.
2. Add tests for opening `git-diff` tab and loading diff.
3. Add tests for single-click transient tab reuse and double-click persistent tab behavior.
4. Implement diff component and tab behavior.

## Phase 3b: Diff tab persistence and commit cleanup
1. Add tests to verify `git-diff` tabs are persisted/restored via tab state.
2. Add tests to verify successful commit closes all open `git-diff` tabs.
3. Implement store and commit-flow wiring for cleanup behavior.

## Phase 4: Commit + repo actions
1. Add tests for commit message entry and commit action (`addAll + commit`).
2. Add tests for fetch/pull/push button wiring and disabled/loading states.
3. Implement action handlers with refresh chaining.

## Phase 5: Polling and stability
1. Add tests for polling intervals and in-flight guards (fake timers).
2. Add tests for incremental list updates preserving scroll/identity.
3. Implement merge strategy + optional virtualization threshold.

## Phase 6: Remote tracking in history
1. Add tests for ahead/behind and upstream marker rendering.
2. Implement periodic fetch + remote state projection.
3. Validate remote indicators against mocked git responses.

## Phase 7: Hardening
1. Add tests for error surfaces (git missing, auth fail, merge conflict).
2. Verify all tests pass.
3. Run full build and fix regressions.

---

## Suggested File-Level Work Breakdown

Main process:
- `src/main/engine/GitEngine.ts` (new)
- `src/main/engine/index.ts` (export)
- `src/main/ipc/handlers.ts` (new handlers)
- `src/main/shared/electronApi.ts` (API types)
- `src/main/preload.ts` (bridge methods)

Renderer:
- `src/renderer/store/appStore.ts` (Git state/actions)
- `src/renderer/components/ActivityBar/ActivityBar.tsx` (Git icon entry in bottom rail, above Settings)
- `src/renderer/components/Sidebar/Sidebar.tsx` (Git view integration)
- `src/renderer/components/GitSidebar/*` (new)
- `src/renderer/components/Editor/*` or new `GitDiffView` component

Tests:
- `tests/engine/GitEngine.test.ts` (new)
- `tests/ipc/handlers.test.ts` (extend)
- `tests/renderer/components/GitSidebar.test.tsx` (new)
- `tests/renderer/store/appStore.git.test.ts` (new)

---

## Milestones and Acceptance Criteria

## Milestone A: Basic Git UX
- Git sync icon appears in left sidebar rail bottom section above Settings.
- Git sidebar opens with no-repo empty state.
- `Initialize Git` works and transitions to repo state.

## Milestone B: Changes + Diff
- Open Changes list renders tracked/untracked/modified/deleted files.
- Single-click opens/reuses transient diff tab and renders correct patch.
- Double-click opens persistent diff tab that remains until user closes it.
- Diff tabs persist across app restarts.

## Milestone C: Commit and Repo Actions
- Commit message + Commit button performs add-all + commit.
- Successful commit closes all open diff tabs automatically.
- Fetch/Pull/Push actions execute with visible status feedback.

## Milestone D: Polling + Remote
- Status polling updates changes without scroll jump.
- Remote fetch polling updates ahead/behind and remote markers.
- History clearly shows local/remote relation.

## Milestone E: Quality Gate
- All tests pass.
- Full build passes.
- No console spam, no renderer freeze on large change sets.

---

## Implementation Order Recommendation
1. Contracts + GitEngine + IPC
2. No-repo/init UX
3. Open changes list + diff viewer
4. Commit + fetch/pull/push actions
5. Polling + incremental list merge + scroll stability
6. Remote-aware history refinement and hardening

This order minimizes risk and delivers user-visible value early while preserving room for performance optimization in later iterations.
