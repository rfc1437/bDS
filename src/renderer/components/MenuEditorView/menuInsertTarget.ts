import type { MenuItemData } from '../../../main/shared/electronApi';

function findPathById(items: MenuItemData[], id: string, path: number[] = []): number[] | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const nextPath = [...path, index];
    if (item.id === id) {
      return nextPath;
    }

    const nested = findPathById(item.children, id, nextPath);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getNodeByPath(items: MenuItemData[], path: number[]): MenuItemData | null {
  let currentItems = items;
  let current: MenuItemData | null = null;

  for (const segment of path) {
    current = currentItems[segment] || null;
    if (!current) {
      return null;
    }
    currentItems = current.children;
  }

  return current;
}

export interface InsertTarget {
  parentPath: number[];
  index: number;
}

export function resolveInsertTarget(items: MenuItemData[], selectedId: string | null): InsertTarget {
  if (!selectedId) {
    return {
      parentPath: [],
      index: items.length,
    };
  }

  const path = findPathById(items, selectedId);
  if (!path || path.length === 0) {
    return {
      parentPath: [],
      index: items.length,
    };
  }

  const selectedNode = getNodeByPath(items, path);
  if (selectedNode?.kind === 'submenu') {
    return {
      parentPath: path,
      index: 0,
    };
  }

  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] + 1;
  return {
    parentPath,
    index,
  };
}
