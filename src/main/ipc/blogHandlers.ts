import { dialog } from 'electron';
import { getPostEngine } from '../engine/PostEngine';
import { getProjectEngine } from '../engine/ProjectEngine';
import { getMetaEngine } from '../engine/MetaEngine';
import { taskManager } from '../engine/TaskManager';
import { getBlogGenerationEngine, resolvePublicBaseUrl } from '../engine/BlogGenerationEngine';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerBlogHandlers(safeHandle: SafeHandle): void {
  safeHandle('blog:generateSitemap', async () => {
    const projectEngine = getProjectEngine();
    const postEngine = getPostEngine();
    const metaEngine = getMetaEngine();
    const blogGenerationEngine = getBlogGenerationEngine();

    const project = await projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    postEngine.setProjectContext(project.id, dataDir);
    metaEngine.setProjectContext(project.id, dataDir);

    if (!metaEngine.isInitialized()) {
      await metaEngine.syncOnStartup();
    }

    const metadata = await metaEngine.getProjectMetadata();
    const baseUrl = resolvePublicBaseUrl(metadata?.publicUrl);
    if (!baseUrl) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Public URL Required',
        message: 'Sitemap generation requires a public URL.',
        detail: 'Set Project → Public URL in Settings before generating a sitemap.',
      });
      throw new Error('Project public URL is not configured');
    }

    const taskId = `sitemap-generate-${Date.now()}`;

    return taskManager.runTask({
      id: taskId,
      name: 'Generate Sitemap',
      execute: async (onProgress) => {
        return blogGenerationEngine.generate({
          projectId: project.id,
          projectName: metadata?.name?.trim() || project.name,
          projectDescription: metadata?.description,
          dataDir,
          baseUrl,
          maxPostsPerPage: metadata?.maxPostsPerPage,
        }, (progress, message) => onProgress(progress, message || ''));
      },
    });
  });
}
