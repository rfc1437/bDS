import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GitSidebar } from '../../../src/renderer/components/GitSidebar/GitSidebar';
import { useAppStore } from '../../../src/renderer/store';

const getStore = () => useAppStore.getState();

describe('GitSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tabs: [],
      activeTabId: null,
    });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      git: {
        checkAvailability: vi.fn().mockResolvedValue({ gitFound: true, version: '2.49.0' }),
        getRepoState: vi.fn().mockResolvedValue({ isRepo: false, hasRemote: false }),
        getStatus: vi.fn().mockResolvedValue({ files: [], counts: { untracked: 0, modified: 0, deleted: 0, renamed: 0, staged: 0, total: 0 } }),
        getDiff: vi.fn().mockResolvedValue({ filePath: 'posts/a.md', patch: 'diff --git a/posts/a.md b/posts/a.md' }),
        getHistory: vi.fn().mockResolvedValue([]),
        init: vi.fn().mockResolvedValue({ success: true }),
        ensureGitignore: vi.fn().mockResolvedValue({ updated: false, created: false, addedEntries: [] }),
        onInitProgress: vi.fn().mockImplementation(() => () => {}),
      },
    };
  });

  it('does not modify gitignore when sidebar loads', async () => {
    render(<GitSidebar />);

    await screen.findByRole('button', { name: /initialize git/i });

    expect((window as any).electronAPI.git.ensureGitignore).not.toHaveBeenCalled();
  });

  it('shows Initialize Git button when active project is not a git repository', async () => {
    render(<GitSidebar />);

    expect(await screen.findByRole('button', { name: /initialize git/i })).toBeInTheDocument();
  });

  it('renders open changes list when repository exists', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getStatus = vi.fn().mockResolvedValue({
      files: [
        { path: 'posts/first.md', status: 'modified' },
        { path: 'posts/second.md', status: 'untracked' },
      ],
      counts: { untracked: 1, modified: 1, deleted: 0, renamed: 0, staged: 0, total: 2 },
    });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([
      {
        hash: 'abc123',
        shortHash: 'abc123',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: add git sidebar',
        author: 'Dev One',
      },
    ]);

    render(<GitSidebar />);

    expect(await screen.findByText(/open changes/i)).toBeInTheDocument();
    expect(screen.getByText('posts/first.md')).toBeInTheDocument();
    expect(screen.getByText('posts/second.md')).toBeInTheDocument();
    expect(screen.getByText(/version history/i)).toBeInTheDocument();
    expect(screen.getByText(/feat: add git sidebar/i)).toBeInTheDocument();
    expect(screen.getByText(/abc123/i)).toBeInTheDocument();
  });

  it('uses the same section-title class as posts published heading', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });

    render(<GitSidebar />);

    const openChangesHeader = await screen.findByText(/open changes/i);
    const historyHeader = screen.getByText(/version history/i);

    expect(openChangesHeader).toHaveClass('sidebar-section-title');
    expect(historyHeader).toHaveClass('sidebar-section-title');
  });

  it('single click opens and reuses a transient git-diff tab', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getStatus = vi.fn().mockResolvedValue({
      files: [
        { path: 'posts/first.md', status: 'modified' },
        { path: 'posts/second.md', status: 'untracked' },
      ],
      counts: { untracked: 1, modified: 1, deleted: 0, renamed: 0, staged: 0, total: 2 },
    });

    render(<GitSidebar />);

    const first = await screen.findByRole('button', { name: /posts\/first\.md/i });
    const second = screen.getByRole('button', { name: /posts\/second\.md/i });

    await act(async () => {
      fireEvent.click(first);
    });

    expect(getStore().tabs).toHaveLength(1);
    expect(getStore().tabs[0]).toMatchObject({ type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: true });

    await act(async () => {
      fireEvent.click(second);
    });

    expect(getStore().tabs).toHaveLength(1);
    expect(getStore().tabs[0]).toMatchObject({ type: 'git-diff', id: 'git-diff:posts/second.md', isTransient: true });
  });

  it('double click opens a persistent git-diff tab', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getStatus = vi.fn().mockResolvedValue({
      files: [{ path: 'posts/first.md', status: 'modified' }],
      counts: { untracked: 0, modified: 1, deleted: 0, renamed: 0, staged: 0, total: 1 },
    });

    render(<GitSidebar />);

    const first = await screen.findByRole('button', { name: /posts\/first\.md/i });

    await act(async () => {
      fireEvent.doubleClick(first);
    });

    expect(getStore().tabs).toHaveLength(1);
    expect(getStore().tabs[0]).toMatchObject({ type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: false });
  });

  it('initializes repository and refreshes repo state after clicking Initialize Git', async () => {
    const getRepoStateMock = vi
      .fn()
      .mockResolvedValueOnce({ isRepo: false, hasRemote: false })
      .mockResolvedValueOnce({ isRepo: true, rootPath: '/repo/path', currentBranch: 'main', hasRemote: true });

    (window as any).electronAPI.git.getRepoState = getRepoStateMock;
    (window as any).electronAPI.git.init = vi.fn().mockResolvedValue({ success: true });

    render(<GitSidebar />);

    const initButton = await screen.findByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.init).toHaveBeenCalledWith('/repo/path');
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/open changes/i)).toBeInTheDocument();
    });
  });

  it('passes remote url to init when user provides one', async () => {
    (window as any).electronAPI.git.init = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI.git.getRepoState = vi
      .fn()
      .mockResolvedValueOnce({ isRepo: false, hasRemote: false })
      .mockResolvedValueOnce({ isRepo: true, rootPath: '/repo/path', currentBranch: 'main', hasRemote: true });

    render(<GitSidebar />);

    const remoteInput = await screen.findByPlaceholderText(/optional remote repository url/i);
    await act(async () => {
      fireEvent.change(remoteInput, { target: { value: 'https://github.com/example/repo.git' } });
    });

    expect((remoteInput as HTMLInputElement).value).toBe('https://github.com/example/repo.git');

    const initButton = screen.getByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.init).toHaveBeenCalledWith('/repo/path', 'https://github.com/example/repo.git');
    });
  });

  it('shows detailed progress feedback while initialization is running', async () => {
    let resolveInit: ((value: { success: boolean }) => void) | null = null;
    (window as any).electronAPI.git.init = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        }),
    );

    render(<GitSidebar />);

    const initButton = await screen.findByRole('button', { name: /initialize git/i });

    await act(async () => {
      fireEvent.click(initButton);
    });

    expect(screen.getByText(/preparing repository initialization/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /initializing/i })).toBeDisabled();

    await act(async () => {
      resolveInit?.({ success: true });
    });
  });

  it('updates progress detail text from init progress events', async () => {
    let resolveInit: ((value: { success: boolean }) => void) | null = null;
    (window as any).electronAPI.git.init = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        }),
    );

    render(<GitSidebar />);

    const onInitProgressMock = (window as any).electronAPI.git.onInitProgress as ReturnType<typeof vi.fn>;
    const subscription = onInitProgressMock.mock.calls[0][0] as (payload: { message: string }) => void;

    const initButton = await screen.findByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await act(async () => {
      subscription({ message: 'Staging project files...', progress: 75 });
    });

    expect(screen.getByText(/staging project files\.\.\.\s*\(75%\)/i)).toBeInTheDocument();

    await act(async () => {
      resolveInit?.({ success: true });
    });
  });

  it('renders a compact transcript of initialization steps', async () => {
    let resolveInit: ((value: { success: boolean }) => void) | null = null;
    (window as any).electronAPI.git.init = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        }),
    );

    render(<GitSidebar />);

    const onInitProgressMock = (window as any).electronAPI.git.onInitProgress as ReturnType<typeof vi.fn>;
    const subscription = onInitProgressMock.mock.calls[0][0] as (payload: { message: string; progress: number }) => void;

    const initButton = await screen.findByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await act(async () => {
      subscription({ message: 'Checking Git availability...', progress: 5 });
      subscription({ message: 'Initializing repository...', progress: 15 });
    });

    const transcriptToggle = screen.getByRole('button', { name: /initialization transcript/i });
    expect(transcriptToggle).toBeInTheDocument();
    expect(transcriptToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/5% — checking git availability/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(transcriptToggle);
    });

    expect(transcriptToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/5% — checking git availability/i)).toBeInTheDocument();
    expect(screen.getByText(/15% — initializing repository/i)).toBeInTheDocument();

    await act(async () => {
      resolveInit?.({ success: true });
    });
  });

  it('auto-expands transcript when a failed progress event is received', async () => {
    render(<GitSidebar />);

    const onInitProgressMock = (window as any).electronAPI.git.onInitProgress as ReturnType<typeof vi.fn>;
    const subscription = onInitProgressMock.mock.calls[0][0] as (payload: { phase: string; message: string; progress: number }) => void;

    await act(async () => {
      subscription({ phase: 'failed', message: 'Failed to configure remote repository.', progress: 100 });
    });

    const transcriptToggle = screen.getByRole('button', { name: /initialization transcript/i });
    expect(transcriptToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/100% — failed to configure remote repository/i)).toBeInTheDocument();
  });
});
