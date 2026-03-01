# Blogging Desktop Server (bDS)

Desktop-first blogging workspace built with Electron + TypeScript + React + SQLite (Drizzle), with filesystem-based content as source of truth.

## Current State (March 2026)

Implemented and actively used:

- **Offline-first by default** — full local editing, preview, generation, and git-based workflows; all online features are optional
- **Multi-project workflow** with active project switching and optional custom data paths
- **Post & page management** (draft/published/archived), pagination, filtering, multi-language full-text search (Snowball stemming), canonical URL handling, inter-post link graph with backlinks/outlinks
- **Media pipeline** with import, metadata sidecars, three thumbnail sizes (Sharp), linked-media references, cleanup tooling, and AI-assisted metadata suggestions (title, alt text, caption from image vision)
- **Tag management** including merge/rename/sync from content, color support
- **Menu editor** for hierarchical site navigation (OPML-based), with page picker and submenu nesting
- **WordPress WXR import pipeline** (analysis, import definitions, 4-phase execution with progress tracking, HTML-to-Markdown conversion)
- **Blogmark deep links** — `bds://new-post` custom protocol for one-click bookmark saving from any browser, with bookmarklet generation and transform script pipeline
- **Static site generation** — full blog output with single-post pages, paginated category/tag/date archive routes, standalone page routes, plus `sitemap.xml`, `rss.xml`, `atom.xml`, and `calendar.json`; content-hash-based incremental writes
- **Site validation** — compares sitemap against generated HTML, detects missing/extra/stale pages, and auto-repairs with targeted re-rendering
- **SSH publishing** via `scp` or `rsync` with parallel upload of HTML, thumbnails, and media
- **Preview server** with local assets only, Liquid templates, macro processing, archive routes, draft preview support, and style preview
- **Style & theming** — 19 Pico CSS color themes with live preview (auto/light/dark modes), all assets served locally
- **Template management** — user-facing Liquid template editor with CRUD, YAML frontmatter, validation, draft/published workflow, and Git reconciliation; template kinds: post, list, not-found, partial
- **Python scripting** (Pyodide WebAssembly runtime) — three script kinds:
    - *Transform scripts* — modify incoming blogmark posts before creation
    - *Macro scripts* — custom `[[macro_name ...]]` blocks that expand during preview/generation, with full access to the bDS Python API (~116 methods across 11 modules)
    - *Utility scripts* — general-purpose Python automation
- **Built-in macros** — `youtube`, `vimeo`, `gallery` (lightbox), `photo_archive`, `tag_cloud` (D3 word cloud)
- **Liquid template system** for all generated pages with i18n support (English, German, French, Italian, Spanish) and custom Markdown filter with internal link rewriting
- **AI assistant** (OpenCode Zen API, Mistral direct API, Ollama local models) with streaming responses, tool use (search/read/update posts, media analysis including image vision, blog stats), AI-powered taxonomy analysis, and rich interactive responses via the A2UI protocol (charts, tables, forms, cards, metrics, lists, tabs)
- **MCP server** — full Model Context Protocol integration exposing the blog to external coding agents; 10 tools, 13 resources, 3 prompts, and interactive review views; supports Streamable HTTP transport (in-app) and stdio transport (standalone CLI); auto-configures into Claude Code, Claude Desktop, GitHub Copilot, Gemini CLI, OpenCode, Mistral Vibe, and OpenAI Codex agent configs
- **Model catalog** — fetches and caches model metadata from models.dev with conditional GET refresh; provides pricing, context windows, capabilities, and modalities; works fully offline after first fetch
- **Secure key storage** — API keys encrypted via OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret) using Electron safeStorage
- **Git integration** (status, diff, commit history with sync status, fetch/pull/push, init, .gitignore management, LFS configure/prune, branch operations)
- **Metadata diff tooling** for comparing filesystem metadata vs database metadata with sync in either direction
- **Rich editing** — Milkdown WYSIWYG Markdown editor for posts, Monaco code editor for Python scripts and Liquid templates
- **Task system** for background progress reporting across long-running operations with grouping, cancellation, and status bar integration
- **In-app documentation** — rendered user guide with navigable table of contents and heading anchors
- **i18n** — UI language follows OS locale; render/preview language from project preferences; 5 supported languages

## Architecture

