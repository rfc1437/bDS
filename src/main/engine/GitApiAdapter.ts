import type { GitEngine, GitAvailability, RepoState, GitStatusDto, GitHistoryEntry, GitRemoteStateDto, GitActionResult } from './GitEngine';
import type { ProjectEngine } from './ProjectEngine';

export type { GitAvailability, RepoState, GitStatusDto, GitHistoryEntry, GitRemoteStateDto, GitActionResult };

/**
 * Adapter that wraps GitEngine for use by the Python API layer.
 * Auto-resolves projectPath from the active project so Python scripts
 * don't need to pass it.
 */
export class GitApiAdapter {
  constructor(
    private readonly gitEngine: GitEngine,
    private readonly projectEngine: ProjectEngine,
  ) {}

  private async resolveProjectPath(): Promise<string> {
    const project = await this.projectEngine.getActiveProject();
    if (!project?.dataPath) {
      throw new Error('No active project with a data path');
    }
    return project.dataPath;
  }

  async checkAvailability(): Promise<GitAvailability> {
    return this.gitEngine.checkAvailability();
  }

  async getRepoState(): Promise<RepoState> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.getRepoState(projectPath);
  }

  async getStatus(): Promise<GitStatusDto> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.getStatus(projectPath);
  }

  async getHistory(limit?: number): Promise<GitHistoryEntry[]> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.getHistory(projectPath, limit);
  }

  async getRemoteState(): Promise<GitRemoteStateDto> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.getRemoteState(projectPath);
  }

  async fetch(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.fetch(projectPath);
  }

  async pull(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.pull(projectPath);
  }

  async push(): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.push(projectPath);
  }

  async commitAll(message: string): Promise<GitActionResult> {
    const projectPath = await this.resolveProjectPath();
    return this.gitEngine.commitAll(projectPath, message);
  }
}

