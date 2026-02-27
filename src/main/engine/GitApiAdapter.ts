import { getGitEngine } from './GitEngine';
import { getProjectEngine } from './ProjectEngine';
import type {
  GitAvailability,
  RepoState,
  GitStatusDto,
  GitHistoryEntry,
  GitRemoteStateDto,
  GitActionResult,
} from './GitEngine';

export type { GitAvailability, RepoState, GitStatusDto, GitHistoryEntry, GitRemoteStateDto, GitActionResult };

/**
 * Adapter that wraps GitEngine for use by the Python API layer.
 * Auto-resolves projectPath from the active project so Python scripts
 * don't need to pass it.
 */
export class GitApiAdapter {
  private async resolveProjectPath(): Promise<string> {
    const project = await getProjectEngine().getActiveProject();
    if (!project?.dataPath) {
      throw new Error('No active project with a data path');
    }
    return project.dataPath;
  }

  async checkAvailability(): Promise<GitAvailability> {
    return getGitEngine().checkAvailability();
  }

  async getRepoState(): Promise<RepoState> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().getRepoState(projectPath);
  }

  async getStatus(): Promise<GitStatusDto> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().getStatus(projectPath);
  }

  async getHistory(limit?: number): Promise<GitHistoryEntry[]> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().getHistory(projectPath, limit);
  }

  async getRemoteState(): Promise<GitRemoteStateDto> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().getRemoteState(projectPath);
  }

  async fetch(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().fetch(projectPath);
  }

  async pull(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().pull(projectPath);
  }

  async push(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().push(projectPath);
  }

  async commitAll(message: string): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return getGitEngine().commitAll(projectPath, message);
  }
}

let instance: GitApiAdapter | null = null;

export function getGitApiAdapter(): GitApiAdapter {
  if (!instance) {
    instance = new GitApiAdapter();
  }
  return instance;
}
