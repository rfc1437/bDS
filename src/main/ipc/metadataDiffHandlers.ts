import type { EngineBundle } from '../engine/EngineBundle';
import type { MediaDiffField, ScriptDiffField, TemplateDiffField } from '../engine/MetadataDiffEngine';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

/** Helper: set project context on the MetadataDiffEngine from the active project */
async function withProjectContext(bundle: EngineBundle): Promise<void> {
  const activeProject = await bundle.projectEngine.getActiveProject();
  if (activeProject) {
    bundle.metadataDiffEngine.setProjectContext(activeProject.id);
  }
}

export function registerMetadataDiffHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  const engine = () => bundle.metadataDiffEngine;

  // ── Posts ──

  safeHandle('metadataDiff:getStats', async () => {
    await withProjectContext(bundle);
    return engine().getTableStats();
  });

  safeHandle('metadataDiff:scan', async () => {
    await withProjectContext(bundle);
    const taskId = `metadata-diff-scan-${Date.now()}`;
    // Resolve the posts directory so the scanner can detect orphan files
    const activeProject = await bundle.projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = bundle.projectEngine.getProjectPaths(projectId, activeProject?.dataPath);
    return bundle.taskManager.runTask({
      id: taskId,
      name: 'Scanning for metadata differences',
      execute: async (onProgress) => {
        return engine().scanAllPublishedPosts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        }, paths.posts);
      },
    });
  });

  safeHandle('metadataDiff:syncDbToFile', async (_, postIds: string[], groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runSyncDbToFileTask(postIds, groupLabel);
  });

  safeHandle('metadataDiff:syncFileToDb', async (_, postIds: string[], field: string, groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runSyncFileToDbTask(postIds, field as 'tags' | 'categories' | 'title' | 'excerpt' | 'author' | 'language' | 'translationFor', groupLabel);
  });

  // ── Media ──

  safeHandle('metadataDiff:scanMedia', async () => {
    await withProjectContext(bundle);
    return engine().runMediaScanTask();
  });

  safeHandle('metadataDiff:syncMediaDbToFile', async (_, mediaIds: string[], groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runMediaSyncDbToFileTask(mediaIds, groupLabel);
  });

  safeHandle('metadataDiff:syncMediaFileToDb', async (_, mediaIds: string[], field: string, groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runMediaSyncFileToDbTask(mediaIds, field as MediaDiffField, groupLabel);
  });

  // ── Scripts ──

  safeHandle('metadataDiff:scanScripts', async () => {
    await withProjectContext(bundle);
    return engine().runScriptScanTask();
  });

  safeHandle('metadataDiff:syncScriptDbToFile', async (_, scriptIds: string[], groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runScriptSyncDbToFileTask(scriptIds, groupLabel);
  });

  safeHandle('metadataDiff:syncScriptFileToDb', async (_, scriptIds: string[], field: string, groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runScriptSyncFileToDbTask(scriptIds, field as ScriptDiffField, groupLabel);
  });

  // ── Templates ──

  safeHandle('metadataDiff:scanTemplates', async () => {
    await withProjectContext(bundle);
    return engine().runTemplateScanTask();
  });

  safeHandle('metadataDiff:syncTemplateDbToFile', async (_, templateIds: string[], groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runTemplateSyncDbToFileTask(templateIds, groupLabel);
  });

  safeHandle('metadataDiff:syncTemplateFileToDb', async (_, templateIds: string[], field: string, groupLabel: string) => {
    await withProjectContext(bundle);
    return engine().runTemplateSyncFileToDbTask(templateIds, field as TemplateDiffField, groupLabel);
  });

  // ── Orphan file import ──

  safeHandle('metadataDiff:importOrphanFiles', async (_, filePaths: string[]) => {
    await withProjectContext(bundle);
    return engine().runImportOrphanFilesTask(filePaths);
  });
}