import * as path from 'path';
import * as fs from 'fs/promises';
import type { PostData, PostTranslationData } from './PostEngine';
import type { MediaEngine, MediaData } from './MediaEngine';
import type { PostMediaEngine } from './PostMediaEngine';
import {
  PageRenderer,
  buildTemplateMenuItems,
  buildCanonicalPostPath,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
  type TemplateMenuItem,
} from './PageRenderer';
import { getPicoStylesheetHref, sanitizePicoTheme, type PicoThemeName } from '../shared/picoThemes';
import type { MenuDocument } from './MenuEngine';
import type { ProjectMetadata } from './MetaEngine';
import { loadPublishedGenerationSets } from './GenerationPostSnapshotService';
import { buildCalendarArchiveData, buildSitemapAndFeeds, collectSitemapArchiveMetadata, buildMultiLanguageSitemap } from './GenerationSitemapFeedService';
import { buildTargetedValidationPlan, planMissingValidationPaths } from './ValidationApplyPlannerService';
import { compareSitemapToHtml } from './SiteValidationDiffService';
import {
  copyPreviewAssets,
  normalizeGeneratedUrlPath,
  urlPathToHtmlIndexPath,
  writeFileIfHashChanged,
  writeHtmlPage,
} from './BlogGenerationOutputService';
import { createPreviewBackedGenerationRouteRenderer } from './GenerationRouteRendererFactory';
import {
  buildGenerationPostIndex,
  estimateGenerationUnitsBySection,
  type GenerationPostIndex,
} from './GenerationPostIndexService';
import {
  generateCategoryPages,
  generateDateArchivePages,
  generatePageRoutes,
  generateRootPages,
  generateSinglePostPages,
  generateTagPages,
} from './RoutePageGenerationService';
import {
  buildApplyValidationArchives,
  buildRequestedArchiveMaps,
  selectRequestedPosts,
} from './ApplyValidationDataService';
import { buildApplyValidationWorkerTasks } from './ApplyValidationWorkerService';
import { getGeneratedFileHashRecord } from '../database/generatedFileHashStore';
import { getAllGeneratedFileHashes, setGeneratedFileHash } from '../database/generatedFileHashStore';
import { GenerationWorkerPool, type WorkerPoolResult } from './GenerationWorkerPool';
import {
  serializePostData,
  serializeMediaItem,
  serializeBlogGenerationOptions,
  serializePostMap,
  serializeDateMap,
  type GenerationWorkerTask,
  type SerializedPostData,
} from './GenerationWorkerData';
import { readPostTranslationFile } from './postTranslationFileUtils';

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

export interface PreloadedGenerationData {
  publishedPosts: PostData[];
  publishedListPosts: PostData[];
  publishedRoutePosts: PostData[];
}

export interface BlogGenerationOptions {
  projectId: string;
  projectName: string;
  projectDescription?: string;
  dataDir: string;
  baseUrl: string;
  maxPostsPerPage?: number;
  language?: string;
  blogLanguages?: string[];
  pageTitle?: string;
  picoTheme?: PicoThemeName;
  categoryMetadata?: Record<string, CategoryMetadata>;
  categorySettings?: Record<string, CategoryRenderSettings>;
  menu?: MenuDocument;
  sections?: BlogGenerationSection[];
  preloadedData?: PreloadedGenerationData;
  /** Database file path — required for worker thread generation. */
  dbPath?: string;
}

export interface CategoryMetadata extends CategoryRenderSettings {
  title: string;
}

export type BlogGenerationSection = 'core' | 'single' | 'category' | 'tag' | 'date';

export interface BlogGenerationResult {
  path: string;
  urlCount: number;
  postCount: number;
  feedPostCount: number;
  tagCount: number;
  categoryCount: number;
  archiveCount: number;
  pagesGenerated: number;
  feeds: {
    rssPath: string;
    atomPath: string;
  };
  changed: {
    sitemap: boolean;
    rss: boolean;
    atom: boolean;
  };
}

export interface SiteValidationReport {
  sitemapPath: string;
  sitemapChanged: boolean;
  missingUrlPaths: string[];
  extraUrlPaths: string[];
  updatedPostUrlPaths: string[];
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
}

export interface SiteValidationApplyResult {
  renderedUrlCount: number;
  deletedUrlCount: number;
  removedEmptyDirCount: number;
}

export interface CalendarRegenerationResult {
  calendarPath: string;
  changed: boolean;
}

