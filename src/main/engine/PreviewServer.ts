import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { getMetaEngine, type ProjectMetadata } from './MetaEngine';
import { getMediaEngine, type MediaData } from './MediaEngine';
import { getPostEngine, type PostData, type PostFilter } from './PostEngine';
import { getProjectEngine } from './ProjectEngine';

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

interface PreviewServerDependencies {
  postEngine: PostEngineContract;
  mediaEngine: MediaEngineContract;
  settingsEngine: MetaEngineContract;
  getActiveProjectContext: () => Promise<ActiveProjectContext>;
}

interface HtmlRewriteContext {
  canonicalPostPathBySlug: Map<string, string>;
  canonicalMediaPathBySourcePath: Map<string, string>;
}

interface RoutePagination {
  pathname: string;
  page: number;
}

interface MediaEngineContract {
  getAllMedia: () => Promise<MediaData[]>;
  setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
}

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

const PREVIEW_ASSETS = {
  'pico.min.css': {
    modulePath: '@picocss/pico/css/pico.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'lightbox.min.css': {
    modulePath: 'lightbox2/dist/css/lightbox.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'lightbox.min.js': {
    modulePath: 'lightbox2/dist/js/lightbox-plus-jquery.min.js',
    contentType: 'application/javascript; charset=utf-8',
  },
} as const;

const PREVIEW_IMAGE_ASSETS = {
  'prev.png': {
    modulePath: 'lightbox2/dist/images/prev.png',
    contentType: 'image/png',
  },
  'next.png': {
    modulePath: 'lightbox2/dist/images/next.png',
    contentType: 'image/png',
  },
  'close.png': {
    modulePath: 'lightbox2/dist/images/close.png',
    contentType: 'image/png',
  },
  'loading.gif': {
    modulePath: 'lightbox2/dist/images/loading.gif',
    contentType: 'image/gif',
  },
} as const;

function clampMaxPostsPerPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }

  const normalized = Math.floor(value);
  if (normalized < MIN_MAX_POSTS_PER_PAGE) return DEFAULT_MAX_POSTS_PER_PAGE;
  if (normalized > MAX_MAX_POSTS_PER_PAGE) return MAX_MAX_POSTS_PER_PAGE;
  return normalized;
}

function resolvePageTitle(metadata: ProjectMetadata | null, fallbackProjectName?: string, fallbackProjectDescription?: string): string {
  const candidate = metadata?.description?.trim();
  if (candidate) {
    return candidate;
  }

  const metadataName = metadata?.name?.trim();
  if (metadataName) {
    return metadataName;
  }

  const descriptionFallback = fallbackProjectDescription?.trim();
  if (descriptionFallback) {
    return descriptionFallback;
  }

  const fallback = fallbackProjectName?.trim();
  if (fallback) {
    return fallback;
  }

  return 'Blog Preview';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMacroParams(paramString: string | undefined): Record<string, string> {
  if (!paramString) return {};

  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:["']([^"']*?)["']|([^\s\]]+))/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(paramString)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }

  return params;
}

function isExternalOrSpecialUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('#') || normalized.startsWith('//')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized);
}

function splitPathSuffix(value: string): { pathPart: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return {
    pathPart: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  };
}

function parseRoutePagination(pathname: string): RoutePagination | null {
  const pageMatch = pathname.match(/^(.*)\/page\/(\d+)$/);
  if (!pageMatch) {
    return { pathname, page: 1 };
  }

  const page = Number(pageMatch[2]);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  const basePathname = pageMatch[1] || '/';
  return {
    pathname: basePathname,
    page,
  };
}

