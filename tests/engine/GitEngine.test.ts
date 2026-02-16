import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockVersion = vi.fn();
const mockCheckIsRepo = vi.fn();
const mockRevparse = vi.fn();
const mockStatus = vi.fn();
const mockInit = vi.fn();
const mockRaw = vi.fn();
const mockAdd = vi.fn();
const mockGetRemotes = vi.fn();
const mockAddRemote = vi.fn();
const mockRemote = vi.fn();

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    version: mockVersion,
    checkIsRepo: mockCheckIsRepo,
    revparse: mockRevparse,
    status: mockStatus,
    init: mockInit,
    raw: mockRaw,
    add: mockAdd,
    getRemotes: mockGetRemotes,
    addRemote: mockAddRemote,
    remote: mockRemote,
  })),
}));

import { GitEngine } from '../../src/main/engine/GitEngine';

describe('GitEngine', () => {
  let gitEngine: GitEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    gitEngine = new GitEngine();
  });

  describe('checkAvailability', () => {
    it('should return gitFound true with version when git is available', async () => {
      mockVersion.mockResolvedValue({
        major: 2,
        minor: 49,
        patch: 0,
        agent: 'git/version',
        installed: true,
      });

      const result = await gitEngine.checkAvailability();

      expect(result).toEqual({ gitFound: true, version: '2.49.0' });
    });

    it('should return gitFound false when git is not available', async () => {
      mockVersion.mockRejectedValue(new Error('git: command not found'));

      const result = await gitEngine.checkAvailability();

      expect(result).toEqual({ gitFound: false });
    });
  });

  describe('getRepoState', () => {
    it('should return non-repo state when project is not a git repository', async () => {
      mockCheckIsRepo.mockResolvedValue(false);

      const result = await gitEngine.getRepoState('/tmp/project');

      expect(result).toEqual({
        isRepo: false,
        hasRemote: false,
      });
    });

    it('should return repo details for a valid repository', async () => {
      mockCheckIsRepo.mockResolvedValue(true);
      mockRevparse.mockResolvedValue('/tmp/project');
      mockStatus.mockResolvedValue({
        current: 'main',
        tracking: 'origin/main',
      });

      const result = await gitEngine.getRepoState('/tmp/project');

      expect(result).toEqual({
        isRepo: true,
        rootPath: '/tmp/project',
        currentBranch: 'main',
        hasRemote: true,
      });
    });
  });

  describe('getStatus', () => {
    it('should normalize changed files and counts from git status', async () => {
      mockStatus.mockResolvedValue({
        not_added: ['new-file.md'],
        modified: ['edited.md'],
        deleted: ['removed.md'],
        renamed: [{ from: 'old.md', to: 'new.md' }],
        created: ['staged.md'],
      });

      const result = await gitEngine.getStatus('/tmp/project');

      expect(result.counts).toEqual({
        untracked: 1,
        modified: 1,
        deleted: 1,
        renamed: 1,
        staged: 1,
        total: 5,
      });
      expect(result.files).toEqual([
        { path: 'new-file.md', status: 'untracked' },
        { path: 'edited.md', status: 'modified' },
        { path: 'removed.md', status: 'deleted' },
        { path: 'new.md', status: 'renamed', previousPath: 'old.md' },
        { path: 'staged.md', status: 'staged' },
      ]);
    });
  });

  describe('initializeRepo', () => {
    it('should initialize git repo, configure lfs and track image patterns', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockResolvedValue('ok');
      mockAdd.mockResolvedValue(undefined);

      const result = await gitEngine.initializeRepo('/tmp/project');

      expect(result).toEqual({ success: true });
      expect(mockInit).toHaveBeenCalled();
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'install', '--local']);
      expect(mockAdd).toHaveBeenCalledWith('.gitattributes');
      expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('should configure origin remote when a remote url is provided', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockResolvedValue('ok');
      mockAdd.mockResolvedValue(undefined);
      mockGetRemotes.mockResolvedValue([]);
      mockAddRemote.mockResolvedValue(undefined);

      const result = await gitEngine.initializeRepo('/tmp/project', 'https://github.com/example/repo.git');

      expect(result).toEqual({ success: true });
      expect(mockGetRemotes).toHaveBeenCalledWith(true);
      expect(mockAddRemote).toHaveBeenCalledWith('origin', 'https://github.com/example/repo.git');
    });

    it('should return explicit git missing guidance when git is unavailable', async () => {
      mockVersion.mockRejectedValue(new Error('git: command not found'));

      const result = await gitEngine.initializeRepo('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('git-missing');
      expect(result.error).toContain('install Git');
    });

    it('should return explicit git-lfs missing guidance when lfs command fails', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockRejectedValue(new Error('git: lfs is not a git command'));

      const result = await gitEngine.initializeRepo('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('git-lfs-missing');
      expect(result.error).toContain('install Git LFS');
    });
  });
});
