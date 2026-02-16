import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
        getDiffContent: vi.fn().mockResolvedValue({ filePath: 'posts/a.md', original: '', modified: '' }),
        getCommitDiffContent: vi.fn().mockResolvedValue({ commitHash: 'abc123', original: '', modified: '' }),
        getHistory: vi.fn().mockResolvedValue([]),
        fetch: vi.fn().mockResolvedValue({ success: true }),
        pull: vi.fn().mockResolvedValue({ success: true }),
        push: vi.fn().mockResolvedValue({ success: true }),
        pruneLfs: vi.fn().mockResolvedValue({ success: true, dryRun: false, verifyRemote: true, recentCommitsToKeep: 2 }),
        commitAll: vi.fn().mockResolvedValue({ success: true }),
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

  it('renders color-coded commit state labels for local, remote, and synced commits', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([
      {
        hash: 'aaa111',
        shortHash: 'aaa111',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: local',
        author: 'Dev One',
        syncStatus: 'local-only',
      },
      {
        hash: 'bbb222',
        shortHash: 'bbb222',
        date: '2026-02-16T09:00:00.000Z',
        subject: 'feat: remote',
        author: 'Dev Two',
        syncStatus: 'remote-only',
      },
      {
        hash: 'ccc333',
        shortHash: 'ccc333',
        date: '2026-02-16T08:00:00.000Z',
        subject: 'feat: both',
        author: 'Dev Three',
        syncStatus: 'both',
      },
    ]);

    render(<GitSidebar />);

    expect((await screen.findAllByText('Local only')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remote only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Synced').length).toBeGreaterThan(0);

    const localCommit = screen.getByRole('button', { name: /feat: local/i });
    const remoteCommit = screen.getByRole('button', { name: /feat: remote/i });
    const syncedCommit = screen.getByRole('button', { name: /feat: both/i });

    expect(localCommit).toHaveClass('git-sidebar-history-item--local-only');
    expect(remoteCommit).toHaveClass('git-sidebar-history-item--remote-only');
    expect(syncedCommit).toHaveClass('git-sidebar-history-item--both');
  });

  it('renders commit status legend in version history section', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([
      {
        hash: 'aaa111',
        shortHash: 'aaa111',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: local',
        author: 'Dev One',
        syncStatus: 'local-only',
      },
    ]);

    render(<GitSidebar />);

    expect(await screen.findByText(/version history/i)).toBeInTheDocument();
    const legend = screen.getByLabelText('Commit status legend');
    expect(within(legend).getByText('Synced')).toBeInTheDocument();
    expect(within(legend).getByText('Local only')).toBeInTheDocument();
    expect(within(legend).getByText('Remote only')).toBeInTheDocument();
    expect(screen.getByTestId('git-history-legend-both')).toBeInTheDocument();
    expect(screen.getByTestId('git-history-legend-local-only')).toBeInTheDocument();
    expect(screen.getByTestId('git-history-legend-remote-only')).toBeInTheDocument();
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

  it('single click on a commit opens a transient git-diff commit tab', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([
      {
        hash: 'abc123def456',
        shortHash: 'abc123d',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: add sidebar history click',
        author: 'Dev One',
      },
    ]);

    render(<GitSidebar />);

    const commitItem = await screen.findByRole('button', { name: /feat: add sidebar history click/i });

    await act(async () => {
      fireEvent.click(commitItem);
    });

    expect(getStore().tabs).toHaveLength(1);
    expect(getStore().tabs[0]).toMatchObject({
      type: 'git-diff',
      id: 'git-diff:commit:abc123def456',
      isTransient: true,
    });
  });

  it('double click on a commit opens a persistent git-diff commit tab', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([
      {
        hash: 'abc123def456',
        shortHash: 'abc123d',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: add sidebar history click',
        author: 'Dev One',
      },
    ]);

    render(<GitSidebar />);

    const commitItem = await screen.findByRole('button', { name: /feat: add sidebar history click/i });

    await act(async () => {
      fireEvent.doubleClick(commitItem);
    });

    expect(getStore().tabs).toHaveLength(1);
    expect(getStore().tabs[0]).toMatchObject({
      type: 'git-diff',
      id: 'git-diff:commit:abc123def456',
      isTransient: false,
    });
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

  it('wires fetch, pull, push, and prune lfs buttons', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });

    render(<GitSidebar />);

    const fetchButton = await screen.findByRole('button', { name: /fetch/i });
    const pullButton = screen.getByRole('button', { name: /pull/i });
    const pushButton = screen.getByRole('button', { name: /push/i });
    const pruneButton = screen.getByRole('button', { name: /prune lfs/i });

    await act(async () => {
      fireEvent.click(fetchButton);
      fireEvent.click(pullButton);
      fireEvent.click(pushButton);
      fireEvent.click(pruneButton);
    });

    expect((window as any).electronAPI.git.fetch).toHaveBeenCalledWith('/repo/path');
    expect((window as any).electronAPI.git.pull).toHaveBeenCalledWith('/repo/path');
    expect((window as any).electronAPI.git.push).toHaveBeenCalledWith('/repo/path');
    expect((window as any).electronAPI.git.pruneLfs).toHaveBeenCalledWith('/repo/path', {
      dryRun: false,
      verifyRemote: true,
      recentCommitsToKeep: 2,
    });
  });

  it('shows in-progress feedback while prune lfs is running', async () => {
    let resolvePrune: ((value: { success: boolean; dryRun: boolean; verifyRemote: boolean; recentCommitsToKeep: number }) => void) | null = null;
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.pruneLfs = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrune = resolve;
        }),
    );

    render(<GitSidebar />);

    const pruneButton = await screen.findByRole('button', { name: /prune lfs/i });
    await act(async () => {
      fireEvent.click(pruneButton);
    });

    expect(screen.getByRole('status')).toHaveTextContent(/pruning local git lfs cache/i);
    expect(screen.getByRole('button', { name: /pruning/i })).toBeDisabled();

    await act(async () => {
      resolvePrune?.({ success: true, dryRun: false, verifyRemote: true, recentCommitsToKeep: 2 });
    });
  });

  it('commits all changes and closes open git-diff tabs', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });

    useAppStore.setState({
      tabs: [
        { type: 'git-diff', id: 'git-diff:posts/first.md', isTransient: false },
        { type: 'post', id: 'post-1', isTransient: false },
        { type: 'git-diff', id: 'git-diff:posts/second.md', isTransient: true },
      ],
      activeTabId: 'git-diff:posts/first.md',
    });

    render(<GitSidebar />);

    const commitInput = await screen.findByPlaceholderText(/commit message/i);
    await act(async () => {
      fireEvent.change(commitInput, { target: { value: 'feat: commit from sidebar' } });
    });

    const commitButton = screen.getByRole('button', { name: /^commit$/i });
    await act(async () => {
      fireEvent.click(commitButton);
    });

    expect((window as any).electronAPI.git.commitAll).toHaveBeenCalledWith('/repo/path', 'feat: commit from sidebar');
    expect(getStore().tabs).toEqual([
      { type: 'post', id: 'post-1', isTransient: false },
    ]);
  });

  it('shows auth guidance when fetch fails due to authentication', async () => {
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.fetch = vi.fn().mockResolvedValue({
      success: false,
      code: 'auth-required',
      error: 'Authentication required for remote Git action. Detected provider: GitHub.',
      guidance: [
        'Create a GitHub Personal Access Token.',
        'Retry with username + token.',
      ],
    });

    render(<GitSidebar />);

    const fetchButton = await screen.findByRole('button', { name: /fetch/i });
    await act(async () => {
      fireEvent.click(fetchButton);
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/create a github personal access token/i)).toHaveLength(1);
    expect(screen.getByText(/retry with username \+ token/i)).toBeInTheDocument();
  });

  it('shows in-progress feedback while push is running', async () => {
    let resolvePush: ((value: { success: boolean }) => void) | null = null;
    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });
    (window as any).electronAPI.git.push = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );

    render(<GitSidebar />);

    const pushButton = await screen.findByRole('button', { name: /push/i });
    await act(async () => {
      fireEvent.click(pushButton);
    });

    expect(screen.getByRole('status')).toHaveTextContent(/pushing commits to remote/i);
    expect(screen.getByRole('button', { name: /pushing/i })).toBeDisabled();

    await act(async () => {
      resolvePush?.({ success: true });
    });
  });

  it('polls repository status on an interval and prevents overlapping in-flight requests', async () => {
    vi.useFakeTimers();

    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });

    let resolveStatus: ((value: { files: Array<{ path: string; status: string }>; counts: { untracked: number; modified: number; deleted: number; renamed: number; staged: number; total: number } }) => void) | null = null;
    (window as any).electronAPI.git.getStatus = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([]);

    try {
      render(<GitSidebar />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect((window as any).electronAPI.git.getStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(8000);
      });

      expect((window as any).electronAPI.git.getStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveStatus?.({
          files: [{ path: 'posts/first.md', status: 'modified' }],
          counts: { untracked: 0, modified: 1, deleted: 0, renamed: 0, staged: 0, total: 1 },
        });
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect((window as any).electronAPI.git.getStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies incremental open-changes updates while preserving unchanged item identity and scroll position', async () => {
    vi.useFakeTimers();

    (window as any).electronAPI.git.getRepoState = vi.fn().mockResolvedValue({
      isRepo: true,
      rootPath: '/repo/path',
      currentBranch: 'main',
      hasRemote: true,
    });

    (window as any).electronAPI.git.getStatus = vi
      .fn()
      .mockResolvedValueOnce({
        files: [
          { path: 'posts/first.md', status: 'modified' },
          { path: 'posts/second.md', status: 'untracked' },
        ],
        counts: { untracked: 1, modified: 1, deleted: 0, renamed: 0, staged: 0, total: 2 },
      })
      .mockResolvedValueOnce({
        files: [
          { path: 'posts/first.md', status: 'modified' },
          { path: 'posts/third.md', status: 'deleted' },
        ],
        counts: { untracked: 0, modified: 1, deleted: 1, renamed: 0, staged: 0, total: 2 },
      });
    (window as any).electronAPI.git.getHistory = vi.fn().mockResolvedValue([]);

    try {
      render(<GitSidebar />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const firstBefore = screen.getByRole('button', { name: /posts\/first\.md/i });
      const list = screen.getByRole('list', { name: /open changes/i });
      list.scrollTop = 120;

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: /posts\/third\.md/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /posts\/second\.md/i })).not.toBeInTheDocument();
      const firstAfter = screen.getByRole('button', { name: /posts\/first\.md/i });
      expect(firstAfter).toBe(firstBefore);
      expect(list.scrollTop).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });
});