function normalizePreviewHref(rawHref: string, rewriteContext: HtmlRewriteContext): string {
  if (!rawHref || isExternalOrSpecialUrl(rawHref)) {
    return rawHref;
  }

  const { pathPart, suffix } = splitPathSuffix(rawHref.trim());

  const canonicalDayRouteMatch = pathPart.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([a-z0-9-]+)(?:\.html?)?$/i);
  if (canonicalDayRouteMatch) {
    const [, year, month, day, slug] = canonicalDayRouteMatch;
    const normalizedMonth = String(Number(month)).padStart(2, '0');
    const normalizedDay = String(Number(day)).padStart(2, '0');
    return `/${year}/${normalizedMonth}/${normalizedDay}/${slug}${suffix}`;
  }

  const postBySlugMatch = pathPart.match(/^\/?post\/([a-z0-9-]+(?:\.html?)?)$/i);
  if (postBySlugMatch) {
    const slug = postBySlugMatch[1].replace(/\.html?$/i, '');
    const canonical = rewriteContext.canonicalPostPathBySlug.get(slug);
    return `${canonical ?? `/posts/${slug}`}${suffix}`;
  }

  const postByYearMonthSlugMatch = pathPart.match(/^\/?post\/(\d{4})\/(\d{1,2})\/([a-z0-9-]+(?:\.html?)?)$/i);
  if (postByYearMonthSlugMatch) {
    const [, , , rawSlug] = postByYearMonthSlugMatch;
    const slug = rawSlug.replace(/\.html?$/i, '');
    const canonical = rewriteContext.canonicalPostPathBySlug.get(slug);
    return `${canonical ?? `/posts/${slug}`}${suffix}`;
  }

  const postsBySlugMatch = pathPart.match(/^\/?posts\/([a-z0-9-]+(?:\.html?)?)$/i);
  if (postsBySlugMatch) {
    const slug = postsBySlugMatch[1].replace(/\.html?$/i, '');
    const canonical = rewriteContext.canonicalPostPathBySlug.get(slug);
    return `${canonical ?? `/posts/${slug}`}${suffix}`;
  }

  const postsByYearMonthSlugMatch = pathPart.match(/^\/?posts\/(\d{4})\/(\d{1,2})\/([a-z0-9-]+(?:\.html?)?)$/i);
  if (postsByYearMonthSlugMatch) {
    const [, , , rawSlug] = postsByYearMonthSlugMatch;
    const slug = rawSlug.replace(/\.html?$/i, '');
    const canonical = rewriteContext.canonicalPostPathBySlug.get(slug);
    return `${canonical ?? `/posts/${slug}`}${suffix}`;
  }

  return rawHref;
}

function normalizePreviewSrc(rawSrc: string, rewriteContext: HtmlRewriteContext): string {
  if (!rawSrc || isExternalOrSpecialUrl(rawSrc)) {
    return rawSrc;
  }

  const { pathPart, suffix } = splitPathSuffix(rawSrc.trim());
  const mediaMatch = pathPart.match(/^\/?media\/(\d{4})\/(\d{2})\/([^\s]+)$/i);
  if (!mediaMatch) {
    return rawSrc;
  }

  const [, year, month, filename] = mediaMatch;
  const sourceKey = `media/${year}/${month}/${filename}`.toLowerCase();
  const canonicalPath = rewriteContext.canonicalMediaPathBySourcePath.get(sourceKey);
  if (canonicalPath) {
    return `${canonicalPath}${suffix}`;
  }

  return `/media/${year}/${month}/${filename}${suffix}`;
}

function rewriteRenderedHtmlUrls(html: string, rewriteContext: HtmlRewriteContext): string {
  return html
    .replace(/\bhref=(['"])(.*?)\1/gi, (_fullMatch, quote: string, href: string) => {
      const rewritten = normalizePreviewHref(href, rewriteContext);
      return `href=${quote}${rewritten}${quote}`;
    })
    .replace(/\bsrc=(['"])(.*?)\1/gi, (_fullMatch, quote: string, src: string) => {
      const rewritten = normalizePreviewSrc(src, rewriteContext);
      return `src=${quote}${rewritten}${quote}`;
    });
}

function renderMacro(name: string, params: Record<string, string>, postId: string): string {
  if (name === 'youtube') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'YouTube video');
    if (!id) return '';
    return `<div class="macro-youtube"><iframe src="https://www.youtube.com/embed/${id}?rel=0" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (name === 'vimeo') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'Vimeo video');
    if (!id) return '';
    return `<div class="macro-vimeo"><iframe src="https://player.vimeo.com/video/${id}" title="${title}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (name === 'gallery') {
    const columns = escapeHtml(params.columns || '3');
    const caption = params.caption ? `<figcaption>${escapeHtml(params.caption)}</figcaption>` : '';
    return `<div class="macro-gallery" data-post-id="${escapeHtml(postId)}" data-columns="${columns}"><div>Gallery preview is not interactive yet.</div>${caption}</div>`;
  }

  if (name === 'photo_archive') {
    const year = params.year ? ` data-year="${escapeHtml(params.year)}"` : '';
    const month = params.month ? ` data-month="${escapeHtml(params.month)}"` : '';
    return `<div class="macro-photo-archive"${year}${month}><div>Photo archive preview is not interactive yet.</div></div>`;
  }

  return '';
}

