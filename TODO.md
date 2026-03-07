# bDS — Remaining Feature Work

This document covers the features described in VISION.md that are not yet
implemented. Each section is a self-contained plan that can be picked up
independently.

---

## 1. Post Translation System

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

#### 1.1 Database Schema

Extend the `posts` table:

| Column          | Type | Notes                                          |
|-----------------|------|-------------------------------------------------|
| language        | text | ISO code (`en`, `de`, etc.), defaults to project `mainLanguage` |
| translationOfId | text | FK to posts.id — the original post this is a translation of |

No separate junction table needed. A translated post is simply a post with
`translationOfId` pointing at its source. This keeps the model simple: each
post belongs to exactly one language and optionally references one original.

#### 1.2 YAML Frontmatter

Extend `postFileUtils.ts` to read/write:

```yaml
language: de
translationOf: <original-post-id>
```

On `readPostFile()`, parse these fields. On `writePostFile()`, include them
when present.

#### 1.3 PostEngine Extensions

Add methods:

- `getTranslations(postId)` — find all posts where `translationOfId === postId`.
- `getOriginal(postId)` — if the post has `translationOfId`, return that post.
- `createTranslation(originalPostId, targetLanguage, content)` — create a new
  post linked to the original with the target language set.

Modify `createPost()` and `updatePost()` to accept and persist the `language`
and `translationOfId` fields.

#### 1.4 AI Translation Tools in OpenCodeManager

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

#### 1.5 Import Pipeline Integration

In `ImportExecutionEngine`, after a post is imported and published:

1. Call `detectPostLanguage()` to set the `language` field.
2. If the detected language differs from the project's `mainLanguage`, queue
   a translation task via `TaskManager`.
3. The translation task calls `translatePost()`, creates a new post via
   `createTranslation()`, and publishes it.

This is optional and should be configurable per import definition (a checkbox
"Auto-detect language and translate" in `ImportAnalysisView`).

#### 1.6 UI — Translation Panel

In the post editor metadata area, add a "Translations" section:

- Show current post language (dropdown to change).
- List existing translations with links (open in new tab).
- "Translate to..." button that opens a language picker, triggers AI
  translation, and creates the linked post.
- If the post is itself a translation, show "Original: {title}" link.

In the sidebar post list, optionally show a language badge per post.

#### 1.7 Publishing Pipeline

In `PageRenderer` and `BlogGenerationEngine`:

- Add `hreflang` link tags to generated HTML when translations exist.
- Optionally generate a language switcher partial that templates can include.
- Sitemap should include `xhtml:link` entries for alternate language versions.

---

---

## 3. Drag-and-Drop Image Insertion

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

#### 3.1 ProseMirror Drop Plugin

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

#### 3.2 Drop Handler Flow

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

#### 3.3 Visual Feedback

- On `dragover` with image files: add a CSS class to the editor container
  showing a drop zone indicator (border highlight or overlay).
- On `dragleave` / `drop`: remove the indicator.
- During import (for large files): show a small inline spinner or toast.

#### 3.4 Integration into MilkdownEditor

In `MilkdownEditor.tsx`, register the new plugin alongside existing plugins:

```typescript
import { dropImagePlugin } from '../../plugins/dropImagePlugin';

// In the editor setup, add to the plugin list
.use(dropImagePlugin)
```

Pass `postId` and the import callback to the plugin via the editor context or
a shared ref.

#### 3.5 Paste Support (Optional Extension)

The same plugin can handle `paste` events with image files:

- Check `clipboardData.files` for images.
- Same import → insert → link flow as drop.
- This handles screenshots pasted from the clipboard.

#### 3.6 Error Handling

- Non-image files: ignore silently (don't prevent default, let editor handle
  text drops normally).
- Import failure: show toast with error message, don't insert anything.
- Multiple files: process sequentially, insert at cursor position for first,
  then append after each previous insertion.

#### 3.7 Testing

- Unit test the plugin's file validation logic.
- Integration test: mock `electronAPI.media.import`, verify correct calls and
  editor state after drop.
- Test edge cases: non-image files, failed imports, multiple simultaneous
  drops.
