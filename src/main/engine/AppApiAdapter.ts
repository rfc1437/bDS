import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { app } from 'electron';
import type { ProjectEngine } from './ProjectEngine';
import { getDatabase } from '../database';

/**
 * Adapter that wraps app-level IPC handler logic for use by the Python API layer.
 * Provides safe, read-only app methods without requiring Electron UI facilities.
 */
export class AppApiAdapter {
  constructor(private readonly projectEngine: ProjectEngine) {}
  async getDataPaths(): Promise<{ database: string; posts: string; media: string }> {
    const activeProject = await this.projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = this.projectEngine.getProjectPaths(projectId, activeProject?.dataPath);
    return {
      database: getDatabase().getDbPath(),
      posts: paths.posts,
      media: paths.media,
    };
  }

  async getSystemLanguage(): Promise<string> {
    return app.getLocale();
  }

  async getDefaultProjectPath(projectId: string): Promise<string> {
    return this.projectEngine.getDefaultProjectBaseDir(projectId);
  }

  async readProjectMetadata(folderPath: string): Promise<{ name?: string; description?: string; publicUrl?: string; mainLanguage?: string } | null> {
    const metaPath = path.join(folderPath, 'meta', 'project.json');
    try {
      const content = await fsPromises.readFile(metaPath, 'utf-8');
      const metadata = JSON.parse(content);
      return {
        name: metadata.name || undefined,
        description: metadata.description || undefined,
        publicUrl: metadata.publicUrl || undefined,
        mainLanguage: metadata.mainLanguage || undefined,
      };
    } catch {
      return null;
    }
  }
}

