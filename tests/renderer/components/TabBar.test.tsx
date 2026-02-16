import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    };
  });

  it('renders commit subject in git-diff commit tab titles when available', async () => {
    render(<TabBar />);

    expect(await screen.findByText('abc123d feat: improve commit diff tabs')).toBeInTheDocument();
    expect((window as any).electronAPI.git.getHistory).toHaveBeenCalledWith('/repo/path', 200);
  });
});
