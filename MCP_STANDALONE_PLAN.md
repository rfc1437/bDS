# MCP Standalone CLI Plan

## Goal

Ship a bundled CLI tool (`bds-mcp`) alongside the Electron app that:

- Runs as a self-contained MCP server over **stdio** (for Claude Desktop, VS Code, etc.)
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
│                             │   │     │  ├── same engines                  │
│                             │   │     │  └── NotificationWatcher           │
│  PostEngine                 ├───┼─────┼──► SQLite (WAL mode, shared)       │
│  MediaEngine                │   │     │      posts / media / scripts …     │
│  ScriptEngine               │   │     │      db_notifications  ← new       │
│  TemplateEngine             │   │     └────────────────────────────────────┘
│  MCPServer (tools/res)      │   │                    ▲
│  ProposalStore (in-memory)  │   │           fs.watch(-wal) + 100 ms debounce
└─────────────────────────────┘   │           invalidate engines + IPC to renderer
                                  │
agent (Claude Desktop, VS Code…) ─┘
(stdio)
```

### Port mapping

| Context | Port | Transport |
|---|---|---|
| bDS app running | :4124 | HTTP (existing, unchanged) |
| `bds-mcp` CLI | — | stdio |

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

### C0 — Decouple `DatabaseConnection` from Electron

`src/main/database/connection.ts` currently imports `{ app } from 'electron'` for three
things: `app.getPath('userData')`, `app.isPackaged`, and `process.resourcesPath`. The CLI
cannot load this file at all without Electron present.

Refactor `DatabaseConnection` to accept explicit constructor arguments:

```typescript
interface DatabaseConnectionConfig {
  dbPath: string;           // absolute path to bds.db
  migrationsFolder: string; // absolute path to the drizzle/ migrations dir
  createDirs?: string[];    // extra directories to mkdir at startup
}
```

The Electron `main.ts` constructs it as today (computing paths via `app.getPath` before
passing them in). The CLI computes the same paths via `platformConfigPath()` and
`__dirname`-relative resolution from the bundle. All Electron imports are removed from
`connection.ts` itself.

This is a prerequisite for every CLI section that follows.

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

### E — Engine `invalidate()` API

No engine currently exposes a way to signal that its data is stale. Before
`NotificationWatcher` can be implemented, each engine that holds any in-memory state needs
an `invalidate(entityId?: string): void` method that clears the relevant cached entries
(or the whole cache when `entityId` is omitted), forcing a fresh DB read on the next
access. Engines that are already fully stateless (query DB on every call) get a no-op stub
so `NotificationWatcher` can call a uniform API.

Engines to update: `PostEngine`, `MediaEngine`, `ScriptEngine`, `TemplateEngine`.

---

### F — `NotificationWatcher` (new engine, app-side only)

`src/main/engine/NotificationWatcher.ts`

Uses `fs.watch()` on the SQLite WAL file (`bds.db-wal`) for near-instant change
detection instead of polling. When a write lands in WAL mode, the `-wal` file is modified
before a checkpoint; watching it gives sub-100 ms latency.

```typescript
export class NotificationWatcher {
  private dbWatcher: FSWatcher | null = null;
  private walWatcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dbPath: string,           // absolute path to bds.db
    private readonly db: DrizzleDB,
    private readonly engines: WatchableEngines,
    private readonly mainWindow: BrowserWindow,
    private readonly debounceMs = 100,
  ) {}

  start(): void {
    // Watch the main db file (catches checkpoints)
    this.dbWatcher = watch(this.dbPath, { persistent: false },
      () => this.schedule());

    // Watch the WAL file (catches every write in WAL mode)
    // The WAL file may not exist yet if no writes have occurred; we create
    // a short-lived retry watcher that tries once per second until the file
    // appears, at which point walWatcher is assigned and the retry cancels.
    this.attachWalWatcher();
  }

  private attachWalWatcher(): void {
    const walPath = this.dbPath + '-wal';
    try {
      this.walWatcher = watch(walPath, { persistent: false },
        () => this.schedule());
    } catch {
      // -wal does not exist yet; retry in 1 s
      setTimeout(() => this.attachWalWatcher(), 1000);
    }
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.process(), this.debounceMs);
  }

  private async process(): Promise<void> {
    const rows = await this.db
      .select()
      .from(dbNotifications)
      .where(and(
        isNull(dbNotifications.seenAt),
        eq(dbNotifications.origin, 'cli'),
      ));

    for (const row of rows) {
      this.engines[row.entity]?.invalidate(row.entityId);
      this.mainWindow.webContents.send(
        'entity:changed',
        { entity: row.entity, entityId: row.entityId, action: row.action },
      );
      await this.db
        .update(dbNotifications)
        .set({ seenAt: Date.now() })
        .where(eq(dbNotifications.id, row.id));
    }
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.dbWatcher?.close();
    this.walWatcher?.close();
  }
}
```

`WatchableEngines` is a plain record keyed by entity name (`post`, `media`, `script`,
`template`) mapping to objects that expose `invalidate()`. Started in `main.ts` alongside
`PreviewServer` and `MCPServer`; stopped in the `app.on('before-quit')` handler.

---

### G — `MCPServer.startCli()` (extend existing `MCPServer.ts`)

The App View's `app.callServerTool()` routes through the MCP host (Claude Desktop, VS
Code, etc.) over the **same** connection the server is on — it does not make a direct HTTP
call to a secondary endpoint. The CLI therefore needs exactly one server and one transport:

```typescript
async startCli(): Promise<void> {
  const server = this.createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep alive until the host closes stdin or the process receives a signal
  await new Promise<void>((resolve) => {
    process.stdin.on('close', resolve);
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });

  await server.close();
}
```

No secondary HTTP port. No `bds-mcp-base-url` meta tag. The `ProposalStore` is owned by
the single `MCPServer` instance as before.

---

### H — `src/cli/bds-mcp.ts` — CLI entrypoint (no Electron imports)

```
1. platformConfigPath() → userData dir
2. migrationsFolder = path.join(__dirname, '../drizzle')  // bundled alongside .cjs
3. new DatabaseConnection({ dbPath, migrationsFolder })
4. await db.initializeLocal()
5. SELECT active project (isActive = 1); exit with message if none
6. instantiate engines with CliNotifier DB writer
7. new MCPServer({ postEngine, mediaEngine, … })
8. await mcpServer.startCli()
```

No `electron` imports. Fully standalone Node process.

**Graceful shutdown** — register handlers *before* `startCli()` so cleanup runs on both
normal exit and forced signals:

```typescript
async function shutdown(db: DatabaseConnection, store: ProposalStore): Promise<void> {
  store.destroy();
  await db.close();   // flushes any in-flight @libsql writes
  process.exit(0);
}

