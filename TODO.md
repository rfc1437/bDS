# bDS — Remaining Feature Work

<!-- markdownlint-disable MD024 -->

This document covers the features described in VISION.md that are not yet
implemented. Each section is a self-contained plan that can be picked up
independently.

---

## 1. Post Translation System

### Goal

Posts keep their canonical metadata in the main `posts` table. Translations are
stored separately so translated variants cannot drift into full independent
posts with their own unrelated metadata. The system must expose translation
availability everywhere posts are consumed.

### Current State

- No translation storage model yet.
- No translation relationship tracking yet.
- No translation-aware post metadata such as `availableLanguages` yet.
- No language/missing-language filtering in post query APIs yet.
- AI post language detection already exists via `chat:detectPostLanguage`.
- AI post analysis already exists via `chat:analyzePost` and already suggests
  title, excerpt, and slug.
- Project-level `mainLanguage` already exists.

### Implementation Plan

#### 1.1 Database Schema

Add a dedicated translations table instead of storing translations as normal
posts.

Each translation row should contain only:

- its own ID
- `translationFor` referencing the source post ID
- `language`
- `title`
- `excerpt`
- `content` for draft translations only
- normal timestamps/status fields needed for lifecycle management

Published translations follow the same rule as published posts: body content is
not stored in the database and is read from the filesystem.

#### 1.2 YAML Frontmatter

Store translation files separately but in the same general markdown + YAML
frontmatter style as posts, with only the supported translation fields:

```yaml
translationFor: <original-post-id>
language: fr
title: ...
excerpt: ...
```

Draft translation files include markdown body content. Published translation
files keep content only in the file, not in the database. File naming is based
on the source post slug plus the language code, for example:

- `this-slug.md` for the source post
- `this-slug.fr.md` for the French translation

#### 1.3 PostEngine Extensions

Add translation-aware storage and lookup methods instead of treating
translations as regular posts.

- Create/read/update/publish translation records.
- Resolve translations for a post by source post ID.
- Prevent duplicate translations for the same `(translationFor, language)` pair.
- Keep source post metadata authoritative; translations only override the fields
  they actually own.
- Keep `getPost(id)` and `getPostBySlug(slug)` canonical-only.
- Add explicit translation reads such as `getPostTranslation(postId, language)`
  and `getPostTranslations(postId)` instead of overloading `getPost()` with an
  optional language parameter.
- If callers need "best variant for language X", add a separate higher-level
  resolver rather than changing the semantics of the base post APIs.

Post APIs should expose an `availableLanguages` meta field derived from the
translations table for every source post.

#### 1.4 AI Translation Tools in OpenCodeManager

Add translation generation on top of the existing one-shot AI tooling.

**`translatePost(postId, targetLanguage)`**

- Read the source post's full content plus title/excerpt.
- Return translated `title`, `excerpt`, and markdown `content`.
- Create or update a translation record/file from the returned data.
- After the post translation is persisted, cascade to linked media: for every
  image linked to the source post that does not already have a translation for
  `targetLanguage`, call `translateMediaMetadata(mediaId, targetLanguage)` (see
  §2.5) to keep the post and its images in the same set of languages.

Language detection and excerpt suggestion already exist; this step is only
about translation-specific tooling.

#### 1.5 Import Pipeline Integration

Integrate with the existing import flow without redefining source posts as
translations.

1. Call `detectPostLanguage()` to set the `language` field.
2. Optionally queue translation generation for configured target languages.
3. Persist generated results as translation records/files linked via
   `translationFor`.

This is optional and should be configurable per import definition (a checkbox
"Auto-detect language and translate" in `ImportAnalysisView`).

#### 1.6 API Surface

Expose translation metadata consistently across all post consumers:

- Templates and Python scripts can read `post.meta.availableLanguages`.
- Internal AI tools can inspect available translation languages.
- MCP post APIs return the same `availableLanguages` data.
- Python post-query APIs support filtering by `language` and by missing
  translation language, so callers can ask for posts available in French or
  posts missing Spanish.
- The same language and missing-language filters must be available to internal
  AI tools and MCP server queries.

#### 1.7 UI — Translation Panel

In the post editor metadata area, add a "Translations" section:

- Show current post language (dropdown to change).
- List existing translations by language.
- "Translate to..." creates or refreshes the separate translation record.
- Show which configured languages are still missing.

In the sidebar post list, optionally show a language badge per post.

#### 1.8 Publishing Pipeline

In `PageRenderer` and `BlogGenerationEngine`:

- Resolve alternate-language links from the translations table.
- Add `hreflang` metadata and language switcher data from DB-backed
  translation availability.
- Include alternate language entries in sitemap generation.

---

## 2. Media Translation System

### Goal

Media files keep their canonical metadata in the main `media` table and main
sidecar. Translations are stored separately so localized metadata cannot drift
into independent media records. The binary asset remains shared; only the
language-specific metadata varies.

