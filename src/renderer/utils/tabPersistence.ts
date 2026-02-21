import type { TabState } from '../store';

const TAB_STATE_PREFIX = 'bds-tabs-';

export const saveTabsForProject = (projectId: string, tabState: TabState): void => {
  try {
    const persistentTabs = tabState.tabs.filter((tab) => tab.isTransient !== true);
    const persistedState: TabState = {
      tabs: persistentTabs,
      activeTabId: persistentTabs.some((tab) => tab.id === tabState.activeTabId)
        ? tabState.activeTabId
        : (persistentTabs[0]?.id ?? null),
    };

    localStorage.setItem(`${TAB_STATE_PREFIX}${projectId}`, JSON.stringify(persistedState));
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