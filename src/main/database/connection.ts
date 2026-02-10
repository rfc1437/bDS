import { createClient, Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface DatabaseConfig {
  localPath: string;
  tursoUrl?: string;
  tursoAuthToken?: string;
}

type DrizzleDB = ReturnType<typeof drizzle>;

export class DatabaseConnection {
  private localDb: DrizzleDB | null = null;
  private remoteDb: DrizzleDB | null = null;
  private localClient: Client | null = null;
  private remoteClient: Client | null = null;
  private config: DatabaseConfig;

  constructor(config?: Partial<DatabaseConfig>) {
    const userDataPath = app.getPath('userData');
    
    this.config = {
      localPath: config?.localPath || path.join(userDataPath, 'bds.db'),
      tursoUrl: config?.tursoUrl,
      tursoAuthToken: config?.tursoAuthToken,
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

  async initializeRemote(): Promise<DrizzleDB | null> {
    if (!this.config.tursoUrl || !this.config.tursoAuthToken) {
      return null;
    }

    if (this.remoteDb) {
      return this.remoteDb;
    }

    this.remoteClient = createClient({
      url: this.config.tursoUrl,
      authToken: this.config.tursoAuthToken,
    });

    this.remoteDb = drizzle(this.remoteClient, { schema });
    return this.remoteDb;
  }

  getLocal(): DrizzleDB {
    if (!this.localDb) {
      throw new Error('Local database not initialized. Call initializeLocal() first.');
    }
    return this.localDb;
  }

  getRemote(): DrizzleDB | null {
    return this.remoteDb;
  }

  private async runMigrations(): Promise<void> {
    if (!this.localClient) return;

    // Create tables if they don't exist using batch execution
    await this.localClient.executeMultiple(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        excerpt TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        author TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER,
        file_path TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        synced_at INTEGER,
        checksum TEXT,
        tags TEXT,
        categories TEXT
      );

      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        alt TEXT,
        caption TEXT,
        file_path TEXT NOT NULL,
        sidecar_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        synced_at INTEGER,
        checksum TEXT,
        tags TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        timestamp INTEGER NOT NULL,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_sync_status ON posts(sync_status);
      CREATE INDEX IF NOT EXISTS idx_media_sync_status ON media(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
    `);
  }

  async close(): Promise<void> {
    if (this.localClient) {
      this.localClient.close();
      this.localClient = null;
      this.localDb = null;
    }
    if (this.remoteClient) {
      this.remoteClient.close();
      this.remoteClient = null;
      this.remoteDb = null;
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
