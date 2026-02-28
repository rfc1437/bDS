# bDS — Remaining Feature Work

This document covers the features described in VISION.md that are not yet
implemented. Each section is a self-contained plan that can be picked up
independently.

---

## ~~1. Template Editor & Per-Entity Template Selection~~ ✅ Done

### Goal

Users can create, edit, and manage Liquid templates inside the application.
Categories, tags, and individual posts can select which template to use for
rendering. The bundled templates serve as defaults; user templates override them.

### Current State

- Liquid templates are bundled in `src/main/engine/templates/` (3 templates +
  partials + macros).
- `PageRenderer` resolves templates from fixed directory roots.
- No user-editable templates, no template CRUD, no per-entity template
  selection.
- The `ScriptEngine` + `ScriptsView` combination already implements the exact
  pattern needed (file-based storage with YAML metadata, Monaco editor, CRUD,
  database index, file sync).

### Implementation Plan

#### 1.1 Database Schema

Add a `templates` table to `schema.ts`:

| Column      | Type    | Notes                                        |
|-------------|---------|----------------------------------------------|
| id          | text PK | UUID                                         |
| projectId   | text FK | References projects                          |
| slug        | text    | Unique per project                           |
| title       | text    | Display name                                 |
| kind        | text    | `'post'`, `'list'`, `'not-found'`, `'partial'` |
| filePath    | text    | Relative path within project `templates/` dir |
| enabled     | integer | 0/1 — disabled templates fall back to built-in |
| version     | integer | Incremented on each save                     |
| createdAt   | integer | Timestamp                                    |
| updatedAt   | integer | Timestamp                                    |

Add template selection fields:

- `CategoryMetadata`: add optional `postTemplateSlug` and `listTemplateSlug`
  fields (stored in `meta/project.json`).
- Posts table: add optional `templateSlug` column for per-post overrides.
- Tags table: add optional `postTemplateSlug` column for tag-level overrides.

#### 1.2 Engine Class — `TemplateEngine`

Follow the `ScriptEngine` pattern exactly:

- `createTemplate(input)` — write `.liquid` file with YAML frontmatter +
  database entry.
- `updateTemplate(id, updates)` — update file + database, increment version.
- `deleteTemplate(id)` — remove file + database entry.
- `getTemplate(id)` / `getAllTemplates()` — read from database, load content
  from file.
- `rebuildDatabaseFromFiles()` — scan `templates/` directory, rebuild database
  from file metadata.
- `reconcileTemplatesFromGitChanges()` — sync database after git operations.
- `validateTemplate(content)` — attempt Liquid parse, return errors.

Store templates as `.liquid` files in the project's `templates/` directory with
YAML frontmatter:

```liquid
---
id: <uuid>
projectId: <uuid>
slug: custom-post
title: Custom Post Layout
kind: post
enabled: true
version: 3
---
<main>
  <article>{{ post.content | markdown }}</article>
</main>
```

#### 1.3 Template Resolution in PageRenderer

Modify `PageRenderer` to resolve templates with priority:

1. Post-specific template override (`posts.templateSlug`)
2. Tag-level template override (first matching tag with a `postTemplateSlug`)
3. Category-level template override (`CategoryMetadata.postTemplateSlug`)
4. Built-in default template

Add the project's `templates/` directory to `resolvePageRendererTemplateRoots()`
so Liquid's `{% render %}` can find user partials.

#### 1.4 IPC Handlers

Register in `handlers.ts`:

- `templates:create`, `templates:update`, `templates:delete`
- `templates:get`, `templates:getAll`
- `templates:validate`

Expose in `preload.ts` and update `electronApi.ts` types.

#### 1.5 UI — `TemplateEditorView`

Mirror `ScriptsView`:

- Sidebar activity: add "Templates" icon to ActivityBar.
- Sidebar list: show all templates grouped by kind, with enabled/disabled
  state.
- Tab content: Monaco editor with `liquid` or `html` language mode.
- Metadata fields: title, slug, kind dropdown, enabled toggle.
- Actions: save (Ctrl+S), validate syntax, delete.
- Footer: created/updated timestamps.

#### 1.6 Template Assignment UI

In `SettingsView`, extend the category metadata section:

- Add "Post Template" and "List Template" dropdowns per category, populated
  from user templates of matching kind.

In the post editor metadata area:

- Add optional "Template Override" dropdown (only shows user templates of kind
  `post`).

#### 1.7 Starter Templates

On project creation, copy the bundled templates into the project's `templates/`
directory so users have a working starting point they can modify.

---

## 2. Post Translation System

### Goal

Posts have a language attribute. The AI importing agent detects post language
and can auto-translate posts. Posts link to their translations so the
publishing pipeline can generate multilingual output.