### Current State

- No media translation storage model yet.
- No translation relationship tracking for media yet.
- No translation-aware media metadata such as `availableLanguages` yet.
- No language/missing-language filtering in media query APIs yet.
- No explicit language tracking on canonical media metadata yet.
- AI media analysis already exists via `chat:analyzeMediaImage` and already
  suggests title, alt text, and caption in a requested language.
- Main media metadata already uses DB + sidecar persistence.

### Implementation Plan

#### 2.1 Database Schema

Add a `language` column to the `media` table (optional text, ISO code such as
`'en'`, `'de'`). This records what language the canonical `title`, `alt`, and
`caption` are written in. When null, the project `mainLanguage` is assumed.
Persist the value in the canonical sidecar as well.

Add a dedicated media translations table instead of storing localized metadata
inside the canonical `media` row.

Each translation row should contain only:

- its own ID
- `translationFor` referencing the source media ID
- `language`
- `title`
- `alt`
- `caption`
- normal timestamps needed for lifecycle and sync

The binary media file remains the canonical original file. Translation rows do
not duplicate the asset itself.

#### 2.2 Sidecar Format

Keep the canonical sidecar for canonical metadata, and add language-specific
sidecars for translated metadata only.

Canonical sidecar stays with the original media file, for example:

- `image.jpg.meta`

Translated metadata sidecars use the source filename plus the language code,
for example:

- `image.jpg.fr.meta`

Translated sidecars should contain only the supported translation fields:

```yaml
translationFor: <original-media-id>
language: fr
title: ...
alt: ...
caption: ...
```

#### 2.3 MediaEngine Extensions

Add translation-aware storage and lookup methods instead of treating media
translations as separate media items.

- Create/read/update translation records and translated sidecars.
- Resolve translations for a media item by source media ID.
- Prevent duplicate translations for the same `(translationFor, language)` pair.
- Keep source media metadata authoritative; translations only override
  `title`, `alt`, and `caption`.
- Keep `getMedia(id)` canonical-only.
- Add explicit translation reads such as `getMediaTranslation(mediaId,
  language)` and `getMediaTranslations(mediaId)` instead of overloading
  `getMedia()` with an optional language parameter.
- If callers need "best variant for language X", add a separate higher-level
  resolver rather than changing the semantics of the base media APIs.

Media APIs should expose an `availableLanguages` meta field derived from the
translations table for every canonical media item.

#### 2.4 AI Translation Tools

Add media-metadata translation on top of the existing one-shot AI tooling.

**`translateMediaMetadata(mediaId, targetLanguage)`**

- Read the source media metadata plus image context needed for a faithful
  translation.
- Determine source language from `media.language` (falling back to the
  project `mainLanguage`).
- Return translated `title`, `alt`, and `caption`.
- Create or update a translation record/sidecar from the returned data.

**`detectMediaLanguage(mediaId)`**

- Read the canonical `title`, `alt`, and `caption` of a media item.
- Use the same lightweight title model and detection pattern as
  `detectPostLanguage`.
- Return the detected ISO language code.
- Optionally persist the result to `media.language` if the caller requests it.

AI media analysis already exists; these steps are only about
language-detection and translation-specific tooling.

#### 2.5 Post-Triggered Media Translation Cascade

When a post is translated, all images linked to that post should be translated
automatically so rendered output never mixes languages.

**Trigger**: After `translatePost(postId, targetLanguage)` successfully
persists a post translation (§1.4), the system resolves all media linked to
the source post via the `postMedia` junction table.

**For each linked media item**:

1. Check whether the media already has a translation for `targetLanguage`
   (via `getMediaTranslation(mediaId, targetLanguage)`).
2. If a translation already exists, skip — the image is already covered.
3. If no translation exists, call `translateMediaMetadata(mediaId,
   targetLanguage)` (§2.4) to generate and persist the translated `title`,
   `alt`, and `caption`.

**Design constraints**:

- The cascade is additive only — it never overwrites an existing media
  translation. Users who independently translate an image via quick action
  keep their version.
- Images can still be translated independently at any time through their own
  quick action or the media translation panel (§2.7). The cascade merely
  ensures coverage; it does not create a hard coupling.
- Failures on individual media translations should be logged but must not
  block the post translation from succeeding. Report partial failures to the
  UI so the user can retry individual images.
- The cascade runs after the post translation is committed, not inside the
  same transaction, so a media-translation failure never rolls back post
  work.

#### 2.6 Import And Sync Integration

Integrate with the existing media import and metadata sync flow without
creating translated duplicate media records.

1. Import the binary asset once as the canonical media item.
2. Optionally queue metadata translation generation for configured target
   languages.
3. Persist generated results as translation records/sidecars linked via
   `translationFor`.
