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
  resolvePageTitle,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
  type MediaEngineContract,
  type PostMediaEngineContract,
  type PythonMacroRendererContract,
} from './PageRenderer';
import { getScriptEngine } from './ScriptEngine';
import { getTemplateEngine } from './TemplateEngine';
import { getPythonMacroWorkerRuntime } from './PythonMacroWorkerRuntime';
import { getPicoStylesheetHref, sanitizePicoTheme, sanitizePicoThemeMode } from '../shared/picoThemes';
import { renderRouteWithSharedContext } from './SharedRouteRenderer';
import {
  findSinglePostBySlug,
  loadPostsForDayPage,
  loadPublishedSnapshots,
  loadPublishedSnapshotsPage,
} from './SharedSnapshotService';
import { buildCalendarArchiveData } from './GenerationSitemapFeedService';
import { loadPublishedGenerationSets } from './GenerationPostSnapshotService';

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
  findPublishedBySlug?: (slug: string, dateFilter?: { year: number; month: number }) => Promise<PostData | null>;
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
  userTemplatesDir?: string;
}

interface SerializedTag {
  name?: unknown;
  color?: unknown;
}

export class PreviewServer {
  private readonly postEngine: PostEngineContract;
  private readonly mediaEngine: MediaEngineContract;
  private readonly postMediaEngine: PostMediaEngineContract;
  private readonly settingsEngine: MetaEngineContract;
  private readonly menuEngine: MenuEngineContract;
  private readonly getActiveProjectContext: () => Promise<ActiveProjectContext>;
  private readonly pageRenderer: PageRenderer;
  private readonly tagColorByNameCache = new Map<string, Promise<Record<string, string>>>();
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
    this.pageRenderer = new PageRenderer(
      this.mediaEngine,
      this.postMediaEngine,
      this.postEngine,
      buildPythonMacroRenderer(),
      dependencies?.userTemplatesDir ?? getTemplateEngine().getTemplatesDirectory(),
    );
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

