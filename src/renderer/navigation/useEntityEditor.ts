import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';

/**
 * Shared hook for entity editors that load data by ID.
 *
 * Handles:
 * - Deferring load until activeProject is available (startup race condition)
 * - Cancellation of in-flight fetches on ID change / unmount
 * - Closing the tab when the entity is not found (e.g. after project switch)
 * - Providing a reload() helper for external-change refresh
 *
 * Instead of returning data that requires a separate sync effect, this hook
 * calls `onLoaded` / `onReset` directly from within the fetch effect so
 * that local state updates in the same render cycle as the load — matching
 * the timing behaviour editors had when each hand-rolled its own load logic.
 *
 * @param entityId  The entity primary key, or null for the "no entity" state.
 * @param fetcher   Async function that takes an ID and returns the entity or null.
 * @param callbacks `onLoaded(data)` when entity arrives, `onReset()` when
 *                  entityId is null or entity was not found.
 */
export function useEntityLoader<T>(
  entityId: string | null,
  fetcher: (id: string) => Promise<T | null>,
  callbacks: {
    onLoaded: (data: T) => void;
    onReset: () => void;
  },
): {
  isLoading: boolean;
  reload: () => void;
} {
  const activeProjectId = useAppStore((s) => s.activeProject?.id ?? null);
  const closeTab = useAppStore((s) => s.closeTab);

  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!entityId) {
      callbacks.onReset();
      setIsLoading(false);
      return;
    }

    if (!activeProjectId) {
      // Project context not ready yet — stay in loading state, will
      // re-run once activeProjectId appears.
      callbacks.onReset();
      setIsLoading(true);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetcher(entityId).then((result) => {
      if (cancelled) return;

      if (result) {
        callbacks.onLoaded(result);
      } else {
        // Entity doesn't exist in this project — close the orphaned tab.
        callbacks.onReset();
        closeTab(entityId);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // callbacks intentionally excluded — they are inline objects whose
    // identity changes each render; the real dependencies are the
    // entityId, activeProjectId, and reloadToken.
  }, [entityId, activeProjectId, reloadToken, fetcher, closeTab]);

  const reload = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  return { isLoading, reload };
}

/**
 * Bind Cmd/Ctrl+S to a save callback.
 *
 * Replaces the identical keydown listener that was copy-pasted across
 * PostEditor, ScriptsView, and TemplatesView.
 */
export function useSaveShortcut(onSave: () => void): void {
  useEffect(() => {
    if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        onSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave]);
}
