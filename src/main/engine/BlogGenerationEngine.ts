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
import { getGeneratedFileHashRecord } from '../database/generatedFileHashStore';

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

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
  getPostTranslations?: (postId: string) => Promise<PostTranslationData[]>;
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

  private async buildPublishedRoutePosts(publishedPosts: PostData[]): Promise<PostData[]> {
    const routePosts: PostData[] = [...publishedPosts];

    if (typeof this.postEngine.getPostTranslations !== 'function') {
      return routePosts;
    }

    for (const post of publishedPosts) {
      const translations = await this.postEngine.getPostTranslations(post.id);
      for (const translation of translations) {
        if (translation.status !== 'published') {
          continue;
        }

        routePosts.push(this.buildPublishedTranslationVariant(post, translation));
      }
    }

    return routePosts;
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
    const { publishedPosts, publishedListPosts } = await loadPublishedGenerationSets(this.postEngine, listExcludedCategories);
    const publishedRoutePosts = await this.buildPublishedRoutePosts(publishedPosts);

    onProgress(3, `Found ${publishedPosts.length} published posts`);

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
      knownDirectories: knownOutputDirectories,
      hashCache: generatedHashCache,
      refreshHashTimestampOnUnchanged: true,
    });

    let pagesGenerated = 0;

    if (includeCore) {
      onProgress(20, 'Generating root pages...');
      pagesGenerated += await generateRootPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
      pagesGenerated += await generatePageRoutes({
        projectId: options.projectId,
        posts: publishedRoutePosts,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
    }

    if (includeSingle) {
      onProgress(35, 'Generating single post pages...');
      pagesGenerated += await generateSinglePostPages({
        projectId: options.projectId,
        posts: publishedRoutePosts,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
      });
    }

    if (includeCategory) {
      onProgress(50, 'Generating category pages...');
      pagesGenerated += await generateCategoryPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        allCategories,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByCategory: generationPostIndex.postsByCategory,
      });
    }

    if (includeTag) {
      onProgress(65, 'Generating tag pages...');
      pagesGenerated += await generateTagPages({
        projectId: options.projectId,
        posts: publishedListPosts,
        allTags,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByTag: generationPostIndex.postsByTag,
      });
    }

    if (includeDate) {
      onProgress(80, 'Generating date archive pages...');
      pagesGenerated += await generateDateArchivePages({
        projectId: options.projectId,
        posts: publishedListPosts,
        yearsMap: years,
        yearMonthsMap: yearMonths,
        yearMonthDaysMap: yearMonthDays,
        maxPostsPerPage,
        renderRoute,
        writePage,
        onPageGenerated: reportUnitProgress,
        postsByYear: generationPostIndex.postsByYear,
        postsByYearMonth: generationPostIndex.postsByYearMonth,
        postsByYearMonthDay: generationPostIndex.postsByYearMonthDay,
      });
    }

    // --- Alternative language subtree generation ---
    const mainLanguage = (options.language ?? 'en').trim().toLowerCase();
    const additionalLanguages = (options.blogLanguages ?? [])
      .map((lang) => lang.trim().toLowerCase())
      .filter((lang) => lang.length > 0 && lang !== mainLanguage);

    for (const lang of additionalLanguages) {
      onProgress(85, `Generating ${lang} language subtree...`);

      // Filter out doNotTranslate posts
      const langPosts = publishedPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);
      const langListPosts = publishedListPosts.filter((p) => !(p as PostData & { doNotTranslate?: boolean }).doNotTranslate);

      const langPostIndex = buildGenerationPostIndex(langListPosts);
      const langArchiveMetadata = collectSitemapArchiveMetadata({
        baseUrl: options.baseUrl,
        maxPostsPerPage,
        publishedPosts: langPosts,
        publishedListPosts: langListPosts,
      });

      // Build per-language feeds
      if (includeCore) {
        const langFeedResult = buildSitemapAndFeeds({
          baseUrl: `${options.baseUrl}/${lang}`,
          projectName: options.projectName,
          projectDescription: options.projectDescription,
          maxPostsPerPage,
          publishedPosts: langPosts,
          publishedListPosts: langListPosts,
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
        knownDirectories: knownOutputDirectories,
        hashCache: generatedHashCache,
        refreshHashTimestampOnUnchanged: true,
      });

      const langReportProgress = (message: string) => reportUnitProgress(`[${lang}] ${message}`);

      if (includeCore) {
        pagesGenerated += await generateRootPages({
          projectId: options.projectId,
          posts: langListPosts,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
        pagesGenerated += await generatePageRoutes({
          projectId: options.projectId,
          posts: langPosts,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
      }

      if (includeSingle) {
        pagesGenerated += await generateSinglePostPages({
          projectId: options.projectId,
          posts: langPosts,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
        });
      }

      if (includeCategory) {
        pagesGenerated += await generateCategoryPages({
          projectId: options.projectId,
          posts: langListPosts,
          allCategories: langArchiveMetadata.allCategories,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByCategory: langPostIndex.postsByCategory,
        });
      }

      if (includeTag) {
        pagesGenerated += await generateTagPages({
          projectId: options.projectId,
          posts: langListPosts,
          allTags: langArchiveMetadata.allTags,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByTag: langPostIndex.postsByTag,
        });
      }

      if (includeDate) {
        pagesGenerated += await generateDateArchivePages({
          projectId: options.projectId,
          posts: langListPosts,
          yearsMap: langArchiveMetadata.years,
          yearMonthsMap: langArchiveMetadata.yearMonths,
          yearMonthDaysMap: langArchiveMetadata.yearMonthDays,
          maxPostsPerPage,
          renderRoute: langRenderRoute,
          writePage: langWritePage,
          onPageGenerated: langReportProgress,
          postsByYear: langPostIndex.postsByYear,
          postsByYearMonth: langPostIndex.postsByYearMonth,
          postsByYearMonthDay: langPostIndex.postsByYearMonthDay,
        });
      }
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
    const publishedRoutePosts = await this.buildPublishedRoutePosts(publishedPosts);
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
    const sitemapChanged = await writeFileIfHashChanged({
      projectId: options.projectId,
      filePath: sitemapPath,
      relativePath: 'sitemap.xml',
      content: sitemapXml,
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
      postTimestampChecks,
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

    const missingPathPlan = planMissingValidationPaths(rerenderPaths);

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
      const publishedRoutePosts = await this.buildPublishedRoutePosts(publishedPosts);
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

}


