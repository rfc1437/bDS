# Blogging Desktop Server (bDS)

Desktop-first blogging workspace built with Electron + TypeScript + React + SQLite (Drizzle), with filesystem-based content as source of truth.

## Current State (February 2026)

Implemented and actively used:

- **Offline-first by default** with full local editing, preview, and git-based workflows; all online features are optional
- **Multi-project workflow** with active project switching and optional custom data paths
- **Post management** (draft/published/archived), pagination, filtering, full-text search, canonical URL handling
- **Media pipeline** with import, metadata sidecars, thumbnails, linked-media references, and cleanup tooling
- **Tag management** including merge/rename/sync from content
- **WordPress WXR import pipeline** (analysis, import definitions, execution/progress)
- **Preview server** with local assets only, Liquid templates, macro processing, archive routes, sitemap generation
- **Git integration** (status, diff, history, fetch/pull/push, init, .gitignore ensure, LFS prune)
- **Metadata diff tooling** for comparing filesystem metadata vs database metadata
- **AI chat persistence layer** (conversations/messages/model metadata) with OpenCode integration support
- **Task system** for progress reporting across long-running operations

## Architecture

```text
src/
├── main/
│   ├── database/        # Drizzle schema, migrations, connection
│   ├── engine/          # Core business logic (no UI)
│   │   ├── PostEngine
│   │   ├── MediaEngine
│   │   ├── PostMediaEngine
│   │   ├── ProjectEngine
│   │   ├── MetaEngine
│   │   ├── TagEngine
│   │   ├── PreviewServer
│   │   ├── Import* engines
│   │   ├── GitEngine
│   │   ├── MetadataDiffEngine
│   │   ├── ChatEngine / OpenCodeManager
│   │   └── TaskManager
│   ├── ipc/             # IPC handlers; bridges renderer to engines
│   ├── shared/          # Shared contracts/types (Electron API)
│   └── main.ts          # Electron app + menu + window lifecycle
└── renderer/
        ├── components/      # UI (editor, sidebars, panels, modals, views)
        ├── store/           # Zustand app state
        ├── macros/          # Macro authoring/runtime support
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
├── meta/
└── thumbnails/
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
- macOS signing/notarization is scaffolded via `scripts/notarize.mjs` and runs when these env vars are set:
    - `APPLE_ID`
    - `APPLE_APP_SPECIFIC_PASSWORD`
    - `APPLE_TEAM_ID`

### Database Utilities

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

## License

MIT
