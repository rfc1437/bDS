import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getMetaEngine, type CategoryMetadata, type ProjectMetadata } from './MetaEngine';
import { getMediaEngine, type MediaData } from './MediaEngine';
import { getMenuEngine, type MenuDocument } from './MenuEngine';
import { getPostMediaEngine } from './PostMediaEngine';
import { getPostEngine, type PostData, type PostFilter } from './PostEngine';
import { getProjectEngine } from './ProjectEngine';
import {
  PageRenderer,
  PREVIEW_ASSETS,
  PREVIEW_IMAGE_ASSETS,
  buildTemplateMenuItems,
  buildCanonicalPostPath,
  clampMaxPostsPerPage,
  parseRoutePagination,
  resolvePageTitle,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
  type MediaEngineContract,
  type PostMediaEngineContract,
} from './PageRenderer';
import { getPicoStylesheetHref, sanitizePicoTheme, sanitizePicoThemeMode } from '../shared/picoThemes';

interface ActiveProjectContext {
  projectId: string;
  dataDir?: string;
  projectName?: string;
  projectDescription?: string;
}

interface PostEngineContract {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPost: (id: string) => Promise<PostData | null>;
  hasPublishedVersion: (id: string) => Promise<boolean>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

interface MetaEngineContract {
  getProjectMetadata: () => Promise<ProjectMetadata | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
  isInitialized?: () => boolean;
  syncOnStartup?: () => Promise<void>;
}

interface MenuEngineContract {
  getMenu: () => Promise<MenuDocument>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

interface PreviewServerDependencies {
  postEngine: PostEngineContract;
  mediaEngine: MediaEngineContract;
  postMediaEngine: PostMediaEngineContract;
  settingsEngine: MetaEngineContract;
  menuEngine: MenuEngineContract;
  getActiveProjectContext: () => Promise<ActiveProjectContext>;
}

export class PreviewServer {
  private readonly postEngine: PostEngineContract;
  private readonly mediaEngine: MediaEngineContract;
  private readonly postMediaEngine: PostMediaEngineContract;
  private readonly settingsEngine: MetaEngineContract;
  private readonly menuEngine: MenuEngineContract;
  private readonly getActiveProjectContext: () => Promise<ActiveProjectContext>;
  private readonly pageRenderer: PageRenderer;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(dependencies?: Partial<PreviewServerDependencies>) {
    this.postEngine = dependencies?.postEngine ?? getPostEngine();
    this.mediaEngine = dependencies?.mediaEngine ?? getMediaEngine();
    this.postMediaEngine = dependencies?.postMediaEngine ?? getPostMediaEngine();
    this.settingsEngine = dependencies?.settingsEngine ?? getMetaEngine();
    this.menuEngine = dependencies?.menuEngine ?? getMenuEngine();
    this.getActiveProjectContext = dependencies?.getActiveProjectContext ?? (async () => {
      const projectEngine = getProjectEngine();
      const activeProject = await projectEngine.getActiveProject();
      const projectId = activeProject?.id ?? 'default';
      const dataDir = projectEngine.getDataDir(projectId, activeProject?.dataPath);
      return {
        projectId,
        dataDir,
        projectName: activeProject?.name,
        projectDescription: activeProject?.description ?? undefined,
      };
    });
    this.pageRenderer = new PageRenderer(this.mediaEngine, this.postMediaEngine, this.postEngine);
  }

  async start(preferredPort = 0): Promise<number> {
    if (this.server && this.port !== null) {
      return this.port;
    }

    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Preview server was not created'));
        return;
      }

      this.server.once('error', reject);
      this.server.listen(preferredPort, '127.0.0.1', () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get preview server address');
    }

    this.port = address.port;
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.port = null;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
    this.port = null;
  }

