import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Panel } from '../../../src/renderer/components/Panel/Panel';
import { useAppStore } from '../../../src/renderer/store';
import type { PostData, MediaData } from '../../../src/main/shared/electronApi';

const createPost = (overrides: Partial<PostData> = {}): PostData => ({
  id: 'post-1',
  projectId: 'project-1',
  title: 'First Post',
  slug: 'first-post',
  content: 'Hello',
  status: 'draft',
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
  tags: [],
  categories: ['article'],
  ...overrides,
});

const createMedia = (overrides: Partial<MediaData> = {}): MediaData => ({
  id: 'media-1',
  projectId: 'project-1',
  filename: 'image-1.jpg',
  originalName: 'image-1.jpg',
  mimeType: 'image/jpeg',
  size: 123,
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
  tags: [],
  ...overrides,
});

describe('Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      git: {
        ...(window as any).electronAPI?.git,
        getFileHistory: vi.fn().mockResolvedValue([]),
      },
      media: {
        ...(window as any).electronAPI?.media,
        getFilePath: vi.fn().mockResolvedValue('/repo/path/media/2026/02/image-1.jpg'),
      },
      posts: {
        ...(window as any).electronAPI?.posts,
        get: vi.fn().mockResolvedValue(null),
        getLinksTo: vi.fn().mockResolvedValue([]),
        getLinkedBy: vi.fn().mockResolvedValue([]),
      },
    };

    useAppStore.setState({
      panelVisible: true,
      panelActiveTab: 'tasks',
      tasks: [],
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        dataPath: '/repo/path',
        createdAt: '2026-02-01T08:00:00.000Z',
        updatedAt: '2026-02-01T08:00:00.000Z',
      },
      posts: [createPost()],
      media: [createMedia()],
      tabs: [{ type: 'post', id: 'post-1', isTransient: false }],
      activeTabId: 'post-1',
    });
  });

  afterEach(() => {
    useAppStore.setState({ panelVisible: false, panelActiveTab: 'tasks' });
  });

  it('renders a Git Log tab label instead of Sync Log', () => {
    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Git Log' })).toBeInTheDocument();
    expect(screen.queryByText('Sync Log')).not.toBeInTheDocument();
  });

  it('shows Post Links tab when active editor is a post', () => {
    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Post Links' })).toBeInTheDocument();
  });

  it('hides Post Links tab when active editor is not a post', () => {
    useAppStore.setState({
      tabs: [{ type: 'media', id: 'media-1', isTransient: false }],
      activeTabId: 'media-1',
    });

    render(<Panel />);

    expect(screen.queryByRole('tab', { name: 'Post Links' })).not.toBeInTheDocument();
  });

  it('lists from/to post slugs for links related to active post', async () => {
    (window as any).electronAPI.posts.getLinkedBy = vi.fn().mockResolvedValue([
      createPost({ id: 'post-2', slug: 'source-post', title: 'Source Post' }),
    ]);
    (window as any).electronAPI.posts.getLinksTo = vi.fn().mockResolvedValue([
      createPost({ id: 'post-3', slug: 'target-post', title: 'Target Post' }),
    ]);

    render(<Panel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Post Links' }));

    await vi.waitFor(() => {
      expect((window as any).electronAPI.posts.getLinkedBy).toHaveBeenCalledWith('post-1');
      expect((window as any).electronAPI.posts.getLinksTo).toHaveBeenCalledWith('post-1');
    });

    expect(await screen.findByText('from source-post')).toBeInTheDocument();
    expect(screen.getByText('to target-post')).toBeInTheDocument();
  });

  it('opens related post tab when clicking a post link row', async () => {
    (window as any).electronAPI.posts.getLinkedBy = vi.fn().mockResolvedValue([
      createPost({ id: 'post-2', slug: 'source-post', title: 'Source Post' }),
    ]);
    (window as any).electronAPI.posts.getLinksTo = vi.fn().mockResolvedValue([]);

    render(<Panel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Post Links' }));

    const fromButton = await screen.findByRole('button', { name: 'from source-post' });
    fireEvent.click(fromButton);

    expect(useAppStore.getState().tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'post', id: 'post-2', isTransient: false }),
      ])
    );
    expect(useAppStore.getState().activeTabId).toBe('post-2');
  });

  it('loads git history for the focused item and updates when active editor changes', async () => {
    const getFileHistory = vi.fn()
      .mockResolvedValueOnce([
        {
          hash: 'abc123def456',
          shortHash: 'abc123d',
          date: '2026-02-16T10:00:00.000Z',
          subject: 'docs: update first post',
          author: 'Dev One',
        },
      ])
      .mockResolvedValueOnce([
        {
          hash: 'def456abc123',
          shortHash: 'def456a',
          date: '2026-02-17T09:00:00.000Z',
          subject: 'chore: replace media file',
          author: 'Dev Two',
        },
      ]);

    (window as any).electronAPI.git.getFileHistory = getFileHistory;

    render(<Panel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Git Log' }));

    await vi.waitFor(() => {
      expect(getFileHistory).toHaveBeenCalledWith('/repo/path', 'posts/2026/02/first-post.md', 50);
    });

    act(() => {
      useAppStore.setState({
        tabs: [{ type: 'media', id: 'media-1', isTransient: false }],
        activeTabId: 'media-1',
      });
    });

    await vi.waitFor(() => {
      expect(getFileHistory).toHaveBeenCalledWith('/repo/path', 'media/2026/02/image-1.jpg', 50);
    });
  });

  it('does not load git history when panel is closed', async () => {
    const getFileHistory = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.git.getFileHistory = getFileHistory;

    useAppStore.setState({ panelVisible: false, panelActiveTab: 'git-log' });

    render(<Panel />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getFileHistory).not.toHaveBeenCalled();
  });

  it('does not load git history when Git Log tab is not active', async () => {
    const getFileHistory = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.git.getFileHistory = getFileHistory;

    useAppStore.setState({ panelActiveTab: 'tasks' });

    render(<Panel />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getFileHistory).not.toHaveBeenCalled();
  });

  it('disables Git Log tab when focused tab is not a post or media editor', () => {
    useAppStore.setState({
      tabs: [{ type: 'settings', id: 'settings', isTransient: false }],
      activeTabId: 'settings',
    });

    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Git Log' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('restores the last selected panel tab after remounting the panel', () => {
    const firstRender = render(<Panel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
    expect(screen.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true');

    firstRender.unmount();

    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true');
  });
});
