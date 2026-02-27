import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { app } from 'electron';
import { getProjectEngine } from './ProjectEngine';
import { getDatabase } from '../database';

/**
 * Adapter that wraps app-level IPC handler logic for use by the Python API layer.
 * Provides safe, read-only app methods without requiring Electron UI facilities.
 */
export class AppApiAdapter {
  async getDataPaths(): Promise<{ database: string; posts: string; media: string }> {
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = projectEngine.getProjectPaths(projectId, activeProject?.dataPath);
    return {
      database: getDatabase().getDataPaths().database,
      posts: paths.posts,
      media: paths.media,
    };
  }

  async getSystemLanguage(): Promise<string> {
    return app.getLocale();
  }

  async getDefaultProjectPath(projectId: string): Promise<string> {
    return getProjectEngine().getDefaultProjectBaseDir(projectId);
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

let instance: AppApiAdapter | null = null;

export function getAppApiAdapter(): AppApiAdapter {
  if (!instance) {
    instance = new AppApiAdapter();
  }
  return instance;
}
