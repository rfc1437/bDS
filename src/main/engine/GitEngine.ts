import { simpleGit } from 'simple-git';

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

export interface GitInitResult {
  success: boolean;
  error?: string;
  code?: 'git-missing' | 'git-lfs-missing' | 'init-failed' | 'remote-failed';
}

let gitEngineInstance: GitEngine | null = null;

export function getGitEngine(): GitEngine {
  if (!gitEngineInstance) {
    gitEngineInstance = new GitEngine();
  }
  return gitEngineInstance;
}

export class GitEngine {
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

  async initializeRepo(projectPath: string, remoteUrl?: string): Promise<GitInitResult> {
    const availability = await this.checkAvailability();
    if (!availability.gitFound) {
      return {
        success: false,
        code: 'git-missing',
        error: 'Git executable not found. Please install Git and restart the app.',
      };
    }

    const git = simpleGit(projectPath);

    try {
      await git.init();
    } catch {
      return {
        success: false,
        code: 'init-failed',
        error: 'Failed to initialize repository for this project.',
      };
    }

    try {
      await git.raw(['lfs', 'install', '--local']);
    } catch {
      return {
        success: false,
        code: 'git-lfs-missing',
        error: 'Git LFS executable not found. Please install Git LFS and try again.',
      };
    }

    const imagePatterns = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.avif', '*.heic'];

    for (const pattern of imagePatterns) {
      await git.raw(['lfs', 'track', pattern]);
    }

    await git.add('.gitattributes');

    const normalizedRemoteUrl = remoteUrl?.trim();
    if (normalizedRemoteUrl) {
      try {
        const remotes = await git.getRemotes(true);
        const hasOrigin = remotes.some((remote) => remote.name === 'origin');

        if (hasOrigin) {
          await git.remote(['set-url', 'origin', normalizedRemoteUrl]);
        } else {
          await git.addRemote('origin', normalizedRemoteUrl);
        }
      } catch {
        return {
          success: false,
          code: 'remote-failed',
          error: 'Failed to configure remote repository.',
        };
      }
    }

    return { success: true };
  }
}
