/**
 * Tests for postGrouping utility
 * 
 * Tests the groupPostsByStatus function that ensures posts are correctly
 * grouped by status, with stale cached filter results freshened from store data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { groupPostsByStatus } from '../../../src/renderer/utils/postGrouping';
import type { PostData } from '../../../src/renderer/store/appStore';

// Factory function for creating test posts
function createTestPost(overrides: Partial<PostData>): PostData {
  return {
    id: 'test-id',
    title: 'Test Post',
    slug: 'test-post',
    excerpt: 'Test excerpt',
    content: 'Test content',
    status: 'draft',
    author: 'Test Author',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tags: [],
    categories: [],
    ...overrides,
  };
}

describe('groupPostsByStatus', () => {
  let draftPost: PostData;
  let publishedPost: PostData;
  let archivedPost: PostData;

  beforeEach(() => {
    draftPost = createTestPost({ id: 'draft-1', status: 'draft', title: 'Draft Post' });
    publishedPost = createTestPost({ id: 'published-1', status: 'published', title: 'Published Post', publishedAt: '2024-01-01T00:00:00Z' });
    archivedPost = createTestPost({ id: 'archived-1', status: 'archived', title: 'Archived Post' });
  });

  describe('without filters (filteredPosts is null)', () => {
    it('should group all posts by their status', () => {
      const storePosts = [draftPost, publishedPost, archivedPost];
      
      const result = groupPostsByStatus(storePosts, null);
      
      expect(result.draft).toHaveLength(1);
      expect(result.draft[0].id).toBe('draft-1');
      
      expect(result.published).toHaveLength(1);
      expect(result.published[0].id).toBe('published-1');
      
      expect(result.archived).toHaveLength(1);
      expect(result.archived[0].id).toBe('archived-1');
    });

    it('should return empty arrays when no posts exist', () => {
      const result = groupPostsByStatus([], null);
      
      expect(result.draft).toHaveLength(0);
      expect(result.published).toHaveLength(0);
      expect(result.archived).toHaveLength(0);
    });

    it('should handle multiple posts with the same status', () => {
      const draft2 = createTestPost({ id: 'draft-2', status: 'draft' });
      const published2 = createTestPost({ id: 'published-2', status: 'published' });
      const storePosts = [draftPost, draft2, publishedPost, published2];
      
      const result = groupPostsByStatus(storePosts, null);
      
      expect(result.draft).toHaveLength(2);
      expect(result.published).toHaveLength(2);
      expect(result.archived).toHaveLength(0);
    });
  });

  describe('with active filters (filteredPosts is not null)', () => {
    it('should use filtered posts for published/archived, but always use store for drafts', () => {
      const storePosts = [draftPost, publishedPost, archivedPost];
      // Filter only returns the published post
      const filteredPosts = [publishedPost];
      
      const result = groupPostsByStatus(storePosts, filteredPosts);
      
      // Drafts always come from store
      expect(result.draft).toHaveLength(1);
      expect(result.draft[0].id).toBe('draft-1');
      
      // Published/archived come from filtered list
      expect(result.published).toHaveLength(1);
      expect(result.published[0].id).toBe('published-1');
      expect(result.archived).toHaveLength(0);
    });
  });

  describe('freshening stale cached data (the bug fix)', () => {
    it('should NOT show post in published when its status changed to draft in store', () => {
      // Initial state: post is published
      const originalPublishedPost = createTestPost({ 
        id: 'post-1', 
        status: 'published',
        title: 'My Post' 
      });
      
      // User edits the post, changing status to draft in the store
      const updatedPost = createTestPost({ 
        id: 'post-1', 
        status: 'draft',  // Changed!
        title: 'My Post' 
      });
      
      // Store has the updated version
      const storePosts = [updatedPost];
      
      // Filter cache still has the old version with 'published' status
      const staleFilteredPosts = [originalPublishedPost];
      
      const result = groupPostsByStatus(storePosts, staleFilteredPosts);
      
      // Post should appear in drafts (from fresh store data)
      expect(result.draft).toHaveLength(1);
      expect(result.draft[0].id).toBe('post-1');
      expect(result.draft[0].status).toBe('draft');
      
      // Post should NOT appear in published (stale data should be freshened)
      expect(result.published).toHaveLength(0);
    });

    it('should freshen all properties from store, not just status', () => {
      // Store has updated post
      const storePost = createTestPost({ 
        id: 'post-1', 
        status: 'published',
        title: 'Updated Title',
        content: 'Updated content'
      });
      
      // Cache has stale data
      const cachedPost = createTestPost({ 
        id: 'post-1', 
        status: 'published',
        title: 'Old Title',
        content: 'Old content'
      });
      
      const result = groupPostsByStatus([storePost], [cachedPost]);
      
      expect(result.published).toHaveLength(1);
      expect(result.published[0].title).toBe('Updated Title');
      expect(result.published[0].content).toBe('Updated content');
    });

    it('should keep cached post if not found in store (e.g., paginated out)', () => {
      // Store doesn't have the post (paginated out)
      const storePosts: PostData[] = [];
      
      // Cache still has the post from a search result
      const cachedPost = createTestPost({ 
        id: 'post-1', 
        status: 'published',
        title: 'Paginated Post'
      });
      
      const result = groupPostsByStatus(storePosts, [cachedPost]);
      
      // Should keep the cached version since it's not in store
      expect(result.published).toHaveLength(1);
      expect(result.published[0].title).toBe('Paginated Post');
    });

    it('should handle mix of fresh and stale posts in filter results', () => {
      // Store has two posts
      const freshPost1 = createTestPost({ id: 'post-1', status: 'published', title: 'Fresh 1' });
      const freshPost2 = createTestPost({ id: 'post-2', status: 'draft', title: 'Fresh 2' }); // Changed to draft!
      
      // Cache has stale versions
      const stalePost1 = createTestPost({ id: 'post-1', status: 'published', title: 'Stale 1' });
      const stalePost2 = createTestPost({ id: 'post-2', status: 'published', title: 'Stale 2' }); // Was published
      const cachedOnlyPost = createTestPost({ id: 'post-3', status: 'archived', title: 'Cached Only' });
      
      const result = groupPostsByStatus(
        [freshPost1, freshPost2],
        [stalePost1, stalePost2, cachedOnlyPost]
      );
      
      // post-1: freshened from store, still published
      expect(result.published).toHaveLength(1);
      expect(result.published[0].id).toBe('post-1');
      expect(result.published[0].title).toBe('Fresh 1'); // Freshened!
      
      // post-2: freshened from store, now draft - appears in drafts
      expect(result.draft).toHaveLength(1);
      expect(result.draft[0].id).toBe('post-2');
      expect(result.draft[0].status).toBe('draft');
      
      // post-3: not in store, kept from cache
      expect(result.archived).toHaveLength(1);
      expect(result.archived[0].id).toBe('post-3');
    });
  });

  describe('edge cases', () => {
    it('should handle empty filter results', () => {
      const storePosts = [draftPost, publishedPost];
      
      const result = groupPostsByStatus(storePosts, []);
      
      // Empty filter returns no published/archived
      expect(result.draft).toHaveLength(1); // Drafts always from store
      expect(result.published).toHaveLength(0);
      expect(result.archived).toHaveLength(0);
    });

    it('should not create duplicates when same post is in store and filter', () => {
      const post = createTestPost({ id: 'post-1', status: 'published' });
      
      const result = groupPostsByStatus([post], [post]);
      
      expect(result.published).toHaveLength(1);
    });
  });
});
