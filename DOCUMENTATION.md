# bDS User Documentation

This guide is written for end users who work in bDS day to day. It explains how to use the app effectively, how to avoid common data-loss mistakes, and how to collaborate safely with version control.

## Index

- [Who this is for](#who-this-is-for)
- [Basics](#basics)
- [Core workflow model](#core-workflow-model)
- [Getting oriented in the UI](#getting-oriented-in-the-ui)
- [Typical workflows](#typical-workflows)
- [Preferences and setup](#preferences-and-setup)
- [Git handling and sync workflow](#git-handling-and-sync-workflow)
- [Publishing (current stage)](#publishing-current-stage)
- [Working fully offline](#working-fully-offline)
- [Suggested team conventions](#suggested-team-conventions)
- [Document growth plan](#document-growth-plan)

## Who this is for

Use this guide if you want to:

- Write and manage posts and pages
- Work with photos and media metadata
- Organize content with tags, categories, and archives
- Set up projects and maintenance actions correctly
- Use Git to version and sync work with others
- Prepare for publishing (currently sitemap generation is available)

[↑ Back to Index](#index)

## Basics

Before jumping into workflows, it helps to understand what bDS is optimizing for.

bDS is a local-first writing workspace. You can create, edit, preview, publish, and version your content entirely on your machine. Collaboration and multi-device usage are handled through versioning (Git), not through immediate cloud dependency.

Three terms matter most:

- **Draft**: your in-progress editing state. Draft work is convenient, but it is not your long-term backup strategy.
- **Publish (inside bDS)**: marks your content as published in your local project state and files. This is still local.
- **Version (Git commit)**: creates a recoverable snapshot. This is the basis for reliable sync and collaboration.

Important implication: if your local database/storage fails, uncommitted draft-only work may not be recoverable. For that reason, the core best practice is:

1. Edit draft
2. Publish when content is ready
3. Commit to Git immediately after publish

This sequence gives you recoverable history and predictable synchronization with collaborators.

[↑ Back to Index](#index)

## Core workflow model

This chapter explains the operating model that all other chapters assume.

bDS follows an offline-first model:

- Writing/editing/previewing all work without internet
- Optional online integrations (AI, remote Git push/pull, future deployment targets)
- Local preview and local Git workflows always available

Think of bDS as your local source-of-truth workspace. Network features extend your workflow, but they do not replace local control.

[↑ Back to Index](#index)

## Getting oriented in the UI

This chapter explains where actions happen, so workflows are easier to follow.

### Main areas

- **Activity Bar (left icons):** switch between Posts, Pages, Media, Tags, AI, Import, Git, and Settings
- **Sidebar:** list/filter/navigation for the active section
- **Editor area:** tabbed workspace for posts, media, settings, imports, chat, diffs, and documentation
- **Bottom panel/status area:** progress and output for long-running tasks
- **Toasts:** short success/error feedback

### Tab behavior

- Single-click often opens a transient preview tab
- Double-click pins a tab for persistent work
- Open tabs are restored per project

> **System-specific note:** On macOS use `Cmd` shortcuts; on Windows/Linux use `Ctrl`.

[↑ Back to Index](#index)

---

## Typical workflows

This chapter focuses on realistic editing sessions rather than isolated actions.

### 1) Quickly post a link-style entry (short blog note)

Use this when you want to publish a short link note with brief commentary.

1. Open **Posts** in the Activity Bar.
2. Create a new post (`Cmd/Ctrl+N`).
3. Enter a concise title and short text.
4. Choose a short-form category (commonly `aside`).
5. Insert your external link (insert action or markdown syntax).
6. Add tags for discoverability.
7. Preview quickly and click **Publish**.
8. Open **Source Control** and commit the change.

Recommended commit pattern: “publish-ready content” in one commit so link notes are easy to audit later.

### 2) Write a full article with photos

Use this for long-form posts where structure, media, and metadata all matter.

1. Create/open the post.
2. Write in **WYSIWYG** or **Markdown** mode.
3. Add title, body, category, tags, and author metadata.
4. Import media (if needed) and insert images from the media library.
5. Review linked media and preview output.
6. Publish when ready.
7. Commit immediately after publishing.

Why this matters: publishing confirms content state locally; committing creates the recoverable version used for sync and collaboration.

### 3) Draft → publish → commit (recommended lifecycle)

This is the most important routine for reliable content operations.

1. **Draft phase:** write and refine content; autosave helps but do not treat draft-only state as final backup.
2. **Publish phase:** when content is ready, publish in bDS. This updates local published state.
3. **Version phase:** commit right away in Git with a meaningful message.
4. **Sync phase (optional):** push/pull when network is available.

If you skip step 3, you keep convenience but lose robust recoverability and team synchronization safety.

### 4) Add images to posts (media-first workflow)

1. Open **Media** view and import files.
2. Fill metadata (title, alt text, caption, tags).
3. Return to post and insert media from the library.
4. Preview and publish.
5. Commit the resulting post+media changes together.

Best practice: commit post and referenced media updates in the same commit so history remains coherent.

> **System-specific note:** file/folder pickers use native OS dialogs and selection behavior.

### 5) Create and manage pages separately from posts

1. Switch to **Pages**.
2. Create/edit page content with the same editor and preview flow.
3. Publish and commit with page-focused commit messages.

Pages often support navigation structures, so stable naming and clear commit messages are especially useful.

### 6) Find and organize content in larger projects

Use **Posts** and **Media** sidebar controls to narrow scope:

- archive filters by year/month
- tag/category filters
- status-based grouping

Use **Tags** for taxonomy maintenance (create/rename/merge/delete). When making major taxonomy changes, commit soon after to capture the state transition clearly.

### 7) Import from WordPress WXR

1. Open **Import** and create an import definition.
2. Set WXR file and uploads folder.
3. Run analysis and review conflicts/mappings.
4. Execute import and monitor progress.
5. Validate imported results, then commit.

Recommended approach: import iteratively (analyze → adjust mappings → re-run) instead of trying to resolve everything in one pass.

[↑ Back to Index](#index)

---

## Preferences and setup

This chapter explains configuration choices and why they matter operationally.

Open **Settings** from the gear icon in the Activity Bar.

### Project

Project settings define identity and publishing context:

- project name/description
- project data path
- public base URL (needed for sitemap)
- main language and default author
- max posts per page

Recommended first setup order:

1. Set identity (name/description).
2. Confirm data location strategy.
3. Set public URL.
4. Set language/author defaults.
5. Save settings.

### Editor

Set your default editing mode (`WYSIWYG`, `Markdown`, or `Preview`) based on your daily workflow. Teams may benefit from agreeing on a primary mode for consistency.

### Content

Define and maintain category conventions early. Stable category usage improves filtering, templates, and long-term content consistency.

### AI

AI is optional. If configured, it can assist with drafting and analysis. If not configured, all core writing, publishing, and versioning workflows remain fully functional.

### Publishing settings

FTP/SSH credential sections are preparation for broader publishing workflows. Configure them when your team is ready for deployment steps beyond local publishing.

### Data maintenance

Use rebuild actions when files changed externally or indices need reconciliation:

- Rebuild Posts Database
- Rebuild Media Database
- Rebuild Post Links

Treat these as repair tools, not routine daily actions.

[↑ Back to Index](#index)

---

## Git handling and sync workflow

This chapter covers the versioning model that makes collaboration and recovery reliable.

Open **Source Control** (Git icon in the Activity Bar).

### Git basics in bDS

- Publishing in bDS is local content state.
- Git commit is your recoverable version snapshot.
- Push/pull shares those snapshots with collaborators/remotes.

### Typical setup (new project)

1. Open Source Control.
2. Initialize Git if no repository exists.
3. Optionally set remote URL.
4. Verify branch/repository status.

### Typical daily sync cycle

1. Fetch remote updates.
2. Pull when needed.
3. Review changes.
4. Commit local work.
5. Push to remote.

### Best-practice commit rhythm for content work

- Commit after meaningful editing milestones.
- Always commit after publish actions.
- Keep commits focused (for example one article and its media updates together).
- Use descriptive commit messages (for example `publish: article on taxonomy workflow`).

### Recovery and cleanup actions

- Refresh/fetch if status appears stale.
- Use LFS prune tooling where applicable for large media history.

> **System-specific note:** Git must be installed and available in PATH.

Helpful external references:

- [Git official docs](https://git-scm.com/doc)
- [Pro Git Book](https://git-scm.com/book/en/v2)

[↑ Back to Index](#index)

---

## Publishing (current stage)

This chapter explains what publishing means today in bDS and what is planned next.

### Current scope

Currently available publishing output:

- sitemap generation from project metadata and content

### Generate sitemap now

1. Set **Settings → Project → Public Base URL**.
2. Run **Blog → Generate Sitemap**.
3. Wait for toast/task completion.
4. Verify generated `sitemap.xml` at the reported path.

If generation fails, confirm URL configuration first.

### Important publishing implication

Publishing in bDS currently represents local project publishing state. It does not by itself deploy to remote hosting. For shared workflows, commit published changes so the published state is versioned and transferable.

### Planned expansion

- broader static export pipeline
- expanded deployment workflows
- additional publishing controls in UI

[↑ Back to Index](#index)

---

## Working fully offline

This chapter summarizes a complete offline-safe routine.

1. Edit and refine drafts.
2. Preview locally.
3. Publish locally.
4. Commit locally in Git.
5. Continue work without network dependency.

When network is available, sync by pull/push as needed.

[↑ Back to Index](#index)

---

## Suggested team conventions

Shared conventions reduce confusion and merge friction. Teams should align on:

- category meanings
- tag naming rules
- publish checklist before commit
- commit message style

At minimum, define one non-negotiable rule: published content must be committed promptly.

[↑ Back to Index](#index)

---

## Document growth plan

This documentation is the baseline structure for future product growth. Extend each chapter as new capabilities are released, but keep the style user-centered: explain what to do, why it matters, and what risks to avoid.

[↑ Back to Index](#index)
