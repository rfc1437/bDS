import { simpleGit } from 'simple-git';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

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

let gitEngineInstance: GitEngine | null = null;

export function getGitEngine(): GitEngine {
  if (!gitEngineInstance) {
    gitEngineInstance = new GitEngine();
  }
  return gitEngineInstance;
}

export class GitEngine {
  private readonly defaultGitignoreEntries = [
    '.DS_Store',
    'Thumbs.db',
    'Desktop.ini',
    '$RECYCLE.BIN/',
    '.Spotlight-V100/',
    '.Trashes/',
    '._*',
    '.fseventsd',
  ];

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
    const targets = ['posts', 'media', 'meta', '.gitattributes'];
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
      const versionResult = await simpleGit().version();
      return {
        gitFound: true,
        version: `${versionResult.major}.${versionResult.minor}.${versionResult.patch}`,
      };
    } catch {
      return { gitFound: false };
    }
  }

  async getRepoState(projectPath: string): Promise<RepoState> {
    const git = simpleGit(projectPath);
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return {
        isRepo: false,
        hasRemote: false,
      };
    }

    const [rootPath, status] = await Promise.all([
      git.revparse(['--show-toplevel']),
      git.status(),
    ]);

    return {
      isRepo: true,
      rootPath: rootPath.trim(),
      currentBranch: status.current ?? undefined,
      hasRemote: Boolean(status.tracking),
    };
  }

  async getStatus(projectPath: string): Promise<GitStatusDto> {
    const git = simpleGit(projectPath);
    const status = await git.status();

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

    const git = simpleGit(projectPath);
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

    const imagePatterns = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.avif', '*.heic'];
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

    const stageTargets = await this.existingStageTargets(projectPath);
    if (stageTargets.length === 0) {
      emitProgress('staging-files', 75, 'Staging project files...', 'no target files found');
    } else {
      emitProgress('staging-files', 75, 'Staging project files...', stageTargets.join(', '));
      await git.add(stageTargets);
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
