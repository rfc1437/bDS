import type { EngineBundle } from '../engine/EngineBundle';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerMetadataDiffHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  safeHandle('metadataDiff:getStats', async () => {
    const engine = bundle.metadataDiffEngine;
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getTableStats();
  });

  safeHandle('metadataDiff:scan', async () => {
    const engine = bundle.metadataDiffEngine;
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }

    const taskId = `metadata-diff-scan-${Date.now()}`;
    return bundle.taskManager.runTask({
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
    const engine = bundle.metadataDiffEngine;
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncDbToFileTask(postIds, groupLabel);
  });

  safeHandle('metadataDiff:syncFileToDb', async (_, postIds: string[], field: string, groupLabel: string) => {
    const engine = bundle.metadataDiffEngine;
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncFileToDbTask(postIds, field as 'tags' | 'categories' | 'title' | 'excerpt' | 'author', groupLabel);
  });
}
