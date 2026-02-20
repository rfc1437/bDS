import path from 'node:path';
import { marked } from 'marked';
import { Liquid } from 'liquidjs';
import type { MediaData } from './MediaEngine';
import type { PostData } from './PostEngine';
import { PICO_THEME_NAMES } from '../shared/picoThemes';

export interface HtmlRewriteContext {
  canonicalPostPathBySlug: Map<string, string>;
  canonicalMediaPathBySourcePath: Map<string, string>;
}

export interface TemplatePostEntry {
  id: string;
  title: string;
  content: string;
}

export interface DayBlockContext {
  date_label: string;
  show_date_marker: boolean;
  show_separator: boolean;
  posts: TemplatePostEntry[];
}

export interface PaginationContext {
  page: number;
  maxPostsPerPage: number;
  totalPosts: number;
}

export type ArchiveRouteKind = 'date' | 'non-date';

export type DateArchiveContext = {
  kind: 'root' | 'year' | 'month' | 'day' | 'tag' | 'category';
  name?: string;
  year?: number;
  month?: number;
  day?: number;
};

export interface PostListTemplateContext {
  page_title: string;
  language: string;
  pico_stylesheet_href?: string;
  html_theme_attribute?: string;
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

export interface SinglePostTemplateContext {
  page_title: string;
  language: string;
  pico_stylesheet_href?: string;
  html_theme_attribute?: string;
  post: TemplatePostEntry;
  canonical_post_path_by_slug: Record<string, string>;
  canonical_media_path_by_source_path: Record<string, string>;
}

export interface NotFoundTemplateContext {
  page_title: string;
  language: string;
  pico_stylesheet_href?: string;
  html_theme_attribute?: string;
}

export interface RoutePagination {
  pathname: string;
  page: number;
}

export interface MediaEngineContract {
  getAllMedia: () => Promise<MediaData[]>;
  setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
}

export interface PostMediaEngineContract {
  getLinkedMediaDataForPost: (postId: string) => Promise<Array<{ media: MediaData }>>;
  setProjectContext: (projectId: string) => void;
}

export interface PostEngineContract {
  getPost: (id: string) => Promise<PostData | null>;
}

export const PREVIEW_ASSETS: Record<string, { modulePath: string; contentType: string }> = {
  'pico.min.css': {
    modulePath: '@picocss/pico/css/pico.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  ...Object.fromEntries(
    PICO_THEME_NAMES.map((theme) => [
      `pico.${theme}.min.css`,
      {
        modulePath: `@picocss/pico/css/pico.${theme}.min.css`,
        contentType: 'text/css; charset=utf-8',
      },
    ])
  ),
  'lightbox.min.css': {
    modulePath: 'lightbox2/dist/css/lightbox.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'lightbox.min.js': {
    modulePath: 'lightbox2/dist/js/lightbox-plus-jquery.min.js',
    contentType: 'application/javascript; charset=utf-8',
  },
};

export const PREVIEW_IMAGE_ASSETS = {
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

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

export function clampMaxPostsPerPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }

  const normalized = Math.floor(value);
  if (normalized < MIN_MAX_POSTS_PER_PAGE) return DEFAULT_MAX_POSTS_PER_PAGE;
  if (normalized > MAX_MAX_POSTS_PER_PAGE) return MAX_MAX_POSTS_PER_PAGE;
  return normalized;
}

export function resolvePageTitle(metadata: { description?: string; name?: string } | null, fallbackProjectName?: string, fallbackProjectDescription?: string): string {
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseMacroParams(paramString: string | undefined): Record<string, string> {
  if (!paramString) return {};

  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:["']([^"']*?)["']|([^\s\]]+))/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(paramString)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }

  return params;
}