### Current State

- Posts have no `language` field.
- No translation relationship tracking.
- No language detection during import.
- No AI translation tools.
- The `excerpt` field already exists and can serve as the summary field
  mentioned in the vision.
- `analyzeMediaImage()` in `OpenCodeManager` already demonstrates the pattern
  for single-shot AI analysis with language parameters.
- Project-level `mainLanguage` exists in `MetaEngine`.

### Implementation Plan

#### 2.1 Database Schema

Extend the `posts` table:

| Column          | Type | Notes                                          |
|-----------------|------|-------------------------------------------------|
| language        | text | ISO code (`en`, `de`, etc.), defaults to project `mainLanguage` |
| translationOfId | text | FK to posts.id — the original post this is a translation of |

No separate junction table needed. A translated post is simply a post with
`translationOfId` pointing at its source. This keeps the model simple: each
post belongs to exactly one language and optionally references one original.

#### 2.2 YAML Frontmatter

Extend `postFileUtils.ts` to read/write:

```yaml
language: de
translationOf: <original-post-id>
```

On `readPostFile()`, parse these fields. On `writePostFile()`, include them
when present.

#### 2.3 PostEngine Extensions

Add methods:

- `getTranslations(postId)` — find all posts where `translationOfId === postId`.
- `getOriginal(postId)` — if the post has `translationOfId`, return that post.
- `createTranslation(originalPostId, targetLanguage, content)` — create a new
  post linked to the original with the target language set.

Modify `createPost()` and `updatePost()` to accept and persist the `language`
and `translationOfId` fields.

#### 2.4 AI Translation Tools in OpenCodeManager

Add three new methods following the `analyzeMediaImage()` pattern:

**`detectPostLanguage(postId)`**
- Read post content.
- Send to AI with prompt: "Detect the language of this text. Return a JSON
  object with `language` (ISO 639-1 code) and `confidence` (0-1)."
- Return `{ language: string, confidence: number }`.

**`translatePost(postId, targetLanguage)`**
- Read full post content + title + excerpt.
- Send to AI with prompt: "Translate this blog post to {language}. Return JSON
  with `title`, `content` (markdown), and `excerpt`."
- Return translated fields without creating a post (caller decides).

**`generatePostSummary(postId)`**
- Read post content.
- Send to AI: "Write a 2-3 sentence summary of this blog post in
  {post.language}. Return JSON with `excerpt`."
- Return `{ excerpt: string }`.

Register these as IPC handlers: `chat:detectPostLanguage`,
`chat:translatePost`, `chat:generatePostSummary`.

#### 2.5 Import Pipeline Integration

In `ImportExecutionEngine`, after a post is imported and published:

1. Call `detectPostLanguage()` to set the `language` field.
2. If the detected language differs from the project's `mainLanguage`, queue
   a translation task via `TaskManager`.
3. The translation task calls `translatePost()`, creates a new post via
   `createTranslation()`, and publishes it.

This is optional and should be configurable per import definition (a checkbox
"Auto-detect language and translate" in `ImportAnalysisView`).

#### 2.6 UI — Translation Panel

In the post editor metadata area, add a "Translations" section:

- Show current post language (dropdown to change).
- List existing translations with links (open in new tab).
- "Translate to..." button that opens a language picker, triggers AI
  translation, and creates the linked post.
- If the post is itself a translation, show "Original: {title}" link.

In the sidebar post list, optionally show a language badge per post.

#### 2.7 Publishing Pipeline

In `PageRenderer` and `BlogGenerationEngine`:

- Add `hreflang` link tags to generated HTML when translations exist.
- Optionally generate a language switcher partial that templates can include.
- Sitemap should include `xhtml:link` entries for alternate language versions.

---

## 3. MCP Server — Agent-Assisted Content Creation - done

### Goal

Host an MCP (Model Context Protocol) server inside the application so external
AI agents (Claude Code, Cursor, etc.) can connect and work with bDS. The core
principle: **read access is open, write access goes through user-reviewable
drafts**. External agents never silently mutate data — they propose changes
that the user accepts or discards inside the agent's UI.

This enables powerful workflows: an agent can read existing posts, draft a new
one with pre-filled content, propose a Python script or Liquid template, or
suggest image metadata improvements — and the user always has final say before
anything enters the system.

### Current State

- `OpenCodeManager` already defines 16 data-access tools and 7 A2UI render
  tools with full implementations (`getToolDefinitions()`, `executeTool()`).
- `PreviewServer` provides the architectural pattern for an in-process HTTP
  server with lifecycle management.
- Posts already have a `draft` status (DB-only, no disk writes until publish)
  — the exact pattern needed for MCP draft posts.
