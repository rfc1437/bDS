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
  buildCanonicalPostPath,
  type HtmlRewriteContext,
} from './PageRenderer';

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
  sections?: BlogGenerationSection[];
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

function buildCanonicalPreviewPath(createdAt: Date, slug: string): string {
  const year = createdAt.getFullYear();
  const month = String(createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${slug}`;
}

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function escapeXml(value: unknown): string {
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapUrl(
  loc: string,
  lastmod: string,
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never',
  priority: string,
): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

function splitParagraphs(markdown: string | null | undefined): string[] {
  const normalizedMarkdown = typeof markdown === 'string' ? markdown : '';
  return normalizedMarkdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function paragraphToXhtml(paragraph: string): string {
  const escaped = escapeXml(paragraph).replace(/\n/g, '<br />');
  return `<p>${escaped}</p>`;
}

function markdownToXhtml(markdown: string): string {
  const paragraphs = splitParagraphs(markdown);
  if (paragraphs.length === 0) {
    return '<p></p>';
  }
  return paragraphs.map(paragraphToXhtml).join('');
}

function excerptToXhtml(post: PostData): string {
  if (typeof post.excerpt === 'string' && post.excerpt.trim().length > 0) {
    return paragraphToXhtml(post.excerpt.trim());
  }
  const firstParagraph = splitParagraphs(post.content)[0] || '';
  return paragraphToXhtml(firstParagraph);
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
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

    const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage);
    const publishedCandidates = await this.postEngine.getPostsFiltered({ status: 'published' });
    const draftCandidates = await this.postEngine.getPostsFiltered({ status: 'draft' });

    const publishedSnapshots = await Promise.all(
      publishedCandidates.map(async (post) => {
        const snapshot = await this.postEngine.getPublishedVersion(post.id);
        return snapshot || post;
      }),
    );
    const draftPublishedSnapshots = await Promise.all(
      draftCandidates.map(async (post) => this.postEngine.getPublishedVersion(post.id)),
    );

    const publishedPostById = new Map<string, PostData>();
    for (const post of publishedSnapshots) {
      publishedPostById.set(post.id, post);
    }
    for (const snapshot of draftPublishedSnapshots) {
      if (snapshot) {
        publishedPostById.set(snapshot.id, snapshot);
      }
    }

    const publishedPosts = Array.from(publishedPostById.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const feedPosts = publishedPosts.slice(0, maxPostsPerPage);

    onProgress(3, `Found ${publishedPosts.length} published posts`);

    const now = new Date().toISOString();
    const allTags = new Set<string>();
    const allCategories = new Set<string>();
    const yearMonths = new Map<string, Date>();
    const years = new Map<number, Date>();
    const yearMonthDays = new Map<string, Date>();
    const postUrls: Array<{ loc: string; lastmod: string }> = [];

    for (const post of publishedPosts) {
      for (const tag of post.tags || []) allTags.add(tag);
      for (const category of post.categories || []) allCategories.add(category);

      const createdAt = resolvePostCreatedAt(post);
      const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
      const postUrl = `${options.baseUrl}${canonicalPath}`;
      const updatedAt = post.updatedAt;
      postUrls.push({ loc: postUrl, lastmod: updatedAt.toISOString() });

      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');
      const ymKey = `${year}/${month}`;
      const ymdKey = `${year}/${month}/${day}`;

      if (!yearMonths.has(ymKey) || updatedAt > yearMonths.get(ymKey)!) {
        yearMonths.set(ymKey, updatedAt);
      }
      if (!years.has(year) || updatedAt > years.get(year)!) {
        years.set(year, updatedAt);
      }
      if (!yearMonthDays.has(ymdKey) || updatedAt > yearMonthDays.get(ymdKey)!) {
        yearMonthDays.set(ymdKey, updatedAt);
      }
    }

    const latestPostUpdatedAt = publishedPosts[0]?.updatedAt.toISOString() || now;

    onProgress(5, 'Building sitemap XML...');

    const urls: string[] = [];
    urls.push(buildSitemapUrl(`${options.baseUrl}/`, latestPostUpdatedAt, 'daily', '1.0'));
    for (const post of postUrls) {
      urls.push(buildSitemapUrl(post.loc, post.lastmod, 'monthly', '0.8'));
    }

    for (const [year, lastmod] of Array.from(years.entries()).sort((a, b) => b[0] - a[0])) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${year}`, lastmod.toISOString(), 'monthly', '0.5'));
    }
    for (const [ym, lastmod] of Array.from(yearMonths.entries()).sort().reverse()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${ym}`, lastmod.toISOString(), 'monthly', '0.5'));
    }
    for (const [ymd, lastmod] of Array.from(yearMonthDays.entries()).sort().reverse()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${ymd}`, lastmod.toISOString(), 'monthly', '0.4'));
    }

    for (const category of Array.from(allCategories).sort()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/category/${encodeURIComponent(category)}`, latestPostUpdatedAt, 'weekly', '0.6'));
    }

    for (const tag of Array.from(allTags).sort()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/tag/${encodeURIComponent(tag)}`, latestPostUpdatedAt, 'weekly', '0.6'));
    }

    onProgress(8, 'Building RSS and Atom feeds...');

    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      '</urlset>',
      '',
    ].join('\n');

    const feedUpdatedAt = feedPosts[0]?.updatedAt || new Date();
    const baseLink = `${options.baseUrl}/`;
    const feedTitle = options.projectName;
    const feedDescription = options.projectDescription?.trim() || feedTitle;

    const rssItems = feedPosts.map((post) => {
      const createdAt = resolvePostCreatedAt(post);
      const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
      const permalink = `${options.baseUrl}${canonicalPath}`;
      const excerptXhtml = excerptToXhtml(post);
      const contentXhtml = markdownToXhtml(post.content || '');
      const categories = [
        ...(post.categories || []).map((category) => `<category>${escapeXml(category)}</category>`),
        ...(post.tags || []).map((tag) => `<category>${escapeXml(tag)}</category>`),
      ];

      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(permalink)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(permalink)}</guid>`,
        `      <pubDate>${(post.publishedAt || post.updatedAt).toUTCString()}</pubDate>`,
        post.author ? `      <author>${escapeXml(post.author)}</author>` : null,
        `      <description><![CDATA[${escapeCdata(excerptXhtml)}]]></description>`,
        `      <content:encoded><![CDATA[${escapeCdata(contentXhtml)}]]></content:encoded>`,
        ...categories.map((entry) => `      ${entry}`),
        '    </item>',
      ].filter(Boolean).join('\n');
    });

    const rssXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
      '  <channel>',
      `    <title>${escapeXml(feedTitle)}</title>`,
      `    <link>${escapeXml(baseLink)}</link>`,
      `    <description>${escapeXml(feedDescription)}</description>`,
      `    <lastBuildDate>${feedUpdatedAt.toUTCString()}</lastBuildDate>`,
      '    <generator>bDS</generator>',
      ...rssItems,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n');

    const atomEntries = feedPosts.map((post) => {
      const createdAt = resolvePostCreatedAt(post);
      const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
      const permalink = `${options.baseUrl}${canonicalPath}`;
      const excerptXhtml = excerptToXhtml(post);
      const contentXhtml = markdownToXhtml(post.content || '');
      const categories = [
        ...(post.tags || []).map((tag) => `<category term="${escapeXml(tag)}" />`),
        ...(post.categories || []).map((category) => `<category term="${escapeXml(category)}" />`),
      ];

      return [
        '  <entry>',
        `    <title>${escapeXml(post.title)}</title>`,
        `    <id>${escapeXml(permalink)}</id>`,
        `    <link href="${escapeXml(permalink)}" />`,
        `    <updated>${post.updatedAt.toISOString()}</updated>`,
        `    <published>${(post.publishedAt || post.updatedAt).toISOString()}</published>`,
        post.author ? `    <author><name>${escapeXml(post.author)}</name></author>` : null,
        `    <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">${excerptXhtml}</div></summary>`,
        `    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">${contentXhtml}</div></content>`,
        ...categories.map((entry) => `    ${entry}`),
        '  </entry>',
      ].filter(Boolean).join('\n');
    });

    const atomXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      `  <title>${escapeXml(feedTitle)}</title>`,
      `  <subtitle>${escapeXml(feedDescription)}</subtitle>`,
      `  <id>${escapeXml(baseLink)}</id>`,
      `  <link href="${escapeXml(baseLink)}" rel="alternate" />`,
      `  <link href="${escapeXml(`${baseLink}atom.xml`)}" rel="self" />`,
      `  <updated>${feedUpdatedAt.toISOString()}</updated>`,
      ...atomEntries,
      '</feed>',
      '',
    ].join('\n');

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');
    const rssPath = path.join(htmlDir, 'rss.xml');
    const atomPath = path.join(htmlDir, 'atom.xml');

    const estimatedUnitsBySection = this.estimateGenerationUnitsBySection(
      publishedPosts,
      allCategories,
      allTags,
      years,
      yearMonths,
      yearMonthDays,
      maxPostsPerPage,
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

    const pageTitle = options.pageTitle || options.projectName;
    const language = options.language || 'en';
    const pageContext = { page_title: pageTitle, language };

    const pageRenderer = new PageRenderer(this.mediaEngine, this.postMediaEngine);
    const rewriteContext = this.buildHtmlRewriteContext(publishedPosts);

    let pagesGenerated = 0;

    if (includeCore) {
      onProgress(20, 'Generating root pages...');
      pagesGenerated += await this.generateRootPages(options.projectId, publishedPosts, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, reportUnitProgress);
      pagesGenerated += await this.generatePageRoutes(options.projectId, publishedPosts, rewriteContext, htmlDir, pageContext, pageRenderer, reportUnitProgress);
    }

    if (includeSingle) {
      onProgress(35, 'Generating single post pages...');
      pagesGenerated += await this.generateSinglePostPages(options.projectId, publishedPosts, rewriteContext, htmlDir, pageContext, pageRenderer, reportUnitProgress);
    }

    if (includeCategory) {
      onProgress(50, 'Generating category pages...');
      pagesGenerated += await this.generateCategoryPages(options.projectId, publishedPosts, allCategories, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, reportUnitProgress);
    }

    if (includeTag) {
      onProgress(65, 'Generating tag pages...');
      pagesGenerated += await this.generateTagPages(options.projectId, publishedPosts, allTags, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, reportUnitProgress);
    }

    if (includeDate) {
      onProgress(80, 'Generating date archive pages...');
      pagesGenerated += await this.generateDateArchivePages(options.projectId, publishedPosts, years, yearMonths, yearMonthDays, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, reportUnitProgress);
    }

    onProgress(100, `Site generated (${publishedPosts.length} posts, ${pagesGenerated} pages)`);

    return {
      path: sitemapPath,
      urlCount: urls.length,
      postCount: postUrls.length,
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

  private async generatePageRoutes(
    projectId: string,
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;
    const pagePosts = posts.filter((post) => (post.categories || []).includes('page'));

    for (const post of pagePosts) {
      const html = await pageRenderer.renderSinglePost(post, rewriteContext, pageContext);
      await writeHtmlPage(projectId, htmlDir, post.slug, html);
      count++;
      onPageGenerated(`Generated /${post.slug}`);
    }

    return count;
  }

  private buildHtmlRewriteContext(publishedPosts: PostData[]): HtmlRewriteContext {
    const canonicalPostPathBySlug = new Map<string, string>();
    for (const post of publishedPosts) {
      canonicalPostPathBySlug.set(post.slug, buildCanonicalPostPath(post));
    }

    const canonicalMediaPathBySourcePath = new Map<string, string>();

    return {
      canonicalPostPathBySlug,
      canonicalMediaPathBySourcePath,
    };
  }

  private async copyAssets(htmlDir: string): Promise<void> {
    const assetsDir = path.join(htmlDir, 'assets');
    const imagesDir = path.join(htmlDir, 'images');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });

    for (const [filename, definition] of Object.entries(PREVIEW_ASSETS)) {
      const sourcePath = require.resolve(definition.modulePath);
      const destPath = path.join(assetsDir, filename);
      const content = await readFile(sourcePath);
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
    rewriteContext: HtmlRewriteContext,
    maxPostsPerPage: number,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    const totalPages = Math.max(1, Math.ceil(posts.length / maxPostsPerPage));
    let count = 0;

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * maxPostsPerPage;
      const pagePosts = posts.slice(offset, offset + maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const html = await pageRenderer.renderPostList(pagePosts, rewriteContext, {
        archiveGrouping: false,
        routeKind: 'date',
        archiveContext: { kind: 'root' },
        basePathname: '/',
        pagination: { page, maxPostsPerPage, totalPosts: posts.length },
        ...pageContext,
      });

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
    rewriteContext: HtmlRewriteContext,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;

    for (const post of posts) {
      const createdAt = resolvePostCreatedAt(post);
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');

      const html = await pageRenderer.renderSinglePost(post, rewriteContext, pageContext);
      const urlPath = `${year}/${month}/${day}/${post.slug}`;
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
    rewriteContext: HtmlRewriteContext,
    maxPostsPerPage: number,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;

    for (const category of Array.from(allCategories).sort()) {
      const categoryPosts = posts.filter((post) => (post.categories || []).includes(category));
      if (categoryPosts.length === 0) continue;

      const totalPages = Math.max(1, Math.ceil(categoryPosts.length / maxPostsPerPage));
      const encodedCategory = encodeURIComponent(category);
      const basePathname = `/category/${encodedCategory}`;

      for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * maxPostsPerPage;
        const pagePosts = categoryPosts.slice(offset, offset + maxPostsPerPage);
        if (pagePosts.length === 0) break;

        const html = await pageRenderer.renderPostList(pagePosts, rewriteContext, {
          archiveGrouping: true,
          routeKind: 'non-date',
          archiveContext: { kind: 'category', name: category },
          basePathname,
          pagination: { page, maxPostsPerPage, totalPosts: categoryPosts.length },
          ...pageContext,
        });

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
    rewriteContext: HtmlRewriteContext,
    maxPostsPerPage: number,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;

    for (const tag of Array.from(allTags).sort()) {
      const tagPosts = posts.filter((post) => (post.tags || []).includes(tag));
      if (tagPosts.length === 0) continue;

      const totalPages = Math.max(1, Math.ceil(tagPosts.length / maxPostsPerPage));
      const encodedTag = encodeURIComponent(tag);
      const basePathname = `/tag/${encodedTag}`;

      for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * maxPostsPerPage;
        const pagePosts = tagPosts.slice(offset, offset + maxPostsPerPage);
        if (pagePosts.length === 0) break;

        const html = await pageRenderer.renderPostList(pagePosts, rewriteContext, {
          archiveGrouping: true,
          routeKind: 'non-date',
          archiveContext: { kind: 'tag', name: tag },
          basePathname,
          pagination: { page, maxPostsPerPage, totalPosts: tagPosts.length },
          ...pageContext,
        });

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
    rewriteContext: HtmlRewriteContext,
    maxPostsPerPage: number,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
  ): Promise<number> {
    let count = 0;

    for (const [year] of Array.from(yearsMap.entries()).sort((a, b) => b[0] - a[0])) {
      const yearPosts = posts.filter((post) => resolvePostCreatedAt(post).getFullYear() === year);
      count += await this.generatePaginatedListPages(
        projectId, yearPosts, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, onPageGenerated,
        `${year}`, `/${year}`, { kind: 'year', year }, 'date',
      );
    }

    for (const [ym] of Array.from(yearMonthsMap.entries()).sort().reverse()) {
      const [yearStr, monthStr] = ym.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const monthPosts = posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      });
      count += await this.generatePaginatedListPages(
        projectId, monthPosts, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, onPageGenerated,
        ym, `/${ym}`, { kind: 'month', year, month }, 'date',
      );
    }

    for (const [ymd] of Array.from(yearMonthDaysMap.entries()).sort().reverse()) {
      const [yearStr, monthStr, dayStr] = ymd.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const dayPosts = posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month && d.getDate() === day;
      });
      count += await this.generatePaginatedListPages(
        projectId, dayPosts, rewriteContext, maxPostsPerPage, htmlDir, pageContext, pageRenderer, onPageGenerated,
        ymd, `/${ymd}`, { kind: 'day', year, month, day }, 'date',
      );
    }

    return count;
  }

  private async generatePaginatedListPages(
    projectId: string,
    posts: PostData[],
    rewriteContext: HtmlRewriteContext,
    maxPostsPerPage: number,
    htmlDir: string,
    pageContext: { page_title: string; language: string },
    pageRenderer: PageRenderer,
    onPageGenerated: (message: string) => void,
    urlPrefix: string,
    basePathname: string,
    archiveContext: { kind: 'root' | 'year' | 'month' | 'day' | 'tag' | 'category'; name?: string; year?: number; month?: number; day?: number },
    routeKind: 'date' | 'non-date',
  ): Promise<number> {
    if (posts.length === 0) return 0;

    const totalPages = Math.max(1, Math.ceil(posts.length / maxPostsPerPage));
    let count = 0;

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * maxPostsPerPage;
      const pagePosts = posts.slice(offset, offset + maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const html = await pageRenderer.renderPostList(pagePosts, rewriteContext, {
        archiveGrouping: true,
        routeKind,
        archiveContext,
        basePathname,
        pagination: { page, maxPostsPerPage, totalPosts: posts.length },
        ...pageContext,
      });

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
  ): Record<BlogGenerationSection, number> {
    const rootPages = this.countPaginatedPages(posts.length, maxPostsPerPage);
    const pageRoutes = posts.filter((post) => (post.categories || []).includes('page')).length;

    const categoryPages = Array.from(allCategories).reduce((sum, category) => {
      const count = posts.filter((post) => (post.categories || []).includes(category)).length;
      return sum + this.countPaginatedPages(count, maxPostsPerPage);
    }, 0);

    const tagPages = Array.from(allTags).reduce((sum, tag) => {
      const count = posts.filter((post) => (post.tags || []).includes(tag)).length;
      return sum + this.countPaginatedPages(count, maxPostsPerPage);
    }, 0);

    let datePages = 0;

    for (const [year] of yearsMap) {
      const yearPosts = posts.filter((post) => resolvePostCreatedAt(post).getFullYear() === year);
      datePages += this.countPaginatedPages(yearPosts.length, maxPostsPerPage);
    }

    for (const [ym] of yearMonthsMap) {
      const [yearStr, monthStr] = ym.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const monthPosts = posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      });
      datePages += this.countPaginatedPages(monthPosts.length, maxPostsPerPage);
    }

    for (const [ymd] of yearMonthDaysMap) {
      const [yearStr, monthStr, dayStr] = ymd.split('/');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const dayPosts = posts.filter((post) => {
        const d = resolvePostCreatedAt(post);
        return d.getFullYear() === year && (d.getMonth() + 1) === month && d.getDate() === day;
      });
      datePages += this.countPaginatedPages(dayPosts.length, maxPostsPerPage);
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
}

let blogGenerationEngine: BlogGenerationEngine | null = null;

export function getBlogGenerationEngine(): BlogGenerationEngine {
  if (!blogGenerationEngine) {
    blogGenerationEngine = new BlogGenerationEngine();
  }
  return blogGenerationEngine;
}
