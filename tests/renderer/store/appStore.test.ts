/**
 * Tests for the app store
 * Validates state management behavior for posts, dirty tracking, and UI state
 */

import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { useAppStore, ProjectData, PostData, MediaData, TaskProgress } from '../../../src/renderer/store/appStore';
import type {
  ProjectData as SharedProjectData,
  PostData as SharedPostData,
  MediaData as SharedMediaData,
  TaskProgress as SharedTaskProgress,
} from '../../../src/main/shared/electronApi';

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

// Direct store access without React rendering
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

describe('AppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    setState({
      posts: [],
      selectedPostId: null,
      dirtyPosts: new Set(),
      assistantSidebarVisible: false,
    });
  });

  describe('Post Management', () => {
    it('should add a post to the store', () => {
      const post = createMockPost({ id: 'post-1', title: 'New Post' });

      getStore().addPost(post);

      expect(getStore().posts).toHaveLength(1);
      expect(getStore().posts[0].title).toBe('New Post');
    });

    it('should update an existing post in the store', () => {
      const post = createMockPost({ id: 'post-1', title: 'Original Title' });

      getStore().addPost(post);
      getStore().updatePost('post-1', { title: 'Updated Title' });

      expect(getStore().posts).toHaveLength(1);
      expect(getStore().posts[0].title).toBe('Updated Title');
    });

    it('should preserve other post fields when updating', () => {
      const post = createMockPost({ 
        id: 'post-1', 
        title: 'Original', 
        content: 'Original Content',
        tags: ['tag1'],
      });

      getStore().addPost(post);
      getStore().updatePost('post-1', { title: 'Updated Title' });

      expect(getStore().posts[0].content).toBe('Original Content');
      expect(getStore().posts[0].tags).toEqual(['tag1']);
    });

    it('should remove a post from the store', () => {
      const post = createMockPost({ id: 'post-1' });

      getStore().addPost(post);
      getStore().removePost('post-1');

      expect(getStore().posts).toHaveLength(0);
    });

    it('should clear selectedPostId when the selected post is removed', () => {
      const post = createMockPost({ id: 'post-1' });

      getStore().addPost(post);
      getStore().setSelectedPost('post-1');

      expect(getStore().selectedPostId).toBe('post-1');

      getStore().removePost('post-1');

      expect(getStore().selectedPostId).toBeNull();
    });
  });

  describe('Dirty Tracking', () => {
    it('should mark a post as dirty', () => {
      getStore().markDirty('post-1');

      expect(getStore().isDirty('post-1')).toBe(true);
    });

    it('should mark a post as clean', () => {
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
      expect(getStore().isDirty('non-existent-post')).toBe(false);
    });
  });

  describe('Post Selection', () => {
    it('should set selected post ID', () => {
      getStore().setSelectedPost('post-1');

      expect(getStore().selectedPostId).toBe('post-1');
    });

    it('should clear selected post ID when set to null', () => {
      getStore().setSelectedPost('post-1');
      getStore().setSelectedPost(null);

      expect(getStore().selectedPostId).toBeNull();
    });
  });

  describe('UI State', () => {
    it('should toggle sidebar visibility', () => {
      const initialState = getStore().sidebarVisible;

      getStore().toggleSidebar();

      expect(getStore().sidebarVisible).toBe(!initialState);
    });

    it('should set active view', () => {
      getStore().setActiveView('media');

      expect(getStore().activeView).toBe('media');
    });

    it('should set preferred editor mode', () => {
      getStore().setPreferredEditorMode('markdown');

      expect(getStore().preferredEditorMode).toBe('markdown');
    });

    it('should toggle assistant sidebar visibility', () => {
      expect(getStore().assistantSidebarVisible).toBe(false);

      getStore().toggleAssistantSidebar();
      expect(getStore().assistantSidebarVisible).toBe(true);

      getStore().toggleAssistantSidebar();
      expect(getStore().assistantSidebarVisible).toBe(false);
    });

    it('should set active panel tab', () => {
      getStore().setPanelActiveTab('output');

      expect(getStore().panelActiveTab).toBe('output');
    });

    it('should default git diff preferences to wrapped inline and visible unchanged regions', () => {
      expect(getStore().gitDiffPreferences).toEqual({
        wordWrap: true,
        viewStyle: 'inline',
        hideUnchangedRegions: false,
      });
    });

    it('should update git diff preferences', () => {
      getStore().setGitDiffPreferences({
        wordWrap: false,
        viewStyle: 'side-by-side',
        hideUnchangedRegions: true,
      });

      expect(getStore().gitDiffPreferences).toEqual({
        wordWrap: false,
        viewStyle: 'side-by-side',
        hideUnchangedRegions: true,
      });
    });
  });

  describe('Type Contract', () => {
    it('should keep store data types aligned with the shared Electron API contract', () => {
      expectTypeOf<ProjectData>().toEqualTypeOf<SharedProjectData>();
      expectTypeOf<PostData>().toEqualTypeOf<SharedPostData>();
      expectTypeOf<MediaData>().toEqualTypeOf<SharedMediaData>();
      expectTypeOf<TaskProgress>().toEqualTypeOf<SharedTaskProgress>();
    });
  });
});