export function parseIntegerParam(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function normalizeMacroName(name: string): string {
  if (name === 'photo_album') {
    return 'photo_archive';
  }

  return name;
}

export function buildCanonicalMediaPath(media: MediaData): string {
  const year = media.createdAt.getFullYear();
  const month = String(media.createdAt.getMonth() + 1).padStart(2, '0');
  return `/media/${year}/${month}/${media.filename}`;
}

export function isRenderableImage(media: MediaData): boolean {
  if (media.mimeType?.toLowerCase().startsWith('image/')) {
    return true;
  }

  const extension = path.extname(media.filename).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'].includes(extension);
}

export function buildPhotoArchiveBuckets(
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

export function renderGalleryMacro(
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

export function renderPhotoArchiveMacro(params: Record<string, string>, mediaItems: MediaData[]): string {
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

export function isExternalOrSpecialUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('#') || normalized.startsWith('//')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized);
}

export function splitPathSuffix(value: string): { pathPart: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return {
    pathPart: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  };
}

export function normalizePreviewHref(rawHref: string, rewriteContext: HtmlRewriteContext): string {
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

export function normalizePreviewSrc(rawSrc: string, rewriteContext: HtmlRewriteContext): string {
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

export function rewriteRenderedHtmlUrls(html: string, rewriteContext: HtmlRewriteContext): string {
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

export function renderMacro(
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

export function buildCanonicalPostPath(post: PostData): string {
  const year = post.createdAt.getFullYear();
  const month = String(post.createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(post.createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${post.slug}`;
}

export function formatArchiveDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

export function getArchiveDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toDateParts(date: Date): { day: number; month: number; year: number } {
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  };
}

export function buildPaginationHref(basePathname: string, page: number): string {
  const base = basePathname === '/' ? '' : basePathname;
  if (page <= 1) {
    return basePathname === '/' ? '/' : `${basePathname}/`;
  }

  return `${base}/page/${page}/`;
}

export function parseRoutePagination(pathname: string): RoutePagination | null {
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

export function mapToRecord(map: Map<string, string>): Record<string, string> {
  return Object.fromEntries(map.entries());
}

export function recordToMap(record: unknown): Map<string, string> {
  if (!record || typeof record !== 'object') {
    return new Map<string, string>();
  }

  return new Map<string, string>(
    Object.entries(record as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export class PageRenderer {
  private readonly mediaEngine: MediaEngineContract;
  private readonly postMediaEngine: PostMediaEngineContract;
  private readonly liquid: Liquid;

  constructor(mediaEngine: MediaEngineContract, postMediaEngine: PostMediaEngineContract) {
    this.mediaEngine = mediaEngine;
    this.postMediaEngine = postMediaEngine;

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

  buildListTemplateContext(
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    options: {
      archiveGrouping: boolean;
      routeKind: ArchiveRouteKind;
      archiveContext?: DateArchiveContext;
      basePathname: string;
      page_title: string;
      language: string;
      pico_stylesheet_href?: string;
      html_theme_attribute?: string;
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
      pico_stylesheet_href: options.pico_stylesheet_href,
      html_theme_attribute: options.html_theme_attribute,
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

  async resolveRenderablePost(post: PostData, postEngine: PostEngineContract): Promise<PostData> {
    if (post.status === 'published' && !post.content) {
      const fullPost = await postEngine.getPost(post.id);
      return fullPost ?? post;
    }

    return post;
  }

  async renderPostList(
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    options: {
      archiveGrouping: boolean;
      routeKind: ArchiveRouteKind;
      archiveContext?: DateArchiveContext;
      basePathname: string;
      page_title: string;
      language: string;
      pico_stylesheet_href?: string;
      html_theme_attribute?: string;
      pagination?: PaginationContext;
    },
    postEngine?: PostEngineContract,
  ): Promise<string> {
    if (posts.length === 0) {
      return '';
    }

    const renderablePosts = postEngine
      ? await Promise.all(posts.map(async (post) => this.resolveRenderablePost(post, postEngine)))
      : posts;
    const templateContext = this.buildListTemplateContext(
      renderablePosts,
      rewriteContext,
      options,
    );

    return this.liquid.renderFile('post-list', templateContext);
  }

  async renderSinglePost(
    post: PostData,
    rewriteContext: HtmlRewriteContext,
    pageContext: { page_title: string; language: string; pico_stylesheet_href?: string; html_theme_attribute?: string },
    postEngine?: PostEngineContract,
  ): Promise<string> {
    const renderablePost = postEngine
      ? await this.resolveRenderablePost(post, postEngine)
      : post;
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

  async renderNotFound(context: NotFoundTemplateContext): Promise<string> {
    return this.liquid.renderFile('not-found', context);
  }
}
