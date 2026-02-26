import path from 'node:path';
import fs from 'node:fs';
import { marked } from 'marked';
import { Liquid } from 'liquidjs';
import type { MediaData } from './MediaEngine';
import type { PostData } from './PostEngine';
import type { MenuDocument, MenuItemData } from './MenuEngine';
import { PICO_THEME_NAMES } from '../shared/picoThemes';
import { CODE_ENHANCEMENTS_RUNTIME_JS } from './assets/codeEnhancementsRuntime';
import { CALENDAR_RUNTIME_JS } from './assets/calendarRuntime';
import { TAG_CLOUD_RUNTIME_JS } from './assets/tagCloudRuntime';
import { resolveRenderLanguageFromProjectPreferences, translateRender } from '../shared/i18n';

export interface PythonMacroScript {
  id: string;
  slug: string;
  entrypoint: string;
  content: string;
  version: number;
}

export interface PythonMacroRendererContract {
  getEnabledMacroScripts(): Promise<PythonMacroScript[]>;
  renderMacro(params: {
    scriptContent: string;
    entrypoint: string;
    contextJson: string;
    cacheKey?: string;
    timeoutMs?: number;
  }): Promise<{ html: string; data?: Record<string, unknown>; warnings?: string[] }>;
}

export interface HtmlRewriteContext {
  canonicalPostPathBySlug: Map<string, string>;
  canonicalMediaPathBySourcePath: Map<string, string>;
}

export interface TemplatePostEntry {
  id: string;
  slug: string;
  title: string;
  content: string;
  show_title: boolean;
}

export interface CategoryRenderSettings {
  renderInLists: boolean;
  showTitle: boolean;
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
  menu_items: TemplateMenuItem[];
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
  calendar_initial_year: number | null;
  calendar_initial_month: number | null;
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
  menu_items: TemplateMenuItem[];
  pico_stylesheet_href?: string;
  html_theme_attribute?: string;
  post: TemplatePostEntry;
  post_categories: string[];
  post_tags: string[];
  tag_color_by_name: Record<string, string>;
  calendar_initial_year: number | null;
  calendar_initial_month: number | null;
  canonical_post_path_by_slug: Record<string, string>;
  canonical_media_path_by_source_path: Record<string, string>;
}

export interface NotFoundTemplateContext {
  page_title: string;
  language: string;
  menu_items?: TemplateMenuItem[];
  not_found_message?: string;
  not_found_back_label?: string;
  pico_stylesheet_href?: string;
  html_theme_attribute?: string;
}

export interface TemplateMenuItem {
  title: string;
  href: string;
  has_children: boolean;
  children: TemplateMenuItem[];
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
  getPostsFiltered?: (filter: { status?: 'draft' | 'published' | 'archived' }) => Promise<PostData[]>;
}

export interface PreviewAssetDefinition {
  contentType: string;
  modulePath?: string;
  sourceText?: string;
}

function annotateCodeBlocksWithLanguage(html: string): string {
  if (!html) {
    return html;
  }

  return html.replace(/<code\b([^>]*)>/gi, (fullMatch, rawAttributes: string) => {
    if (/\bdata-code-language\s*=/.test(rawAttributes)) {
      return fullMatch;
    }

    const classMatch = rawAttributes.match(/\bclass\s*=\s*"([^"]*)"/i);
    const classList = classMatch?.[1] ?? '';
    const languageMatch = classList.match(/(?:^|\s)language-([\w.+-]+)(?:\s|$)/i);
    const language = languageMatch?.[1]?.toLowerCase();

    if (!language) {
      return fullMatch;
    }

    return `<code${rawAttributes} data-code-language="${escapeHtml(language)}">`;
  });
}

export interface TagUsageEntry {
  tag: string;
  count: number;
}

export type TagCloudOrientationMode = 'horizontal' | 'mixed-hv' | 'mixed-diagonal';

export function normalizeTagCloudOrientation(value: string | undefined): TagCloudOrientationMode {
  const normalized = (value || '').trim().toLowerCase();

  if (normalized === 'mixed_hv' || normalized === 'mixed-hv' || normalized === 'hv' || normalized === 'horizontal_vertical') {
    return 'mixed-hv';
  }

  if (normalized === 'mixed_diagonal' || normalized === 'mixed-diagonal' || normalized === 'diagonal' || normalized === 'diag') {
    return 'mixed-diagonal';
  }

  return 'horizontal';
}

