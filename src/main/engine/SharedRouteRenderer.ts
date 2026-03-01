import type { MenuDocument } from './MenuEngine';
import type { ProjectMetadata } from './MetaEngine';
import { getPicoStylesheetHref, sanitizePicoTheme } from '../shared/picoThemes';
import {
  buildTemplateMenuItems,
  clampMaxPostsPerPage,
  parseRoutePagination,
  resolvePageTitle,
  type BacklinkEntry,
  type PostEngineContract,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
  type PageRenderer,
} from './PageRenderer';
import type { CategoryMetadata } from './MetaEngine';
import type { PostData, PostFilter } from './PostEngine';

export interface SharedActiveProjectContext {
  projectId: string;
  dataDir?: string;
  projectName?: string;
  projectDescription?: string;
}

export interface SharedRouteRenderOptions {
  projectContext: SharedActiveProjectContext;
  metadata?: ProjectMetadata | null;
  menu?: MenuDocument;
  htmlRewriteContext?: HtmlRewriteContext;
  skipContextSetup?: boolean;
  maxPostsPerPage?: number;
  requestTheme?: string | null;
  htmlThemeAttribute?: string;
  allowEmptyArchiveRender?: boolean;
  singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string };
}

export interface SharedRouteRenderServices<TCategoryMetadata> {
  postEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
  };
  mediaEngine: {
    setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
  };
  postMediaEngine: {
    setProjectContext: (projectId: string) => void;
  };
  settingsEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
    getProjectMetadata: () => Promise<ProjectMetadata | null>;
    isInitialized?: () => boolean;
    syncOnStartup?: () => Promise<void>;
  };
  menuEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
    getMenu: () => Promise<MenuDocument>;
  };
  resolveCategoryMetadata: (metadata: ProjectMetadata | null) => Record<string, TCategoryMetadata>;
  resolveCategorySettings: (metadata: ProjectMetadata | null) => Record<string, CategoryRenderSettings>;
  resolveListExcludedCategories: (settings: Record<string, CategoryRenderSettings>) => string[];
  buildHtmlRewriteContext: () => Promise<HtmlRewriteContext>;
  resolveTagColorByName: (projectContext: SharedActiveProjectContext) => Promise<Record<string, string>>;
  resolveTagTemplateSettings?: (projectContext: SharedActiveProjectContext) => Promise<Record<string, { postTemplateSlug?: string | null }>>;
  pageRenderer: Pick<PageRenderer, 'renderPostList' | 'renderSinglePost'>;
  postEngineForMacros?: PostEngineContract;
  loadPublishedSnapshotsPage: (
    filter: PostFilter,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ) => Promise<{ posts: PostData[]; totalPosts: number }>;
  loadPublishedSnapshots: (
    filter: PostFilter,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ) => Promise<PostData[]>;
  loadPostsForDayPage: (
    year: number,
    month: number,
    day: number,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ) => Promise<{ posts: PostData[]; totalPosts: number }>;
  findSinglePostBySlug: (
    slug: string,
    singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string },
    dateFilter?: { year: number; month: number; day?: number },
  ) => Promise<PostData | null>;
  getLinkedBy?: (postId: string) => Promise<{ id: string; title: string; slug: string }[]>;
}

const MAX_BACKLINK_SLUG_LENGTH = 30;

function truncateSlug(slug: string): string {
  if (slug.length <= MAX_BACKLINK_SLUG_LENGTH) return slug;
  return slug.slice(0, MAX_BACKLINK_SLUG_LENGTH) + '...';
}

async function resolveBacklinks(
  postId: string,
  rewriteContext: HtmlRewriteContext,
  getLinkedBy?: (postId: string) => Promise<{ id: string; title: string; slug: string }[]>,
): Promise<BacklinkEntry[]> {
  if (!getLinkedBy) return [];
  const linkedPosts = await getLinkedBy(postId);
  if (linkedPosts.length === 0) return [];

  return linkedPosts
    .map((linked) => {
      const canonical = rewriteContext.canonicalPostPathBySlug.get(linked.slug);
      if (!canonical) return null;
      return {
        slug: linked.slug,
        display_slug: truncateSlug(linked.slug),
        path: canonical,
      };
    })
    .filter((entry): entry is BacklinkEntry => entry !== null);
}