- Scripts and templates are file-first (immediately persisted) — MCP proposals
  need an in-memory staging layer before acceptance.
- **`@modelcontextprotocol/sdk` v1.27.1 and `@modelcontextprotocol/ext-apps`
  v1.1.2 are installed.**
- **`ProposalStore` engine is implemented and tested (18 tests).**
- **`MCPServer` engine is implemented and tested (70 tests).** Standalone HTTP
  server on port 4124, stateless mode (new `McpServer` per request), registers
  5 static resources, 7 resource templates, 8 tools (6 model-facing +
  2 app-only), 3 prompts, and 4 `ui://` review-app resources.
- **`mcp-views.ts` provides review HTML** for posts, scripts, templates, and
  metadata diffs via `@modelcontextprotocol/ext-apps` App class.
- **Lifecycle integrated in `main.ts`** — MCP server starts on app ready and
  cleans up on before-quit.
- **Origin validation** — rejects requests from non-localhost origins to
  prevent DNS rebinding attacks.
- **`accept_proposal` / `discard_proposal` use app-only visibility** via
  `registerAppTool` with `visibility: ["app"]` — hidden from the agent LLM.

### Design Principles

1. **Use all three MCP primitives** — expose blog data via the appropriate
   MCP primitive for each use case:
   - **Resources** for passive, read-only data (post content, media metadata,
     category/tag lists, blog stats). These are application-controlled — the
     host decides when to fetch them.
   - **Tools** for parameterized actions (search, drafting, proposing changes).
     These are model-controlled — the LLM decides when to call them.
   - **Prompts** for user-triggered workflow templates (e.g., "draft a blog
     post", "audit content quality"). These surface as slash commands in the
     host UI.

2. **Tool annotations** — every tool declares MCP `annotations` to advertise
   its behavior to the host:
   - Read-only tools: `{ readOnlyHint: true, openWorldHint: false }`
   - Proposal tools: `{ readOnlyHint: false, destructiveHint: false }`
   - `accept_proposal`: `{ readOnlyHint: false, destructiveHint: false,
     idempotentHint: true }`
   - `discard_proposal`: `{ readOnlyHint: false, destructiveHint: true,
     idempotentHint: true }`

   All annotations are hints — hosts must not make security decisions based
   on them alone, but they help hosts choose appropriate UI (e.g.,
   auto-approving reads, showing confirmation for destructive actions).

3. **Tool metadata** — every tool includes `title` (human-readable display
   name) and `description` (detailed explanation of what it does and when to
   use it). Descriptions are critical — they are what the LLM reads to decide
   whether and when to call a tool.

4. **Draft/Propose pattern for writes via MCP Apps** — every mutation goes
   through a user-gated flow using the MCP Apps extension:
   - Agent calls a `draft_*` or `propose_*` tool. These tools declare a
     `_meta.ui.resourceUri` pointing to a review UI (`ui://` resource).
   - The host (Claude Desktop, VS Code, etc.) renders the review app as a
     sandboxed iframe inline in the conversation.
   - The app shows the proposal (post preview, code block, metadata diff)
     with accept/discard buttons. The agent LLM is **not** in the loop.
   - User clicks accept → the app calls `accept_proposal` tool via the
     MCP App bridge (postMessage) → server commits the change.
   - User clicks discard → the app calls `discard_proposal` tool →
     server cleans up.
   - The tool result flows back to the agent so it can continue.

5. **Aligned with internal editors** — the MCP App review UIs mirror what
   the app's own editors show (post metadata + content, script content +
   validation, template content + validation, image metadata diff). This
   keeps the user experience consistent whether they work inside bDS or
   through an external agent.

6. **Capability negotiation** — during MCP initialization, the server
   declares its supported capabilities: `tools`, `resources`, `prompts`.
   For MCP Apps, the extension capability `io.modelcontextprotocol/ui` is
   negotiated via the `extensions` field. The server checks whether the
   client supports the Apps extension and adjusts proposal tool responses
   accordingly (structured preview data for Apps-capable hosts, formatted
   text for others).

7. **Input validation** — all tool inputs are validated at the MCP
   boundary (via Zod schemas in `inputSchema`) before forwarding to
   engine methods. Do not rely solely on downstream engine validation.

### Implementation Plan

#### 3.1 Dependencies

- `@modelcontextprotocol/sdk` — standard MCP server with transport handling.
- `@modelcontextprotocol/ext-apps` — MCP Apps extension for serving
  interactive UI resources.

#### 3.2 Engine Class — `MCPServer`

Follow the `PreviewServer` pattern:

```
src/main/engine/MCPServer.ts
```

