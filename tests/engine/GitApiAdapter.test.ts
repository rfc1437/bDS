import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitApiAdapter } from '../../src/main/engine/GitApiAdapter';

const { mockGitEngine, mockProjectEngine } = vi.hoisted(() => ({
  mockGitEngine: {
    checkAvailability: vi.fn().mockResolvedValue({ gitFound: true, version: '2.40.0' }),
    getRepoState: vi.fn().mockResolvedValue({ isRepo: true, currentBranch: 'main', hasRemote: true }),
    getStatus: vi.fn().mockResolvedValue({ files: [], counts: { untracked: 0, modified: 0, deleted: 0, renamed: 0, staged: 0 } }),
    getHistory: vi.fn().mockResolvedValue([]),
    getRemoteState: vi.fn().mockResolvedValue({ localBranch: 'main', upstreamBranch: 'origin/main', hasUpstream: true, ahead: 0, behind: 0 }),
    fetch: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    commitAll: vi.fn().mockResolvedValue({ success: true }),
  },
  mockProjectEngine: {
    getActiveProject: vi.fn().mockResolvedValue({ id: 'p1', dataPath: '/projects/blog' }),
  },
}));

vi.mock('../../src/main/engine/GitEngine', () => ({
  getGitEngine: () => mockGitEngine,
}));

vi.mock('../../src/main/engine/ProjectEngine', () => ({
  getProjectEngine: () => mockProjectEngine,
}));

describe('GitApiAdapter', () => {
  let adapter: GitApiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitApiAdapter();
  });

  it('checkAvailability delegates directly (no projectPath)', async () => {
    const result = await adapter.checkAvailability();
    expect(mockGitEngine.checkAvailability).toHaveBeenCalledWith();
    expect(result).toEqual({ gitFound: true, version: '2.40.0' });
  });

  it('getRepoState resolves projectPath from active project', async () => {
    await adapter.getRepoState();
    expect(mockProjectEngine.getActiveProject).toHaveBeenCalled();
    expect(mockGitEngine.getRepoState).toHaveBeenCalledWith('/projects/blog');
  });

  it('getStatus resolves projectPath', async () => {
    await adapter.getStatus();
    expect(mockGitEngine.getStatus).toHaveBeenCalledWith('/projects/blog');
  });

  it('getHistory passes limit and resolves projectPath', async () => {
    await adapter.getHistory(10);
    expect(mockGitEngine.getHistory).toHaveBeenCalledWith('/projects/blog', 10);
  });

  it('getHistory passes undefined limit', async () => {
    await adapter.getHistory();
    expect(mockGitEngine.getHistory).toHaveBeenCalledWith('/projects/blog', undefined);
  });

  it('getRemoteState resolves projectPath', async () => {
    await adapter.getRemoteState();
    expect(mockGitEngine.getRemoteState).toHaveBeenCalledWith('/projects/blog');
  });

  it('fetch resolves projectPath', async () => {
    await adapter.fetch();
    expect(mockGitEngine.fetch).toHaveBeenCalledWith('/projects/blog');
  });

  it('pull resolves projectPath', async () => {
    await adapter.pull();
    expect(mockGitEngine.pull).toHaveBeenCalledWith('/projects/blog');
  });

  it('push resolves projectPath', async () => {
    await adapter.push();
    expect(mockGitEngine.push).toHaveBeenCalledWith('/projects/blog');
  });

  it('commitAll resolves projectPath and passes message', async () => {
    await adapter.commitAll('update files');
    expect(mockGitEngine.commitAll).toHaveBeenCalledWith('/projects/blog', 'update files');
  });

  it('throws when no active project', async () => {
    mockProjectEngine.getActiveProject.mockResolvedValueOnce(null);
    await expect(adapter.getRepoState()).rejects.toThrow('No active project with a data path');
  });

  it('throws when active project has no dataPath', async () => {
    mockProjectEngine.getActiveProject.mockResolvedValueOnce({ id: 'p1', dataPath: null });
    await expect(adapter.fetch()).rejects.toThrow('No active project with a data path');
  });
});
