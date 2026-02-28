# MCP Standalone CLI Plan

## Goal

Ship a bundled CLI tool (`bds-mcp`) alongside the Electron app that:

- Runs as a self-contained MCP server over **stdio** (for Claude Desktop, VS Code, etc.)
- Spins up **HTTP :4125** alongside stdio for App View callbacks (same shared state)
- Works entirely against the **SQLite database** — no Electron process required
- Signals the running app of changes via a **`db_notifications`** table
- Is installed into agent configs by the app's existing agent-config UI (with add **and remove**)

---

## Architecture

```
┌─────────────────────────────────┐     ┌────────────────────────────────────┐
│  bds-mcp  (bundled CLI binary)  │     │  bDS Electron app                  │
│                                 │     │                                    │
│  StdioServerTransport ──────┐   │     │  HTTP MCPServer :4124              │
│  StreamableHTTP :4125 ──────┤   │     │  ├── same engines                  │
│                             │   │     │  └── NotificationWatcher           │
│  PostEngine                 ├───┼─────┼──► SQLite (WAL mode, shared)       │
│  MediaEngine                │   │     │      posts / media / scripts …     │
│  ScriptEngine               │   │     │      db_notifications  ← new       │
│  TemplateEngine             │   │     └────────────────────────────────────┘
│  MCPServer (tools/res)      │   │                    ▲
│  ProposalStore (in-memory)  │   │           setInterval polls
└─────────────────────────────┘   │           refresh caches + IPC to renderer
                                  │
agent (Claude Desktop, VS Code…) ─┘
(stdio)
```

### Port mapping

| Context | Port | Transport |
|---|---|---|
| bDS app running | :4124 | HTTP (existing, unchanged) |
| CLI stdio mode — agent | — | stdio |
| CLI stdio mode — App View callbacks | :4125 | HTTP |

---

## Required Changes

### A — `db_notifications` table (new Drizzle migration)

```sql
CREATE TABLE db_notifications (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,    -- 'post' | 'media' | 'script' | 'template'
  entityId  TEXT NOT NULL,
  action    TEXT NOT NULL,    -- 'created' | 'updated' | 'deleted'
  origin    TEXT NOT NULL,    -- 'cli' | 'app'
  seenAt    INTEGER,          -- NULL = unprocessed by app
  createdAt INTEGER NOT NULL
);
```

The CLI writes a row after every mutation. The app's `NotificationWatcher` polls for
`seenAt IS NULL AND origin = 'cli'`, refreshes the relevant engine cache, emits IPC
events to the renderer, then stamps `seenAt`.

---

### B — Draft mode for scripts and templates (new Drizzle migration)

Scripts and templates currently write the file immediately on create. To allow CLI-created
proposals to be durable (survive CLI restarts) without polluting the filesystem until
accepted, add the same draft pattern that posts already use.

```sql
-- scripts
ALTER TABLE scripts ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published'));
ALTER TABLE scripts ADD COLUMN content TEXT;  -- draft body; NULL when on-disk

-- templates
ALTER TABLE templates ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published'));
ALTER TABLE templates ADD COLUMN content TEXT;  -- draft body; NULL when on-disk
```

Behaviour:
- **`propose_script` / `propose_template`** → `INSERT` with `status: 'draft'`, body in
  `content`, `filePath: ''` — no file written yet; `ProposalStore` maps
  `proposalId → rowId`
- **`accept_proposal`** → write file to disk, set `status: 'published'`, clear `content`
- **`discard_proposal`** → `DELETE` the row (never touched the filesystem)

---

### C — `platformConfigPath()` — userData without Electron (`src/cli/platform.ts`)

Pure-Node helper to resolve the same path as Electron's `app.getPath('userData')`:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Blogging Desktop Server` |
| Windows | `%APPDATA%\Blogging Desktop Server` |
| Linux | `~/.config/Blogging Desktop Server` |

Used by the CLI entrypoint to find the SQLite database without loading Electron.

---

### D — `CliNotifier` interface + injected DB writer

```typescript
interface CliNotifier {
  notify(entity: string, id: string, action: 'created' | 'updated' | 'deleted'): Promise<void>;
}
```

- Electron app passes a no-op implementation (keeps engines clean, no code change needed
  in the app path)
- CLI passes a DB writer implementation that inserts into `db_notifications`

Injected as an optional constructor argument on `PostEngine`, `ScriptEngine`,
`TemplateEngine`, `MediaEngine`.

---

### E — `NotificationWatcher` (new engine, app-side only)

`src/main/engine/NotificationWatcher.ts`

- `setInterval` polling every 2 s
- Reads `db_notifications WHERE seenAt IS NULL AND origin = 'cli'`
- For each row: invalidates the relevant engine's cache, calls
  `mainWindow.webContents.send('entity:changed', { entity, entityId, action })`
- Stamps `seenAt = Date.now()` on processed rows
- Started in `main.ts` alongside `PreviewServer` and `MCPServer`

---

### F — `MCPServer.startCli()` (extend existing `MCPServer.ts`)

```typescript
async startCli(appViewsPort = 4125): Promise<void> {
  // 1. Stdio transport — primary agent connection
  const stdioTransport = new StdioServerTransport();
  const stdioMcp = this.createServer({ mode: 'cli', appViewsPort });
  await stdioMcp.connect(stdioTransport);

  // 2. HTTP :4125 — App View callbacks, same ProposalStore
  await this.startHttp(appViewsPort, { mode: 'cli' });
}
```

