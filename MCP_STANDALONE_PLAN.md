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
│  ProposalStore (in-memory)  │   │           chokidar(-wal) + 100 ms debounce
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
  fromCli   INTEGER NOT NULL DEFAULT 1,  -- 1 = written by CLI; reserved for future app→CLI signalling
  seenAt    INTEGER,          -- NULL = unprocessed by app
  createdAt INTEGER NOT NULL
);
```

The CLI writes a row after every mutation. The app's `NotificationWatcher` queries for
`seenAt IS NULL AND fromCli = 1`, invalidates the relevant engine cache, emits IPC events
to the renderer, stamps `seenAt`, then **prunes rows in two passes** to prevent unbounded
table growth:
- rows whose `seenAt` is older than 1 hour (already processed by the app)
- rows whose `seenAt IS NULL AND createdAt` is older than 24 hours (stale unprocessed rows
  written while the app was closed — they will never be read)

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
  dataDirs?: string[];      // extra directories to mkdir at startup (posts/, media/, etc.)
}
```

Four things must move out of `connection.ts` into `main.ts` (or equivalent callers):

1. `app.getPath('userData')` in the constructor — replaced by the explicit `dbPath`
2. `app.isPackaged` + `process.resourcesPath` in `runMigrations()` — replaced by
   the explicit `migrationsFolder`
3. The `posts/` and `media/` `mkdirSync` calls in the constructor — absorbed into  
   the new `dataDirs` option (caller supplies the list)
4. **`getDataPaths()`** — this method also calls `app.getPath('userData')` directly and
   must be removed from `DatabaseConnection` entirely. Move callers to compute data
   paths themselves (they already have `userData` in scope in `main.ts`).

The Electron `main.ts` constructs it as today, computing paths via `app.getPath` before
passing them in. The CLI uses `platformConfigPath()` and `__dirname`-relative resolution.
All Electron imports are removed from `connection.ts` itself.

**WAL mode and synchronous pragma** — add to `initializeLocal()` immediately after
creating the client, before running migrations:

```typescript
await this.localClient.execute('PRAGMA journal_mode=WAL');
await this.localClient.execute('PRAGMA synchronous=NORMAL');
```

This must be done for **both** the app and CLI connections. It ensures the `-wal` file
exists (enabling chokidar to watch it) and gives consistent write performance. Note that
`PRAGMA journal_mode=WAL` is a one-way change — SQLite persists the mode in the database
file itself. Existing users upgrading from a non-WAL build will have their `bds.db`
converted automatically on first launch of the new version. This is safe and desirable.

**Engines also import Electron directly** — `PostEngine`, `MediaEngine`, `ScriptEngine`,
`TemplateEngine`, `TagEngine`, `MetaEngine`, `MenuEngine` all call `app.getPath('userData')`
directly. These imports are **not** removed as part of C0. When the CLI runs under
`ELECTRON_RUN_AS_NODE=1`, the `electron` module is available and `app.getPath('userData')`
returns the correct platform path without requiring `app.whenReady()`. Full decoupling of
individual engines from Electron is a separate future refactor; it is not a prerequisite
for the CLI. The reason this works is that the app name is embedded in the Electron binary,
so the path derivation is purely a function of the OS and binary name — no GUI subsystem
is needed.

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

### D — `CliNotifier` interface + explicit engine construction

```typescript
interface CliNotifier {
  notify(entity: string, id: string, action: 'created' | 'updated' | 'deleted'): Promise<void>;
}
```

`CliNotifier` has two implementations:
- **`NoopNotifier`** — used by the Electron app; all mutations are no-ops
- **`DbNotifier`** — used by the CLI; inserts a row into `db_notifications`

#### Replacing singletons with explicit construction

The current `getPostEngine()`, `getScriptEngine()`, `getTemplateEngine()`,
`getMediaEngine()` etc. are module-level singletons constructed on first access. There is
no mechanism to pass constructor-time options (such as a `CliNotifier`) into them, which
makes clean DI impossible without global mutation.

This section replaces those factories with **explicit construction** at the two entry
points (`main.ts` for the app, `bds-mcp.ts` for the CLI):

