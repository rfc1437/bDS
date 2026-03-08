import { getPythonApiMethodContract } from '../shared/pythonApiContractV1';
import type { PythonApiParamContractV1 } from '../shared/pythonApiContractV1';
import type { EngineBundle } from './EngineBundle';

// Module-level bundle set by main.ts at startup.
// All ENGINE_MAP getters read from this bundle.
let registeredBundle: EngineBundle | null = null;

export function setEngineBundle(bundle: EngineBundle): void {
  registeredBundle = bundle;
}

function requireBundle(): EngineBundle {
  if (!registeredBundle) {
    throw new Error('Engine bundle not registered. Call setEngineBundle() before invoking Python API methods.');
  }
  return registeredBundle;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function validateParamValue(methodName: string, param: PythonApiParamContractV1, value: unknown): void {
  if (param.type === 'stringOrNull') {
    if (value === null || (typeof value === 'string' && value.length > 0)) {
      return;
    }
    throw new Error(`${methodName} requires stringOrNull arg ${param.name}`);
  }

  if (value === undefined || value === null) {
    if (!param.required) {
      return;
    }
    throw new Error(`${methodName} requires ${param.type} arg ${param.name}`);
  }

  if (param.type === 'any') {
    return;
  }

  if (param.type === 'string') {
    if (typeof value === 'string' && value.length > 0) {
      return;
    }
    throw new Error(`${methodName} requires string arg ${param.name}`);
  }

  if (param.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return;
    }
    throw new Error(`${methodName} requires number arg ${param.name}`);
  }

  if (param.type === 'boolean') {
    if (typeof value === 'boolean') {
      return;
    }
    throw new Error(`${methodName} requires boolean arg ${param.name}`);
  }

  if (param.type === 'array') {
    if (Array.isArray(value)) {
      return;
    }
    throw new Error(`${methodName} requires array arg ${param.name}`);
  }

  if (param.type === 'object') {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return;
    }
    throw new Error(`${methodName} requires object arg ${param.name}`);
  }
}

type EngineGetter = () => Record<string, (...args: unknown[]) => unknown>;

export const ENGINE_MAP: Record<string, EngineGetter> = {
  posts: () => requireBundle().postEngine as any,
  media: () => requireBundle().mediaEngine as any,
  projects: () => requireBundle().projectEngine as any,
  meta: () => requireBundle().metaEngine as any,
  tags: () => requireBundle().tagEngine as any,
  scripts: () => requireBundle().scriptEngine as any,
  templates: () => requireBundle().templateEngine as any,
  tasks: () => requireBundle().taskManager as any,
  sync: () => requireBundle().gitApiAdapter as any,
  publish: () => requireBundle().publishApiAdapter as any,
  app: () => requireBundle().appApiAdapter as any,
};

