import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (filePath: string) => {
    const normalizedPath = normalizePath(filePath);
    if (mockFiles.has(normalizedPath)) {
      return mockFiles.get(normalizedPath);
    }

    const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    mockFiles.set(normalizePath(filePath), content);
  }),
  mkdir: vi.fn(async (dirPath: string) => {
    mockDirs.add(normalizePath(dirPath));
  }),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

import { MenuEngine } from '../../src/main/engine/MenuEngine';

describe('MenuEngine', () => {
  let menuEngine: MenuEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
    mockDirs.clear();
    menuEngine = new MenuEngine();
    menuEngine.setProjectContext('project-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty menu when no OPML file exists', async () => {
    const result = await menuEngine.getMenu();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'menu-home',
      title: 'Home',
      kind: 'home',
      pageSlug: 'home',
    });
  });

  it('parses nested OPML outlines into menu items', async () => {
    const menuPath = normalizePath(`${menuEngine.getMetaDir()}/menu.opml`);
    mockFiles.set(
      menuPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Blog Menu</title></head>\n  <body>\n    <outline id="home" text="Home" type="page" pageSlug="home"/>\n    <outline id="docs" text="Docs" type="submenu">\n      <outline id="about" text="About" type="page" pageSlug="about"/>\n    </outline>\n  </body>\n</opml>`,
    );

    const result = await menuEngine.getMenu();

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'menu-home',
      title: 'Home',
      kind: 'home',
      pageSlug: 'home',
    });
    expect(result.items[1]).toMatchObject({
      id: 'docs',
      title: 'Docs',
      kind: 'submenu',
    });
    expect(result.items[1].children[0]).toMatchObject({
      id: 'about',
      title: 'About',
      kind: 'page',
      pageSlug: 'about',
    });
  });

  it('preserves custom title for category archive entries when OPML includes both text and title', async () => {
    const menuPath = normalizePath(`${menuEngine.getMetaDir()}/menu.opml`);
    mockFiles.set(
      menuPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Blog Menu</title></head>\n  <body>\n    <outline id="menu-home" text="Home" type="home" pageSlug="home"/>\n    <outline id="cat-news" text="news" title="Editorial Highlights" type="category-archive" categoryName="news"/>\n  </body>\n</opml>`,
    );

    const result = await menuEngine.getMenu();

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({
      id: 'cat-news',
      kind: 'category-archive',
      categoryName: 'news',
      title: 'Editorial Highlights',
    });
  });

  it('writes menu state as OPML and can read it back', async () => {
    const saved = await menuEngine.saveMenu({
      items: [
        {
          id: 'top',
          title: 'Top',
          kind: 'submenu',
          children: [
            {
              id: 'page-1',
              title: 'First Page',
              kind: 'page',
              pageSlug: 'first-page',
              children: [],
            },
          ],
        },
      ],
    });

    expect(saved.items.some((item) => item.id === 'menu-home')).toBe(true);
    expect(saved.items.some((item) => item.title === 'Top')).toBe(true);

    const roundTrip = await menuEngine.getMenu();
    expect(roundTrip).toEqual(saved);
  });

  it('keeps Home entry when payload tries to remove it', async () => {
    const saved = await menuEngine.saveMenu({
      items: [
        {
          id: 'custom-page',
          title: 'Custom',
          kind: 'page',
          pageSlug: 'custom',
          children: [],
        },
      ],
    });

    expect(saved.items.some((item) => item.id === 'menu-home')).toBe(true);
  });

  it('persists category archives as menu references without category metadata fields', async () => {
    await menuEngine.saveMenu({
      items: [
        {
          id: 'cat-news',
          title: 'Newsroom',
          kind: 'category-archive',
          categoryName: 'news',
          children: [],
        },
      ],
    });

    const menuPath = normalizePath(`${menuEngine.getMetaDir()}/menu.opml`);
    const xml = mockFiles.get(menuPath);

    expect(xml).toBeDefined();
    expect(xml).toContain('categoryName="news"');
    expect(xml).toContain('text="Newsroom"');
    expect(xml).not.toContain('renderInLists');
    expect(xml).not.toContain('showTitle');
  });
});