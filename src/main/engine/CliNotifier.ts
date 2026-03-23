/**
 * CliNotifier — interface for signalling the Electron app about mutations
 * made by the standalone CLI (`bds-mcp`).
 *
 * `NoopNotifier`  — used by the Electron app; all mutations are no-ops because
 *                   the app is already aware of its own writes.
 * `DbNotifier`    — used by the CLI; inserts a row into `db_notifications` so
 *                   the app's `NotificationWatcher` can pick it up.
 */

import { dbNotifications } from '../database/schema';

export type NotifyEntity = 'post' | 'media' | 'script' | 'template';
export type NotifyAction = 'created' | 'updated' | 'deleted';

export interface CliNotifier {
  notify(entity: NotifyEntity, id: string, action: NotifyAction): Promise<void>;
}

// ── NoopNotifier ──────────────────────────────────────────────────────────────

/** Used by the Electron app. All notify calls are instant no-ops. */
export class NoopNotifier implements CliNotifier {
  async notify(entity: NotifyEntity, id: string, action: NotifyAction): Promise<void> {
    void entity;
    void id;
    void action;
    // intentional no-op
  }
}

// ── DbNotifier ────────────────────────────────────────────────────────────────

type DrizzleInsertable = {
  insert: (table: typeof dbNotifications) => {
    values: (row: typeof dbNotifications.$inferInsert) => Promise<unknown>;
  };
};

/**
 * Used by the CLI.  Inserts a row into `db_notifications` so the running
 * Electron app's `NotificationWatcher` can invalidate its caches and push
 * `entity:changed` IPC events to the renderer.
 */
export class DbNotifier implements CliNotifier {
  constructor(private readonly db: DrizzleInsertable) {}

  async notify(entity: NotifyEntity, id: string, action: NotifyAction): Promise<void> {
    await this.db.insert(dbNotifications).values({
      entity,
      entityId: id,
      action,
      fromCli: 1,
      seenAt: null,
      createdAt: Date.now(),
    });
  }
}
