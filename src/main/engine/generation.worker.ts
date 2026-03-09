/**
 * Worker thread entry point for parallel blog generation.
 *
 * Each worker receives a GenerationWorkerTask via workerData, creates its own
 * rendering pipeline (Liquid, PageRenderer, PreviewServer, route renderer) and
 * renders the assigned pages, writing them to the filesystem.
 *
 * Workers do NOT open database connections. Hash reads come from a pre-loaded
 * map passed in task data. Hash writes are accumulated in memory and sent back
 * to the main thread in the result message for the main thread to persist.
 */
import { parentPort, workerData } from 'worker_threads';
import type {
  GenerationWorkerTask,
  WorkerOutboundMessage,
  SerializedPostData,
} from './GenerationWorkerData';
import {
  deserializePostData,
  deserializeMediaItem,
  deserializePostMap,
  deserializeDateMap,
} from './GenerationWorkerData';
import {
  createDataBackedPostEngine,
  createDataBackedMediaEngine,
  createDataBackedPostMediaEngine,
} from './DataBackedEngines';
import { createPreviewBackedGenerationRouteRenderer } from './GenerationRouteRendererFactory';
import {
  generateSinglePostPages,
  generateCategoryPages,
  generateTagPages,
  generateDateArchivePages,
  generateRootPages,
  generatePageRoutes,
} from './RoutePageGenerationService';
import { writeHtmlPage } from './BlogGenerationOutputService';
import type { PostData } from './PostEngine';

// ---------------------------------------------------------------------------
// In-memory hash store (no DB access)
// ---------------------------------------------------------------------------

/**
 * Creates a purely in-memory hash store.
 * Reads come from the pre-loaded hash map (passed from main thread).
 * Writes are accumulated in `pendingUpdates` and returned to the main thread
 * via the result message so it can persist them in a single connection.
 */
