import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
      },
    };

    useAppStore.setState({
      panelVisible: true,
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
    useAppStore.setState({ panelVisible: false });
  });

  it('renders a Git Log tab label instead of Sync Log', () => {
    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Git Log' })).toBeInTheDocument();
    expect(screen.queryByText('Sync Log')).not.toBeInTheDocument();
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

  it('disables Git Log tab when focused tab is not a post or media editor', () => {
    useAppStore.setState({
      tabs: [{ type: 'settings', id: 'settings', isTransient: false }],
      activeTabId: 'settings',
    });

    render(<Panel />);

    expect(screen.getByRole('tab', { name: 'Git Log' })).toHaveAttribute('aria-disabled', 'true');
  });
});
