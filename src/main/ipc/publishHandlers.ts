import type { IpcMainInvokeEvent } from 'electron';
import type { PublishCredentials } from '../engine/PublishEngine';
import type { EngineBundle } from '../engine/EngineBundle';
import { isOfflineModeActive } from './chatHandlers';

type SafeHandle = <Args extends unknown[], Result>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>) => void;

export function registerPublishHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  safeHandle('publish:uploadSite', async (_event: unknown, credentials: PublishCredentials) => {
    if (isOfflineModeActive()) {
      throw new Error('Airplane mode is active. Disable it to upload the site.');
    }

    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const publishEngine = bundle.publishEngine;
    if (!project.dataPath) {
      throw new Error('Active project is missing dataPath');
    }

    publishEngine.setProjectContext(project.id, project.dataPath);

    const ts = Date.now();
    const groupId = `publish-${ts}`;
    const groupName = 'Site Publishing';

    // Launch three parallel tasks, one per directory
    const htmlTask = bundle.taskManager.runTask({
      id: `publish-html-${ts}`,
      name: 'Upload HTML',
      groupId,
      groupName,
      execute: (onProgress) => publishEngine.uploadHtml(credentials, onProgress),
    });

    const thumbsTask = bundle.taskManager.runTask({
      id: `publish-thumbnails-${ts}`,
      name: 'Upload Thumbnails',
      groupId,
      groupName,
      execute: (onProgress) => publishEngine.uploadThumbnails(credentials, onProgress),
    });

    const mediaTask = bundle.taskManager.runTask({
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
