import { createClient, Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { projects } from './schema';
import * as path from 'path';
import * as fs from 'fs';

export interface DatabaseConnectionConfig {
  /** Absolute path to the bds.db SQLite file. */
  dbPath: string;
  /** Absolute path to the drizzle/ migrations folder. */
  migrationsFolder: string;
  /**
   * Extra directories to create on startup (e.g. posts/, media/ inside userData).
   * Caller is responsible for providing these; connection.ts no longer computes
   * paths via app.getPath().
   */
  dataDirs?: string[];
}

type DrizzleDB = ReturnType<typeof drizzle>;

export class DatabaseConnection {
  private localDb: DrizzleDB | null = null;
  private localClient: Client | null = null;
  private readonly dbPath: string;
  private readonly migrationsFolder: string;
  private readonly dataDirs: string[];
  private _closing = false;

  constructor(config: DatabaseConnectionConfig) {
    this.dbPath = config.dbPath;
    this.migrationsFolder = config.migrationsFolder;
    this.dataDirs = config.dataDirs ?? [];

    // Ensure the directory containing the DB file exists.
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Ensure caller-supplied extra directories exist.
    for (const dir of this.dataDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async initializeLocal(): Promise<DrizzleDB> {
    if (this.localDb) {
      return this.localDb;
    }

    // Use file: URL for local SQLite database via libsql
    this.localClient = createClient({
      url: `file:${this.dbPath}`,
    });
    this.localDb = drizzle(this.localClient, { schema });

    // Enable WAL mode and set synchronous=NORMAL for better concurrency and
    // performance.  WAL mode is a database-level, one-way change — SQLite
    // persists it in the file header so subsequent opens keep it automatically.
    await this.localClient.execute('PRAGMA journal_mode=WAL');
    await this.localClient.execute('PRAGMA synchronous=NORMAL');

    // Run Drizzle migrations (creates __drizzle_migrations table automatically)
    await migrate(this.localDb, { migrationsFolder: this.migrationsFolder });

    // Create FTS5 virtual tables (not supported by Drizzle schema).
    // These use IF NOT EXISTS so they're safe to run every time.
    await this.localClient.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        content,
        content_rowid=rowid
      )
    `);

    await this.localClient.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        content,
        content_rowid=rowid
      )
    `);

    // Create a default project if none exists.
    const existingProjects = await this.localDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(projects);
    if (existingProjects[0] && existingProjects[0].count === 0) {
      const now = new Date();
      await this.localDb.insert(projects).values({
        id: 'default',
        name: 'Default Project',
        slug: 'default',
        description: 'Your first blog project',
        createdAt: now,
        updatedAt: now,
        isActive: true,
      });
    }

    return this.localDb;
  }

  get isClosing(): boolean {
    return this._closing;
  }

  getLocal(): DrizzleDB {
    if (!this.localDb) {
      throw new Error(this._closing
        ? 'Database is closing'
        : 'Local database not initialized. Call initializeLocal() first.');
    }
    return this.localDb;
  }

  getLocalClient(): Client | null {
    return this.localClient;
  }

  /** Returns the absolute path to the SQLite database file. */
  getDbPath(): string {
    return this.dbPath;
  }

  async getActiveProject(): Promise<{ id: string; name: string; slug: string } | null> {
    if (!this.localDb) return null;
    const rows = await this.localDb
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(eq(projects.isActive, true))
      .limit(1);
    if (rows.length === 0) return null;
    return rows[0];
  }

  async setActiveProject(projectId: string): Promise<void> {
    if (!this.localDb) return;
    // Deactivate all projects
    await this.localDb
      .update(projects)
      .set({ isActive: false });
    // Activate the selected project
    await this.localDb
      .update(projects)
      .set({ isActive: true })
      .where(eq(projects.id, projectId));
  }

  async close(): Promise<void> {
    this._closing = true;
    if (this.localClient) {
      this.localClient.close();
      this.localClient = null;
      this.localDb = null;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// The singleton is initialised by main.ts (Electron app) or bds-mcp.ts (CLI)
// via initDatabase() before any engine code runs.  Calling getDatabase() before
// initDatabase() throws so bugs are caught early.

let dbConnection: DatabaseConnection | null = null;

export function getDatabase(): DatabaseConnection {
  if (!dbConnection) {
    throw new Error(
      'DatabaseConnection has not been initialised. ' +
      'Call initDatabase() before calling getDatabase().',
    );
  }
  return dbConnection;
}

export function initDatabase(config: DatabaseConnectionConfig): DatabaseConnection {
  dbConnection = new DatabaseConnection(config);
  return dbConnection;
}
