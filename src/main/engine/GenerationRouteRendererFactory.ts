import type { CategoryRenderSettings } from './PageRenderer';
import type { MenuDocument } from './MenuEngine';
import type { ProjectMetadata } from './MetaEngine';
import type { PostData } from './PostEngine';
import type { PicoThemeName } from '../shared/picoThemes';
import type { CategoryMetadata } from './BlogGenerationEngine';
import { PreviewServer } from './PreviewServer';

interface RenderContext {
  projectContext: {
    projectId: string;
    dataDir: string;
    projectName: string;
    projectDescription?: string;
  };
  metadata?: ProjectMetadata | null;
  menu?: MenuDocument;
  maxPostsPerPage?: number;
}

export function createGenerationRouteRenderer(params: {
  renderWithContext: (pathname: string, context: RenderContext) => Promise<string | null>;
  context: RenderContext;
}): (pathname: string) => Promise<string | null> {
  const routeHtmlCache = new Map<string, Promise<string | null>>();

  return async (pathname: string): Promise<string | null> => {
    const normalizedPathname = decodeURIComponent(pathname.replace(/\/+$/, '') || '/');
    const cached = routeHtmlCache.get(normalizedPathname);
    if (cached) {
      return cached;
    }

    const promise = params.renderWithContext(normalizedPathname, params.context);
    routeHtmlCache.set(normalizedPathname, promise);
    return promise;
  };
}

export function createPreviewBackedGenerationRouteRenderer(params: {
  options: {
    projectId: string;
    dataDir: string;
    projectName: string;
    projectDescription?: string;
    language?: string;
    picoTheme?: PicoThemeName;
    categoryMetadata?: Record<string, CategoryMetadata>;
    categorySettings?: Record<string, CategoryRenderSettings>;
    menu?: MenuDocument;
  };
  maxPostsPerPage: number;
  publishedPostsForLookup: PostData[];
  engines: {
    postEngine: {
      getPostsFiltered: (filter: Parameters<PreviewServer['renderRouteForContext']>[1] extends never ? never : any) => Promise<PostData[]>;
      getPublishedVersion: (postId: string) => Promise<PostData | null>;
      findPublishedBySlug?: (slug: string, dateFilter?: { year: number; month: number }) => Promise<PostData | null>;
      getPost: (postId: string) => Promise<PostData | null>;
      hasPublishedVersion: (postId: string) => Promise<boolean>;
      setProjectContext: (projectId: string, dataDir?: string) => void;
    };
    mediaEngine: {
      getAllMedia: () => Promise<unknown[]>;
      setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
    };
    postMediaEngine: {
      setProjectContext: (projectId: string) => void;
      getLinkedMediaForPost: (postId: string) => Promise<unknown[]>;
      getLinkedMediaDataForPost: (postId: string) => Promise<unknown[]>;
    };
  };
}): (pathname: string) => Promise<string | null> {
  const metadata: ProjectMetadata = {
    name: params.options.projectName,
    description: params.options.projectDescription,
    mainLanguage: params.options.language,
    maxPostsPerPage: params.maxPostsPerPage,
    picoTheme: params.options.picoTheme,
    categoryMetadata: params.options.categoryMetadata,
    categorySettings: params.options.categorySettings,
  };

  const menu = params.options.menu ?? { items: [] };
  const projectContext = {
    projectId: params.options.projectId,
    dataDir: params.options.dataDir,
    projectName: params.options.projectName,
    projectDescription: params.options.projectDescription,
  };

  const mediaItemsPromiseCache = new Map<string, Promise<unknown[]>>();
  const postsByFilterPromiseCache = new Map<string, Promise<PostData[]>>();
  const publishedSnapshotByIdPromiseCache = new Map<string, Promise<PostData | null>>();
  const publishedBySlugIndex = new Map<string, PostData[]>();

  for (const post of params.publishedPostsForLookup) {
    const existing = publishedBySlugIndex.get(post.slug);
    if (existing) {
      existing.push(post);
    } else {
      publishedBySlugIndex.set(post.slug, [post]);
    }
  }

  const serializeFilter = (filter: unknown): string => {
    const normalizeValue = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
      }

      if (value && typeof value === 'object') {
        const sortedEntries = Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nestedValue]) => [key, normalizeValue(nestedValue)] as const);
        return Object.fromEntries(sortedEntries);
      }

      return value;
    };

    return JSON.stringify(normalizeValue(filter));
  };

  const cachedPostEngine = {
    getPostsFiltered: (filter: unknown) => {
      const cacheKey = serializeFilter(filter);
      const cached = postsByFilterPromiseCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const promise = params.engines.postEngine.getPostsFiltered(filter as never);
      postsByFilterPromiseCache.set(cacheKey, promise);
      return promise;
    },
    getPublishedVersion: (postId: string) => {
      const cached = publishedSnapshotByIdPromiseCache.get(postId);
      if (cached) {
        return cached;
      }

      const promise = params.engines.postEngine.getPublishedVersion(postId);
      publishedSnapshotByIdPromiseCache.set(postId, promise);
      return promise;
    },
    findPublishedBySlug: async (slug: string, dateFilter?: { year: number; month: number }) => {
      const candidates = publishedBySlugIndex.get(slug);
      if (!candidates || candidates.length === 0) {
        return null;
      }

      if (!dateFilter) {
        return candidates[0] ?? null;
      }

      const match = candidates.find((candidate) => {
        const createdAt = candidate.createdAt;
        return createdAt.getFullYear() === dateFilter.year
          && createdAt.getMonth() === dateFilter.month;
      });

      return match ?? null;
    },
    getPost: (postId: string) => params.engines.postEngine.getPost(postId),
    hasPublishedVersion: (postId: string) => params.engines.postEngine.hasPublishedVersion(postId),
    setProjectContext: (projectId: string, dataDir?: string) => {
      params.engines.postEngine.setProjectContext(projectId, dataDir);
    },
  };

  const cachedMediaEngine = {
    getAllMedia: () => {
      const cacheKey = `${params.options.projectId}:${params.options.dataDir ?? ''}`;
      const cached = mediaItemsPromiseCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const promise = params.engines.mediaEngine.getAllMedia();
      mediaItemsPromiseCache.set(cacheKey, promise);
      return promise;
    },
    setProjectContext: (projectId: string, dataDir?: string, internalDir?: string) => {
      params.engines.mediaEngine.setProjectContext?.(projectId, dataDir, internalDir);
    },
  };

  const previewServer = new PreviewServer({
    postEngine: cachedPostEngine as never,
    mediaEngine: cachedMediaEngine as never,
    postMediaEngine: params.engines.postMediaEngine as never,
    settingsEngine: {
      setProjectContext: () => {},
      getProjectMetadata: async () => metadata,
    },
    menuEngine: {
      setProjectContext: () => {},
      getMenu: async () => menu,
    },
    getActiveProjectContext: async () => projectContext,
  });

  return createGenerationRouteRenderer({
    renderWithContext: (pathname, context) => previewServer.renderRouteForContext(pathname, context),
    context: {
      projectContext,
      metadata,
      menu,
      maxPostsPerPage: params.maxPostsPerPage,
    },
  });
}