```text
src/
├── cli/
│   └── bds-mcp.ts       # Standalone MCP stdio server (runs without Electron)
├── main/
│   ├── database/        # Drizzle schema, migrations, connection
│   ├── engine/          # Core business logic (no UI)
│   │   ├── PostEngine             # Post CRUD, FTS indexing, link graph
│   │   ├── MediaEngine            # Media files, Sharp thumbnails
│   │   ├── PostMediaEngine        # Post ↔ media linking
│   │   ├── ProjectEngine          # Multi-project management
│   │   ├── MetaEngine             # Project metadata, categories
│   │   ├── TagEngine              # Tag CRUD, merge, rename, colors
│   │   ├── ScriptEngine           # Python script management & Git sync
│   │   ├── TemplateEngine         # Liquid template CRUD, validation, Git sync
│   │   ├── MenuEngine             # OPML-based navigation menus
│   │   ├── PreviewServer          # Local HTTP preview with Liquid
│   │   ├── BlogGenerationEngine   # Static site generation
│   │   ├── PublishEngine          # SSH upload (scp / rsync)
│   │   ├── SiteValidationDiffService  # Sitemap ↔ HTML validation
│   │   ├── Import* engines        # WXR parsing, analysis, execution
│   │   ├── Blogmark* services     # Deep link handling, transforms
│   │   ├── PythonMacroWorkerRuntime   # Pyodide macro execution
│   │   ├── GitEngine              # Git operations (simple-git)
│   │   ├── MetadataDiffEngine     # DB ↔ file metadata comparison
│   │   ├── ChatEngine             # AI chat with streaming & tool use
│   │   ├── MCPServer              # Model Context Protocol server (HTTP + stdio)
│   │   ├── MCPAgentConfigEngine   # Auto-configure MCP into coding agents
│   │   ├── ModelCatalogEngine     # Model metadata from models.dev
│   │   ├── SecureKeyStore         # OS keychain encryption for API keys
│   │   ├── NotificationWatcher    # CLI ↔ app DB change synchronization
│   │   └── TaskManager            # Background task queue
│   ├── a2ui/            # A2UI protocol: types, catalog, generator
│   ├── ipc/             # IPC handlers; bridges renderer to engines
│   ├── shared/          # Shared contracts/types (Electron API)
│   └── main.ts          # Electron app + menu + window lifecycle
└── renderer/
        ├── components/      # UI (editor, sidebars, panels, modals, views)
        ├── a2ui/            # A2UI surface rendering (17 component types)
        ├── store/           # Zustand app state
        ├── macros/          # Macro authoring/runtime support
        ├── python/          # Python scripting UI integration
        ├── navigation/      # Activity routing, tab policy, sidebar views
        └── App.tsx          # App composition + event wiring
```

## Data Model & Storage

- **Primary DB**: `{userData}/bds.db`
- **Projects**: stored in DB with an active project
- **Per-project data**:
    - default/internal: `{userData}/projects/{projectId}/`
    - optional custom `dataPath` (posts/media/meta/thumbnails live together)
- **Filesystem remains source of truth** for post/media files; DB is query/index/state layer

Typical per-project folders:

```text
{projectDataDir}/
├── posts/
├── media/
├── meta/          # tags, categories, menu.opml
├── scripts/       # Python scripts (.py with YAML frontmatter)
└── thumbnails/    # small / medium / large
```

## Menu / Shortcuts (Cross-Platform)

Key shortcuts (defined as `CmdOrCtrl`):

- `CmdOrCtrl+N` New post
- `CmdOrCtrl+I` Import media
- `CmdOrCtrl+S` Save
- `CmdOrCtrl+1` Posts view
- `CmdOrCtrl+2` Media view
- `CmdOrCtrl+B` Toggle sidebar
- `CmdOrCtrl+J` Toggle panel
- `CmdOrCtrl+Shift+P` Publish selected
- `CmdOrCtrl+Shift+V` Preview active post in browser

## Development

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run (Development)

```bash
# Runs main TypeScript watch, Vite dev server, and Electron together
npm run dev
```

Alternative renderer+Electron flow:

```bash
npm start
```

### Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

### Build

```bash
# Generates drizzle artifacts, builds main process and renderer
npm run build

# Package app directory only (no installer)
npm run package

# Package distributables for all supported systems
npm run dist

# Package by target platform
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### Distribution Notes

- Custom protocol `bds://` is declared in electron-builder metadata for packaged apps.
- Build targets: macOS (DMG+ZIP, arm64, notarized), Windows (NSIS, x64+arm64), Linux (AppImage/deb/rpm).
- macOS signing/notarization is scaffolded via `scripts/notarize.mjs` and runs when these env vars are set:
    - `APPLE_ID`
    - `APPLE_APP_SPECIFIC_PASSWORD`
    - `APPLE_TEAM_ID`

## Further Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — end-user guide covering workflows, macros, scripting, AI assistant, and editorial best practices
- [API.md](API.md) — full Python runtime API reference for macro and utility scripts (`bds_api` module)
- [VISION.md](VISION.md) — long-term product vision and design notes

## License

MIT