Both `McpServer` instances are created via the same `createServer()` factory sharing the
same `ProposalStore` instance. App View HTML receives the `:4125` base URL injected as a
`<meta name="bds-mcp-base-url">` tag at render time so `callServerTool()` points to the
right endpoint regardless of mode.

---

### G — `src/cli/bds-mcp.ts` — CLI entrypoint (no Electron imports)

```
1. platformConfigPath() → userData dir
2. getDatabase(path.join(userData, 'bds.db'))
3. SELECT active project (isActive = 1); exit with message if none
4. instantiate engines with CliNotifier DB writer
5. new MCPServer({ postEngine, mediaEngine, … })
6. mcpServer.startCli()
```

No `electron` imports. Fully standalone Node process.

---

### H — esbuild/Vite build target for CLI bundle

New build target in `vite.config.ts` (or `package.json` scripts):

```
src/cli/bds-mcp.ts → dist/cli/bds-mcp.cjs
target: node, format: cjs, bundle: true
externals: native modules only (better-sqlite3)
```

Runs as part of `npm run build` before the Electron build.

---

### I — electron-builder `extraResources`

```json
"build": {
  "extraResources": [
    { "from": "dist/cli/bds-mcp.cjs", "to": "bds-mcp.cjs" }
  ]
}
```

Placed at `Contents/Resources/bds-mcp.cjs` in the macOS app bundle.

---

### J — `MCPAgentConfigEngine` — add Claude Desktop + stdio support + remove

#### New agent type

```typescript
export type MCPAgentId =
  | 'claude-code'
  | 'claude-desktop'       // ← NEW (stdio)
  | 'github-copilot'
  | 'gemini-cli'
  | 'opencode';
```

#### Extended options

```typescript
export interface MCPAgentConfigOptions {
  homeDir: string;
  platform: NodeJS.Platform;
  mcpUrl: string;
  // stdio agents (set from app at runtime)
  execPath: string;    // process.execPath (packaged) or 'node' (dev)
  scriptPath: string;  // path to bds-mcp.cjs
}
```

#### Claude Desktop entry

```typescript
case 'claude-desktop':
  return {
    command: this.execPath,
    args: [this.scriptPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
```

Config file path:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

#### Remove from config (new method)

```typescript
removeFromConfig(agentId: MCPAgentId): AgentConfigResult
```

- Reads the config file
- Deletes `config[serversKey][SERVER_NAME]`
- If `serversKey` object is now empty, removes the key entirely
- Writes back; returns `{ success, configPath }`
- No-ops gracefully if file or entry does not exist

This powers **Remove** buttons in the agent-config UI alongside the existing **Add**
buttons, so users never have to hunt down config files manually.

---

### K — `ScriptEngine` / `TemplateEngine` — draft lifecycle methods

New methods on each engine:

```typescript
// ScriptEngine
createDraftScript(data: CreateScriptInput): Promise<ScriptData>   // status: 'draft', no file
publishScript(id: string): Promise<ScriptData | null>              // write file, status: 'published'
deleteDraftScript(id: string): Promise<boolean>                    // only if status: 'draft'

// TemplateEngine
createDraftTemplate(data: CreateTemplateInput): Promise<TemplateData>
publishTemplate(id: string): Promise<TemplateData | null>
deleteDraftTemplate(id: string): Promise<boolean>
```

---

### L — `ProposalStore` — map proposals to DB row IDs

For `draftPost` proposals the store already maps `proposalId → postId` (the DB row). Extend
this consistently:

- `proposeScript` → maps `proposalId → scriptId` (DB row, `status: 'draft'`)
- `proposeTemplate` → maps `proposalId → templateId` (DB row, `status: 'draft'`)
- `proposeMediaMetadata` → stays in-memory (no draft DB row needed, metadata diff only)
- `proposePostMetadata` → stays in-memory (same reason)

`accept_proposal` dispatches to `publishScript` / `publishTemplate` / `publishPost` etc.
`discard_proposal` dispatches to `deleteDraftScript` / `deleteDraftTemplate` / `deletePost`.

---

## Unresolved Questions

None — all design decisions resolved:

| Question | Decision |
|---|---|
| Active project in CLI | Use `isActive = 1` from DB; fail fast if none |
| Proposal durability | Scripts/templates use DB draft rows; metadata proposals stay in-memory |
| App View URL in CLI mode | Injected as `<meta name="bds-mcp-base-url">` at render time |
| Claude Desktop support | stdio via bundled `bds-mcp.cjs` + `ELECTRON_RUN_AS_NODE=1` |
| Remove from config | New `removeFromConfig()` method + Remove buttons in UI |

---

## Implementation Order (TDD per AGENTS.md)

1. **Migrations** (A + B) — schema changes first, all other work builds on them
2. **`platformConfigPath()`** (C) — pure function, easy to test
3. **`CliNotifier` + DB writer** (D) — unit tests with mock DB
4. **`ScriptEngine`/`TemplateEngine` draft lifecycle** (K) — tests first
5. **`ProposalStore` DB mapping** (L) — extend existing tests
6. **`NotificationWatcher`** (E) — test with mock DB rows
7. **`MCPAgentConfigEngine` — `claude-desktop` + `removeFromConfig`** (J) — extend existing tests
8. **`MCPServer.startCli()`** (F) — test with in-process transports
9. **`src/cli/bds-mcp.ts`** (G) — integration test: spawn, send `initialize`, assert response
10. **Build target + `extraResources`** (H + I) — verify `npm run build` produces bundle
11. **UI: Remove buttons** — renderer component changes, follows J
12. **`NotificationWatcher` wired in `main.ts`** (E, app side)

Each step: write failing test → implement → green → next.