1. Each engine class gains an optional `notifier?: CliNotifier` constructor parameter
   (default: `NoopNotifier`). Every mutating method calls `this.notifier.notify(...)` after
   its DB write.

2. The module-level singleton variables (`let postEngine: PostEngine | null = null`) and
   their associated `getPostEngine()` factory functions are **removed** from each engine
   file.

3. **`main.ts`** constructs all engines explicitly, passing `NoopNotifier`, then passes
   them into `registerIpcHandlers()` and `MCPServer` as explicit arguments (already the
   pattern for `MCPServerDependencies`).

4. **`src/cli/bds-mcp.ts`** constructs its own engine instances, passing `DbNotifier`,
   and passes them into `MCPServer`.

5. **`src/main/ipc/handlers.ts`** `registerIpcHandlers()` signature gains an engine
   bundle parameter (same shape as `MCPServerDependencies`, or a shared type
   `EngineBundle`). All `getXxxEngine()` calls inside handlers are replaced by accesses to
   the injected bundle.

This is the architecturally sound path: it eliminates hidden global state, makes the
engine lifecycle explicit and testable, and removes the need for the global `electron` mock
in `tests/setup.ts` for engines that no longer import it.

> **Scope note:** `ProjectEngine`, `MenuEngine`, `TagEngine`, `MetaEngine`,
> `PostMediaEngine`, `GitEngine`, `ImportExecutionEngine`, `TaskManager`, and
> `AppApiAdapter` are **not** required by the CLI and do not need `CliNotifier`. They
> follow the same explicit-construction refactor only to be consistent (they lose their
> singleton factories too), but their `CliNotifier` parameter is omitted.

**Cross-engine coupling — hidden singleton calls that must be wired up.** Several engines
that are not directly called by the CLI still pull other engines through the deleted
singleton factories internally:

| Engine | Internal call |
|---|---|
| `TagEngine` | `getPostEngine().syncPublishedPostFile()` |
| `PostMediaEngine` | `getMediaEngine()` — 8 call sites |
| `MetadataDiffEngine` | `getPostEngine()` |
| `BlogGenerationEngine` | `getPostEngine()` |
| `BlogmarkTransformService` | `getScriptEngine()` |

Removing the singleton factories without wiring these calls will produce compile errors.
Each of these classes must gain a constructor parameter for the engine it depends on, and
`main.ts` must inject the already-constructed instance. This is additional — but
mechanical — work within this same step.

**`MCPServerDependencies` shape change.** The current interface uses lazy getter functions
(`getPostEngine: () => PostEngineContract`). After engines are constructed explicitly at
startup, wrapping them in getters is pointless overhead. The interface should become direct
properties (`postEngine: PostEngineContract`). All callers inside `MCPServer.ts` change
from `this.deps.getPostEngine().method()` to `this.deps.postEngine.method()`. This is a
mechanical find-and-replace across `MCPServer.ts` and `main.ts` — do it as part of step D.

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

