/**
 * React hook for A2UI surface state.
 *
 * Wraps A2UISurfaceManager and provides reactive state for React components.
 * Subscribes to IPC events and feeds messages into the surface manager.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { A2UISurfaceManager } from './A2UISurfaceManager';
import type { A2UIResolvedComponent, A2UIServerMessage, A2UIClientAction } from '../../main/a2ui/types';

interface UseA2UISurfaceInput {
  conversationId: string | null;
}

export interface SurfaceEntry {
  surfaceId: string;
  tree: A2UIResolvedComponent[];
}

interface UseA2UISurfaceResult {
  /** All active surface trees for this conversation */
  surfaces: SurfaceEntry[];
  /** Surfaces grouped by the turn index that created them */
  surfacesByTurn: Map<number, SurfaceEntry[]>;
  /** The surfaceId of the most recently created surface */
  latestSurfaceId: string | null;
  /** Set of surface IDs that the user has dismissed */
  dismissedSurfaceIds: Set<string>;
  /** Dismiss a surface by ID */
  dismissSurface: (surfaceId: string) => void;
  /** Dispatch an action back to the main process */
  dispatchAction: (action: A2UIClientAction) => void;
  /** Update a local data binding (for form inputs) */
  updateLocalData: (surfaceId: string, path: string, value: unknown) => void;
  /** Get the data model for a surface */
  getDataModel: (surfaceId: string) => Record<string, unknown>;
  /** Clear all surfaces for the conversation */
  clearSurfaces: () => void;
}

export function useA2UISurface(input: UseA2UISurfaceInput): UseA2UISurfaceResult {
  const { conversationId } = input;
  const managerRef = useRef<A2UISurfaceManager>(new A2UISurfaceManager());
  const [renderTick, setRenderTick] = useState(0);
  const [dismissedSurfaceIds, setDismissedSurfaceIds] = useState<Set<string>>(new Set());

  // Subscribe to surface changes
  useEffect(() => {
    const manager = managerRef.current;
    const unsubscribe = manager.onChange(() => {
      setRenderTick((prev) => prev + 1);
    });

    return unsubscribe;
  }, []);

  // Subscribe to A2UI IPC events
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const unsubscribe = window.electronAPI?.chat.onA2UIMessage?.((data: { conversationId: string; message: A2UIServerMessage }) => {
      if (data.conversationId === conversationId) {
        managerRef.current.processMessage(data.message);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [conversationId]);

  // Clear surfaces and dismissed set when conversation changes
  useEffect(() => {
    setDismissedSurfaceIds(new Set());
    return () => {
      if (conversationId) {
        managerRef.current.clearConversation(conversationId);
      }
    };
  }, [conversationId]);

  const surfaces = useMemo(() => {
    // renderTick ensures this recalculates on surface changes
    void renderTick;

    if (!conversationId) {
      return [];
    }

    const manager = managerRef.current;
    const surfaceIds = manager.getSurfaceIds(conversationId);
    return surfaceIds.map((surfaceId) => ({
      surfaceId,
      tree: manager.resolveTree(surfaceId),
    }));
  }, [conversationId, renderTick]);

  const surfacesByTurn = useMemo(() => {
    void renderTick;

    const map = new Map<number, SurfaceEntry[]>();
    if (!conversationId) {
      return map;
    }

    const manager = managerRef.current;
    const surfaceIds = manager.getSurfaceIds(conversationId);

    for (const surfaceId of surfaceIds) {
      const surface = manager.getSurface(surfaceId);
      const turnIndex = (surface?.metadata?.turnIndex as number) ?? -1;
      const entry: SurfaceEntry = { surfaceId, tree: manager.resolveTree(surfaceId) };

      const existing = map.get(turnIndex);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(turnIndex, [entry]);
      }
    }

    return map;
  }, [conversationId, renderTick]);

  const latestSurfaceId = useMemo(() => {
    void renderTick;

    if (!conversationId) {
      return null;
    }

    const ids = managerRef.current.getSurfaceIds(conversationId);
    return ids.length > 0 ? ids[ids.length - 1] : null;
  }, [conversationId, renderTick]);

  const dismissSurface = useCallback((surfaceId: string) => {
    setDismissedSurfaceIds((prev) => {
      const next = new Set(prev);
      next.add(surfaceId);
      return next;
    });
  }, []);

  const dispatchAction = useCallback((action: A2UIClientAction) => {
    window.electronAPI?.chat.dispatchA2UIAction?.(action);
  }, []);

  const updateLocalData = useCallback((surfaceId: string, path: string, value: unknown) => {
    managerRef.current.updateLocalData(surfaceId, path, value);
  }, []);

  const getDataModel = useCallback((surfaceId: string) => {
    return managerRef.current.getDataModel(surfaceId);
  }, []);

  const clearSurfaces = useCallback(() => {
    if (conversationId) {
      managerRef.current.clearConversation(conversationId);
    }
  }, [conversationId]);

  return {
    surfaces,
    surfacesByTurn,
    latestSurfaceId,
    dismissedSurfaceIds,
    dismissSurface,
    dispatchAction,
    updateLocalData,
    getDataModel,
    clearSurfaces,
  };
}
