import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TabState } from '../../../src/renderer/store';
import { loadTabsForProject, saveTabsForProject } from '../../../src/renderer/utils/tabPersistence';

const projectId = 'project-1';

const sampleTabState: TabState = {
  tabs: [
    {
      id: 'post-1',
      type: 'post',
      title: 'Hello World',
      dirty: false,
    },
  ],
  activeTabId: 'post-1',
};

describe('tabPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves and loads tab state for a project', () => {
    saveTabsForProject(projectId, sampleTabState);

    const loaded = loadTabsForProject(projectId);

    expect(loaded).toEqual(sampleTabState);
  });

  it('returns null when no tab state is stored', () => {
    expect(loadTabsForProject(projectId)).toBeNull();
  });

  it('returns null when stored tab state is invalid JSON', () => {
    localStorage.setItem('bds-tabs-project-1', '{invalid-json');

    expect(loadTabsForProject(projectId)).toBeNull();
  });

  it('does not throw when localStorage.setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => saveTabsForProject(projectId, sampleTabState)).not.toThrow();
  });

  it('does not persist transient tabs', () => {
    const tabStateWithTransient = {
      tabs: [
        { id: 'documentation', type: 'documentation', isTransient: false },
        { id: 'site-validation-report', type: 'site-validation', isTransient: true },
      ],
      activeTabId: 'site-validation-report',
    } as unknown as TabState;

    saveTabsForProject(projectId, tabStateWithTransient);

    const loaded = loadTabsForProject(projectId);

    expect(loaded?.tabs).toEqual([
      { id: 'documentation', type: 'documentation', isTransient: false },
    ]);
    expect(loaded?.activeTabId).toBe('documentation');
  });
});
