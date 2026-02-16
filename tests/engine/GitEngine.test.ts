import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockVersion = vi.fn();
const mockEnv = vi.fn();
const mockCheckIsRepo = vi.fn();
const mockRevparse = vi.fn();
const mockStatus = vi.fn();
const mockDiff = vi.fn();
const mockShow = vi.fn();
const mockLog = vi.fn();
const mockInit = vi.fn();
const mockRaw = vi.fn();
const mockAdd = vi.fn();
const mockCommit = vi.fn();
const mockFetch = vi.fn();
const mockPull = vi.fn();
const mockPush = vi.fn();
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
    env: mockEnv,
    version: mockVersion,
    checkIsRepo: mockCheckIsRepo,
    revparse: mockRevparse,
    status: mockStatus,
    diff: mockDiff,
    show: mockShow,
    log: mockLog,
    init: mockInit,
    raw: mockRaw,
    add: mockAdd,
    commit: mockCommit,
    fetch: mockFetch,
    pull: mockPull,
    push: mockPush,
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
    mockEnv.mockImplementation(() => ({
      env: mockEnv,
      version: mockVersion,
      checkIsRepo: mockCheckIsRepo,
      revparse: mockRevparse,
      status: mockStatus,
      diff: mockDiff,
      show: mockShow,
      log: mockLog,
      init: mockInit,
      raw: mockRaw,
      add: mockAdd,
      commit: mockCommit,
      fetch: mockFetch,
      pull: mockPull,
      push: mockPush,
      getRemotes: mockGetRemotes,
      addRemote: mockAddRemote,
      remote: mockRemote,
    }));
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

  describe('getDiff', () => {
    it('should return patch output for a repository file', async () => {
      mockDiff.mockResolvedValue('diff --git a/posts/first.md b/posts/first.md\n+hello');

      const result = await gitEngine.getDiff('/tmp/project', 'posts/first.md');

      expect(mockDiff).toHaveBeenCalledWith(['--', 'posts/first.md']);
      expect(result).toEqual({
        filePath: 'posts/first.md',
        patch: 'diff --git a/posts/first.md b/posts/first.md\n+hello',
      });
    });
  });

  describe('getDiffContent', () => {
    it('should return original and modified text for a file', async () => {
      mockShow.mockResolvedValue('# old content');
      mockReadFile.mockResolvedValue('# new content');

      const result = await gitEngine.getDiffContent('/tmp/project', 'posts/first.md');

      expect(mockShow).toHaveBeenCalledWith(['HEAD:posts/first.md']);
      expect(result).toEqual({
        filePath: 'posts/first.md',
        original: '# old content',
        modified: '# new content',
      });
    });
  });

  describe('getCommitDiffContent', () => {
    it('should return commit patch text in diff content shape', async () => {
      mockShow.mockResolvedValue([
        'diff --git a/posts/first.md b/posts/first.md',
        'index 1234567..89abcde 100644',
        '--- a/posts/first.md',
        '+++ b/posts/first.md',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/src/main.ts b/src/main.ts',
        'index 1234567..89abcde 100644',
        '--- a/src/main.ts',
        '+++ b/src/main.ts',
        '@@ -1 +1 @@',
        '-const oldValue = 1;',
        '+const newValue = 2;',
      ].join('\n'));

      const result = await gitEngine.getCommitDiffContent('/tmp/project', 'abc123def456');

      expect(mockShow).toHaveBeenCalledWith(['--format=', '--patch', 'abc123def456']);
      expect(result).toEqual({
        commitHash: 'abc123def456',
        original: 'old',
        modified: 'new',
        files: [
          {
            filePath: 'posts/first.md',
            original: 'old',
            modified: 'new',
          },
          {
            filePath: 'src/main.ts',
            original: 'const oldValue = 1;',
            modified: 'const newValue = 2;',
          },
        ],
      });
    });
  });

  describe('getHistory', () => {
    it('should return latest commits from git log as local-only when no tracking branch exists', async () => {
      mockStatus.mockResolvedValue({ current: 'main', tracking: undefined });
      mockLog.mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            date: '2026-02-16T10:00:00.000Z',
            message: 'feat: add git sidebar',
            author_name: 'Dev One',
          },
          {
            hash: 'def456',
            date: '2026-02-15T09:00:00.000Z',
            message: 'fix: sidebar styles',
            author_name: 'Dev Two',
          },
        ],
      });

      const result = await gitEngine.getHistory('/tmp/project', 20);

      expect(mockLog).toHaveBeenCalledWith({ maxCount: 20 });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        hash: 'abc123',
        shortHash: 'abc123',
        date: '2026-02-16T10:00:00.000Z',
        subject: 'feat: add git sidebar',
        author: 'Dev One',
        syncStatus: 'local-only',
      });
    });

    it('should classify commits as both, local-only, and remote-only when tracking branch exists', async () => {
      mockStatus.mockResolvedValue({ current: 'main', tracking: 'origin/main' });
      mockLog
        .mockResolvedValueOnce({
          all: [
            {
              hash: 'aaa111',
              date: '2026-02-16T12:00:00.000Z',
              message: 'feat: local commit',
              author_name: 'Local Dev',
            },
            {
              hash: 'bbb222',
              date: '2026-02-16T11:00:00.000Z',
              message: 'feat: shared commit',
              author_name: 'Shared Dev',
            },
          ],
        })
        .mockResolvedValueOnce({
          all: [
            {
              hash: 'bbb222',
              date: '2026-02-16T11:00:00.000Z',
              message: 'feat: shared commit',
              author_name: 'Shared Dev',
            },
            {
              hash: 'ccc333',
              date: '2026-02-16T10:00:00.000Z',
              message: 'fix: remote commit',
              author_name: 'Remote Dev',
            },
          ],
        });

      const result = await gitEngine.getHistory('/tmp/project', 20);

      expect(mockLog).toHaveBeenNthCalledWith(1, { maxCount: 20 });
      expect(mockLog).toHaveBeenNthCalledWith(2, ['origin/main', '--max-count', '20']);
      expect(result).toEqual([
        {
          hash: 'aaa111',
          shortHash: 'aaa111',
          date: '2026-02-16T12:00:00.000Z',
          subject: 'feat: local commit',
          author: 'Local Dev',
          syncStatus: 'local-only',
        },
        {
          hash: 'bbb222',
          shortHash: 'bbb222',
          date: '2026-02-16T11:00:00.000Z',
          subject: 'feat: shared commit',
          author: 'Shared Dev',
          syncStatus: 'both',
        },
        {
          hash: 'ccc333',
          shortHash: 'ccc333',
          date: '2026-02-16T10:00:00.000Z',
          subject: 'fix: remote commit',
          author: 'Remote Dev',
          syncStatus: 'remote-only',
        },
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
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'track', '*.webp']);
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'track', '*.heif']);
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'track', '*.tiff']);
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'track', '*.bmp']);
      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'track', '*.ico']);
      expect(mockAdd).toHaveBeenNthCalledWith(1, ['posts', 'media', 'meta', 'thumbnails', '.gitattributes', '.gitignore']);
      expect(mockAdd).toHaveBeenNthCalledWith(2, ['--renormalize', 'posts', 'media', 'meta', 'thumbnails', '.gitattributes', '.gitignore']);
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
      expect(mockRaw).toHaveBeenCalledWith(['config', '--local', 'push.autoSetupRemote', 'true']);
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

  describe('pruneLfsCache', () => {
    it('should run git lfs prune with verify-remote by default', async () => {
      mockRaw.mockResolvedValue('prune complete');

      const result = await gitEngine.pruneLfsCache('/tmp/project');

      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'prune', '--verify-remote']);
      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.verifyRemote).toBe(true);
    });

    it('should run git lfs prune in dry-run mode when requested', async () => {
      mockRaw.mockResolvedValue('would prune');

      const result = await gitEngine.pruneLfsCache('/tmp/project', { dryRun: true });

      expect(mockRaw).toHaveBeenCalledWith(['lfs', 'prune', '--verify-remote', '--dry-run']);
      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });

    it('should return error result when git lfs prune fails', async () => {
      mockRaw.mockRejectedValue(new Error('prune failed'));

      const result = await gitEngine.pruneLfsCache('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.error).toContain('prune failed');
    });
  });

  describe('repo actions', () => {
    it('should run fetch with prune and return success', async () => {
      mockFetch.mockResolvedValue(undefined);

      const result = await gitEngine.fetch('/tmp/project');

      expect(mockEnv).toHaveBeenCalledWith('GIT_TERMINAL_PROMPT', '0');
      expect(mockEnv).toHaveBeenCalledWith('GCM_INTERACTIVE', 'never');
      expect(mockFetch).toHaveBeenCalledWith(['--prune']);
      expect(result).toEqual({ success: true });
    });

    it('should run pull and return success', async () => {
      mockPull.mockResolvedValue(undefined);

      const result = await gitEngine.pull('/tmp/project');

      expect(mockPull).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should run push and return success', async () => {
      mockPush.mockResolvedValue(undefined);

      const result = await gitEngine.push('/tmp/project');

      expect(mockPush).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should auto-set upstream and retry push when no upstream branch exists', async () => {
      mockPush
        .mockRejectedValueOnce(new Error('fatal: The current branch main has no upstream branch.'))
        .mockResolvedValueOnce(undefined);
      mockStatus.mockResolvedValue({ current: 'main' });

      const result = await gitEngine.push('/tmp/project');

      expect(mockPush).toHaveBeenNthCalledWith(1);
      expect(mockPush).toHaveBeenNthCalledWith(2, ['-u', 'origin', 'main']);
      expect(result).toEqual({ success: true });
    });

    it('should stage all files and commit with message', async () => {
      mockAdd.mockResolvedValue(undefined);
      mockCommit.mockResolvedValue(undefined);

      const result = await gitEngine.commitAll('/tmp/project', 'feat: commit changes');

      expect(mockAdd).toHaveBeenCalledWith(['-A']);
      expect(mockCommit).toHaveBeenCalledWith('feat: commit changes');
      expect(result).toEqual({ success: true });
    });

    it('should reject empty commit messages', async () => {
      const result = await gitEngine.commitAll('/tmp/project', '   ');

      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Commit message is required.' });
    });

    it('should return auth-required code with OS guidance when fetch authentication fails', async () => {
      mockFetch.mockRejectedValue(new Error('fatal: Authentication failed for https://example.com/repo.git'));
      mockGetRemotes.mockResolvedValue([]);

      const result = await gitEngine.fetch('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('auth-required');
      expect(result.error).toContain('Authentication required for remote Git action');
      expect(result.error).not.toContain('Original error');
      expect(Array.isArray(result.guidance)).toBe(true);
      expect(result.guidance!.length).toBeGreaterThan(0);
      expect(result.guidance!.join(' ')).not.toContain('GitHub detected');
      expect(result.guidance!.join(' ')).toContain('token');
      expect(result.guidance!.join(' ')).toContain('password');
    });

    it('should include GitHub-specific guidance when remote points to github.com', async () => {
      mockFetch.mockRejectedValue(new Error('fatal: Authentication failed'));
      mockGetRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/example/repo.git',
            push: 'https://github.com/example/repo.git',
          },
        },
      ]);

      const result = await gitEngine.fetch('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('auth-required');
      expect(result.error).toContain('Detected provider: GitHub');
      expect(result.guidance).toEqual(expect.arrayContaining([
        expect.stringContaining('Personal Access Token'),
        expect.stringContaining('repo'),
        expect.stringContaining('git config --global credential.helper'),
        expect.stringContaining('git remote set-url origin'),
      ]));
    });

    it('should include GitLab-specific token guidance when remote points to gitlab', async () => {
      mockFetch.mockRejectedValue(new Error('fatal: Authentication failed'));
      mockGetRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://gitlab.com/example/repo.git',
            push: 'https://gitlab.com/example/repo.git',
          },
        },
      ]);

      const result = await gitEngine.fetch('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('auth-required');
      expect(result.error).toContain('Detected provider: GitLab');
      expect(result.guidance).toEqual(expect.arrayContaining([
        expect.stringContaining('User Settings > Access Tokens'),
        expect.stringContaining('read_repository'),
        expect.stringContaining('write_repository'),
      ]));
    });

    it('should include Gitea/Forgejo token guidance when remote appears self-hosted gitea/forgejo', async () => {
      mockFetch.mockRejectedValue(new Error('fatal: Authentication failed'));
      mockGetRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://forgejo.example.com/my/repo.git',
            push: 'https://forgejo.example.com/my/repo.git',
          },
        },
      ]);

      const result = await gitEngine.fetch('/tmp/project');

      expect(result.success).toBe(false);
      expect(result.code).toBe('auth-required');
      expect(result.error).toContain('Detected provider: Gitea/Forgejo');
      expect(result.guidance).toEqual(expect.arrayContaining([
        expect.stringContaining('Settings > Applications'),
        expect.stringContaining('Access Tokens'),
        expect.stringContaining('repository'),
      ]));
    });
  });
});
