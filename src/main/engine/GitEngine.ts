import { simpleGit } from 'simple-git';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { execFile } from 'node:child_process';

export interface GitAvailability {
  gitFound: boolean;
  version?: string;
}

export interface RepoState {
  isRepo: boolean;
  rootPath?: string;
  currentBranch?: string;
  hasRemote: boolean;
}

export type GitFileStatus = 'untracked' | 'modified' | 'deleted' | 'renamed' | 'staged';

export interface GitStatusFile {
  path: string;
  status: GitFileStatus;
  previousPath?: string;
}

export interface GitStatusCounts {
  untracked: number;
  modified: number;
  deleted: number;
  renamed: number;
  staged: number;
  total: number;
}

export interface GitStatusDto {
  files: GitStatusFile[];
  counts: GitStatusCounts;
}

export interface GitDiffDto {
  filePath: string;
  patch: string;
}

export interface GitDiffContentDto {
  filePath: string;
  original: string;
  modified: string;
}

export interface GitCommitDiffContentDto {
  commitHash: string;
  original: string;
  modified: string;
  files: GitCommitDiffFileDto[];
}

export interface GitCommitDiffFileDto {
  filePath: string;
  original: string;
  modified: string;
}

export interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  author: string;
  syncStatus?: GitHistorySyncStatus;
}

export interface GitRemoteStateDto {
  localBranch: string | null;
  upstreamBranch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export type GitHistorySyncStatus = 'both' | 'local-only' | 'remote-only';

export type GitInitPhase =
  | 'checking-git'
  | 'initializing-repo'
  | 'configuring-lfs'
  | 'tracking-lfs-patterns'
  | 'staging-files'
  | 'creating-initial-commit'
  | 'configuring-remote'
  | 'completed'
  | 'failed';

export interface GitInitProgress {
  phase: GitInitPhase;
  progress: number;
  message: string;
  detail?: string;
}

export interface GitInitResult {
  success: boolean;
  error?: string;
  code?: 'git-missing' | 'git-lfs-missing' | 'init-failed' | 'remote-failed' | 'commit-failed';
}

export interface GitIgnoreEnsureResult {
  updated: boolean;
  created: boolean;
  addedEntries: string[];
}

export interface GitLfsPruneOptions {
  dryRun?: boolean;
  verifyRemote?: boolean;
  recentCommitsToKeep?: number;
}

export interface GitLfsPruneResult {
  success: boolean;
  dryRun: boolean;
  verifyRemote: boolean;
  recentCommitsToKeep: number;
  output?: string;
  error?: string;
}

export interface GitActionResult {
  success: boolean;
  code?: 'auth-required' | 'conflict' | 'network' | 'action-failed';
  error?: string;
  guidance?: string[];
}

export type GitPostFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitPostFileChange {
  status: GitPostFileChangeStatus;
  path: string;
  previousPath?: string;
}

type GitProvider = 'unknown' | 'github' | 'gitlab' | 'gitea-forgejo';

let gitEngineInstance: GitEngine | null = null;

export function getGitEngine(): GitEngine {
  if (!gitEngineInstance) {
    gitEngineInstance = new GitEngine();
  }
  return gitEngineInstance;
}

export class GitEngine {
  private readonly markdownExtensions = new Set(['.md', '.markdown', '.mdx']);

  private readonly defaultGitignoreEntries = [
    '.DS_Store',
    'Thumbs.db',
    'Desktop.ini',
    '$RECYCLE.BIN/',
    '.Spotlight-V100/',
    '.Trashes/',
    '._*',
    '.fseventsd',
    'html/',
  ];

  private createNonInteractiveGit(projectPath?: string): ReturnType<typeof simpleGit> {
    return simpleGit(projectPath)
      .env('GIT_TERMINAL_PROMPT', '0')
      .env('GCM_INTERACTIVE', 'never')
      .env('GIT_SSH_COMMAND', 'ssh -oBatchMode=yes');
  }

  private getPlatformAuthGuidance(): string {
    if (process.platform === 'darwin') {
      return 'On macOS, authenticate using Git Credential Manager (`brew install --cask git-credential-manager`), then run `git credential-manager configure`, or use SSH keys added to the keychain and loaded into ssh-agent.';
    }
    if (process.platform === 'win32') {
      return 'On Windows, install Git Credential Manager (included with Git for Windows), run `git credential-manager configure`, then sign in when prompted, or configure SSH keys in the OpenSSH agent.';
    }
    return 'On Linux, install Git Credential Manager (`gcm`) and configure it, or use SSH keys with ssh-agent. Ensure your key is loaded before running fetch/pull/push.';
  }

  private getPlatformAuthGuidanceSteps(): string[] {
    if (process.platform === 'darwin') {
      return [
        'Install Git Credential Manager: brew install --cask git-credential-manager',
        'Configure it: git credential-manager configure',
        'Alternatively use SSH keys in macOS keychain + ssh-agent.',
      ];
    }
    if (process.platform === 'win32') {
      return [
        'Install Git for Windows (includes Git Credential Manager).',
        'Configure it: git credential-manager configure',
        'Alternatively configure SSH keys with the OpenSSH agent.',
      ];
    }
    return [
      'Install Git Credential Manager (`gcm`) and configure it.',
      'Or use SSH keys with ssh-agent and ensure the key is loaded before fetch/pull/push.',
    ];
  }

  private getGitHubGuidance(): string {
    return [
      'GitHub detected: use HTTPS with a Personal Access Token (classic/fine-grained) as password, or use SSH keys.',
      'Token flow: create a token in GitHub Settings > Developer settings > Personal access tokens with at least `repo` scope (or equivalent fine-grained repository permissions).',
      'Then run `git config --global credential.helper manager` (or `osxkeychain` on macOS if preferred), retry fetch/pull/push, and use your GitHub username + token when prompted.',
      'SSH alternative: switch origin with `git remote set-url origin git@github.com:<owner>/<repo>.git` and ensure your SSH key is loaded.',
    ].join(' ');
  }

