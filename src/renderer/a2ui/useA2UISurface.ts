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

interface UseA2UISurfaceResult {
  /** All active surface trees for this conversation */
  surfaces: Array<{ surfaceId: string; tree: A2UIResolvedComponent[] }>;
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

  // Clear surfaces when conversation changes
  useEffect(() => {
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
    dispatchAction,
    updateLocalData,
    getDataModel,
    clearSurfaces,
  };
}