  async renderRouteForContext(
    pathname: string,
    options: {
      projectContext: ActiveProjectContext;
      metadata?: ProjectMetadata | null;
      menu?: MenuDocument;
      htmlRewriteContext?: HtmlRewriteContext;
      skipContextSetup?: boolean;
      maxPostsPerPage?: number;
      requestTheme?: string | null;
      htmlThemeAttribute?: string;
      allowEmptyArchiveRender?: boolean;
      singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string };
    },
  ): Promise<string | null> {
    return renderRouteWithSharedContext(pathname, options, {
      postEngine: this.postEngine,
      mediaEngine: this.mediaEngine,
      postMediaEngine: this.postMediaEngine,
      settingsEngine: this.settingsEngine,
      menuEngine: this.menuEngine,
      resolveCategoryMetadata: (metadata) => this.resolveCategoryMetadata(metadata),
      resolveCategorySettings: (metadata) => this.resolveCategorySettings(metadata),
      resolveListExcludedCategories: (settings) => this.resolveListExcludedCategories(settings),
      buildHtmlRewriteContext: () => this.buildHtmlRewriteContext(),
      resolveTagColorByName: (projectContext) => this.resolveTagColorByName(projectContext),
      resolveTagTemplateSettings: (projectContext) => this.resolveTagTemplateSettings(projectContext),
      pageRenderer: this.pageRenderer,
      postEngineForMacros: this.postEngine,
      loadPublishedSnapshotsPage: (filter, pagination) => loadPublishedSnapshotsPage(this.postEngine, filter, pagination),
      loadPublishedSnapshots: (filter, pagination) => loadPublishedSnapshots(this.postEngine, filter, pagination),
      loadPostsForDayPage: (year, month, day, pagination) => loadPostsForDayPage(this.postEngine, year, month, day, pagination),
      findSinglePostBySlug: (slug, singlePostOptions, dateFilter) => findSinglePostBySlug(this.postEngine, slug, singlePostOptions, dateFilter),
    });
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
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(requestUrl.pathname.replace(/\/+$/, '') || '/');

        const asset = await this.resolveAsset(pathname);
        if (asset) {
          this.respondAsset(res, asset.contentType, asset.body);
          return;
        }

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
      const requestTheme = sanitizePicoTheme(requestUrl.searchParams.get('theme'));
      const previewThemeMode = sanitizePicoThemeMode(requestUrl.searchParams.get('mode'));
      const useDraftContent = requestUrl.searchParams.get('draft') === 'true';
      const draftPostId = requestUrl.searchParams.get('postId') || undefined;
      const appliedTheme = requestTheme ?? sanitizePicoTheme((metadata as { picoTheme?: unknown } | null)?.picoTheme);
      const picoStylesheetHref = getPicoStylesheetHref(appliedTheme);
      const htmlRewriteContext = await this.buildHtmlRewriteContext();

      if (pathname === '/calendar.json') {
        const calendarJson = await this.resolveCalendarJson(context.dataDir, listExcludedCategories);
        this.respondAsset(res, 'application/json; charset=utf-8', calendarJson);
        return;
      }

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

      const result = await this.renderRouteForContext(pathname, {
        projectContext: context,
        metadata,
        menu,
        maxPostsPerPage,
        requestTheme,
        htmlThemeAttribute: undefined,
        singlePostOptions: {
          useDraftContent,
          draftPostId,
        },
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

  private async renderStylePreview(
    rewriteContext: HtmlRewriteContext,
    pageContext: { pageTitle: string; language: string; menuItems: ReturnType<typeof buildTemplateMenuItems>; picoStylesheetHref: string; htmlThemeAttribute?: string },
    categorySettings: Record<string, CategoryRenderSettings>,
    listExcludedCategories: string[],
  ): Promise<string> {
    const result = await loadPublishedSnapshotsPage(this.postEngine, { status: 'published', excludeCategories: listExcludedCategories }, {
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

  private async buildHtmlRewriteContext(): Promise<HtmlRewriteContext> {
    const publishedPosts = await loadPublishedSnapshots(this.postEngine, { status: 'published' });
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

  private async resolveTagColorByName(projectContext: ActiveProjectContext): Promise<Record<string, string>> {
    const cacheKey = `${projectContext.projectId}:${projectContext.dataDir ?? ''}`;
    const cached = this.tagColorByNameCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.loadTagColorByName(projectContext.dataDir);
    this.tagColorByNameCache.set(cacheKey, promise);
    return promise;
  }

  private async loadTagColorByName(dataDir?: string): Promise<Record<string, string>> {
    if (!dataDir) {
      return {};
    }

    const tagsPath = path.join(dataDir, 'meta', 'tags.json');

    try {
      const source = await readFile(tagsPath, 'utf-8');
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) {
        return {};
      }

      const colors: Record<string, string> = {};
      for (const rawEntry of parsed as SerializedTag[]) {
        const name = typeof rawEntry?.name === 'string' ? rawEntry.name.trim() : '';
        const color = typeof rawEntry?.color === 'string' ? rawEntry.color.trim() : '';
        if (!name || !color) {
          continue;
        }

        colors[name] = color;
      }

      return colors;
    } catch {
      return {};
    }
  }

  private async resolveTagTemplateSettings(projectContext: ActiveProjectContext): Promise<Record<string, { postTemplateSlug?: string | null }>> {
    if (!projectContext.dataDir) {
      return {};
    }

    const tagsPath = path.join(projectContext.dataDir, 'meta', 'tags.json');

    try {
      const source = await readFile(tagsPath, 'utf-8');
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) {
        return {};
      }

      const settings: Record<string, { postTemplateSlug?: string | null }> = {};
      for (const rawEntry of parsed as SerializedTag[]) {
        const name = typeof rawEntry?.name === 'string' ? rawEntry.name.trim() : '';
        const postTemplateSlug = typeof (rawEntry as Record<string, unknown>)?.postTemplateSlug === 'string'
          ? ((rawEntry as Record<string, unknown>).postTemplateSlug as string).trim()
          : undefined;
        if (!name || !postTemplateSlug) {
          continue;
        }

        settings[name] = { postTemplateSlug };
      }

      return settings;
    } catch {
      return {};
    }
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

  private async resolveCalendarJson(dataDir: string | undefined, listExcludedCategories: string[]): Promise<Buffer> {
    if (dataDir) {
      const calendarPath = path.join(dataDir, 'html', 'calendar.json');
      try {
        return await readFile(calendarPath);
      } catch {
        // fall through to dynamic generation for preview runtime
      }
    }

    const { publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);
    const calendarJson = `${JSON.stringify(buildCalendarArchiveData(publishedListPosts), null, 2)}\n`;
    return Buffer.from(calendarJson, 'utf-8');
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
        postTemplateSlug: value.postTemplateSlug,
        listTemplateSlug: value.listTemplateSlug,
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

function buildPythonMacroRenderer(): PythonMacroRendererContract {
  return {
    async getEnabledMacroScripts() {
      const scripts = await getScriptEngine().getEnabledMacroScripts();
      return scripts.map((s) => ({
        id: s.id,
        slug: s.slug,
        entrypoint: s.entrypoint,
        content: s.content,
        version: s.version,
      }));
    },
    async renderMacro(params) {
      return getPythonMacroWorkerRuntime().renderMacro(params);
    },
  };
}