  private getGitLabGuidanceSteps(): string[] {
    return [
      'Create a GitLab Personal Access Token in User Settings > Access Tokens.',
      'Grant at least `read_repository` and `write_repository` scopes (or equivalent project token permissions).',
      'Set credential helper: git config --global credential.helper manager (or osxkeychain on macOS).',
      'Retry and log in with your GitLab username and the token as password.',
      'SSH alternative: git remote set-url origin git@gitlab.com:<group>/<repo>.git',
    ];
  }

  private getGiteaForgejoGuidanceSteps(): string[] {
    return [
      'Create an access token in your instance under Settings > Applications > Access Tokens (wording may vary by instance).',
      'Grant repository read/write permissions for the target repository.',
      'Set credential helper: git config --global credential.helper manager (or osxkeychain on macOS).',
      'Retry and log in with your username and the token as password for HTTPS remotes.',
      'SSH alternative: use git@<host>:<owner>/<repo>.git and ensure your SSH key is loaded.',
    ];
  }

  private getGenericTokenGuidanceSteps(): string[] {
    return [
      'If your host uses HTTPS auth, create an access token in your Git hosting account settings.',
      'Retry and log in with your normal username and the token as password.',
      'If unsure, switch to SSH and use git@<host>:<owner>/<repo>.git with a loaded SSH key.',
    ];
  }

  private getGitHubGuidanceSteps(): string[] {
    return [
      'Create a GitHub Personal Access Token in Settings > Developer settings > Personal access tokens.',
      'Use at least `repo` scope (or equivalent fine-grained repository permissions).',
      'Set credential helper: git config --global credential.helper manager (or osxkeychain on macOS).',
      'Retry and log in with your GitHub username and the token as password.',
      'SSH alternative: git remote set-url origin git@github.com:<owner>/<repo>.git',
    ];
  }

  /**
   * Extracts the host portion from common Git URL formats.
   *
   * Supports:
   *   - HTTPS/HTTP: https://host/owner/repo.git
   *   - SSH:        git@host:owner/repo.git
   *   - SSH URL:    ssh://git@host/owner/repo.git
   */
  private getHostFromGitUrl(value: string): string | null {
    const trimmed = value.trim();

    // Try standard URL parsing for HTTP(S) and ssh:// URLs
    try {
      const url = new URL(trimmed);
      if (url.hostname) {
        return url.hostname.toLowerCase();
      }
    } catch {
      // Fall through to manual parsing for scp-like SSH syntax
    }

    // Match scp-like SSH syntax: [user@]host:owner/repo.git
    // Examples:
    //   git@github.com:owner/repo.git
    //   git@gitlab.example.com:owner/repo.git
    const sshLikeMatch = trimmed.match(/^[^@]+@([^:]+):.+$/);
    if (sshLikeMatch && sshLikeMatch[1]) {
      return sshLikeMatch[1].toLowerCase();
    }

    return null;
  }

  private isGitHubUrl(value: string): boolean {
    const host = this.getHostFromGitUrl(value);
    if (host) {
      // Accept github.com and common www-prefixed variant.
      return host === 'github.com' || host === 'www.github.com';
    }

    // Fallback for non-standard patterns like "github.com:owner/repo"
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('github.com:') || normalized.startsWith('ssh://github.com/');
  }

  private isGitLabUrl(value: string): boolean {
    const host = this.getHostFromGitUrl(value);
    if (host) {
      // Hosted GitLab
      if (host === 'gitlab.com' || host === 'www.gitlab.com') {
        return true;
      }
      // Self-hosted GitLab: many instances include "gitlab" in the hostname.
      if (host.includes('gitlab')) {
        return true;
      }
    }

    // Fallback for non-standard patterns like "gitlab.com:owner/repo"
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('gitlab.com:') || normalized.startsWith('ssh://gitlab.com/');
  }

  private isGiteaForgejoUrl(value: string): boolean {
    const host = this.getHostFromGitUrl(value);
    if (host) {
      if (host.includes('gitea') || host.includes('forgejo')) {
        return true;
      }
    }

    // Fallback: if we cannot parse a host, fall back to substring detection.
    const normalized = value.trim().toLowerCase();
    return normalized.includes('gitea') || normalized.includes('forgejo');
  }

  private detectProviderFromValue(value: string): GitProvider {
    if (this.isGitHubUrl(value)) {
      return 'github';
    }
    if (this.isGitLabUrl(value)) {
      return 'gitlab';
    }
    if (this.isGiteaForgejoUrl(value)) {
      return 'gitea-forgejo';
    }
    return 'unknown';
  }

  private getProviderLabel(provider: GitProvider): string {
    if (provider === 'github') return 'GitHub';
    if (provider === 'gitlab') return 'GitLab';
    if (provider === 'gitea-forgejo') return 'Gitea/Forgejo';
    return 'Unknown';
  }

  private async detectProviderFromRemotes(git: ReturnType<typeof simpleGit>): Promise<GitProvider> {
    try {
      const remotes = await git.getRemotes(true);
      const urls = remotes.flatMap((remote) => [remote.refs.fetch || '', remote.refs.push || '']);
      for (const url of urls) {
        const provider = this.detectProviderFromValue(url);
        if (provider !== 'unknown') {
          return provider;
        }
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async detectProvider(git: ReturnType<typeof simpleGit>, message: string): Promise<GitProvider> {
    const byMessage = this.detectProviderFromValue(message);
    if (byMessage !== 'unknown') {
      return byMessage;
    }
    return this.detectProviderFromRemotes(git);
  }

  private isAuthError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('authentication failed')
      || normalized.includes('could not read username')
      || normalized.includes('could not resolve host') === false && normalized.includes('permission denied (publickey)')
      || normalized.includes('terminal prompts disabled')
      || normalized.includes('credential') && normalized.includes('denied')
    );
  }

  private isConflictError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('conflict') || normalized.includes('non-fast-forward') || normalized.includes('rejected');
  }