- Constructor accepts dependency injection (engines via getters).
- `start(port)` — create standalone HTTP server on port 4124 using
  `StreamableHTTPServerTransport` in stateless mode.
- `stop()` — clean shutdown.
- Manages an in-memory `ProposalStore` for pending proposals (scripts,
  templates, metadata changes). Posts use the existing draft mechanism instead.
- Serves `ui://` resources for the MCP App review UIs.
- Exposes three MCP primitive types:
  - **Resources** — read-only blog data (posts, media, tags, categories,
    stats) accessible via URI-based `resources/read`.
  - **Tools** — parameterized actions (search, draft, propose, accept,
    discard). Agent-facing tools are visible to the LLM; app-internal
    tools (`accept_proposal`, `discard_proposal`) are called only by the
    MCP App via the App Bridge.
  - **Prompts** — user-triggered workflow templates surfaced as slash
    commands in the host.

#### 3.3 Resources (Read-Only Data)

Expose blog data as MCP Resources using URI templates. Resources are
application-controlled — the host fetches them for context, they are not
actions. Each resource is registered via `resources/list` and read via
`resources/read`.

| Resource URI                     | Source                           | Description                        |
|----------------------------------|----------------------------------|------------------------------------|
| `bds://posts/{id}`               | OpenCodeManager.read_post        | Full post content + metadata       |
| `bds://posts`                    | OpenCodeManager.list_posts       | Paginated post list                |
| `bds://media/{id}`               | OpenCodeManager.get_media        | Media item metadata                |
| `bds://media`                    | OpenCodeManager.list_media       | Paginated media list               |
| `bds://tags`                     | OpenCodeManager.list_tags        | All tags with counts               |
| `bds://categories`               | OpenCodeManager.list_categories  | All categories                     |
| `bds://stats`                    | OpenCodeManager.get_blog_stats   | Blog-wide statistics               |
| `bds://posts/{id}/backlinks`     | OpenCodeManager.get_post_backlinks | Posts linking to this post        |
| `bds://posts/{id}/outlinks`      | OpenCodeManager.get_post_outlinks  | Posts this post links to          |
| `bds://posts/{id}/media`         | OpenCodeManager.get_post_media   | Media attached to a post           |
| `bds://media/{id}/posts`         | OpenCodeManager.get_media_posts  | Posts using a media item           |
| `bds://media/{id}/image`         | OpenCodeManager.view_image       | Image binary (for visual context)  |

Use `bds://` as the custom URI scheme. Parameterized URIs use MCP resource
templates (`resources/templates/list`).

Note: `notifications/resources/list_changed` is not emitted because the
server runs in stateless mode (new `McpServer` per request, no persistent
connection). If the server moves to session-based mode in the future,
change notifications should be added.

List resources (`bds://posts`, `bds://media`) support cursor-based
pagination following the MCP pagination spec. The initial response
includes a `nextCursor` if more results exist; the host passes it back
on the next `resources/read` call.

#### 3.4 Read Tools (Parameterized Queries)

Not all read operations fit the Resources model. Parameterized queries
that accept complex search criteria are better modeled as tools with
`readOnlyHint: true`.

| MCP Tool Name          | Source                           | Annotations                              |
|------------------------|----------------------------------|------------------------------------------|
| search_posts           | OpenCodeManager.search_posts     | `readOnlyHint: true, openWorldHint: false` |

Each tool includes a `title`, a `description` explaining when it should
be used, and a JSON Schema `inputSchema`. `search_posts` accepts query
text, filters (status, category, tag, date range), and pagination
parameters (cursor, limit).

Exclude `update_post_metadata`, `update_media_metadata` (writes go through
proposals), and A2UI render tools (UI-specific, not useful for external
agents).

#### 3.5 Proposal Tools (Draft-Based Writes)

These tools stage content for user review. Each declares a `_meta.ui` field
pointing to a review UI resource, so the host renders an MCP App inline in the
conversation. Proposals have a TTL (e.g., 30 min) and are auto-discarded if
not accepted. All proposal tools use annotations
`{ readOnlyHint: false, destructiveHint: false }`.

##### 3.5.1 `draft_post`

Creates a draft post using the existing PostEngine draft workflow.

**Input:** `{ title, content (markdown), excerpt?, tags?, categoryId? }`

**Tool definition `_meta`:**
```json
{ "ui": { "resourceUri": "ui://bds/review-post" } }
```

**Action:**
1. Call `PostEngine.createPost()` with status `draft`.
2. Set tags and category if provided.
3. Return `{ proposalId (= postId), type: 'draftPost', preview: { title,
   excerpt, tags, category, content, wordCount } }`.

**On user accept (via app):** `PostEngine.publishPost(postId)` — post
transitions to published, markdown file is written to disk.

