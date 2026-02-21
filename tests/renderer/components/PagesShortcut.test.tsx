import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ActivityBar } from '../../../src/renderer/components/ActivityBar/ActivityBar';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore, type PostData } from '../../../src/renderer/store';

const createMockPost = (overrides: Partial<PostData> = {}): PostData => ({
  id: `post-${Math.random().toString(36).slice(2)}`,
  projectId: 'project-1',
  title: 'Test Post',
  slug: 'test-post',
  content: 'content',
  status: 'published',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  categories: [],
  ...overrides,
});

describe('Pages shortcut UI', () => {
  beforeEach(() => {
    const now = new Date().toISOString();

    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
      posts: [
        createMockPost({
          id: 'post-page',
          title: 'About Page',
          categories: ['page'],
          updatedAt: now,
        }),
        createMockPost({
          id: 'post-article',
          title: 'Regular Article',
          categories: ['article'],
          updatedAt: now,
        }),
      ],
      hasMorePosts: false,
      totalPosts: 2,
    });

    window.electronAPI.posts.getTags = vi.fn().mockResolvedValue([]);
    window.electronAPI.posts.getCategories = vi.fn().mockResolvedValue(['page', 'article']);
    window.electronAPI.posts.getByYearMonth = vi.fn().mockResolvedValue([]);
    (window.electronAPI as any).tags = {
      getAll: vi.fn().mockResolvedValue([]),
    };
    window.electronAPI.posts.search = vi.fn().mockResolvedValue([]);
    window.electronAPI.posts.filter = vi.fn().mockResolvedValue([]);
    window.electronAPI.posts.get = vi.fn().mockResolvedValue(null);
  });

  it('shows a pages button in the activity bar', () => {
    render(<ActivityBar />);

    expect(screen.getByTitle('Pages (click again to toggle sidebar)')).toBeInTheDocument();
  });

  it('uses a distinct pages icon shape', () => {
    render(<ActivityBar />);

    const pagesButton = screen.getByTitle('Pages (click again to toggle sidebar)');
    const pagesSvg = pagesButton.querySelector('svg');

    expect(pagesSvg).not.toBeNull();
    expect(pagesSvg?.querySelector('path')?.getAttribute('d')).toBe(
      'M4 4h10v4h6v12H4V4zm10 1.5V9h4.5L14 5.5zM7 12h10v1.5H7V12zm0 3h10v1.5H7V15z'
    );
  });

  it('shows only page-category posts when pages view is active', async () => {
    useAppStore.setState({ activeView: 'pages', sidebarVisible: true });
    window.electronAPI.posts.filter = vi.fn().mockResolvedValue([
      createMockPost({ id: 'post-page', title: 'About Page', categories: ['page'] }),
    ]);

    render(<Sidebar />);

    const pagesHeader = await screen.findByText('PAGES');
    const pagesPanel = pagesHeader.closest('.sidebar-content');

    expect(pagesPanel).not.toBeNull();
    expect(within(pagesPanel as HTMLElement).getByText('About Page')).toBeInTheDocument();
    expect(within(pagesPanel as HTMLElement).queryByText('Regular Article')).not.toBeInTheDocument();
  });

  it('loads pages subset from full table and does not require load-more pagination', async () => {
    useAppStore.setState({
      activeView: 'pages',
      sidebarVisible: true,
      posts: [
        createMockPost({
          id: 'post-article-only',
          title: 'Loaded Article',
          categories: ['article'],
        }),
      ],
      hasMorePosts: true,
      totalPosts: 1200,
    });

    window.electronAPI.posts.filter = vi.fn().mockResolvedValue([
      createMockPost({ id: 'post-page-remote', title: 'Remote Page', categories: ['page'] }),
    ]);

    render(<Sidebar />);

    const pagesHeader = await screen.findByText('PAGES');
    const pagesPanel = pagesHeader.closest('.sidebar-content') as HTMLElement;

    expect(within(pagesPanel).getByText('Remote Page')).toBeInTheDocument();
    expect(within(pagesPanel).queryByText('Loaded Article')).not.toBeInTheDocument();
    expect(within(pagesPanel).queryByText(/Load more/i)).not.toBeInTheDocument();
    expect(window.electronAPI.posts.filter).toHaveBeenCalledWith({ categories: ['page'] });
  });

  it('does not prefetch pages subset while posts view is active', async () => {
    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      posts: [
        createMockPost({ id: 'post-1', title: 'Loaded Post', categories: ['article'] }),
      ],
      hasMorePosts: true,
      totalPosts: 1200,
    });

    window.electronAPI.posts.filter = vi.fn().mockResolvedValue([
      createMockPost({ id: 'post-page-remote', title: 'Remote Page', categories: ['page'] }),
    ]);

    render(<Sidebar />);

    expect(await screen.findByText('POSTS')).toBeInTheDocument();
    expect(window.electronAPI.posts.filter).not.toHaveBeenCalledWith({ categories: ['page'] });
  });

  it('conditionally mounts only the active posts/pages sidebar content', async () => {
    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      posts: [createMockPost({ id: 'post-1', title: 'Loaded Post', categories: ['article'] })],
    });

    const { container } = render(<Sidebar />);
    expect(await screen.findByText('POSTS')).toBeInTheDocument();

    const wrappers = container.querySelectorAll('.sidebar > div');
    expect(wrappers.length).toBe(1);
  });

  it('opens style tab from settings sidebar navigation', async () => {
    useAppStore.setState({
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
    useAppStore.getState().setActiveView('settings');

    render(<Sidebar />);

    const styleButton = await screen.findByRole('button', { name: /style/i });
    styleButton.click();

    const state = useAppStore.getState();
    expect(state.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'style', id: 'style' }),
      ])
    );
    expect(state.activeTabId).toBe('style');
  });
});