  getBaseUrl(): string {
    if (this.port === null) {
      throw new Error('Preview server not started');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remoteAddress = req.socket.remoteAddress;
    const isLocal = remoteAddress === '127.0.0.1'
      || remoteAddress === '::1'
      || remoteAddress === '::ffff:127.0.0.1';

    if (!isLocal) {
      this.respond(res, 403, 'Forbidden');
      return;
    }

    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      this.respond(res, 405, 'Method Not Allowed');
      return;
    }

    try {
      const context = await this.getActiveProjectContext();
      this.postEngine.setProjectContext(context.projectId, context.dataDir);
      this.mediaEngine.setProjectContext?.(context.projectId, context.dataDir, context.dataDir);
      this.postMediaEngine.setProjectContext(context.projectId);
      this.settingsEngine.setProjectContext(context.projectId, context.dataDir);
      this.menuEngine.setProjectContext(context.projectId, context.dataDir);

      if (this.settingsEngine.isInitialized && this.settingsEngine.syncOnStartup && !this.settingsEngine.isInitialized()) {
        await this.settingsEngine.syncOnStartup();
      }

      const metadata = await this.settingsEngine.getProjectMetadata();
      const categoryMetadata = this.resolveCategoryMetadata(metadata);
      const menu = await this.menuEngine.getMenu().catch(() => ({ items: [] }));
      const menuItems = buildTemplateMenuItems(menu, categoryMetadata);
      const categorySettings = this.resolveCategorySettings(metadata);
      const listExcludedCategories = this.resolveListExcludedCategories(categorySettings);
      const language = metadata?.mainLanguage?.trim() || 'en';
      const pageTitle = resolvePageTitle(metadata, context.projectName, context.projectDescription);
      const maxPostsPerPage = clampMaxPostsPerPage(metadata?.maxPostsPerPage);
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const requestTheme = sanitizePicoTheme(requestUrl.searchParams.get('theme'));
      const previewThemeMode = sanitizePicoThemeMode(requestUrl.searchParams.get('mode'));
      const useDraftContent = requestUrl.searchParams.get('draft') === 'true';
      const draftPostId = requestUrl.searchParams.get('postId') || undefined;
      const appliedTheme = requestTheme ?? sanitizePicoTheme((metadata as { picoTheme?: unknown } | null)?.picoTheme);
      const picoStylesheetHref = getPicoStylesheetHref(appliedTheme);
      const htmlRewriteContext = await this.buildHtmlRewriteContext();
      const pathname = decodeURIComponent(requestUrl.pathname.replace(/\/+$/, '') || '/');

      if (pathname === '/__style-preview') {
        const stylePreviewHtml = await this.renderStylePreview(htmlRewriteContext, {
          pageTitle,
          language,
          menuItems,
          picoStylesheetHref,
          htmlThemeAttribute: previewThemeMode && previewThemeMode !== 'auto' ? `data-theme="${previewThemeMode}"` : undefined,
        }, categorySettings, listExcludedCategories);
        this.respond(res, 200, stylePreviewHtml);
        return;
      }

      const asset = await this.resolveAsset(pathname);
      if (asset) {
        this.respondAsset(res, asset.contentType, asset.body);
        return;
      }

      const imageAsset = await this.resolveImageAsset(pathname);
      if (imageAsset) {
        this.respondAsset(res, imageAsset.contentType, imageAsset.body);
        return;
      }

      const mediaAsset = await this.resolveMediaAsset(pathname, context.dataDir);
      if (mediaAsset) {
        this.respondAsset(res, mediaAsset.contentType, mediaAsset.body);
        return;
      }

      const result = await this.resolveRoute(pathname, maxPostsPerPage, htmlRewriteContext, {
        pageTitle,
        language,
        menuItems,
        picoStylesheetHref,
        htmlThemeAttribute: undefined,
      }, categorySettings, categoryMetadata, listExcludedCategories, {
        useDraftContent,
        draftPostId,
      });
      if (!result) {
        const notFoundHtml = await this.pageRenderer.renderNotFound({
          page_title: '404 Not Found',
          language,
          menu_items: menuItems,
          pico_stylesheet_href: picoStylesheetHref,
          html_theme_attribute: undefined,
        });
        this.respond(res, 404, notFoundHtml);
        return;
      }

      this.respond(res, 200, result);
    } catch (error) {
      console.error('[PreviewServer] Request failed:', error);
      this.respond(res, 500, 'Internal Server Error');
    }
  }

