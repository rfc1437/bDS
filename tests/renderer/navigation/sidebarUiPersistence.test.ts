import { describe, expect, it } from 'vitest';
import { getPersistedSidebarSection, setPersistedSidebarSection } from '../../../src/renderer/navigation/sidebarUiPersistence';

describe('sidebarUiPersistence', () => {
  it('persists and reads section ids by sidebar key', () => {
    setPersistedSidebarSection('settings', 'project');

    expect(getPersistedSidebarSection('settings')).toBe('project');
  });

  it('returns null for missing persisted section', () => {
    expect(getPersistedSidebarSection('tags')).toBeNull();
  });
});
