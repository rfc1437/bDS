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
- [Using scripting](#using-scripting)
- [Using the AI assistant](#using-the-ai-assistant)
- [Organizing with tags](#organizing-with-tags)
- [Using blogmarks](#using-blogmarks)
- [Importing from WordPress (WXR)](#importing-from-wordpress-wxr)
- [Using Git (Source Control)](#using-git-source-control)
- [Configuring settings](#configuring-settings)
- [Checking and repairing metadata](#checking-and-repairing-metadata)
- [Managing templates](#managing-templates)
- [Generating and publishing](#generating-and-publishing)
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

## Using scripting

Scripts are Python files stored in your project's `scripts/` directory. Each file carries embedded YAML frontmatter in a docstring block at the top, which bDS uses to index the script in its database. This keeps scripts portable, Git-reviewable, and consistently tracked without a separate configuration file.

Each script has a **Kind** (macro, transform, or utility) and an **Entrypoint** that names the Python function to invoke. bDS inspects your script to list all top-level function names so you can choose which one to call. Keep scripts versioned through your normal Git workflow, review changes carefully, and prefer small, focused scripts.

### Transform scripts

Transform scripts run during blogmark import to modify incoming content before bDS creates the post. The entrypoint function receives a mutable `post` dict and must return it.

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

You can also accept an optional `context` argument that bDS passes when importing a blogmark:

```python
def normalize_blogmark(post, context=None):
    url = (context or {}).get("url", "")
    toast(f"Transform applied from: {url}")
    return post
```

`context` contains `source` (always `"blogmark"`) and `url` (the original bookmarked URL).

Notes:
- `title` and `content` are strings.
- `categories` and `tags` are string lists (e.g., `['News', 'AI']`).
- Return the mutated `post` dict from your transform function.
- `toast(message)` is a built-in available in transform scripts to send user-facing notifications.
- When a transform fails, bDS automatically surfaces an error toast and writes diagnostics to the Output panel.
- Keep transforms small and deterministic, especially when multiple active transforms run in sequence.

### Macro scripts

Macro scripts let you create custom `[[macro_name ...]]` blocks that expand during preview and page generation. Create a script with kind set to **macro** and pick a slug — the slug becomes the macro name used in Markdown.

The entrypoint function always receives two arguments:

```python
def render(context, post):
    params = context.get("params") or {}          # key-value pairs from [[slug key="value"]]
    env = context.get("env") or {}
    language = env.get("mainLanguage", "en")      # project render language (generation only)
    is_preview = env.get("isPreview", False)      # True when rendering in the editor preview

    title = (post or {}).get("title", "Unknown")
    custom_label = params.get("label", "")
    return {"html": f"<p>{title}: {custom_label} ({language})</p>"}
```

`context` is a dict with two keys:
- `params` — a dict of all key-value attributes from the macro tag. For example, `[[my_macro title="Hello"]]` gives `context["params"]["title"] == "Hello"`.
- `env` — a dict containing `isPreview` (bool). During generation it also includes `mainLanguage` (the project's render language code) and `hook` (the macro slug as written in Markdown).

`post` is the full PostData dict for the post containing the macro, or `None` when post data is unavailable. The function must return a dict with an `html` key containing the rendered HTML string.

#### Using the application API in macros

Macro scripts can call the application API through the `bds_api` module. Because API calls are asynchronous, the entrypoint must be an `async def`:

```python
from bds_api import bds

async def render(context, post):
    tags = await bds.posts.get_tags()
    items = "".join(f"<li>{t}</li>" for t in tags)
    return {"html": f"<ul>{items}</ul>"}
```

See [API.md](API.md) for the full reference of available `bds` module calls.

To use the macro in a post, write `[[your_slug param="value"]]` in Markdown. Built-in JS macros (youtube, vimeo, gallery, photo_archive, tag_cloud) always take priority over Python macros with the same slug.

### Key takeaways

- Script files and metadata are filesystem-friendly and Git-reviewable.
- Transform scripts mutate incoming blogmark `post` dicts before creation; `toast()` sends user notifications.
- Transform scripts can accept an optional `context` arg with `source` and `url` from the blogmark.
- Transform pipeline failures always trigger automatic error toasts.
- Macro entrypoints receive `(context, post)` — use `def render` for pure logic, `async def render` when calling `bds_api`.
- `context["params"]` holds macro tag attributes; `context["env"]` holds runtime metadata including `isPreview` and `mainLanguage`.
- Built-in JS macros always take priority over Python macros with the same slug.

[↑ Back to In this article](#in-this-article)

---

## Using the AI assistant

The AI assistant is built into bDS to help you manage your blog through natural conversation. You can ask it to search posts, analyze your content, update metadata, and visualize data. Instead of returning only plain text, the assistant can present results as rich interactive elements such as charts, tables, forms, and more.

The assistant works entirely with your local blog content. It does not have access to the internet or external services. When you ask a question, it uses your posts, media, tags, and categories to find answers and present them in the most useful format. In most cases the assistant automatically picks the right visualization for your request, but you can also ask for a specific format explicitly.

### Charts

The assistant can display bar, stacked-bar, line, area, pie, donut, and heatmap charts to help you spot patterns and trends in your blog data. Charts include a title, labeled data points, and a visual representation that makes it easy to compare values at a glance. Use stacked-bar charts when each bar has multiple segments, area charts for cumulative trends, donut charts for proportional breakdowns with a total in the center, and heatmap charts for matrix data where color intensity encodes value.

**Try asking:** "Show me a chart of posts published per month this year"

### Tables

When you need to compare posts side by side or see structured information, the assistant can render a table with columns and rows. Tables are useful for listings, comparisons, and any data that benefits from a grid layout.

**Try asking:** "Compare my last 10 posts showing title, status, and word count"

### Cards

Cards present a focused summary with a title, body text, and optional action buttons. The assistant uses cards when highlighting a specific item, making a recommendation, or presenting a result that you might want to act on.

**Try asking:** "Give me a summary card for my most recent draft post"

### Metrics

A metric is a single prominent number or value with a label. The assistant uses metrics when the answer to your question is one key figure, such as a count, a status, or a statistic.

**Try asking:** "How many draft posts do I have?"

### Lists

Lists display items as a simple bulleted enumeration. They work well for tag listings, next steps, checklists, and any result that is naturally a sequence of items.

**Try asking:** "List all tags that are used by fewer than 3 posts"

### Forms

When the assistant needs structured input from you, it can display an interactive form with text fields, checkboxes, dropdowns, and date pickers. Forms are typically used for metadata updates, multi-field edits, and configuration tasks where typing everything into a single message would be awkward.

**Try asking:** "Help me update the metadata for my post about React"

### Tabs

Tabs let the assistant organize multiple views into a single switchable interface. Each tab can contain any combination of text, charts, tables, metrics, and lists. Tabs are especially useful for multi-dimensional comparisons where you want to explore different slices of data without scrolling through a long response.

**Try asking:** "Show post statistics by year, with each year as a tab containing a chart of monthly post counts"

### Key takeaways

- The assistant picks the right visualization automatically based on your question.
- You can ask for a specific format by mentioning it in your prompt ("show as a chart", "put it in a table").
- Tabs can contain charts, tables, and other elements for rich multi-view displays.
- The assistant can only access your local blog content.

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

## Using blogmarks

Blogmarks provide a quick way to save links from any browser directly into bDS as new posts. bDS registers the custom `bds://new-post` protocol, so clicking a blogmark link or bookmarklet opens bDS and creates a draft post pre-filled with the page title, URL, and selected text.

To set up blogmarks, generate a bookmarklet from the Settings view and drag it to your browser bookmark bar. When you find a page worth saving, click the bookmarklet. bDS opens (or comes to the foreground) and creates a draft post automatically.

Transform scripts can modify incoming blogmark posts before they are created. This is useful for normalizing titles, adding default categories or tags, or restructuring content. If you have multiple active transforms, they run in sequence. When a transform fails, bDS surfaces an error toast and writes diagnostics to the Output panel so you can adjust and retry.

Transform scripts can also receive a `context` argument containing `source` (always `"blogmark"`) and `url` (the original bookmarked URL), which is helpful for URL-based routing or domain-specific formatting.

### Key takeaways

- Blogmarks turn any browser into a one-click content capture tool.
- Generate the bookmarklet from Settings and add it to your browser bar.
- Use transform scripts to normalize or enrich incoming posts automatically.

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

## Checking and repairing metadata

Over time, metadata stored in the database and metadata stored in post files on disk can drift apart. This happens when files are edited outside bDS, when slugs change, or when manual file operations move or rename content. The Metadata Diff tool detects these inconsistencies and lets you resolve them without rebuilding the entire posts table.

### Opening the tool

Open **Settings**, then click **Metadata Diff** under the data maintenance section. The tool shows summary statistics for your project (total posts, published, drafts, media, scripts, templates) and a **Scan** button.

### Running a scan

Click **Scan** to compare every published entity against its corresponding file on disk. The scan covers four entity types — posts, media, scripts, and templates — and runs them in parallel. Results appear in four tabs, each showing a badge with the number of items that have differences.

For each item with differences, the tool shows every mismatched field side by side: the database value and the file value. Typical fields include title, tags, categories, excerpt, author, and language.

### Understanding field pills

Above the item list, clickable field pills summarize how many items have a particular type of difference (for example, "Tags: 12" or "Title: 3"). Clicking a pill filters the list to show only items with that specific field difference, which helps when resolving one type of issue at a time.

### Repairing differences

Each field pill has two sync buttons:

- **DB→D** updates the files on disk to match the database values. Use this when you trust the database as the source of truth — for example, after correcting metadata in the editor.
- **D→DB** (called F→DB for some entity types) updates the database to match the file values. Use this when you trust the files — for example, after editing frontmatter by hand or importing corrected files from a collaborator.

Both operations process all affected items for that field at once. After syncing, the tool automatically rescans to confirm the differences are resolved.

### File-missing posts

If a post exists in the database but its file is missing from disk, the item appears with a **File missing** badge. All fields show the database value against "(file missing)" on the file side. Using **DB→D** on these items recreates the file from the database content and metadata. If the post's slug changed since the file was originally written, the recreated file uses the current slug and the database file path is updated to match.

### Orphan files

If markdown files exist in the posts directory but have no matching database entry, they appear in the **Orphan Files** section below the item list. These typically result from slug changes, manual file copies, or partial imports.

Each orphan card shows the file's slug, path, and any frontmatter ID found in the file. To bring all orphan files back into the database, click the **D→DB** button in the orphan section header. This reads each file's frontmatter and content, creates a new database entry as a published post, and assigns a unique slug if the original slug conflicts with an existing post. The tool rescans automatically afterward.

### When to use this tool

- After editing post files outside bDS (text editor, script, Git merge)
- After a Git pull that changed post files from another contributor
- When the sidebar shows unexpected titles, tags, or categories
- When you suspect slug changes left behind stale files
- As a preflight check before generating or publishing the site

This tool is not needed during normal editing workflows inside bDS, where database and file state are kept in sync automatically.

### Key takeaways

- Metadata Diff compares database records against files on disk for posts, media, scripts, and templates.
- Field pills let you filter and bulk-repair one type of difference at a time.
- DB→D rewrites files from the database; D→DB updates the database from files.
- File-missing posts can be recreated; orphan files can be imported.
- Use this tool after external changes, not as part of routine editing.

[↑ Back to In this article](#in-this-article)

---

## Managing templates

Templates control the Liquid layout used when bDS generates your blog's HTML pages. bDS ships with built-in templates, but you can create and manage your own through the Templates view in the Activity Bar.

Each template has a kind that determines where it is used: **post** templates render individual post pages, **list** templates render archive and index pages, **not-found** templates render 404 pages, and **partial** templates are reusable fragments included by other templates. You edit template code using the built-in Monaco editor, which provides syntax highlighting for Liquid and HTML.

Templates are stored as files with YAML frontmatter in your project's data directory, which means they are Git-friendly and portable between machines. bDS validates template syntax when you save, reporting any Liquid parse errors before the template can be used in generation.

Templates follow the same draft/published workflow as scripts. You can iterate on a template in draft state, preview the results, and then enable it for generation when satisfied. If your project uses Git, bDS reconciles template files with the database on sync so that templates added or modified externally are picked up automatically.

### Key takeaways

- Templates define the HTML layout for generated pages.
- Four template kinds: post, list, not-found, and partial.
- Templates are files with YAML frontmatter — Git-reviewable and portable.
- Validate before enabling; preview before generating.

[↑ Back to In this article](#in-this-article)

---

## Generating and publishing

Publishing in bDS is a two-stage process: first you generate the static site locally, then you optionally deploy it to a remote server.

### Full generation

**Generation** produces a complete static blog from your published content. This includes individual post pages, paginated category, tag, and date archive routes, standalone pages, plus `sitemap.xml`, `rss.xml`, `atom.xml`, and `calendar.json`. Generation uses content-hash-based incremental writes, so only pages whose content actually changed are rewritten on disk. Before generating, ensure the Public Base URL is configured in project settings — sitemap and feed URLs depend on it.

Full generation is appropriate when you first set up your site, after major template changes, or when you want a clean rebuild. For day-to-day content additions, site validation offers a faster alternative.

### Site validation and incremental publishing

After generating a site at least once, you can use **site validation** to detect what changed and re-render only the affected routes — without regenerating the entire site.

Click **Validate Site** to run a comparison between the sitemap and the generated HTML directory. Validation detects three types of issues:

- **Missing pages** — URLs listed in the sitemap that have no corresponding HTML file. This happens when you publish new posts or add new tags/categories since the last generation.
- **Extra pages** — HTML files that exist on disk but are no longer in the sitemap. This happens when you unpublish, delete, or recategorize posts.
- **Updated posts** — Posts whose source file on disk has been modified since its HTML page was last generated. This catches content edits, tag changes, or metadata updates that require the page to be re-rendered.

After validation completes, click **Apply** to let bDS resolve all detected issues automatically. Missing and updated pages are re-rendered using the current templates, and extra pages are deleted along with any empty parent directories. The apply step uses targeted rendering — it identifies exactly which individual posts, archive pages, category routes, tag routes, and date routes are affected, and re-renders only those. If the affected routes span too many sections, it falls back to a section-by-section render which is still faster than a full generation.

This makes site validation the practical tool for incremental publishing. The typical workflow after creating or editing a few posts is:

1. Publish the posts (mark as published in the editor)
2. Click **Validate Site** to see what needs updating
3. Click **Apply** to re-render only the affected pages
4. Commit the changes in Source Control
5. Deploy via SSH when ready

This is significantly faster than full generation, especially for large blogs with hundreds or thousands of posts.

### SSH publishing

**SSH publishing** uploads generated files to a remote server via `scp` or `rsync`. Configure your SSH connection details in project settings, then publish from the application. bDS uploads HTML, thumbnails, and media in parallel for efficiency.

The recommended lifecycle is: publish content locally (mark as published), generate or validate+apply, commit the generated output, and then deploy via SSH when ready.

### Key takeaways

- Full generation produces a complete static site; use it for initial builds or major changes.
- Site validation detects missing, extra, and updated pages by comparing the sitemap to generated HTML.
- Apply resolves all validation issues by targeted re-rendering — much faster than full generation.
- Use validate+apply as the standard incremental publishing workflow after creating or editing posts.
- SSH publishing deploys via `scp` or `rsync` with parallel uploads.
- Public Base URL must be set before generation.
- Commit generated output before deploying for recoverability.

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

If content lists or references seem inconsistent after manual file operations outside bDS, start with a **Metadata Diff scan** in Settings to identify specific differences between database and file state. Repair individual fields or bulk-sync as needed. If broader inconsistency remains, use the full rebuild tools to re-align database and index state with filesystem reality. After any repair action, verify a small set of representative posts and media items rather than assuming full correctness immediately.

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