function createWorkerHashStore(hashCache: Map<string, string | null>) {
  const pendingUpdates: Array<{ relativePath: string; hash: string }> = [];

  return {
    async get(_projectId: string, relativePath: string): Promise<string | null> {
      return hashCache.get(relativePath) ?? null;
    },

    async set(_projectId: string, relativePath: string, hash: string): Promise<void> {
      pendingUpdates.push({ relativePath, hash });
      hashCache.set(relativePath, hash);
    },

    pendingUpdates,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(message: WorkerOutboundMessage): void {
  parentPort?.postMessage(message);
}

function deserializePostArray(serialized: SerializedPostData[]): PostData[] {
  return serialized.map(deserializePostData);
}

// ---------------------------------------------------------------------------
// Main worker logic
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const task = workerData as GenerationWorkerTask;

  try {
    // 1. Reconstruct hash cache from pre-loaded entries (no DB needed)
    const hashCache = new Map<string, string | null>();
    for (const [relativePath, hash] of task.hashMapEntries) {
      hashCache.set(relativePath, hash);
    }
    const hashStore = createWorkerHashStore(hashCache);

    // 2. Deserialize post data
    const posts = deserializePostArray(task.posts);
    const lookupPosts = deserializePostArray(task.lookupPosts);
    const mediaItems = (task.mediaItems ?? []).map(deserializeMediaItem);

    // 2b. Reconstruct post file paths for lazy content loading
    const postFilePaths = new Map<string, string>();
    if (task.postFilePathEntries) {
      for (const [postId, filePath] of task.postFilePathEntries) {
        postFilePaths.set(postId, filePath);
      }
    }

    // 2c. Reconstruct post-media links for gallery/album macros
    const postMediaLinks = new Map<string, Array<{ mediaId: string; sortOrder: number }>>();
    if (task.postMediaLinksEntries) {
      for (const [postId, links] of task.postMediaLinksEntries) {
        postMediaLinks.set(postId, links);
      }
    }

    // 3. Reconstruct backlinks Map
    const backlinksMap = new Map<string, Array<{ id: string; title: string; slug: string }>>();
    if (task.backlinksMap) {
      for (const [postId, links] of Object.entries(task.backlinksMap)) {
        backlinksMap.set(postId, links);
      }
    }

    // 4. Create data-backed engines
    const postEngine = createDataBackedPostEngine({ allPosts: lookupPosts, backlinksMap, postFilePaths });
    const mediaEngine = createDataBackedMediaEngine(mediaItems);
    const postMediaEngine = createDataBackedPostMediaEngine({ mediaItems, postMediaLinks });

    // 5. Create route renderer (same factory as main thread, but backed by data)
    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options: {
        ...task.options,
        language: task.options.language,
      },
      projectMainLanguage: task.mainLanguage,
      maxPostsPerPage: task.maxPostsPerPage,
      publishedPostsForLookup: lookupPosts,
      languagePrefix: task.languagePrefix,
      engines: {
        postEngine: postEngine as any,
        mediaEngine: mediaEngine as any,
        postMediaEngine: postMediaEngine as any,
      },
    });

    // 6. Build writePage function using in-memory hash store
    const knownDirectories = new Set<string>();

    const writePage = (projectId: string, urlPath: string, content: string) => {
      const effectiveUrlPath = task.languagePrefix
        ? `${task.languagePrefix.replace(/^\//, '')}/${urlPath}`
        : urlPath;

      return writeHtmlPage({
        projectId,
        htmlDir: task.htmlDir,
        urlPath: effectiveUrlPath,
        content,
        knownDirectories,
        hashCache,
        getGeneratedFileHash: hashStore.get,
        setGeneratedFileHash: hashStore.set,
        refreshHashTimestampOnUnchanged: true,
      });
    };

    const onPageGenerated = (message: string) => {
      send({ type: 'progress', taskId: task.taskId, message });
    };

    // 7. Execute the assigned section
    let pagesGenerated = 0;
    const projectId = task.options.projectId;

    switch (task.section) {
      case 'single': {
        pagesGenerated += await generateSinglePostPages({
          projectId,
          posts,
          renderRoute,
          writePage,
          onPageGenerated,
        });
        break;
      }

      case 'category': {
        const allCategories = new Set(task.allCategories ?? []);
        const postsByCategory = task.postsByCategoryEntries
          ? deserializePostMap(task.postsByCategoryEntries)
          : undefined;

        pagesGenerated += await generateCategoryPages({
          projectId,
          posts,
          allCategories,
          maxPostsPerPage: task.maxPostsPerPage,
          renderRoute,
          writePage,
          onPageGenerated,
          postsByCategory,
        });
        break;
      }

      case 'tag': {
        const allTags = new Set(task.allTags ?? []);
        const postsByTag = task.postsByTagEntries
          ? deserializePostMap(task.postsByTagEntries)
          : undefined;

        pagesGenerated += await generateTagPages({
          projectId,
          posts,
          allTags,
          maxPostsPerPage: task.maxPostsPerPage,
          renderRoute,
          writePage,
          onPageGenerated,
          postsByTag,
        });
        break;
      }

      case 'date': {
        const yearsMap = task.yearsEntries ? deserializeDateMap(task.yearsEntries) : new Map();
        const yearMonthsMap = task.yearMonthsEntries ? deserializeDateMap(task.yearMonthsEntries) : new Map();
        const yearMonthDaysMap = task.yearMonthDaysEntries ? deserializeDateMap(task.yearMonthDaysEntries) : new Map();
        const postsByYear = task.postsByYearEntries ? deserializePostMap(task.postsByYearEntries) : undefined;
        const postsByYearMonth = task.postsByYearMonthEntries ? deserializePostMap(task.postsByYearMonthEntries) : undefined;
        const postsByYearMonthDay = task.postsByYearMonthDayEntries ? deserializePostMap(task.postsByYearMonthDayEntries) : undefined;

        pagesGenerated += await generateDateArchivePages({
          projectId,
          posts,
          yearsMap,
          yearMonthsMap,
          yearMonthDaysMap,
          maxPostsPerPage: task.maxPostsPerPage,
          renderRoute,
          writePage,
          onPageGenerated,
          postsByYear,
          postsByYearMonth,
          postsByYearMonthDay,
        });
        break;
      }

      case 'core': {
        // Core includes root pages and page routes (sitemap/feeds handled by main thread)
        pagesGenerated += await generateRootPages({
          projectId,
          posts,
          maxPostsPerPage: task.maxPostsPerPage,
          renderRoute,
          writePage,
          onPageGenerated,
        });
        pagesGenerated += await generatePageRoutes({
          projectId,
          posts: lookupPosts,
          renderRoute,
          writePage,
          onPageGenerated,
        });
        break;
      }
    }

    // 8. Report result with accumulated hash updates
    send({
      type: 'result',
      taskId: task.taskId,
      pagesGenerated,
      hashUpdates: hashStore.pendingUpdates,
    });
  } catch (err) {
    send({
      type: 'error',
      taskId: task.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

run();
