import { describe, expect, it } from 'vitest';
import { applyTreeMove, type MenuTreeItem } from '../../../src/renderer/components/MenuEditorView/menuTreeMove';

function createTree(): MenuTreeItem[] {
  return [
    {
      id: 'home',
      title: 'Home',
      kind: 'page',
      children: [],
    },
    {
      id: 'docs',
      title: 'Docs',
      kind: 'submenu',
      children: [
        {
          id: 'about',
          title: 'About',
          kind: 'page',
          children: [],
        },
      ],
    },
    {
      id: 'blog',
      title: 'Blog',
      kind: 'submenu',
      children: [
        {
          id: 'post-1',
          title: 'Post 1',
          kind: 'page',
          children: [],
        },
        {
          id: 'post-2',
          title: 'Post 2',
          kind: 'page',
          children: [],
        },
      ],
    },
  ];
}

describe('applyTreeMove', () => {
  it('moves a page into a submenu', () => {
    const moved = applyTreeMove(createTree(), {
      dragIds: ['home'],
      parentId: 'docs',
      index: 1,
    });

    const docs = moved.find((item) => item.id === 'docs');
    expect(docs?.children.map((child) => child.id)).toEqual(['about', 'home']);
    expect(moved.map((item) => item.id)).toEqual(['docs', 'blog']);
  });

  it('moves a whole subtree without losing children', () => {
    const moved = applyTreeMove(createTree(), {
      dragIds: ['blog'],
      parentId: null,
      index: 0,
    });

    expect(moved[0].id).toBe('blog');
    expect(moved[0].children.map((child) => child.id)).toEqual(['post-1', 'post-2']);
  });

  it('reorders siblings within same parent', () => {
    const moved = applyTreeMove(createTree(), {
      dragIds: ['post-2'],
      parentId: 'blog',
      index: 0,
    });

    const blog = moved.find((item) => item.id === 'blog');
    expect(blog?.children.map((child) => child.id)).toEqual(['post-2', 'post-1']);
  });
});