  private isNetworkError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('timed out')
      || normalized.includes('could not resolve host')
      || normalized.includes('connection reset')
      || normalized.includes('network')
      || normalized.includes('unable to access')
    );
  }

  private isNoUpstreamError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('no upstream branch') || normalized.includes('has no upstream branch');
  }

  private isSpawnBadFileDescriptorError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('spawn ebadf');
  }

  private runGitCli(projectPath: string, args: string[], allowRetry = true): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: projectPath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GCM_INTERACTIVE: 'never',
            GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
          },
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }

          const composedMessage = [stderr?.toString().trim(), error.message]
            .filter((part) => Boolean(part))
            .join(' | ');

          if (allowRetry && this.isSpawnBadFileDescriptorError(composedMessage)) {
            this.runGitCli(projectPath, args, false).then(resolve).catch(reject);
            return;
          }

          reject(new Error(composedMessage || 'Git command failed.'));
        },
      );
    });
  }

  private parseGitLogCliOutput(raw: string): Array<{ hash: string; date: string; message: string; author_name: string }> {
    return raw
      .split('\x1e')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const [hash, date, message, author] = entry.split('\x1f');
        return {
          hash: hash || '',
          date: date || '',
          message: message || '',
          author_name: author || '',
        };
      })
      .filter((entry) => entry.hash.length > 0);
  }

  private parsePorcelainStatus(raw: string): GitStatusDto {
    const records = raw.split('\0').filter((record) => record.length > 0);
    const files: GitStatusFile[] = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const x = record[0] ?? ' ';
      const y = record[1] ?? ' ';
      const pathValue = record.slice(3);

      if (x === '?' && y === '?') {
        files.push({ path: pathValue, status: 'untracked' });
        continue;
      }

      if (x === 'R' || y === 'R') {
        const previousPath = pathValue;
        const renamedTo = records[index + 1] ?? pathValue;
        files.push({ path: renamedTo, status: 'renamed', previousPath });
        index += 1;
        continue;
      }

      if (x === 'D' || y === 'D') {
        files.push({ path: pathValue, status: 'deleted' });
        continue;
      }

      if (y === 'M' || y === 'A' || y === 'T') {
        files.push({ path: pathValue, status: 'modified' });
        continue;
      }

      if (x !== ' ') {
        files.push({ path: pathValue, status: 'staged' });
      }
    }

    const counts: GitStatusCounts = {
      untracked: files.filter((file) => file.status === 'untracked').length,
      modified: files.filter((file) => file.status === 'modified').length,
      deleted: files.filter((file) => file.status === 'deleted').length,
      renamed: files.filter((file) => file.status === 'renamed').length,
      staged: files.filter((file) => file.status === 'staged').length,
      total: files.length,
    };

    return { files, counts };
  }

  private normalizeRepoRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  private isPostsMarkdownPath(value: string): boolean {
    const normalized = this.normalizeRepoRelativePath(value);
    if (!normalized.startsWith('posts/')) {
      return false;
    }

    const extension = path.extname(normalized).toLowerCase();
    return this.markdownExtensions.has(extension);
  }

  private parseNameStatusOutput(raw: string): GitPostFileChange[] {
    const tokens = raw.split('\0').filter((token) => token.length > 0);
    const changes: GitPostFileChange[] = [];

    let index = 0;
    while (index < tokens.length) {
      const statusToken = tokens[index++] ?? '';
      if (!statusToken) {
        continue;
      }

      if (statusToken.startsWith('R')) {
        const previousPathRaw = tokens[index++] ?? '';
        const nextPathRaw = tokens[index++] ?? '';
        const previousPath = this.normalizeRepoRelativePath(previousPathRaw);
        const pathValue = this.normalizeRepoRelativePath(nextPathRaw);

        if (this.isPostsMarkdownPath(previousPath) || this.isPostsMarkdownPath(pathValue)) {
          changes.push({
            status: 'renamed',
            path: pathValue,
            previousPath,
          });
        }
        continue;
      }

      const filePathRaw = tokens[index++] ?? '';
      const filePath = this.normalizeRepoRelativePath(filePathRaw);
      if (!this.isPostsMarkdownPath(filePath)) {
        continue;
      }

      const statusCode = statusToken[0] ?? '';
      if (statusCode === 'A') {
        changes.push({ status: 'added', path: filePath });
      } else if (statusCode === 'M') {
        changes.push({ status: 'modified', path: filePath });
      } else if (statusCode === 'D') {
        changes.push({ status: 'deleted', path: filePath });
      }
    }

    return changes;
  }

  private async getStatusViaCli(projectPath: string): Promise<GitStatusDto> {
    const raw = await this.runGitCli(projectPath, ['status', '--porcelain=v1', '-z']);
    return this.parsePorcelainStatus(raw);
  }

  private async getRepoStateViaCli(projectPath: string): Promise<RepoState> {
    try {
      const isInsideRaw = await this.runGitCli(projectPath, ['rev-parse', '--is-inside-work-tree']);
      if (isInsideRaw.trim() !== 'true') {
        return { isRepo: false, hasRemote: false };
      }
    } catch {
      return { isRepo: false, hasRemote: false };
    }

    const rootPath = (await this.runGitCli(projectPath, ['rev-parse', '--show-toplevel'])).trim();

    let currentBranch: string | undefined;
    try {
      const branch = (await this.runGitCli(projectPath, ['symbolic-ref', '--short', 'HEAD'])).trim();
      currentBranch = branch || undefined;
    } catch {
      currentBranch = undefined;
    }

    let hasRemote = false;
    try {
      const upstream = (await this.runGitCli(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim();
      hasRemote = upstream.length > 0;
    } catch {
      hasRemote = false;
    }

    return {
      isRepo: true,
      rootPath,
      currentBranch,
      hasRemote,
    };
  }

  private async getRemoteStateViaCli(projectPath: string): Promise<GitRemoteStateDto> {
    let localBranch: string | null = null;
    try {
      localBranch = (await this.runGitCli(projectPath, ['symbolic-ref', '--short', 'HEAD'])).trim() || null;
    } catch {
      localBranch = null;
    }

    let upstreamBranch: string | null = null;
    try {
      upstreamBranch = (await this.runGitCli(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim() || null;
    } catch {
      upstreamBranch = null;
    }

    if (!upstreamBranch) {
      return {
        localBranch,
        upstreamBranch: null,
        hasUpstream: false,
        ahead: 0,
        behind: 0,
      };
    }

    let ahead = 0;
    let behind = 0;

    try {
      ahead = Number((await this.runGitCli(projectPath, ['rev-list', '--count', `${upstreamBranch}..HEAD`])).trim() || 0);
    } catch {
      ahead = 0;
    }

    try {
      behind = Number((await this.runGitCli(projectPath, ['rev-list', '--count', `HEAD..${upstreamBranch}`])).trim() || 0);
    } catch {
      behind = 0;
    }

    return {
      localBranch,
      upstreamBranch,
      hasUpstream: true,
      ahead,
      behind,
    };
  }

  private async getHistoryViaCli(projectPath: string, limit: number): Promise<GitHistoryEntry[]> {
    const format = '%H%x1f%aI%x1f%s%x1f%aN%x1e';
    const localRaw = await this.runGitCli(projectPath, ['log', `--pretty=format:${format}`, '--max-count', String(limit)]);
    const localCommits = this.parseGitLogCliOutput(localRaw);

    const mapLocalHistory = (): GitHistoryEntry[] => localCommits.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      date: entry.date,
      subject: entry.message,
      author: entry.author_name,
      syncStatus: 'local-only',
    }));

    let upstreamBranch: string | null = null;
    try {
      upstreamBranch = (await this.runGitCli(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim();
    } catch {
      return mapLocalHistory();
    }

    if (!upstreamBranch) {
      return mapLocalHistory();
    }

    let behindCount = 0;
    try {
      behindCount = Number((await this.runGitCli(projectPath, ['rev-list', '--count', `HEAD..${upstreamBranch}`])).trim() || 0);
    } catch {
      behindCount = 0;
    }

    const remoteHistoryLimit = Math.max(limit, limit + Math.max(behindCount, 0));
    let remoteCommits: Array<{ hash: string; date: string; message: string; author_name: string }> = [];

    try {
      const remoteRaw = await this.runGitCli(projectPath, ['log', `--pretty=format:${format}`, '--max-count', String(remoteHistoryLimit), upstreamBranch]);
      remoteCommits = this.parseGitLogCliOutput(remoteRaw);
    } catch {
      return mapLocalHistory();
    }

    const localMap = new Map(localCommits.map((entry) => [entry.hash, entry]));
    const remoteMap = new Map(remoteCommits.map((entry) => [entry.hash, entry]));

    const combined = new Map<string, { hash: string; date: string; message: string; author_name: string }>();
    for (const entry of localMap.values()) {
      combined.set(entry.hash, entry);
    }
    for (const entry of remoteMap.values()) {
      if (!combined.has(entry.hash)) {
        combined.set(entry.hash, entry);
      }
    }

    const classifiedEntries = Array.from(combined.values())
      .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
      .map((entry) => {
        const inLocal = localMap.has(entry.hash);
        const inRemote = remoteMap.has(entry.hash);
        const syncStatus: GitHistorySyncStatus = inLocal && inRemote ? 'both' : inLocal ? 'local-only' : 'remote-only';

        return {
          hash: entry.hash,
          shortHash: entry.hash.slice(0, 7),
          date: entry.date,
          subject: entry.message,
          author: entry.author_name,
          syncStatus,
        };
      });

    const remoteOnlyEntries = classifiedEntries.filter((entry) => entry.syncStatus === 'remote-only');
    const localAndSyncedEntries = classifiedEntries.filter((entry) => entry.syncStatus !== 'remote-only').slice(0, limit);

    return [...localAndSyncedEntries, ...remoteOnlyEntries]
      .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());
  }

  private async getCurrentBranchName(git: ReturnType<typeof simpleGit>): Promise<string | null> {
    try {
      const status = await git.status();
      const branch = typeof status.current === 'string' ? status.current.trim() : '';
      return branch || null;
    } catch {
      return null;
    }
  }

  private async toActionFailure(git: ReturnType<typeof simpleGit>, error: unknown, fallback: string): Promise<GitActionResult> {
    const message = error instanceof Error ? error.message : fallback;

    if (this.isAuthError(message)) {
      const provider = await this.detectProvider(git, message);
      const providerText = provider === 'unknown' ? '' : ` Detected provider: ${this.getProviderLabel(provider)}.`;
      const providerGuidance =
        provider === 'github'
          ? this.getGitHubGuidanceSteps()
          : provider === 'gitlab'
            ? this.getGitLabGuidanceSteps()
            : provider === 'gitea-forgejo'
              ? this.getGiteaForgejoGuidanceSteps()
              : this.getGenericTokenGuidanceSteps();

      return {
        success: false,
        code: 'auth-required',
        error: `Authentication required for remote Git action.${providerText} Follow the steps below to sign in.`,
        guidance: [
          ...this.getPlatformAuthGuidanceSteps(),
          ...providerGuidance,
        ],
      };
    }

    if (this.isConflictError(message)) {
      return {
        success: false,
        code: 'conflict',
        error: message,
      };
    }

    if (this.isNetworkError(message)) {
      return {
        success: false,
        code: 'network',
        error: message,
      };
    }

    return {
      success: false,
      code: 'action-failed',
      error: message,
    };
  }

  private async readLfsTrackedPatterns(projectPath: string): Promise<Set<string>> {
    try {
      const attributesPath = path.join(projectPath, '.gitattributes');
      const content = await fsPromises.readFile(attributesPath, 'utf8');
      const patterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('filter=lfs'))
        .map((line) => line.split(/\s+/)[0])
        .filter(Boolean);
      return new Set(patterns);
    } catch {
      return new Set<string>();
    }
  }

  private async hasHeadCommit(git: ReturnType<typeof simpleGit>): Promise<boolean> {
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  private async isLfsConfigured(git: ReturnType<typeof simpleGit>): Promise<boolean> {
    try {
      const output = await git.raw(['config', '--local', '--get', 'filter.lfs.clean']);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async existingStageTargets(projectPath: string): Promise<string[]> {
    const targets = ['posts', 'media', 'meta', 'thumbnails', '.gitattributes', '.gitignore'];
    const existing: string[] = [];

    for (const target of targets) {
      try {
        await fsPromises.stat(path.join(projectPath, target));
        existing.push(target);
      } catch {
        continue;
      }
    }

    return existing;
  }

  async checkAvailability(): Promise<GitAvailability> {
    try {
      const versionResult = await this.createNonInteractiveGit().version();
      return {
        gitFound: true,
        version: `${versionResult.major}.${versionResult.minor}.${versionResult.patch}`,
      };
    } catch {
      return { gitFound: false };
    }
  }

  async getRepoState(projectPath: string): Promise<RepoState> {
    const git = this.createNonInteractiveGit(projectPath);
    let isRepo;
    try {
      isRepo = await git.checkIsRepo();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getRepoStateViaCli(projectPath);
      }
      throw error;
    }

    if (!isRepo) {
      return {
        isRepo: false,
        hasRemote: false,
      };
    }

    let rootPath;
    let status;
    try {
      [rootPath, status] = await Promise.all([
        git.revparse(['--show-toplevel']),
        git.status(),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getRepoStateViaCli(projectPath);
      }
      throw error;
    }

    return {
      isRepo: true,
      rootPath: rootPath.trim(),
      currentBranch: status.current ?? undefined,
      hasRemote: Boolean(status.tracking),
    };
  }

  async getStatus(projectPath: string): Promise<GitStatusDto> {
    const git = this.createNonInteractiveGit(projectPath);
    let status;
    try {
      status = await git.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getStatusViaCli(projectPath);
      }
      throw error;
    }

    const files: GitStatusFile[] = [
      ...status.not_added.map((filePath) => ({ path: filePath, status: 'untracked' as const })),
      ...status.modified.map((filePath) => ({ path: filePath, status: 'modified' as const })),
      ...status.deleted.map((filePath) => ({ path: filePath, status: 'deleted' as const })),
      ...status.renamed.map((renamed) => ({
        path: renamed.to,
        status: 'renamed' as const,
        previousPath: renamed.from,
      })),
      ...status.created.map((filePath) => ({ path: filePath, status: 'staged' as const })),
    ];

    const counts: GitStatusCounts = {
      untracked: status.not_added.length,
      modified: status.modified.length,
      deleted: status.deleted.length,
      renamed: status.renamed.length,
      staged: status.created.length,
      total: files.length,
    };

    return {
      files,
      counts,
    };
  }

  async getDiff(projectPath: string, filePath: string): Promise<GitDiffDto> {
    const git = this.createNonInteractiveGit(projectPath);
    let patch;
    try {
      patch = await git.diff(['--', filePath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        patch = await this.runGitCli(projectPath, ['diff', '--', filePath]);
      } else {
        throw error;
      }
    }

    return {
      filePath,
      patch,
    };
  }

  async getDiffContent(projectPath: string, filePath: string): Promise<GitDiffContentDto> {
    const git = this.createNonInteractiveGit(projectPath);

    const [original, modified] = await Promise.all([
      git.show([`HEAD:${filePath}`]).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error ?? '');
        if (this.isSpawnBadFileDescriptorError(message)) {
          try {
            return await this.runGitCli(projectPath, ['show', `HEAD:${filePath}`]);
          } catch {
            return '';
          }
        }
        return '';
      }),
      fsPromises.readFile(path.join(projectPath, filePath), 'utf8').catch(() => ''),
    ]);

    return {
      filePath,
      original,
      modified,
    };
  }

  async getCommitDiffContent(projectPath: string, commitHash: string): Promise<GitCommitDiffContentDto> {
    const git = this.createNonInteractiveGit(projectPath);
    let patch;
    try {
      patch = await git.show(['--format=', '--patch', commitHash]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        patch = await this.runGitCli(projectPath, ['show', '--format=', '--patch', commitHash]);
      } else {
        throw error;
      }
    }
    const files = this.parseUnifiedPatchFiles(patch);

    if (files.length === 0) {
      return {
        commitHash,
        original: '',
        modified: patch,
        files: [],
      };
    }

    const firstFile = files[0];

    return {
      commitHash,
      original: firstFile.original,
      modified: firstFile.modified,
      files,
    };
  }

  private parseUnifiedPatchFiles(patch: string): GitCommitDiffFileDto[] {
    interface FileDiffBuffers {
      path: string;
      original: string[];
      modified: string[];
      inHunk: boolean;
      touched: boolean;
    }

    const lines = patch.split('\n');
    const files: FileDiffBuffers[] = [];
    let currentFile: FileDiffBuffers | null = null;

    const flushCurrent = () => {
      if (!currentFile) {
        return;
      }

      if (currentFile.touched || currentFile.original.length > 0 || currentFile.modified.length > 0) {
        files.push(currentFile);
      }

      currentFile = null;
    };

    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        flushCurrent();

        const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        const filePath = match ? match[2] : line;
        currentFile = {
          path: filePath,
          original: [],
          modified: [],
          inHunk: false,
          touched: false,
        };
        continue;
      }

      if (!currentFile) {
        continue;
      }

      if (line.startsWith('@@')) {
        currentFile.inHunk = true;
        continue;
      }

      if (line.startsWith('Binary files ')) {
        currentFile.original.push(line);
        currentFile.modified.push(line);
        currentFile.touched = true;
        continue;
      }

      if (!currentFile.inHunk) {
        continue;
      }

      if (line.startsWith('\\ No newline at end of file')) {
        continue;
      }

      if (line.startsWith('+')) {
        currentFile.modified.push(line.slice(1));
        currentFile.touched = true;
        continue;
      }

      if (line.startsWith('-')) {
        currentFile.original.push(line.slice(1));
        currentFile.touched = true;
        continue;
      }

      if (line.startsWith(' ')) {
        const contextLine = line.slice(1);
        currentFile.original.push(contextLine);
        currentFile.modified.push(contextLine);
        currentFile.touched = true;
        continue;
      }

      currentFile.original.push(line);
      currentFile.modified.push(line);
      currentFile.touched = true;
    }

    flushCurrent();

    return files.map((file) => ({
      filePath: file.path,
      original: file.original.join('\n'),
      modified: file.modified.join('\n'),
    }));
  }

  async getHistory(projectPath: string, limit = 20): Promise<GitHistoryEntry[]> {
    const git = this.createNonInteractiveGit(projectPath);
    let status;
    try {
      status = await git.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getHistoryViaCli(projectPath, limit);
      }
      throw error;
    }

    let localHistory;
    try {
      localHistory = await git.log({ maxCount: limit });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getHistoryViaCli(projectPath, limit);
      }
      throw error;
    }

    const mapLocalHistory = (): GitHistoryEntry[] => localHistory.all.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      date: entry.date,
      subject: entry.message,
      author: entry.author_name,
      syncStatus: 'local-only',
    }));

    if (!status.tracking) {
      return mapLocalHistory();
    }

    const behindCount = typeof status.behind === 'number' ? status.behind : Number(status.behind ?? 0);
    const remoteHistoryLimit = Math.max(limit, limit + Math.max(behindCount, 0));
    let remoteHistory;

    try {
      remoteHistory = await git.log([status.tracking, '--max-count', String(remoteHistoryLimit)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return mapLocalHistory();
      }
      throw error;
    }

    type CommitLike = {
      hash: string;
      date: string;
      message: string;
      author_name: string;
    };

    const localMap = new Map<string, CommitLike>();
    const remoteMap = new Map<string, CommitLike>();

    for (const entry of localHistory.all) {
      localMap.set(entry.hash, entry);
    }

    for (const entry of remoteHistory.all) {
      remoteMap.set(entry.hash, entry);
    }

    const combined = new Map<string, CommitLike>();
    for (const entry of localMap.values()) {
      combined.set(entry.hash, entry);
    }
    for (const entry of remoteMap.values()) {
      if (!combined.has(entry.hash)) {
        combined.set(entry.hash, entry);
      }
    }

    const classifiedEntries = Array.from(combined.values())
      .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
      .map((entry) => {
        const inLocal = localMap.has(entry.hash);
        const inRemote = remoteMap.has(entry.hash);
        const syncStatus: GitHistorySyncStatus = inLocal && inRemote ? 'both' : inLocal ? 'local-only' : 'remote-only';

        return {
          hash: entry.hash,
          shortHash: entry.hash.slice(0, 7),
          date: entry.date,
          subject: entry.message,
          author: entry.author_name,
          syncStatus,
        };
      });

    const remoteOnlyEntries = classifiedEntries.filter((entry) => entry.syncStatus === 'remote-only');
    const localAndSyncedEntries = classifiedEntries.filter((entry) => entry.syncStatus !== 'remote-only').slice(0, limit);

    return [...localAndSyncedEntries, ...remoteOnlyEntries]
      .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());
  }

  async getFileHistory(projectPath: string, filePath: string, limit = 50): Promise<GitHistoryEntry[]> {
    const git = this.createNonInteractiveGit(projectPath);
    let history;
    try {
      history = await git.log(['--max-count', String(limit), '--', filePath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        const format = '%H%x1f%aI%x1f%s%x1f%aN%x1e';
        const raw = await this.runGitCli(projectPath, ['log', `--pretty=format:${format}`, '--max-count', String(limit), '--', filePath]);
        const cliEntries = this.parseGitLogCliOutput(raw);
        return cliEntries.map((entry) => ({
          hash: entry.hash,
          shortHash: entry.hash.slice(0, 7),
          date: entry.date,
          subject: entry.message,
          author: entry.author_name,
        }));
      }
      throw error;
    }

    return history.all.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      date: entry.date,
      subject: entry.message,
      author: entry.author_name,
    }));
  }

  async getRemoteState(projectPath: string): Promise<GitRemoteStateDto> {
    const git = this.createNonInteractiveGit(projectPath);
    let status;
    try {
      status = await git.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        return this.getRemoteStateViaCli(projectPath);
      }
      throw error;
    }

    const localBranch = typeof status.current === 'string' && status.current.trim().length > 0
      ? status.current
      : null;
    const upstreamBranch = typeof status.tracking === 'string' && status.tracking.trim().length > 0
      ? status.tracking
      : null;

    return {
      localBranch,
      upstreamBranch,
      hasUpstream: Boolean(upstreamBranch),
      ahead: typeof status.ahead === 'number' ? status.ahead : Number(status.ahead ?? 0),
      behind: typeof status.behind === 'number' ? status.behind : Number(status.behind ?? 0),
    };
  }

  async fetch(projectPath: string): Promise<GitActionResult> {
    const git = this.createNonInteractiveGit(projectPath);
    try {
      await git.fetch(['--prune']);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        try {
          await this.runGitCli(projectPath, ['fetch', '--prune']);
          return { success: true };
        } catch {
          // continue to action failure mapping below
        }
      }
      return this.toActionFailure(git, error, 'Failed to fetch remote updates.');
    }
  }

  async getHeadCommit(projectPath: string): Promise<string | null> {
    const git = this.createNonInteractiveGit(projectPath);
    try {
      const output = await git.raw(['rev-parse', 'HEAD']);
      const commit = output.trim();
      return commit.length > 0 ? commit : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        try {
          const output = await this.runGitCli(projectPath, ['rev-parse', 'HEAD']);
          const commit = output.trim();
          return commit.length > 0 ? commit : null;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async getChangedPostFilesBetween(projectPath: string, fromCommit: string, toCommit: string): Promise<GitPostFileChange[]> {
    const fromRef = fromCommit.trim();
    const toRef = toCommit.trim();
    if (!fromRef || !toRef || fromRef === toRef) {
      return [];
    }

    const git = this.createNonInteractiveGit(projectPath);
    const args = ['diff', '--name-status', '--find-renames', '-z', `${fromRef}..${toRef}`, '--', 'posts'];

    try {
      const output = await git.raw(args);
      return this.parseNameStatusOutput(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        try {
          const output = await this.runGitCli(projectPath, args);
          return this.parseNameStatusOutput(output);
        } catch {
          return [];
        }
      }
      return [];
    }
  }

  async pull(projectPath: string): Promise<GitActionResult> {
    const git = this.createNonInteractiveGit(projectPath);
    try {
      await git.pull();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.isSpawnBadFileDescriptorError(message)) {
        try {
          await this.runGitCli(projectPath, ['pull']);
          return { success: true };
        } catch {
          // continue to action failure mapping below
        }
      }
      return this.toActionFailure(git, error, 'Failed to pull remote changes.');
    }
  }

  async push(projectPath: string): Promise<GitActionResult> {
    const git = this.createNonInteractiveGit(projectPath);
    try {
      await git.push();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push local commits.';
      if (this.isSpawnBadFileDescriptorError(message)) {
        try {
          await this.runGitCli(projectPath, ['push']);
          return { success: true };
        } catch {
          // continue with existing upstream handling below
        }
      }
      if (this.isNoUpstreamError(message)) {
        const currentBranch = await this.getCurrentBranchName(git);
        if (currentBranch) {
          try {
            await git.push(['-u', 'origin', currentBranch]);
            return { success: true };
          } catch (retryError) {
            return this.toActionFailure(git, retryError, 'Failed to push local commits.');
          }
        }
      }
      return this.toActionFailure(git, error, 'Failed to push local commits.');
    }
  }

  async commitAll(projectPath: string, message: string): Promise<GitActionResult> {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return {
        success: false,
        error: 'Commit message is required.',
      };
    }

    const git = this.createNonInteractiveGit(projectPath);
    try {
      await git.add(['-A']);
      await git.commit(normalizedMessage);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create commit.';
      if (this.isSpawnBadFileDescriptorError(errorMessage)) {
        try {
          await this.runGitCli(projectPath, ['add', '-A']);
          await this.runGitCli(projectPath, ['commit', '-m', normalizedMessage]);
          return { success: true };
        } catch (cliError) {
          return {
            success: false,
            error: cliError instanceof Error ? cliError.message : 'Failed to create commit.',
          };
        }
      }
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async ensureGitignore(projectPath: string): Promise<GitIgnoreEnsureResult> {
    const gitignorePath = path.join(projectPath, '.gitignore');

    let existingContent = '';
    let created = false;

    try {
      existingContent = await fsPromises.readFile(gitignorePath, 'utf8');
    } catch {
      created = true;
    }

    const existingEntries = new Set(
      existingContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    );

    const addedEntries = this.defaultGitignoreEntries.filter((entry) => !existingEntries.has(entry));

    if (addedEntries.length === 0) {
      return {
        updated: false,
        created: false,
        addedEntries: [],
      };
    }

    const sections: string[] = [];
    if (existingContent.trim().length > 0) {
      sections.push(existingContent.trimEnd());
    }

    sections.push('# System metadata');
    sections.push(...addedEntries);

    await fsPromises.writeFile(gitignorePath, `${sections.join('\n')}\n`, 'utf8');

    return {
      updated: true,
      created,
      addedEntries,
    };
  }

  async pruneLfsCache(projectPath: string, options: GitLfsPruneOptions = {}): Promise<GitLfsPruneResult> {
    const git = this.createNonInteractiveGit(projectPath);
    const verifyRemote = options.verifyRemote ?? true;
    const dryRun = options.dryRun ?? false;
    const recentCommitsToKeep = Math.max(0, options.recentCommitsToKeep ?? 2);

    let recentCommitDays = 0;
    if (recentCommitsToKeep > 0) {
      const history = await git.log({ maxCount: recentCommitsToKeep });
      if (history.all.length > 0) {
        const oldestProtected = history.all[history.all.length - 1];
        const oldestProtectedTimestamp = new Date(oldestProtected.date).getTime();
        if (!Number.isNaN(oldestProtectedTimestamp)) {
          const msPerDay = 24 * 60 * 60 * 1000;
          const ageInDays = Math.ceil(Math.max(0, Date.now() - oldestProtectedTimestamp) / msPerDay);
          recentCommitDays = ageInDays;
        }
      }
    }

    const args = [
      '-c',
      `lfs.fetchrecentcommitsdays=${recentCommitDays}`,
      '-c',
      'lfs.fetchrecentrefsdays=0',
      '-c',
      'lfs.pruneoffsetdays=0',
      'lfs',
      'prune',
    ];
    if (verifyRemote) {
      args.push('--verify-remote');
    }
    if (dryRun) {
      args.push('--dry-run');
    }

    try {
      let output;
      try {
        output = await git.raw(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        if (this.isSpawnBadFileDescriptorError(message)) {
          output = await this.runGitCli(projectPath, args);
        } else {
          throw error;
        }
      }
      return {
        success: true,
        dryRun,
        verifyRemote,
        recentCommitsToKeep,
        output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to prune Git LFS cache.';
      return {
        success: false,
        dryRun,
        verifyRemote,
        recentCommitsToKeep,
        error: message,
      };
    }
  }

  async initializeRepo(
    projectPath: string,
    remoteUrl?: string,
    onProgress?: (progress: GitInitProgress) => void,
  ): Promise<GitInitResult> {
    const emitProgress = (phase: GitInitPhase, progress: number, message: string, detail?: string): void => {
      onProgress?.({ phase, progress, message, detail });
    };

    emitProgress('checking-git', 5, 'Checking Git availability...');
    const availability = await this.checkAvailability();
    if (!availability.gitFound) {
      emitProgress('failed', 100, 'Git executable not found. Please install Git and restart the app.');
      return {
        success: false,
        code: 'git-missing',
        error: 'Git executable not found. Please install Git and restart the app.',
      };
    }

    const git = this.createNonInteractiveGit(projectPath);
    const isRepo = await git.checkIsRepo();

    if (isRepo) {
      emitProgress('initializing-repo', 15, 'Initializing repository...', 'already initialized');
    } else {
      emitProgress('initializing-repo', 15, 'Initializing repository...');
      try {
        await git.init();
      } catch {
        emitProgress('failed', 100, 'Failed to initialize repository for this project.');
        return {
          success: false,
          code: 'init-failed',
          error: 'Failed to initialize repository for this project.',
        };
      }
    }

    const lfsConfigured = await this.isLfsConfigured(git);
    if (lfsConfigured) {
      emitProgress('configuring-lfs', 30, 'Configuring Git LFS...', 'already configured');
    } else {
      emitProgress('configuring-lfs', 30, 'Configuring Git LFS...');
      try {
        await git.raw(['lfs', 'install', '--local']);
      } catch {
        emitProgress('failed', 100, 'Git LFS executable not found. Please install Git LFS and try again.');
        return {
          success: false,
          code: 'git-lfs-missing',
          error: 'Git LFS executable not found. Please install Git LFS and try again.',
        };
      }
    }

    const imagePatterns = [
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.jpe',
      '*.jfif',
      '*.gif',
      '*.webp',
      '*.svg',
      '*.avif',
      '*.heic',
      '*.heif',
      '*.bmp',
      '*.tif',
      '*.tiff',
      '*.ico',
      '*.jxl',
    ];
    const trackedPatterns = await this.readLfsTrackedPatterns(projectPath);
    const patternsToTrack = imagePatterns.filter((pattern) => !trackedPatterns.has(pattern));

    if (patternsToTrack.length === 0) {
      emitProgress('tracking-lfs-patterns', 55, 'Tracking image patterns with Git LFS...', 'already tracked');
    } else {
      for (let index = 0; index < patternsToTrack.length; index += 1) {
        const pattern = patternsToTrack[index];
        const progress = 35 + Math.round((index / patternsToTrack.length) * 20);
        emitProgress('tracking-lfs-patterns', progress, 'Tracking image patterns with Git LFS...', pattern);
        await git.raw(['lfs', 'track', pattern]);
      }
    }

    await this.ensureGitignore(projectPath);

    const stageTargets = await this.existingStageTargets(projectPath);
    if (stageTargets.length === 0) {
      emitProgress('staging-files', 75, 'Staging project files...', 'no target files found');
    } else {
      emitProgress('staging-files', 75, 'Staging project files...', stageTargets.join(', '));
      await git.add(stageTargets);
      await git.add(['--renormalize', ...stageTargets]);
    }

    const hasCommit = await this.hasHeadCommit(git);
    if (hasCommit) {
      emitProgress('creating-initial-commit', 90, 'Creating initial commit...', 'already has commits');
    } else {
      emitProgress('creating-initial-commit', 90, 'Creating initial commit...');
      try {
        await git.commit('initial commit');
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('nothing to commit')) {
          emitProgress('creating-initial-commit', 90, 'Creating initial commit...', 'nothing to commit');
        } else {
          emitProgress('failed', 100, 'Failed to create initial commit.');
          return {
            success: false,
            code: 'commit-failed',
            error: 'Failed to create initial commit.',
          };
        }
      }
    }

    const normalizedRemoteUrl = remoteUrl?.trim();
    try {
      await git.raw(['config', '--local', 'push.autoSetupRemote', 'true']);
    } catch {
      emitProgress('configuring-remote', 96, 'Configuring remote repository...', 'unable to set auto upstream');
    }

    if (normalizedRemoteUrl) {
      emitProgress('configuring-remote', 96, 'Configuring remote repository...');
      try {
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((remote) => remote.name === 'origin');

        if (origin) {
          const fetchUrl = origin.refs.fetch || '';
          const pushUrl = origin.refs.push || '';
          const alreadyMatching = fetchUrl === normalizedRemoteUrl && (pushUrl === normalizedRemoteUrl || pushUrl === '');

          if (alreadyMatching) {
            emitProgress('configuring-remote', 96, 'Configuring remote repository...', 'already up to date');
          } else {
            await git.remote(['set-url', 'origin', normalizedRemoteUrl]);
            emitProgress('configuring-remote', 96, 'Configuring remote repository...', 'updated origin URL');
          }
        } else {
          await git.addRemote('origin', normalizedRemoteUrl);
          emitProgress('configuring-remote', 96, 'Configuring remote repository...', 'created origin remote');
        }
      } catch {
        emitProgress('failed', 100, 'Failed to configure remote repository.');
        return {
          success: false,
          code: 'remote-failed',
          error: 'Failed to configure remote repository.',
        };
      }
    } else {
      emitProgress('configuring-remote', 96, 'Configuring remote repository...', 'not provided');
    }

    emitProgress('completed', 100, 'Repository initialized successfully.');
    return { success: true };
  }
}
