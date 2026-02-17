import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { Liquid } from 'liquidjs';
import { getMetaEngine, type ProjectMetadata } from './MetaEngine';
import { getMediaEngine, type MediaData } from './MediaEngine';
import { getPostMediaEngine } from './PostMediaEngine';
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
  postMediaEngine: PostMediaEngineContract;
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

interface PaginationContext {
  page: number;
  maxPostsPerPage: number;
  totalPosts: number;
}

interface TemplatePostEntry {
  id: string;
  title: string;
  content: string;
}

interface DayBlockContext {
  date_label: string;
  show_date_marker: boolean;
  show_separator: boolean;
  posts: TemplatePostEntry[];
}

interface PostListTemplateContext {
  page_title: string;
  language: string;
  is_date_archive: boolean;
  show_archive_range_heading: boolean;
  archive_context: {
    kind: 'root' | 'year' | 'month' | 'day' | 'tag' | 'category';
    name: string | null;
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  min_date: { day: number; month: number; year: number } | null;
  max_date: { day: number; month: number; year: number } | null;
  is_list_page: boolean;
  is_first_page: boolean;
  is_last_page: boolean;
  has_prev_page: boolean;
  has_next_page: boolean;
  prev_page_href: string;
  next_page_href: string;
  canonical_post_path_by_slug: Record<string, string>;
  canonical_media_path_by_source_path: Record<string, string>;
  day_blocks: DayBlockContext[];
}

type ArchiveRouteKind = 'date' | 'non-date';

type DateArchiveContext = {
  kind: 'root' | 'year' | 'month' | 'day' | 'tag' | 'category';
  name?: string;
  year?: number;
  month?: number;
  day?: number;
};

interface SinglePostTemplateContext {
  page_title: string;
  language: string;
  post: TemplatePostEntry;
  canonical_post_path_by_slug: Record<string, string>;
  canonical_media_path_by_source_path: Record<string, string>;
}

interface NotFoundTemplateContext {
  page_title: string;
  language: string;
}

interface MediaEngineContract {
  getAllMedia: () => Promise<MediaData[]>;
  setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
}

interface PostMediaEngineContract {
  getLinkedMediaDataForPost: (postId: string) => Promise<Array<{ media: MediaData }>>;
  setProjectContext: (projectId: string) => void;
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

function parseIntegerParam(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeMacroName(name: string): string {
  if (name === 'photo_album') {
    return 'photo_archive';
  }

  return name;
}

function buildCanonicalMediaPath(media: MediaData): string {
  const year = media.createdAt.getFullYear();
  const month = String(media.createdAt.getMonth() + 1).padStart(2, '0');
  return `/media/${year}/${month}/${media.filename}`;
}

function isRenderableImage(media: MediaData): boolean {
  if (media.mimeType?.toLowerCase().startsWith('image/')) {
    return true;
  }

  const extension = path.extname(media.filename).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'].includes(extension);
}

function buildPhotoArchiveBuckets(
  mediaItems: MediaData[],
  params: Record<string, string>,
): Array<{ year: number; month: number; media: MediaData[] }> {
  const yearParam = parseIntegerParam(params.year);
  const monthParam = parseIntegerParam(params.month);

  const filteredByDate = mediaItems.filter((media) => {
    const year = media.createdAt.getFullYear();
    const month = media.createdAt.getMonth() + 1;

    if (yearParam !== null && year !== yearParam) {
      return false;
    }

    if (monthParam !== null && month !== monthParam) {
      return false;
    }

    return true;
  });

  const buckets = new Map<string, { year: number; month: number; media: MediaData[] }>();
  for (const media of filteredByDate) {
    const year = media.createdAt.getFullYear();
    const month = media.createdAt.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const existing = buckets.get(key);

    if (existing) {
      existing.media.push(media);
      continue;
    }

    buckets.set(key, { year, month, media: [media] });
  }

  let orderedBuckets = Array.from(buckets.values())
    .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));

  if (yearParam === null) {
    orderedBuckets = orderedBuckets.slice(0, 10);
  }