  private async resolveRoute(
    pathname: string,
    maxPostsPerPage: number,
    rewriteContext: HtmlRewriteContext,
    pageContext: { pageTitle: string; language: string; menuItems: ReturnType<typeof buildTemplateMenuItems>; picoStylesheetHref: string; htmlThemeAttribute?: string },
    categorySettings: Record<string, CategoryRenderSettings>,
    categoryMetadata: Record<string, CategoryMetadata>,
    listExcludedCategories: string[],
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

    const postsYearMonthSlugMatch = pagedPathname.match(/^\/posts\/(\d{4})\/(\d{1,2})\/([^/]+)$/);
    if (postsYearMonthSlugMatch) {
      const year = Number(postsYearMonthSlugMatch[1]);
      const month = Number(postsYearMonthSlugMatch[2]);
      const slug = postsYearMonthSlugMatch[3].replace(/\.html?$/i, '');
      if (month < 1 || month > 12) return null;
      const post = await this.findSinglePostBySlug(slug, singlePostOptions, { year, month: month - 1 });
      if (!post) return null;
      return this.pageRenderer.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    const postsSlugMatch = pagedPathname.match(/^\/posts\/([^/]+)$/);
    if (postsSlugMatch) {
      const slug = postsSlugMatch[1].replace(/\.html?$/i, '');
      const post = await this.findSinglePostBySlug(slug, singlePostOptions);
      if (!post) return null;
      return this.pageRenderer.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    const legacyPostsYearMonthSlugMatch = pagedPathname.match(/^\/post\/(\d{4})\/(\d{1,2})\/([^/]+)$/);
    if (legacyPostsYearMonthSlugMatch) {
      const year = Number(legacyPostsYearMonthSlugMatch[1]);
      const month = Number(legacyPostsYearMonthSlugMatch[2]);
      const slug = legacyPostsYearMonthSlugMatch[3].replace(/\.html?$/i, '');
      if (month < 1 || month > 12) return null;
      const post = await this.findSinglePostBySlug(slug, singlePostOptions, { year, month: month - 1 });
      if (!post) return null;
      return this.pageRenderer.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    const legacyPostsSlugMatch = pagedPathname.match(/^\/post\/([^/]+)$/);
    if (legacyPostsSlugMatch) {
      const slug = legacyPostsSlugMatch[1].replace(/\.html?$/i, '');
      const post = await this.findSinglePostBySlug(slug, singlePostOptions);
      if (!post) return null;
      return this.pageRenderer.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    if (pagedPathname === '/') {
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', excludeCategories: listExcludedCategories }, pageOptions);
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const tagMatch = pagedPathname.match(/^\/tag\/([^/]+)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', tags: [tag], excludeCategories: listExcludedCategories }, pageOptions);
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const categoryMatch = pagedPathname.match(/^\/category\/([^/]+)$/);
    if (categoryMatch) {
      const category = categoryMatch[1];
      const categoryDisplayTitle = categoryMetadata[category]?.title?.trim() || category;
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', categories: [category], excludeCategories: listExcludedCategories }, pageOptions);
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const daySlugMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([^/]+)$/);
    if (daySlugMatch) {
      const year = Number(daySlugMatch[1]);
      const month = Number(daySlugMatch[2]);
      const day = Number(daySlugMatch[3]);
      const slug = daySlugMatch[4];
      const post = await this.findSinglePostBySlug(slug, singlePostOptions, { year, month: month - 1, day });
      if (!post) return null;
      return this.pageRenderer.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    const dayMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (dayMatch) {
      const year = Number(dayMatch[1]);
      const month = Number(dayMatch[2]);
      const day = Number(dayMatch[3]);
      const result = await this.loadPostsForDayPage(year, month, day, {
        ...pageOptions,
        excludeCategories: listExcludedCategories,
      });
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const monthMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})$/);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const month = Number(monthMatch[2]);
      if (month < 1 || month > 12) return null;
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', year, month: month - 1, excludeCategories: listExcludedCategories }, pageOptions);
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const yearMatch = pagedPathname.match(/^\/(\d{4})$/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', year, excludeCategories: listExcludedCategories }, pageOptions);
      return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
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
      }, this.postEngine);
    }

    const pageSlugMatch = pagedPathname.match(/^\/([^/]+)$/);
    if (pageSlugMatch) {
      const slug = pageSlugMatch[1];
      const pages = await this.loadPublishedSnapshots({ status: 'published', categories: ['page'] }, { maxPostsPerPage });
      const pagePost = pages.find((candidate) => candidate.slug === slug) || null;
      if (!pagePost) return null;
      return this.pageRenderer.renderSinglePost(pagePost, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      }, this.postEngine);
    }

    return null;
  }

  private async renderStylePreview(
    rewriteContext: HtmlRewriteContext,
    pageContext: { pageTitle: string; language: string; menuItems: ReturnType<typeof buildTemplateMenuItems>; picoStylesheetHref: string; htmlThemeAttribute?: string },
    categorySettings: Record<string, CategoryRenderSettings>,
    listExcludedCategories: string[],
  ): Promise<string> {
    const result = await this.loadPublishedSnapshotsPage({ status: 'published', excludeCategories: listExcludedCategories }, {
      maxPostsPerPage: 10,
      page: 1,
    });

    if (result.posts.length === 0) {
      return this.pageRenderer.renderNotFound({
        page_title: pageContext.pageTitle,
        language: pageContext.language,
        menu_items: pageContext.menuItems,
        pico_stylesheet_href: pageContext.picoStylesheetHref,
        html_theme_attribute: pageContext.htmlThemeAttribute,
      });
    }

    return this.pageRenderer.renderPostList(result.posts, rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'root' },
      basePathname: '/__style-preview',
      pagination: { page: 1, maxPostsPerPage: 10, totalPosts: result.totalPosts },
      categorySettings,
      page_title: pageContext.pageTitle,
      language: pageContext.language,
      menu_items: pageContext.menuItems,
      pico_stylesheet_href: pageContext.picoStylesheetHref,
      html_theme_attribute: pageContext.htmlThemeAttribute,
    }, this.postEngine);
  }

