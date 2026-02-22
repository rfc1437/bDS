import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { readFile } from 'node:fs/promises';
import { getGeneratedFileHash, setGeneratedFileHash } from '../database/generatedFileHashStore';
import { getPostEngine, type PostData } from './PostEngine';
import { getMediaEngine, type MediaData } from './MediaEngine';
import { getPostMediaEngine } from './PostMediaEngine';
import {
  PageRenderer,
  PREVIEW_ASSETS,
  PREVIEW_IMAGE_ASSETS,
  buildTemplateMenuItems,
  buildCanonicalPostPath,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
  type TemplateMenuItem,
} from './PageRenderer';
import { getPicoStylesheetHref, sanitizePicoTheme, type PicoThemeName } from '../shared/picoThemes';
import type { MenuDocument } from './MenuEngine';
import type { ProjectMetadata } from './MetaEngine';
import { PreviewServer } from './PreviewServer';
import { loadPublishedGenerationSets } from './GenerationPostSnapshotService';
import { buildSitemapAndFeeds, type GenerationPostIndexLike } from './GenerationSitemapFeedService';
import { buildTargetedValidationPlan, planMissingValidationPaths } from './ValidationApplyPlannerService';
import { compareSitemapToHtml } from './SiteValidationDiffService';

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
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
}

export interface SiteValidationApplyResult {
  renderedUrlCount: number;
  deletedUrlCount: number;
  removedEmptyDirCount: number;
}

type GenerationPostIndex = GenerationPostIndexLike;

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