async function resolveRouteWithSharedServices(
  pathname: string,
  maxPostsPerPage: number,
  rewriteContext: HtmlRewriteContext,
  pageContext: {
    pageTitle: string;
    language: string;
    menuItems: ReturnType<typeof buildTemplateMenuItems>;
    picoStylesheetHref: string;
    htmlThemeAttribute?: string;
  },
  categorySettings: Record<string, CategoryRenderSettings>,
  categoryMetadata: Record<string, CategoryMetadata>,
  tagColorByName: Record<string, string>,
  tagTemplateSettings: Record<string, { postTemplateSlug?: string | null }>,
  listExcludedCategories: string[],
  services: SharedRouteRenderServices<CategoryMetadata>,
  allowEmptyArchiveRender: boolean,
  singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string },
): Promise<string | null> {
  const routePagination = parseRoutePagination(pathname);
  if (!routePagination) {
    return null;
  }

  const pagedPathname = routePagination.pathname;
  const page = routePagination.page;
  const pageOptions = {
    maxPostsPerPage,
    page,
  };

  if (pagedPathname === '/') {
    const result = await services.loadPublishedSnapshotsPage({ status: 'published', excludeCategories: listExcludedCategories }, pageOptions);
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'root' },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const tagMatch = pagedPathname.match(/^\/tag\/([^/]+)$/);
  if (tagMatch) {
    const tag = tagMatch[1];
    const result = await services.loadPublishedSnapshotsPage({ status: 'published', tags: [tag], excludeCategories: listExcludedCategories }, pageOptions);
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'non-date',
      archiveContext: { kind: 'tag', name: tag },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const categoryMatch = pagedPathname.match(/^\/category\/([^/]+)$/);
  if (categoryMatch) {
    const category = categoryMatch[1];
    const categoryDisplayTitle = categoryMetadata[category]?.title?.trim() || category;
    const result = await services.loadPublishedSnapshotsPage({ status: 'published', categories: [category], excludeCategories: listExcludedCategories }, pageOptions);
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'non-date',
      archiveContext: { kind: 'category', name: categoryDisplayTitle },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const daySlugMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([^/]+)$/);
  if (daySlugMatch) {
    const year = Number(daySlugMatch[1]);
    const month = Number(daySlugMatch[2]);
    const day = Number(daySlugMatch[3]);
    const slug = daySlugMatch[4];
    const post = await services.findSinglePostBySlug(slug, singlePostOptions, { year, month, day });
    if (!post) return null;
    const backlinks = await resolveBacklinks(post.id, rewriteContext, services.getLinkedBy);
    return services.pageRenderer.renderSinglePost(post, rewriteContext, {
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      tag_color_by_name: tagColorByName,
      tagSettings: tagTemplateSettings,
      categorySettings: categorySettings as Record<string, { postTemplateSlug?: string | null }>,
      backlinks,
    }, services.postEngineForMacros);
  }

  const dayMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (dayMatch) {
    const year = Number(dayMatch[1]);
    const month = Number(dayMatch[2]);
    const day = Number(dayMatch[3]);
    const result = await services.loadPostsForDayPage(year, month, day, {
      ...pageOptions,
      excludeCategories: listExcludedCategories,
    });
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'day', year, month, day },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const monthMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) return null;
    const result = await services.loadPublishedSnapshotsPage({ status: 'published', year, month, excludeCategories: listExcludedCategories }, pageOptions);
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'month', year, month },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const yearMatch = pagedPathname.match(/^\/(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const result = await services.loadPublishedSnapshotsPage({ status: 'published', year, excludeCategories: listExcludedCategories }, pageOptions);
    return services.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'year', year },
      basePathname: pagedPathname,
      pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      renderEmptyState: allowEmptyArchiveRender,
    }, services.postEngineForMacros);
  }

  const pageSlugMatch = pagedPathname.match(/^\/([^/]+)$/);
  if (pageSlugMatch) {
    const slug = pageSlugMatch[1];
    const pages = await services.loadPublishedSnapshots({ status: 'published', categories: ['page'] }, { maxPostsPerPage });
    const pagePost = pages.find((candidate) => candidate.slug === slug) || null;
    if (!pagePost) return null;
    const backlinks = await resolveBacklinks(pagePost.id, rewriteContext, services.getLinkedBy);
    return services.pageRenderer.renderSinglePost(pagePost, rewriteContext, {
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
      tag_color_by_name: tagColorByName,
      tagSettings: tagTemplateSettings,
      categorySettings: categorySettings as Record<string, { postTemplateSlug?: string | null }>,
      backlinks,
    }, services.postEngineForMacros);
  }

  return null;
}

