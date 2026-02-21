import { describe, expect, it } from 'vitest';

import type { PostData } from '../../../src/main/shared/electronApi';
import {
  createMenuPageItemFromPost,
  filterPagePosts,
  getNextPickerIndex,
  isPickerCloseKey,
  isPickerFocusShortcut,
} from '../../../src/renderer/components/MenuEditorView/menuPagePicker';

function createPost(overrides: Partial<PostData>): PostData {
  return {
    id: 'post-1',
    projectId: 'project-1',
    title: 'Sample Page',
    slug: 'sample-page',
    content: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    categories: ['page'],
    ...overrides,
  };
}

describe('menuPagePicker', () => {
  it('filters to page-category posts only', () => {
    const posts = [
      createPost({ id: 'page-1', categories: ['page'] }),
      createPost({ id: 'article-1', categories: ['article'] }),
    ];

    const result = filterPagePosts(posts, '');

    expect(result.map((post) => post.id)).toEqual(['page-1']);
  });

  it('filters by title and slug using case-insensitive query', () => {
    const posts = [
      createPost({ id: 'alpha', title: 'About Us', slug: 'about-us' }),
      createPost({ id: 'beta', title: 'Imprint', slug: 'impressum' }),
    ];

    expect(filterPagePosts(posts, 'about').map((post) => post.id)).toEqual(['alpha']);
    expect(filterPagePosts(posts, 'IMPRESS').map((post) => post.id)).toEqual(['beta']);
  });

  it('creates a menu page node with linked page metadata', () => {
    const post = createPost({
      id: 'page-3',
      title: 'Contact',
      slug: 'contact',
      categories: ['page'],
    });

    const item = createMenuPageItemFromPost(post);

    expect(item.kind).toBe('page');
    expect(item.title).toBe('Contact');
    expect(item.pageId).toBe('page-3');
    expect(item.pageSlug).toBe('contact');
    expect(item.children).toEqual([]);
    expect(item.id.length).toBeGreaterThan(0);
  });

  it('moves active index with arrow navigation and wraps around', () => {
    expect(getNextPickerIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(getNextPickerIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(getNextPickerIndex(2, 'ArrowDown', 3)).toBe(0);

    expect(getNextPickerIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(getNextPickerIndex(2, 'ArrowUp', 3)).toBe(1);
    expect(getNextPickerIndex(0, 'ArrowUp', 3)).toBe(2);
  });

  it('returns -1 when there are no picker items', () => {
    expect(getNextPickerIndex(-1, 'ArrowDown', 0)).toBe(-1);
    expect(getNextPickerIndex(1, 'ArrowUp', 0)).toBe(-1);
  });

  it('detects escape as picker close key', () => {
    expect(isPickerCloseKey('Escape')).toBe(true);
    expect(isPickerCloseKey('Enter')).toBe(false);
  });

  it('detects cmd/ctrl+k as picker focus shortcut', () => {
    expect(isPickerFocusShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPickerFocusShortcut({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isPickerFocusShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false);
    expect(isPickerFocusShortcut({ key: 'p', metaKey: true, ctrlKey: false })).toBe(false);
  });
});
