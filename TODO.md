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

## 3. MCP Server

### Goal

Host an MCP (Model Context Protocol) server inside the application so external
AI agents (Claude Code, Cursor, etc.) can connect and use bDS tools to query
and manage blog content.

### Current State

- `OpenCodeManager` already defines 16 data-access tools and 7 A2UI render
  tools with full implementations (`getToolDefinitions()`, `executeTool()`).
- `PreviewServer` provides the architectural pattern for an in-process HTTP
  server with lifecycle management.
- No MCP SDK dependency exists.

### Implementation Plan

#### 3.1 Dependencies

Add `@modelcontextprotocol/sdk` to `package.json`. This provides the standard
MCP server implementation with transport handling.

#### 3.2 Engine Class — `MCPServer`

Follow the `PreviewServer` pattern:

```
src/main/engine/MCPServer.ts
```

- Constructor accepts dependency injection (engines via getters).
- `start(port)` — create HTTP server implementing MCP protocol, or use stdio
  transport for local agent integration.
- `stop()` — clean shutdown.
- `getToolDefinitions()` — convert OpenCodeManager's Anthropic-format tool
  definitions to MCP schema format.
- `executeTool(name, args)` — delegate to OpenCodeManager's `executeTool()`.

#### 3.3 Tool Mapping

Map the existing OpenCodeManager tools to MCP tools. The tool signatures are
nearly identical between Anthropic tool_use format and MCP — both use JSON
Schema for input definitions. The mapping is mechanical:

| OpenCodeManager Tool   | MCP Tool Name          |
|------------------------|------------------------|
| search_posts           | search_posts           |
| read_post              | read_post              |
| list_posts             | list_posts             |
| get_media              | get_media              |
| list_media             | list_media             |
| update_post_metadata   | update_post_metadata   |
| update_media_metadata  | update_media_metadata  |
| list_tags              | list_tags              |
| list_categories        | list_categories        |
| get_blog_stats         | get_blog_stats         |
| view_image             | view_image             |
| get_post_backlinks     | get_post_backlinks     |
| get_post_outlinks      | get_post_outlinks      |
| get_post_media         | get_post_media         |
| get_media_posts        | get_media_posts        |

Exclude A2UI render tools (they are UI-specific and not useful for external
agents).

#### 3.4 Transport

Support two transports:

- **stdio** — for local integration (agent runs `bds --mcp` or connects via
  named pipe). This is the standard for MCP in coding agents.
- **HTTP/SSE** — for network access, running alongside PreviewServer on a
  different port (e.g., 5174).

Start with stdio since that is what Claude Code and Cursor use.

#### 3.5 Lifecycle Integration

In `main.ts`:

- Initialize `MCPServer` in `initialize()`.
- Start alongside `PreviewServer` in `app.whenReady()`.
- Stop in `before-quit` handler.
- Respect active project context (tools operate on the active project).

#### 3.6 Configuration

In `SettingsView`, add an "MCP Server" section:

- Enable/disable toggle.
- Port number (for HTTP transport).
- Show connection instructions (stdio command or URL).

#### 3.7 Testing

- Unit tests for tool definition mapping (Anthropic → MCP format).
- Integration tests: start MCP server, send tool calls, verify responses.
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
