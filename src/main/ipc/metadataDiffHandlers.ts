import { getProjectEngine } from '../engine/ProjectEngine';
import { taskManager } from '../engine/TaskManager';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerMetadataDiffHandlers(safeHandle: SafeHandle): void {
  safeHandle('metadataDiff:getStats', async () => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getTableStats();
  });

  safeHandle('metadataDiff:scan', async () => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }

    const taskId = `metadata-diff-scan-${Date.now()}`;
    return taskManager.runTask({
      id: taskId,
      name: 'Scanning for metadata differences',
      execute: async (onProgress) => {
        return engine.scanAllPublishedPosts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
      },
    });
  });

  safeHandle('metadataDiff:syncDbToFile', async (_, postIds: string[], groupLabel: string) => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncDbToFileTask(postIds, groupLabel);
  });

  safeHandle('metadataDiff:syncFileToDb', async (_, postIds: string[], field: string, groupLabel: string) => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncFileToDbTask(postIds, field as 'tags' | 'categories' | 'title' | 'excerpt' | 'author', groupLabel);
  });
}