  private async findPublishedPostBySlug(slug: string, dateFilter?: { year: number; month: number }): Promise<PostData | null> {
    if (!slug) return null;

    const filter: PostFilter = {
      ...(dateFilter ? { year: dateFilter.year, month: dateFilter.month } : {}),
    };

    const candidates = await this.loadPublishedSnapshots(filter);
    const match = candidates.find((candidate) => candidate.slug === slug);
    if (!match) return null;

    return match;
  }

  private async findSinglePostBySlug(
    slug: string,
    singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string },
    dateFilter?: { year: number; month: number; day?: number },
  ): Promise<PostData | null> {
    if (singlePostOptions?.useDraftContent && singlePostOptions.draftPostId) {
      const draftCandidate = await this.postEngine.getPost(singlePostOptions.draftPostId);
      if (draftCandidate && draftCandidate.status === 'draft' && draftCandidate.slug === slug) {
        if (!dateFilter) {
          return draftCandidate;
        }

        const sameYear = draftCandidate.createdAt.getFullYear() === dateFilter.year;
        const sameMonth = draftCandidate.createdAt.getMonth() === dateFilter.month;
        const sameDay = dateFilter.day === undefined || draftCandidate.createdAt.getDate() === dateFilter.day;
        if (sameYear && sameMonth && sameDay) {
          return draftCandidate;
        }
      }
    }

    const fallbackDateFilter = dateFilter ? { year: dateFilter.year, month: dateFilter.month } : undefined;
    return this.findPublishedPostBySlug(slug, fallbackDateFilter);
  }

  private async loadPostsForDay(
    year: number,
    month: number,
    day: number,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ): Promise<PostData[]> {
    const result = await this.loadPostsForDayPage(year, month, day, pagination);
    return result.posts;
  }

  private async loadPostsForDayPage(
    year: number,
    month: number,
    day: number,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ): Promise<{ posts: PostData[]; totalPosts: number }> {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { posts: [], totalPosts: 0 };
    }

    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

    const result = await this.loadPublishedSnapshotsPage({
      status: 'published',
      excludeCategories: pagination?.excludeCategories,
      startDate,
      endDate,
    }, pagination);

    const posts = result.posts.filter((post) => {
      const createdAt = post.createdAt;
      return createdAt.getFullYear() === year
        && createdAt.getMonth() === month - 1
        && createdAt.getDate() === day;
    });

