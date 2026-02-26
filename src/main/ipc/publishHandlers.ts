import { getProjectEngine } from '../engine/ProjectEngine';
import { getPublishEngine, type PublishCredentials } from '../engine/PublishEngine';
import { taskManager } from '../engine/TaskManager';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerPublishHandlers(safeHandle: SafeHandle): void {
  safeHandle('publish:uploadSite', async (_event: unknown, credentials: PublishCredentials) => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const publishEngine = getPublishEngine();
    publishEngine.setProjectContext(project.id, project.dataPath!);

    const ts = Date.now();
    const groupId = `publish-${ts}`;
    const groupName = 'Site Publishing';

    // Launch three parallel tasks, one per directory
    const htmlTask = taskManager.runTask({
      id: `publish-html-${ts}`,
      name: 'Upload HTML',
      groupId,
      groupName,
      execute: (onProgress) => publishEngine.uploadHtml(credentials, onProgress),
    });

    const thumbsTask = taskManager.runTask({
      id: `publish-thumbnails-${ts}`,
      name: 'Upload Thumbnails',
      groupId,
      groupName,
      execute: (onProgress) => publishEngine.uploadThumbnails(credentials, onProgress),
    });

    const mediaTask = taskManager.runTask({
      id: `publish-media-${ts}`,
      name: 'Upload Media',
      groupId,
      groupName,
      execute: (onProgress) => publishEngine.uploadMedia(credentials, onProgress),
    });

    const [html, thumbnails, media] = await Promise.all([htmlTask, thumbsTask, mediaTask]);

    return {
      htmlFilesUploaded: html.filesUploaded,
      thumbnailFilesUploaded: thumbnails.filesUploaded,
      mediaFilesUploaded: media.filesUploaded,
      filesSkipped: html.filesSkipped + thumbnails.filesSkipped + media.filesSkipped,
    };
  });
}