**On user discard (via app):** `PostEngine.deletePost(postId)` — draft is
removed from the database.

##### 3.5.2 `propose_script`

Stages a Python script in memory for review.

**Input:** `{ title, content (python source), description? }`

**Tool definition `_meta`:**
```json
{ "ui": { "resourceUri": "ui://bds/review-script" } }
```

**Action:**
1. Validate Python syntax (basic parse check).
2. Store in `ProposalStore` with a generated ID.
3. Return `{ proposalId, type: 'script', preview: { title, slug (generated),
   description, content, syntaxValid, syntaxErrors? } }`.

**On user accept (via app):** `ScriptEngine.createScript()` — file + DB entry
created.

**On user discard (via app):** Remove from `ProposalStore` — nothing was
persisted.

##### 3.5.3 `propose_template`

Stages a Liquid template in memory for review.

**Input:** `{ title, content (liquid source), kind ('post'|'list'|'not-found'|
'partial') }`

**Tool definition `_meta`:**
```json
{ "ui": { "resourceUri": "ui://bds/review-template" } }
```

**Action:**
1. Validate Liquid syntax via `TemplateEngine.validateTemplate()`.
2. Store in `ProposalStore`.
3. Return `{ proposalId, type: 'template', preview: { title, slug, kind,
   content, syntaxValid, syntaxErrors? } }`.

**On user accept (via app):** `TemplateEngine.createTemplate()` — file + DB
entry created.

**On user discard (via app):** Remove from `ProposalStore`.

##### 3.5.4 `propose_media_metadata`

Stages metadata changes for an existing media item.

**Input:** `{ mediaId, title?, alt?, caption? }`

**Tool definition `_meta`:**
```json
{ "ui": { "resourceUri": "ui://bds/review-metadata" } }
```

**Action:**
1. Load current metadata via `MediaEngine`.
2. Compute diff (current vs proposed for each changed field).
3. Store in `ProposalStore`.
4. Return `{ proposalId, type: 'mediaMetadata', preview: { filename,
   diff: { field, current, proposed }[] } }`.

**On user accept (via app):** Apply changes via `MediaEngine.updateMedia()`.

**On user discard (via app):** Remove from `ProposalStore`.

##### 3.5.5 `propose_post_metadata`

Stages metadata changes for an existing post (title, excerpt, slug, tags).

**Input:** `{ postId, title?, excerpt?, slug?, tags? }`

**Tool definition `_meta`:**
```json
{ "ui": { "resourceUri": "ui://bds/review-metadata" } }
```

**Action:**
1. Load current post via `PostEngine`.
2. Compute diff.
3. Store in `ProposalStore`.
4. Return `{ proposalId, type: 'postMetadata', preview: { currentTitle,
   diff: { field, current, proposed }[] } }`.

**On user accept (via app):** Apply via `PostEngine.updatePost()`.

**On user discard (via app):** Remove from `ProposalStore`.

#### 3.6 App-Internal Tools (Accept / Discard)

These tools are called by the MCP App (via the App Bridge's `tools/call`
mechanism), **not** by the agent LLM. They are registered with
`registerAppTool` from `@modelcontextprotocol/ext-apps` using
`visibility: ["app"]`, which signals to compliant hosts that these tools
should not be shown to or invoked by the model.

##### `accept_proposal`

**Input:** `{ proposalId }`

**Annotations:** `{ readOnlyHint: false, destructiveHint: false,
idempotentHint: true }`

Looks up the proposal type (draftPost, script, template, mediaMetadata,
postMetadata) and executes the commit action:
- draftPost → `PostEngine.publishPost()`
- script → `ScriptEngine.createScript()`
- template → `TemplateEngine.createTemplate()`
- mediaMetadata → `MediaEngine.updateMedia()`
- postMetadata → `PostEngine.updatePost()`

Returns `{ success, message }`.

##### `discard_proposal`

**Input:** `{ proposalId }`

**Annotations:** `{ readOnlyHint: false, destructiveHint: true,
idempotentHint: true }`

Executes the cleanup action:
- draftPost → `PostEngine.deletePost()`
- All others → remove from `ProposalStore`

Returns `{ success, message }`.

#### 3.7 MCP App Review UIs

The review UIs are HTML pages served as `ui://` resources by the MCP server.
They render inside the host's sandboxed iframe and use the
`@modelcontextprotocol/ext-apps` App class for bidirectional communication.

Each review app:
1. Receives the tool result data (proposal preview) from the host.
2. Renders a focused review interface:
   - **Post review** (`ui://bds/review-post`): title, metadata fields,
     rendered markdown content preview, word count.
   - **Script review** (`ui://bds/review-script`): title, syntax-highlighted
     Python code, validation status/errors.
   - **Template review** (`ui://bds/review-template`): title, kind badge,
     syntax-highlighted Liquid code, validation status/errors.
   - **Metadata review** (`ui://bds/review-metadata`): side-by-side diff of
     current vs proposed values for each changed field.
