/**
 * NotificationWatcher — watches bds.db and bds.db-wal for changes made by the
 * standalone CLI (`bds-mcp`), then invalidates engine caches and emits
 * `entity:changed` IPC events to the renderer so the UI stays in sync.
 *
 * The watcher fires on every DB write (not only CLI writes). `process()` reads
 * `db_notifications` for rows where `seenAt IS NULL AND fromCli = 1`. When the
 * CLI is not running that query returns zero rows in one cheap SELECT.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { dbNotifications } from '../database/schema';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WatchableEngine {
  invalidate(entityId?: string): void;
}

export type WatchableEngines = Partial<Record<string, WatchableEngine>>;

// The minimal subset of a Drizzle LibSQL db that NotificationWatcher needs.
type DrizzleDB = {
  select: () => {
    from: (table: typeof dbNotifications) => {
      where: (condition: unknown) => Promise<
        Array<{
          id: number;
          entity: string;
          entityId: string;
          action: string;
          fromCli: number;
          seenAt: number | null;
          createdAt: number;
        }>
      >;
    };
  };
  update: (table: typeof dbNotifications) => {
    set: (values: Partial<typeof dbNotifications.$inferInsert>) => {
      where: (condition: unknown) => Promise<void>;
    };
  };
  delete: (table: typeof dbNotifications) => {
    where: (condition: unknown) => Promise<void>;
  };
};

// ── NotificationWatcher ──────────────────────────────────────────────────────

export class NotificationWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(
    private readonly dbPath: string,
    private readonly db: DrizzleDB,
    private readonly engines: WatchableEngines,
    private readonly mainWindow: BrowserWindow,
    private readonly debounceMs = 100,
  ) {}

  start(): void {
    this.watcher = chokidar.watch([this.dbPath, `${this.dbPath}-wal`], {
      persistent: false,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: false,
    });
    this.watcher.on('change', () => this.schedule());
    this.watcher.on('add', () => this.schedule());
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watcher?.close().catch(() => {});
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.process(), this.debounceMs);
  }

  private async process(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const rows = await this.db
        .select()
        .from(dbNotifications)
        .where(and(isNull(dbNotifications.seenAt), eq(dbNotifications.fromCli, 1)));

      for (const row of rows) {
        this.engines[row.entity]?.invalidate(row.entityId);
        this.mainWindow.webContents.send('entity:changed', {
          entity: row.entity,
          entityId: row.entityId,
          action: row.action,
        });
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
      await this.db.delete(dbNotifications).where(
        and(isNull(dbNotifications.seenAt), lt(dbNotifications.createdAt, now - 86_400_000)),
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
