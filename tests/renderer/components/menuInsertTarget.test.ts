import { describe, expect, it } from 'vitest';

import type { MenuItemData } from '../../../src/main/shared/electronApi';
import { resolveInsertTarget } from '../../../src/renderer/components/MenuEditorView/menuInsertTarget';

function createTree(): MenuItemData[] {
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
  ];
}

describe('resolveInsertTarget', () => {
  it('inserts on root level when no selection exists', () => {
    const result = resolveInsertTarget(createTree(), null);
    expect(result).toEqual({ parentPath: [], index: 2 });
  });

  it('inserts as first child when selected node is submenu', () => {
    const result = resolveInsertTarget(createTree(), 'docs');
    expect(result).toEqual({ parentPath: [1], index: 0 });
  });

  it('inserts as next sibling when selected node is page', () => {
    const result = resolveInsertTarget(createTree(), 'home');
    expect(result).toEqual({ parentPath: [], index: 1 });
  });
});
