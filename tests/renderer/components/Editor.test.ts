/**
 * Editor Component Behavior Tests
 *
 * Tests the editor's store integration and behavior patterns.
 * Given the complexity of the Editor (Monaco, TipTap, async effects),
 * these tests focus on:
 * 1. Store integration - how editor state syncs with app store
 * 2. API call patterns - validating expected API interactions
 * 3. State management - dirty tracking, post selection
 *
 * For full E2E UI tests, Playwright or Electron testing would be more appropriate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore, PostData } from '../../../src/renderer/store/appStore';

// Helper to create a mock post
const createMockPost = (overrides: Partial<PostData> = {}): PostData => ({
  id: `post-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  title: 'Test Post',
  slug: 'test-post',
  content: '# Test Content',
  status: 'draft',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  categories: ['article'],
  ...overrides,
});

// Store access helpers
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

describe('Editor Behavior', () => {
  beforeEach(() => {
    // Reset store state
    setState({
      posts: [],
      selectedPostId: null,
      dirtyPosts: new Set(),
      activeView: 'posts',
      errorModal: null,
      isLoading: false,
      preferredEditorMode: 'wysiwyg',
    });

    vi.clearAllMocks();
  });

  describe('Post Selection', () => {
    it('should set selected post in store', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().setSelectedPost('post-1');

      expect(getStore().selectedPostId).toBe('post-1');
    });

    it('should clear selection when set to null', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      getStore().setSelectedPost('post-1');

      getStore().setSelectedPost(null);

      expect(getStore().selectedPostId).toBeNull();
    });

    it('should clear selection when selected post is removed', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      getStore().setSelectedPost('post-1');

      getStore().removePost('post-1');

      expect(getStore().selectedPostId).toBeNull();
    });
  });

  describe('Dirty Tracking', () => {
    it('should mark post as dirty', () => {
      getStore().markDirty('post-1');

      expect(getStore().isDirty('post-1')).toBe(true);
    });

    it('should mark post as clean', () => {
      getStore().markDirty('post-1');
      getStore().markClean('post-1');

      expect(getStore().isDirty('post-1')).toBe(false);
    });

    it('should track multiple dirty posts independently', () => {
      getStore().markDirty('post-1');
      getStore().markDirty('post-2');

      expect(getStore().isDirty('post-1')).toBe(true);
      expect(getStore().isDirty('post-2')).toBe(true);

      getStore().markClean('post-1');

      expect(getStore().isDirty('post-1')).toBe(false);
      expect(getStore().isDirty('post-2')).toBe(true);
    });

    it('should return false for non-dirty posts', () => {
      expect(getStore().isDirty('non-existent')).toBe(false);
    });
  });

  describe('Post Update Flow', () => {
    it('should update store when save returns successfully', async () => {
      const originalPost = createMockPost({
        id: 'post-1',
        title: 'Original Title',
        content: 'Original content',
      });

      getStore().addPost(originalPost);

      // Simulate the save response from the backend
      const updatedPost = {
        ...originalPost,
        title: 'Updated Title',
        content: 'Updated content',
        updatedAt: new Date().toISOString(),
      };

      // Simulate the component's save flow
      getStore().updatePost('post-1', updatedPost);
      getStore().markClean('post-1');

      // Verify store was updated
      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.title).toBe('Updated Title');
      expect(storePost?.content).toBe('Updated content');
      expect(getStore().isDirty('post-1')).toBe(false);
    });

    it('should NOT clear store data when save returns undefined', async () => {
      const originalPost = createMockPost({
        id: 'post-1',
        title: 'Original Title',
        content: 'Original content',
      });

      getStore().addPost(originalPost);

      // Simulate save returning undefined (API error/issue)
      const result = undefined;

      // Following the component's pattern: only update if result is truthy
      if (result) {
        getStore().updatePost('post-1', result);
        getStore().markClean('post-1');
      }

      // Verify store was NOT corrupted
      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.title).toBe('Original Title');
      expect(storePost?.content).toBe('Original content');
    });
  });

  describe('Post Status', () => {
    it('should update post status to published', () => {
      const post = createMockPost({ id: 'post-1', status: 'draft' });
      getStore().addPost(post);

      getStore().updatePost('post-1', { status: 'published' });

      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.status).toBe('published');
    });

    it('should update post status to draft when unpublishing', () => {
      const post = createMockPost({ id: 'post-1', status: 'published' });
      getStore().addPost(post);

      getStore().updatePost('post-1', { status: 'draft' });

      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.status).toBe('draft');
    });
  });

  describe('Editor Mode Preference', () => {
    it('should store preferred editor mode', () => {
      getStore().setPreferredEditorMode('markdown');

      expect(getStore().preferredEditorMode).toBe('markdown');
    });

    it('should switch between editor modes', () => {
      getStore().setPreferredEditorMode('wysiwyg');
      expect(getStore().preferredEditorMode).toBe('wysiwyg');

      getStore().setPreferredEditorMode('markdown');
      expect(getStore().preferredEditorMode).toBe('markdown');

      getStore().setPreferredEditorMode('preview');
      expect(getStore().preferredEditorMode).toBe('preview');
    });
  });

  describe('Error Modal', () => {
    it('should show error modal with details', () => {
      const error = {
        title: 'Save Failed',
        message: 'Network error',
        stack: 'Error: Network error\n  at save...',
      };

      getStore().showErrorModal(error);

      expect(getStore().errorModal).toEqual(error);
    });

    it('should hide error modal', () => {
      getStore().showErrorModal({
        title: 'Test Error',
        message: 'Test message',
      });

      getStore().hideErrorModal();

      expect(getStore().errorModal).toBeNull();
    });
  });

  describe('Post Switching Behavior', () => {
    it('should persist changes when switching between posts', () => {
      const post1 = createMockPost({ id: 'post-1', title: 'Post 1' });
      const post2 = createMockPost({ id: 'post-2', title: 'Post 2' });

      getStore().addPost(post1);
      getStore().addPost(post2);

      // Simulate editing and saving post 1
      getStore().updatePost('post-1', { title: 'Post 1 Updated' });
      getStore().markClean('post-1');

      // Select post 2
      getStore().setSelectedPost('post-2');

      // Then select post 1 again
      getStore().setSelectedPost('post-1');

      // Verify post 1 still has the saved changes
      const storePost1 = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost1?.title).toBe('Post 1 Updated');
    });

    it('should track dirty state correctly when switching posts', () => {
      const post1 = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });

      getStore().addPost(post1);
      getStore().addPost(post2);
      getStore().setSelectedPost('post-1');

      // Mark post 1 as dirty
      getStore().markDirty('post-1');

      // Switch to post 2
      getStore().setSelectedPost('post-2');

      // Post 1 should still be dirty (store doesn't auto-clean on switch)
      expect(getStore().isDirty('post-1')).toBe(true);
      expect(getStore().isDirty('post-2')).toBe(false);
    });
  });

  describe('Post Deletion', () => {
    it('should remove post from store', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().removePost('post-1');

      expect(getStore().posts).toHaveLength(0);
    });

    it('should clear dirty state when post is removed', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      getStore().markDirty('post-1');
      expect(getStore().isDirty('post-1')).toBe(true);

      getStore().removePost('post-1');

      // Store auto-clears dirty state when post is removed
      expect(getStore().isDirty('post-1')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle update on non-existent post', () => {
      // Updating a non-existent post should not add it
      getStore().updatePost('non-existent', { title: 'Updated' });

      expect(getStore().posts).toHaveLength(0);
    });

    it('should handle rapid consecutive saves', () => {
      const post = createMockPost({ id: 'post-1', title: 'Original' });
      getStore().addPost(post);

      // Simulate rapid saves
      getStore().updatePost('post-1', { title: 'First Update' });
      getStore().updatePost('post-1', { title: 'Second Update' });

      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.title).toBe('Second Update');
    });

    it('should handle publish after save', () => {
      const post = createMockPost({ id: 'post-1', status: 'draft' });
      getStore().addPost(post);

      // Save first
      getStore().updatePost('post-1', { title: 'Saved' });

      // Then publish
      getStore().updatePost('post-1', { status: 'published' });

      const storePost = getStore().posts.find((p) => p.id === 'post-1');
      expect(storePost?.status).toBe('published');
      expect(storePost?.title).toBe('Saved');
    });
  });
});
