import { describe, expect, it } from 'vitest';
import {
  getActivityClickActions,
  isActivityActive,
  type ActivityId,
  type ActivitySnapshot,
} from '../../../src/renderer/navigation/activityBehavior';

function createSnapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return {
    activeView: 'posts',
    sidebarVisible: true,
    activeTabId: null,
    tabs: [],
    ...overrides,
  };
}

describe('activityBehavior', () => {
  it('marks standard sidebar activities active only when they own the visible sidebar', () => {
    const snapshot = createSnapshot({ activeView: 'posts', sidebarVisible: true });

    expect(isActivityActive(snapshot, 'posts')).toBe(true);
    expect(isActivityActive(snapshot, 'media')).toBe(false);

    const hiddenSidebar = createSnapshot({ activeView: 'posts', sidebarVisible: false });
    expect(isActivityActive(hiddenSidebar, 'posts')).toBe(false);
  });

  it('does not keep settings active from tab alone when another sidebar owns visibility', () => {
    const snapshot = createSnapshot({
      activeView: 'posts',
      sidebarVisible: true,
      activeTabId: 'settings',
      tabs: [{ type: 'settings', id: 'settings', isTransient: false }],
    });

    expect(isActivityActive(snapshot, 'settings')).toBe(false);
  });

  it('does not keep tags active from tab alone when another sidebar owns visibility', () => {
    const snapshot = createSnapshot({
      activeView: 'posts',
      sidebarVisible: true,
      activeTabId: 'tags',
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
    });

    expect(isActivityActive(snapshot, 'tags')).toBe(false);
  });

  it('returns posts-style sidebar actions for settings/tags/import', () => {
    const snapshot = createSnapshot({ activeView: 'posts', sidebarVisible: false });

    expect(getActivityClickActions(snapshot, 'tags')).toEqual([
      { type: 'setActiveView', view: 'tags' },
      { type: 'toggleSidebar' },
    ]);

    expect(getActivityClickActions(snapshot, 'settings')).toEqual([
      { type: 'setActiveView', view: 'settings' },
      { type: 'toggleSidebar' },
    ]);

    expect(getActivityClickActions(snapshot, 'import')).toEqual([
      { type: 'setActiveView', view: 'import' },
      { type: 'toggleSidebar' },
    ]);
  });

  it('returns posts-style switch action when sidebar is already visible', () => {
    const snapshot = createSnapshot({ activeView: 'posts', sidebarVisible: true });

    expect(getActivityClickActions(snapshot, 'settings')).toEqual([
      { type: 'setActiveView', view: 'settings' },
    ]);

    expect(getActivityClickActions(snapshot, 'tags')).toEqual([
      { type: 'setActiveView', view: 'tags' },
    ]);
  });

  it('returns only sidebar actions for pure sidebar activities', () => {
    const snapshot = createSnapshot({ activeView: 'chat', sidebarVisible: true });

    expect(getActivityClickActions(snapshot, 'chat')).toEqual([{ type: 'toggleSidebar' }]);
  });

  it('supports all expected activity ids', () => {
    const ids: ActivityId[] = ['posts', 'pages', 'media', 'tags', 'chat', 'import', 'git', 'settings'];
    expect(ids).toHaveLength(8);
  });
});
