type SidebarSectionOwner = 'settings' | 'tags';

const SIDEBAR_SECTION_KEY_PREFIX = 'bds-sidebar-section';

function getStorageKey(owner: SidebarSectionOwner): string {
  return `${SIDEBAR_SECTION_KEY_PREFIX}:${owner}`;
}

export function getPersistedSidebarSection(owner: SidebarSectionOwner): string | null {
  try {
    const value = localStorage.getItem(getStorageKey(owner));
    return value || null;
  } catch {
    return null;
  }
}

export function setPersistedSidebarSection(owner: SidebarSectionOwner, sectionId: string): void {
  try {
    localStorage.setItem(getStorageKey(owner), sectionId);
  } catch {
    // Ignore storage failures
  }
}
