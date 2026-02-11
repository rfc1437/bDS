/**
 * AutoSaveManager - handles automatic saving of drafts with idle detection
 * 
 * This manager tracks changes to multiple items and saves them after a configurable
 * idle period. Changes are accumulated and merged before saving.
 */

export interface AutoSaveConfig {
  /** Time in milliseconds to wait after last change before saving (default: 3000) */
  idleTimeMs: number;
  /** Callback to perform the save operation */
  onSave: (id: string, changes: Record<string, unknown>) => Promise<void>;
  /** Callback when save completes successfully */
  onSaveComplete?: (id: string) => void;
  /** Callback when save fails */
  onSaveError?: (id: string, error: Error) => void;
}

interface PendingChange {
  changes: Record<string, unknown>;
  timerId: ReturnType<typeof setTimeout>;
}

export class AutoSaveManager {
  private pendingChanges: Map<string, PendingChange> = new Map();
  private config: AutoSaveConfig;
  private disposed = false;

  constructor(config: AutoSaveConfig) {
    this.config = config;
  }

  /**
   * Notify the manager of a change to an item.
   * Resets the idle timer and accumulates the changes.
   */
  notifyChange(id: string, changes: Record<string, unknown>): void {
    if (this.disposed) return;

    const existing = this.pendingChanges.get(id);

    // Clear existing timer if any
    if (existing) {
      clearTimeout(existing.timerId);
    }

    // Merge changes with existing pending changes
    const mergedChanges = {
      ...(existing?.changes || {}),
      ...changes,
    };

    // Set new timer
    const timerId = setTimeout(() => {
      this.performSave(id);
    }, this.config.idleTimeMs);

    this.pendingChanges.set(id, {
      changes: mergedChanges,
      timerId,
    });
  }

  /**
   * Perform the save operation for a specific item.
   */
  private async performSave(id: string): Promise<void> {
    const pending = this.pendingChanges.get(id);
    if (!pending) return;

    // Remove from pending before saving
    this.pendingChanges.delete(id);

    try {
      await this.config.onSave(id, pending.changes);
      this.config.onSaveComplete?.(id);
    } catch (error) {
      this.config.onSaveError?.(id, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Force save all pending changes immediately.
   */
  async forceSave(): Promise<void> {
    const ids = Array.from(this.pendingChanges.keys());
    
    // Cancel all timers
    for (const pending of this.pendingChanges.values()) {
      clearTimeout(pending.timerId);
    }

    // Save all pending changes in parallel
    await Promise.all(ids.map((id) => this.performSave(id)));
  }

  /**
   * Cancel pending save for a specific item.
   */
  cancel(id: string): void {
    const pending = this.pendingChanges.get(id);
    if (pending) {
      clearTimeout(pending.timerId);
      this.pendingChanges.delete(id);
    }
  }

  /**
   * Check if there are any pending changes.
   * If id is provided, checks only for that specific item.
   */
  hasPendingChanges(id?: string): boolean {
    if (id) {
      return this.pendingChanges.has(id);
    }
    return this.pendingChanges.size > 0;
  }

  /**
   * Dispose of the manager, canceling all pending saves.
   */
  dispose(): void {
    this.disposed = true;
    for (const pending of this.pendingChanges.values()) {
      clearTimeout(pending.timerId);
    }
    this.pendingChanges.clear();
  }
}