export async function renderRouteWithSharedContext<TCategoryMetadata>(
  pathname: string,
  options: SharedRouteRenderOptions,
  services: SharedRouteRenderServices<TCategoryMetadata>,
): Promise<string | null> {
  if (!options.skipContextSetup) {
    services.postEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);
    services.mediaEngine.setProjectContext?.(options.projectContext.projectId, options.projectContext.dataDir, options.projectContext.dataDir);
    services.postMediaEngine.setProjectContext(options.projectContext.projectId);
    services.settingsEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);
    services.menuEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);
  }

  let metadata = options.metadata;
  if (metadata === undefined) {
    if (services.settingsEngine.isInitialized && services.settingsEngine.syncOnStartup && !services.settingsEngine.isInitialized()) {
      await services.settingsEngine.syncOnStartup();
    }
    metadata = await services.settingsEngine.getProjectMetadata();
  }

  const categoryMetadata = services.resolveCategoryMetadata(metadata ?? null);
  const menu = options.menu ?? await services.menuEngine.getMenu().catch(() => ({ items: [] }));
  const menuItems = buildTemplateMenuItems(menu, categoryMetadata as Record<string, { title?: string }>);
  const categorySettings = services.resolveCategorySettings(metadata ?? null);
  const listExcludedCategories = services.resolveListExcludedCategories(categorySettings);
  const language = metadata?.mainLanguage?.trim() || 'en';
  const pageTitle = resolvePageTitle(metadata ?? null, options.projectContext.projectName, options.projectContext.projectDescription);
  const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage ?? metadata?.maxPostsPerPage);
  const appliedTheme = sanitizePicoTheme(options.requestTheme)
    ?? sanitizePicoTheme((metadata as { picoTheme?: unknown } | null)?.picoTheme);
  const picoStylesheetHref = getPicoStylesheetHref(appliedTheme);
  const htmlRewriteContext = options.htmlRewriteContext ?? await services.buildHtmlRewriteContext();
  const tagColorByName = await services.resolveTagColorByName(options.projectContext);
  const tagTemplateSettings = await services.resolveTagTemplateSettings?.(options.projectContext) ?? {};
  const normalizedPathname = decodeURIComponent(pathname.replace(/\/+$/, '') || '/');

  return resolveRouteWithSharedServices(normalizedPathname, maxPostsPerPage, htmlRewriteContext, {
    pageTitle,
    language,
    menuItems,
    picoStylesheetHref,
    htmlThemeAttribute: options.htmlThemeAttribute,
  }, categorySettings, categoryMetadata as Record<string, CategoryMetadata>, tagColorByName, tagTemplateSettings, listExcludedCategories, services as SharedRouteRenderServices<CategoryMetadata>, options.allowEmptyArchiveRender === true, options.singlePostOptions);
}
