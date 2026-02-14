import type { PostData } from '../store';

export type PostStatus = 'draft' | 'published' | 'archived';

export interface GroupedPosts {
  draft: PostData[];
  published: PostData[];
  archived: PostData[];
}

/**
 * Groups posts by status, freshening cached filter results with current store data.
 * 
 * This ensures that when a post's status changes in the store, the change is
 * reflected in all sections even when filters are active and have cached stale data.
 * 
 * @param storePosts - Fresh posts from the Zustand store
 * @param filteredPosts - Cached posts from search/filter results (may be stale), or null if no filter active
 * @returns Posts grouped by status with freshened data
 */
export function groupPostsByStatus(
  storePosts: PostData[],
  filteredPosts: PostData[] | null
): GroupedPosts {
  // Create a map for O(1) lookup of fresh post data from the store
  const postsById = new Map(storePosts.map(p => [p.id, p]));
  
  // Freshen filtered posts by using current store data when available
  const freshenedFilteredPosts = filteredPosts?.map(cachedPost => {
    const freshPost = postsById.get(cachedPost.id);
    return freshPost ?? cachedPost;
  }) ?? null;

  return {
    draft: storePosts.filter(p => p.status === 'draft'),
    published: (freshenedFilteredPosts ?? storePosts).filter(p => p.status === 'published'),
    archived: (freshenedFilteredPosts ?? storePosts).filter(p => p.status === 'archived'),
  };
}
