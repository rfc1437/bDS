import type { ProjectEngine } from './ProjectEngine';
import type { PublishEngine, PublishCredentials } from './PublishEngine';
import type { TaskManager } from './TaskManager';

export type { PublishCredentials };

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
  constructor(
    private readonly projectEngine: ProjectEngine,
    private readonly publishEngine: PublishEngine,
    private readonly taskManager: TaskManager,
  ) {}

  async uploadSite(credentials: PublishCredentials): Promise<PublishSiteResult> {
    const project = await this.projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    this.publishEngine.setProjectContext(project.id, project.dataPath!);

    const ts = Date.now();
    const groupId = `publish-${ts}`;
    const groupName = 'Site Publishing';

    const htmlTask = this.taskManager.runTask({
      id: `publish-html-${ts}`,
      name: 'Upload HTML',
      groupId,
      groupName,
      execute: (onProgress) => this.publishEngine.uploadHtml(credentials, onProgress),
    });

    const thumbsTask = this.taskManager.runTask({
      id: `publish-thumbnails-${ts}`,
      name: 'Upload Thumbnails',
      groupId,
      groupName,
      execute: (onProgress) => this.publishEngine.uploadThumbnails(credentials, onProgress),
    });

    const mediaTask = this.taskManager.runTask({
      id: `publish-media-${ts}`,
      name: 'Upload Media',
      groupId,
      groupName,
      execute: (onProgress) => this.publishEngine.uploadMedia(credentials, onProgress),
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