  for (const bucket of orderedBuckets) {
    bucket.media.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return orderedBuckets;
}

function renderGalleryMacro(
  params: Record<string, string>,
  postId: string,
  mediaItems: MediaData[],
  linkedMediaIds: Set<string> | null,
): string {
  const requestedColumns = parseIntegerParam(params.columns);
  const columns = requestedColumns && requestedColumns >= 1 && requestedColumns <= 6 ? requestedColumns : 3;
  const caption = params.caption ? `<figcaption class="gallery-caption">${escapeHtml(params.caption)}</figcaption>` : '';

  const linkedImages = mediaItems
    .filter((media) => {
      if (!isRenderableImage(media)) {
        return false;
      }

      const linkedByPostMedia = linkedMediaIds?.has(media.id) ?? false;
      const linkedBySidecar = Array.isArray(media.linkedPostIds) && media.linkedPostIds.includes(postId);
      return linkedByPostMedia || linkedBySidecar;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const groupName = `gallery-${escapeHtml(postId || 'post')}`;
  const galleryItems = linkedImages.map((media) => {
    const mediaPath = escapeHtml(buildCanonicalMediaPath(media));
    const title = escapeHtml(media.caption || media.title || media.originalName || media.filename);
    const alt = escapeHtml(media.alt || media.title || media.originalName || media.filename);
    return `<a class="gallery-item" href="${mediaPath}" data-lightbox="${groupName}" data-title="${title}"><img src="${mediaPath}" alt="${alt}" loading="lazy" /></a>`;
  }).join('');

  const content = galleryItems || '<div class="gallery-empty">No linked images found.</div>';
  return `<div class="macro-gallery gallery-cols-${columns}" data-post-id="${escapeHtml(postId)}" data-columns="${columns}" data-lightbox="true"><div class="gallery-container gallery-lightbox">${content}</div>${caption}</div>`;
}

function renderPhotoArchiveMacro(params: Record<string, string>, mediaItems: MediaData[]): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const yearParam = parseIntegerParam(params.year);
  const monthParam = parseIntegerParam(params.month);

  const rootClasses = ['macro-photo-archive'];
  if (yearParam === null) {
    rootClasses.push('photo-archive-recent-months');
  } else if (monthParam !== null) {
    rootClasses.push('photo-archive-single-month');
  } else {
    rootClasses.push('photo-archive-full-year');
  }

  const dataAttrs: string[] = [];
  if (yearParam === null) {
    dataAttrs.push('data-recent="10"');
  } else {
    dataAttrs.push(`data-year="${escapeHtml(String(yearParam))}"`);
    if (monthParam !== null) {
      dataAttrs.push(`data-month="${escapeHtml(String(monthParam))}"`);
    }
  }

  const renderableMedia = mediaItems.filter((media) => isRenderableImage(media));
  const buckets = buildPhotoArchiveBuckets(renderableMedia, params);

  if (buckets.length === 0) {
    return `<div class="${rootClasses.join(' ')}" ${dataAttrs.join(' ')}><div class="photo-archive-container"><div class="photo-archive-empty">No photos found for this archive.</div></div></div>`;
  }

  const monthsHtml = buckets.map((bucket) => {
    const monthName = monthNames[bucket.month - 1] || String(bucket.month);
    const label = `${monthName} ${bucket.year}`;
    const groupName = `photo-archive-${bucket.year}-${String(bucket.month).padStart(2, '0')}`;

    const itemsHtml = bucket.media.map((media) => {
      const mediaPath = escapeHtml(buildCanonicalMediaPath(media));
      const title = escapeHtml(media.caption || media.title || media.originalName || media.filename);
      const alt = escapeHtml(media.alt || media.title || media.originalName || media.filename);
      return `<a class="photo-archive-item" href="${mediaPath}" data-lightbox="${groupName}" data-title="${title}"><img src="${mediaPath}" alt="${alt}" loading="lazy" /></a>`;
    }).join('');

    return `<div class="photo-archive-month-wrapper"><div class="photo-archive-month"><div class="photo-archive-month-label"><span>${escapeHtml(label)}</span></div><div class="photo-archive-gallery">${itemsHtml}</div></div></div>`;
  }).join('');

  return `<div class="${rootClasses.join(' ')}" ${dataAttrs.join(' ')}><div class="photo-archive-container">${monthsHtml}</div></div>`;
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

function renderMacro(
  name: string,
  params: Record<string, string>,
  postId: string,
  mediaItems: MediaData[],
  linkedMediaIds: Set<string> | null,
): string {
  const normalizedName = normalizeMacroName(name);

  if (normalizedName === 'youtube') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'YouTube video');
    if (!id) return '';
    return `<div class="macro-youtube"><iframe src="https://www.youtube.com/embed/${id}?rel=0" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (normalizedName === 'vimeo') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'Vimeo video');
    if (!id) return '';
    return `<div class="macro-vimeo"><iframe src="https://player.vimeo.com/video/${id}" title="${title}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (normalizedName === 'gallery') {
    return renderGalleryMacro(params, postId, mediaItems, linkedMediaIds);
  }

  if (normalizedName === 'photo_archive') {
    return renderPhotoArchiveMacro(params, mediaItems);
  }

  return '';
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

function toDateParts(date: Date): { day: number; month: number; year: number } {
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  };
}

function buildPaginationHref(basePathname: string, page: number): string {
  const base = basePathname === '/' ? '' : basePathname;
  if (page <= 1) {
    return basePathname === '/' ? '/' : `${basePathname}/`;
  }

  return `${base}/page/${page}/`;
}

function mapToRecord(map: Map<string, string>): Record<string, string> {
  return Object.fromEntries(map.entries());
}

function recordToMap(record: unknown): Map<string, string> {
  if (!record || typeof record !== 'object') {
    return new Map<string, string>();
  }

  return new Map<string, string>(
    Object.entries(record as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export class PreviewServer {
  private readonly postEngine: PostEngineContract;
  private readonly mediaEngine: MediaEngineContract;
  private readonly postMediaEngine: PostMediaEngineContract;
  private readonly settingsEngine: MetaEngineContract;
  private readonly getActiveProjectContext: () => Promise<ActiveProjectContext>;
  private readonly liquid: Liquid;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(dependencies?: Partial<PreviewServerDependencies>) {
    this.postEngine = dependencies?.postEngine ?? getPostEngine();
    this.mediaEngine = dependencies?.mediaEngine ?? getMediaEngine();
    this.postMediaEngine = dependencies?.postMediaEngine ?? getPostMediaEngine();
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
    const templateRoots = [
      path.resolve(__dirname, 'templates'),
      path.resolve(process.cwd(), 'dist', 'main', 'engine', 'templates'),
      path.resolve(process.cwd(), 'src', 'main', 'engine', 'templates'),
    ];

    this.liquid = new Liquid({
      root: templateRoots,
      extname: '.liquid',
      cache: true,
    });

    this.liquid.registerFilter('markdown', async (value: unknown, postIdArg: unknown, canonicalPostsArg: unknown, canonicalMediaArg: unknown) => {
      const content = typeof value === 'string' ? value : '';
      const postId = typeof postIdArg === 'string' ? postIdArg : '';
      const rewriteContext: HtmlRewriteContext = {
        canonicalPostPathBySlug: recordToMap(canonicalPostsArg),
        canonicalMediaPathBySourcePath: recordToMap(canonicalMediaArg),
      };

      const needsMediaLookup = /\[\[(gallery|photo_archive|photo_album)\b/i.test(content);
      const mediaItems = needsMediaLookup
        ? await this.mediaEngine.getAllMedia().catch(() => [] as MediaData[])
        : [];

      const linkedMediaIds = needsMediaLookup && postId
        ? await this.postMediaEngine.getLinkedMediaDataForPost(postId)
          .then((links) => new Set<string>(links.map((link) => link.media?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)))
          .catch(() => null)
        : null;

      const withMacros = content.replace(/\[\[(\w+)(?:\s+([^\]]+))?\]\]/g, (_match, macroName: string, rawParams: string | undefined) => {
        const params = parseMacroParams(rawParams);
        return renderMacro(macroName.toLowerCase(), params, postId, mediaItems, linkedMediaIds);
      });

      const markdownHtml = await marked.parse(withMacros, { async: true, gfm: true, breaks: false });
      return rewriteRenderedHtmlUrls(markdownHtml, rewriteContext);
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
      this.postMediaEngine.setProjectContext(context.projectId);
      this.settingsEngine.setProjectContext(context.projectId, context.dataDir);

      if (this.settingsEngine.isInitialized && this.settingsEngine.syncOnStartup && !this.settingsEngine.isInitialized()) {
        await this.settingsEngine.syncOnStartup();
      }

      const metadata = await this.settingsEngine.getProjectMetadata();
      const language = metadata?.mainLanguage?.trim() || 'en';
      const pageTitle = resolvePageTitle(metadata, context.projectName, context.projectDescription);
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

      const result = await this.resolveRoute(pathname, maxPostsPerPage, htmlRewriteContext, {
        pageTitle,
        language,
      });
      if (!result) {
        const notFoundHtml = await this.renderNotFound({
          page_title: '404 Not Found',
          language,
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
    pageContext: { pageTitle: string; language: string },
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
      const post = await this.findPublishedPostBySlug(slug, { year, month: month - 1 });
      if (!post) return null;
      return this.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const postsSlugMatch = pagedPathname.match(/^\/posts\/([^/]+)$/);
    if (postsSlugMatch) {
      const slug = postsSlugMatch[1].replace(/\.html?$/i, '');
      const post = await this.findPublishedPostBySlug(slug);
      if (!post) return null;
      return this.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const legacyPostsYearMonthSlugMatch = pagedPathname.match(/^\/post\/(\d{4})\/(\d{1,2})\/([^/]+)$/);
    if (legacyPostsYearMonthSlugMatch) {
      const year = Number(legacyPostsYearMonthSlugMatch[1]);
      const month = Number(legacyPostsYearMonthSlugMatch[2]);
      const slug = legacyPostsYearMonthSlugMatch[3].replace(/\.html?$/i, '');
      if (month < 1 || month > 12) return null;
      const post = await this.findPublishedPostBySlug(slug, { year, month: month - 1 });
      if (!post) return null;
      return this.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const legacyPostsSlugMatch = pagedPathname.match(/^\/post\/([^/]+)$/);
    if (legacyPostsSlugMatch) {
      const slug = legacyPostsSlugMatch[1].replace(/\.html?$/i, '');
      const post = await this.findPublishedPostBySlug(slug);
      if (!post) return null;
      return this.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    if (pagedPathname === '/') {
      const result = await this.loadPublishedSnapshotsPage({ status: 'published' }, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: false,
        routeKind: 'date',
        archiveContext: { kind: 'root' },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const tagMatch = pagedPathname.match(/^\/tag\/([^/]+)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', tags: [tag] }, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: true,
        routeKind: 'non-date',
        archiveContext: { kind: 'tag', name: tag },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const categoryMatch = pagedPathname.match(/^\/category\/([^/]+)$/);
    if (categoryMatch) {
      const category = categoryMatch[1];
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', categories: [category] }, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: true,
        routeKind: 'non-date',
        archiveContext: { kind: 'category', name: category },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
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
      return this.renderSinglePost(post, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const dayMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (dayMatch) {
      const year = Number(dayMatch[1]);
      const month = Number(dayMatch[2]);
      const day = Number(dayMatch[3]);
      const result = await this.loadPostsForDayPage(year, month, day, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: true,
        routeKind: 'date',
        archiveContext: { kind: 'day', year, month, day },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const monthMatch = pagedPathname.match(/^\/(\d{4})\/(\d{1,2})$/);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const month = Number(monthMatch[2]);
      if (month < 1 || month > 12) return null;
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', year, month: month - 1 }, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: true,
        routeKind: 'date',
        archiveContext: { kind: 'month', year, month },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const yearMatch = pagedPathname.match(/^\/(\d{4})$/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      const result = await this.loadPublishedSnapshotsPage({ status: 'published', year }, pageOptions);
      return this.renderPostList(result.posts, rewriteContext, {
        archiveGrouping: true,
        routeKind: 'date',
        archiveContext: { kind: 'year', year },
        basePathname: pagedPathname,
        pagination: { page, maxPostsPerPage, totalPosts: result.totalPosts },
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
    }

    const pageSlugMatch = pagedPathname.match(/^\/([^/]+)$/);
    if (pageSlugMatch) {
      const slug = pageSlugMatch[1];
      const pages = await this.loadPublishedSnapshots({ status: 'published', categories: ['page'] }, { maxPostsPerPage });
      const page = pages.find((candidate) => candidate.slug === slug) || null;
      if (!page) return null;
      return this.renderSinglePost(page, rewriteContext, {
        page_title: pageContext.pageTitle,
        language: pageContext.language,
      });
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
    const result = await this.loadPostsForDayPage(year, month, day, pagination);
    return result.posts;
  }

  private async loadPostsForDayPage(
    year: number,
    month: number,
    day: number,
    pagination?: { maxPostsPerPage: number; page?: number },
  ): Promise<{ posts: PostData[]; totalPosts: number }> {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { posts: [], totalPosts: 0 };
    }

    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

    const result = await this.loadPublishedSnapshotsPage({
      status: 'published',
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
    pagination?: { maxPostsPerPage: number; page?: number },
  ): Promise<PostData[]> {
    const result = await this.loadPublishedSnapshotsPage(filter, pagination);
    return result.posts;
  }

  private paginateSnapshots(
    snapshots: PostData[],
    pagination?: { maxPostsPerPage: number; page?: number },
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
    pagination?: { maxPostsPerPage: number; page?: number },
  ): Promise<{ posts: PostData[]; totalPosts: number }> {
    if (filter.status && filter.status !== 'published') {
      return { posts: [], totalPosts: 0 };
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

    return this.paginateSnapshots(snapshots, pagination);
  }

  private async resolveRenderablePost(post: PostData): Promise<PostData> {
    if (post.status === 'published' && !post.content) {
      const fullPost = await this.postEngine.getPost(post.id);
      return fullPost ?? post;
    }

    return post;
  }

  private buildListTemplateContext(
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    options: {
      archiveGrouping: boolean;
      routeKind: ArchiveRouteKind;
      archiveContext?: DateArchiveContext;
      basePathname: string;
      page_title: string;
      language: string;
      pagination?: PaginationContext;
    },
  ): PostListTemplateContext {
    const dayBlocks: DayBlockContext[] = [];

    if (!options.archiveGrouping) {
      dayBlocks.push({
        date_label: '',
        show_date_marker: false,
        show_separator: false,
        posts: posts.map((post) => ({
          id: post.id,
          title: post.title,
          content: post.content,
        })),
      });
    } else {
      let currentBlock: { key: string; block: DayBlockContext } | null = null;

      for (const post of posts) {
        const key = getArchiveDateKey(post.createdAt);
        if (!currentBlock || currentBlock.key !== key) {
          currentBlock = {
            key,
            block: {
              date_label: formatArchiveDate(post.createdAt),
              show_date_marker: true,
              show_separator: false,
              posts: [],
            },
          };
          dayBlocks.push(currentBlock.block);
        }

        currentBlock.block.posts.push({
          id: post.id,
          title: post.title,
          content: post.content,
        });
      }

      for (let index = 0; index < dayBlocks.length - 1; index += 1) {
        dayBlocks[index].show_separator = true;
      }
    }

    const pagination = options.pagination;
    const isListPage = Boolean(pagination && pagination.totalPosts > pagination.maxPostsPerPage);
    const isFirstPage = pagination ? pagination.page <= 1 : true;
    const isLastPage = pagination
      ? (pagination.page * pagination.maxPostsPerPage) >= pagination.totalPosts
      : true;
    const hasPrevPage = Boolean(pagination && pagination.page > 1);
    const hasNextPage = Boolean(pagination && (pagination.page * pagination.maxPostsPerPage) < pagination.totalPosts);
    const prevPageHref = hasPrevPage
      ? buildPaginationHref(options.basePathname, (pagination as PaginationContext).page - 1)
      : '';
    const nextPageHref = hasNextPage
      ? buildPaginationHref(options.basePathname, (pagination as PaginationContext).page + 1)
      : '';

    let minDateParts: { day: number; month: number; year: number } | null = null;
    let maxDateParts: { day: number; month: number; year: number } | null = null;

    const hasRangeHeading = Boolean(
      !isFirstPage
      && posts.length > 0
      && (
        options.routeKind === 'date'
        || options.archiveContext?.kind === 'tag'
        || options.archiveContext?.kind === 'category'
      ),
    );

    if (hasRangeHeading) {
      let minDate = posts[0].createdAt;
      let maxDate = posts[0].createdAt;

      for (const post of posts) {
        if (post.createdAt.getTime() < minDate.getTime()) {
          minDate = post.createdAt;
        }
        if (post.createdAt.getTime() > maxDate.getTime()) {
          maxDate = post.createdAt;
        }
      }

      minDateParts = toDateParts(minDate);
      maxDateParts = toDateParts(maxDate);
    }

    return {
      page_title: options.page_title,
      language: options.language,
      is_date_archive: options.routeKind === 'date',
      show_archive_range_heading: hasRangeHeading,
      archive_context: options.routeKind === 'date'
        ? {
            kind: options.archiveContext?.kind ?? 'root',
            name: options.archiveContext?.name ?? null,
            year: options.archiveContext?.year ?? null,
            month: options.archiveContext?.month ?? null,
            day: options.archiveContext?.day ?? null,
          }
        : options.archiveContext
          ? {
              kind: options.archiveContext.kind,
              name: options.archiveContext.name ?? null,
              year: options.archiveContext.year ?? null,
              month: options.archiveContext.month ?? null,
              day: options.archiveContext.day ?? null,
            }
          : null,
      min_date: minDateParts,
      max_date: maxDateParts,
      is_list_page: isListPage,
      is_first_page: isFirstPage,
      is_last_page: isLastPage,
      has_prev_page: hasPrevPage,
      has_next_page: hasNextPage,
      prev_page_href: prevPageHref,
      next_page_href: nextPageHref,
      canonical_post_path_by_slug: mapToRecord(rewriteContext.canonicalPostPathBySlug),
      canonical_media_path_by_source_path: mapToRecord(rewriteContext.canonicalMediaPathBySourcePath),
      day_blocks: dayBlocks,
    };
  }

  private async renderPostList(
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    options: {
      archiveGrouping: boolean;
      routeKind: ArchiveRouteKind;
      archiveContext?: DateArchiveContext;
      basePathname: string;
      page_title: string;
      language: string;
      pagination?: PaginationContext;
    },
  ): Promise<string> {
    if (posts.length === 0) {
      return '';
    }

    const renderablePosts = await Promise.all(posts.map(async (post) => this.resolveRenderablePost(post)));
    const templateContext = this.buildListTemplateContext(
      renderablePosts,
      rewriteContext,
      options,
    );

    return this.liquid.renderFile('post-list', templateContext);
  }

  private async renderSinglePost(
    post: PostData,
    rewriteContext: HtmlRewriteContext,
    pageContext: { page_title: string; language: string },
  ): Promise<string> {
    const renderablePost = await this.resolveRenderablePost(post);
    const context: SinglePostTemplateContext = {
      ...pageContext,
      post: {
        id: renderablePost.id,
        title: renderablePost.title,
        content: renderablePost.content,
      },
      canonical_post_path_by_slug: mapToRecord(rewriteContext.canonicalPostPathBySlug),
      canonical_media_path_by_source_path: mapToRecord(rewriteContext.canonicalMediaPathBySourcePath),
    };

    return this.liquid.renderFile('single-post', context);
  }

  private async renderNotFound(context: NotFoundTemplateContext): Promise<string> {
    return this.liquid.renderFile('not-found', context);
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
