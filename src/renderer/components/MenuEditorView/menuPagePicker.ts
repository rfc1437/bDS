import type { MenuItemData, PostData } from '../../../main/shared/electronApi';

function createMenuItemId(): string {
  return `menu-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function filterPagePosts(posts: PostData[], query: string): PostData[] {
  const normalized = query.trim().toLowerCase();

  return posts.filter((post) => {
    if (!(post.categories || []).includes('page')) {
      return false;
    }

    if (!normalized) {
      return true;
    }

    return post.title.toLowerCase().includes(normalized) || post.slug.toLowerCase().includes(normalized);
  });
}

export function createMenuPageItemFromPost(post: PostData): MenuItemData {
  return {
    id: createMenuItemId(),
    title: post.title,
    kind: 'page',
    pageId: post.id,
    pageSlug: post.slug,
    children: [],
  };
}

export function getNextPickerIndex(currentIndex: number, key: 'ArrowDown' | 'ArrowUp', total: number): number {
  if (total <= 0) {
    return -1;
  }

  if (key === 'ArrowDown') {
    const next = currentIndex + 1;
    return next >= total ? 0 : Math.max(0, next);
  }

  const next = currentIndex < 0 ? total - 1 : currentIndex - 1;
  return next < 0 ? total - 1 : next;
}

export function isPickerCloseKey(key: string): boolean {
  return key === 'Escape';
}

export function isPickerFocusShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  const normalizedKey = event.key.toLowerCase();
  return normalizedKey === 'k' && (event.metaKey || event.ctrlKey);
}
