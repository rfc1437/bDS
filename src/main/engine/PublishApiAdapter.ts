import { getProjectEngine } from './ProjectEngine';
import { getPublishEngine, type PublishCredentials } from './PublishEngine';
import { taskManager } from './TaskManager';

export interface PublishSiteResult {
  htmlFilesUploaded: number;
  thumbnailFilesUploaded: number;
  mediaFilesUploaded: number;
  filesSkipped: number;
}

/**
 * Adapter that wraps PublishEngine for use by the Python API layer.
 * Mirrors the orchestration logic from publishHandlers.ts: sets project
 * context, launches three parallel upload tasks, and returns aggregate results.
 */
export class PublishApiAdapter {
  async uploadSite(credentials: PublishCredentials): Promise<PublishSiteResult> {
    const project = await getProjectEngine().getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const publishEngine = getPublishEngine();
    publishEngine.setProjectContext(project.id, project.dataPath!);

    const ts = Date.now();
    const groupId = `publish-${ts}`;
    const groupName = 'Site Publishing';

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
  }
}

let instance: PublishApiAdapter | null = null;

export function getPublishApiAdapter(): PublishApiAdapter {
  if (!instance) {
    instance = new PublishApiAdapter();
  }
  return instance;
}
