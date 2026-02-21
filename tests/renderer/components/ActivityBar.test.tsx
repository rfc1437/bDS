import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ActivityBar } from '../../../src/renderer/components/ActivityBar/ActivityBar';
import { I18nProvider } from '../../../src/renderer/i18n';
import { useAppStore } from '../../../src/renderer/store';

describe('ActivityBar tags behavior', () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      git: {
        ...(window as any).electronAPI?.git,
        getRepoState: vi.fn().mockResolvedValue({
          isRepo: true,
          rootPath: '/repo/path',
          currentBranch: 'main',
          hasRemote: true,
        }),
        fetch: vi.fn().mockResolvedValue({ success: true }),
        getRemoteState: vi.fn().mockResolvedValue({
          localBranch: 'main',
          upstreamBranch: 'origin/main',
          hasUpstream: true,
          ahead: 0,
          behind: 0,
        }),
      },
    };

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        dataPath: '/repo/path',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      activeView: 'posts',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches sidebar to tags view when clicking Tags', () => {
    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    const state = useAppStore.getState();
    expect(state.activeView).toBe('tags');
    expect(state.sidebarVisible).toBe(true);
    expect(state.activeTabId).toBeNull();
    expect(state.tabs).toEqual([]);
  });

  it('toggles tags sidebar off when tags view is already active', () => {
    useAppStore.setState({
      activeView: 'tags',
      sidebarVisible: true,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    expect(useAppStore.getState().sidebarVisible).toBe(false);
  });

  it('shows tags sidebar when hidden and tags view is active', () => {
    useAppStore.setState({
      activeView: 'tags',
      sidebarVisible: false,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('does not mark tags icon active when tags editor tab is open but another sidebar is active', () => {
    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    expect(screen.getByTitle('Tags (click again to toggle sidebar)')).not.toHaveClass('active');
  });

  it('uses the shared toggle hint in the tags activity button title', () => {
    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    expect(screen.getByTitle('Tags (click again to toggle sidebar)')).toBeInTheDocument();
  });

  it('shows a badge on the git activity icon when remote commits are available to pull', async () => {
    (window as any).electronAPI.git.getRemoteState = vi.fn().mockResolvedValue({
      localBranch: 'main',
      upstreamBranch: 'origin/main',
      hasUpstream: true,
      ahead: 0,
      behind: 4,
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    expect(await screen.findByText('4')).toHaveClass('activity-bar-badge');
  });

  it('polls remote git status on a regular interval', async () => {
    vi.useFakeTimers();

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.fetch).toHaveBeenCalledTimes(1);
      expect((window as any).electronAPI.git.getRemoteState).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.fetch).toHaveBeenCalledTimes(2);
      expect((window as any).electronAPI.git.getRemoteState).toHaveBeenCalledTimes(2);
    });
  });

  it('skips periodic git fetch polling while offline', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((window as any).electronAPI.git.fetch).toHaveBeenCalledTimes(0);
    expect((window as any).electronAPI.git.getRemoteState).toHaveBeenCalledTimes(0);
  });
});