export function resolvePublicBaseUrl(publicUrl?: string): string | null {
  const trimmed = (publicUrl || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${normalizedPath === '/' ? '' : normalizedPath}`;
  } catch {
    return null;
  }
}

function clampMaxPostsPerPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }

  const normalized = Math.floor(value);
  if (normalized < MIN_MAX_POSTS_PER_PAGE) return DEFAULT_MAX_POSTS_PER_PAGE;
  if (normalized > MAX_MAX_POSTS_PER_PAGE) return MAX_MAX_POSTS_PER_PAGE;
  return normalized;
}

function resolveCategorySettings(
  categoryMetadata: Record<string, CategoryMetadata> | undefined,
  value: Record<string, CategoryRenderSettings> | undefined,
): Record<string, CategoryRenderSettings> {
  const defaults: Record<string, CategoryRenderSettings> = {
    article: { renderInLists: true, showTitle: true },
    picture: { renderInLists: true, showTitle: true },
    aside: { renderInLists: true, showTitle: false },
    page: { renderInLists: false, showTitle: true },
  };

  const merged = { ...defaults };
  if (categoryMetadata) {
    for (const [category, metadata] of Object.entries(categoryMetadata)) {
      merged[category] = {
        renderInLists: metadata?.renderInLists !== false,
        showTitle: metadata?.showTitle !== false,
      };
    }
  }

  if (!value) {
    return merged;
  }

  for (const [category, settings] of Object.entries(value)) {
    merged[category] = {
      renderInLists: settings?.renderInLists !== false,
      showTitle: settings?.showTitle !== false,
    };
  }
  return merged;
}

function resolveCategoryDisplayTitle(
  category: string,
  categoryMetadata: Record<string, CategoryMetadata> | undefined,
): string {
  const title = categoryMetadata?.[category]?.title;
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed.length > 0 ? trimmed : category;
}

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type PublishedTranslationVariant = PostData & {
  translationSourceSlug: string;
  translationCanonicalLanguage?: string;
  translationFilePath: string;
};

interface BlogGenerationPostEngineContract {
  getPostsFiltered: (filter: { status?: 'draft' | 'published' | 'archived'; excludeCategories?: string[] }) => Promise<PostData[]>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  getPost: (postId: string) => Promise<PostData | null>;
  hasPublishedVersion: (postId: string) => Promise<boolean>;
  getLinkedBy?: (postId: string) => Promise<{ id: string; title: string; slug: string }[]>;
  getAllBacklinks?: () => Promise<Map<string, { id: string; title: string; slug: string }[]>>;
  getPostTranslations?: (postId: string) => Promise<PostTranslationData[]>;
  getPublishedTranslationsForRoutePosts?: (publishedPosts: PostData[]) => Promise<Map<string, PostTranslationData[]>>;
  getPublishedPostFilePaths?: () => Promise<Map<string, string>>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

export class BlogGenerationEngine {
  private readonly postEngine: BlogGenerationPostEngineContract;
  private readonly mediaEngine: MediaEngine;
  private readonly postMediaEngine: PostMediaEngine;

  constructor(postEngine: BlogGenerationPostEngineContract, mediaEngine: MediaEngine, postMediaEngine: PostMediaEngine) {
    this.postEngine = postEngine;
    this.mediaEngine = mediaEngine;
    this.postMediaEngine = postMediaEngine;
  }

  private buildPublishedTranslationVariant(sourcePost: PostData, translation: PostTranslationData): PublishedTranslationVariant {
    const canonicalLanguage = typeof sourcePost.language === 'string' ? sourcePost.language.trim() : '';
    const variantLanguages = Array.from(new Set([
      canonicalLanguage,
      ...(Array.isArray(sourcePost.availableLanguages) ? sourcePost.availableLanguages : []),
      translation.language,
    ].filter((language) => typeof language === 'string' && language.trim().length > 0)));

    return {
      ...sourcePost,
      id: translation.id,
      slug: `${sourcePost.slug}.${translation.language}`,
      title: translation.title,
      excerpt: translation.excerpt,
      content: translation.content,
      language: translation.language,
      updatedAt: translation.updatedAt,
      publishedAt: translation.publishedAt ?? sourcePost.publishedAt,
      availableLanguages: variantLanguages,
      translationSourceSlug: sourcePost.slug,
      translationCanonicalLanguage: canonicalLanguage || undefined,
      translationFilePath: translation.filePath,
    };
  }

  private async resolvePostContents(postList: PostData[]): Promise<void> {
    const postsNeedingContent = postList.filter((p) => !p.content);
    if (postsNeedingContent.length === 0) return;

    const BATCH_SIZE = 100;
    for (let i = 0; i < postsNeedingContent.length; i += BATCH_SIZE) {
      const batch = postsNeedingContent.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (post) => {
          const full = await this.postEngine.getPublishedVersion(post.id);
          return { post, content: full?.content ?? '' };
        }),
      );
      for (const { post, content } of results) {
        post.content = content;
      }
    }
  }

  /**
   * Load content for posts that may be resolved translations.
   * For resolved posts with translationFilePath, reads from the translation file.
   * For canonical posts, falls back to getPublishedVersion.
   */
  private async resolveTranslatedPostContents(postList: PostData[]): Promise<void> {
    const postsNeedingContent = postList.filter((p) => !p.content);
    if (postsNeedingContent.length === 0) return;

    await Promise.all(postsNeedingContent.map(async (post) => {
      const variant = post as PostData & { translationFilePath?: string };
      if (variant.translationFilePath) {
        const fileData = await readPostTranslationFile(variant.translationFilePath);
        if (fileData) post.content = fileData.content;
      } else {
        const full = await this.postEngine.getPublishedVersion(post.id);
        if (full) post.content = full.content;
      }
    }));
  }

  /**
   * Create post copies with translated title/excerpt for a target language.
   * Posts already in the target language are returned as-is (same reference).
   * Translation variant posts (with translationSourceSlug) are never resolved.
   * O(n) — one Map lookup per post.
   */
  private resolvePostsForLanguage(
    posts: PostData[],
    targetLanguage: string,
    translationsByPost: Map<string, PostTranslationData[]>,
    mainLanguage: string,
  ): PostData[] {
    if (translationsByPost.size === 0) return posts;

    const target = targetLanguage.trim().toLowerCase();
    const main = mainLanguage.trim().toLowerCase();

    return posts.map((post) => {
      // Skip translation variant posts — they're already in their language
      if ((post as any).translationSourceSlug) return post;

      const postLang = (post.language || '').trim().toLowerCase();
      // A post with no explicit language is assumed to be in the project main language
      const effectivePostLang = postLang || main;
      if (effectivePostLang === target) return post;

      const translations = translationsByPost.get(post.id);
      if (!translations) return post;

      const targetTranslation = translations.find((t) =>
        t.language.trim().toLowerCase() === target,
      );
      if (!targetTranslation) return post;

      const resolved: PostData = {
        ...post,
        title: targetTranslation.title,
        excerpt: targetTranslation.excerpt ?? post.excerpt,
        content: '',
        language: targetTranslation.language,
      };
      (resolved as any).translationFilePath = targetTranslation.filePath;
      // Mark as already-resolved so resolveRenderablePost skips hydration
      (resolved as any).translationSourceSlug = post.slug;
      return resolved;
    });
  }

  private async buildPublishedRoutePosts(publishedPosts: PostData[]): Promise<{
    routePosts: PostData[];
    translationsByPost: Map<string, PostTranslationData[]>;
  }> {
    const routePosts: PostData[] = [...publishedPosts];
    const translationsByPost = new Map<string, PostTranslationData[]>();

    if (typeof this.postEngine.getPublishedTranslationsForRoutePosts === 'function') {
      const translationsMap = await this.postEngine.getPublishedTranslationsForRoutePosts(publishedPosts);
      for (const post of publishedPosts) {
        const translations = translationsMap.get(post.id) || [];
        if (translations.length > 0) {
          translationsByPost.set(post.id, translations);
        }
        for (const translation of translations) {
          routePosts.push(this.buildPublishedTranslationVariant(post, translation));
        }
      }
    } else if (typeof this.postEngine.getPostTranslations === 'function') {
      for (const post of publishedPosts) {
        const translations = await this.postEngine.getPostTranslations(post.id);
        const publishedTranslations = translations.filter((t) => t.status === 'published');
        if (publishedTranslations.length > 0) {
          translationsByPost.set(post.id, publishedTranslations);
        }
        for (const translation of publishedTranslations) {
          routePosts.push(this.buildPublishedTranslationVariant(post, translation));
        }
      }
    }

    return { routePosts, translationsByPost };
  }

  async preloadGenerationData(options: BlogGenerationOptions): Promise<PreloadedGenerationData> {
    const categorySettings = resolveCategorySettings(options.categoryMetadata, options.categorySettings);
    const listExcludedCategories = Object.entries(categorySettings)
      .filter(([, settings]) => settings.renderInLists === false)
      .map(([category]) => category);

    const { publishedPosts, publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);
    const { routePosts: publishedRoutePosts } = await this.buildPublishedRoutePosts(publishedPosts);

    return { publishedPosts, publishedListPosts, publishedRoutePosts };
  }

  async generate(options: BlogGenerationOptions, onProgress: (progress: number, message?: string) => void): Promise<BlogGenerationResult> {
    onProgress(0, 'Loading posts...');

    const selectedSections = new Set<BlogGenerationSection>(
      options.sections && options.sections.length > 0
        ? options.sections
        : ['core', 'single', 'category', 'tag', 'date'],
    );
    const includeCore = selectedSections.has('core');
    const includeSingle = selectedSections.has('single');
    const includeCategory = selectedSections.has('category');
    const includeTag = selectedSections.has('tag');
    const includeDate = selectedSections.has('date');

    const categorySettings = resolveCategorySettings(options.categoryMetadata, options.categorySettings);
    const listExcludedCategories = Object.entries(categorySettings)
      .filter(([, settings]) => settings.renderInLists === false)
      .map(([category]) => category);

    const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage);

    let publishedPosts: PostData[];
    let publishedListPosts: PostData[];
    let publishedRoutePosts: PostData[];
    let translationsByPost = new Map<string, PostTranslationData[]>();

    if (options.preloadedData) {
      ({ publishedPosts, publishedListPosts, publishedRoutePosts } = options.preloadedData);
      // Load translations for language resolution (rendering stays in workers)
      if (typeof this.postEngine.getPublishedTranslationsForRoutePosts === 'function') {
        translationsByPost = await this.postEngine.getPublishedTranslationsForRoutePosts(publishedPosts);
      }
    } else {
      ({ publishedPosts, publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories));
      const built = await this.buildPublishedRoutePosts(publishedPosts);
      publishedRoutePosts = built.routePosts;
      translationsByPost = built.translationsByPost;
    }

    onProgress(3, `Loaded ${publishedPosts.length} published posts`);

    const generationPostIndex = buildGenerationPostIndex(publishedListPosts);

    let allTags = new Set<string>();
    let allCategories = new Set<string>();
    let yearMonths = new Map<string, Date>();
    let years = new Map<number, Date>();
    let yearMonthDays = new Map<string, Date>();
    let urls: string[] = [];
    let sitemapXml = '';
    let rssXml = '';
    let atomXml = '';
    let feedPosts: PostData[] = [];
    let calendarJson = '';

    if (includeCore) {
      // Pre-load content for feed posts (top N by recency) before building feeds
      const feedSlice = publishedListPosts.slice(0, maxPostsPerPage);
      await this.resolvePostContents(feedSlice);

      onProgress(5, 'Building sitemap XML...');
      const sitemapAndFeedResult = buildSitemapAndFeeds({
        baseUrl: options.baseUrl,
        projectName: options.projectName,
        projectDescription: options.projectDescription,
        maxPostsPerPage,
        publishedPosts: publishedRoutePosts,
        publishedListPosts,
        postIndex: generationPostIndex,
        includeFeeds: true,
      });

      allTags = sitemapAndFeedResult.allTags;
      allCategories = sitemapAndFeedResult.allCategories;
      yearMonths = sitemapAndFeedResult.yearMonths;
      years = sitemapAndFeedResult.years;
      yearMonthDays = sitemapAndFeedResult.yearMonthDays;
      urls = sitemapAndFeedResult.urls;
      sitemapXml = sitemapAndFeedResult.sitemapXml;
      rssXml = sitemapAndFeedResult.rssXml;
      atomXml = sitemapAndFeedResult.atomXml;
      feedPosts = sitemapAndFeedResult.feedPosts;
      calendarJson = `${JSON.stringify(buildCalendarArchiveData(publishedListPosts), null, 2)}\n`;

      onProgress(8, 'Building RSS and Atom feeds...');
    } else if (includeCategory || includeTag || includeDate) {
      const archiveMetadata = collectSitemapArchiveMetadata({
        baseUrl: options.baseUrl,
        maxPostsPerPage,
        publishedPosts: publishedRoutePosts,
        publishedListPosts,
      });

      allTags = archiveMetadata.allTags;
      allCategories = archiveMetadata.allCategories;
      yearMonths = archiveMetadata.yearMonths;
      years = archiveMetadata.years;
      yearMonthDays = archiveMetadata.yearMonthDays;
      feedPosts = archiveMetadata.feedPosts;
    }

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');
    const rssPath = path.join(htmlDir, 'rss.xml');
    const atomPath = path.join(htmlDir, 'atom.xml');
    const calendarPath = path.join(htmlDir, 'calendar.json');

    const estimatedUnitsBySection = estimateGenerationUnitsBySection({
      posts: publishedListPosts,
      allCategories,
      allTags,
      yearsMap: years,
      yearMonthsMap: yearMonths,
      yearMonthDaysMap: yearMonthDays,
      maxPostsPerPage,
      postIndex: generationPostIndex,
    });
    const totalEstimatedUnits = [
      includeCore ? estimatedUnitsBySection.core : 0,
      includeSingle ? estimatedUnitsBySection.single : 0,
      includeCategory ? estimatedUnitsBySection.category : 0,
      includeTag ? estimatedUnitsBySection.tag : 0,
      includeDate ? estimatedUnitsBySection.date : 0,
    ].reduce((sum, value) => sum + value, 0);
    let completedUnits = 0;

    const reportUnitProgress = (message: string) => {
      if (totalEstimatedUnits <= 0) {
        return;
      }
      completedUnits += 1;
      const progress = 10 + Math.floor((completedUnits / totalEstimatedUnits) * 85);
      onProgress(Math.min(95, progress), message);
    };

    let sitemapWritten = false;
    let rssWritten = false;
    let atomWritten = false;
    const generatedHashCache = new Map<string, string | null>();
    const knownOutputDirectories = new Set<string>();

    // Bulk-load all known file hashes to avoid per-page DB reads
    const existingHashes = await getAllGeneratedFileHashes(options.projectId);
    for (const [relativePath, hash] of existingHashes) {
      generatedHashCache.set(relativePath, hash);
    }

    if (includeCore) {
      onProgress(10, 'Writing sitemap and feeds...');
      sitemapWritten = await writeFileIfHashChanged({
        projectId: options.projectId,
        filePath: sitemapPath,
        relativePath: 'sitemap.xml',
        content: sitemapXml,
      });
      reportUnitProgress('Sitemap written');
      rssWritten = await writeFileIfHashChanged({
        projectId: options.projectId,
        filePath: rssPath,
        relativePath: 'rss.xml',
        content: rssXml,
      });
      reportUnitProgress('RSS feed written');
      atomWritten = await writeFileIfHashChanged({
        projectId: options.projectId,
        filePath: atomPath,
        relativePath: 'atom.xml',
        content: atomXml,
      });
      reportUnitProgress('Atom feed written');
      await writeFileIfHashChanged({
        projectId: options.projectId,
        filePath: calendarPath,
        relativePath: 'calendar.json',
        content: calendarJson,
      });
      reportUnitProgress('Calendar data written');

      onProgress(15, 'Copying assets...');
      await copyPreviewAssets(htmlDir, {
        projectId: options.projectId,
        hashCache: generatedHashCache,
      });
      reportUnitProgress('Assets copied');
    }

    let pagesGenerated = 0;

    // --- Alternative language subtree data preparation ---
    const mainLanguage = (options.language ?? 'en').trim().toLowerCase();
    const additionalLanguages = (options.blogLanguages ?? [])
      .map((lang) => lang.trim().toLowerCase())
      .filter((lang) => lang.length > 0 && lang !== mainLanguage);

    // Determine whether to use worker threads for page generation
    const useWorkers = !!options.dbPath;

    if (useWorkers) {
      // ── Worker-based generation ────────────────────────────────────────
      pagesGenerated += await this.generateWithWorkers({
        options,
        maxPostsPerPage,
        htmlDir,
        publishedPosts,
        publishedListPosts,
        publishedRoutePosts,
        generationPostIndex,
        allCategories,
        allTags,
        years,
        yearMonths,
        yearMonthDays,
        generatedHashCache,
        mainLanguage,
        additionalLanguages,
        translationsByPost,
        includeCore,
        includeSingle,
        includeCategory,
        includeTag,
        includeDate,
        onProgress,
        reportUnitProgress,
      });
    } else {
      // ── Main-thread fallback (tests / no dbPath) ────────────────────
      pagesGenerated += await this.generateOnMainThread({
        options,
        maxPostsPerPage,
        htmlDir,
        publishedPosts,
        publishedListPosts,
        publishedRoutePosts,
        generationPostIndex,
        allCategories,
        allTags,
        years,
        yearMonths,
        yearMonthDays,
        knownOutputDirectories,
        generatedHashCache,
        mainLanguage,
        additionalLanguages,
        translationsByPost,
        includeCore,
        includeSingle,
        includeCategory,
        includeTag,
        includeDate,
        onProgress,
        reportUnitProgress,
      });
    }

    // --- Combined sitemap with hreflang (if multiple languages) ---
    if (includeCore && additionalLanguages.length > 0) {
      const allLanguages = [mainLanguage, ...additionalLanguages];
      const langFilteredPosts = publishedPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const doNotTranslateIds = new Set(
        publishedPosts
          .filter((p) => (p as PostData & { doNotTranslate?: boolean }).doNotTranslate)
          .map((p) => p.id),
      );

      const hreflangSitemapXml = buildMultiLanguageSitemap({
        baseUrl: options.baseUrl,
        mainLanguage,
        allLanguages,
        translatablePosts: langFilteredPosts,
        doNotTranslatePosts: publishedPosts.filter((p) => doNotTranslateIds.has(p.id)),
        publishedListPosts,
        maxPostsPerPage,
        postIndex: generationPostIndex,
      });

      sitemapWritten = await writeFileIfHashChanged({
        projectId: options.projectId,
        filePath: sitemapPath,
        relativePath: 'sitemap.xml',
        content: hreflangSitemapXml,
      });
    }

    onProgress(100, `Site generated (${publishedPosts.length} posts, ${pagesGenerated} pages)`);

    return {
      path: sitemapPath,
      urlCount: urls.length,
      postCount: publishedPosts.length,
      feedPostCount: feedPosts.length,
      tagCount: allTags.size,
      categoryCount: allCategories.size,
      archiveCount: years.size + yearMonths.size + yearMonthDays.size,
      pagesGenerated,
      feeds: {
        rssPath,
        atomPath,
      },
      changed: {
        sitemap: sitemapWritten,
        rss: rssWritten,
        atom: atomWritten,
      },
    };
  }

  // ── Worker-based page generation ─────────────────────────────────────────

  private async generateWithWorkers(params: {
    options: BlogGenerationOptions;
    maxPostsPerPage: number;
    htmlDir: string;
    publishedPosts: PostData[];
    publishedListPosts: PostData[];
    publishedRoutePosts: PostData[];
    generationPostIndex: GenerationPostIndex;
    allCategories: Set<string>;
    allTags: Set<string>;
    years: Map<number, Date>;
    yearMonths: Map<string, Date>;
    yearMonthDays: Map<string, Date>;
    generatedHashCache: Map<string, string | null>;
    mainLanguage: string;
    additionalLanguages: string[];
    translationsByPost: Map<string, PostTranslationData[]>;
    includeCore: boolean;
    includeSingle: boolean;
    includeCategory: boolean;
    includeTag: boolean;
    includeDate: boolean;
    onProgress: (progress: number, message?: string) => void;
    reportUnitProgress: (message: string) => void;
  }): Promise<number> {
    const {
      options, maxPostsPerPage, htmlDir,
      publishedPosts, publishedListPosts, publishedRoutePosts,
      generationPostIndex, allCategories, allTags, years, yearMonths, yearMonthDays,
      generatedHashCache,
      mainLanguage, additionalLanguages, translationsByPost,
      includeCore, includeSingle, includeCategory, includeTag, includeDate,
      onProgress, reportUnitProgress,
    } = params;

    // Pre-load media data for worker serialization
    const rawMedia = await this.mediaEngine.getAllMedia();
    const mediaItems = rawMedia.map(serializeMediaItem);

    // Pre-load backlinks
    let backlinksRecord: Record<string, Array<{ id: string; title: string; slug: string }>> = {};
    if (typeof this.postEngine.getAllBacklinks === 'function') {
      const blMap = await this.postEngine.getAllBacklinks();
      for (const [postId, links] of blMap) {
        backlinksRecord[postId] = links;
      }
    }

    const serializedOptions = serializeBlogGenerationOptions(options);

    // Pre-load post file paths for worker-side lazy content resolution
    let postFilePathEntries: Array<[string, string]> = [];
    if (typeof this.postEngine.getPublishedPostFilePaths === 'function') {
      const filePathMap = await this.postEngine.getPublishedPostFilePaths();
      postFilePathEntries = Array.from(filePathMap);
    }

    // Pre-load post-media links for worker-side gallery/album macros
    let postMediaLinksEntries: Array<[string, Array<{ mediaId: string; sortOrder: number }>]> = [];
    if (typeof this.postMediaEngine.getAllPostMediaLinks === 'function') {
      const linksMap = await this.postMediaEngine.getAllPostMediaLinks();
      postMediaLinksEntries = Array.from(linksMap);
    }

    // Serialize hash cache as [relativePath, hash] tuples for workers
    const hashMapEntries: Array<[string, string]> = [];
    for (const [relativePath, hash] of generatedHashCache) {
      if (hash !== null) {
        hashMapEntries.push([relativePath, hash]);
      }
    }

    // Resolve posts to project main language before serialization
    const mainLangRoutePosts = this.resolvePostsForLanguage(publishedRoutePosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangListPosts = this.resolvePostsForLanguage(publishedListPosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangPostIndex = buildGenerationPostIndex(mainLangListPosts);
    const serializedRoutePosts = mainLangRoutePosts.map(serializePostData);
    const serializedListPosts = mainLangListPosts.map(serializePostData);

    // Build base task data shared across all tasks
    const baseTaskData = {
      lookupPosts: serializedRoutePosts,
      mediaItems,
      backlinksMap: backlinksRecord,
      options: serializedOptions,
      maxPostsPerPage,
      htmlDir,
      hashMapEntries,
      postFilePathEntries,
      postMediaLinksEntries,
    };

    const tasks: GenerationWorkerTask[] = [];
    let taskCounter = 0;
    const nextTaskId = (section: string, lang?: string) =>
      `gen-${section}${lang ? `-${lang}` : ''}-${++taskCounter}`;

    // ── Main language tasks ──────────────────────────────────────────

    if (includeCore) {
      tasks.push({
        ...baseTaskData,
        taskId: nextTaskId('core'),
        section: 'core',
        posts: serializedListPosts,
      });
    }

    if (includeSingle) {
      // Split single posts across multiple workers
      const workerCount = Math.max(1, Math.min(
        require('os').cpus().length - 1,
        Math.ceil(serializedRoutePosts.length / 100),
      ));
      const chunkSize = Math.ceil(serializedRoutePosts.length / workerCount);
      for (let i = 0; i < serializedRoutePosts.length; i += chunkSize) {
        const chunk = serializedRoutePosts.slice(i, i + chunkSize);
        tasks.push({
          ...baseTaskData,
          taskId: nextTaskId('single'),
          section: 'single',
          posts: chunk,
        });
      }
    }

    if (includeCategory) {
      tasks.push({
        ...baseTaskData,
        taskId: nextTaskId('category'),
        section: 'category',
        posts: serializedListPosts,
        allCategories: Array.from(allCategories),
        postsByCategoryEntries: serializePostMap(mainLangPostIndex.postsByCategory),
      });
    }

    if (includeTag) {
      tasks.push({
        ...baseTaskData,
        taskId: nextTaskId('tag'),
        section: 'tag',
        posts: serializedListPosts,
        allTags: Array.from(allTags),
        postsByTagEntries: serializePostMap(mainLangPostIndex.postsByTag),
      });
    }

    if (includeDate) {
      tasks.push({
        ...baseTaskData,
        taskId: nextTaskId('date'),
        section: 'date',
        posts: serializedListPosts,
        yearsEntries: serializeDateMap(years),
        yearMonthsEntries: serializeDateMap(yearMonths),
        yearMonthDaysEntries: serializeDateMap(yearMonthDays),
        postsByYearEntries: serializePostMap(mainLangPostIndex.postsByYear),
        postsByYearMonthEntries: serializePostMap(mainLangPostIndex.postsByYearMonth),
        postsByYearMonthDayEntries: serializePostMap(mainLangPostIndex.postsByYearMonthDay),
      });
    }

    // ── Language subtree tasks ────────────────────────────────────────

    for (const lang of additionalLanguages) {
      const langPosts = publishedPosts.filter((p) => !p.doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !p.doNotTranslate);

      const langPostIndex = buildGenerationPostIndex(langListPosts);
      const langArchiveMetadata = collectSitemapArchiveMetadata({
        baseUrl: options.baseUrl,
        maxPostsPerPage,
        publishedPosts: langPosts,
        publishedListPosts: langListPosts,
      });

      const resolvedLangPosts = this.resolvePostsForLanguage(langPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangListPosts = this.resolvePostsForLanguage(langListPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangPostIndex = buildGenerationPostIndex(resolvedLangListPosts);

      // Write per-language feeds in main thread (small I/O work)
      if (includeCore) {
        const langFeedSlice = resolvedLangListPosts.slice(0, maxPostsPerPage);
        await this.resolveTranslatedPostContents(langFeedSlice);

        const langFeedResult = buildSitemapAndFeeds({
          baseUrl: `${options.baseUrl}/${lang}`,
          projectName: options.projectName,
          projectDescription: options.projectDescription,
          maxPostsPerPage,
          publishedPosts: langPosts,
          publishedListPosts: resolvedLangListPosts,
          postIndex: langPostIndex,
          includeFeeds: true,
          feedLanguage: lang,
        });

        const langRssPath = path.join(htmlDir, lang, 'rss.xml');
        const langAtomPath = path.join(htmlDir, lang, 'atom.xml');
        await fs.mkdir(path.join(htmlDir, lang), { recursive: true });
        await writeFileIfHashChanged({ projectId: options.projectId, filePath: langRssPath, relativePath: `${lang}/rss.xml`, content: langFeedResult.rssXml });
        await writeFileIfHashChanged({ projectId: options.projectId, filePath: langAtomPath, relativePath: `${lang}/atom.xml`, content: langFeedResult.atomXml });
      }

      const serializedLangPosts = resolvedLangPosts.map(serializePostData);
      const serializedLangListPosts = resolvedLangListPosts.map(serializePostData);

      const langBaseTaskData = {
        ...baseTaskData,
        lookupPosts: serializedLangPosts,
        options: { ...serializedOptions, language: lang },
        languagePrefix: `/${lang}`,
        mainLanguage,
      };

      if (includeCore) {
        tasks.push({
          ...langBaseTaskData,
          taskId: nextTaskId('core', lang),
          section: 'core' as const,
          posts: serializedLangListPosts,
        });
      }

      if (includeSingle) {
        const workerCount = Math.max(1, Math.min(
          require('os').cpus().length - 1,
          Math.ceil(serializedLangPosts.length / 100),
        ));
        const chunkSize = Math.ceil(serializedLangPosts.length / workerCount);
        for (let i = 0; i < serializedLangPosts.length; i += chunkSize) {
          tasks.push({
            ...langBaseTaskData,
            taskId: nextTaskId('single', lang),
            section: 'single' as const,
            posts: serializedLangPosts.slice(i, i + chunkSize),
          });
        }
      }

      if (includeCategory) {
        tasks.push({
          ...langBaseTaskData,
          taskId: nextTaskId('category', lang),
          section: 'category' as const,
          posts: serializedLangListPosts,
          allCategories: Array.from(langArchiveMetadata.allCategories),
          postsByCategoryEntries: serializePostMap(resolvedLangPostIndex.postsByCategory),
        });
      }

      if (includeTag) {
        tasks.push({
          ...langBaseTaskData,
          taskId: nextTaskId('tag', lang),
          section: 'tag' as const,
          posts: serializedLangListPosts,
          allTags: Array.from(langArchiveMetadata.allTags),
          postsByTagEntries: serializePostMap(resolvedLangPostIndex.postsByTag),
        });
      }

      if (includeDate) {
        tasks.push({
          ...langBaseTaskData,
          taskId: nextTaskId('date', lang),
          section: 'date' as const,
          posts: serializedLangListPosts,
          yearsEntries: serializeDateMap(langArchiveMetadata.years),
          yearMonthsEntries: serializeDateMap(langArchiveMetadata.yearMonths),
          yearMonthDaysEntries: serializeDateMap(langArchiveMetadata.yearMonthDays),
          postsByYearEntries: serializePostMap(resolvedLangPostIndex.postsByYear),
          postsByYearMonthEntries: serializePostMap(resolvedLangPostIndex.postsByYearMonth),
          postsByYearMonthDayEntries: serializePostMap(resolvedLangPostIndex.postsByYearMonthDay),
        });
      }
    }

    // ── Dispatch to worker pool ──────────────────────────────────────

    onProgress(15, `Dispatching ${tasks.length} tasks to worker pool...`);

    const pool = new GenerationWorkerPool();
    const result = await pool.runTasks(tasks, reportUnitProgress);

    if (result.errors.length > 0) {
      console.error(`[GenerationWorkerPool] ${result.errors.length} task(s) failed:`);
      for (const err of result.errors) {
        console.error(`  [${err.taskId}] ${err.error}`);
      }
    }

    // Persist hash updates collected from workers (single DB connection, no contention)
    if (result.hashUpdates.length > 0) {
      for (const update of result.hashUpdates) {
        await setGeneratedFileHash(options.projectId, update.relativePath, update.hash);
      }
    }

    return result.pagesGenerated;
  }

  // ── Main-thread page generation (fallback / tests) ───────────────────

  private async generateOnMainThread(params: {
    options: BlogGenerationOptions;
    maxPostsPerPage: number;
    htmlDir: string;
    publishedPosts: PostData[];
    publishedListPosts: PostData[];
    publishedRoutePosts: PostData[];
    generationPostIndex: GenerationPostIndex;
    allCategories: Set<string>;
    allTags: Set<string>;
    years: Map<number, Date>;
    yearMonths: Map<string, Date>;
    yearMonthDays: Map<string, Date>;
    knownOutputDirectories: Set<string>;
    generatedHashCache: Map<string, string | null>;
    mainLanguage: string;
    additionalLanguages: string[];
    translationsByPost: Map<string, PostTranslationData[]>;
    includeCore: boolean;
    includeSingle: boolean;
    includeCategory: boolean;
    includeTag: boolean;
    includeDate: boolean;
    onProgress: (progress: number, message?: string) => void;
    reportUnitProgress: (message: string) => void;
  }): Promise<number> {
    const {
      options, maxPostsPerPage, htmlDir,
      publishedPosts, publishedListPosts, publishedRoutePosts,
      generationPostIndex, allCategories, allTags, years, yearMonths, yearMonthDays,
      knownOutputDirectories, generatedHashCache,
      mainLanguage, additionalLanguages, translationsByPost,
      includeCore, includeSingle, includeCategory, includeTag, includeDate,
      onProgress, reportUnitProgress,
    } = params;

    // Wrap post engine to resolve translations in getPostsFiltered results.
    // The route renderer calls getPostsFiltered internally for list pages,
    // so we need to ensure it returns language-resolved posts with content loaded.
    const createResolvedPostEngine = (targetLang: string, filterDoNotTranslate = false) => {
      if (translationsByPost.size === 0 && !filterDoNotTranslate) return this.postEngine;
      return new Proxy(this.postEngine as any, {
        get: (target: any, prop: string | symbol) => {
          if (prop === 'getPostsFiltered') {
            return async (filter: any) => {
              let posts: PostData[] = await target.getPostsFiltered(filter);
              if (filterDoNotTranslate) {
                posts = posts.filter((p: PostData) => !p.doNotTranslate);
              }
              const resolved = this.resolvePostsForLanguage(posts, targetLang, translationsByPost, mainLanguage);
              // Load translation content for resolved posts that need it (list pages render content)
              await Promise.all(resolved.map(async (post) => {
                const variant = post as PostData & { translationFilePath?: string };
                if (!post.content && variant.translationFilePath) {
                  const fileData = await readPostTranslationFile(variant.translationFilePath);
                  if (fileData) {
                    post.content = fileData.content;
                  }
                }
              }));
              return resolved;
            };
          }
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    };

    const mainLangRoutePosts = this.resolvePostsForLanguage(publishedRoutePosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangListPosts = this.resolvePostsForLanguage(publishedListPosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangPostIndex = buildGenerationPostIndex(mainLangListPosts);

    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options,
      maxPostsPerPage,
      publishedPostsForLookup: mainLangRoutePosts,
      engines: {
        postEngine: createResolvedPostEngine(mainLanguage) as any,
        mediaEngine: this.mediaEngine,
        postMediaEngine: this.postMediaEngine,
      },
    });

    const writePage = (projectId: string, urlPath: string, content: string) => writeHtmlPage({
      projectId,
      htmlDir,
      urlPath,
      content,
      knownDirectories: knownOutputDirectories,
      hashCache: generatedHashCache,
      refreshHashTimestampOnUnchanged: true,
    });

    let pagesGenerated = 0;

    if (includeCore) {
      onProgress(20, 'Generating root pages...');
      pagesGenerated += await generateRootPages({
        projectId: options.projectId,
        posts: mainLangListPosts,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
      pagesGenerated += await generatePageRoutes({
        projectId: options.projectId,
        posts: mainLangRoutePosts,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
    }

    if (includeSingle) {
      onProgress(35, 'Generating single post pages...');
      pagesGenerated += await generateSinglePostPages({
        projectId: options.projectId,
        posts: mainLangRoutePosts,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
    }

    if (includeCategory) {
      onProgress(50, 'Generating category pages...');
      pagesGenerated += await generateCategoryPages({
        projectId: options.projectId,
        posts: mainLangListPosts,
        allCategories,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByCategory: mainLangPostIndex.postsByCategory,
      });
    }

    if (includeTag) {
      onProgress(65, 'Generating tag pages...');
      pagesGenerated += await generateTagPages({
        projectId: options.projectId,
        posts: mainLangListPosts,
        allTags,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByTag: mainLangPostIndex.postsByTag,
      });
    }

    if (includeDate) {
      onProgress(80, 'Generating date archive pages...');
      pagesGenerated += await generateDateArchivePages({
        projectId: options.projectId,
        posts: mainLangListPosts,
        yearsMap: years,
        yearMonthsMap: yearMonths,
        yearMonthDaysMap: yearMonthDays,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByYear: mainLangPostIndex.postsByYear,
        postsByYearMonth: mainLangPostIndex.postsByYearMonth,
        postsByYearMonthDay: mainLangPostIndex.postsByYearMonthDay,
      });
    }

    // --- Alternative language subtree generation ---
    for (const lang of additionalLanguages) {
      onProgress(85, `Generating ${lang} language subtree...`);

      const langPosts = publishedPosts.filter((p) => !p.doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !p.doNotTranslate);

      const langPostIndex = buildGenerationPostIndex(langListPosts);
      const langArchiveMetadata = collectSitemapArchiveMetadata({
        baseUrl: options.baseUrl,
        maxPostsPerPage,
        publishedPosts: langPosts,
        publishedListPosts: langListPosts,
      });

      const resolvedLangPosts = this.resolvePostsForLanguage(langPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangListPosts = this.resolvePostsForLanguage(langListPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangPostIndex = buildGenerationPostIndex(resolvedLangListPosts);

      if (includeCore) {
        const langFeedSlice = resolvedLangListPosts.slice(0, maxPostsPerPage);
        await this.resolveTranslatedPostContents(langFeedSlice);

        const langFeedResult = buildSitemapAndFeeds({
          baseUrl: `${options.baseUrl}/${lang}`,
          projectName: options.projectName,
          projectDescription: options.projectDescription,
          maxPostsPerPage,
          publishedPosts: langPosts,
          publishedListPosts: resolvedLangListPosts,
          postIndex: langPostIndex,
          includeFeeds: true,
          feedLanguage: lang,
        });

        const langRssPath = path.join(htmlDir, lang, 'rss.xml');
        const langAtomPath = path.join(htmlDir, lang, 'atom.xml');
        await fs.mkdir(path.join(htmlDir, lang), { recursive: true });
        await writeFileIfHashChanged({ projectId: options.projectId, filePath: langRssPath, relativePath: `${lang}/rss.xml`, content: langFeedResult.rssXml });
        await writeFileIfHashChanged({ projectId: options.projectId, filePath: langAtomPath, relativePath: `${lang}/atom.xml`, content: langFeedResult.atomXml });
      }

      const langRenderRoute = createPreviewBackedGenerationRouteRenderer({
        options: { ...options, language: lang },
        projectMainLanguage: mainLanguage,
        maxPostsPerPage,
        publishedPostsForLookup: resolvedLangPosts,
        languagePrefix: `/${lang}`,
        engines: {
          postEngine: createResolvedPostEngine(lang, true) as any,
          mediaEngine: this.mediaEngine,
          postMediaEngine: this.postMediaEngine,
        },
      });

      const langWritePage = (projectId: string, urlPath: string, content: string) => writeHtmlPage({
        projectId,
        htmlDir,
        urlPath: `${lang}/${urlPath}`,
        content,
        knownDirectories: knownOutputDirectories,
        hashCache: generatedHashCache,
        refreshHashTimestampOnUnchanged: true,
      });

      const langReportProgress = (message: string) => reportUnitProgress(`[${lang}] ${message}`);

      if (includeCore) {
        pagesGenerated += await generateRootPages({
          projectId: options.projectId,
          posts: resolvedLangListPosts,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
        pagesGenerated += await generatePageRoutes({
          projectId: options.projectId,
          posts: resolvedLangPosts,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
      }

      if (includeSingle) {
        pagesGenerated += await generateSinglePostPages({
          projectId: options.projectId,
          posts: resolvedLangPosts,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
      }

      if (includeCategory) {
        pagesGenerated += await generateCategoryPages({
          projectId: options.projectId,
          posts: resolvedLangListPosts,
          allCategories: langArchiveMetadata.allCategories,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByCategory: resolvedLangPostIndex.postsByCategory,
        });
      }

      if (includeTag) {
        pagesGenerated += await generateTagPages({
          projectId: options.projectId,
          posts: resolvedLangListPosts,
          allTags: langArchiveMetadata.allTags,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByTag: resolvedLangPostIndex.postsByTag,
        });
      }

      if (includeDate) {
        pagesGenerated += await generateDateArchivePages({
          projectId: options.projectId,
          posts: resolvedLangListPosts,
          yearsMap: langArchiveMetadata.years,
          yearMonthsMap: langArchiveMetadata.yearMonths,
          yearMonthDaysMap: langArchiveMetadata.yearMonthDays,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByYear: resolvedLangPostIndex.postsByYear,
          postsByYearMonth: resolvedLangPostIndex.postsByYearMonth,
          postsByYearMonthDay: resolvedLangPostIndex.postsByYearMonthDay,
        });
      }
    }

    return pagesGenerated;
  }

  async regenerateCalendar(
    options: BlogGenerationOptions,
    onProgress: (progress: number, message?: string) => void,
  ): Promise<CalendarRegenerationResult> {
    onProgress(0, 'Loading posts...');

    const categorySettings = resolveCategorySettings(options.categoryMetadata, options.categorySettings);
    const listExcludedCategories = Object.entries(categorySettings)
      .filter(([, settings]) => settings.renderInLists === false)
      .map(([category]) => category);

    const { publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);

    onProgress(50, 'Building calendar data...');

    const calendarJson = `${JSON.stringify(buildCalendarArchiveData(publishedListPosts), null, 2)}\n`;
    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const calendarPath = path.join(htmlDir, 'calendar.json');

    const changed = await writeFileIfHashChanged({
      projectId: options.projectId,
      filePath: calendarPath,
      relativePath: 'calendar.json',
      content: calendarJson,
    });

    onProgress(100, 'Calendar data regenerated');

    return {
      calendarPath,
      changed,
    };
  }

  async validateSite(
    options: BlogGenerationOptions,
    onProgress: (progress: number, message?: string) => void,
  ): Promise<SiteValidationReport> {
    onProgress(0, 'Collecting sitemap URLs...');

    const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage);
    const categorySettings = resolveCategorySettings(options.categoryMetadata, options.categorySettings);
    const listExcludedCategories = Object.entries(categorySettings)
      .filter(([, settings]) => settings.renderInLists === false)
      .map(([category]) => category);

    const { publishedPosts, publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);
    const { routePosts: publishedRoutePosts } = await this.buildPublishedRoutePosts(publishedPosts);
    const generationPostIndex = buildGenerationPostIndex(publishedListPosts);

    const { sitemapXml } = buildSitemapAndFeeds({
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectDescription: options.projectDescription,
      maxPostsPerPage,
      publishedPosts: publishedRoutePosts,
      publishedListPosts,
      postIndex: generationPostIndex,
      includeFeeds: false,
    });

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');

    // --- Build per-language expected paths ---
    const mainLanguage = (options.language ?? 'en').trim().toLowerCase();
    const additionalLanguages = (options.blogLanguages ?? [])
      .map((lang) => lang.trim().toLowerCase())
      .filter((lang) => lang.length > 0 && lang !== mainLanguage);

    let sitemapToWrite = sitemapXml;
    const additionalExpectedPaths: string[] = [];
    const additionalPostTimestampChecks: Array<{
      postUrlPath: string;
      postFilePath: string;
      generatedUpdatedAtMs?: number;
    }> = [];

    if (additionalLanguages.length > 0) {
      const langPosts = publishedPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);

      for (const lang of additionalLanguages) {
        const langPostIndex = buildGenerationPostIndex(langListPosts);
        const langSitemapResult = buildSitemapAndFeeds({
          baseUrl: `${options.baseUrl}/${lang}`,
          projectName: options.projectName,
          projectDescription: options.projectDescription,
          maxPostsPerPage,
          publishedPosts: langPosts,
          publishedListPosts: langListPosts,
          postIndex: langPostIndex,
          includeFeeds: false,
        });

        // Extract expected paths from the per-language sitemap, stripping base URL
        const langLocMatches = langSitemapResult.sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g);
        for (const match of langLocMatches) {
          const loc = match[1]?.trim();
          if (!loc) continue;
          try {
            const locUrl = new URL(loc);
            const base = new URL(options.baseUrl);
            let locPath = locUrl.pathname.replace(/\/+$/, '');
            const basePath = base.pathname.replace(/\/+$/, '');
            if (basePath && locPath.startsWith(basePath)) {
              locPath = locPath.slice(basePath.length);
            }
            additionalExpectedPaths.push(locPath || '/');
          } catch {
            additionalExpectedPaths.push(loc);
          }
        }

        // Build per-language post timestamp checks
        for (const post of langPosts) {
          const createdAt = resolvePostCreatedAt(post);
          const year = String(createdAt.getFullYear());
          const month = String(createdAt.getMonth() + 1).padStart(2, '0');
          const postFilePath = path.join(options.dataDir, 'posts', year, month, `${post.slug}.md`);
          const postUrlPath = `/${lang}${buildCanonicalPostPath(post)}`;
          const relativePath = `${postUrlPath.replace(/^\//, '')}/index.html`;
          const generatedRecord = await getGeneratedFileHashRecord(options.projectId, relativePath);

          additionalPostTimestampChecks.push({
            postUrlPath,
            postFilePath,
            generatedUpdatedAtMs: generatedRecord?.updatedAt,
          });
        }
      }

      // Write multi-language sitemap
      const allLanguages = [mainLanguage, ...additionalLanguages];
      const langFilteredPosts = publishedPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const doNotTranslateIds = new Set(
        publishedPosts
          .filter((p) => (p as PostData & { doNotTranslate?: boolean }).doNotTranslate)
          .map((p) => p.id),
      );

      sitemapToWrite = buildMultiLanguageSitemap({
        baseUrl: options.baseUrl,
        mainLanguage,
        allLanguages,
        translatablePosts: langFilteredPosts,
        doNotTranslatePosts: publishedPosts.filter((p) => doNotTranslateIds.has(p.id)),
        publishedListPosts,
        maxPostsPerPage,
        postIndex: generationPostIndex,
      });
    }

    const sitemapChanged = await writeFileIfHashChanged({
      projectId: options.projectId,
      filePath: sitemapPath,
      relativePath: 'sitemap.xml',
      content: sitemapToWrite,
    });

    onProgress(50, 'Comparing sitemap to html pages...');

    const postTimestampChecks = await Promise.all(publishedRoutePosts.map(async (post) => {
      const createdAt = resolvePostCreatedAt(post);
      const year = String(createdAt.getFullYear());
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const postFilePath = (post as PublishedTranslationVariant).translationFilePath
        ?? path.join(options.dataDir, 'posts', year, month, `${post.slug}.md`);
      const postUrlPath = buildCanonicalPostPath(post);
      const relativePath = `${postUrlPath.replace(/^\//, '')}/index.html`;
      const generatedRecord = await getGeneratedFileHashRecord(options.projectId, relativePath);

      return {
        postUrlPath,
        postFilePath,
        generatedUpdatedAtMs: generatedRecord?.updatedAt,
      };
    }));

    const diffResult = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: options.baseUrl,
      htmlDir,
      postTimestampChecks: [...postTimestampChecks, ...additionalPostTimestampChecks],
      additionalExpectedPaths,
    });

    onProgress(
      100,
      `Validation complete (${diffResult.missingUrlPaths.length} missing, ${diffResult.extraUrlPaths.length} extra, ${diffResult.updatedPostUrlPaths.length} updated)`
    );

    return {
      sitemapPath,
      sitemapChanged,
      missingUrlPaths: diffResult.missingUrlPaths,
      extraUrlPaths: diffResult.extraUrlPaths,
      updatedPostUrlPaths: diffResult.updatedPostUrlPaths,
      expectedUrlCount: diffResult.expectedUrlCount,
      existingHtmlUrlCount: diffResult.existingHtmlUrlCount,
    };
  }

  async applyValidation(
    options: BlogGenerationOptions,
    report: SiteValidationReport,
    onProgress: (progress: number, message?: string) => void,
  ): Promise<SiteValidationApplyResult> {
    onProgress(0, 'Applying validation changes...');

    const missingPaths = Array.isArray(report.missingUrlPaths) ? report.missingUrlPaths : [];
    const updatedPostPaths = Array.isArray(report.updatedPostUrlPaths) ? report.updatedPostUrlPaths : [];
    const rerenderPaths = Array.from(new Set([...missingPaths, ...updatedPostPaths]));
    const extraPaths = Array.isArray(report.extraUrlPaths) ? report.extraUrlPaths : [];

    onProgress(10, 'Planning validation apply steps...');

    const mainLanguage = (options.language ?? 'en').trim().toLowerCase();
    const additionalLanguages = (options.blogLanguages ?? [])
      .map((lang) => lang.trim().toLowerCase())
      .filter((lang) => lang.length > 0 && lang !== mainLanguage);

    const missingPathPlan = planMissingValidationPaths(rerenderPaths, additionalLanguages);

    onProgress(20, 'Deleting extra URLs...');

    const htmlDir = path.join(options.dataDir, 'html');
    let deletedUrlCount = 0;
    let removedEmptyDirCount = 0;

    const pruneEmptyParents = async (startDir: string): Promise<void> => {
      let currentDir = startDir;

      while (path.resolve(currentDir) !== path.resolve(htmlDir)) {
        let entries: string[];
        try {
          entries = await fs.readdir(currentDir);
        } catch {
          break;
        }

        if (entries.length > 0) {
          break;
        }

        await fs.rm(currentDir, { recursive: true, force: true });
        removedEmptyDirCount += 1;
        currentDir = path.dirname(currentDir);
      }
    };

    for (let index = 0; index < extraPaths.length; index += 1) {
      const urlPath = extraPaths[index];
      const filePath = urlPathToHtmlIndexPath(htmlDir, urlPath);
      try {
        await fs.unlink(filePath);
        deletedUrlCount += 1;
        await pruneEmptyParents(path.dirname(filePath));
      } catch {
        // ignore missing files and continue
      }

      if (extraPaths.length > 0) {
        const deleteProgress = 20 + Math.floor(((index + 1) / extraPaths.length) * 25);
        onProgress(Math.min(45, deleteProgress), `Deleted ${index + 1}/${extraPaths.length} extra URLs`);
      }
    }

    let renderedUrlCount = 0;

    if (missingPathPlan.requiresFallbackSectionRender) {
      onProgress(50, 'Rendering missing routes (fallback section mode)...');
      const sectionExecutionOrder: BlogGenerationSection[] = ['category', 'tag', 'date', 'core', 'single'];
      for (let index = 0; index < sectionExecutionOrder.length; index += 1) {
        const section = sectionExecutionOrder[index];
        const generationResult = await this.generate({
          ...options,
          maxPostsPerPage: options.maxPostsPerPage,
          sections: [section],
        }, (progress, message) => {
          const base = 50 + Math.floor((index / sectionExecutionOrder.length) * 40);
          const span = Math.max(1, Math.floor(40 / sectionExecutionOrder.length));
          const mapped = base + Math.floor((progress / 100) * span);
          onProgress(Math.min(90, mapped), message || `Rendering ${section} routes...`);
        });

        renderedUrlCount += generationResult.pagesGenerated;
      }
    } else {
      const categorySettings = resolveCategorySettings(options.categoryMetadata, options.categorySettings);
      const listExcludedCategories = Object.entries(categorySettings)
        .filter(([, settings]) => settings.renderInLists === false)
        .map(([category]) => category);

      const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage);
      const { publishedPosts, publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);
      const { routePosts: publishedRoutePosts, translationsByPost } = await this.buildPublishedRoutePosts(publishedPosts);
      const generationPostIndex = buildGenerationPostIndex(publishedListPosts);

      const { allCategories, allTags, years, yearMonths, yearMonthDays } = buildApplyValidationArchives(publishedListPosts);

      const targetedPlan = buildTargetedValidationPlan({
        initialPlan: missingPathPlan,
        publishedPosts: publishedRoutePosts,
        allCategories,
        allTags,
        availableYearMonths: yearMonths.keys(),
        availableYearMonthDays: yearMonthDays.keys(),
      });

      const htmlDir = path.join(options.dataDir, 'html');
      await fs.mkdir(htmlDir, { recursive: true });

      const useWorkers = !!options.dbPath;

      if (useWorkers) {
        // ── Worker-based targeted rendering ──────────────────────────────
        // Dispatches separate worker tasks per section (categories, tags,
        // single posts, date archives, core) so they render in parallel.
        renderedUrlCount += await this.applyValidationWithWorkers({
          options,
          maxPostsPerPage,
          htmlDir,
          publishedPosts,
          publishedListPosts,
          publishedRoutePosts,
          generationPostIndex,
          targetedPlan,
          missingPathPlan,
          mainLanguage,
          additionalLanguages,
          translationsByPost,
          years,
          yearMonths,
          yearMonthDays,
          onProgress,
        });
      } else {
        // ── Main-thread fallback (tests / no dbPath) ─────────────────────
        renderedUrlCount += await this.applyValidationOnMainThread({
          options,
          maxPostsPerPage,
          htmlDir,
          publishedPosts,
          publishedListPosts,
          publishedRoutePosts,
          generationPostIndex,
          targetedPlan,
          missingPathPlan,
          mainLanguage,
          additionalLanguages,
          years,
          yearMonths,
          yearMonthDays,
          onProgress,
        });
      }
    }

    if (renderedUrlCount > 0 || deletedUrlCount > 0) {
      onProgress(90, 'Regenerating calendar data...');
      await this.regenerateCalendar(options, (progress, message) => {
        const mappedProgress = 90 + Math.floor((progress / 100) * 9);
        onProgress(Math.min(99, mappedProgress), message || 'Regenerating calendar data...');
      });
    }

    onProgress(100, `Apply complete (${deletedUrlCount} deleted, ${renderedUrlCount} rendered)`);

    return {
      renderedUrlCount,
      deletedUrlCount,
      removedEmptyDirCount,
    };
  }

  // ── Main-thread targeted apply validation (tests / no dbPath) ──────────

  private async applyValidationOnMainThread(params: {
    options: BlogGenerationOptions;
    maxPostsPerPage: number;
    htmlDir: string;
    publishedPosts: PostData[];
    publishedListPosts: PostData[];
    publishedRoutePosts: PostData[];
    generationPostIndex: GenerationPostIndex;
    targetedPlan: import('./ValidationApplyPlannerService').TargetedValidationPlan;
    missingPathPlan: import('./ValidationApplyPlannerService').MissingPathPlan;
    mainLanguage: string;
    additionalLanguages: string[];
    years: Map<number, Date>;
    yearMonths: Map<string, Date>;
    yearMonthDays: Map<string, Date>;
    onProgress: (progress: number, message?: string) => void;
  }): Promise<number> {
    const {
      options, maxPostsPerPage, htmlDir,
      publishedPosts, publishedListPosts, publishedRoutePosts,
      generationPostIndex, targetedPlan, missingPathPlan,
      mainLanguage, additionalLanguages,
      years, yearMonths, yearMonthDays,
      onProgress,
    } = params;

    let renderedUrlCount = 0;

    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options,
      maxPostsPerPage,
      publishedPostsForLookup: publishedRoutePosts,
      engines: {
        postEngine: this.postEngine,
        mediaEngine: this.mediaEngine,
        postMediaEngine: this.postMediaEngine,
      },
    });
    const writePage = (projectId: string, urlPath: string, content: string) => writeHtmlPage({
      projectId,
      htmlDir,
      urlPath,
      content,
      refreshHashTimestampOnUnchanged: true,
    });
    const onPageGenerated = (_message: string) => {
      // no-op for applyValidation
    };

    const { requestedSinglePosts, requestedPagePosts } = selectRequestedPosts({
      publishedPosts: publishedRoutePosts,
      requestedPostIds: targetedPlan.requestedPostIds,
      requestedPageSlugs: targetedPlan.requestedPageSlugs,
    });

    const { requestedYearsMap, requestedYearMonthsMap, requestedYearMonthDaysMap } = buildRequestedArchiveMaps({
      requestedYears: targetedPlan.requestedYears,
      requestedYearMonths: targetedPlan.requestedYearMonths,
      requestedYearMonthDays: targetedPlan.requestedYearMonthDays,
      years,
      yearMonths,
      yearMonthDays,
    });

    onProgress(
      48,
      `Targeted rerender plan: singles=${requestedSinglePosts.length}, categories=${targetedPlan.requestedCategorySet.size}, tags=${targetedPlan.requestedTagSet.size}, years=${requestedYearsMap.size}, months=${requestedYearMonthsMap.size}, days=${requestedYearMonthDaysMap.size}, root=${targetedPlan.requestRootRoutes ? 1 : 0}, pages=${requestedPagePosts.length}`,
    );

    onProgress(50, 'Rendering targeted missing routes...');

    if (targetedPlan.requestRootRoutes) {
      renderedUrlCount += await generateRootPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated,
      });
    }

    if (requestedPagePosts.length > 0) {
      renderedUrlCount += await generatePageRoutes({
        projectId: options.projectId,
        posts: requestedPagePosts,
        renderRoute,
        writePage,
        onPageGenerated,
      });
    }

    if (targetedPlan.requestedCategorySet.size > 0) {
      renderedUrlCount += await generateCategoryPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        allCategories: targetedPlan.requestedCategorySet,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated,
        postsByCategory: generationPostIndex.postsByCategory,
      });
    }

    if (targetedPlan.requestedTagSet.size > 0) {
      renderedUrlCount += await generateTagPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        allTags: targetedPlan.requestedTagSet,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated,
        postsByTag: generationPostIndex.postsByTag,
      });
    }

    if (requestedSinglePosts.length > 0) {
      renderedUrlCount += await generateSinglePostPages({
        projectId: options.projectId,
        posts: requestedSinglePosts,
        renderRoute,
        writePage,
        onPageGenerated,
      });
    }

    if (requestedYearsMap.size > 0 || requestedYearMonthsMap.size > 0 || requestedYearMonthDaysMap.size > 0) {
      renderedUrlCount += await generateDateArchivePages({
        projectId: options.projectId,
        posts: publishedListPosts,
        yearsMap: requestedYearsMap,
        yearMonthsMap: requestedYearMonthsMap,
        yearMonthDaysMap: requestedYearMonthDaysMap,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated,
        postsByYear: generationPostIndex.postsByYear,
        postsByYearMonth: generationPostIndex.postsByYearMonth,
        postsByYearMonthDay: generationPostIndex.postsByYearMonthDay,
      });
    }

    // --- Render missing per-language subtree pages ---
    for (const [lang, langMissingPlan] of missingPathPlan.languagePlans) {
      const langPosts = publishedPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const langPostIndex = buildGenerationPostIndex(langListPosts);
      const langArchives = buildApplyValidationArchives(langListPosts);

      const langTargetedPlan = buildTargetedValidationPlan({
        initialPlan: langMissingPlan,
        publishedPosts: langPosts,
        allCategories: langArchives.allCategories,
        allTags: langArchives.allTags,
        availableYearMonths: langArchives.yearMonths.keys(),
        availableYearMonthDays: langArchives.yearMonthDays.keys(),
      });

      const langRenderRoute = createPreviewBackedGenerationRouteRenderer({
        options: { ...options, language: lang },
        maxPostsPerPage,
        publishedPostsForLookup: langPosts,
        languagePrefix: `/${lang}`,
        engines: {
          postEngine: this.postEngine,
          mediaEngine: this.mediaEngine,
          postMediaEngine: this.postMediaEngine,
        },
      });

      const langWritePage = (projectId: string, urlPath: string, content: string) => writeHtmlPage({
        projectId,
        htmlDir,
        urlPath: `${lang}/${urlPath}`,
        content,
        refreshHashTimestampOnUnchanged: true,
      });

      if (langTargetedPlan.requestRootRoutes) {
        renderedUrlCount += await generateRootPages({
          projectId: options.projectId,
          posts: langListPosts,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated,
        });
        const langRequestedPagePosts = selectRequestedPosts({
          publishedPosts: langPosts,
          requestedPostIds: new Set(),
          requestedPageSlugs: langTargetedPlan.requestedPageSlugs,
        }).requestedPagePosts;
        if (langRequestedPagePosts.length > 0) {
          renderedUrlCount += await generatePageRoutes({
            projectId: options.projectId,
            posts: langRequestedPagePosts,
            renderRoute: langRenderRoute,
            writePage: langWritePage,
            onPageGenerated,
          });
        }
      }

      if (langTargetedPlan.requestedCategorySet.size > 0) {
        renderedUrlCount += await generateCategoryPages({
          projectId: options.projectId,
          posts: langListPosts,
          allCategories: langTargetedPlan.requestedCategorySet,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated,
          postsByCategory: langPostIndex.postsByCategory,
        });
      }

      if (langTargetedPlan.requestedTagSet.size > 0) {
        renderedUrlCount += await generateTagPages({
          projectId: options.projectId,
          posts: langListPosts,
          allTags: langTargetedPlan.requestedTagSet,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated,
          postsByTag: langPostIndex.postsByTag,
        });
      }

      const langRequestedSinglePosts = selectRequestedPosts({
        publishedPosts: langPosts,
        requestedPostIds: langTargetedPlan.requestedPostIds,
        requestedPageSlugs: new Set(),
      }).requestedSinglePosts;

      if (langRequestedSinglePosts.length > 0) {
        renderedUrlCount += await generateSinglePostPages({
          projectId: options.projectId,
          posts: langRequestedSinglePosts,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated,
        });
      }

      const langRequestedArchives = buildRequestedArchiveMaps({
        requestedYears: langTargetedPlan.requestedYears,
        requestedYearMonths: langTargetedPlan.requestedYearMonths,
        requestedYearMonthDays: langTargetedPlan.requestedYearMonthDays,
        years: langArchives.years,
        yearMonths: langArchives.yearMonths,
        yearMonthDays: langArchives.yearMonthDays,
      });

      if (langRequestedArchives.requestedYearsMap.size > 0 || langRequestedArchives.requestedYearMonthsMap.size > 0 || langRequestedArchives.requestedYearMonthDaysMap.size > 0) {
        renderedUrlCount += await generateDateArchivePages({
          projectId: options.projectId,
          posts: langListPosts,
          yearsMap: langRequestedArchives.requestedYearsMap,
          yearMonthsMap: langRequestedArchives.requestedYearMonthsMap,
          yearMonthDaysMap: langRequestedArchives.requestedYearMonthDaysMap,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated,
          postsByYear: langPostIndex.postsByYear,
          postsByYearMonth: langPostIndex.postsByYearMonth,
          postsByYearMonthDay: langPostIndex.postsByYearMonthDay,
        });
      }
    }

    return renderedUrlCount;
  }

  // ── Worker-based targeted apply validation ───────────────────────────────

  private async applyValidationWithWorkers(params: {
    options: BlogGenerationOptions;
    maxPostsPerPage: number;
    htmlDir: string;
    publishedPosts: PostData[];
    publishedListPosts: PostData[];
    publishedRoutePosts: PostData[];
    generationPostIndex: GenerationPostIndex;
    targetedPlan: import('./ValidationApplyPlannerService').TargetedValidationPlan;
    missingPathPlan: import('./ValidationApplyPlannerService').MissingPathPlan;
    mainLanguage: string;
    additionalLanguages: string[];
    translationsByPost: Map<string, PostTranslationData[]>;
    years: Map<number, Date>;
    yearMonths: Map<string, Date>;
    yearMonthDays: Map<string, Date>;
    onProgress: (progress: number, message?: string) => void;
  }): Promise<number> {
    const {
      options, maxPostsPerPage, htmlDir,
      publishedPosts, publishedListPosts, publishedRoutePosts,
      generationPostIndex, targetedPlan, missingPathPlan,
      mainLanguage, additionalLanguages, translationsByPost,
      years, yearMonths, yearMonthDays,
      onProgress,
    } = params;

    // Pre-load media data for worker serialization
    const rawMedia = await this.mediaEngine.getAllMedia();
    const mediaItems = rawMedia.map(serializeMediaItem);

    // Pre-load backlinks
    let backlinksRecord: Record<string, Array<{ id: string; title: string; slug: string }>> = {};
    if (typeof this.postEngine.getAllBacklinks === 'function') {
      const blMap = await this.postEngine.getAllBacklinks();
      for (const [postId, links] of blMap) {
        backlinksRecord[postId] = links;
      }
    }

    const serializedOptions = serializeBlogGenerationOptions(options);

    // Pre-load post file paths
    let postFilePathEntries: Array<[string, string]> = [];
    if (typeof this.postEngine.getPublishedPostFilePaths === 'function') {
      const filePathMap = await this.postEngine.getPublishedPostFilePaths();
      postFilePathEntries = Array.from(filePathMap);
    }

    // Pre-load post-media links
    let postMediaLinksEntries: Array<[string, Array<{ mediaId: string; sortOrder: number }>]> = [];
    if (typeof this.postMediaEngine.getAllPostMediaLinks === 'function') {
      const linksMap = await this.postMediaEngine.getAllPostMediaLinks();
      postMediaLinksEntries = Array.from(linksMap);
    }

    // Bulk-load all known file hashes
    const generatedHashCache = new Map<string, string | null>();
    const existingHashes = await getAllGeneratedFileHashes(options.projectId);
    for (const [relativePath, hash] of existingHashes) {
      generatedHashCache.set(relativePath, hash);
    }

    const hashMapEntries: Array<[string, string]> = [];
    for (const [relativePath, hash] of generatedHashCache) {
      if (hash !== null) {
        hashMapEntries.push([relativePath, hash]);
      }
    }

    // Resolve posts to project main language before serialization
    const mainLangRoutePosts = this.resolvePostsForLanguage(publishedRoutePosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangListPosts = this.resolvePostsForLanguage(publishedListPosts, mainLanguage, translationsByPost, mainLanguage);
    const mainLangPostIndex = buildGenerationPostIndex(mainLangListPosts);

    const baseWorkerParams = {
      options: serializedOptions,
      maxPostsPerPage,
      htmlDir,
      mediaItems,
      backlinksRecord,
      hashMapEntries,
      postFilePathEntries,
      postMediaLinksEntries,
    };

    // Build main language tasks
    const tasks = buildApplyValidationWorkerTasks(baseWorkerParams, {
      targetedPlan,
      publishedRoutePosts: mainLangRoutePosts,
      publishedListPosts: mainLangListPosts,
      generationPostIndex: mainLangPostIndex,
      years,
      yearMonths,
      yearMonthDays,
    });

    // Build language subtree tasks
    for (const [lang, langMissingPlan] of missingPathPlan.languagePlans) {
      const langPosts = publishedPosts.filter((p) => !p.doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !p.doNotTranslate);
      const langArchives = buildApplyValidationArchives(langListPosts);

      const langTargetedPlan = buildTargetedValidationPlan({
        initialPlan: langMissingPlan,
        publishedPosts: langPosts,
        allCategories: langArchives.allCategories,
        allTags: langArchives.allTags,
        availableYearMonths: langArchives.yearMonths.keys(),
        availableYearMonthDays: langArchives.yearMonthDays.keys(),
      });

      const resolvedLangPosts = this.resolvePostsForLanguage(langPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangListPosts = this.resolvePostsForLanguage(langListPosts, lang, translationsByPost, mainLanguage);
      const resolvedLangPostIndex = buildGenerationPostIndex(resolvedLangListPosts);

      const langTasks = buildApplyValidationWorkerTasks(
        {
          ...baseWorkerParams,
          options: { ...serializedOptions, language: lang },
        },
        {
          targetedPlan: langTargetedPlan,
          publishedRoutePosts: resolvedLangPosts,
          publishedListPosts: resolvedLangListPosts,
          generationPostIndex: resolvedLangPostIndex,
          years: langArchives.years,
          yearMonths: langArchives.yearMonths,
          yearMonthDays: langArchives.yearMonthDays,
          languagePrefix: `/${lang}`,
          mainLanguage,
        },
      );

      tasks.push(...langTasks);
    }

    if (tasks.length === 0) {
      return 0;
    }

    onProgress(50, `Dispatching ${tasks.length} targeted tasks to worker pool...`);

    const pool = new GenerationWorkerPool();
    const reportUnitProgress = (message: string) => {
      onProgress(60, message);
    };

    const result = await pool.runTasks(tasks, reportUnitProgress);

    if (result.errors.length > 0) {
      console.error(`[ApplyValidation/Workers] ${result.errors.length} task(s) failed:`);
      for (const err of result.errors) {
        console.error(`  [${err.taskId}] ${err.error}`);
      }
    }

    // Persist hash updates collected from workers
    if (result.hashUpdates.length > 0) {
      for (const update of result.hashUpdates) {
        await setGeneratedFileHash(options.projectId, update.relativePath, update.hash);
      }
    }

    return result.pagesGenerated;
  }

}