function normalizeUrlPath(urlPath: string): string {
  const trimmed = (urlPath || '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const noQuery = trimmed.split('?')[0]?.split('#')[0] ?? '';
  const withoutSlashes = noQuery.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}` : '/';
}

function urlPathToHtmlIndexPath(htmlDir: string, urlPath: string): string {
  const normalizedPath = normalizeUrlPath(urlPath);
  if (normalizedPath === '/') {
    return path.join(htmlDir, 'index.html');
  }

  return path.join(htmlDir, normalizedPath.slice(1), 'index.html');
}


function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function writeFileIfHashChanged(projectId: string, filePath: string, relativePath: string, content: string): Promise<boolean> {
  const hash = computeContentHash(content);
  const previousHash = await getGeneratedFileHash(projectId, relativePath);
  if (previousHash === hash) {
    return false;
  }
  await fs.writeFile(filePath, content, 'utf-8');
  await setGeneratedFileHash(projectId, relativePath, hash);
  return true;
}

async function writeHtmlPage(projectId: string, htmlDir: string, urlPath: string, content: string): Promise<boolean> {
  const normalizedPath = urlPath.replace(/^\//, '');
  const filePath = normalizedPath
    ? path.join(htmlDir, normalizedPath, 'index.html')
    : path.join(htmlDir, 'index.html');
  const relativePath = normalizedPath ? `${normalizedPath}/index.html` : 'index.html';
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return writeFileIfHashChanged(projectId, filePath, relativePath, content);
}

export class BlogGenerationEngine {
  private readonly postEngine = getPostEngine();
  private readonly mediaEngine = getMediaEngine();
  private readonly postMediaEngine = getPostMediaEngine();

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

    onProgress(3, `Found ${publishedPosts.length} published posts`);

    const generationPostIndex = this.buildGenerationPostIndex(publishedListPosts);

    onProgress(5, 'Building sitemap XML...');
    const {
      allTags,
      allCategories,
      yearMonths,
      years,
      yearMonthDays,
      urls,
      sitemapXml,
      rssXml,
      atomXml,
      feedPosts,
    } = buildSitemapAndFeeds({
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectDescription: options.projectDescription,
      maxPostsPerPage,
      publishedPosts,
      publishedListPosts,
      postIndex: generationPostIndex,
      includeFeeds: true,
    });

    onProgress(8, 'Building RSS and Atom feeds...');

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');
    const rssPath = path.join(htmlDir, 'rss.xml');
    const atomPath = path.join(htmlDir, 'atom.xml');

    const estimatedUnitsBySection = this.estimateGenerationUnitsBySection(
      publishedListPosts,
      allCategories,
      allTags,
      years,
      yearMonths,
      yearMonthDays,
      maxPostsPerPage,
      generationPostIndex,
    );
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

    if (includeCore) {
      onProgress(10, 'Writing sitemap and feeds...');
      sitemapWritten = await writeFileIfHashChanged(options.projectId, sitemapPath, 'sitemap.xml', sitemapXml);
      reportUnitProgress('Sitemap written');
      rssWritten = await writeFileIfHashChanged(options.projectId, rssPath, 'rss.xml', rssXml);
      reportUnitProgress('RSS feed written');
      atomWritten = await writeFileIfHashChanged(options.projectId, atomPath, 'atom.xml', atomXml);
      reportUnitProgress('Atom feed written');

      onProgress(15, 'Copying assets...');
      await this.copyAssets(htmlDir);
      reportUnitProgress('Assets copied');
    }

    const renderRoute = this.createSharedRouteRenderer(options, maxPostsPerPage, publishedPosts);

    let pagesGenerated = 0;

    if (includeCore) {
      onProgress(20, 'Generating root pages...');
      pagesGenerated += await this.generateRootPages(options.projectId, publishedListPosts, maxPostsPerPage, htmlDir, renderRoute, reportUnitProgress);
      pagesGenerated += await this.generatePageRoutes(options.projectId, publishedPosts, htmlDir, renderRoute, reportUnitProgress);
    }

    if (includeSingle) {
      onProgress(35, 'Generating single post pages...');
      pagesGenerated += await this.generateSinglePostPages(options.projectId, publishedPosts, htmlDir, renderRoute, reportUnitProgress);
    }

    if (includeCategory) {
      onProgress(50, 'Generating category pages...');
      pagesGenerated += await this.generateCategoryPages(options.projectId, publishedListPosts, allCategories, maxPostsPerPage, htmlDir, renderRoute, reportUnitProgress, generationPostIndex.postsByCategory);
    }

    if (includeTag) {
      onProgress(65, 'Generating tag pages...');
      pagesGenerated += await this.generateTagPages(options.projectId, publishedListPosts, allTags, maxPostsPerPage, htmlDir, renderRoute, reportUnitProgress, generationPostIndex.postsByTag);
    }

    if (includeDate) {
      onProgress(80, 'Generating date archive pages...');
      pagesGenerated += await this.generateDateArchivePages(
        options.projectId,
        publishedListPosts,
        years,
        yearMonths,
        yearMonthDays,
        maxPostsPerPage,
        htmlDir,
        renderRoute,
        reportUnitProgress,
        generationPostIndex.postsByYear,
        generationPostIndex.postsByYearMonth,
        generationPostIndex.postsByYearMonthDay,
      );
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
    const generationPostIndex = this.buildGenerationPostIndex(publishedListPosts);

    const { sitemapXml } = buildSitemapAndFeeds({
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectDescription: options.projectDescription,
      maxPostsPerPage,
      publishedPosts,
      publishedListPosts,
      postIndex: generationPostIndex,
      includeFeeds: false,
    });

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');
    const sitemapChanged = await writeFileIfHashChanged(options.projectId, sitemapPath, 'sitemap.xml', sitemapXml);

    onProgress(50, 'Comparing sitemap to html pages...');

    const diffResult = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: options.baseUrl,
      htmlDir,
    });

    onProgress(100, `Validation complete (${diffResult.missingUrlPaths.length} missing, ${diffResult.extraUrlPaths.length} extra)`);

    return {
      sitemapPath,
      sitemapChanged,
      missingUrlPaths: diffResult.missingUrlPaths,
      extraUrlPaths: diffResult.extraUrlPaths,
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
    const extraPaths = Array.isArray(report.extraUrlPaths) ? report.extraUrlPaths : [];

    onProgress(10, 'Planning validation apply steps...');

    const missingPathPlan = planMissingValidationPaths(missingPaths);

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
      const generationPostIndex = this.buildGenerationPostIndex(publishedListPosts);

      const allCategories = new Set<string>();
      const allTags = new Set<string>();
      const years = new Map<number, Date>();
      const yearMonths = new Map<string, Date>();
      const yearMonthDays = new Map<string, Date>();

      for (const post of publishedListPosts) {
        for (const category of post.categories || []) allCategories.add(category);
        for (const tag of post.tags || []) allTags.add(tag);

        const createdAt = resolvePostCreatedAt(post);
        const updatedAt = post.updatedAt;
        const year = createdAt.getFullYear();
        const month = String(createdAt.getMonth() + 1).padStart(2, '0');
        const day = String(createdAt.getDate()).padStart(2, '0');
        const ymKey = `${year}/${month}`;
        const ymdKey = `${year}/${month}/${day}`;

        if (!years.has(year) || updatedAt > years.get(year)!) {
          years.set(year, updatedAt);
        }
        if (!yearMonths.has(ymKey) || updatedAt > yearMonths.get(ymKey)!) {
          yearMonths.set(ymKey, updatedAt);
        }
        if (!yearMonthDays.has(ymdKey) || updatedAt > yearMonthDays.get(ymdKey)!) {
          yearMonthDays.set(ymdKey, updatedAt);
        }
      }

      const targetedPlan = buildTargetedValidationPlan({
        initialPlan: missingPathPlan,
        publishedPosts,
        allCategories,
        allTags,
        availableYearMonths: yearMonths.keys(),
        availableYearMonthDays: yearMonthDays.keys(),
      });

      const htmlDir = path.join(options.dataDir, 'html');
      await fs.mkdir(htmlDir, { recursive: true });

      const renderRoute = this.createSharedRouteRenderer(options, maxPostsPerPage, publishedPosts);
      const onPageGenerated = (_message: string) => {
        // no-op for applyValidation
      };

      const requestedSinglePosts = publishedPosts.filter((post) => targetedPlan.requestedPostIds.has(post.id));
      const requestedPagePosts = publishedPosts.filter((post) => {
        if (!targetedPlan.requestedPageSlugs.has(post.slug)) {
          return false;
        }
        const categories = Array.isArray(post.categories) ? post.categories : [];
        return categories.includes('page');
      });

      const requestedYearsMap = new Map<number, Date>();
      for (const year of targetedPlan.requestedYears) {
        const lastmod = years.get(year);
        if (lastmod) {
          requestedYearsMap.set(year, lastmod);
        }
      }

      const requestedYearMonthsMap = new Map<string, Date>();
      for (const ym of targetedPlan.requestedYearMonths) {
        const lastmod = yearMonths.get(ym);
        if (lastmod) {
          requestedYearMonthsMap.set(ym, lastmod);
        }
      }

      const requestedYearMonthDaysMap = new Map<string, Date>();
      for (const ymd of targetedPlan.requestedYearMonthDays) {
        const lastmod = yearMonthDays.get(ymd);
        if (lastmod) {
          requestedYearMonthDaysMap.set(ymd, lastmod);
        }
      }

      onProgress(
        48,
        `Targeted rerender plan: singles=${requestedSinglePosts.length}, categories=${targetedPlan.requestedCategorySet.size}, tags=${targetedPlan.requestedTagSet.size}, years=${requestedYearsMap.size}, months=${requestedYearMonthsMap.size}, days=${requestedYearMonthDaysMap.size}, root=${targetedPlan.requestRootRoutes ? 1 : 0}, pages=${requestedPagePosts.length}`,
      );

      onProgress(50, 'Rendering targeted missing routes...');

      if (targetedPlan.requestRootRoutes) {
        renderedUrlCount += await this.generateRootPages(
          options.projectId,
          publishedListPosts,
          maxPostsPerPage,
          htmlDir,
          renderRoute,
          onPageGenerated,
        );
      }

      if (requestedPagePosts.length > 0) {
        renderedUrlCount += await this.generatePageRoutes(
          options.projectId,
          requestedPagePosts,
          htmlDir,
          renderRoute,
          onPageGenerated,
        );
      }

      if (targetedPlan.requestedCategorySet.size > 0) {
        renderedUrlCount += await this.generateCategoryPages(
          options.projectId,
          publishedListPosts,
          targetedPlan.requestedCategorySet,
          maxPostsPerPage,
          htmlDir,
          renderRoute,
          onPageGenerated,
          generationPostIndex.postsByCategory,
        );
      }

      if (targetedPlan.requestedTagSet.size > 0) {
        renderedUrlCount += await this.generateTagPages(
          options.projectId,
          publishedListPosts,
          targetedPlan.requestedTagSet,
          maxPostsPerPage,
          htmlDir,
          renderRoute,
          onPageGenerated,
          generationPostIndex.postsByTag,
        );
      }

      if (requestedSinglePosts.length > 0) {
        renderedUrlCount += await this.generateSinglePostPages(
          options.projectId,
          requestedSinglePosts,
          htmlDir,
          renderRoute,
          onPageGenerated,
        );
      }

      if (requestedYearsMap.size > 0 || requestedYearMonthsMap.size > 0 || requestedYearMonthDaysMap.size > 0) {
        renderedUrlCount += await this.generateDateArchivePages(
          options.projectId,
          publishedListPosts,
          requestedYearsMap,
          requestedYearMonthsMap,
          requestedYearMonthDaysMap,
          maxPostsPerPage,
          htmlDir,
          renderRoute,
          onPageGenerated,
          generationPostIndex.postsByYear,
          generationPostIndex.postsByYearMonth,
          generationPostIndex.postsByYearMonthDay,
        );
      }
    }

    onProgress(100, `Apply complete (${deletedUrlCount} deleted, ${renderedUrlCount} rendered)`);

    return {
      renderedUrlCount,
      deletedUrlCount,
      removedEmptyDirCount,
    };
  }

  private async generatePageRoutes(
    projectId: string,
    posts: PostData[],
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;
    const pagePosts = posts.filter((post) => (post.categories || []).includes('page'));

    for (const post of pagePosts) {
      const routePath = `/${post.slug}`;
      const html = await this.renderRequiredRoute(renderRoute, routePath);
      await writeHtmlPage(projectId, htmlDir, post.slug, html);
      count++;
      onPageGenerated(`Generated /${post.slug}`);
    }

    return count;
  }

  private createSharedRouteRenderer(
    options: BlogGenerationOptions,
    maxPostsPerPage: number,
    publishedPostsForLookup: PostData[] = [],
  ): (pathname: string) => Promise<string | null> {
    const metadata: ProjectMetadata = {
      name: options.projectName,
      description: options.projectDescription,
      mainLanguage: options.language,
      maxPostsPerPage,
      picoTheme: options.picoTheme,
      categoryMetadata: options.categoryMetadata,
      categorySettings: options.categorySettings,
    };

    const menu = options.menu ?? { items: [] };
    const projectContext = {
      projectId: options.projectId,
      dataDir: options.dataDir,
      projectName: options.projectName,
      projectDescription: options.projectDescription,
    };

    const routeHtmlCache = new Map<string, Promise<string | null>>();
    const mediaItemsPromiseCache = new Map<string, Promise<Awaited<ReturnType<typeof this.mediaEngine.getAllMedia>>>>();
    const postsByFilterPromiseCache = new Map<string, Promise<PostData[]>>();
    const publishedSnapshotByIdPromiseCache = new Map<string, Promise<PostData | null>>();
    type PostFilterInput = Parameters<typeof this.postEngine.getPostsFiltered>[0];
    const publishedBySlugIndex = new Map<string, PostData[]>();

    for (const post of publishedPostsForLookup) {
      const existing = publishedBySlugIndex.get(post.slug);
      if (existing) {
        existing.push(post);
      } else {
        publishedBySlugIndex.set(post.slug, [post]);
      }
    }

    const serializeFilter = (filter: PostFilterInput): string => {
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
      getPostsFiltered: (filter: PostFilterInput) => {
        const cacheKey = serializeFilter(filter);
        const cached = postsByFilterPromiseCache.get(cacheKey);
        if (cached) {
          return cached;
        }

        const promise = this.postEngine.getPostsFiltered(filter);
        postsByFilterPromiseCache.set(cacheKey, promise);
        return promise;
      },
      getPublishedVersion: (postId: string) => {
        const cached = publishedSnapshotByIdPromiseCache.get(postId);
        if (cached) {
          return cached;
        }

        const promise = this.postEngine.getPublishedVersion(postId);
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
      getPost: (postId: string) => this.postEngine.getPost(postId),
      hasPublishedVersion: (postId: string) => this.postEngine.hasPublishedVersion(postId),
      setProjectContext: (projectId: string, dataDir?: string) => {
        this.postEngine.setProjectContext(projectId, dataDir);
      },
    };

    const cachedMediaEngine = {
      getAllMedia: () => {
        const cacheKey = `${options.projectId}:${options.dataDir ?? ''}`;
        const cached = mediaItemsPromiseCache.get(cacheKey);
        if (cached) {
          return cached;
        }

        const promise = this.mediaEngine.getAllMedia();
        mediaItemsPromiseCache.set(cacheKey, promise);
        return promise;
      },
      setProjectContext: (projectId: string, dataDir?: string, internalDir?: string) => {
        this.mediaEngine.setProjectContext?.(projectId, dataDir, internalDir);
      },
    };

    const previewServer = new PreviewServer({
      postEngine: cachedPostEngine,
      mediaEngine: cachedMediaEngine,
      postMediaEngine: this.postMediaEngine,
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

    return async (pathname: string): Promise<string | null> => {
      const normalizedPathname = decodeURIComponent(pathname.replace(/\/+$/, '') || '/');
      const cached = routeHtmlCache.get(normalizedPathname);
      if (cached) {
        return cached;
      }

      const promise = previewServer.renderRouteForContext(normalizedPathname, {
        projectContext,
        metadata,
        menu,
        maxPostsPerPage,
      });

      routeHtmlCache.set(normalizedPathname, promise);
      return promise;
    };
  }

  private async renderRequiredRoute(
    renderRoute: (pathname: string) => Promise<string | null>,
    pathname: string,
  ): Promise<string> {
    const html = await renderRoute(pathname);
    if (html !== null) {
      return html;
    }

    throw new Error(`Shared route renderer returned null for required path: ${pathname}`);
  }

  private async copyAssets(htmlDir: string): Promise<void> {
    const assetsDir = path.join(htmlDir, 'assets');
    const imagesDir = path.join(htmlDir, 'images');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });

    for (const [filename, definition] of Object.entries(PREVIEW_ASSETS)) {
      const destPath = path.join(assetsDir, filename);
      const content = definition.sourceText !== undefined
        ? Buffer.from(definition.sourceText, 'utf-8')
        : await readFile(require.resolve(definition.modulePath as string));
      await fs.writeFile(destPath, content);
    }

    for (const [filename, definition] of Object.entries(PREVIEW_IMAGE_ASSETS)) {
      const sourcePath = require.resolve(definition.modulePath);
      const destPath = path.join(imagesDir, filename);
      const content = await readFile(sourcePath);
      await fs.writeFile(destPath, content);
    }
  }

  private async generateRootPages(
    projectId: string,
    posts: PostData[],
    maxPostsPerPage: number,
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    const totalPages = Math.max(1, Math.ceil(posts.length / maxPostsPerPage));
    let count = 0;

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * maxPostsPerPage;
      const pagePosts = posts.slice(offset, offset + maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const routePath = page === 1 ? '/' : `/page/${page}`;
      const html = await this.renderRequiredRoute(renderRoute, routePath);

      if (html) {
        const urlPath = page === 1 ? '' : `page/${page}`;
        await writeHtmlPage(projectId, htmlDir, urlPath, html);
        count++;
        onPageGenerated(urlPath ? `Generated /${urlPath}` : 'Generated /');
      }
    }

    return count;
  }

  private async generateSinglePostPages(
    projectId: string,
    posts: PostData[],
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;

    for (const post of posts) {
      const createdAt = resolvePostCreatedAt(post);
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');

      const urlPath = `${year}/${month}/${day}/${post.slug}`;
      const html = await this.renderRequiredRoute(renderRoute, `/${urlPath}`);
      await writeHtmlPage(projectId, htmlDir, urlPath, html);
      count++;
      onPageGenerated(`Generated /${urlPath}`);
    }

    return count;
  }

  private async generateCategoryPages(
    projectId: string,
    posts: PostData[],
    allCategories: Set<string>,
    maxPostsPerPage: number,
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
    postsByCategory?: Map<string, PostData[]>,
  ): Promise<number> {
    let count = 0;

    for (const category of Array.from(allCategories).sort()) {
      const categoryPosts = postsByCategory?.get(category) ?? posts.filter((post) => (post.categories || []).includes(category));
      if (categoryPosts.length === 0) continue;

      const totalPages = Math.max(1, Math.ceil(categoryPosts.length / maxPostsPerPage));
      const encodedCategory = encodeURIComponent(category);

      for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * maxPostsPerPage;
        const pagePosts = categoryPosts.slice(offset, offset + maxPostsPerPage);
        if (pagePosts.length === 0) break;

        const routePath = page === 1
          ? `/category/${encodedCategory}`
          : `/category/${encodedCategory}/page/${page}`;
        const html = await this.renderRequiredRoute(renderRoute, routePath);

        if (html) {
          const urlPath = page === 1
            ? `category/${encodedCategory}`
            : `category/${encodedCategory}/page/${page}`;
          await writeHtmlPage(projectId, htmlDir, urlPath, html);
          count++;
          onPageGenerated(`Generated /${urlPath}`);
        }
      }
    }

    return count;
  }

  private async generateTagPages(
    projectId: string,
    posts: PostData[],
    allTags: Set<string>,
    maxPostsPerPage: number,
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
    postsByTag?: Map<string, PostData[]>,
  ): Promise<number> {
    let count = 0;

    for (const tag of Array.from(allTags).sort()) {
      const tagPosts = postsByTag?.get(tag) ?? posts.filter((post) => (post.tags || []).includes(tag));
      if (tagPosts.length === 0) continue;

      const totalPages = Math.max(1, Math.ceil(tagPosts.length / maxPostsPerPage));
      const encodedTag = encodeURIComponent(tag);

      for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * maxPostsPerPage;
        const pagePosts = tagPosts.slice(offset, offset + maxPostsPerPage);
        if (pagePosts.length === 0) break;

        const routePath = page === 1
          ? `/tag/${encodedTag}`
          : `/tag/${encodedTag}/page/${page}`;
        const html = await this.renderRequiredRoute(renderRoute, routePath);

        if (html) {
          const urlPath = page === 1
            ? `tag/${encodedTag}`
            : `tag/${encodedTag}/page/${page}`;
          await writeHtmlPage(projectId, htmlDir, urlPath, html);
          count++;
          onPageGenerated(`Generated /${urlPath}`);
        }
      }
    }

    return count;
  }

  private async generateDateArchivePages(
    projectId: string,
    posts: PostData[],
    yearsMap: Map<number, Date>,
    yearMonthsMap: Map<string, Date>,
    yearMonthDaysMap: Map<string, Date>,
    maxPostsPerPage: number,
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
    postsByYear?: Map<number, PostData[]>,
    postsByYearMonth?: Map<string, PostData[]>,
    postsByYearMonthDay?: Map<string, PostData[]>,
  ): Promise<number> {
    let count = 0;

    for (const [year] of Array.from(yearsMap.entries()).sort((a, b) => b[0] - a[0])) {
      const yearPosts = postsByYear?.get(year) ?? posts.filter((post) => resolvePostCreatedAt(post).getFullYear() === year);
      count += await this.generatePaginatedListPages(
        projectId, yearPosts, maxPostsPerPage, htmlDir, renderRoute, onPageGenerated,
        `${year}`,
      );
    }

    for (const [ym] of Array.from(yearMonthsMap.entries()).sort().reverse()) {
      const [yearStr, monthStr] = ym.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const monthPosts = postsByYearMonth?.get(ym) ?? posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      });
      count += await this.generatePaginatedListPages(
        projectId, monthPosts, maxPostsPerPage, htmlDir, renderRoute, onPageGenerated,
        ym,
      );
    }

    for (const [ymd] of Array.from(yearMonthDaysMap.entries()).sort().reverse()) {
      const [yearStr, monthStr, dayStr] = ymd.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const dayPosts = postsByYearMonthDay?.get(ymd) ?? posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month && d.getDate() === day;
      });
      count += await this.generatePaginatedListPages(
        projectId, dayPosts, maxPostsPerPage, htmlDir, renderRoute, onPageGenerated,
        ymd,
      );
    }

    return count;
  }

  private async generatePaginatedListPages(
    projectId: string,
    posts: PostData[],
    maxPostsPerPage: number,
    htmlDir: string,
    renderRoute: (pathname: string) => Promise<string | null>,
    onPageGenerated: (message: string) => void,
    urlPrefix: string,
  ): Promise<number> {
    if (posts.length === 0) return 0;

    const totalPages = Math.max(1, Math.ceil(posts.length / maxPostsPerPage));
    let count = 0;

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * maxPostsPerPage;
      const pagePosts = posts.slice(offset, offset + maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const routePath = page === 1 ? `/${urlPrefix}` : `/${urlPrefix}/page/${page}`;
      const html = await this.renderRequiredRoute(renderRoute, routePath);

      if (html) {
        const urlPath = page === 1
          ? urlPrefix
          : `${urlPrefix}/page/${page}`;
        await writeHtmlPage(projectId, htmlDir, urlPath, html);
        count++;
        onPageGenerated(`Generated /${urlPath}`);
      }
    }

    return count;
  }

  private estimateGenerationUnitsBySection(
    posts: PostData[],
    allCategories: Set<string>,
    allTags: Set<string>,
    yearsMap: Map<number, Date>,
    yearMonthsMap: Map<string, Date>,
    yearMonthDaysMap: Map<string, Date>,
    maxPostsPerPage: number,
    postIndex?: GenerationPostIndex,
  ): Record<BlogGenerationSection, number> {
    const index = postIndex ?? this.buildGenerationPostIndex(posts);
    const rootPages = this.countPaginatedPages(posts.length, maxPostsPerPage);
    const pageRoutes = index.postsByCategory.get('page')?.length ?? 0;

    const categoryPages = Array.from(allCategories).reduce((sum, category) => {
      const count = index.postsByCategory.get(category)?.length ?? 0;
      return sum + this.countPaginatedPages(count, maxPostsPerPage);
    }, 0);

    const tagPages = Array.from(allTags).reduce((sum, tag) => {
      const count = index.postsByTag.get(tag)?.length ?? 0;
      return sum + this.countPaginatedPages(count, maxPostsPerPage);
    }, 0);

    let datePages = 0;

    for (const [year] of yearsMap) {
      const count = index.postsByYear.get(year)?.length ?? 0;
      datePages += this.countPaginatedPages(count, maxPostsPerPage);
    }

    for (const [ym] of yearMonthsMap) {
      const count = index.postsByYearMonth.get(ym)?.length ?? 0;
      datePages += this.countPaginatedPages(count, maxPostsPerPage);
    }

    for (const [ymd] of yearMonthDaysMap) {
      const count = index.postsByYearMonthDay.get(ymd)?.length ?? 0;
      datePages += this.countPaginatedPages(count, maxPostsPerPage);
    }

    return {
      core: 4 + rootPages + pageRoutes,
      single: posts.length,
      category: categoryPages,
      tag: tagPages,
      date: datePages,
    };
  }

  private countPaginatedPages(totalPosts: number, maxPostsPerPage: number): number {
    if (totalPosts <= 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(totalPosts / maxPostsPerPage));
  }

  private buildGenerationPostIndex(posts: PostData[]): GenerationPostIndex {
    const postsByCategory = new Map<string, PostData[]>();
    const postsByTag = new Map<string, PostData[]>();
    const postsByYear = new Map<number, PostData[]>();
    const postsByYearMonth = new Map<string, PostData[]>();
    const postsByYearMonthDay = new Map<string, PostData[]>();

    const append = <TKey extends string | number>(target: Map<TKey, PostData[]>, key: TKey, post: PostData) => {
      const existing = target.get(key);
      if (existing) {
        existing.push(post);
        return;
      }
      target.set(key, [post]);
    };

    for (const post of posts) {
      for (const category of post.categories || []) {
        append(postsByCategory, category, post);
      }

      for (const tag of post.tags || []) {
        append(postsByTag, tag, post);
      }

      const createdAt = resolvePostCreatedAt(post);
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');
      const ym = `${year}/${month}`;
      const ymd = `${year}/${month}/${day}`;

      append(postsByYear, year, post);
      append(postsByYearMonth, ym, post);
      append(postsByYearMonthDay, ymd, post);
    }

    return {
      postsByCategory,
      postsByTag,
      postsByYear,
      postsByYearMonth,
      postsByYearMonthDay,
    };
  }
}

let blogGenerationEngine: BlogGenerationEngine | null = null;

export function getBlogGenerationEngine(): BlogGenerationEngine {
  if (!blogGenerationEngine) {
    blogGenerationEngine = new BlogGenerationEngine();
  }
  return blogGenerationEngine;
}
