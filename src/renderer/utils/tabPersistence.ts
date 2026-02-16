import type { TabState } from '../store';

const TAB_STATE_PREFIX = 'bds-tabs-';

export const saveTabsForProject = (projectId: string, tabState: TabState): void => {
  try {
    localStorage.setItem(`${TAB_STATE_PREFIX}${projectId}`, JSON.stringify(tabState));
  } catch (error) {
    console.error('Failed to save tab state:', error);
  }
};

export const loadTabsForProject = (projectId: string): TabState | null => {
  try {
    const stored = localStorage.getItem(`${TAB_STATE_PREFIX}${projectId}`);
    if (stored) {
      return JSON.parse(stored) as TabState;
    }
  } catch (error) {
    console.error('Failed to load tab state:', error);
  }
  return null;
};