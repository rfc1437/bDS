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

  it('includes Open in Browser and Open Data Folder actions in File menu', () => {
    const fileGroup = APP_MENU_GROUPS.find((group) => group.label === 'File');

    expect(fileGroup).toBeDefined();
    expect(fileGroup?.items.some((item) => item.action === 'openInBrowser')).toBe(true);
    expect(fileGroup?.items.some((item) => item.action === 'openDataFolder')).toBe(true);
  });

  it('includes Preview Post action in Blog menu', () => {
    const blogGroup = APP_MENU_GROUPS.find((group) => group.label === 'Blog');

    expect(blogGroup).toBeDefined();
    expect(blogGroup?.items.some((item) => item.action === 'previewPost')).toBe(true);
  });

  it('includes shared View actions for reload, zoom and fullscreen controls', () => {
    const viewGroup = APP_MENU_GROUPS.find((group) => group.label === 'View');

    expect(viewGroup).toBeDefined();
    expect(viewGroup?.items.some((item) => item.action === 'reload')).toBe(true);
    expect(viewGroup?.items.some((item) => item.action === 'forceReload')).toBe(true);
    expect(viewGroup?.items.some((item) => item.action === 'resetZoom')).toBe(true);
    expect(viewGroup?.items.some((item) => item.action === 'zoomIn')).toBe(true);
    expect(viewGroup?.items.some((item) => item.action === 'zoomOut')).toBe(true);
    expect(viewGroup?.items.some((item) => item.action === 'toggleFullScreen')).toBe(true);
  });

  it('renames generateSitemap menu item to Render Site and assigns Command/Ctrl+R', () => {
    const blogGroup = APP_MENU_GROUPS.find((group) => group.label === 'Blog');
    const generateSiteItem = blogGroup?.items.find((item) => item.action === 'generateSitemap');

    expect(generateSiteItem).toBeDefined();
    expect(generateSiteItem?.label).toBe('Render Site');
    expect(generateSiteItem?.accelerator).toBe('CmdOrCtrl+R');
  });
});