4. Extend metadata diff/sync tooling so canonical and translated sidecars can
   both be compared against the database safely.

#### 2.7 API Surface

Expose translation metadata consistently across all media consumers:

- Templates and Python scripts can read `media.meta.availableLanguages`.
- Internal AI tools can inspect available translation languages.
- MCP media APIs return the same `availableLanguages` data.
- Python media-query APIs support filtering by `language` and by missing
  translation language, so callers can ask for media with French metadata or
  media missing Spanish metadata.
- The same language and missing-language filters must be available to internal
  AI tools and MCP server queries.

#### 2.8 UI — Translation Panel

In the media editor/details area, add a "Translations" section:

- Show the canonical media language as a dropdown (same UX as the post
  language selector). Changing it updates `media.language`.
- Provide a "Detect Language" button that calls `detectMediaLanguage` and
  updates the dropdown.
- List existing metadata translations by language.
- "Translate to..." creates or refreshes the separate translation record.
- Show which configured languages are still missing.

Media list/detail views can optionally show a language-availability badge.

#### 2.9 Rendering And Asset Use

When media metadata is consumed during rendering or editing:

- Resolve localized `title`, `alt`, and `caption` from the translations table
  when a language-specific variant is requested.
- Fall back to canonical metadata when no translation exists.
- Keep URLs and binary asset references stable; only metadata changes by
  language.

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

---

## 4. Multi-Language Blog Rendering (Phase 2)

### Goal

The generated blog is fully navigable in each activated language. Every
language gets its own route subtree (`/en/`, `/de/`, …), its own feeds, and
its own sitemap entries. Media assets are shared; only HTML differs. The
preview server must serve the same language-prefixed routes so the user can
verify output before uploading.

### Current State

- Post and media translation schemas, CRUD, AI translation, and validation
  already exist (§1, §2).
- `PageRenderer` already accepts `preferredLanguage` and resolves translations
  via `resolveRenderablePost()` and `getMediaTranslation()`.
- `BlogGenerationEngine` builds translation variants with `.lang` slug
  suffixes but writes everything to a flat `html/` directory — no
  language-prefixed subtrees.
- `PreviewServer` supports a `?lang=` query parameter but has no
  language-prefixed routes.
- `ProjectMetadata` has `mainLanguage` but no `blogLanguages` list.
- No `doNotTranslate` flag on posts.
- No automatic translation on post create/update.
- No "Fill missing translations" batch tool.

### Implementation Plan

#### 4.0 Extract `SUPPORTED_POST_LANGUAGES` Constant

The list of supported post languages is currently hardcoded inline in AI
task files (e.g. `['en', 'de', 'fr', 'it', 'es']`). Extract it into a
shared constant in `src/main/shared/` (or similar) so that both AI tasks
and the Blog Languages UI (§4.1) reference a single source of truth.

#### 4.1 Project Preferences — Blog Languages

Add `blogLanguages?: string[]` to `ProjectMetadata`. This is the list of
languages the blog is rendered in (e.g. `['en', 'de']`). The `mainLanguage`
is always implicitly included. When `blogLanguages` is empty or absent, the
blog renders in `mainLanguage` only (current behaviour).

**UI**: Add a "Blog Languages" multi-select in the Project Settings panel,
populated from `SUPPORTED_POST_LANGUAGES`. The main language is shown but
cannot be removed. i18n keys: `settings.project.blogLanguagesLabel`,
`settings.project.blogLanguagesDescription`.

#### 4.2 Do-Not-Translate Flag

Add a boolean `doNotTranslate` column to the `posts` table (default false).
Persist in YAML frontmatter as `doNotTranslate: true`. Migration required.

**UI**: Checkbox in the post editor metadata area, labelled via i18n
(`editor.doNotTranslateLabel`).

**Validate Translations** must detect posts marked `doNotTranslate` that
still have translations and offer to remove them.

#### 4.3 Automatic Translation on Post Create/Update

When a canonical post is created or updated and `blogLanguages` contains
languages beyond `mainLanguage`:

1. For each active blog language missing a translation (skip if
   `doNotTranslate` is set), enqueue a `TaskManager` task calling
   `chat:translatePost`.
2. On success, show a toast ("Translated to French"). On failure, show an
   error toast. Task progress is visible in the task panel.
3. Only canonical content changes trigger re-translation. Editing a
   translation directly does **not** re-trigger anything.
4. After each post translation succeeds, cascade to linked media: for every
   media item linked via `postMedia` that lacks a translation for the target
   language, enqueue `chat:translateMediaMetadata`.

#### 4.4 Fill Missing Translations (Blog Menu Tool)

Add a "Fill Missing Translations" menu item under the Blog menu.

1. Scan all published posts (excluding `doNotTranslate`) and all linked media
   for missing translations across `blogLanguages`.
