/**
 * Tests for tab management in the app store
 * Validates tabbed interface behavior: transient tabs, pinned tabs, persistence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, PostData, MediaData, Tab } from '../../../src/renderer/store/appStore';

// Helper to create a mock post
const createMockPost = (overrides: Partial<PostData> = {}): PostData => ({
  id: `post-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  projectId: 'project-1',
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

// Helper to create a mock media
const createMockMedia = (overrides: Partial<MediaData> = {}): MediaData => ({
  id: `media-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  projectId: 'project-1',
  filename: 'test.jpg',
  originalName: 'test.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  ...overrides,
});

// Direct store access without React rendering
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

describe('Tab Management', () => {
  beforeEach(() => {
    // Reset store state before each test
    setState({
      tabs: [],
      activeTabId: null,
      posts: [],
      media: [],
      dirtyPosts: new Set(),
    });
  });

  describe('Opening Tabs', () => {
    it('should open a post in a transient tab on single click', () => {
      const post = createMockPost({ id: 'post-1', title: 'Test Post' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].type).toBe('post');
      expect(getStore().tabs[0].id).toBe('post-1');
      expect(getStore().tabs[0].isTransient).toBe(true);
      expect(getStore().activeTabId).toBe('post-1');
    });

    it('should open a media file in a transient tab on single click', () => {
      const media = createMockMedia({ id: 'media-1' });
      getStore().addMedia(media);

      getStore().openTab({ type: 'media', id: 'media-1', isTransient: true });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].type).toBe('media');
      expect(getStore().tabs[0].id).toBe('media-1');
      expect(getStore().tabs[0].isTransient).toBe(true);
      expect(getStore().activeTabId).toBe('media-1');
    });

    it('should replace transient tab when opening another item with single click', () => {
      const post1 = createMockPost({ id: 'post-1', title: 'Post 1' });
      const post2 = createMockPost({ id: 'post-2', title: 'Post 2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: true });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].id).toBe('post-2');
      expect(getStore().activeTabId).toBe('post-2');
    });

    it('should not replace pinned tabs when opening with single click', () => {
      const post1 = createMockPost({ id: 'post-1', title: 'Post 1' });
      const post2 = createMockPost({ id: 'post-2', title: 'Post 2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      // Double click opens pinned tab
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      // Single click opens transient tab
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: true });

      expect(getStore().tabs).toHaveLength(2);
      expect(getStore().tabs[0].id).toBe('post-1');
      expect(getStore().tabs[0].isTransient).toBe(false);
      expect(getStore().tabs[1].id).toBe('post-2');
      expect(getStore().tabs[1].isTransient).toBe(true);
    });

    it('should open a pinned tab on double click', () => {
      const post = createMockPost({ id: 'post-1', title: 'Test Post' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].isTransient).toBe(false);
    });

    it('should convert transient tab to pinned on double click', () => {
      const post = createMockPost({ id: 'post-1', title: 'Test Post' });
      getStore().addPost(post);

      // First single click - transient
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });
      expect(getStore().tabs[0].isTransient).toBe(true);

      // Double click - convert to pinned
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].isTransient).toBe(false);
    });

    it('should switch to existing tab if already open', () => {
      const post = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });
      getStore().addPost(post);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });

      expect(getStore().tabs).toHaveLength(2);
      expect(getStore().activeTabId).toBe('post-1');
    });

    it('should open git diff in a transient tab on single click', () => {
      getStore().openTab({ type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: true });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0]).toMatchObject({
        type: 'git-diff',
        id: 'git-diff:posts/first.md',
        isTransient: true,
      });
    });

    it('should reuse transient git diff tab on subsequent single click', () => {
      getStore().openTab({ type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: true });
      getStore().openTab({ type: 'git-diff', id: 'git-diff:posts/second.md', isTransient: true });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0]).toMatchObject({
        type: 'git-diff',
        id: 'git-diff:posts/second.md',
        isTransient: true,
      });
    });

    it('should open git diff in a persistent tab on double click', () => {
      getStore().openTab({ type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: false });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0]).toMatchObject({
        type: 'git-diff',
        id: 'git-diff:posts/first.md',
        isTransient: false,
      });
    });
  });

  describe('Closing Tabs', () => {
    it('should close a tab by id', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().closeTab('post-1');

      expect(getStore().tabs).toHaveLength(0);
      expect(getStore().activeTabId).toBeNull();
    });

    it('should activate the next tab when closing the active tab', () => {
      const post1 = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: false });
      getStore().setActiveTab('post-1');
      getStore().closeTab('post-1');

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().activeTabId).toBe('post-2');
    });

    it('should activate the previous tab when closing the last tab', () => {
      const post1 = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: false });
      getStore().closeTab('post-2');

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().activeTabId).toBe('post-1');
    });

    it('should not remove dirty posts from dirtyPosts when closing tab', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      getStore().markDirty('post-1');

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().closeTab('post-1');

      // Dirty state is preserved - the post still has unsaved changes
      expect(getStore().isDirty('post-1')).toBe(true);
    });
  });

  describe('Tab Switching', () => {
    it('should set active tab', () => {
      const post1 = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: false });
      getStore().setActiveTab('post-1');

      expect(getStore().activeTabId).toBe('post-1');
    });

    it('should not change active tab when switching to non-existent tab', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().setActiveTab('non-existent');

      expect(getStore().activeTabId).toBe('post-1');
    });
  });

  describe('Pin Tab', () => {
    it('should pin a transient tab', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });
      getStore().pinTab('post-1');

      expect(getStore().tabs[0].isTransient).toBe(false);
    });

    it('should convert transient tab to pinned when editing starts', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });
      getStore().markDirty('post-1');
      getStore().pinTab('post-1');

      expect(getStore().tabs[0].isTransient).toBe(false);
    });
  });

  describe('Tab Persistence', () => {
    it('should return tabs state for project persistence', () => {
      const post1 = createMockPost({ id: 'post-1' });
      const post2 = createMockPost({ id: 'post-2' });
      getStore().addPost(post1);
      getStore().addPost(post2);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'post', id: 'post-2', isTransient: false });

      const tabState = getStore().getTabState();

      expect(tabState.tabs).toHaveLength(2);
      expect(tabState.activeTabId).toBe('post-2');
    });

    it('should restore tabs from persisted state', () => {
      const tabState = {
        tabs: [
          { type: 'post' as const, id: 'post-1', isTransient: false },
          { type: 'media' as const, id: 'media-1', isTransient: false },
        ],
        activeTabId: 'media-1',
      };

      getStore().restoreTabState(tabState);

      expect(getStore().tabs).toHaveLength(2);
      expect(getStore().activeTabId).toBe('media-1');
    });

    it('should clear tabs when switching projects', () => {
      const post = createMockPost({ id: 'post-1' });
      getStore().addPost(post);
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });

      getStore().clearTabs();

      expect(getStore().tabs).toHaveLength(0);
      expect(getStore().activeTabId).toBeNull();
    });
  });

  describe('Settings Tab', () => {
    it('should open settings as a special tab', () => {
      getStore().openTab({ type: 'settings', id: 'settings', isTransient: false });

      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].type).toBe('settings');
      expect(getStore().activeTabId).toBe('settings');
    });

    it('should not allow multiple settings tabs', () => {
      getStore().openTab({ type: 'settings', id: 'settings', isTransient: false });
      getStore().openTab({ type: 'settings', id: 'settings', isTransient: false });

      expect(getStore().tabs).toHaveLength(1);
    });
  });

  describe('Multiple Tab Types', () => {
    it('should handle mixed posts and media tabs', () => {
      const post = createMockPost({ id: 'post-1' });
      const media = createMockMedia({ id: 'media-1' });
      getStore().addPost(post);
      getStore().addMedia(media);

      getStore().openTab({ type: 'post', id: 'post-1', isTransient: false });
      getStore().openTab({ type: 'media', id: 'media-1', isTransient: false });

      expect(getStore().tabs).toHaveLength(2);
      expect(getStore().tabs[0].type).toBe('post');
      expect(getStore().tabs[1].type).toBe('media');
    });

    it('should keep transient tabs separate by type', () => {
      const post = createMockPost({ id: 'post-1' });
      const media = createMockMedia({ id: 'media-1' });
      getStore().addPost(post);
      getStore().addMedia(media);

      // Open transient post tab
      getStore().openTab({ type: 'post', id: 'post-1', isTransient: true });
      // Open transient media tab - should NOT replace the post tab
      getStore().openTab({ type: 'media', id: 'media-1', isTransient: true });

      // Both transient tabs should exist since they're different types
      expect(getStore().tabs).toHaveLength(2);
    });
  });
});
