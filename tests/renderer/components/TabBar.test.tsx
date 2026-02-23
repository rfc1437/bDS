import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TabBar } from '../../../src/renderer/components/TabBar/TabBar';
import { useAppStore } from '../../../src/renderer/store';

describe('TabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();

    if (!(globalThis as any).ResizeObserver) {
      (globalThis as any).ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    }

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        dataPath: '/repo/path',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tabs: [
        { type: 'git-diff', id: 'git-diff:commit:abc123def456', isTransient: false },
      ],
      activeTabId: 'git-diff:commit:abc123def456',
      media: [],
      dirtyPosts: new Set<string>(),
      sidebarVisible: true,
    });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      git: {
        ...(window as any).electronAPI?.git,
        getHistory: vi.fn().mockResolvedValue([
          {
            hash: 'abc123def456',
            shortHash: 'abc123d',
            date: '2026-02-16T10:00:00.000Z',
            subject: 'feat: improve commit diff tabs',
            author: 'Dev One',
          },
        ]),
      },
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      posts: {
        ...(window as any).electronAPI?.posts,
        get: vi.fn(),
      },
      chat: {
        ...(window as any).electronAPI?.chat,
        getConversation: vi.fn(),
        onTitleUpdated: vi.fn(() => () => {}),
      },
      importDefinitions: {
        ...(window as any).electronAPI?.importDefinitions,
        get: vi.fn(),
        onNameUpdated: vi.fn(() => () => {}),
      },
      scripts: {
        ...(window as any).electronAPI?.scripts,
        get: vi.fn(),
      },
    };
  });

  it('renders commit subject in git-diff commit tab titles when available', async () => {
    render(<TabBar />);

    expect(await screen.findByText('abc123d feat: improve commit diff tabs')).toBeInTheDocument();
    expect((window as any).electronAPI.git.getHistory).toHaveBeenCalledWith('/repo/path', 200);
  });

  it('does not render the tab bar when there are no open tabs', () => {
    useAppStore.setState({ tabs: [], activeTabId: null });

    const { container } = render(<TabBar />);

    expect(container.querySelector('.tab-bar')).toBeNull();
  });

  it('renders style tab label', async () => {
    useAppStore.setState({
      tabs: [{ type: 'style', id: 'style', isTransient: false }],
      activeTabId: 'style',
    });

    render(<TabBar />);

    expect(await screen.findByText('Style')).toBeInTheDocument();
  });

  it('updates post tab title when post title changes in store', async () => {
    useAppStore.setState({
      tabs: [{ type: 'post', id: 'post-1', isTransient: false }],
      activeTabId: 'post-1',
      posts: [{
        id: 'post-1',
        title: '',
        slug: 'post-1',
        content: '',
        excerpt: null,
        author: null,
        status: 'draft',
        publishedAt: null,
        scheduledAt: null,
        tags: [],
        categories: [],
        metadata: {},
        projectId: 'project-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    });

    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue({
      id: 'post-1',
      title: '',
    });

    render(<TabBar />);

    expect(await screen.findByText('Untitled')).toBeInTheDocument();

    act(() => {
      useAppStore.getState().updatePost('post-1', { title: 'Updated Title' });
    });

    expect(await screen.findByText('Updated Title')).toBeInTheDocument();
  });

  it('renders script title for script tab', async () => {
    useAppStore.setState({
      tabs: [{ type: 'scripts', id: 'script-1', isTransient: false }],
      activeTabId: 'script-1',
      posts: [],
      media: [],
      dirtyPosts: new Set<string>(),
    });

    (window as any).electronAPI.scripts.get = vi.fn().mockResolvedValue({
      id: 'script-1',
      title: 'Publish Macro',
    });

    render(<TabBar />);

    expect(await screen.findByText('Publish Macro')).toBeInTheDocument();
    expect((window as any).electronAPI.scripts.get).toHaveBeenCalledWith('script-1');
  });
});
