/**
 * Tests for PostEditor behavior
 * Validates saving, dirty tracking, and post switching scenarios
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
  categories: [],
  ...overrides,
});

// Direct store access
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

// Mock window.electronAPI 
const mockElectronAPI = {
  posts: {
    update: vi.fn(),
    publish: vi.fn(),
    create: vi.fn(),
  },
};

describe('PostEditor Behavior', () => {
  beforeEach(() => {
    // Reset store state
    setState({
      posts: [],
      selectedPostId: null,
      dirtyPosts: new Set(),
    });
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Set up window.electronAPI mock
    (globalThis as any).window = {
      electronAPI: mockElectronAPI,
    };
  });

  describe('Post Editing Flow', () => {
    it('should update store when save returns successfully', async () => {
      const originalPost = createMockPost({ 
        id: 'post-1', 
        title: 'Original Title',
        content: 'Original content',
      });
      
      // Add post to store
      getStore().addPost(originalPost);
      
      // Simulate the save response from the backend
      const updatedPost = {
        ...originalPost,
        title: 'Updated Title',
        content: 'Updated content',
        updatedAt: new Date().toISOString(),
      };
      mockElectronAPI.posts.update.mockResolvedValue(updatedPost);
      
      // Simulate the component's save flow
      const result = await mockElectronAPI.posts.update('post-1', {
        title: 'Updated Title',
        content: 'Updated content',
      });
      
      if (result) {
        getStore().updatePost('post-1', result);
        getStore().markClean('post-1');
      }
      
      // Verify store was updated
      const storePost = getStore().posts.find(p => p.id === 'post-1');
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
      
      // Add post to store
      getStore().addPost(originalPost);
      
      // Simulate save returning undefined (API error/issue)
      mockElectronAPI.posts.update.mockResolvedValue(undefined);
      
      // Simulate the component's save flow
      const result = await mockElectronAPI.posts.update('post-1', {
        title: 'Updated Title',
        content: 'Updated content',
      });
      
      // Following the component's pattern: only update if result is truthy
      if (result) {
        getStore().updatePost('post-1', result);
        getStore().markClean('post-1');
      }
      
      // Verify store was NOT corrupted
      const storePost = getStore().posts.find(p => p.id === 'post-1');
      expect(storePost?.title).toBe('Original Title');
      expect(storePost?.content).toBe('Original content');
    });

    it('should persist changes when switching between posts', async () => {
      const post1 = createMockPost({ id: 'post-1', title: 'Post 1' });
      const post2 = createMockPost({ id: 'post-2', title: 'Post 2' });
      
      // Add posts to store
      getStore().addPost(post1);
      getStore().addPost(post2);
      
      // Simulate editing and saving post 1
      const updatedPost1 = { ...post1, title: 'Post 1 Updated' };
      mockElectronAPI.posts.update.mockResolvedValue(updatedPost1);
      
      const result = await mockElectronAPI.posts.update('post-1', { title: 'Post 1 Updated' });
      if (result) {
        getStore().updatePost('post-1', result);
        getStore().markClean('post-1');
      }
      
      // Select post 2
      getStore().setSelectedPost('post-2');
      
      // Then select post 1 again
      getStore().setSelectedPost('post-1');
      
      // Verify post 1 still has the saved changes
      const storePost1 = getStore().posts.find(p => p.id === 'post-1');
      expect(storePost1?.title).toBe('Post 1 Updated');
    });

    it('should warn or auto-save when switching posts with unsaved changes', () => {
      const post1 = createMockPost({ id: 'post-1', title: 'Post 1' });
      const post2 = createMockPost({ id: 'post-2', title: 'Post 2' });
      
      getStore().addPost(post1);
      getStore().addPost(post2);
      getStore().setSelectedPost('post-1');
      
      // Simulate user editing post 1 (markDirty is called by the component)
      getStore().markDirty('post-1');
      
      // ISSUE: When switching to post 2, post 1's local edits are lost
      // because they're only in React useState, not persisted anywhere
      // The store knows it's dirty, but the actual content changes are gone
      expect(getStore().isDirty('post-1')).toBe(true);
      
      // Switch to post 2 without saving
      getStore().setSelectedPost('post-2');
      
      // Post 1 is STILL marked dirty (store doesn't auto-clean on switch)
      // But this is misleading - the actual edits are lost!
      expect(getStore().isDirty('post-1')).toBe(true);
      
      // This test documents the current (buggy) behavior:
      // - markDirty tracks that changes exist
      // - But the actual changes (in React useState) are lost when switching
      // 
      // FIX NEEDED: Either auto-save, confirm before switching, or store edits
    });

    it('should track dirty state correctly when content changes', () => {
      const post = createMockPost({ id: 'post-1', title: 'Original' });
      getStore().addPost(post);
      
      // Fresh post should not be dirty
      expect(getStore().isDirty('post-1')).toBe(false);
      
      // Simulating content change
      getStore().markDirty('post-1');
      expect(getStore().isDirty('post-1')).toBe(true);
      
      // After save
      getStore().markClean('post-1');
      expect(getStore().isDirty('post-1')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle save when post no longer exists in store', async () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      
      // Remove post from store (simulating deletion from another source)
      getStore().removePost('post-1');
      
      // Attempt to update
      getStore().updatePost('post-1', { title: 'Updated' });
      
      // Should not add the post back
      expect(getStore().posts).toHaveLength(0);
    });

    it('should handle rapid consecutive saves', async () => {
      const post = createMockPost({ id: 'post-1', title: 'Original' });
      getStore().addPost(post);
      
      // First save
      mockElectronAPI.posts.update.mockResolvedValueOnce({ ...post, title: 'First Update' });
      const result1 = await mockElectronAPI.posts.update('post-1', { title: 'First Update' });
      if (result1) getStore().updatePost('post-1', result1);
      
      // Second save (rapid)
      mockElectronAPI.posts.update.mockResolvedValueOnce({ ...post, title: 'Second Update' });
      const result2 = await mockElectronAPI.posts.update('post-1', { title: 'Second Update' });
      if (result2) getStore().updatePost('post-1', result2);
      
      // Should have the last update
      const storePost = getStore().posts.find(p => p.id === 'post-1');
      expect(storePost?.title).toBe('Second Update');
    });

    it('should handle publish after save', async () => {
      const post = createMockPost({ id: 'post-1', status: 'draft' });
      getStore().addPost(post);
      
      // Save first
      mockElectronAPI.posts.update.mockResolvedValue({ ...post, title: 'Saved' });
      const saveResult = await mockElectronAPI.posts.update('post-1', { title: 'Saved' });
      if (saveResult) getStore().updatePost('post-1', saveResult);
      
      // Then publish
      mockElectronAPI.posts.publish.mockResolvedValue({ ...post, title: 'Saved', status: 'published' });
      const publishResult = await mockElectronAPI.posts.publish('post-1');
      if (publishResult) getStore().updatePost('post-1', publishResult);
      
      const storePost = getStore().posts.find(p => p.id === 'post-1');
      expect(storePost?.status).toBe('published');
      expect(storePost?.title).toBe('Saved');
    });
  });
});
