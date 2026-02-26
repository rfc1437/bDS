/**
 * A2UI Surface Manager
 *
 * Client-side state manager that processes incoming A2UI server messages
 * and maintains surface state (component buffer, data model, component tree).
 *
 * This is a pure state manager with no React dependency — it can be tested
 * independently and wrapped by a React hook.
 */

import type {
  A2UIServerMessage,
  A2UISurfaceState,
  A2UIResolvedComponent,
} from '../../main/a2ui/types';

export type SurfaceChangeListener = (surfaceId: string) => void;

export class A2UISurfaceManager {
  private surfaces = new Map<string, A2UISurfaceState>();
  private listeners: SurfaceChangeListener[] = [];

  /**
   * Process an incoming A2UI server message.
   */
  processMessage(message: A2UIServerMessage): void {
    switch (message.type) {
      case 'createSurface':
        this.surfaces.set(message.surfaceId, {
          surfaceId: message.surfaceId,
          conversationId: message.conversationId,
          components: new Map(),
          rootIds: [],
          dataModel: {},
          metadata: message.metadata,
        });
        this.notify(message.surfaceId);
        break;

      case 'updateComponents': {
        const surface = this.surfaces.get(message.surfaceId);
        if (!surface) {
          return;
        }

        for (const component of message.components) {
          surface.components.set(component.id, component);
        }

        if (message.rootIds) {
          surface.rootIds = message.rootIds;
        }

        this.notify(message.surfaceId);
        break;
      }

      case 'updateDataModel': {
        const surface = this.surfaces.get(message.surfaceId);
        if (!surface) {
          return;
        }

        setValueAtPointer(surface.dataModel, message.path, message.value);
        this.notify(message.surfaceId);
        break;
      }

      case 'deleteSurface':
        this.surfaces.delete(message.surfaceId);
        this.notify(message.surfaceId);
        break;
    }
  }

  /**
   * Get all active surface IDs for a conversation.
   */
  getSurfaceIds(conversationId: string): string[] {
    const ids: string[] = [];
    for (const [surfaceId, state] of this.surfaces) {
      if (state.conversationId === conversationId) {
        ids.push(surfaceId);
      }
    }
    return ids;
  }

  /**
   * Get raw surface state.
   */
  getSurface(surfaceId: string): A2UISurfaceState | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Resolve the component tree for a surface.
   * Converts flat component buffer + ID references into a nested tree.
   */
  resolveTree(surfaceId: string): A2UIResolvedComponent[] {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      return [];
    }

    return surface.rootIds
      .map((id) => this.resolveComponent(surface, id))
      .filter((c): c is A2UIResolvedComponent => c !== null);
  }

  /**
   * Update the local data model value (for input binding).
   */
  updateLocalData(surfaceId: string, path: string, value: unknown): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      return;
    }

    setValueAtPointer(surface.dataModel, path, value);
    this.notify(surfaceId);
  }

  /**
   * Get the data model for a surface.
   */
  getDataModel(surfaceId: string): Record<string, unknown> {
    return this.surfaces.get(surfaceId)?.dataModel ?? {};
  }

  /**
   * Delete all surfaces for a conversation.
   */
  clearConversation(conversationId: string): void {
    const toDelete: string[] = [];
    for (const [surfaceId, state] of this.surfaces) {
      if (state.conversationId === conversationId) {
        toDelete.push(surfaceId);
      }
    }
    for (const surfaceId of toDelete) {
      this.surfaces.delete(surfaceId);
      this.notify(surfaceId);
    }
  }

  /**
   * Subscribe to surface changes.
   */
  onChange(listener: SurfaceChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(surfaceId: string): void {
    for (const listener of this.listeners) {
      listener(surfaceId);
    }
  }

  private resolveComponent(
    surface: A2UISurfaceState,
    componentId: string,
  ): A2UIResolvedComponent | null {
    const component = surface.components.get(componentId);
    if (!component) {
      return null;
    }

    const children = (component.children ?? [])
      .map((childId) => this.resolveComponent(surface, childId))
      .filter((c): c is A2UIResolvedComponent => c !== null);

    let boundValue: unknown = undefined;
    if (component.dataBinding) {
      boundValue = getValueAtPointer(surface.dataModel, component.dataBinding);
    }

    return {
      id: component.id,
      type: component.type,
      properties: component.properties,
      dataBinding: component.dataBinding,
      boundValue,
      actions: component.actions,
      children,
    };
  }
}

/**
 * Get a value from a JSON object using a JSON Pointer (RFC 6901).
 */
export function getValueAtPointer(
  obj: Record<string, unknown>,
  pointer: string,
): unknown {
  if (!pointer || pointer === '/') {
    return obj;
  }

  const parts = pointer.split('/').filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a value in a JSON object using a JSON Pointer (RFC 6901).
 */
export function setValueAtPointer(
  obj: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  if (!pointer || pointer === '/') {
    return;
  }

  const parts = pointer.split('/').filter(Boolean);

  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i].replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
  current[lastKey] = value;
}
