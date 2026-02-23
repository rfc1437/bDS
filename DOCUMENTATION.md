# bDS User Guide

## In this article

- [Who this guide is for](#who-this-guide-is-for)
- [How bDS works](#how-bds-works)
- [Getting started](#getting-started)
- [Understanding the interface](#understanding-the-interface)
- [Working with posts](#working-with-posts)
- [Working with pages](#working-with-pages)
- [Working with media](#working-with-media)
- [Using macros](#using-macros)
- [Using scripting (early access)](#using-scripting-early-access)
- [Organizing with tags](#organizing-with-tags)
- [Importing from WordPress (WXR)](#importing-from-wordpress-wxr)
- [Using Git (Source Control)](#using-git-source-control)
- [Configuring settings](#configuring-settings)
- [Publishing in bDS (current scope)](#publishing-in-bds-current-scope)
- [Typical editorial workflows](#typical-editorial-workflows)
- [Working fully offline](#working-fully-offline)
- [Troubleshooting and recovery](#troubleshooting-and-recovery)
- [Team conventions](#team-conventions)

## Who this guide is for

This guide is written for people who use bDS day to day to create, edit, and manage blog content. It is intended for editors, content managers, and project owners who want clear guidance on what each part of the application does and how to use it safely. The focus is practical usage: what an element is, when it should be used, and how it fits into a reliable workflow.

If you are looking for implementation details, architecture notes, or development setup, use the project README. This document stays focused on end-user operation and editorial decisions.

### Key takeaways

- bDS documentation should help you make better day-to-day decisions, not just complete isolated clicks.
- Each chapter explains purpose first, then usage.
- Safe content handling and recoverability are central themes throughout this guide.

[↑ Back to In this article](#in-this-article)

---

## How bDS works

bDS is a local-first writing and publishing workspace. In practice, that means your core work does not depend on constant internet access. You can draft, revise, structure, preview, and publish content entirely on your local machine. Optional online features, such as remote Git synchronization or AI-assisted workflows, extend this model but do not replace it.

Understanding three terms is important for using bDS correctly. A draft is your in-progress state and is meant for active editing. Publishing in bDS marks a local content state as published inside your project. A Git commit creates a versioned snapshot that can be recovered, shared, and synchronized. These three states are related, but they are not the same operation.

The recommended sequence is simple: edit in draft, publish when the content is ready, and then commit immediately. This sequence is the safest way to protect work, collaborate with others, and keep project history understandable over time.

### Key takeaways

- bDS is designed for local reliability first.
- Publish and commit are different actions and both matter.
- The default safe lifecycle is: Draft → Publish → Commit.

[↑ Back to In this article](#in-this-article)

---

## Getting started

Before beginning editorial work, confirm that your project context is set correctly. Start by opening bDS and selecting the correct project. If this is a new project, create it and define its identity early, including project name and description. This helps keep exports, metadata, and team workflows aligned from the beginning.

Next, open Settings and verify the project data path. The data path determines where content and related files are stored, so it should reflect your backup strategy and how your team expects to work. You should also set the Public Base URL as soon as possible, because sitemap generation depends on it.

Finally, define language and author defaults. These defaults reduce repetitive editing work and keep output consistent across content created by multiple contributors.

### Key takeaways

- Set identity, data location, and Public Base URL at the beginning.
- Configure language and author defaults before regular editing starts.
- Early setup decisions reduce cleanup work later.

[↑ Back to In this article](#in-this-article)

---

## Understanding the interface

The bDS interface is organized to support content workflows rather than isolated forms. The Activity Bar on the left is your primary navigation between major areas such as Posts, Pages, Media, Tags, Import, Source Control, and Settings. The Sidebar changes based on the active area and helps with filtering, selection, and navigation. The Editor area is where most work happens and supports tabbed editing for content, configuration, and analysis views.

The bottom panel and status area are especially important during long operations such as imports, rebuild actions, or larger media tasks. They provide progress and completion feedback so you can verify that a task finished correctly. Toast messages provide short success or error confirmation and should be treated as quick status signals, not detailed logs.

Tab behavior is optimized for quick scanning and focused editing. Single-clicking often opens a transient tab, while double-clicking pins a tab for ongoing work. This pattern lets you inspect many items quickly while keeping active tasks stable.

### Key takeaways

- Use the Activity Bar for section-level context switching.
- Use the Sidebar for finding and narrowing content.
- Pin tabs when you are doing deeper editing work.

[↑ Back to In this article](#in-this-article)

---

## Working with posts

The Posts section is intended for chronological content such as articles, notes, and recurring updates. Choose Posts when publication timing, archive behavior, and regular update cycles are part of your content strategy. In most editorial teams, Posts represent the primary stream of outward-facing content.

A post usually combines several layers of information: title, body content, category, tags, and status. The title establishes the main topic. The body carries the full narrative or note. Categories provide broad structural grouping, while tags support more specific discovery and filtering. Status indicates lifecycle stage and should be used intentionally to avoid ambiguity in collaborative workflows.

A reliable post workflow starts by drafting content to completion, then reviewing structure and metadata, and finally previewing the output before publishing. After publishing, commit in Source Control immediately so the editorially approved state is recoverable and shareable.

### Key takeaways

- Use Posts for date-oriented, regularly updated content.
- Treat category and tags as distinct tools: broad grouping versus precise discovery.
- Publish only when editorially ready, then commit right away.

[↑ Back to In this article](#in-this-article)

---

## Working with pages

Pages are for durable, non-chronological content such as About, Contact, legal notices, and other structural information. Use Pages when content should remain stable in navigation and should not be interpreted as part of a time-based feed.

Because pages are often revisited over long periods, naming consistency matters. Keep titles and slugs predictable, and avoid unnecessary structural churn. If your project has navigation conventions, apply them consistently so contributors can find and update page content without guesswork.

The working pattern is similar to posts—draft, review, preview, publish, commit—but editorial intent is different. With pages, the emphasis is on clarity and long-term maintainability rather than release cadence.

### Key takeaways

- Use Pages for stable, structural content.
- Keep titles and slugs consistent for long-term maintainability.
- Apply the same safe lifecycle: Draft → Publish → Commit.

[↑ Back to In this article](#in-this-article)

---

## Working with media

The Media section is where you import, describe, and maintain assets used by posts and pages. It is not only a file list; it is also the place where accessibility and content quality are reinforced through metadata. In day-to-day work, media quality often determines whether published content feels complete and professional.

When importing media, add metadata immediately while context is still fresh. Alt text should describe image meaning for accessibility, captions should support reader understanding, and media tags should help with retrieval and reuse. The goal is to make media usable both now and later, including by teammates who did not import the asset.

After placing media in content, run a quick preview pass to confirm placement and context. When possible, commit post changes and their related media changes together. This keeps history coherent and makes future rollback or investigation much easier.

### Key takeaways

- Media management includes metadata quality, not only file import.
- Add alt text and captions during import, not as a postponed task.
- Commit content and related media in the same change when possible.

[↑ Back to In this article](#in-this-article)

---

## Using macros

Macros let you insert dynamic content blocks directly inside post/page Markdown by using `[[macro_name ...]]` syntax. bDS expands these macros during preview and generated output using local assets only.

Use macros when you need reusable rich blocks (for example embedded videos, media galleries, archive grids, or computed tag clouds) without writing raw HTML.

### YouTube macro

Use `[[youtube id="VIDEO_ID" title="Optional title"]]` when you want to embed a YouTube clip directly in a post or page. This macro is best for video references, walkthroughs, and embedded talks that should stay in the editorial flow instead of linking out to another tab.

The `id` parameter is required and should contain the YouTube video ID. The `title` parameter is optional, but recommended for accessibility because it becomes the reader-facing label for the embedded frame.

### Vimeo macro

Use `[[vimeo id="VIDEO_ID" title="Optional title"]]` for Vimeo-hosted video content. It behaves similarly to the YouTube macro, but targets Vimeo as the video source.

As with YouTube, `id` is required and `title` is optional. Use `title` whenever possible so screen-reader and assistive-technology users receive useful context.

### Gallery macro

Use `[[gallery columns="3" caption="Optional caption"]]` to render a lightbox-enabled media gallery from assets linked to the current post. This macro is appropriate when several related images belong together and should be browsed as one visual group.

The `columns` parameter controls layout density and accepts values from `1` to `6` (default is `3`). The optional `caption` parameter adds context above or below the gallery depending on theme presentation.

### Photo archive macro

Use `[[photo_archive year="2025" month="2"]]` when you want an archive-style grid based on media dates. This is useful for timeline-oriented projects where readers should navigate image collections by month or year.

Both `year` and `month` are optional. If `year` is omitted, bDS shows recent months. If `year` is provided without `month`, bDS presents the year scope. The legacy alias `[[photo_album ...]]` is still supported for compatibility.

### Tag cloud macro

Use `[[tag_cloud orientation="mixed_diagonal" width="900" height="420"]]` to visualize published tag usage as a weighted cloud. This macro is best for discovery pages, thematic overviews, and archive entry points where content density matters.

Word size scales with usage counts. Colors are theme-aware and distributed by quantity quantiles using eased interpolation so high-volume datasets stay readable. The color progression remains least-to-most (blue → green → yellow → orange → red), and clicking a word opens that tag archive route.

The optional `orientation` parameter supports `horizontal`, `mixed_hv`, and `mixed_diagonal`. The optional `width` and `height` parameters control canvas size and default to `900` and `420`.

### Key takeaways

- Macros are inserted directly in Markdown and expanded during preview/publish rendering.
- Use macro parameters to control behavior without leaving the editor.
- `tag_cloud` is data-driven and links directly into tag archive navigation.

[↑ Back to In this article](#in-this-article)

---

## Using scripting (early access)

The scripting feature is an incremental capability and should currently be treated as early access. Scripts are stored as Python files in the project filesystem, while script metadata is tracked in the project database and embedded in the file metadata docstring block. This keeps scripts portable and inspectable while still allowing reliable indexing in the app.

Each script exposes an **Entrypoint** selector. bDS always provides a synthetic `main` entrypoint. Selecting `main` runs the full script body as before. In addition, bDS inspects your script to list top-level Python function names, which can be selected as entrypoints for upcoming execution modes and integrations.

At this stage, scripting is intended for controlled project workflows where scripts interact with application-provided tools. Keep scripts versioned through your normal Git workflow, review changes carefully, and prefer small, explicit scripts over monolithic utility files.

For transform scripts, bDS provides a built-in Python helper named `toast(message)`. It accepts a single string and emits a UI intent that the app handles on the renderer side. This keeps script ergonomics simple while preserving a controlled bridge between script runtime and user interface.

When transform scripts fail during a pipeline run, bDS automatically surfaces an error toast so users are notified immediately. Detailed transform diagnostics (applied scripts and per-script errors) are also written to the Output panel.

### Example transform script

Use a transform function to modify incoming bookmark/blogmark content before bDS creates the post. The function receives a mutable `post` dictionary and should return that dictionary.

```python
def normalize_blogmark(post):
	# 1) Manipulate title
	title = (post.get("title") or "").strip()
	if title and not title.startswith("[Clipped]"):
		post["title"] = f"[Clipped] {title}"

	# 2) Manipulate text/content
	content = (post.get("content") or "").strip()
	prefix = "Imported from blogmark\n\n"
	if content and not content.startswith(prefix):
		post["content"] = prefix + content

	# 3) Set or replace categories
	post["categories"] = ["Inbox", "Research"]

	# 4) Add and normalize tags
	tags = post.get("tags") or []
	tags.append("blogmark")
	tags.append("clipped")
	post["tags"] = sorted({str(tag).strip().lower() for tag in tags if str(tag).strip()})

	# 5) Optional user notification
	toast(f"Transform applied: {post.get('title')}")
	return post
```

Notes:
- `title` and `content` are strings.
- `categories` and `tags` are string lists (e.g., `['News', 'AI']`).
- Return the mutated `post` dict from your transform function.
- Keep transforms small and deterministic, especially when multiple active transforms run in sequence.

### Key takeaways

- Scripting is available and intentionally evolving in small steps.
- `main` is always available and preserves whole-script execution behavior.
- Script files and metadata remain filesystem-friendly and Git-reviewable.
- Transform scripts can call `toast("...")` to send user-facing UI notifications.
- Transform scripts can directly manipulate `title`, `content`, `categories`, and `tags`.
- Transform pipeline failures always trigger automatic error toasts.

[↑ Back to In this article](#in-this-article)

---

## Organizing with tags

Tags are your precision taxonomy tool. Over time, even well-managed projects accumulate near-duplicate tags, naming inconsistencies, and labels that no longer serve users. The Tags section exists to keep taxonomy useful and prevent search and filtering quality from degrading.

Use this section to rename unclear tags, merge duplicates, remove obsolete labels, and establish naming consistency. These changes can have broad effects across content discovery, so they should be made deliberately and reviewed before publishing a large batch of edits.

After significant taxonomy cleanup, create a commit that captures the transition clearly. A focused commit message for tag work makes later troubleshooting and editorial audits much easier.

### Key takeaways

- Tags improve discovery only if naming stays consistent.
- Merge and rename operations should be deliberate and reviewed.
- Commit taxonomy changes in focused, understandable snapshots.

[↑ Back to In this article](#in-this-article)

---

## Importing from WordPress (WXR)

The Import section supports migration from WordPress exports and should be treated as a structured process rather than a one-click operation. A good migration flow reduces surprises by separating analysis from execution.

Begin by creating an import definition and selecting the WXR file and uploads folder. Run analysis first to inspect mappings, identify conflicts, and understand how source content aligns with your target structure. Adjust definitions as needed, then execute import only after the analysis view is acceptable.

For larger or older sites, prefer iterative passes. It is usually safer to analyze, adjust, and re-run than to force all decisions into a single import cycle. After import completes, validate representative content and media references before creating the commit that captures the migrated state.

### Key takeaways

- Treat WXR import as a staged workflow: analyze, adjust, execute.
- Iterative passes are safer than one large, rigid import attempt.
- Validate output before committing migrated content.

[↑ Back to In this article](#in-this-article)

---

## Using Git (Source Control)

Source Control in bDS is the foundation for reliable recovery and collaboration. Publishing marks local editorial state, but Git commits provide durable history. If your team works across devices or contributors, this distinction is essential.

In a normal day, synchronize first by fetching or pulling, then complete your editorial changes, publish when ready, and commit with a specific message. Push after the commit when you want to share the updated state with others. This rhythm keeps local and remote history aligned and reduces avoidable merge friction.

Commit messages should describe intent, not just activity. Messages such as “publish: interview article with media updates” or “tags: merge two overlapping taxonomy labels” are much more useful than generic phrases. Clear commits make collaboration and rollback safer.

### Key takeaways

- Git provides recoverable history; publishing alone does not.
- A stable daily rhythm is: sync first, edit, publish, commit, push.
- Specific commit messages improve teamwork and incident recovery.

[↑ Back to In this article](#in-this-article)

---

## Configuring settings

Settings define how your project behaves and should be treated as operational controls, not one-time preferences. Project settings establish identity, data location, and public URL context. Editor settings control default working mode and should match how your team writes and reviews content. Content settings support taxonomy consistency and reduce drift across contributors.

AI settings are optional. If configured, they can support drafting and analysis tasks, but core workflows remain fully functional without them. The key principle is that editorial reliability must never depend on optional integrations.

Data maintenance actions are repair tools for specific situations, such as external file changes or stale indexes. They are useful when state appears inconsistent, but they are not part of normal daily editing. Use them intentionally and verify outcomes after running each action.

### Key takeaways

- Settings influence long-term consistency across your whole project.
- Optional integrations should enhance, not define, your core workflow.
- Rebuild actions are corrective tools, not routine operations.

[↑ Back to In this article](#in-this-article)

---

## Publishing in bDS (current scope)

In the current product stage, publishing in bDS means marking local content state and generating supported local outputs, not automatically deploying to remote hosting. This distinction is important for planning release workflows and setting team expectations.

At present, the key publishing output is sitemap generation. To generate a sitemap successfully, ensure the Public Base URL is configured in project settings before running the sitemap command. If generation fails, URL configuration should be your first verification step.

Because publish does not equal deploy, Source Control remains the mechanism for versioned distribution and collaboration. Teams should treat publish plus commit as the minimum handoff standard.

### Key takeaways

- Current publish behavior is local-state focused.
- Sitemap generation depends on a valid Public Base URL.
- For team workflows, publish should be followed by commit.

[↑ Back to In this article](#in-this-article)

---

## Typical editorial workflows

A short link post workflow is appropriate when you want to share a reference quickly with brief commentary. In this case, the value comes from speed and clarity: create the post, add concise context, classify it appropriately, preview once, then publish and commit.

A long-form article workflow is better when argument structure, supporting media, and metadata quality matter. Draft the full narrative, import and describe media assets, review composition in preview, and then publish. Commit content and media together so the final state is recoverable as one coherent snapshot.

Across both patterns, the recommended lifecycle remains unchanged: draft carefully, publish intentionally, and commit immediately. This keeps editorial quality and operational safety aligned.

### Key takeaways

- Use lightweight workflow for short notes and links.
- Use full workflow for long-form content with media.
- Keep the same safety baseline in both cases: Draft → Publish → Commit.

[↑ Back to In this article](#in-this-article)

---

## Working fully offline

bDS is designed so your core work can continue without network access. You can create and revise content, manage metadata, preview locally, and publish in local project state while offline. This is especially useful for uninterrupted writing sessions and travel workflows.

Offline work is still safer when combined with local commits. Even without pushing to a remote, committing meaningful milestones gives you recovery points and reduces risk from accidental data loss.

When network access returns, synchronize in a controlled order: pull if needed, resolve differences, and push your committed updates.

### Key takeaways

- Core editing and publishing workflows work offline.
- Local commits remain important even when no remote is available.
- Synchronize carefully after reconnecting.

[↑ Back to In this article](#in-this-article)

---

## Troubleshooting and recovery

If content appears published locally but not visible to collaborators, the most common cause is that changes were published but not committed and pushed. In this case, confirm repository status, create a commit, and then push to the expected remote branch.

If content lists or references seem inconsistent after manual file operations outside bDS, run the rebuild tools in Settings to re-align database/index state with filesystem reality. After each rebuild, verify a small set of representative posts and media items rather than assuming full correctness immediately.

If you are concerned about losing work, increase commit frequency at meaningful milestones, especially after publish actions. Frequent, focused commits are the most reliable and practical recovery strategy for editorial teams.

### Key takeaways

- Most “missing remote content” issues are commit/push gaps.
- Rebuild tools help when external file changes desynchronize state.
- Frequent meaningful commits are the best safety net.

[↑ Back to In this article](#in-this-article)

---

## Team conventions

Shared conventions reduce ambiguity and merge friction. Teams should agree on category definitions, tag naming rules, publish-readiness criteria, and commit message patterns. These conventions do not need to be complex, but they should be explicit and documented where all contributors can find them.

A practical minimum rule is simple: any content considered published must be committed promptly. This one rule alone significantly improves recoverability, auditability, and collaborative reliability.

As your team matures, evolve conventions gradually based on real friction points rather than introducing many rules at once.

### Key takeaways

- Explicit conventions improve speed and reduce avoidable conflict.
- Start with a small rule set and enforce it consistently.
- Minimum standard: published content should be committed promptly.

[↑ Back to In this article](#in-this-article)
