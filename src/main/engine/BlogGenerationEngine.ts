import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { getDatabase } from '../database';
import { getPostEngine, type PostData } from './PostEngine';

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
}

export interface BlogGenerationResult {
  path: string;
  urlCount: number;
  postCount: number;
  feedPostCount: number;
  tagCount: number;
  categoryCount: number;
  archiveCount: number;
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

async function getHashSettingValue(key: string): Promise<string | null> {
  const client = getDatabase().getLocalClient();
  if (!client) {
    throw new Error('Database client not available');
  }

  const result = await client.execute({
    sql: 'SELECT value FROM settings WHERE key = ? LIMIT 1',
    args: [key],
  });

  if (!result.rows[0] || typeof result.rows[0].value !== 'string') {
    return null;
  }
  return result.rows[0].value;
}

async function setHashSettingValue(key: string, value: string): Promise<void> {
  const client = getDatabase().getLocalClient();
  if (!client) {
    throw new Error('Database client not available');
  }

  await client.execute({
    sql: 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    args: [key, value, new Date()],
  });
}

async function writeFileIfHashChanged(filePath: string, content: string, hashKey: string): Promise<boolean> {
  const hash = computeContentHash(content);
  const previousHash = await getHashSettingValue(hashKey);
  if (previousHash === hash) {
    return false;
  }
  await fs.writeFile(filePath, content, 'utf-8');
  await setHashSettingValue(hashKey, hash);
  return true;
}

export class BlogGenerationEngine {
  private readonly postEngine = getPostEngine();

  async generate(options: BlogGenerationOptions, onProgress: (progress: number, message?: string) => void): Promise<BlogGenerationResult> {
    onProgress(0, 'Loading posts...');

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

    onProgress(10, `Found ${publishedPosts.length} published posts`);

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

    onProgress(40, 'Building sitemap XML...');

    const urls: string[] = [];
    urls.push(buildSitemapUrl(`${options.baseUrl}/`, latestPostUpdatedAt, 'daily', '1.0'));
    for (const post of postUrls) {
      urls.push(buildSitemapUrl(post.loc, post.lastmod, 'monthly', '0.8'));
    }

    onProgress(55, 'Adding archive pages...');
    for (const [year, lastmod] of Array.from(years.entries()).sort((a, b) => b[0] - a[0])) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${year}`, lastmod.toISOString(), 'monthly', '0.5'));
    }
    for (const [ym, lastmod] of Array.from(yearMonths.entries()).sort().reverse()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${ym}`, lastmod.toISOString(), 'monthly', '0.5'));
    }
    for (const [ymd, lastmod] of Array.from(yearMonthDays.entries()).sort().reverse()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/${ymd}`, lastmod.toISOString(), 'monthly', '0.4'));
    }

    onProgress(70, 'Adding category pages...');
    for (const category of Array.from(allCategories).sort()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/category/${encodeURIComponent(category)}`, latestPostUpdatedAt, 'weekly', '0.6'));
    }

    onProgress(80, 'Adding tag pages...');
    for (const tag of Array.from(allTags).sort()) {
      urls.push(buildSitemapUrl(`${options.baseUrl}/tag/${encodeURIComponent(tag)}`, latestPostUpdatedAt, 'weekly', '0.6'));
    }

    onProgress(85, 'Building RSS and Atom feeds...');

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

    onProgress(92, 'Writing sitemap and feeds...');

    const htmlDir = path.join(options.dataDir, 'html');
    await fs.mkdir(htmlDir, { recursive: true });
    const sitemapPath = path.join(htmlDir, 'sitemap.xml');
    const rssPath = path.join(htmlDir, 'rss.xml');
    const atomPath = path.join(htmlDir, 'atom.xml');
    const hashKeyPrefix = `project:${options.projectId}:generation-hash`;

    const [sitemapWritten, rssWritten, atomWritten] = await Promise.all([
      writeFileIfHashChanged(sitemapPath, sitemapXml, `${hashKeyPrefix}:sitemap.xml`),
      writeFileIfHashChanged(rssPath, rssXml, `${hashKeyPrefix}:rss.xml`),
      writeFileIfHashChanged(atomPath, atomXml, `${hashKeyPrefix}:atom.xml`),
    ]);

    onProgress(100, `Sitemap and feeds generated (${feedPosts.length} feed posts)`);

    return {
      path: sitemapPath,
      urlCount: urls.length,
      postCount: postUrls.length,
      feedPostCount: feedPosts.length,
      tagCount: allTags.size,
      categoryCount: allCategories.size,
      archiveCount: years.size + yearMonths.size + yearMonthDays.size,
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
}

let blogGenerationEngine: BlogGenerationEngine | null = null;

export function getBlogGenerationEngine(): BlogGenerationEngine {
  if (!blogGenerationEngine) {
    blogGenerationEngine = new BlogGenerationEngine();
  }
  return blogGenerationEngine;
}
