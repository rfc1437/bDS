# Blogging Desktop Server (bDS)

A desktop blogging application with offline-first capabilities.

## Features

- **Offline-First**: All data is stored locally in SQLite, works without internet
- **VS Code-Inspired UI**: Familiar, clean interface with activity bar, sidebar, and editor
- **Markdown Posts**: Write blog posts in Markdown with YAML frontmatter
- **Media Management**: Import and manage images with metadata sidecar files
- **Clean Architecture**: Engine classes handle business logic, UI is purely presentational

## Architecture

```
src/
├── main/                  # Electron main process
│   ├── database/         # Drizzle ORM schema and connection
│   ├── engine/           # Business logic engines
│   │   ├── PostEngine    # Post CRUD, file operations
│   │   ├── MediaEngine   # Media import/management
│   │   └── TaskManager   # Async task handling
│   ├── ipc/              # IPC handlers for renderer communication
│   └── main.ts           # App entry point
│
└── renderer/             # Electron renderer process (React)
    ├── components/       # UI components (VS Code style)
    ├── store/            # Zustand state management
    └── styles/           # Global CSS variables
```

## Data Storage

All user data is stored in the application's user data folder:

- **Database**: `{userData}/bds.db` - SQLite database with post/media metadata
- **Posts**: `{userData}/posts/*.md` - Markdown files with YAML frontmatter
- **Media**: `{userData}/media/` - Image files with `.meta` sidecar files

### Post Format

```markdown
---
id: uuid-here
title: "My Blog Post"
slug: my-blog-post
status: draft
author: John Doe
createdAt: 2024-01-15T10:30:00.000Z
updatedAt: 2024-01-15T10:30:00.000Z
tags: ["javascript", "tutorial"]
categories: ["development"]
---

# My Blog Post

Your markdown content here...
```

### Media Sidecar Format

```yaml
---
id: uuid-here
originalName: "photo.jpg"
mimeType: image/jpeg
size: 102400
width: 1920
height: 1080
alt: "A beautiful sunset"
caption: "Sunset over the mountains"
createdAt: 2024-01-15T10:30:00.000Z
updatedAt: 2024-01-15T10:30:00.000Z
tags: ["nature", "sunset"]
---
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Start development mode
npm run dev

# In another terminal, start Electron
npm start
```

### Building

```bash
# Build for production
npm run build

# Package for distribution (uses electron-builder)
npx electron-builder
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New Post |
| Ctrl+S | Save |
| Ctrl+B | Toggle Sidebar |
| Ctrl+J | Toggle Panel |
| Ctrl+1 | View Posts |
| Ctrl+2 | View Media |
| Ctrl+Shift+P | Publish Selected |

## License

MIT