// Map API method names to engine method names where they differ
const METHOD_NAME_MAP: Record<string, string> = {
  'posts.get': 'getPost',
  'posts.getBySlug': 'getPostBySlug',
  'posts.create': 'createPost',
  'posts.update': 'updatePost',
  'posts.delete': 'deletePost',
  'posts.getAll': 'getAllPosts',
  'posts.getByStatus': 'getPostsByStatus',
  'posts.publish': 'publishPost',
  'posts.publishTranslation': 'publishPostTranslation',
  'posts.discard': 'discardChanges',
  'posts.hasPublishedVersion': 'hasPublishedVersion',
  'posts.rebuildFromFiles': 'rebuildDatabaseFromFiles',
  'posts.reindexText': 'reindexText',
  'posts.search': 'searchPosts',
  'posts.filter': 'getPostsFiltered',
  'posts.getTags': 'getAvailableTags',
  'posts.getCategories': 'getAvailableCategories',
  'posts.getByYearMonth': 'getPostsByYearMonth',
  'posts.getDashboardStats': 'getDashboardStats',
  'posts.getTagsWithCounts': 'getTagsWithCounts',
  'posts.getCategoriesWithCounts': 'getCategoriesWithCounts',
  'posts.getLinksTo': 'getLinksTo',
  'posts.getLinkedBy': 'getLinkedBy',
  'posts.rebuildLinks': 'rebuildAllPostLinks',
  'posts.isSlugAvailable': 'isSlugAvailable',
  'posts.generateUniqueSlug': 'generateUniqueSlug',
  'posts.getPreviewUrl': 'getPost', // handled specially
  'media.import': 'importMedia',
  'media.update': 'updateMedia',
  'media.replaceFile': 'replaceMediaFile',
  'media.delete': 'deleteMedia',
  'media.get': 'getMedia',
  'media.getUrl': 'getRelativePath',
  'media.getAll': 'getAllMedia',
  'media.rebuildFromFiles': 'rebuildDatabaseFromFiles',
  'media.reindexText': 'reindexText',
  'media.getThumbnail': 'getThumbnailDataUrl',
  'media.regenerateThumbnails': 'generateThumbnails',
  'media.regenerateMissingThumbnails': 'regenerateMissingThumbnails',
  'media.filter': 'getMediaFiltered',
  'media.search': 'searchMedia',
  'media.getByYearMonth': 'getMediaByYearMonth',
  'media.getTags': 'getAvailableTags',
  'media.getTagsWithCounts': 'getTagsWithCounts',
  'projects.create': 'createProject',
  'projects.update': 'updateProject',
  'projects.delete': 'deleteProject',
  'projects.deleteWithData': 'deleteProjectWithData',
  'projects.get': 'getProject',
  'projects.getAll': 'getAllProjects',
  'projects.getActive': 'getActiveProject',
  'projects.setActive': 'setActiveProject',
  'meta.getTags': 'getTags',
  'meta.getCategories': 'getCategories',
  'meta.addTag': 'addTag',
  'meta.removeTag': 'removeTag',
  'meta.addCategory': 'addCategory',
  'meta.removeCategory': 'removeCategory',
  'meta.syncOnStartup': 'syncOnStartup',
  'meta.getProjectMetadata': 'getProjectMetadata',
  'meta.setProjectMetadata': 'setProjectMetadata',
  'meta.updateProjectMetadata': 'updateProjectMetadata',
  'meta.getPublishingPreferences': 'getPublishingPreferences',
  'meta.setPublishingPreferences': 'setPublishingPreferences',
  'meta.clearPublishingPreferences': 'clearPublishingPreferences',
  'tags.getAll': 'getAllTags',
  'tags.getWithCounts': 'getTagsWithCounts',
  'tags.get': 'getTag',
  'tags.getByName': 'getTagByName',
  'tags.create': 'createTag',
  'tags.update': 'updateTag',
  'tags.delete': 'deleteTag',
  'tags.merge': 'mergeTags',
  'tags.rename': 'renameTag',
  'tags.getPostsWithTag': 'getPostsWithTag',
  'tags.syncFromPosts': 'syncTagsFromPosts',
  'scripts.create': 'createScript',
  'scripts.update': 'updateScript',
  'scripts.delete': 'deleteScript',
  'scripts.get': 'getScript',
  'scripts.getAll': 'getAllScripts',
  'scripts.rebuildFromFiles': 'rebuildDatabaseFromFiles',
  'templates.create': 'createTemplate',
  'templates.update': 'updateTemplate',
  'templates.delete': 'deleteTemplate',
  'templates.get': 'getTemplate',
  'templates.getAll': 'getAllTemplates',
  'templates.getEnabledByKind': 'getEnabledTemplatesByKind',
  'templates.validate': 'validateTemplate',
  'templates.rebuildFromFiles': 'rebuildDatabaseFromFiles',
  'tasks.getAll': 'getAllTasks',
  'tasks.getRunning': 'getRunningTasks',
  'tasks.cancel': 'cancelTask',
  'tasks.clearCompleted': 'clearCompletedTasks',
};

export async function invokeMainProcessPythonApi(method: string, args: Record<string, unknown>): Promise<unknown> {
  const contract = getPythonApiMethodContract(method);
  if (!contract) {
    throw new Error(`Unsupported Python API method: ${method}`);
  }

  const normalizedArgs = asRecord(args);

  const [namespace, member] = contract.method.split('.');
  if (!namespace || !member) {
    throw new Error(`Unsupported Python API method: ${method}`);
  }

  // Skip methods that require UI/dialog interaction or are not safe for background use
  const unsafeMethods = new Set([
    'media.importDialog', 'media.replaceFileDialog', 'media.getFilePath',
    'app.openFolder', 'app.selectFolder', 'app.showItemInFolder',
    'app.getTitleBarMetrics', 'app.notifyRendererReady', 'app.triggerMenuAction',
    'app.getBlogmarkBookmarklet', 'app.copyToClipboard', 'app.setPreviewPostTarget',
  ]);

  if (unsafeMethods.has(method)) {
    throw new Error(`Python API method '${method}' is not available in main-process macro context`);
  }

  const engineGetter = ENGINE_MAP[namespace];
  if (!engineGetter) {
    throw new Error(`Unsupported Python API namespace: ${namespace}`);
  }

  const engine = engineGetter();
  const engineMethodName = METHOD_NAME_MAP[method] ?? member;
  const callable = engine[engineMethodName];

  if (typeof callable !== 'function') {
    throw new Error(`Unsupported Python API method: ${method} (engine method '${engineMethodName}' not found)`);
  }

  const orderedArgs = contract.params.map((param) => {
    const value = normalizedArgs[param.name];
    validateParamValue(contract.method, param, value);
    return value;
  });

  return callable.apply(engine, orderedArgs);
}
