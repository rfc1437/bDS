import { describe, expect, it, vi } from 'vitest';
import {
  executeActivityClick,
  executeActivityClickActions,
} from '../../../src/renderer/navigation/activityExecution';
import type { ActivityAction, ActivitySnapshot } from '../../../src/renderer/navigation/activityBehavior';

const snapshot: ActivitySnapshot = {
  activeView: 'media',
  sidebarVisible: false,
  tabs: [],
  activeTabId: null,
};

describe('activityExecution', () => {
  it('applies action descriptors in order', () => {
    const actions: ActivityAction[] = [
      { type: 'setActiveView', view: 'posts' },
      { type: 'toggleSidebar' },
    ];

    const setActiveView = vi.fn();
    const toggleSidebar = vi.fn();

    executeActivityClickActions(actions, { setActiveView, toggleSidebar });

    expect(setActiveView).toHaveBeenCalledWith('posts');
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(setActiveView.mock.invocationCallOrder[0]).toBeLessThan(toggleSidebar.mock.invocationCallOrder[0]);
  });

  it('executes canonical click behavior from activity snapshot', () => {
    const setActiveView = vi.fn();
    const toggleSidebar = vi.fn();

    executeActivityClick(snapshot, 'posts', { setActiveView, toggleSidebar });

    expect(setActiveView).toHaveBeenCalledWith('posts');
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });
});