export const PREVIEW_ASSETS: Record<string, PreviewAssetDefinition> = {
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
  'highlight.min.css': {
    modulePath: '@highlightjs/cdn-assets/styles/github-dark.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'highlight.min.js': {
    modulePath: '@highlightjs/cdn-assets/highlight.min.js',
    contentType: 'application/javascript; charset=utf-8',
  },
  'code-enhancements.js': {
    contentType: 'application/javascript; charset=utf-8',
    sourceText: CODE_ENHANCEMENTS_RUNTIME_JS,
  },
  'd3.layout.cloud.js': {
    modulePath: 'd3-cloud/build/d3.layout.cloud.js',
    contentType: 'application/javascript; charset=utf-8',
  },
  'tag-cloud.js': {
    contentType: 'application/javascript; charset=utf-8',
    sourceText: TAG_CLOUD_RUNTIME_JS,
  },
  'vanilla-calendar.min.css': {
    modulePath: 'vanilla-calendar-pro/styles/index.css',
    contentType: 'text/css; charset=utf-8',
  },
  'vanilla-calendar.min.js': {
    modulePath: 'vanilla-calendar-pro',
    contentType: 'application/javascript; charset=utf-8',
  },
  'calendar-runtime.js': {
    contentType: 'application/javascript; charset=utf-8',
    sourceText: CALENDAR_RUNTIME_JS,
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

function buildMenuItemHref(item: MenuItemData): string {
  if (item.kind === 'home') {
    return '/';
  }

  if (item.kind === 'category-archive') {
    const categoryName = (item.categoryName || '').trim();
    return categoryName.length > 0 ? `/category/${encodeURIComponent(categoryName)}/` : '/';
  }

  if (item.kind === 'page') {
    const normalizedSlug = (item.pageSlug || '')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return normalizedSlug.length > 0 ? `/${normalizedSlug}/` : '/';
  }

  return '#';
}

function resolveMenuItemTitle(
  item: MenuItemData,
  categoryMetadata?: Record<string, { title?: string }>,
): string {
  if (item.kind === 'category-archive') {
    const categoryName = (item.categoryName || '').trim();
    const metadataTitle = categoryName.length > 0
      ? (categoryMetadata?.[categoryName]?.title || '').trim()
      : '';

    if (metadataTitle.length > 0) {
      return metadataTitle;
    }
  }

  return item.title;
}

function toTemplateMenuItem(
  item: MenuItemData,
  categoryMetadata?: Record<string, { title?: string }>,
): TemplateMenuItem {
  const children = (Array.isArray(item.children) ? item.children : []).map((child) => toTemplateMenuItem(child, categoryMetadata));
  return {
    title: resolveMenuItemTitle(item, categoryMetadata),
    href: buildMenuItemHref(item),
    has_children: children.length > 0,
    children,
  };
}

export function buildTemplateMenuItems(
  menu: MenuDocument | null | undefined,
  categoryMetadata?: Record<string, { title?: string }>,
): TemplateMenuItem[] {
  const items = menu?.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => toTemplateMenuItem(item, categoryMetadata));
}

export function normalizeMacroName(name: string): string {
  if (name === 'photo_album') {
    return 'photo_archive';
  }

  return name;
}

export function resolveMacroTemplateRoots(options?: {
  moduleDir?: string;
  cwd?: string;
  resourcesPath?: string;
}): string[] {
  return resolvePageRendererTemplateRoots(options).map((root) => path.resolve(root, 'macros'));
}

const macroTemplateCache = new Map<string, string>();
const macroLiquid = new Liquid({ cache: true });

function readMacroTemplateSource(templateName: string): string {
  const cached = macroTemplateCache.get(templateName);
  if (cached) {
    return cached;
  }

  const candidatePaths = resolveMacroTemplateRoots().map((root) => path.join(root, `${templateName}.liquid`));
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    const source = fs.readFileSync(candidatePath, 'utf8');
    macroTemplateCache.set(templateName, source);
    return source;
  }

  throw new Error(`Macro template not found: ${templateName}`);
}

