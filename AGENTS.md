# Agents Instructions for Blogging Desktop Server (bDS)

This document provides context and best practices for GitHub Copilot when working on this Electron + TypeScript + SQLite blogging application.

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.

## Commits

- our default branch is origin/master
- commit messages are short - one sentence. do not write long articles.
- pull requests are more verbose and especially give reasoning for changes

## Important facts

- published posts don't have body in the database, the body content is only in the file
- functionality you implement have to be tied to UI
- UI you implement has to be tied to functionality
- you must use drizzle to generate migrations and snapshots
- we use an sqlite database. use sqlite semantics in snapshots and other artifacts
- on MacOS we use native menus and you have to hook them into the intercept for new menu items
- there are two areas of localization, you sometimes need both (menus for example)
- all automatic AI activities must be gated by airplane (offline) mode of the app and either use the local model or inform the user via toast
- metadata needs to be flushed to the filesystem and needs to be included in metadata diff tool and in rebuild from filesystem. All three aspects have to be in sync with each other.
- if you add new metadata, add them to publishing, metadata-diff and rebuild-from-database
- HEREDOCs don't work most of the time. Don't use them. Use editor tools to create proper scripots

---

## ⚠️ MANDATORY: Test-First Development

**STOP!** Before writing ANY implementation code, you MUST:

1. **Write a failing test first** that describes the expected behavior
2. **Run the test** to confirm it fails (Red)
3. **Write minimal code** to make the test pass (Green)
4. **Refactor** while keeping tests green

> **No code without tests. No exceptions.**
>
> Tests must import and exercise the REAL implementation classes, not inline helper functions.
> Mock only external dependencies (database, filesystem), never the class under test.

---

## ⚠️ MANDATORY: Fix All Test Failures

**You MUST investigate and fix ALL test failures before completing any task.**

- Never leave tests failing, even if they appear unrelated to your changes
- If a test failure is pre-existing, fix it as part of your current work
- Run the full test suite (`npm test`) before considering any task complete
- If you cannot fix a test, explain why and propose a solution

> **Zero failing tests. No exceptions.**

---

## ⚠️ MANDATORY: Remove Unused Code

**Never keep unused code around. Always delete it completely.**

- When a feature is removed, delete ALL related code (implementation, tests, types, configs)
- Do NOT comment out code "for later" - use version control history
- Do NOT skip tests for removed functionality - delete them
- Do NOT leave dead code paths, unused imports, or orphaned functions
- When refactoring, actively look for and remove any code that becomes unused

> **Delete unused code immediately. No exceptions.**

---

## ⚠️ MANDATORY: Build Verification After Code Changes

**You MUST run the full build after making code changes.**

- Run `npm run build` after any code modifications
- Fix ALL build errors before considering the task complete
- Build errors indicate issues that may not be caught by `tsc --noEmit` alone (e.g., event forwarding, renderer build)
- The build must complete successfully before the task is complete

> **Successful build required. No exceptions.**

---

## ⚠️ MANDATORY: No External JS/CSS in Preview or Generated HTML

**Do not reference external JavaScript or CSS libraries (CDNs/remote URLs) from the preview server output or generated HTML.**

- Preview HTML must reference only local/package-bundled assets
- Generated HTML must not include CDN-hosted JS/CSS libraries
- If a library is needed (e.g., Pico CSS, Lightbox), include it as a local dependency and serve/reference it locally
- Avoid introducing any new `<script src="https://...">` or `<link href="https://...">` for library assets in preview/generated output

> **Preview and generated HTML must be self-contained with local assets. No exceptions.**

---

## ⚠️ MANDATORY: Proper I18N for UI and Rendering Text

**All user-facing text MUST follow proper i18n patterns.**

- Do not hardcode UI strings directly in React components, menu templates, dialogs, or toasts
- Store UI copy in language resources and resolve text through i18n helpers/hooks
- UI language MUST come from the operating system locale
- Rendering/preview/generated-content language MUST come from project preferences (`mainLanguage`), not UI locale
- Keep i18n usage consistent in both renderer UI and render/preview output
- For supported locales, translations MUST come from that locale file only; do not copy English terms into supported locale files as fallback
- English fallback is allowed only when the requested locale is unsupported by available locale files
- The project `mainLanguage` selector must expose exactly all supported render languages and no unsupported extras

> **No hardcoded user-facing text. No exceptions.**

---

## ⚠️ MANDATORY: Keep Python API Bindings and API Docs in Sync

**Whenever any app API is added, removed, or changed, you MUST update the Python API bridge and API documentation in the same change set.**

- Update the Python API contract/bindings used by embedded Pyodide (`bds_api`)
- Regenerate and commit `API.md`
- Ensure every API entry documents:
  - Parameter names, types, and required/optional status
  - Return type/response specification
  - At least one sample Python call
- Maintain a shared **Data Structures** section in `API.md` for canonical objects (for example `PostData`, `MediaData`) so users can see expected attributes in one place
- Keep docs sync tests passing (documentation and generator output must match)

> **No API contract drift between app APIs, Python bindings, and API.md. No exceptions.**

---

## Architecture Principles

### Separation of Concerns

1. **Engine Classes** (`src/main/engine/`): All business logic lives here
    - No UI code, no IPC code, no direct database or filesystem access
    - Methods should be pure functions where possible, with side effects (fs/db/events) abstracted behind interfaces  

2. **IPC Layer** (`src/main/ipc/`): Bridge between main and renderer
    - Handles all IPC communication, input validation, and error handling
    - Calls engine methods and forwards results/events to renderer
    - No business logic or UI code here

3. **UI Components** (`src/renderer/components/`): Presentation only
    - Components should be stateless where possible
    - Use Zustand store for shared state
    - Never call IPC directly from deeply nested components

## Security Reminders

- Never log sensitive data (auth tokens, passwords)
- Validate all IPC inputs before processing
- Use `contextIsolation: true` and `sandbox: false` only when necessary
- Store Dropbox auth tokens in secure storage, not in code
- Sanitize user input before rendering (XSS prevention)


<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