3. Shows accept and discard buttons.
4. On user action, calls `accept_proposal` or `discard_proposal` via the
   App Bridge's `tools/call`.
5. Updates its UI to show the outcome ("Published", "Created", "Discarded").

These apps are small, self-contained HTML pages — the "slim MCP apps" concept.
They can share a common layout/style and differ only in the content they
render. Since the host provides the sandboxing, the apps don't need their own
authentication or security layer.

The review UIs should visually align with what the bDS internal editors show,
so the user experience is consistent. Where practical, share CSS/component
patterns between the bDS renderer UI and the MCP App review UIs.

#### 3.8 ProposalStore

In-memory store for pending proposals (not posts — those use the DB draft
mechanism):

```typescript
interface Proposal {
  id: string;
  type: 'script' | 'template' | 'mediaMetadata' | 'postMetadata';
  data: Record<string, unknown>;  // type-specific payload
  createdAt: number;
  ttlMs: number;                  // default 30 minutes
}
```

- Simple `Map<string, Proposal>` with periodic cleanup of expired entries.
- On app shutdown, all pending proposals are discarded (they were never
  committed).
- No persistence needed — proposals are ephemeral by design.

For draft posts, the `proposalId` is the post ID itself. The `ProposalStore`
tracks a mapping from `proposalId → 'draftPost'` so the accept/discard
tools know to call PostEngine rather than look in the store.

#### 3.9 Transport

**Streamable HTTP** — standalone HTTP server on port 4124 using
`StreamableHTTPServerTransport` in stateless mode (new `McpServer` per
request). A single HTTP endpoint at `/mcp` accepts JSON-RPC POST
requests and responds with `application/json` or `text/event-stream`
(SSE).

**Security:**

- Bind to `127.0.0.1` (localhost only).
- Validate the `Origin` header on all requests — reject non-localhost
  origins to prevent DNS rebinding attacks.
- Requests without an `Origin` header are allowed (CLI tools like curl
  and local MCP clients typically do not send one).

#### 3.10 Lifecycle Integration

In `main.ts`:

- Initialize `MCPServer` in `initialize()`.
- Start alongside `PreviewServer` in `app.whenReady()`.
- Stop in `before-quit` handler (discard all pending proposals).
- Respect active project context (tools operate on the active project).

#### 3.11 Configuration

In `SettingsView`, add an "MCP Server" section:

- Enable/disable toggle.
- Port number (for HTTP transport).
- Show connection instructions (stdio command or URL).
- Proposal TTL setting (default 30 min).

#### 3.12 MCP Prompts (Workflow Templates)

Expose MCP Prompts for common agent workflows. Prompts are user-controlled —
they surface as slash commands or command palette entries in the host and
produce pre-structured messages that guide the LLM.

| Prompt Name            | Arguments                  | Description                          |
|------------------------|----------------------------|--------------------------------------|
| `draft-blog-post`      | `topic?`, `category?`      | Guides agent through reading existing posts, understanding the blog's style, and drafting a new post on the given topic |
| `improve-media-metadata` | `scope` (`all`\|`missing`) | Guides agent through reviewing media items and proposing alt text, captions, and titles |
| `content-audit`        | `category?`                | Guides agent through reviewing posts for quality, broken links, missing metadata, and suggesting fixes |

Each prompt returns a structured message array (system + user messages) that
sets up the LLM with context about the blog and clear instructions for the
workflow. The host renders the prompt as a one-click action.

This is a lower-priority addition — prompts enhance discoverability but the
core read/write flow works without them.

#### 3.13 Example Workflows

**Agent creates a blog post:**
1. Agent LLM reads `bds://categories` and `bds://tags` resources to
   understand the blog.
2. Agent LLM calls `draft_post({ title: "...", content: "...", tags: [...] })`.
3. MCP server creates draft post (DB only), returns preview data.
4. Host sees `_meta.ui.resourceUri`, fetches `ui://bds/review-post`, renders
   sandboxed iframe inline in conversation.
5. Review app shows the full post preview with accept/discard buttons.
6. User clicks accept → app calls `accept_proposal` via App Bridge →
   server publishes post → app shows "Published" → agent is informed.

**Agent writes a Python script:**
1. Agent LLM reads `bds://posts` resource to understand the content model.
2. Agent LLM calls `propose_script({ title: "Tag Cleanup", content: "..." })`.
3. MCP server validates syntax, stages in ProposalStore, returns preview.
4. Host renders `ui://bds/review-script` — shows syntax-highlighted code
   with validation results.
