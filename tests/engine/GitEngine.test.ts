import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockVersion = vi.fn();
const mockCheckIsRepo = vi.fn();
const mockRevparse = vi.fn();
const mockStatus = vi.fn();
const mockInit = vi.fn();
const mockRaw = vi.fn();
const mockAdd = vi.fn();
const mockCommit = vi.fn();
const mockGetRemotes = vi.fn();
const mockAddRemote = vi.fn();
const mockRemote = vi.fn();
const { mockReadFile, mockStat, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  default: {},
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    version: mockVersion,
    checkIsRepo: mockCheckIsRepo,
    revparse: mockRevparse,
    status: mockStatus,
    init: mockInit,
    raw: mockRaw,
    add: mockAdd,
    commit: mockCommit,
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
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockStat.mockResolvedValue({});
    mockWriteFile.mockResolvedValue(undefined);
    mockCheckIsRepo.mockResolvedValue(false);
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

  describe('ensureGitignore', () => {
    it('should create .gitignore with default system metadata entries when missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await gitEngine.ensureGitignore('/tmp/project');

      expect(result.updated).toBe(true);
      expect(result.created).toBe(true);
      expect(result.addedEntries.length).toBeGreaterThan(0);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it('should append missing entries when .gitignore exists but is incomplete', async () => {
      mockReadFile.mockResolvedValue('node_modules/\n.DS_Store\n');

      const result = await gitEngine.ensureGitignore('/tmp/project');

      expect(result.updated).toBe(true);
      expect(result.created).toBe(false);
      expect(result.addedEntries).toContain('Thumbs.db');
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it('should not rewrite .gitignore when all default entries already exist', async () => {
      mockReadFile.mockResolvedValue([
        '.DS_Store',
        'Thumbs.db',
        'Desktop.ini',
        '$RECYCLE.BIN/',
        '.Spotlight-V100/',
        '.Trashes/',
        '._*',
        '.fseventsd',
      ].join('\n'));

      const result = await gitEngine.ensureGitignore('/tmp/project');

      expect(result).toEqual({ updated: false, created: false, addedEntries: [] });
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('initializeRepo', () => {
    it('should emit detailed progress updates throughout initialization', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockResolvedValue('ok');
      mockAdd.mockResolvedValue(undefined);
      mockCommit.mockResolvedValue(undefined);
      mockGetRemotes.mockResolvedValue([]);
      mockAddRemote.mockResolvedValue(undefined);

      const onProgress = vi.fn();
      const result = await gitEngine.initializeRepo('/tmp/project', 'https://github.com/example/repo.git', onProgress);

      expect(result).toEqual({ success: true });
      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'checking-git' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'initializing-repo' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'configuring-lfs' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'tracking-lfs-patterns' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'staging-files' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'creating-initial-commit' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'configuring-remote' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed', progress: 100 }));
    });

    it('should emit failed progress state when initialization fails', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockRejectedValue(new Error('init failed'));

      const onProgress = vi.fn();
      const result = await gitEngine.initializeRepo('/tmp/project', undefined, onProgress);

      expect(result.success).toBe(false);
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed' }));
    });

    it('should skip already-completed steps on re-run and still succeed', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockCheckIsRepo.mockResolvedValue(true);
      mockRaw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'config' && args[4] === 'filter.lfs.clean') {
          return 'git-lfs clean -- %f';
        }
        if (args[0] === 'rev-parse' && args[2] === 'HEAD') {
          return 'abc123';
        }
        return 'ok';
      });
      mockReadFile.mockResolvedValue(
        '*.png filter=lfs diff=lfs merge=lfs -text\n*.jpg filter=lfs diff=lfs merge=lfs -text\n',
      );
      mockGetRemotes.mockResolvedValue([{ name: 'origin', refs: { fetch: 'https://github.com/example/repo.git', push: 'https://github.com/example/repo.git' } }]);

      const onProgress = vi.fn();
      const result = await gitEngine.initializeRepo('/tmp/project', 'https://github.com/example/repo.git', onProgress);

      expect(result).toEqual({ success: true });
      expect(mockInit).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
      expect(mockAddRemote).not.toHaveBeenCalled();
      expect(mockRemote).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'initializing-repo', detail: 'already initialized' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'configuring-lfs', detail: 'already configured' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'creating-initial-commit', detail: 'already has commits' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'configuring-remote', detail: 'already up to date' }));
    });

    it('should update existing origin remote when URL differs', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockCheckIsRepo.mockResolvedValue(true);
      mockRaw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'config' && args[4] === 'filter.lfs.clean') {
          return 'git-lfs clean -- %f';
        }
        if (args[0] === 'rev-parse' && args[2] === 'HEAD') {
          return 'abc123';
        }
        return 'ok';
      });
      mockReadFile.mockResolvedValue('*.png filter=lfs diff=lfs merge=lfs -text\n');
      mockGetRemotes.mockResolvedValue([{ name: 'origin', refs: { fetch: 'https://github.com/old/repo.git', push: 'https://github.com/old/repo.git' } }]);

      const result = await gitEngine.initializeRepo('/tmp/project', 'https://github.com/new/repo.git');

      expect(result).toEqual({ success: true });
      expect(mockRemote).toHaveBeenCalledWith(['set-url', 'origin', 'https://github.com/new/repo.git']);
    });

    it('should initialize git repo, configure lfs and track image patterns', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'config' && args[3] === 'filter.lfs.clean') {
          throw new Error('unset');
        }
        if (args[0] === 'rev-parse' && args[2] === 'HEAD') {
          throw new Error('no commits');
        }
        return 'ok';
      });
      mockAdd.mockResolvedValue(undefined);
      mockCommit.mockResolvedValue(undefined);

      const result = await gitEngine.initializeRepo('/tmp/project');

      expect(result).toEqual({ success: true });
      expect(mockInit).toHaveBeenCalled();
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'install', '--local']);
      expect(mockCommit).toHaveBeenCalledWith('initial commit');
      expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('should configure origin remote when a remote url is provided', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockResolvedValue('ok');
      mockAdd.mockResolvedValue(undefined);
      mockCommit.mockResolvedValue(undefined);
      mockGetRemotes.mockResolvedValue([]);
      mockAddRemote.mockResolvedValue(undefined);

      const result = await gitEngine.initializeRepo('/tmp/project', 'https://github.com/example/repo.git');

      expect(result).toEqual({ success: true });
      expect(mockGetRemotes).toHaveBeenCalledWith(true);
      expect(mockAddRemote).toHaveBeenCalledWith('origin', 'https://github.com/example/repo.git');
    });

    it('should succeed when there is nothing to commit after staging', async () => {
      mockVersion.mockResolvedValue({ major: 2, minor: 49, patch: 0, agent: 'git/version', installed: true });
      mockInit.mockResolvedValue(undefined);
      mockRaw.mockResolvedValue('ok');
      mockAdd.mockResolvedValue(undefined);
      mockCommit.mockRejectedValue(new Error('nothing to commit, working tree clean'));

      const result = await gitEngine.initializeRepo('/tmp/project');

      expect(result).toEqual({ success: true });
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
