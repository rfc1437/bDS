import type { MenuItemData } from '../../../main/shared/electronApi';

export type MenuTreeItem = MenuItemData;

interface TreeMoveInput {
  dragIds: string[];
  parentId: string | null;
  index: number;
}

function findPathById(items: MenuTreeItem[], id: string, path: number[] = []): number[] | null {
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

function removeItemByPath(items: MenuTreeItem[], path: number[]): { next: MenuTreeItem[]; removed: MenuTreeItem | null } {
  if (path.length === 0) {
    return { next: items, removed: null };
  }

  if (path.length === 1) {
    const [index] = path;
    if (index < 0 || index >= items.length) {
      return { next: items, removed: null };
    }

    const removed = items[index];
    return {
      next: items.filter((_, currentIndex) => currentIndex !== index),
      removed,
    };
  }

  const [head, ...tail] = path;
  const current = items[head];
  if (!current) {
    return { next: items, removed: null };
  }

  const nested = removeItemByPath(current.children, tail);
  if (!nested.removed) {
    return { next: items, removed: null };
  }

  const next = items.map((item, index) => (index === head ? { ...item, children: nested.next } : item));
  return { next, removed: nested.removed };
}

function insertItemsAtPath(items: MenuTreeItem[], parentPath: number[], index: number, nodes: MenuTreeItem[]): MenuTreeItem[] {
  if (parentPath.length === 0) {
    const boundedIndex = Math.max(0, Math.min(index, items.length));
    return [
      ...items.slice(0, boundedIndex),
      ...nodes,
      ...items.slice(boundedIndex),
    ];
  }

  const [head, ...tail] = parentPath;
  return items.map((item, currentIndex) => {
    if (currentIndex !== head) {
      return item;
    }

    return {
      ...item,
      children: insertItemsAtPath(item.children, tail, index, nodes),
    };
  });
}

export function applyTreeMove(items: MenuTreeItem[], move: TreeMoveInput): MenuTreeItem[] {
  if (!move.dragIds.length) {
    return items;
  }

  let working = items;
  const draggedNodes: MenuTreeItem[] = [];

  for (const dragId of move.dragIds) {
    const path = findPathById(working, dragId);
    if (!path) {
      continue;
    }

    const removed = removeItemByPath(working, path);
    if (removed.removed) {
      draggedNodes.push(removed.removed);
      working = removed.next;
    }
  }

  if (!draggedNodes.length) {
    return items;
  }

  const parentPath = move.parentId ? findPathById(working, move.parentId) : [];
  if (move.parentId && !parentPath) {
    return working;
  }

  return insertItemsAtPath(working, parentPath || [], move.index, draggedNodes);
}
