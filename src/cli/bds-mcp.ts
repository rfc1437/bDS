/**
 * bds-mcp — standalone MCP server for Blogging Desktop Server.
 *
 * Launched by coding agents (Claude Desktop, etc.) via:
 *   ELECTRON_RUN_AS_NODE=1 /path/to/app.app/Contents/MacOS/app bds-mcp.cjs
 *
 * No `electron` imports in this file.  Engine modules may import from
 * `electron` — those imports are satisfied because we run as ELECTRON_RUN_AS_NODE.
 */

import * as path from 'path';
import * as fs from 'fs';
import { eq } from 'drizzle-orm';
import { platformConfigPath } from './platform';
import { initDatabase } from '../main/database/connection';
import { projects } from '../main/database/schema';
import { DbNotifier } from '../main/engine/CliNotifier';
import { PostEngine } from '../main/engine/PostEngine';
import { MediaEngine } from '../main/engine/MediaEngine';
import { PostMediaEngine } from '../main/engine/PostMediaEngine';
import { TagEngine } from '../main/engine/TagEngine';
import { ScriptEngine } from '../main/engine/ScriptEngine';
import { TemplateEngine } from '../main/engine/TemplateEngine';
import { MetaEngine } from '../main/engine/MetaEngine';
import { MCPServer } from '../main/engine/MCPServer';

// ── Bootstrap ────────────────────────────────────────────────────────────────

const userData = platformConfigPath();
const dbPath = path.join(userData, 'bds.db');

// __dirname points to Contents/Resources/ in the packaged app (bds-mcp.cjs is
// placed there by extraResources, alongside drizzle/).
// In development it points to dist/cli/ — drizzle/ lives at the project root.
const migrationsFolder = (() => {
  const adjacent = path.join(__dirname, 'drizzle');
  if (fs.existsSync(adjacent)) return adjacent;
  // dev: dist/cli/ → ../../drizzle
  return path.join(__dirname, '..', '..', 'drizzle');
})();

const db = initDatabase({ dbPath, migrationsFolder });

async function main(): Promise<void> {
  // 1. Open + migrate the local database.
  await db.initializeLocal();

  const localDb = db.getLocal();

  // 2. Verify an active project exists.
  const activeProject = await localDb
    .select()
    .from(projects)
    .where(eq(projects.isActive, true))
    .get();

  if (!activeProject) {
    process.stderr.write(
      '[bds-mcp] No active project found. Open the Blogging Desktop Server app ' +
        'and ensure at least one project is active.\n',
    );
    process.exit(1);
  }

  // 3. Construct engines with the DbNotifier so every mutation writes a
  //    db_notifications row that the running Electron app can pick up.
  const notifier = new DbNotifier(localDb as any);

  const mediaEngine = new MediaEngine(notifier);
  const postEngine = new PostEngine({ notifier, mediaEngine });
  const postMediaEngine = new PostMediaEngine(mediaEngine);
  const tagEngine = new TagEngine(postEngine);
  const scriptEngine = new ScriptEngine(notifier);
  const templateEngine = new TemplateEngine(notifier);
  const metaEngine = new MetaEngine();

  // 3b. Point every engine at the active project so queries/mutations
  //     target the correct project instead of the hardcoded 'default'.
  const dataDir = activeProject.dataPath
    ?? path.join(userData, 'projects', activeProject.id);

  postEngine.setProjectContext(activeProject.id, dataDir);
  mediaEngine.setProjectContext(activeProject.id, dataDir, dataDir);
  postMediaEngine.setProjectContext(activeProject.id);
  tagEngine.setProjectContext(activeProject.id, dataDir);
  scriptEngine.setProjectContext(activeProject.id, dataDir);
  templateEngine.setProjectContext(activeProject.id, dataDir);
  metaEngine.setProjectContext(activeProject.id, dataDir);

  // 4. Create the MCP server with an 8-hour proposal TTL (CLI sessions can
  //    last overnight).
  const mcpServer = new MCPServer(
    {
      postEngine,
      mediaEngine,
      postMediaEngine,
      scriptEngine,
      templateEngine,
      metaEngine,
      tagEngine,
    },
    { proposalTtlMs: 8 * 60 * 60 * 1000 },
  );

  // 5. Graceful shutdown — two paths, no racing.
  //    process.exit() makes this non-reentrant even without explicit guards.
  async function shutdown(): Promise<never> {
    await mcpServer.cleanup();
    await db.close();
    process.exit(0);
  }

  // Signal handlers own interruption; registered before startCli() so they
  // are active during the entire session.
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // 6. Start the MCP stdio server and block until stdin closes.
  await mcpServer.startCli();

  // 7. Normal exit path: stdin closed → startCli() resolved.
  await shutdown();
}

main().catch((err: unknown) => {
  process.stderr.write(`[bds-mcp] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