Uses **chokidar** (already in `dependencies`) to watch both `bds.db` and `bds.db-wal`.
This gives sub-100 ms latency with zero boilerplate: chokidar handles missing files (the
`-wal` file doesn't exist until the first write after WAL mode is enabled), platform
differences (FSEvents on macOS, inotify on Linux, FSWatch on Windows), and
`add` events for when the WAL file is created for the first time.

```typescript
import chokidar, { FSWatcher } from 'chokidar';

export class NotificationWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dbPath: string,           // absolute path to bds.db
    private readonly db: DrizzleDB,
    private readonly engines: WatchableEngines,
    private readonly mainWindow: BrowserWindow,
    private readonly debounceMs = 100,
  ) {}

  start(): void {
    // Watch both the main db file (catches checkpoints) and the WAL file
    // (catches every write before checkpoint). chokidar handles the case
    // where bds.db-wal does not yet exist — it fires 'add' when it appears.
    this.watcher = chokidar.watch(
      [this.dbPath, `${this.dbPath}-wal`],
      {
        persistent: false,
        ignoreInitial: true,   // don't fire on startup for pre-existing files
        usePolling: false,     // rely on native FSEvents/inotify/kqueue
        awaitWriteFinish: false,
      },
    );
    this.watcher.on('change', () => this.schedule());
    this.watcher.on('add',    () => this.schedule()); // WAL created for first time
  }

  private isProcessing = false;

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.process(), this.debounceMs);
  }

  private async process(): Promise<void> {
    // Re-entry guard: seenAt updates trigger chokidar again; skip if already running.
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const rows = await this.db
        .select()
        .from(dbNotifications)
        .where(and(
          isNull(dbNotifications.seenAt),
          eq(dbNotifications.fromCli, 1),
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

      const now = Date.now();
      // Prune rows processed more than 1 hour ago.
      await this.db
        .delete(dbNotifications)
        .where(lt(dbNotifications.seenAt, now - 3_600_000));
      // Prune unprocessed rows older than 24 hours (written while app was closed).
      await this.db
        .delete(dbNotifications)
        .where(and(
          isNull(dbNotifications.seenAt),
          lt(dbNotifications.createdAt, now - 86_400_000),
        ));
    } finally {
      this.isProcessing = false;
    }
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close().catch(() => {});
  }
}
```

`WatchableEngines` is a plain record keyed by entity name (`post`, `media`, `script`,
`template`) mapping to objects that expose `invalidate()`. Started in `main.ts` alongside
`PreviewServer` and `MCPServer`; stopped in the `app.on('before-quit')` handler.

**The watcher fires on every DB write, not only CLI writes.** chokidar sees all changes to
`bds.db` / `bds.db-wal`, including writes the Electron app makes itself (UI post creation,
media import, etc.). Each write triggers the 100 ms debounce and then `process()`, which
queries `db_notifications` for `seenAt IS NULL AND fromCli = 1`. When no CLI is running
that query returns zero rows and the function exits immediately — this is a single cheap
indexed SELECT. Do not try to "optimise" the watcher by making it conditional on CLI
presence; that would break notification delivery.

**`seenAt` writes are themselves DB writes** that fire chokidar again. The `isProcessing`
flag prevents the resulting re-entrant call from doing any work — it returns immediately
and the debounce timer is not rescheduled. This bounds the feedback to one extra no-op
debounce per notification batch, not a loop.

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

  // Block until the MCP host closes stdin (normal session end).
  // Signal-based shutdown is the caller's responsibility: do NOT register
  // signal handlers here or they will race with the bds-mcp.ts handlers.
  await new Promise<void>((resolve) => {
    process.stdin.on('close', resolve);
  });

  await server.close();
}
```

No secondary HTTP port. No `bds-mcp-base-url` meta tag. The `ProposalStore` is owned by
the single `MCPServer` instance as before.

**App View host compatibility.** The proposal-review HTML (`reviewPostHtml`, etc.) is
rendered through the `@modelcontextprotocol/ext-apps` App View protocol. This interactive
panel is supported by Claude Desktop and Claude Code. Other MCP hosts (VS Code agent mode,
Gemini CLI, OpenCode) may not implement the ext-apps spec and will show the raw HTML as
text, or ignore the resource entirely. This is acceptable: `accept_proposal` and
`discard_proposal` are plain MCP tool calls that work in any conformant host — the HTML
panel is a convenience layer on top, not a requirement.

---

### H — `src/cli/bds-mcp.ts` — CLI entrypoint (no Electron imports)

```
1. platformConfigPath() → userData dir
2. dbPath = path.join(userData, 'bds.db')
3. migrationsFolder = path.join(__dirname, 'drizzle')  // Contents/Resources/drizzle/
4. new DatabaseConnection({ dbPath, migrationsFolder, dataDirs: [postsDir, mediaDir] })
5. await db.initializeLocal()  // runs WAL + synchronous pragmas, then migrations
6. SELECT active project (isActive = 1); exit with message if none
7. instantiate engines with CliNotifier DB writer
8. new MCPServer({ postEngine, mediaEngine, … }, { proposalTtlMs: 8 * 60 * 60 * 1000 })
9. await mcpServer.startCli()   // blocks until stdin closes
10. await shutdown()            // graceful post-stdin exit
```

`MCPServer` should accept an optional `proposalTtlMs` to override the default 30-minute
TTL. CLI sessions can last hours (overnight agent runs), so **8 hours** is the appropriate
default. Pass `proposalTtlMs` through to the `ProposalStore` constructor.

No `electron` imports. Fully standalone Node process.

**Graceful shutdown** — two paths, no racing:

```typescript
// Called both by signal handlers (forced) and after normal stdin-close (graceful).
// process.exit() makes it non-reentrant even without the once guards.
async function shutdown(): Promise<never> {
  await mcpServer.cleanup();  // proposalStore.destroy() + stop() (no-op for stdio, safe)
  await db.close();           // flushes any in-flight @libsql writes
  process.exit(0);
}

