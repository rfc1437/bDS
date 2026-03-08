import type { ElectronAPI } from './electronApi';

type PythonPromiseMethodPath = {
  [Group in keyof ElectronAPI]: ElectronAPI[Group] extends Record<string, (...args: never[]) => unknown>
    ? {
        [Method in keyof ElectronAPI[Group]]: ElectronAPI[Group][Method] extends (...args: never[]) => Promise<unknown>
          ? `${Extract<Group, string>}.${Extract<Method, string>}`
          : never;
      }[keyof ElectronAPI[Group]]
    : never;
}[keyof ElectronAPI];

export type PythonApiParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any' | 'stringOrNull';

export interface PythonApiParamContractV1 {
  name: string;
  type: PythonApiParamType;
  required: boolean;
}

export interface PythonApiMethodContractV1 {
  method: PythonPromiseMethodPath;
  description: string;
  params: PythonApiParamContractV1[];
  returns: string;
}

export interface PythonApiDataStructureFieldContractV1 {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface PythonApiDataStructureContractV1 {
  name: string;
  description: string;
  fields: PythonApiDataStructureFieldContractV1[];
}

export interface PythonApiContractV1 {
  version: string;
  generatedAt: string;
  methods: PythonApiMethodContractV1[];
  dataStructures: PythonApiDataStructureContractV1[];
}

const requiredString = (name: string): PythonApiParamContractV1 => ({ name, type: 'string', required: true });
const optionalString = (name: string): PythonApiParamContractV1 => ({ name, type: 'string', required: false });
const optionalNumber = (name: string): PythonApiParamContractV1 => ({ name, type: 'number', required: false });
const requiredObject = (name: string): PythonApiParamContractV1 => ({ name, type: 'object', required: true });
const optionalObject = (name: string): PythonApiParamContractV1 => ({ name, type: 'object', required: false });
const requiredArray = (name: string): PythonApiParamContractV1 => ({ name, type: 'array', required: true });
const requiredStringOrNull = (name: string): PythonApiParamContractV1 => ({ name, type: 'stringOrNull', required: true });

function method(
  methodName: PythonPromiseMethodPath,
  description: string,
  params: PythonApiParamContractV1[],
  returns: string
): PythonApiMethodContractV1 {
  return {
    method: methodName,
    description,
    params,
    returns,
  };
}

const METHODS_V1: PythonApiMethodContractV1[] = [
  method('projects.create', 'Create a project.', [requiredObject('data')], 'ProjectData'),
  method('projects.update', 'Update a project by id.', [requiredString('id'), requiredObject('data')], 'ProjectData | null'),
  method('projects.delete', 'Delete a project by id.', [requiredString('id')], 'boolean'),
  method('projects.deleteWithData', 'Delete a project and data by id.', [requiredString('id')], 'boolean'),
  method('projects.get', 'Fetch one project by id.', [requiredString('id')], 'ProjectData | null'),
  method('projects.getAll', 'Fetch all projects.', [], 'ProjectData[]'),
  method('projects.getActive', 'Fetch active project.', [], 'ProjectData | null'),
  method('projects.setActive', 'Set active project by id.', [requiredString('id')], 'ProjectData | null'),

  method('posts.create', 'Create a post.', [requiredObject('data')], 'PostData'),
  method('posts.update', 'Update a post by id.', [requiredString('id'), requiredObject('data')], 'PostData | null'),
  method('posts.delete', 'Delete a post by id.', [requiredString('id')], 'boolean'),
  method('posts.get', 'Fetch one post by id.', [requiredString('postId')], 'PostData | null'),
  method('posts.getBySlug', 'Fetch one post by slug.', [requiredString('slug')], 'PostData | null'),
  method('posts.getPreviewUrl', 'Get preview URL for post. options may include draft=true and lang=<language-code>.', [requiredString('id'), optionalObject('options')], 'string | null'),
  method('posts.getAll', 'Fetch posts with pagination.', [optionalObject('options')], 'PaginatedPostsResult'),
  method('posts.getByStatus', 'Fetch posts by status.', [requiredString('status')], 'PostData[]'),
  method('posts.publish', 'Publish a post by id.', [requiredString('id')], 'PostData | null'),
  method('posts.publishTranslation', 'Publish a specific translation of a post.', [requiredString('postId'), requiredString('language')], 'PostTranslationData | null'),
  method('posts.discard', 'Discard draft changes for post.', [requiredString('id')], 'PostData | null'),
  method('posts.hasPublishedVersion', 'Check if post has published version.', [requiredString('id')], 'boolean'),
  method('posts.rebuildFromFiles', 'Rebuild posts database from files.', [], 'void'),
  method('posts.reindexText', 'Reindex post search text.', [], 'void'),
  method('posts.search', 'Search posts by free-text query.', [requiredString('query')], 'SearchResult[]'),
  method('posts.filter', 'Filter posts by criteria, including optional language and missingTranslationLanguage filters.', [requiredObject('filter')], 'PostData[]'),
  method('posts.getTags', 'Get all post tags.', [], 'string[]'),
  method('posts.getCategories', 'Get all post categories.', [], 'string[]'),
  method('posts.getByYearMonth', 'Get post counts grouped by year/month.', [], 'Array<{ year: number; month: number; count: number } >'),
  method('posts.getDashboardStats', 'Get post dashboard stats.', [], 'DashboardStats'),
  method('posts.getTagsWithCounts', 'Get post tags with counts.', [], 'TagCount[]'),
  method('posts.getCategoriesWithCounts', 'Get post categories with counts.', [], 'CategoryCount[]'),
  method('posts.getLinksTo', 'Get posts linked to given post.', [requiredString('id')], 'PostData[]'),
  method('posts.getLinkedBy', 'Get posts linking to given post.', [requiredString('id')], 'PostData[]'),
  method('posts.rebuildLinks', 'Rebuild post link graph.', [], 'void'),
  method('posts.isSlugAvailable', 'Check if post slug is available.', [requiredString('slug'), optionalString('excludePostId')], 'boolean'),
  method('posts.generateUniqueSlug', 'Generate unique slug from title.', [requiredString('title'), optionalString('excludePostId')], 'string'),

  method('media.import', 'Import media file.', [requiredString('sourcePath'), optionalObject('metadata')], 'MediaData'),
  method('media.update', 'Update media metadata by id.', [requiredString('id'), requiredObject('data')], 'MediaData | null'),
  method('media.replaceFile', 'Replace media file by id.', [requiredString('id'), requiredString('newSourcePath')], 'MediaData | null'),
  method('media.delete', 'Delete media by id.', [requiredString('id')], 'boolean'),
  method('media.get', 'Fetch one media by id.', [requiredString('id')], 'MediaData | null'),
  method('media.getUrl', 'Get media URL by id.', [requiredString('id')], 'string | null'),
  method('media.getFilePath', 'Get media file path by id.', [requiredString('id')], 'string | null'),
  method('media.getAll', 'Fetch all media.', [], 'MediaData[]'),
  method('media.rebuildFromFiles', 'Rebuild media database from files.', [], 'void'),
  method('media.reindexText', 'Reindex media search text.', [], 'void'),
  method('media.getThumbnail', 'Get media thumbnail URL.', [requiredString('id'), optionalString('size')], 'string | null'),
  method('media.regenerateThumbnails', 'Regenerate thumbnails for media.', [requiredString('id')], 'Record<string, string> | null'),
  method('media.regenerateMissingThumbnails', 'Regenerate all missing thumbnails.', [], '{ processed: number; generated: number; failed: number }'),
  method('media.filter', 'Filter media by criteria.', [requiredObject('filter')], 'MediaData[]'),
  method('media.search', 'Search media by free-text query.', [requiredString('query')], 'MediaSearchResult[]'),
  method('media.getByYearMonth', 'Get media counts grouped by year/month.', [], 'Array<{ year: number; month: number; count: number } >'),
  method('media.getTags', 'Get all media tags.', [], 'string[]'),
  method('media.getTagsWithCounts', 'Get media tags with counts.', [], 'TagCount[]'),

  method('scripts.create', 'Create script. data must include: title (str), kind ("macro"|"utility"|"transform"), content (str). Optional: slug (str), entrypoint (str, defaults to "render"), enabled (bool).', [requiredObject('data')], 'ScriptData'),
  method('scripts.update', 'Update script by id. data may include any of: title, kind, content, slug, entrypoint, enabled.', [requiredString('id'), requiredObject('data')], 'ScriptData | null'),
  method('scripts.delete', 'Delete script by id.', [requiredString('id')], 'boolean'),
  method('scripts.get', 'Fetch script by id.', [requiredString('id')], 'ScriptData | null'),
  method('scripts.getAll', 'Fetch all scripts.', [], 'ScriptData[]'),
  method('scripts.rebuildFromFiles', 'Rebuild scripts from files.', [], 'void'),

  method('templates.create', 'Create template. data must include: title (str), kind ("post"|"list"|"not-found"|"partial"), content (str). Optional: slug (str), enabled (bool).', [requiredObject('data')], 'TemplateData'),
  method('templates.update', 'Update template by id. data may include any of: title, kind, content, slug, enabled.', [requiredString('id'), requiredObject('data')], 'TemplateData | null'),
  method('templates.delete', 'Delete template by id. Without options, returns references if the template is in use. Pass options={"force": True} to clear references and delete.', [requiredString('id'), optionalObject('options')], 'TemplateDeleteResult'),
  method('templates.get', 'Fetch template by id.', [requiredString('id')], 'TemplateData | null'),
  method('templates.getAll', 'Fetch all templates.', [], 'TemplateData[]'),
  method('templates.getEnabledByKind', 'Fetch enabled templates filtered by kind.', [requiredString('kind')], 'TemplateData[]'),
  method('templates.validate', 'Validate Liquid template syntax.', [requiredString('content')], '{ valid: boolean; errors: string[] }'),
  method('templates.rebuildFromFiles', 'Rebuild templates from files.', [], 'void'),

  method('tasks.getAll', 'Fetch all tasks.', [], 'TaskProgress[]'),
  method('tasks.getRunning', 'Fetch running tasks.', [], 'TaskProgress[]'),
  method('tasks.cancel', 'Cancel task by id.', [requiredString('taskId')], 'boolean'),
  method('tasks.clearCompleted', 'Clear completed tasks.', [], 'void'),

  method('app.getDataPaths', 'Get app data paths.', [], '{ database: string; posts: string; media: string }'),
  method('app.getSystemLanguage', 'Get system language.', [], 'string'),
  method('app.getTitleBarMetrics', 'Get title bar metrics.', [], '{ macosLeftInset: number } | null'),
  method('app.openFolder', 'Open folder in system file manager.', [requiredString('folderPath')], 'string'),
  method('app.showItemInFolder', 'Reveal item in system file manager.', [requiredString('itemPath')], 'void'),
  method('app.selectFolder', 'Show folder picker dialog.', [optionalString('title')], 'string | null'),
  method('app.getDefaultProjectPath', 'Get default project path.', [requiredString('projectId')], 'string'),
  method('app.readProjectMetadata', 'Read project metadata from path.', [requiredString('folderPath')], '{ name?: string; description?: string; publicUrl?: string; mainLanguage?: string } | null'),
  method('app.getBlogmarkBookmarklet', 'Get blogmark bookmarklet script.', [], 'string'),
  method('app.copyToClipboard', 'Copy text to clipboard.', [requiredString('text')], 'boolean'),
  method('app.notifyRendererReady', 'Notify main process renderer is ready.', [], 'boolean'),
  method('app.setPreviewPostTarget', 'Set preview post target.', [requiredStringOrNull('postId')], 'void'),
  method('app.triggerMenuAction', 'Trigger menu action.', [requiredString('action')], 'void'),

  method('meta.getTags', 'Get project tags.', [], 'string[]'),
  method('meta.getCategories', 'Get project categories.', [], 'string[]'),
  method('meta.addTag', 'Add project tag.', [requiredString('tag')], 'string[]'),
  method('meta.removeTag', 'Remove project tag.', [requiredString('tag')], 'string[]'),
  method('meta.addCategory', 'Add project category.', [requiredString('category')], 'string[]'),
  method('meta.removeCategory', 'Remove project category.', [requiredString('category')], 'string[]'),
  method('meta.syncOnStartup', 'Sync meta values on startup.', [], '{ tags: string[]; categories: string[]; projectMetadata: ProjectMetadata | null }'),
  method('meta.getProjectMetadata', 'Read active project metadata.', [], 'ProjectMetadata | null'),
  method('meta.setProjectMetadata', 'Set project metadata.', [requiredObject('metadata')], 'ProjectMetadata | null'),
  method('meta.updateProjectMetadata', 'Update project metadata.', [requiredObject('updates')], 'ProjectMetadata | null'),
  method('meta.getPublishingPreferences', 'Get publishing preferences for the active project.', [], 'PublishingPreferences | null'),
  method('meta.setPublishingPreferences', 'Set publishing preferences for the active project.', [requiredObject('prefs')], 'void'),
  method('meta.clearPublishingPreferences', 'Clear publishing preferences for the active project.', [], 'void'),

  method('tags.getAll', 'Fetch all tags.', [], 'TagData[]'),
  method('tags.getWithCounts', 'Fetch tags with counts.', [], 'TagWithCount[]'),
  method('tags.get', 'Fetch tag by id.', [requiredString('id')], 'TagData | null'),
  method('tags.getByName', 'Fetch tag by name.', [requiredString('name')], 'TagData | null'),
  method('tags.create', 'Create tag.', [requiredObject('data')], 'TagData'),
  method('tags.update', 'Update tag by id.', [requiredString('id'), requiredObject('data')], 'TagData | null'),
  method('tags.delete', 'Delete tag by id.', [requiredString('id')], 'DeleteTagResult'),
  method('tags.merge', 'Merge tags into target tag.', [requiredArray('sourceTagIds'), requiredString('targetTagId')], 'MergeTagsResult'),
  method('tags.rename', 'Rename tag by id.', [requiredString('id'), requiredString('newName')], 'RenameTagResult'),
  method('tags.getPostsWithTag', 'Get posts using a tag.', [requiredString('tagId')], 'string[]'),
  method('tags.syncFromPosts', 'Sync tag index from posts.', [], 'SyncTagsResult'),

  // NOTE: most chat namespace methods intentionally excluded from Python API.
  // AI/chat features (sendMessage, analyzeTaxonomy, etc.) are expensive external
  // API calls that require user oversight and interactive streaming.
  // Exceptions: lightweight one-shot tasks are exposed individually.

  method('chat.analyzeMediaImage', 'Analyze an image and generate title, alt text, and caption using AI.', [requiredString('mediaId'), optionalString('language')], 'ImageAnalysisResult'),
  method('chat.detectPostLanguage', 'Detect the language of a post from its title and content.', [requiredString('title'), requiredString('content')], '{ success: boolean; language?: string; error?: string }'),
  method('chat.analyzePost', 'Analyze a post and generate suggested title, excerpt, and slug using AI.', [requiredString('postId'), optionalString('language')], 'PostAnalysisResult'),
  method('chat.translatePost', 'Translate a post into a target language and save it as a translation draft.', [requiredString('postId'), requiredString('targetLanguage')], 'PostTranslationResult'),

  method('sync.checkAvailability', 'Check if git is available.', [], 'GitAvailability'),
  method('sync.getRepoState', 'Get repository state for active project.', [], 'RepoState'),
  method('sync.getStatus', 'Get working tree status for active project.', [], 'GitStatusDto'),
  method('sync.getHistory', 'Get commit history for active project.', [optionalNumber('limit')], 'GitHistoryEntry[]'),
  method('sync.getRemoteState', 'Get remote tracking state for active project.', [], 'GitRemoteStateDto'),
  method('sync.fetch', 'Fetch from remote for active project.', [], 'GitActionResult'),
  method('sync.pull', 'Pull from remote for active project.', [], 'GitActionResult'),
  method('sync.push', 'Push to remote for active project.', [], 'GitActionResult'),
  method('sync.commitAll', 'Stage all changes and commit for active project.', [requiredString('message')], 'GitActionResult'),

  method('publish.uploadSite', 'Upload rendered site to remote server via SSH.', [requiredObject('credentials')], 'PublishSiteResult'),

  method('embeddings.findSimilar', 'Find posts semantically similar to the given post. Requires semantic similarity to be enabled in project settings.', [requiredString('postId'), optionalNumber('k')], 'SimilarPost[]'),
  method('embeddings.computeSimilarities', 'Compute cosine similarity between a source post and a list of target posts. Returns a mapping of target post IDs to similarity scores (0.0-1.0). Posts without embeddings are omitted.', [requiredString('sourcePostId'), requiredArray('targetPostIds')], 'Record<string, number>'),
  method('embeddings.getProgress', 'Get the embedding indexing progress for the active project.', [], '{ indexed: number; total: number }'),
  method('embeddings.suggestTags', 'Suggest tags for a post based on tags used by semantically similar posts.', [requiredString('postId'), requiredArray('excludeTags')], 'TagSuggestion[]'),
  method('embeddings.findDuplicates', 'Find post pairs with high content similarity (potential duplicates). Threshold is a similarity value from 0.0 to 1.0 (default 0.85).', [optionalNumber('threshold')], 'DuplicatePair[]'),
  method('embeddings.dismissPair', 'Dismiss a duplicate pair so it no longer appears in results.', [requiredString('postIdA'), requiredString('postIdB')], 'void'),
  method('embeddings.indexUnindexedPosts', 'Trigger background indexing of all posts not yet embedded.', [], 'void'),
];

const DATA_STRUCTURES_V1: PythonApiDataStructureContractV1[] = [
  {
    name: 'PublishingPreferences',
    description: 'Publishing connection preferences stored in meta/publishing.json (shareable, no secrets).',
    fields: [
      { name: 'sshHost', type: 'string', required: true, description: 'SSH hostname for publishing.' },
      { name: 'sshUser', type: 'string', required: true, description: 'SSH username for publishing.' },
      { name: 'sshRemotePath', type: 'string', required: true, description: 'Remote path on the server.' },
      { name: 'sshMode', type: "'scp' | 'rsync'", required: true, description: 'Upload mode (scp or rsync).' },
    ],
  },
  {
    name: 'ProjectData',
    description: 'Project metadata stored in the app database.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Unique project identifier.' },
      { name: 'name', type: 'string', required: true, description: 'Human-readable project name.' },
      { name: 'slug', type: 'string', required: true, description: 'URL-friendly project slug.' },
      { name: 'description', type: 'string', required: false, description: 'Optional project description.' },
      { name: 'dataPath', type: 'string', required: false, description: 'Filesystem path for project data.' },
      { name: 'isActive', type: 'boolean', required: true, description: 'Whether this project is currently active.' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp (ISO string).' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp (ISO string).' },
    ],
  },
  {
    name: 'PostData',
    description: 'Canonical post object used across editor and generation flows.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Unique post identifier.' },
      { name: 'projectId', type: 'string', required: true, description: 'Owning project id.' },
      { name: 'title', type: 'string', required: true, description: 'Post title.' },
      { name: 'slug', type: 'string', required: true, description: 'URL slug used for generated routes.' },
      { name: 'excerpt', type: 'string', required: false, description: 'Optional short summary.' },
      { name: 'content', type: 'string', required: true, description: 'Markdown body content.' },
      { name: 'status', type: "'draft' | 'published' | 'archived'", required: true, description: 'Publication lifecycle state.' },
      { name: 'author', type: 'string', required: false, description: 'Optional author name.' },
      { name: 'language', type: 'string', required: false, description: 'Optional per-post language code (e.g. en, de, fr, it, es).' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp (ISO string).' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp (ISO string).' },
      { name: 'publishedAt', type: 'string', required: false, description: 'Publication timestamp for published posts.' },
      { name: 'tags', type: 'string[]', required: true, description: 'List of tag names.' },
      { name: 'categories', type: 'string[]', required: true, description: 'List of category names.' },
      { name: 'availableLanguages', type: 'string[]', required: true, description: 'Canonical language plus all available translation language codes for this post.' },
    ],
  },
  {
    name: 'MediaData',
    description: 'Canonical media object representing imported files and metadata.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Unique media identifier.' },
      { name: 'projectId', type: 'string', required: true, description: 'Owning project id.' },
      { name: 'filename', type: 'string', required: true, description: 'Stored filename in project media folder.' },
      { name: 'originalName', type: 'string', required: true, description: 'Original imported filename.' },
      { name: 'mimeType', type: 'string', required: true, description: 'Detected MIME type.' },
      { name: 'size', type: 'number', required: true, description: 'File size in bytes.' },
      { name: 'width', type: 'number', required: false, description: 'Image width in pixels when available.' },
      { name: 'height', type: 'number', required: false, description: 'Image height in pixels when available.' },
      { name: 'title', type: 'string', required: false, description: 'Optional display title.' },
      { name: 'alt', type: 'string', required: false, description: 'Optional alternative text.' },
      { name: 'caption', type: 'string', required: false, description: 'Optional caption text.' },
      { name: 'author', type: 'string', required: false, description: 'Optional author credit.' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp (ISO string).' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp (ISO string).' },
      { name: 'tags', type: 'string[]', required: true, description: 'List of media tags.' },
    ],
  },
  {
    name: 'ScriptData',
    description: 'Script definition for Python macros, utilities, and transforms.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Unique script identifier.' },
      { name: 'projectId', type: 'string', required: true, description: 'Owning project id.' },
      { name: 'slug', type: 'string', required: true, description: 'Stable script slug.' },
      { name: 'title', type: 'string', required: true, description: 'Human-readable script title.' },
      { name: 'kind', type: "'macro' | 'utility' | 'transform'", required: true, description: 'Script category.' },
      { name: 'entrypoint', type: 'string', required: true, description: 'Python entrypoint function name.' },
      { name: 'enabled', type: 'boolean', required: true, description: 'Whether script is enabled.' },
      { name: 'version', type: 'number', required: true, description: 'Incrementing script version.' },
      { name: 'filePath', type: 'string', required: true, description: 'Filesystem path to script file.' },
      { name: 'content', type: 'string', required: true, description: 'Script source code.' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp (ISO string).' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp (ISO string).' },
    ],
  },
  {
    name: 'TemplateData',
    description: 'Liquid template definition for posts, lists, not-found pages, and partials.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Unique template identifier.' },
      { name: 'projectId', type: 'string', required: true, description: 'Owning project id.' },
      { name: 'slug', type: 'string', required: true, description: 'Stable template slug.' },
      { name: 'title', type: 'string', required: true, description: 'Human-readable template title.' },
      { name: 'kind', type: "'post' | 'list' | 'not-found' | 'partial'", required: true, description: 'Template category.' },
      { name: 'enabled', type: 'boolean', required: true, description: 'Whether template is enabled.' },
      { name: 'version', type: 'number', required: true, description: 'Incrementing template version.' },
      { name: 'filePath', type: 'string', required: true, description: 'Filesystem path to template file.' },
      { name: 'content', type: 'string', required: true, description: 'Liquid template source code.' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp (ISO string).' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp (ISO string).' },
    ],
  },
  {
    name: 'TemplateDeleteResult',
    description: 'Result of a template delete operation. If the template is referenced by posts or tags, deleted is false and references lists the referencing IDs.',
    fields: [
      { name: 'deleted', type: 'boolean', required: true, description: 'Whether the template was deleted.' },
      { name: 'references', type: '{ postIds: string[]; tagIds: string[] }', required: false, description: 'Post and tag IDs referencing this template (present when deleted is false and references exist).' },
    ],
  },
  {
    name: 'TaskProgress',
    description: 'Task queue status object for long-running operations.',
    fields: [
      { name: 'taskId', type: 'string', required: true, description: 'Unique task identifier.' },
      { name: 'name', type: 'string', required: true, description: 'Task display name.' },
      { name: 'status', type: "'pending' | 'running' | 'completed' | 'failed' | 'cancelled'", required: true, description: 'Current task status.' },
      { name: 'progress', type: 'number', required: true, description: 'Progress percentage from 0-100.' },
      { name: 'message', type: 'string', required: true, description: 'Current progress message.' },
      { name: 'startTime', type: 'string', required: true, description: 'Task start time (ISO string).' },
      { name: 'endTime', type: 'string', required: false, description: 'Task completion time (ISO string).' },
      { name: 'error', type: 'string', required: false, description: 'Error message when failed.' },
      { name: 'groupId', type: 'string', required: false, description: 'Optional grouping id.' },
      { name: 'groupName', type: 'string', required: false, description: 'Optional grouping label.' },
    ],
  },
  {
    name: 'ProjectMetadata',
    description: 'Extended project metadata from project settings.',
    fields: [
      { name: 'name', type: 'string', required: true, description: 'Project display name.' },
      { name: 'description', type: 'string', required: false, description: 'Optional project description.' },
      { name: 'dataPath', type: 'string', required: false, description: 'Optional custom data path.' },
      { name: 'publicUrl', type: 'string', required: false, description: 'Optional public site URL.' },
      { name: 'mainLanguage', type: 'string', required: false, description: 'Main render language code.' },
      { name: 'defaultAuthor', type: 'string', required: false, description: 'Default author for new posts.' },
      { name: 'maxPostsPerPage', type: 'number', required: false, description: 'Pagination size for generated lists.' },
      { name: 'blogmarkCategory', type: 'string', required: false, description: 'Default category for blogmark imports.' },
      { name: 'pythonRuntimeMode', type: "'webworker' | 'main-thread'", required: false, description: 'Python runtime execution mode.' },
      { name: 'picoTheme', type: 'string', required: false, description: 'Preferred Pico theme token.' },
      { name: 'categoryMetadata', type: 'object', required: false, description: 'Category metadata keyed by category slug.' },
      { name: 'categorySettings', type: 'object', required: false, description: 'Category render settings keyed by category slug.' },
      { name: 'semanticSimilarityEnabled', type: 'boolean', required: false, description: 'Enable local ONNX embedding-based semantic similarity features.' },
    ],
  },
  {
    name: 'GitAvailability',
    description: 'Git installation availability check result.',
    fields: [
      { name: 'gitFound', type: 'boolean', required: true, description: 'Whether git executable was found.' },
      { name: 'version', type: 'string', required: false, description: 'Git version string when available.' },
    ],
  },
  {
    name: 'RepoState',
    description: 'Repository state for the active project.',
    fields: [
      { name: 'isRepo', type: 'boolean', required: true, description: 'Whether the project directory is a git repository.' },
      { name: 'rootPath', type: 'string', required: false, description: 'Repository root path.' },
      { name: 'currentBranch', type: 'string', required: false, description: 'Current branch name.' },
      { name: 'hasRemote', type: 'boolean', required: true, description: 'Whether a remote is configured.' },
    ],
  },
  {
    name: 'GitStatusDto',
    description: 'Working tree status with file list and counts.',
    fields: [
      { name: 'files', type: 'Array<{ path: string; status: string; previousPath?: string }>', required: true, description: 'List of changed files with status.' },
      { name: 'counts', type: '{ untracked: number; modified: number; deleted: number; renamed: number; staged: number }', required: true, description: 'Counts by change type.' },
    ],
  },
  {
    name: 'GitRemoteStateDto',
    description: 'Remote tracking state for the active project branch.',
    fields: [
      { name: 'localBranch', type: 'string | null', required: true, description: 'Local branch name.' },
      { name: 'upstreamBranch', type: 'string | null', required: true, description: 'Upstream tracking branch name.' },
      { name: 'hasUpstream', type: 'boolean', required: true, description: 'Whether an upstream is configured.' },
      { name: 'ahead', type: 'number', required: true, description: 'Commits ahead of upstream.' },
      { name: 'behind', type: 'number', required: true, description: 'Commits behind upstream.' },
    ],
  },
  {
    name: 'GitActionResult',
    description: 'Result from a git operation (fetch, pull, push, commit).',
    fields: [
      { name: 'success', type: 'boolean', required: true, description: 'Whether the operation succeeded.' },
      { name: 'code', type: 'string', required: false, description: "Error code when failed ('auth-required', 'conflict', 'network', 'action-failed')." },
      { name: 'error', type: 'string', required: false, description: 'Error message when failed.' },
      { name: 'guidance', type: 'string[]', required: false, description: 'Guidance messages for resolving failures.' },
    ],
  },
  {
    name: 'PublishSiteResult',
    description: 'Aggregate result from uploading the rendered site.',
    fields: [
      { name: 'htmlFilesUploaded', type: 'number', required: true, description: 'Number of HTML files uploaded.' },
      { name: 'thumbnailFilesUploaded', type: 'number', required: true, description: 'Number of thumbnail files uploaded.' },
      { name: 'mediaFilesUploaded', type: 'number', required: true, description: 'Number of media files uploaded.' },
      { name: 'filesSkipped', type: 'number', required: true, description: 'Total files skipped (already up-to-date).' },
    ],
  },
  {
    name: 'ImageAnalysisResult',
    description: 'Result from AI image analysis containing generated title, alt text, and caption.',
    fields: [
      { name: 'success', type: 'boolean', required: true, description: 'Whether the analysis succeeded.' },
      { name: 'title', type: 'string', required: false, description: 'Generated image title (3-8 words).' },
      { name: 'alt', type: 'string', required: false, description: 'Generated alt text (5-12 words).' },
      { name: 'caption', type: 'string', required: false, description: 'Generated blog caption (5-20 words).' },
      { name: 'error', type: 'string', required: false, description: 'Error message when analysis failed.' },
    ],
  },
  {
    name: 'PostAnalysisResult',
    description: 'Result from AI post analysis containing suggested title, excerpt, and slug.',
    fields: [
      { name: 'success', type: 'boolean', required: true, description: 'Whether the analysis succeeded.' },
      { name: 'title', type: 'string', required: false, description: 'Suggested post title.' },
      { name: 'excerpt', type: 'string', required: false, description: 'Suggested plain-text excerpt summarizing the post.' },
      { name: 'slug', type: 'string', required: false, description: 'Suggested URL-friendly slug.' },
      { name: 'error', type: 'string', required: false, description: 'Error message when analysis failed.' },
    ],
  },
  {
    name: 'PostTranslationData',
    description: 'Stored translation draft or published translation for a post.',
    fields: [
      { name: 'id', type: 'string', required: true, description: 'Translation identifier.' },
      { name: 'projectId', type: 'string', required: true, description: 'Owning project identifier.' },
      { name: 'translationFor', type: 'string', required: true, description: 'Source post identifier this translation belongs to.' },
      { name: 'language', type: 'string', required: true, description: 'Target language code for the translation.' },
      { name: 'title', type: 'string', required: true, description: 'Translated title.' },
      { name: 'excerpt', type: 'string', required: false, description: 'Translated excerpt.' },
      { name: 'content', type: 'string', required: true, description: 'Translated Markdown content.' },
      { name: 'status', type: "'draft' | 'published' | 'archived'", required: true, description: 'Translation lifecycle state.' },
      { name: 'createdAt', type: 'string', required: true, description: 'Creation timestamp.' },
      { name: 'updatedAt', type: 'string', required: true, description: 'Last update timestamp.' },
      { name: 'publishedAt', type: 'string', required: false, description: 'Publish timestamp when the translation is published.' },
      { name: 'filePath', type: 'string', required: true, description: 'Translation file path on disk.' },
    ],
  },
  {
    name: 'PostTranslationResult',
    description: 'Result from AI post translation containing the saved translation draft.',
    fields: [
      { name: 'success', type: 'boolean', required: true, description: 'Whether the translation succeeded.' },
      { name: 'translation', type: 'PostTranslationData', required: false, description: 'Saved translation draft when successful.' },
      { name: 'error', type: 'string', required: false, description: 'Error message when translation failed.' },
    ],
  },
  {
    name: 'SimilarPost',
    description: 'A post with its semantic similarity score relative to a reference post.',
    fields: [
      { name: 'postId', type: 'string', required: true, description: 'Post identifier.' },
      { name: 'similarity', type: 'number', required: true, description: 'Cosine similarity score from 0.0 to 1.0.' },
    ],
  },
  {
    name: 'TagSuggestion',
    description: 'A tag suggested based on semantic similarity to similar posts.',
    fields: [
      { name: 'name', type: 'string', required: true, description: 'Tag name.' },
      { name: 'score', type: 'number', required: true, description: 'Aggregated suggestion score.' },
    ],
  },
  {
    name: 'DuplicatePair',
    description: 'A pair of posts with high content similarity that may be duplicates.',
    fields: [
      { name: 'postA', type: '{ id: string; title: string; slug: string; publishedAt?: string }', required: true, description: 'First post in the pair.' },
      { name: 'postB', type: '{ id: string; title: string; slug: string; publishedAt?: string }', required: true, description: 'Second post in the pair.' },
      { name: 'similarity', type: 'number', required: true, description: 'Cosine similarity score from 0.0 to 1.0.' },
    ],
  },
];

export const BDS_PYTHON_API_CONTRACT_V1: PythonApiContractV1 = {
  version: '1.15.0',
  generatedAt: '2026-03-07T00:00:00.000Z',
  methods: METHODS_V1,
  dataStructures: DATA_STRUCTURES_V1,
};

export function listPythonApiMethodNames(): string[] {
  return BDS_PYTHON_API_CONTRACT_V1.methods.map((entry) => entry.method);
}

export function getPythonApiMethodContract(methodName: string): PythonApiMethodContractV1 | undefined {
  return BDS_PYTHON_API_CONTRACT_V1.methods.find((entry) => entry.method === methodName);
}

export function getPythonApiDataStructureContracts(): PythonApiDataStructureContractV1[] {
  return BDS_PYTHON_API_CONTRACT_V1.dataStructures;
}