    return {
      posts,
      totalPosts: result.totalPosts,
    };
  }

  private buildSnapshotBaseFilter(filter: PostFilter): PostFilter {
    const baseFilter: PostFilter = {};

    if (filter.startDate) baseFilter.startDate = filter.startDate;
    if (filter.endDate) baseFilter.endDate = filter.endDate;
    if (filter.year !== undefined) baseFilter.year = filter.year;
    if (filter.month !== undefined) baseFilter.month = filter.month;

    return baseFilter;
  }

  private async toPublishedSnapshot(post: PostData): Promise<PostData | null> {
    if (post.status === 'published') {
      return post;
    }

    if (post.status === 'draft') {
      return await this.postEngine.getPublishedVersion(post.id);
    }

    return null;
  }

  private async loadPublishedSnapshots(
    filter: PostFilter,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ): Promise<PostData[]> {
    const result = await this.loadPublishedSnapshotsPage(filter, pagination);
    return result.posts;
  }

  private paginateSnapshots(
    snapshots: PostData[],
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ): { posts: PostData[]; totalPosts: number } {
    const totalPosts = snapshots.length;

    if (typeof pagination?.maxPostsPerPage !== 'number') {
      return { posts: snapshots, totalPosts };
    }

    const maxPostsPerPage = pagination.maxPostsPerPage;
    const page = Number.isInteger(pagination.page) && (pagination.page ?? 0) > 0
      ? (pagination.page as number)
      : 1;
    const offset = (page - 1) * maxPostsPerPage;

    return {
      posts: snapshots.slice(offset, offset + maxPostsPerPage),
      totalPosts,
    };
  }

  private async loadPublishedSnapshotsPage(
    filter: PostFilter,
    pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
  ): Promise<{ posts: PostData[]; totalPosts: number }> {
    if (filter.status && filter.status !== 'published') {
      return { posts: [], totalPosts: 0 };
    }

    const baseFilter = this.buildSnapshotBaseFilter(filter);
    const publishedCandidates = await this.postEngine.getPostsFiltered({
      ...baseFilter,
      status: 'published',
      excludeCategories: filter.excludeCategories,
    });
    const draftCandidates = await this.postEngine.getPostsFiltered({
      ...baseFilter,
      status: 'draft',
      excludeCategories: filter.excludeCategories,
    });

    const snapshotCandidates = await Promise.all([
      ...publishedCandidates.map((post) => this.toPublishedSnapshot(post)),
      ...draftCandidates.map((post) => this.toPublishedSnapshot(post)),
    ]);

    let snapshots = snapshotCandidates.filter((post): post is PostData => post !== null);

    if (filter.tags && filter.tags.length > 0) {
      snapshots = snapshots.filter((post) => filter.tags!.every((tag) => post.tags.includes(tag)));
    }

    if (filter.categories && filter.categories.length > 0) {
      snapshots = snapshots.filter((post) => filter.categories!.some((category) => post.categories.includes(category)));
    }

    snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginateSnapshots(snapshots, pagination);
  }

  private async buildHtmlRewriteContext(): Promise<HtmlRewriteContext> {
    const publishedPosts = await this.loadPublishedSnapshots({ status: 'published' });
    const canonicalPostPathBySlug = new Map<string, string>();

    for (const post of publishedPosts) {
      canonicalPostPathBySlug.set(post.slug, buildCanonicalPostPath(post));
    }

    const canonicalMediaPathBySourcePath = new Map<string, string>();
    try {
      const mediaItems = await this.mediaEngine.getAllMedia();
      for (const media of mediaItems) {
        const year = media.createdAt.getFullYear();
        const month = String(media.createdAt.getMonth() + 1).padStart(2, '0');
        const canonicalPath = `/media/${year}/${month}/${media.filename}`;

        const originalNameKey = `media/${year}/${month}/${media.originalName}`.toLowerCase();
        const filenameKey = `media/${year}/${month}/${media.filename}`.toLowerCase();

        canonicalMediaPathBySourcePath.set(originalNameKey, canonicalPath);
        canonicalMediaPathBySourcePath.set(filenameKey, canonicalPath);
      }
    } catch {
      // Keep media map empty if media metadata cannot be loaded.
    }

    return {
      canonicalPostPathBySlug,
      canonicalMediaPathBySourcePath,
    };
  }

  private async resolveAsset(pathname: string): Promise<{ contentType: string; body: Buffer } | null> {
    const match = pathname.match(/^\/assets\/([^/]+)$/);
    if (!match) return null;

    const assetName = match[1];
    const assetDefinition = PREVIEW_ASSETS[assetName];
    if (!assetDefinition) return null;

    try {
      const body = assetDefinition.sourceText !== undefined
        ? Buffer.from(assetDefinition.sourceText, 'utf-8')
        : await readFile(require.resolve(assetDefinition.modulePath as string));
      return {
        contentType: assetDefinition.contentType,
        body,
      };
    } catch (error) {
      console.error(`[PreviewServer] Failed to read local asset: ${assetDefinition.modulePath ?? assetName}`, error);
      return null;
    }
  }

  private async resolveImageAsset(pathname: string): Promise<{ contentType: string; body: Buffer } | null> {
    const match = pathname.match(/^\/images\/([^/]+)$/);
    if (!match) return null;

    const assetName = match[1] as keyof typeof PREVIEW_IMAGE_ASSETS;
    const assetDefinition = PREVIEW_IMAGE_ASSETS[assetName];
    if (!assetDefinition) return null;

    try {
      const absolutePath = require.resolve(assetDefinition.modulePath);
      const body = await readFile(absolutePath);
      return {
        contentType: assetDefinition.contentType,
        body,
      };
    } catch (error) {
      console.error(`[PreviewServer] Failed to read image asset: ${assetDefinition.modulePath}`, error);
      return null;
    }
  }

  private async resolveMediaAsset(pathname: string, dataDir?: string): Promise<{ contentType: string; body: Buffer } | null> {
    const match = pathname.match(/^\/media\/(.+)$/);
    if (!match || !dataDir) return null;

    const relativeMediaPath = path.posix.normalize(`media/${match[1]}`);
    if (!relativeMediaPath.startsWith('media/')) {
      return null;
    }

    const absoluteDataDir = path.resolve(dataDir);
    const mediaRoot = path.resolve(absoluteDataDir, 'media');
    const absoluteMediaPath = path.resolve(absoluteDataDir, relativeMediaPath);

    if (absoluteMediaPath !== mediaRoot && !absoluteMediaPath.startsWith(`${mediaRoot}${path.sep}`)) {
      return null;
    }

    try {
      const body = await readFile(absoluteMediaPath);
      return {
        contentType: this.getMediaContentType(absoluteMediaPath),
        body,
      };
    } catch {
      return null;
    }
  }

  private getMediaContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.svg':
        return 'image/svg+xml';
      case '.bmp':
        return 'image/bmp';
      case '.avif':
        return 'image/avif';
      case '.mp4':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      case '.mov':
        return 'video/quicktime';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  private resolveCategoryMetadata(metadata: ProjectMetadata | null): Record<string, CategoryMetadata> {
    const defaults: Record<string, CategoryMetadata> = {
      article: { renderInLists: true, showTitle: true, title: 'article' },
      picture: { renderInLists: true, showTitle: true, title: 'picture' },
      aside: { renderInLists: true, showTitle: false, title: 'aside' },
      page: { renderInLists: false, showTitle: true, title: 'page' },
    };

    const rawMetadata = (metadata as { categoryMetadata?: unknown } | null)?.categoryMetadata;
    const rawLegacySettings = (metadata as { categorySettings?: unknown } | null)?.categorySettings;
    const source = rawMetadata && typeof rawMetadata === 'object' ? rawMetadata : rawLegacySettings;

    if (!source || typeof source !== 'object') {
      return defaults;
    }

    const merged: Record<string, CategoryMetadata> = { ...defaults };
    for (const [category, rawValue] of Object.entries(source as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== 'object') {
        continue;
      }

      const typedRawValue = rawValue as Record<string, unknown>;
      const title = typeof typedRawValue.title === 'string' && typedRawValue.title.trim().length > 0
        ? typedRawValue.title.trim()
        : category;
      merged[category] = {
        renderInLists: typedRawValue.renderInLists !== false,
        showTitle: typedRawValue.showTitle !== false,
        title,
      };
    }

    return merged;
  }

  private resolveCategorySettings(metadata: ProjectMetadata | null): Record<string, CategoryRenderSettings> {
    const categoryMetadata = this.resolveCategoryMetadata(metadata);
    const mergedSettings: Record<string, CategoryRenderSettings> = {};
    for (const [category, value] of Object.entries(categoryMetadata)) {
      mergedSettings[category] = {
        renderInLists: value.renderInLists,
        showTitle: value.showTitle,
      };
    }
    return mergedSettings;
  }

  private resolveListExcludedCategories(categorySettings: Record<string, CategoryRenderSettings>): string[] {
    return Object.entries(categorySettings)
      .filter(([, settings]) => settings.renderInLists === false)
      .map(([category]) => category);
  }

  private respond(res: ServerResponse, status: number, body: string): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  private respondAsset(res: ServerResponse, contentType: string, body: Buffer): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }
}