function renderMacroTemplate(templateName: string, context: Record<string, unknown>): string {
  return macroLiquid.parseAndRenderSync(readMacroTemplateSource(templateName), context);
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
  renderLanguage: string,
): string {
  const language = resolveRenderLanguageFromProjectPreferences(renderLanguage);
  const requestedColumns = parseIntegerParam(params.columns);
  const columns = requestedColumns && requestedColumns >= 1 && requestedColumns <= 6 ? requestedColumns : 3;
  const caption = params.caption || '';

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

  const groupName = `gallery-${postId || 'post'}`;
  const items = linkedImages.map((media) => ({
    media_path: buildCanonicalMediaPath(media),
    group_name: groupName,
    title: media.caption || media.title || media.originalName || media.filename,
    alt: media.alt || media.title || media.originalName || media.filename,
  }));

  return renderMacroTemplate('gallery', {
    columns,
    post_id: postId,
    caption,
    items,
    empty_label: translateRender(language, 'render.gallery.empty'),
  });
}

export function renderPhotoArchiveMacro(
  params: Record<string, string>,
  mediaItems: MediaData[],
  renderLanguage: string,
): string {
  const language = resolveRenderLanguageFromProjectPreferences(renderLanguage);
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

  const dataAttrs: Array<{ name: string; value: string }> = [];
  if (yearParam === null) {
    dataAttrs.push({ name: 'data-recent', value: '10' });
  } else {
    dataAttrs.push({ name: 'data-year', value: String(yearParam) });
    if (monthParam !== null) {
      dataAttrs.push({ name: 'data-month', value: String(monthParam) });
    }
  }

  const renderableMedia = mediaItems.filter((media) => isRenderableImage(media));
  const buckets = buildPhotoArchiveBuckets(renderableMedia, params);

  const months = buckets.map((bucket) => {
    const monthName = translateRender(language, `render.month.${bucket.month}`);
    const label = `${monthName} ${bucket.year}`;
    const groupName = `photo-archive-${bucket.year}-${String(bucket.month).padStart(2, '0')}`;

    const items = bucket.media.map((media) => ({
      media_path: buildCanonicalMediaPath(media),
      group_name: groupName,
      title: media.caption || media.title || media.originalName || media.filename,
      alt: media.alt || media.title || media.originalName || media.filename,
    }));

    return {
      label,
      items,
    };
  });

  return renderMacroTemplate('photo-archive', {
    root_classes: rootClasses.join(' '),
    data_attrs: dataAttrs,
    months,
    empty_label: translateRender(language, 'render.photoArchive.empty'),
  });
}

