import { describe, it, expect } from 'vitest';
import { APP_MENU_GROUPS, APP_MENU_ACTION_EVENT_MAP } from '../../src/main/shared/menuCommands';

describe('Help menu documentation entry', () => {
  it('includes an Open Documentation action in Help menu', () => {
    const helpGroup = APP_MENU_GROUPS.find((group) => group.label === 'Help');

    expect(helpGroup).toBeDefined();
    expect(helpGroup?.items.some((item) => item.action === 'openDocumentation')).toBe(true);
  });

  it('maps Open Documentation to a renderer menu event', () => {
    expect(APP_MENU_ACTION_EVENT_MAP.openDocumentation).toBe('menu:openDocumentation');
  });
});
