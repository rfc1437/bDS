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

    return taskManager.runTask({
      id: `publish-upload-${Date.now()}`,
      name: 'Upload Site',
      groupId: 'publish',
      groupName: 'Site Publishing',
      execute: async (onProgress) => {
        return publishEngine.uploadSite(credentials, (progress, message) => {
          onProgress(progress, message);
        });
      },
    });
  });
}