5. User reviews code, clicks accept → app calls `accept_proposal` →
   server creates script via ScriptEngine.

**Agent suggests image metadata:**
1. Agent LLM reads `bds://media/{id}/image` resource to see the image.
2. Agent LLM calls `propose_media_metadata({ mediaId, alt: "...",
   caption: "..." })`.
3. MCP server computes diff, stages in ProposalStore, returns diff preview.
4. Host renders `ui://bds/review-metadata` — shows current vs proposed diff.
5. User reviews diff, clicks accept → metadata is updated.

#### 3.14 MCP Apps Client Support

MCP Apps are currently supported by Claude (claude.ai), Claude Desktop,
VS Code GitHub Copilot, Goose, Postman, and MCPJam. For hosts that don't
support MCP Apps, the proposal tools still return structured text content
that the agent can present as formatted text — the user would then need
to instruct the agent to accept or discard via conversation, falling back
to a simpler flow.

For hosts without Apps support, the MCP **Elicitation** primitive
(`elicitation/request`) can serve as a lighter-weight confirmation
mechanism — the server asks the user to confirm or reject a proposal via
a simple dialog rather than a full review UI. This requires the host to
support the `elicitation` capability. When neither Apps nor Elicitation is
available, fall back to text-based accept/discard in the conversation.

#### 3.15 Testing

- Unit tests for tool definition mapping (Anthropic → MCP format).
- Unit tests for resource URI resolution and resource template listing.
- Unit tests for `ProposalStore` (create, accept, discard, TTL expiry).
- Unit tests for accept/discard tool handlers.
- Unit tests for tool annotations (verify correct hints on each tool).
- Unit tests for prompt templates (verify message structure and arguments).
- Integration tests: draft_post → app accept flow, propose_script → app
  discard flow.
- Integration tests: start MCP server, send tool calls, verify responses.
- Integration tests: capability negotiation (with/without Apps extension).
- Integration tests: resource read, resource list with pagination, resource
  change notifications.
- MCP App UI tests: render review apps, simulate user actions, verify
  tool calls through App Bridge.
- Security tests: Origin header validation, session management, rate
  limiting (for Streamable HTTP transport).
- Follow existing engine test patterns with mocked dependencies.

---

## 4. AI Post Summary, Title & Slug Suggestions

### Goal

The post editor has AI buttons that generate summaries (excerpts), improved
titles, and better slugs — so the user can focus on writing content and let AI
handle the metadata.

### Current State

- `analyzeMediaImage()` in `OpenCodeManager` already implements the exact
  pattern: one-shot AI call, JSON response, language-aware.
- `AISuggestionsModal` already provides the UI: loading state, field-by-field
  checkboxes, current vs. suggested comparison, apply/cancel.
- The media editor has an "Analyze with AI" button in a quick-actions menu.
- The post editor metadata area has title, tags, author, slug, and categories
  fields but no AI buttons.
- The `excerpt` field exists on `PostData` and can serve as the summary.
- Slug is read-only in the UI after first publish (auto-generated from title).

### Implementation Plan

#### 4.1 Backend — `analyzePost()` in OpenCodeManager

Add a new method following the `analyzeMediaImage()` pattern:

**Input:** `postId: string, language: string`

**Process:**
1. Load post content, title, excerpt, and slug via `PostEngine`.
2. Build a system prompt:
   ```
   You are a blog editor assistant. Analyze the following blog post and suggest
   improvements. Return a JSON object with:
   - "title": a clear, engaging title for this post
   - "excerpt": a 2-3 sentence summary suitable for overview pages
   - "slug": a concise, SEO-friendly URL slug (lowercase, hyphens only)
   Respond in {language}. Return only the JSON object.
   ```
3. Send post content as user message to OpenCode Zen API.
4. Parse JSON response.
5. Return `{ success, title?, excerpt?, slug?, error? }`.

Register IPC handler: `chat:analyzePost`.

#### 4.2 Frontend — Post Editor AI Button

In the post editor metadata area (`Editor.tsx`, around line 720):

- Add a "Quick Actions" dropdown button (same pattern as media editor at
  line 1242).
- Menu item: "Suggest Title, Summary & Slug" with a robot icon.
- On click: call `window.electronAPI.chat.analyzePost(postId, projectLanguage)`.
- Show `AISuggestionsModal` with the results.

#### 4.3 Extend AISuggestionsModal

The modal currently supports `title`, `alt`, `caption` fields. Adapt it to
also support a post mode with `title`, `excerpt`, `slug` fields:

- Add a `mode` prop (`'media'` | `'post'`) or make field configuration
  dynamic.