// Signal handlers own interruption; registered before startCli() so they are
// active during the entire session.  Do NOT register signals inside startCli().
process.once('SIGTERM', shutdown);
process.once('SIGINT',  shutdown);

// Normal path: stdin closes → startCli() resolves → server.close() runs → shutdown()
await mcpServer.startCli();
await shutdown();
```

When SIGTERM fires, `shutdown()` runs and calls `process.exit(0)` — `startCli()` never
resumes, `server.close()` is skipped (safe: the process is exiting anyway). When stdin
closes cleanly, `startCli()` resumes, `server.close()` runs first, then `shutdown()`
exits. The `once` guards and `process.exit` together make the function non-reentrant.

**Native module resolution** — When launched as `ELECTRON_RUN_AS_NODE=1`, Electron's
ASAR patching is still active, so `require('@libsql/client')` resolves into
`app.asar/node_modules`. This is a documented side-effect of `ELECTRON_RUN_AS_NODE` that
has been stable since Electron 20. Add an integration test that verifies the module
resolves and the DB opens successfully from the bundled path; if a future Electron major
breaks this, the test will catch it early.

---

### I — esbuild/Vite build target for CLI bundle

New build target in `vite.config.ts` (or `package.json` scripts):

```
src/cli/bds-mcp.ts → dist/cli/bds-mcp.cjs
target: node, format: cjs, bundle: true
```

The project uses `@libsql/client` with platform-specific native binaries (e.g.
`@libsql/darwin-arm64`). These **cannot** be bundled by esbuild. Externalize all
`@libsql/*` and `chokidar`-related native packages, and ensure they resolve at runtime
from the app bundle (see the ASAR resolution note in section H):

```
externals: ['@libsql/client', '@libsql/darwin-arm64', '@libsql/linux-x64-gnu',
            'chokidar', 'fsevents', …]
```

The `drizzle/` migrations folder does **not** need to be re-bundled alongside the `.cjs`
file — it is already included in `extraResources` (see J). The path resolution
`path.join(__dirname, 'drizzle')` resolves correctly when `bds-mcp.cjs` sits at
`Contents/Resources/bds-mcp.cjs` and `drizzle/` is at `Contents/Resources/drizzle/`.

Runs as part of `npm run build` before the Electron build.

---

### J — electron-builder `extraResources`

The `{ "from": "drizzle", "to": "drizzle" }` entry **already exists** in `package.json`.
Only the CLI bundle itself needs to be added:

```json
"build": {
  "extraResources": [
    { "from": "dist/cli/bds-mcp.cjs",  "to": "bds-mcp.cjs" }
    // { "from": "drizzle", "to": "drizzle" }  ← already present, do not duplicate
  ]
}
```

`bds-mcp.cjs` lands at `Contents/Resources/bds-mcp.cjs`; `drizzle/` is already at
`Contents/Resources/drizzle/`. The CLI migration resolver `path.join(__dirname, 'drizzle')`
resolves `Contents/Resources/drizzle/` correctly from that location.

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
  // stdio agents only — required when agentId is 'claude-desktop', unused otherwise
  execPath?: string;    // process.execPath (packaged) or 'node' (dev)
  scriptPath?: string;  // path to bds-mcp.cjs
}
```

Both fields are optional so all existing callers (which only pass `homeDir`, `platform`,
`mcpUrl`) continue to compile without changes. `buildEntry('claude-desktop')` asserts
both are truthy and throws a descriptive error if called without them — this is a
programmer error, not a user error.

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

> **Note:** Verify the current OpenCode config schema before implementing the `opencode`
> entry — the format has changed between releases. Check the live spec at
> https://opencode.ai/docs before writing the `buildEntry` case.

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

> **Also update `ScriptEngineContract` and `TemplateEngineContract` in `MCPServer.ts`.**
> The interfaces currently only declare `createScript` / `createTemplate` / `validateScript`
> / `validateTemplate`. After this step, `acceptProposal` and `discardProposal` call
> `publishScript`, `deleteDraftScript`, `publishTemplate`, `deleteDraftTemplate` — all of
> which must be added to the respective contract interfaces, or `MCPServer.ts` will not
> compile. Do this as part of the same step.

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

**Impact on `MCPServer.acceptProposal()` and `discardProposal()`:** the current
implementations read the full `CreateScriptInput` / `CreateTemplateInput` payload from the
in-memory `ProposalStore` then call `createScript()` / `createTemplate()`. After this
change, `ProposalStore` for those types holds only `{ scriptId }` / `{ templateId }`
(the DB row ID), and the dispatch must call `publishScript(scriptId)` /
`publishTemplate(templateId)` instead. Similarly, `discardProposal` for these types must
call `deleteDraftScript(scriptId)` / `deleteDraftTemplate(templateId)` to clean up the DB
row — not just `proposalStore.remove()`. These updates to `MCPServer.ts` are part of this
step, not a separate one.

**`ProposalStore` TTL expiry must call back to clean up draft DB rows.** The existing
`setInterval` cleanup in `ProposalStore` calls `proposals.delete(id)` in-memory but knows
nothing about the `scriptId` / `templateId` DB row it points to. If a `proposeScript` or
`proposeTemplate` proposal expires without being accepted or discarded, the `status='draft'`
DB row is orphaned forever.

Fix: add an optional `onExpiry` callback to `ProposalStore`:

```typescript
class ProposalStore {
  constructor(
    ttlMs: number = DEFAULT_TTL_MS,
    private readonly onExpiry?: (proposal: Proposal) => void,
  ) { … }

  cleanup(): void {
    const now = Date.now();
    for (const [id, proposal] of this.proposals) {
      if (now - proposal.createdAt > this.ttlMs) {
        this.onExpiry?.(proposal);
        this.proposals.delete(id);
      }
    }
  }
}
```

`MCPServer` passes an `onExpiry` handler at construction time that dispatches
`deleteDraftScript` / `deleteDraftTemplate` for the relevant proposal types (using the
`scriptId` / `templateId` stored in `proposal.data`). `draftPost`, metadata proposals, and
all other types are no-ops in the handler. Wire this in step 6 (ProposalStore TTL option)
before step 7 (draft lifecycle methods).

**Known failure mode for in-memory metadata proposals:** if the CLI process is killed after
a `propose_media_metadata` or `propose_post_metadata` call but before accept/discard, the
`proposalId` no longer exists in any `ProposalStore`. The App View buttons will call
`accept_proposal` and receive `{ success: false, message: "Proposal … not found" }` —
this is already user-visible in the review UI. No silent corruption occurs; the post or
media item is simply unchanged. This is accepted as the trade-off for keeping metadata
proposals lightweight (no DB rows, no filesystem side effects).

---

### N — Renderer: subscribe to `entity:changed` IPC events

The app's UI must reflect changes the CLI makes while the app is open. `NotificationWatcher`
fires `entity:changed` IPC events (section F), but nothing currently handles them in the
renderer.

**`preload.ts`** — expose the channel alongside existing IPC listeners:

```typescript
onEntityChanged: (cb: (payload: EntityChangedPayload) => void) =>
  ipcRenderer.on('entity:changed', (_, payload) => cb(payload)),
```

**Renderer subscription** — in the top-level app component (or a dedicated `IpcListener`
component that mounts once), subscribe on mount and unsubscribe on unmount:

```typescript
useEffect(() => {
  const unsub = window.api.onEntityChanged(({ entity, entityId, action }) => {
    // Dispatch store invalidation so the next render fetches fresh data
    if (entity === 'post')     postsStore.getState().invalidate(entityId);
    if (entity === 'media')    mediaStore.getState().invalidate(entityId);
    if (entity === 'script')   scriptsStore.getState().invalidate(entityId);
    if (entity === 'template') templatesStore.getState().invalidate(entityId);
  });
  return () => unsub();
}, []);
```

Store `invalidate()` methods should clear the cached entry and, if the entity is
currently displayed, trigger an immediate refetch — consistent with how other
IPC-driven refreshes work in the app.

**These `invalidate()` methods do not currently exist in any Zustand store.** The
renderer's stores today are push-based: the main process fires granular IPC events
(`post:created`, `post:updated`, `post:deleted`, etc.) that the renderer applies directly.
The `entity:changed` channel carries only `{ entity, entityId, action }` — enough to
route, but not the full object. Each store therefore needs:
1. An `invalidate(id: string)` action that removes the stale item from local state
2. A subsequent IPC fetch call (e.g. `window.electronAPI.posts.get(id)`) to reload it

This is non-trivial cross-cutting work and should be its own implementation step.

---

## Design Decisions

| Question | Decision |
|---|---|
| Active project in CLI | Use `isActive = 1` from DB; fail fast if none |
| Proposal durability | Scripts/templates use DB draft rows; metadata proposals stay in-memory (failure mode documented in M) |
| Proposal TTL | 30 min default in app; **8 hours** in CLI (overnight agent sessions) |
| App View tool calls in CLI mode | `app.callServerTool()` routes through the MCP host, not a direct HTTP call — no secondary port needed |
| Claude Desktop support | stdio via bundled `bds-mcp.cjs` + `ELECTRON_RUN_AS_NODE=1` (entitlements already set) |
| Remove from config | New `removeFromConfig()` method + Remove buttons in UI |
| DB change detection | **chokidar** on both `bds.db` and `bds.db-wal`; 100 ms debounce; handles missing WAL via `add` events |
| WAL mode | Explicit `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL` in `initializeLocal()` for both app and CLI |
| `db_notifications` growth | Rows pruned after `seenAt` is 1 hour old, inside each `process()` call |
| DB coupling to Electron | `DatabaseConnection` accepts explicit paths; `getDataPaths()` removed; Electron path resolution stays in `main.ts` |
| Engine Electron coupling | Engines retain `app.getPath('userData')` calls — safe under `ELECTRON_RUN_AS_NODE=1`; full decoupling is a future task |
| Engine singletons | Replaced with explicit construction at `main.ts` / `bds-mcp.ts`; `getXxxEngine()` factories removed (section D) |
| Native module resolution | `ELECTRON_RUN_AS_NODE` inherits Electron ASAR require-hooking; integration test guards against regression |
| Signal handling | Signal handlers in `bds-mcp.ts` only; `startCli()` only listens to stdin-close — no competing handlers |
| CLI shutdown | `mcpServer.cleanup()` (not direct `proposalStore.destroy()`) then `db.close()` then `process.exit(0)` |
| Renderer live updates | Section N: `entity:changed` IPC → store `invalidate()` + refetch; `invalidate()` methods must be added to each store |
| Watcher fire rate | chokidar fires on every DB write (app + CLI); `process()` no-ops with a cheap indexed SELECT when no CLI rows are pending |
| Watcher re-entry | `isProcessing` flag prevents double-processing when `seenAt` writes re-trigger chokidar |
| Stale unprocessed rows | Pruned after 24h (app was closed); processed rows pruned after 1h — both inside the same `process()` call |
| Cross-engine coupling | `TagEngine`, `PostMediaEngine`, `MetadataDiffEngine`, `BlogGenerationEngine`, `BlogmarkTransformService` use deleted singleton calls internally; must be given injected deps in step D |
| `MCPServerDependencies` shape | Lazy getters (`getPostEngine: () => …`) → direct properties (`postEngine: …`) after step D; mechanical find-and-replace in `MCPServer.ts` and `main.ts` |
| `ScriptEngineContract` / `TemplateEngineContract` | Must add draft lifecycle method signatures in step L to avoid compile errors in `MCPServer.ts` |
| `ProposalStore` TTL + draft DB rows | `onExpiry` callback lets `MCPServer` clean up `status='draft'` DB rows when a `proposeScript`/`proposeTemplate` proposal expires without accept/discard |
| App View host support | Interactive review HTML only renders in hosts implementing `@modelcontextprotocol/ext-apps`; `accept_proposal`/`discard_proposal` work as plain tool calls in all hosts |

---

## Implementation Order (TDD per AGENTS.md)

1. **Migrations** (A + B) — schema changes first, all other work builds on them
2. **Decouple `DatabaseConnection` from Electron** (C0) — remove `app` import, move `getDataPaths()` to callers, add WAL pragmas; update existing DB tests to pass explicit paths
3. **`platformConfigPath()`** (C) — pure function, easy to test
4. **Explicit engine construction + `CliNotifier`** (D) — remove all `getXxxEngine()` singletons; add explicit construction in `main.ts`; update `registerIpcHandlers()` signature; add `CliNotifier` constructor arg to the four mutating engines; unit-test `DbNotifier` with mock DB. Also inject deps into the five cross-engine callers (`TagEngine`, `PostMediaEngine`, `MetadataDiffEngine`, `BlogGenerationEngine`, `BlogmarkTransformService`) and change `MCPServerDependencies` from lazy getters to direct properties. This is the largest single step — sequence it early because every later step depends on the new construction pattern.
5. **Engine `invalidate()` API** (E) — add and test on each engine before NotificationWatcher
6. **`ProposalStore` TTL option + `onExpiry` callback** (M, partial) — add `proposalTtlMs` constructor arg; add `onExpiry?: (proposal: Proposal) => void` callback invoked from `cleanup()` before deletion; extend existing tests; the DB mapping part of M and the `MCPServer` wiring of `onExpiry` comes after L
7. **`ScriptEngine`/`TemplateEngine` draft lifecycle** (L) — tests first; produces `publishScript`, `deleteDraftScript`, `publishTemplate`, `deleteDraftTemplate`
8. **`ProposalStore` DB mapping + `MCPServer` accept/discard update** (M, remainder) — map `proposeScript`/`proposeTemplate` proposals to DB row IDs; update `acceptProposal()` and `discardProposal()` in `MCPServer.ts` to call publish/delete methods; wire `onExpiry` handler in `MCPServer` constructor to call `deleteDraftScript`/`deleteDraftTemplate` on TTL expiry; extend existing MCPServer accept/discard/expiry tests
9. **`NotificationWatcher`** (F) — test with mock DB rows + mock chokidar emitter (emit `'change'` / `'add'` events on a fake `FSWatcher`)
10. **`MCPAgentConfigEngine` — `claude-desktop` + `removeFromConfig`** (K) — extend existing tests; `execPath`/`scriptPath` optional; verify opencode format before writing its case
11. **`MCPServer.startCli()`** (G) — test with in-process `StdioServerTransport`
12. **`src/cli/bds-mcp.ts`** (H) — integration test: spawn process, send `initialize`, assert response, assert clean shutdown on SIGTERM and on stdin-close
13. **Build target + `extraResources`** (I + J) — verify `npm run build` produces `dist/cli/bds-mcp.cjs`; `drizzle/` entry already in `extraResources`, only add `bds-mcp.cjs`
14. **UI: Remove buttons** — renderer component changes, follows K
15. **`NotificationWatcher` wired in `main.ts`** (F, app side) + stopped in `before-quit`
16. **Renderer store `invalidate()` methods** — add `invalidate(id)` + IPC refetch action to `postsStore`, `mediaStore`, `scriptsStore`, `templatesStore`; each requires both a store action and a corresponding IPC call to reload the single entity
17. **Renderer `entity:changed` subscription** (N) — `preload.ts` channel exposure + component subscription wired to the store `invalidate()` methods from step 16

Each step: write failing test → implement → green → next.