async function renderPostHtml(post: PostData, rewriteContext: HtmlRewriteContext): Promise<string> {
  const withMacros = post.content.replace(/\[\[(\w+)(?:\s+([^\]]+))?\]\]/g, (_match, macroName: string, rawParams: string | undefined) => {
    const params = parseMacroParams(rawParams);
    return renderMacro(macroName.toLowerCase(), params, post.id);
  });

  const markdownHtml = await marked.parse(withMacros, { async: true, gfm: true, breaks: false });
  const rewrittenHtml = rewriteRenderedHtmlUrls(markdownHtml, rewriteContext);
  return `<div class="post">${rewrittenHtml}</div>`;
}

function buildCanonicalPostPath(post: PostData): string {
  const year = post.createdAt.getFullYear();
  const month = String(post.createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(post.createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${post.slug}`;
}

function formatArchiveDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

function getArchiveDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPageHtml(content: string, title: string, language: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/assets/pico.min.css" />
    <link rel="stylesheet" href="/assets/lightbox.min.css" />
    <style>
      :root { color-scheme: light dark; }
      body { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 4rem; }
      main { display: grid; gap: 1rem; }
      .post { border: 1px solid var(--muted-border-color); padding: 1rem; background: var(--card-background-color); }
      .post iframe { width: 100%; min-height: 20rem; }
      .macro-gallery, .macro-photo-archive { border: 1px dashed var(--muted-border-color); padding: .75rem; }
      .archive-day-group { display: grid; grid-template-columns: 5.25rem 1fr; gap: 1.25rem; align-items: stretch; }
      .archive-day-marker { display: flex; justify-content: center; align-items: center; color: var(--muted-color); }
      .archive-day-marker span { writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: .16em; font-size: 1.05rem; font-weight: 600; text-transform: uppercase; }
      .archive-day-posts { display: grid; gap: 1rem; }
      .archive-day-separator { position: relative; height: 2px; width: 100%; color: var(--color); border-top: 1px solid currentColor; opacity: .18; margin: .45rem 0 .65rem; }
      .archive-day-separator::before { content: ''; position: absolute; inset: 0; background: linear-gradient(to right, transparent 0%, transparent 18%, currentColor 58%, transparent 92%, transparent 100%); opacity: .85; }
    </style>
    <script defer src="/assets/lightbox.min.js"></script>
  </head>
  <body>
    <main>
      ${content}
    </main>
  </body>
</html>`;
}

export class PreviewServer {
  private readonly postEngine: PostEngineContract;
  private readonly mediaEngine: MediaEngineContract;
  private readonly settingsEngine: MetaEngineContract;
  private readonly getActiveProjectContext: () => Promise<ActiveProjectContext>;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(dependencies?: Partial<PreviewServerDependencies>) {
    this.postEngine = dependencies?.postEngine ?? getPostEngine();
    this.mediaEngine = dependencies?.mediaEngine ?? getMediaEngine();
    this.settingsEngine = dependencies?.settingsEngine ?? getMetaEngine();
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
      this.settingsEngine.setProjectContext(context.projectId, context.dataDir);

      if (this.settingsEngine.isInitialized && this.settingsEngine.syncOnStartup && !this.settingsEngine.isInitialized()) {
        await this.settingsEngine.syncOnStartup();
      }

      const metadata = await this.settingsEngine.getProjectMetadata();
      const maxPostsPerPage = clampMaxPostsPerPage(metadata?.maxPostsPerPage);
      const htmlRewriteContext = await this.buildHtmlRewriteContext();

      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestUrl.pathname.replace(/\/+$/, '') || '/');

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

      const result = await this.resolveRoute(pathname, maxPostsPerPage, htmlRewriteContext);
      if (!result) {
        this.respond(res, 404, 'Not Found');
        return;
      }

      const language = metadata?.mainLanguage?.trim() || 'en';
      this.respond(res, 200, getPageHtml(result, resolvePageTitle(metadata, context.projectName, context.projectDescription), language));
    } catch (error) {
      console.error('[PreviewServer] Request failed:', error);
      this.respond(res, 500, 'Internal Server Error');
    }
  }

  private async resolveRoute(pathname: string, maxPostsPerPage: number, rewriteContext: HtmlRewriteContext): Promise<string | null> {
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
          const post = await this.findPublishedPostBySlug(slug, { year, month: month - 1 });
          if (!post) return null;
          return this.renderPostList([post], rewriteContext);
        }

        const postsSlugMatch = pagedPathname.match(/^\/posts\/([^/]+)$/);
        if (postsSlugMatch) {
          const slug = postsSlugMatch[1].replace(/\.html?$/i, '');
          const post = await this.findPublishedPostBySlug(slug);
          if (!post) return null;
          return this.renderPostList([post], rewriteContext);
        }

        const legacyPostsYearMonthSlugMatch = pagedPathname.match(/^\/post\/(\d{4})\/(\d{1,2})\/([^/]+)$/);
        if (legacyPostsYearMonthSlugMatch) {
          const year = Number(legacyPostsYearMonthSlugMatch[1]);
          const month = Number(legacyPostsYearMonthSlugMatch[2]);
          const slug = legacyPostsYearMonthSlugMatch[3].replace(/\.html?$/i, '');
          if (month < 1 || month > 12) return null;
          const post = await this.findPublishedPostBySlug(slug, { year, month: month - 1 });
          if (!post) return null;
          return this.renderPostList([post], rewriteContext);
        }

        const legacyPostsSlugMatch = pagedPathname.match(/^\/post\/([^/]+)$/);
        if (legacyPostsSlugMatch) {
          const slug = legacyPostsSlugMatch[1].replace(/\.html?$/i, '');
          const post = await this.findPublishedPostBySlug(slug);
          if (!post) return null;
          return this.renderPostList([post], rewriteContext);
        }

    if (pagedPathname === '/') {
      const posts = await this.loadPublishedSnapshots({ status: 'published' }, pageOptions);
      return this.renderPostList(posts, rewriteContext);
    }

    const tagMatch = pagedPathname.match(/^\/tag\/([^/]+)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const posts = await this.loadPublishedSnapshots({ status: 'published', tags: [tag] }, pageOptions);
      return this.renderPostList(posts, rewriteContext, { archiveGrouping: true });
    }

    const categoryMatch = pagedPathname.match(/^\/category\/([^/]+)$/);
    if (categoryMatch) {
      const category = categoryMatch[1];
      const posts = await this.loadPublishedSnapshots({ status: 'published', categories: [category] }, pageOptions);
      return this.renderPostList(posts, rewriteContext, { archiveGrouping: true });
    }

    const daySlugMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([^/]+)$/);
    if (daySlugMatch) {
      const year = Number(daySlugMatch[1]);
      const month = Number(daySlugMatch[2]);
      const day = Number(daySlugMatch[3]);
      const slug = daySlugMatch[4];
      const posts = await this.loadPostsForDay(year, month, day);
      const post = posts.find((candidate) => candidate.slug === slug) || null;
      if (!post) return null;
      return this.renderPostList([post], rewriteContext);
    }

    const dayMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (dayMatch) {
      const year = Number(dayMatch[1]);
      const month = Number(dayMatch[2]);
      const day = Number(dayMatch[3]);
      const posts = await this.loadPostsForDay(year, month, day, pageOptions);
      return this.renderPostList(posts, rewriteContext, { archiveGrouping: true });
    }

    const monthMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})$/);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const month = Number(monthMatch[2]);
      if (month < 1 || month > 12) return null;
      const posts = await this.loadPublishedSnapshots({ status: 'published', year, month: month - 1 }, pageOptions);
      return this.renderPostList(posts, rewriteContext, { archiveGrouping: true });
    }

    const yearMatch = pagedPathname.match(/^\/(\d{4})$/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      const posts = await this.loadPublishedSnapshots({ status: 'published', year }, pageOptions);
      return this.renderPostList(posts, rewriteContext, { archiveGrouping: true });
    }

    const pageSlugMatch = pagedPathname.match(/^\/([^/]+)$/);
    if (pageSlugMatch) {
      const slug = pageSlugMatch[1];
      const pages = await this.loadPublishedSnapshots({ status: 'published', categories: ['page'] }, { maxPostsPerPage });
      const page = pages.find((candidate) => candidate.slug === slug) || null;
      if (!page) return null;
      return this.renderPostList([page], rewriteContext);
    }

    return null;
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

  private async loadPostsForDay(
    year: number,
    month: number,
    day: number,
    pagination?: { maxPostsPerPage: number; page?: number },
  ): Promise<PostData[]> {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return [];
    }

    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

    const posts = await this.loadPublishedSnapshots({
      status: 'published',
      startDate,
      endDate,
    }, pagination);

    return posts.filter((post) => {
      const createdAt = post.createdAt;
      return createdAt.getFullYear() === year
        && createdAt.getMonth() === month - 1
        && createdAt.getDate() === day;
    });
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
    pagination?: { maxPostsPerPage: number; page?: number },
  ): Promise<PostData[]> {
    if (filter.status && filter.status !== 'published') {
      return [];
    }

    const baseFilter = this.buildSnapshotBaseFilter(filter);
    const publishedCandidates = await this.postEngine.getPostsFiltered({
      ...baseFilter,
      status: 'published',
    });
    const draftCandidates = await this.postEngine.getPostsFiltered({
      ...baseFilter,
      status: 'draft',
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

    if (typeof pagination?.maxPostsPerPage === 'number') {
      const maxPostsPerPage = pagination.maxPostsPerPage;
      const page = Number.isInteger(pagination.page) && (pagination.page ?? 0) > 0
        ? (pagination.page as number)
        : 1;
      const offset = (page - 1) * maxPostsPerPage;
      return snapshots.slice(offset, offset + maxPostsPerPage);
    }

    return snapshots;
  }

  private async renderPostList(
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    options?: { archiveGrouping?: boolean },
  ): Promise<string> {
    const renderablePosts = await Promise.all(posts.map(async (post) => {
      if (post.status === 'published' && !post.content) {
        const fullPost = await this.postEngine.getPost(post.id);
        return fullPost ?? post;
      }
      return post;
    }));

    if (!options?.archiveGrouping) {
      const rendered = await Promise.all(renderablePosts.map((post) => renderPostHtml(post, rewriteContext)));
      return rendered.join('\n');
    }

    const groups: Array<{ dateLabel: string; posts: PostData[] }> = [];
    let currentGroup: { key: string; dateLabel: string; posts: PostData[] } | null = null;

    for (const post of renderablePosts) {
      const key = getArchiveDateKey(post.createdAt);
      if (!currentGroup || currentGroup.key !== key) {
        currentGroup = {
          key,
          dateLabel: formatArchiveDate(post.createdAt),
          posts: [],
        };
        groups.push(currentGroup);
      }

      currentGroup.posts.push(post);
    }

    const renderedGroups = await Promise.all(groups.map(async (group) => {
      const renderedPosts = await Promise.all(group.posts.map((post) => renderPostHtml(post, rewriteContext)));
      return `<section class="archive-day-group"><aside class="archive-day-marker"><span>${escapeHtml(group.dateLabel)}</span></aside><div class="archive-day-posts">${renderedPosts.join('\n')}</div></section>`;
    }));

    return renderedGroups
      .map((groupHtml, index) => {
        if (index === renderedGroups.length - 1) {
          return groupHtml;
        }
        return `${groupHtml}\n<div class="archive-day-separator" aria-hidden="true"></div>`;
      })
      .join('\n');
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

    const assetName = match[1] as keyof typeof PREVIEW_ASSETS;
    const assetDefinition = PREVIEW_ASSETS[assetName];
    if (!assetDefinition) return null;

    try {
      const absolutePath = require.resolve(assetDefinition.modulePath);
      const body = await readFile(absolutePath);
      return {
        contentType: assetDefinition.contentType,
        body,
      };
    } catch (error) {
      console.error(`[PreviewServer] Failed to read local asset: ${assetDefinition.modulePath}`, error);
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