- For post mode, show title, excerpt, and slug fields.
- Slug field should show a warning that it only applies to unpublished posts.

Alternatively, keep the modal generic and pass field definitions as props:
```typescript
interface SuggestionField {
  key: string;
  label: string;       // i18n key
  currentValue: string;
  suggestedValue?: string;
  warning?: string;    // e.g., "slug is locked after first publish"
}
```

#### 4.4 Applying Suggestions

On "Apply Selected":

- Title: update via existing `onTitleChange` handler.
- Excerpt: update via `onExcerptChange` (may need to add this handler if not
  present — excerpt editing may need a field in the metadata area).
- Slug: only apply if post has never been published. Show a warning and disable
  the checkbox if the post has `publishedAt` set.

#### 4.5 i18n

Add keys to all 5 locale files:

- `aiSuggestions.postTitle`, `aiSuggestions.excerptField`,
  `aiSuggestions.slugField`
- `aiSuggestions.analyzingPost`
- `aiSuggestions.slugLockedWarning`
- `postEditor.quickActions`, `postEditor.analyzeWithAI`

#### 4.6 Excerpt Field in Editor

If the excerpt/summary is not currently editable in the post metadata area,
add a multi-line text field for it between title and tags. This is needed both
for manual editing and for applying AI suggestions.

---

## 5. Drag-and-Drop Image Insertion

### Goal

Users can drag image files from the filesystem onto the editor to insert them.
Dropped files are automatically imported into the media library and inserted
as markdown images.

### Current State

- Images are inserted only via `InsertModal` (browse media library or enter
  URL).
- `MediaEngine.importMedia(sourcePath)` handles file import, thumbnail
  generation, and database indexing.
- `imageResolverPlugin` already converts relative media paths to `bds-media://`
  protocol URLs for editor display.
- `LinkedMediaPanel` has working drag-drop for reordering (reference pattern).
- `insertImageCommand` from Milkdown inserts image nodes into the editor.

### Implementation Plan

#### 5.1 ProseMirror Drop Plugin

Create a new plugin in `src/renderer/plugins/dropImagePlugin.ts` following the
`imageResolverPlugin` pattern:

```typescript
// Pseudo-structure
export const dropImagePlugin = $prose(() => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        drop: (view, event) => {
          // 1. Check for files in dataTransfer
          // 2. Filter to image types
          // 3. Get file paths (Electron exposes .path on File objects)
          // 4. For each file: import via IPC, insert into editor
          // 5. Return true to prevent default
        },
        dragover: (view, event) => {
          // Show drop indicator if files are images
        }
      }
    }
  });
});
```

#### 5.2 Drop Handler Flow

For each dropped file:

1. **Validate** — check file extension against supported image types (jpg,
   png, gif, webp, svg, bmp).
2. **Import** — call `window.electronAPI.media.import(file.path)`. This returns
   `MediaData` with the media ID and file path.
3. **Insert** — use `insertImageCommand` with `{ src: relativePath, alt: '' }`
   where `relativePath` is the media's storage path (e.g.,
   `media/2025/01/uuid.jpg`).
4. **Link** — call `window.electronAPI.postMedia.link(postId, mediaId)` to
   track the relationship.
5. **Resolve** — the existing `imageResolverPlugin` will automatically convert
   the relative path to a `bds-media://` URL for display.

#### 5.3 Visual Feedback

- On `dragover` with image files: add a CSS class to the editor container
  showing a drop zone indicator (border highlight or overlay).
- On `dragleave` / `drop`: remove the indicator.
- During import (for large files): show a small inline spinner or toast.

#### 5.4 Integration into MilkdownEditor

In `MilkdownEditor.tsx`, register the new plugin alongside existing plugins:

```typescript
import { dropImagePlugin } from '../../plugins/dropImagePlugin';

// In the editor setup, add to the plugin list
.use(dropImagePlugin)
```

Pass `postId` and the import callback to the plugin via the editor context or
a shared ref.

#### 5.5 Paste Support (Optional Extension)

The same plugin can handle `paste` events with image files:

- Check `clipboardData.files` for images.
- Same import → insert → link flow as drop.
- This handles screenshots pasted from the clipboard.

#### 5.6 Error Handling

- Non-image files: ignore silently (don't prevent default, let editor handle
  text drops normally).
- Import failure: show toast with error message, don't insert anything.
- Multiple files: process sequentially, insert at cursor position for first,
  then append after each previous insertion.

#### 5.7 Testing

- Unit test the plugin's file validation logic.
- Integration test: mock `electronAPI.media.import`, verify correct calls and
  editor state after drop.
- Test edge cases: non-image files, failed imports, multiple simultaneous
  drops.
