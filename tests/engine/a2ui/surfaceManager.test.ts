import { describe, expect, it, vi } from 'vitest';
import {
  A2UISurfaceManager,
  getValueAtPointer,
  setValueAtPointer,
} from '../../../src/renderer/a2ui/A2UISurfaceManager';
import type { A2UIServerMessage, A2UIComponent } from '../../../src/main/a2ui/types';

describe('A2UISurfaceManager', () => {
  function createTestComponent(overrides: Partial<A2UIComponent> = {}): A2UIComponent {
    return {
      id: 'comp-1',
      type: 'text',
      properties: { text: 'Hello' },
      ...overrides,
    };
  }

  describe('createSurface', () => {
    it('creates a new surface with empty state', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({
        type: 'createSurface',
        surfaceId: 'surface-1',
        conversationId: 'conv-1',
      });

      const surface = manager.getSurface('surface-1');
      expect(surface).toBeDefined();
      expect(surface!.conversationId).toBe('conv-1');
      expect(surface!.components.size).toBe(0);
      expect(surface!.rootIds).toEqual([]);
      expect(surface!.dataModel).toEqual({});
    });

    it('notifies listeners on surface creation', () => {
      const manager = new A2UISurfaceManager();
      const listener = vi.fn();
      manager.onChange(listener);

      manager.processMessage({
        type: 'createSurface',
        surfaceId: 'surface-1',
        conversationId: 'conv-1',
      });

      expect(listener).toHaveBeenCalledWith('surface-1');
    });
  });

  describe('updateComponents', () => {
    it('adds components to an existing surface', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({
        type: 'createSurface',
        surfaceId: 'surface-1',
        conversationId: 'conv-1',
      });

      const component = createTestComponent();
      manager.processMessage({
        type: 'updateComponents',
        surfaceId: 'surface-1',
        components: [component],
        rootIds: ['comp-1'],
      });

      const surface = manager.getSurface('surface-1');
      expect(surface!.components.size).toBe(1);
      expect(surface!.components.get('comp-1')).toEqual(component);
      expect(surface!.rootIds).toEqual(['comp-1']);
    });

    it('ignores updateComponents for non-existent surfaces', () => {
      const manager = new A2UISurfaceManager();
      const listener = vi.fn();
      manager.onChange(listener);

      manager.processMessage({
        type: 'updateComponents',
        surfaceId: 'nonexistent',
        components: [createTestComponent()],
        rootIds: ['comp-1'],
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('updateDataModel', () => {
    it('sets a value in the data model', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({
        type: 'createSurface',
        surfaceId: 'surface-1',
        conversationId: 'conv-1',
      });

      manager.processMessage({
        type: 'updateDataModel',
        surfaceId: 'surface-1',
        path: '/chartData',
        value: [{ label: 'A', value: 1 }],
      });

      const dataModel = manager.getDataModel('surface-1');
      expect(dataModel).toEqual({ chartData: [{ label: 'A', value: 1 }] });
    });

    it('ignores updateDataModel for non-existent surfaces', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({
        type: 'updateDataModel',
        surfaceId: 'nonexistent',
        path: '/foo',
        value: 'bar',
      });

      expect(manager.getDataModel('nonexistent')).toEqual({});
    });
  });

  describe('deleteSurface', () => {
    it('removes a surface', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({
        type: 'createSurface',
        surfaceId: 'surface-1',
        conversationId: 'conv-1',
      });

      expect(manager.getSurface('surface-1')).toBeDefined();

      manager.processMessage({
        type: 'deleteSurface',
        surfaceId: 'surface-1',
      });

      expect(manager.getSurface('surface-1')).toBeUndefined();
    });
  });

  describe('getSurfaceIds', () => {
    it('returns surface IDs for a specific conversation', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.processMessage({ type: 'createSurface', surfaceId: 's2', conversationId: 'conv-1' });
      manager.processMessage({ type: 'createSurface', surfaceId: 's3', conversationId: 'conv-2' });

      expect(manager.getSurfaceIds('conv-1')).toEqual(['s1', 's2']);
      expect(manager.getSurfaceIds('conv-2')).toEqual(['s3']);
      expect(manager.getSurfaceIds('conv-3')).toEqual([]);
    });
  });

  describe('resolveTree', () => {
    it('resolves a flat component buffer into a nested tree', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.processMessage({
        type: 'updateComponents',
        surfaceId: 's1',
        components: [
          { id: 'root', type: 'column', properties: {}, children: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'text', properties: { text: 'Hello' } },
          { id: 'child-2', type: 'button', properties: { label: 'Click' } },
        ],
        rootIds: ['root'],
      });

      const tree = manager.resolveTree('s1');

      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('column');
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].type).toBe('text');
      expect(tree[0].children[0].properties.text).toBe('Hello');
      expect(tree[0].children[1].type).toBe('button');
    });

    it('resolves data bindings to bound values', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.processMessage({
        type: 'updateComponents',
        surfaceId: 's1',
        components: [
          { id: 'chart-1', type: 'chart', properties: { chartType: 'bar' }, dataBinding: '/data' },
        ],
        rootIds: ['chart-1'],
      });
      manager.processMessage({
        type: 'updateDataModel',
        surfaceId: 's1',
        path: '/data',
        value: [1, 2, 3],
      });

      const tree = manager.resolveTree('s1');
      expect(tree[0].boundValue).toEqual([1, 2, 3]);
    });

    it('returns empty array for non-existent surface', () => {
      const manager = new A2UISurfaceManager();
      expect(manager.resolveTree('nonexistent')).toEqual([]);
    });

    it('filters out unresolvable child references', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.processMessage({
        type: 'updateComponents',
        surfaceId: 's1',
        components: [
          { id: 'root', type: 'column', properties: {}, children: ['child-1', 'missing'] },
          { id: 'child-1', type: 'text', properties: { text: 'Hello' } },
        ],
        rootIds: ['root'],
      });

      const tree = manager.resolveTree('s1');
      expect(tree[0].children).toHaveLength(1);
    });
  });

  describe('updateLocalData', () => {
    it('updates data model and notifies listeners', () => {
      const manager = new A2UISurfaceManager();
      const listener = vi.fn();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.onChange(listener);

      manager.updateLocalData('s1', '/formData/name', 'John');

      expect(manager.getDataModel('s1')).toEqual({ formData: { name: 'John' } });
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('ignores updates for non-existent surfaces', () => {
      const manager = new A2UISurfaceManager();
      const listener = vi.fn();
      manager.onChange(listener);

      manager.updateLocalData('nonexistent', '/foo', 'bar');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clearConversation', () => {
    it('removes all surfaces for a conversation', () => {
      const manager = new A2UISurfaceManager();

      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      manager.processMessage({ type: 'createSurface', surfaceId: 's2', conversationId: 'conv-1' });
      manager.processMessage({ type: 'createSurface', surfaceId: 's3', conversationId: 'conv-2' });

      manager.clearConversation('conv-1');

      expect(manager.getSurfaceIds('conv-1')).toEqual([]);
      expect(manager.getSurfaceIds('conv-2')).toEqual(['s3']);
    });
  });

  describe('onChange', () => {
    it('returns an unsubscribe function', () => {
      const manager = new A2UISurfaceManager();
      const listener = vi.fn();

      const unsubscribe = manager.onChange(listener);
      manager.processMessage({ type: 'createSurface', surfaceId: 's1', conversationId: 'conv-1' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.processMessage({ type: 'createSurface', surfaceId: 's2', conversationId: 'conv-1' });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

describe('JSON Pointer utilities', () => {
  describe('getValueAtPointer', () => {
    it('returns the root object for empty or "/" pointer', () => {
      const obj = { foo: 'bar' };
      expect(getValueAtPointer(obj, '')).toBe(obj);
      expect(getValueAtPointer(obj, '/')).toBe(obj);
    });

    it('gets a top-level value', () => {
      expect(getValueAtPointer({ name: 'Alice' }, '/name')).toBe('Alice');
    });

    it('gets a nested value', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(getValueAtPointer(obj, '/a/b/c')).toBe(42);
    });

    it('returns undefined for missing paths', () => {
      expect(getValueAtPointer({ a: 1 }, '/b')).toBeUndefined();
      expect(getValueAtPointer({ a: 1 }, '/a/b/c')).toBeUndefined();
    });

    it('handles escaped pointer characters', () => {
      const obj = { 'a/b': { '~c': 'value' } };
      expect(getValueAtPointer(obj, '/a~1b/~0c')).toBe('value');
    });
  });

  describe('setValueAtPointer', () => {
    it('sets a top-level value', () => {
      const obj: Record<string, unknown> = {};
      setValueAtPointer(obj, '/name', 'Alice');
      expect(obj.name).toBe('Alice');
    });

    it('creates intermediate objects for nested paths', () => {
      const obj: Record<string, unknown> = {};
      setValueAtPointer(obj, '/a/b/c', 42);
      expect(obj).toEqual({ a: { b: { c: 42 } } });
    });

    it('does nothing for empty or root pointer', () => {
      const obj = { foo: 'bar' };
      setValueAtPointer(obj, '', 'new');
      setValueAtPointer(obj, '/', 'new');
      expect(obj).toEqual({ foo: 'bar' });
    });

    it('handles escaped pointer characters', () => {
      const obj: Record<string, unknown> = {};
      setValueAtPointer(obj, '/a~1b', 'value');
      expect(obj['a/b']).toBe('value');
    });
  });
});