export function renderTagCloudMacro(params: Record<string, string>, tagUsage: TagUsageEntry[], renderLanguage: string): string {
  const language = resolveRenderLanguageFromProjectPreferences(renderLanguage);
  const widthParam = parseIntegerParam(params.width);
  const heightParam = parseIntegerParam(params.height);
  const orientation = normalizeTagCloudOrientation(params.orientation);
  const width = widthParam && widthParam >= 320 && widthParam <= 1600 ? widthParam : 900;
  const height = heightParam && heightParam >= 180 && heightParam <= 900 ? heightParam : 420;

  if (tagUsage.length === 0) {
    return renderMacroTemplate('tag-cloud', {
      orientation,
      words_json: '',
      width,
      height,
      aria_label: translateRender(language, 'render.tagCloud.ariaLabel'),
      empty_label: translateRender(language, 'render.tagCloud.empty'),
    });
  }

  const minCount = Math.min(...tagUsage.map((entry) => entry.count));
  const maxCount = Math.max(...tagUsage.map((entry) => entry.count));
  const minFont = 14;
  const maxFont = 56;

  const words = tagUsage.map((entry) => {
    const normalizedSize = maxCount === minCount
      ? Math.round((minFont + maxFont) / 2)
      : Math.round(minFont + ((entry.count - minCount) / (maxCount - minCount)) * (maxFont - minFont));

    return {
      text: entry.tag,
      size: normalizedSize,
      count: entry.count,
      url: `/tag/${encodeURIComponent(entry.tag)}/`,
    };
  });

  const wordsJson = escapeHtml(JSON.stringify(words));

  return renderMacroTemplate('tag-cloud', {
    orientation,
    words_json: wordsJson,
    width,
    height,
    aria_label: translateRender(language, 'render.tagCloud.ariaLabel'),
    empty_label: translateRender(language, 'render.tagCloud.empty'),
  });
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

  const mediaMatch = pathPart.match(/^\/?media\/(\d{4})\/(\d{2})\/([^\s]+)$/i);
  if (mediaMatch) {
    const [, year, month, filename] = mediaMatch;
    const sourceKey = `media/${year}/${month}/${filename}`.toLowerCase();
    const canonicalPath = rewriteContext.canonicalMediaPathBySourcePath.get(sourceKey);
    if (canonicalPath) {
      return `${canonicalPath}${suffix}`;
    }

    return `/media/${year}/${month}/${filename}${suffix}`;
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
  tagUsage: TagUsageEntry[],
  renderLanguage: string,
): string {
  const normalizedName = normalizeMacroName(name);

  if (normalizedName === 'youtube') {
    const language = resolveRenderLanguageFromProjectPreferences(renderLanguage);
    const id = (params.id || '').trim();
    const title = (params.title || translateRender(language, 'render.video.youtubeTitle')).trim();
    if (!id) return '';
    return renderMacroTemplate('youtube', { id, title });
  }

  if (normalizedName === 'vimeo') {
    const language = resolveRenderLanguageFromProjectPreferences(renderLanguage);
    const id = (params.id || '').trim();
    const title = (params.title || translateRender(language, 'render.video.vimeoTitle')).trim();
    if (!id) return '';
    return renderMacroTemplate('vimeo', { id, title });
  }

  if (normalizedName === 'gallery') {
    return renderGalleryMacro(params, postId, mediaItems, linkedMediaIds, renderLanguage);
  }

  if (normalizedName === 'photo_archive') {
    return renderPhotoArchiveMacro(params, mediaItems, renderLanguage);
  }

  if (normalizedName === 'tag_cloud') {
    return renderTagCloudMacro(params, tagUsage, renderLanguage);
  }

  return '';
}

const JS_BUILTIN_MACROS = new Set(['youtube', 'vimeo', 'gallery', 'photo_archive', 'photo_album', 'tag_cloud']);

export function isBuiltInMacro(name: string): boolean {
  return JS_BUILTIN_MACROS.has(normalizeMacroName(name));
}

export async function replaceAllMacrosAsync(
  content: string,
  postId: string,
  mediaItems: MediaData[],
  linkedMediaIds: Set<string> | null,
  tagUsage: TagUsageEntry[],
  renderLanguage: string,
  pythonMacroRenderer?: PythonMacroRendererContract | null,
): Promise<string> {
  const macroRegex = /\[\[(\w+)(?:\s+([^\]]+))?\]\]/g;
  const matches: Array<{ fullMatch: string; name: string; rawParams: string | undefined; start: number; end: number }> = [];

  let match: RegExpExecArray | null = null;
  while ((match = macroRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      name: match[1].toLowerCase(),
      rawParams: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    return content;
  }

  let pythonScripts: PythonMacroScript[] | null = null;
  const hasUnknownMacros = matches.some((m) => !isBuiltInMacro(m.name));

  if (hasUnknownMacros && pythonMacroRenderer) {
    try {
      pythonScripts = await pythonMacroRenderer.getEnabledMacroScripts();
    } catch (error) {
      console.warn('[PageRenderer] Failed to resolve Python macro scripts:', error instanceof Error ? error.message : String(error));
      pythonScripts = [];
    }
  }

  const scriptsBySlug = new Map<string, PythonMacroScript>();
  if (pythonScripts) {
    for (const script of pythonScripts) {
      scriptsBySlug.set(script.slug.toLowerCase(), script);
    }
  }

  const rendered: string[] = [];

  for (const m of matches) {
    const params = parseMacroParams(m.rawParams);
    const builtInResult = renderMacro(m.name, params, postId, mediaItems, linkedMediaIds, tagUsage, renderLanguage);

    if (builtInResult || isBuiltInMacro(m.name)) {
      rendered.push(builtInResult);
      continue;
    }

    const pythonScript = scriptsBySlug.get(normalizeMacroName(m.name));
    if (pythonScript && pythonMacroRenderer) {
      try {
        const context = {
          env: {
            isPreview: false,
            mainLanguage: renderLanguage,
            hook: m.name,
            source: { kind: 'macro', id: pythonScript.id },
          },
          params: params,
        };

        const result = await pythonMacroRenderer.renderMacro({
          scriptContent: pythonScript.content,
          entrypoint: pythonScript.entrypoint,
          contextJson: JSON.stringify(context),
          cacheKey: `${pythonScript.id}:${pythonScript.version}`,
          timeoutMs: 10000,
        });

        rendered.push(result.html);
      } catch (error) {
        console.warn(`[PageRenderer] Python macro '${m.name}' failed:`, error instanceof Error ? error.message : String(error));
        rendered.push('');
      }
    } else {
      rendered.push('');
    }
  }

  let result = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    result = result.slice(0, m.start) + rendered[i] + result.slice(m.end);
  }

  return result;
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

export function resolvePageRendererTemplateRoots(options?: {
  moduleDir?: string;
  cwd?: string;
  resourcesPath?: string;
}): string[] {
  const moduleDir = options?.moduleDir ?? __dirname;
  const cwd = options?.cwd ?? process.cwd();
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath;

  const roots = [
    path.resolve(moduleDir, 'templates'),
    path.resolve(cwd, 'dist', 'main', 'engine', 'templates'),
    path.resolve(cwd, 'src', 'main', 'engine', 'templates'),
  ];

  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    roots.unshift(path.resolve(resourcesPath, 'templates'));
  }

  return Array.from(new Set(roots));
}

