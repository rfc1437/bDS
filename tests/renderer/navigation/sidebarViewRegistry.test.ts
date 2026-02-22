import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_VIEW,
  SIDEBAR_VIEW_REGISTRY,
  isSidebarView,
} from '../../../src/renderer/navigation/sidebarViewRegistry';

describe('sidebarViewRegistry', () => {
  it('defines all supported sidebar views in one canonical registry', () => {
    expect(SIDEBAR_VIEW_REGISTRY).toEqual([
      'posts',
      'pages',
      'media',
      'scripts',
      'settings',
      'tags',
      'chat',
      'import',
      'git',
    ]);
  });

  it('uses posts as default sidebar view', () => {
    expect(DEFAULT_SIDEBAR_VIEW).toBe('posts');
  });

  it('validates sidebar view values', () => {
    expect(isSidebarView('tags')).toBe(true);
    expect(isSidebarView('unknown')).toBe(false);
  });
});