2. Create one task for post translations and a second task for media metadata
   translations.
3. Report progress and partial failures via the task panel and toasts.
4. This is separate from Validate Translations — validate checks consistency,
   fill adds missing content.

#### 4.5 Route Generation — Main Language Flat, Alternatives Prefixed

The main language keeps the current flat route structure. Only additional
blog languages get a language-prefixed subtree. This means single-language
blogs see zero change from today's output.

```
html/
  index.html                 ← main language (flat, same as today)
  page/2/index.html
  2025/03/08/my-post/index.html
  category/tech/index.html
  tag/rust/index.html
  rss.xml
  atom.xml
  de/                        ← additional blog language subtree
    index.html
    page/2/index.html
    2025/03/08/my-post/index.html
    category/tech/index.html
    tag/rust/index.html
    rss.xml
    atom.xml
  sitemap.xml                ← combined, with hreflang alternates
  media/                     ← shared, not duplicated
  assets/                    ← shared, not duplicated
```

For the main language pass, generation works exactly as today — no prefix,
no routing changes. For each additional language in `blogLanguages`:

- Iterate the same route list, writing output under `/{lang}/…`.
- Resolve every post through `resolveRenderablePost(post, engine, lang)`.
  If no translation exists, fall back to canonical content.
- Same for media metadata in macros: `getMediaTranslation(id, lang)` with
  canonical fallback.
- All internal links within a language subtree stay prefixed (`/de/…` links
  to `/de/…`). Main-language links remain unprefixed (`/2025/…`).
- Posts marked `doNotTranslate` render only in the main language output.
  They are omitted from alternative language subtrees entirely.

#### 4.6 Per-Language Feeds

The main language feeds (`rss.xml`, `atom.xml`) stay at the root as today.
Each alternative language subtree gets its own `rss.xml` and `atom.xml`
under `/{lang}/`, containing only posts available in that language, with
URLs pointing into the language subtree. Feed `<language>` / `xml:lang` is
set to the subtree language.

#### 4.7 Combined Sitemap with hreflang

The root `sitemap.xml` lists all language variants of every URL. Each `<url>`
entry includes `<xhtml:link rel="alternate" hreflang="…" href="…"/>` for
every language the post is available in, plus `x-default` pointing to the
main language variant.

#### 4.8 Language Switcher in Templates

Add a `blogLanguages` array and `currentLanguage` string to the Liquid
template context. Default templates render a language switcher bar (flag
badges) at the top linking to the same page in each available language.

The switcher links are absolute paths — unprefixed for the main language
(`/2025/03/08/my-post/`) and prefixed for alternatives
(`/de/2025/03/08/my-post/`) — so they work regardless of route depth.

#### 4.9 Preview Server — Language-Prefixed Routes

Extend `PreviewServer` to handle language-prefixed paths for alternative
languages so preview matches the generated output:

- `GET /2025/03/08/my-post` → render post in main language (unchanged).
- `GET /de/category/tech` → render category list in German.
- For paths starting with a known alternative language prefix, strip it and
  pass the language as `preferredLanguage` to `renderRouteForContext()`.
- Unprefixed paths use `mainLanguage` (current behaviour, no change).
- Keep the existing `?lang=` parameter as a fallback for single-post preview
  from the editor.
- Language switcher links in preview HTML work because they use the same
  prefix scheme as generation.

This ensures the user sees the exact same route structure and language
switching behaviour in preview as in the generated output.

#### 4.10 Preview/Generation Parity Checklist

Both preview and generation must produce identical output for:

- [ ] Main language routes remain flat/unprefixed.
- [ ] Alternative language routes use `/{lang}/…` prefix.
- [ ] Post content: translated title, excerpt, body with canonical fallback.
- [ ] Media metadata in macros (gallery, photo_album): translated alt/title/
      caption with canonical fallback.
- [ ] Internal links: unprefixed for main language, prefixed for alternatives.
- [ ] Language switcher rendering with correct cross-language links.
- [ ] Per-language feed links in HTML `<head>`.
- [ ] `doNotTranslate` posts omitted from alternative language subtrees.
- [ ] Root `/` renders main language content (unchanged from today).

Shared implementation: both paths go through `SharedRouteRenderer` →
`PageRenderer`, so language handling logic added there automatically applies
to both preview and generation. The key change is making
`SharedRouteRenderer` language-prefix-aware and ensuring
`BlogGenerationEngine` iterates over `blogLanguages` when building routes.

#### 4.11 Testing

- **Unit**: Route prefix stripping, language fallback resolution, feed
  language filtering, `doNotTranslate` exclusion, sitemap hreflang building.
- **Integration**: End-to-end generation with two languages produces correct
  subtree structure, shared assets, per-language feeds, combined sitemap.
- **Preview parity**: Same route in preview and generation produces identical
  HTML (modulo asset URLs).