export class PageRenderer {
  private readonly mediaEngine: MediaEngineContract;
  private readonly postMediaEngine: PostMediaEngineContract;
  private readonly postEngineForMacros?: PostEngineContract;
  private readonly pythonMacroRenderer?: PythonMacroRendererContract;
  private readonly liquid: Liquid;

  constructor(
    mediaEngine: MediaEngineContract,
    postMediaEngine: PostMediaEngineContract,
    postEngineForMacros?: PostEngineContract,
    pythonMacroRenderer?: PythonMacroRendererContract,
  ) {
    this.mediaEngine = mediaEngine;
    this.postMediaEngine = postMediaEngine;
    this.postEngineForMacros = postEngineForMacros;
    this.pythonMacroRenderer = pythonMacroRenderer;

    const templateRoots = resolvePageRendererTemplateRoots();

    this.liquid = new Liquid({
      root: templateRoots,
      extname: '.liquid',
      cache: true,
    });

    this.liquid.registerFilter('i18n', (keyArg: unknown, renderLanguageArg: unknown) => {
      const key = typeof keyArg === 'string' ? keyArg : '';
      const resolved = resolveRenderLanguageFromProjectPreferences(
        typeof renderLanguageArg === 'string' ? renderLanguageArg : 'en',
      );

      if (!key) {
        return '';
      }

      return translateRender(resolved, key);
    });

    this.liquid.registerFilter('markdown', async (value: unknown, postIdArg: unknown, canonicalPostsArg: unknown, canonicalMediaArg: unknown, renderLanguageArg: unknown) => {
      const content = typeof value === 'string' ? value : '';
      const postId = typeof postIdArg === 'string' ? postIdArg : '';
      const renderLanguage = typeof renderLanguageArg === 'string' ? renderLanguageArg : 'en';
      const rewriteContext: HtmlRewriteContext = {
        canonicalPostPathBySlug: recordToMap(canonicalPostsArg),
        canonicalMediaPathBySourcePath: recordToMap(canonicalMediaArg),
      };

      const needsMediaLookup = /\[\[(gallery|photo_archive|photo_album)\b/i.test(content);
      const needsTagCloudLookup = /\[\[(tag_cloud)\b/i.test(content);
      const mediaItems = needsMediaLookup
        ? await this.mediaEngine.getAllMedia().catch(() => [] as MediaData[])
        : [];

      const tagUsage = needsTagCloudLookup
        ? await this.getTagUsageData()
        : [];

      const linkedMediaIds = needsMediaLookup && postId
        ? await this.postMediaEngine.getLinkedMediaDataForPost(postId)
          .then((links) => new Set<string>(links.map((link) => link.media?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)))
          .catch(() => null)
        : null;

      const withMacros = await replaceAllMacrosAsync(
        content, postId, mediaItems, linkedMediaIds, tagUsage, renderLanguage, this.pythonMacroRenderer,
      );

      const markdownHtml = await marked.parse(withMacros, { async: true, gfm: true, breaks: false });
      const annotatedMarkdownHtml = annotateCodeBlocksWithLanguage(markdownHtml);
      return rewriteRenderedHtmlUrls(annotatedMarkdownHtml, rewriteContext);
    });
  }

  private async getTagUsageData(): Promise<TagUsageEntry[]> {
    if (!this.postEngineForMacros?.getPostsFiltered) {
      return [];
    }

    const posts = await this.postEngineForMacros.getPostsFiltered({ status: 'published' }).catch(() => [] as PostData[]);
    const tagCounts = new Map<string, number>();

    for (const post of posts) {
      const postTags = Array.isArray(post.tags) ? post.tags : [];
      const uniqueTags = new Set<string>(
        postTags
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
      );

      for (const tag of uniqueTags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
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
      menu_items?: TemplateMenuItem[];
      pico_stylesheet_href?: string;
      html_theme_attribute?: string;
      pagination?: PaginationContext;
      categorySettings?: Record<string, CategoryRenderSettings>;
    },
  ): PostListTemplateContext {
    const shouldShowListTitle = (post: PostData): boolean => {
      const categories = Array.isArray(post.categories) ? post.categories : [];
      if (categories.length === 0) {
        return true;
      }

      const settings = options.categorySettings ?? {};
      const hasAnyNoTitleCategory = categories.some((category) => settings[category]?.showTitle === false);
      if (hasAnyNoTitleCategory) {
        return false;
      }

      return true;
    };

    const dayBlocks: DayBlockContext[] = [];

    if (!options.archiveGrouping) {
      dayBlocks.push({
        date_label: '',
        show_date_marker: false,
        show_separator: false,
        posts: posts.map((post) => ({
          id: post.id,
          slug: post.slug,
          title: post.title,
          content: post.content,
          show_title: shouldShowListTitle(post),
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
          slug: post.slug,
          title: post.title,
          content: post.content,
          show_title: shouldShowListTitle(post),
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
    const calendarInitialDate = posts.length > 0 ? posts[0].createdAt : null;
    const calendarInitialParts = calendarInitialDate ? toDateParts(calendarInitialDate) : null;

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
      menu_items: options.menu_items ?? [],
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
      calendar_initial_year: calendarInitialParts?.year ?? null,
      calendar_initial_month: calendarInitialParts?.month ?? null,
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
      menu_items?: TemplateMenuItem[];
      pico_stylesheet_href?: string;
      html_theme_attribute?: string;
      pagination?: PaginationContext;
      categorySettings?: Record<string, CategoryRenderSettings>;
      renderEmptyState?: boolean;
    },
    postEngine?: PostEngineContract,
  ): Promise<string> {
    if (posts.length === 0 && !options.renderEmptyState) {
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
    pageContext: { page_title: string; language: string; menu_items?: TemplateMenuItem[]; pico_stylesheet_href?: string; html_theme_attribute?: string; tag_color_by_name?: Record<string, string> },
    postEngine?: PostEngineContract,
  ): Promise<string> {
    const renderablePost = postEngine
      ? await this.resolveRenderablePost(post, postEngine)
      : post;

    const postCategories = Array.isArray(renderablePost.categories)
      ? Array.from(new Set(renderablePost.categories.map((category) => category.trim()).filter((category) => category.length > 0)))
      : [];
    const postTags = Array.isArray(renderablePost.tags)
      ? Array.from(new Set(renderablePost.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)))
      : [];

    const context: SinglePostTemplateContext = {
      ...pageContext,
      menu_items: pageContext.menu_items ?? [],
      post: {
        id: renderablePost.id,
        slug: renderablePost.slug,
        title: renderablePost.title,
        content: renderablePost.content,
        show_title: false,
      },
      post_categories: postCategories,
      post_tags: postTags,
      tag_color_by_name: pageContext.tag_color_by_name ?? {},
      calendar_initial_year: renderablePost.createdAt.getFullYear(),
      calendar_initial_month: renderablePost.createdAt.getMonth() + 1,
      canonical_post_path_by_slug: mapToRecord(rewriteContext.canonicalPostPathBySlug),
      canonical_media_path_by_source_path: mapToRecord(rewriteContext.canonicalMediaPathBySourcePath),
    };

    return this.liquid.renderFile('single-post', context);
  }

  async renderNotFound(context: NotFoundTemplateContext): Promise<string> {
    return this.liquid.renderFile('not-found', {
      ...context,
      not_found_message: context.not_found_message,
      not_found_back_label: context.not_found_back_label,
    });
  }
}