process.once('SIGTERM', () => shutdown(db, mcpServer.proposalStore));
process.once('SIGINT',  () => shutdown(db, mcpServer.proposalStore));
process.once('beforeExit', () => shutdown(db, mcpServer.proposalStore));
```

(`startCli()` awaits `process.stdin` close / signal and then falls through to the same
cleanup, so shutdown runs exactly once with the `once` guards.)

---

### I — esbuild/Vite build target for CLI bundle

New build target in `vite.config.ts` (or `package.json` scripts):

```
src/cli/bds-mcp.ts → dist/cli/bds-mcp.cjs
target: node, format: cjs, bundle: true
```

The project uses `@libsql/client` with platform-specific native binaries (e.g.
`@libsql/darwin-arm64`). These **cannot** be bundled by esbuild. Externalize all
`@libsql/*` packages and ensure the platform binary directories are included alongside
the `.cjs` file in `extraResources`:

```
externals: ['@libsql/client', '@libsql/darwin-arm64', '@libsql/linux-x64-gnu', …]
```

Also bundle the `drizzle/` migrations folder next to `bds-mcp.cjs` so the path resolution
in section H (`path.join(__dirname, '../drizzle')`) works at runtime inside the app bundle.

Runs as part of `npm run build` before the Electron build.

---

### J — electron-builder `extraResources`

```json
"build": {
  "extraResources": [
    { "from": "dist/cli/bds-mcp.cjs",  "to": "bds-mcp.cjs" },
    { "from": "drizzle",               "to": "drizzle"    }
  ]
}
```

`bds-mcp.cjs` is placed at `Contents/Resources/bds-mcp.cjs`; the `drizzle/` migrations
folder is placed at `Contents/Resources/drizzle/` so the CLI migration resolver
(`path.join(__dirname, '../drizzle')`) resolves correctly from `Contents/Resources/`.

---

### K — `MCPAgentConfigEngine` — add Claude Desktop + stdio support + remove

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

### L — `ScriptEngine` / `TemplateEngine` — draft lifecycle methods

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

### M — `ProposalStore` — map proposals to DB row IDs

For `draftPost` proposals the store already maps `proposalId → postId` (the DB row). Extend
this consistently:

- `proposeScript` → maps `proposalId → scriptId` (DB row, `status: 'draft'`)
- `proposeTemplate` → maps `proposalId → templateId` (DB row, `status: 'draft'`)
- `proposeMediaMetadata` → stays in-memory (no draft DB row needed, metadata diff only)
- `proposePostMetadata` → stays in-memory (same reason)

`accept_proposal` dispatches to `publishScript` / `publishTemplate` / `publishPost` etc.
`discard_proposal` dispatches to `deleteDraftScript` / `deleteDraftTemplate` / `deletePost`.

**Known failure mode for in-memory metadata proposals:** if the CLI process is killed after
a `propose_media_metadata` or `propose_post_metadata` call but before accept/discard, the
`proposalId` no longer exists in any `ProposalStore`. The App View buttons will call
`accept_proposal` and receive `{ success: false, message: "Proposal … not found" }` —
this is already user-visible in the review UI. No silent corruption occurs; the post or
media item is simply unchanged. This is accepted as the trade-off for keeping metadata
proposals lightweight (no DB rows, no filesystem side effects).

---

## Design Decisions

| Question | Decision |
|---|---|
| Active project in CLI | Use `isActive = 1` from DB; fail fast if none |
| Proposal durability | Scripts/templates use DB draft rows; metadata proposals stay in-memory (failure mode documented in M) |
| App View tool calls in CLI mode | `app.callServerTool()` routes through the MCP host, not a direct HTTP call — no secondary port needed |
| Claude Desktop support | stdio via bundled `bds-mcp.cjs` + `ELECTRON_RUN_AS_NODE=1` |
| Remove from config | New `removeFromConfig()` method + Remove buttons in UI |
| DB change detection | `fs.watch()` on `-wal` file + 100 ms debounce; falls back to watching main db file on checkpoint |
| DB coupling to Electron | `DatabaseConnection` accepts explicit paths; Electron-specific path resolution stays in `main.ts` |

---

## Implementation Order (TDD per AGENTS.md)

1. **Migrations** (A + B) — schema changes first, all other work builds on them
2. **Decouple `DatabaseConnection` from Electron** (C0) — prerequisite for all CLI code; update existing DB tests to pass explicit paths
3. **`platformConfigPath()`** (C) — pure function, easy to test
4. **`CliNotifier` + DB writer** (D) — unit tests with mock DB
5. **Engine `invalidate()` API** (E) — add and test on each engine before NotificationWatcher
6. **`ScriptEngine`/`TemplateEngine` draft lifecycle** (L) — tests first
7. **`ProposalStore` DB mapping** (M) — extend existing tests
8. **`NotificationWatcher`** (F) — test with mock DB rows + mock `fs.watch` emitter
9. **`MCPAgentConfigEngine` — `claude-desktop` + `removeFromConfig`** (K) — extend existing tests
10. **`MCPServer.startCli()`** (G) — test with in-process `StdioServerTransport`
11. **`src/cli/bds-mcp.ts`** (H) — integration test: spawn process, send `initialize`, assert response, assert clean shutdown on SIGTERM
12. **Build target + `extraResources`** (I + J) — verify `npm run build` produces bundle and `drizzle/` is co-located
13. **UI: Remove buttons** — renderer component changes, follows K
14. **`NotificationWatcher` wired in `main.ts`** (F, app side) + stopped in `before-quit`

Each step: write failing test → implement → green → next.
