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

