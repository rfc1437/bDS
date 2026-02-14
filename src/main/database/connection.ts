import { createClient, Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { projects } from './schema';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface DatabaseConfig {
  localPath: string;
}

type DrizzleDB = ReturnType<typeof drizzle>;

export class DatabaseConnection {
  private localDb: DrizzleDB | null = null;
  private localClient: Client | null = null;
  private config: DatabaseConfig;
  private _closing = false;

  constructor(config?: Partial<DatabaseConfig>) {
    const userDataPath = app.getPath('userData');
    
    this.config = {
      localPath: config?.localPath || path.join(userDataPath, 'bds.db'),
    };

    // Ensure user data directory exists
    const dataDir = path.dirname(this.config.localPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Ensure posts and media directories exist
    const postsDir = path.join(userDataPath, 'posts');
    const mediaDir = path.join(userDataPath, 'media');
    
    if (!fs.existsSync(postsDir)) {
      fs.mkdirSync(postsDir, { recursive: true });
    }
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
  }

  async initializeLocal(): Promise<DrizzleDB> {
    if (this.localDb) {
      return this.localDb;
    }

    // Use file: URL for local SQLite database via libsql
    this.localClient = createClient({
      url: `file:${this.config.localPath}`,
    });
    this.localDb = drizzle(this.localClient, { schema });

    // Run migrations
    await this.runMigrations();

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

  private async runMigrations(): Promise<void> {
    if (!this.localClient || !this.localDb) return;

    // Determine migrations folder path (works in both dev and production)
    // In production, migrations are bundled in the app resources
    const isDev = !app.isPackaged;
    const migrationsFolder = isDev
      ? path.join(app.getAppPath(), 'drizzle')
      : path.join(process.resourcesPath, 'drizzle');

    // Run Drizzle migrations (creates __drizzle_migrations table automatically)
    await migrate(this.localDb, { migrationsFolder });

    // Create FTS5 virtual tables (not supported by Drizzle schema)
    // These use IF NOT EXISTS so they're safe to run every time
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

    // Create default project if none exists
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
  }

  async close(): Promise<void> {
    this._closing = true;
    if (this.localClient) {
      this.localClient.close();
      this.localClient = null;
      this.localDb = null;
    }
  }

  getDataPaths() {
    const userDataPath = app.getPath('userData');
    return {
      database: this.config.localPath,
      posts: path.join(userDataPath, 'posts'),
      media: path.join(userDataPath, 'media'),
    };
  }
}

// Singleton instance
let dbConnection: DatabaseConnection | null = null;

export function getDatabase(): DatabaseConnection {
  if (!dbConnection) {
    dbConnection = new DatabaseConnection();
  }
  return dbConnection;
}

export function initDatabase(config?: Partial<DatabaseConfig>): DatabaseConnection {
  dbConnection = new DatabaseConnection(config);
  return dbConnection;
}
