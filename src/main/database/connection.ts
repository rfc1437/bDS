import { createClient, Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
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
    if (!this.localClient) return null;
    const result = await this.localClient.execute('SELECT id, name, slug FROM projects WHERE is_active = 1 LIMIT 1');
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
    };
  }

  async setActiveProject(projectId: string): Promise<void> {
    if (!this.localClient) return;
    await this.localClient.execute('UPDATE projects SET is_active = 0');
    await this.localClient.execute({
      sql: 'UPDATE projects SET is_active = 1 WHERE id = ?',
      args: [projectId],
    });
  }

  private async runMigrations(): Promise<void> {
    if (!this.localClient) return;

    // Create tables if they don't exist using batch execution
    await this.localClient.executeMultiple(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
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
        categories TEXT,
        published_title TEXT,
        published_content TEXT,
        published_tags TEXT,
        published_categories TEXT,
        published_excerpt TEXT
      );

      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
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

      CREATE TABLE IF NOT EXISTS post_links (
        id TEXT PRIMARY KEY,
        source_post_id TEXT NOT NULL,
        target_post_id TEXT NOT NULL,
        link_text TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS post_media (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_sync_status ON posts(sync_status);
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_media_sync_status ON media(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
      CREATE INDEX IF NOT EXISTS idx_post_links_source ON post_links(source_post_id);
      CREATE INDEX IF NOT EXISTS idx_post_links_target ON post_links(target_post_id);
      CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id);
      CREATE INDEX IF NOT EXISTS idx_post_media_media ON post_media(media_id);
      CREATE UNIQUE INDEX IF NOT EXISTS post_media_post_media_idx ON post_media(post_id, media_id);
      CREATE UNIQUE INDEX IF NOT EXISTS posts_project_slug_idx ON posts(project_id, slug);

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tags_project_id ON tags(project_id);
      CREATE UNIQUE INDEX IF NOT EXISTS tags_project_name_idx ON tags(project_id, name);
    `);

    // Check if project_id column exists in posts table, add if missing (migration)
    const postsColumns = await this.localClient.execute(
      "SELECT name FROM pragma_table_info('posts') WHERE name = 'project_id'"
    );
    if (postsColumns.rows.length === 0) {
      await this.localClient.execute(
        "ALTER TABLE posts ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'"
      );
      await this.localClient.execute(
        "CREATE INDEX IF NOT EXISTS idx_posts_project_id ON posts(project_id)"
      );
    } else {
      await this.localClient.execute(
        "CREATE INDEX IF NOT EXISTS idx_posts_project_id ON posts(project_id)"
      );
    }

    // Check if project_id column exists in media table, add if missing (migration)
    const mediaColumns = await this.localClient.execute(
      "SELECT name FROM pragma_table_info('media') WHERE name = 'project_id'"
    );
    if (mediaColumns.rows.length === 0) {
      await this.localClient.execute(
        "ALTER TABLE media ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'"
      );
      await this.localClient.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_project_id ON media(project_id)"
      );
    } else {
      await this.localClient.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_project_id ON media(project_id)"
      );
    }

    // Migration: Add published snapshot columns for discard functionality
    const publishedContentCol = await this.localClient.execute(
      "SELECT name FROM pragma_table_info('posts') WHERE name = 'published_content'"
    );
    if (publishedContentCol.rows.length === 0) {
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN published_title TEXT");
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN published_content TEXT");
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN published_tags TEXT");
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN published_categories TEXT");
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN published_excerpt TEXT");
    }

    // Migration: Add content column for draft body text stored in DB
    const contentCol = await this.localClient.execute(
      "SELECT name FROM pragma_table_info('posts') WHERE name = 'content'"
    );
    if (contentCol.rows.length === 0) {
      await this.localClient.execute("ALTER TABLE posts ADD COLUMN content TEXT");
    }

    // Migration: Update slug unique constraint to be project-scoped
    // SQLite doesn't allow dropping column-level UNIQUE constraints, so we must recreate the table
    // Check if the posts table has a column-level UNIQUE on slug (from the table definition)
    const tableInfo = await this.localClient.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='posts'"
    );
    const tableSql = tableInfo.rows[0]?.sql as string || '';
    const hasColumnLevelUnique = tableSql.includes('slug TEXT NOT NULL UNIQUE') || 
                                  tableSql.includes('slug TEXT UNIQUE') ||
                                  /slug\s+TEXT[^,]*UNIQUE/i.test(tableSql);

    if (hasColumnLevelUnique) {
      console.log('Migrating posts table to remove column-level UNIQUE constraint on slug...');
      
      // Create new table without the UNIQUE constraint
      await this.localClient.execute(`
        CREATE TABLE IF NOT EXISTS posts_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          title TEXT NOT NULL,
          slug TEXT NOT NULL,
          excerpt TEXT,
          content TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          author TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          published_at INTEGER,
          file_path TEXT NOT NULL DEFAULT '',
          sync_status TEXT NOT NULL DEFAULT 'pending',
          synced_at INTEGER,
          checksum TEXT,
          tags TEXT,
          categories TEXT,
          published_title TEXT,
          published_content TEXT,
          published_tags TEXT,
          published_categories TEXT,
          published_excerpt TEXT
        )
      `);

      // Copy data
      await this.localClient.execute(`
        INSERT INTO posts_new 
        SELECT id, project_id, title, slug, excerpt, content, status, author, 
               created_at, updated_at, published_at, file_path, sync_status,
               synced_at, checksum, tags, categories, published_title, 
               published_content, published_tags, published_categories, published_excerpt
        FROM posts
      `);

      // Drop old table and rename new one
      await this.localClient.execute('DROP TABLE posts');
      await this.localClient.execute('ALTER TABLE posts_new RENAME TO posts');

      // Recreate indexes
      await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)');
      await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)');
      await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_posts_sync_status ON posts(sync_status)');
      await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)');
      await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_posts_project_id ON posts(project_id)');
      await this.localClient.execute('CREATE UNIQUE INDEX IF NOT EXISTS posts_project_slug_idx ON posts(project_id, slug)');

      console.log('Posts table migration complete');
    } else {
      // Just ensure the composite unique index exists
      const compositeSlugIndex = await this.localClient.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='posts_project_slug_idx' AND tbl_name='posts'"
      );
      if (compositeSlugIndex.rows.length === 0) {
        await this.localClient.execute(
          "CREATE UNIQUE INDEX posts_project_slug_idx ON posts(project_id, slug)"
        );
      }
    }

    // Create FTS5 virtual table for full-text search
    // Stores: id (unindexed, for lookups), project_id (unindexed, for filtering), content (stemmed text for matching)
    // Post data for display comes from the posts table or filesystem files
    await this.localClient.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        content,
        content_rowid=rowid
      );
    `);

    // Migration: Check if old FTS schema exists and recreate with project_id
    // Old schema had: id, content (or even older: id, title, content, excerpt, tags, categories)
    // New schema has: id, project_id, content (for project-scoped search)
    try {
      // Try to query project_id - if it doesn't exist, we need to migrate
      await this.localClient.execute("SELECT project_id FROM posts_fts LIMIT 0");
      // project_id exists, check for old multi-column schema
      try {
        await this.localClient.execute("SELECT title FROM posts_fts LIMIT 0");
        // Old multi-column schema exists - recreate
        console.log('Migrating posts_fts table to new schema with project_id...');
        await this.localClient.execute('DROP TABLE IF EXISTS posts_fts');
        await this.localClient.execute(`
          CREATE VIRTUAL TABLE posts_fts USING fts5(
            id UNINDEXED,
            project_id UNINDEXED,
            content,
            content_rowid=rowid
          );
        `);
        console.log('FTS table migrated - rebuild index required');
      } catch {
        // No title column - we have the correct new schema
      }
    } catch {
      // project_id doesn't exist - migrate from old schema
      console.log('Migrating posts_fts table to add project_id...');
      await this.localClient.execute('DROP TABLE IF EXISTS posts_fts');
      await this.localClient.execute(`
        CREATE VIRTUAL TABLE posts_fts USING fts5(
          id UNINDEXED,
          project_id UNINDEXED,
          content,
          content_rowid=rowid
        );
      `);
      console.log('FTS table migrated - rebuild index required');
    }

    // Migration: Ensure tags table exists (for databases created before tags feature)
    const tagsTableExists = await this.localClient.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tags'"
    );
    if (tagsTableExists.rows.length === 0) {
      console.log('Creating tags table...');
      await this.localClient.execute(`
        CREATE TABLE tags (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      await this.localClient.execute('CREATE INDEX idx_tags_project_id ON tags(project_id)');
      await this.localClient.execute('CREATE UNIQUE INDEX tags_project_name_idx ON tags(project_id, name)');
      console.log('Tags table created successfully');
    }

    // Migration: Add data_path column to projects table
    const dataPathCol = await this.localClient.execute(
      "SELECT name FROM pragma_table_info('projects') WHERE name = 'data_path'"
    );
    if (dataPathCol.rows.length === 0) {
      await this.localClient.execute("ALTER TABLE projects ADD COLUMN data_path TEXT");
    }

    // Create default project if none exists
    const existingProjects = await this.localClient.execute('SELECT COUNT(*) as count FROM projects');
    if (existingProjects.rows[0] && (existingProjects.rows[0].count as number) === 0) {
      const now = Date.now();
      await this.localClient.execute({
        sql: 'INSERT INTO projects (id, name, slug, description, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: ['default', 'Default Project', 'default', 'Your first blog project', now, now, 1],
      });
    }

    // Create chat_conversations table for AI chat persistence
    await this.localClient.execute(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT,
        copilot_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at)');

    // Create chat_messages table for storing conversation messages
    await this.localClient.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_call_id TEXT,
        tool_calls TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
      )
    `);
    await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id)');

    // Create import_definitions table for WXR import configurations
    await this.localClient.execute(`
      CREATE TABLE IF NOT EXISTS import_definitions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        wxr_file_path TEXT,
        uploads_folder_path TEXT,
        last_analysis_result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await this.localClient.execute('CREATE INDEX IF NOT EXISTS idx_import_definitions_project_id ON import_definitions(project_id)');
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
