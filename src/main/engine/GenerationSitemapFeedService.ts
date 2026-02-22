import type { PostData } from './PostEngine';

export interface GenerationPostIndexLike {
  postsByCategory: Map<string, PostData[]>;
  postsByTag: Map<string, PostData[]>;
  postsByYear: Map<number, PostData[]>;
  postsByYearMonth: Map<string, PostData[]>;
  postsByYearMonthDay: Map<string, PostData[]>;
}

interface BuildSitemapAndFeedsParams {
  baseUrl: string;
  projectName: string;
  projectDescription?: string;
  maxPostsPerPage: number;
  publishedPosts: PostData[];
  publishedListPosts: PostData[];
  postIndex: GenerationPostIndexLike;
  includeFeeds: boolean;
}

export interface SitemapFeedBuildResult {
  allTags: Set<string>;
  allCategories: Set<string>;
  yearMonths: Map<string, Date>;
  years: Map<number, Date>;
  yearMonthDays: Map<string, Date>;
  urls: string[];
  sitemapXml: string;
  rssXml: string;
  atomXml: string;
  feedPosts: PostData[];
}

export interface SitemapArchiveMetadata {
  allTags: Set<string>;
  allCategories: Set<string>;
  yearMonths: Map<string, Date>;
  years: Map<number, Date>;
  yearMonthDays: Map<string, Date>;
  feedPosts: PostData[];
  postUrls: Array<{ loc: string; lastmod: string }>;
  pageUrls: Array<{ loc: string; lastmod: string }>;
  latestPostUpdatedAt: string;
}

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildCanonicalPreviewPath(createdAt: Date, slug: string): string {
  const year = createdAt.getFullYear();
  const month = String(createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${slug}`;
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
  const canonicalLoc = (() => {
    try {
      const parsed = new URL(loc);
      if (!parsed.pathname.endsWith('/')) {
        parsed.pathname = `${parsed.pathname}/`;
      }
      return parsed.toString();
    } catch {
      return loc.endsWith('/') ? loc : `${loc}/`;
    }
  })();

  return [
    '  <url>',
    `    <loc>${escapeXml(canonicalLoc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

function appendPaginatedSitemapUrls(
  target: string[],
  baseUrl: string,
  basePath: string,
  totalItems: number,
  maxPostsPerPage: number,
  lastmod: string,
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never',
  priority: string,
): void {
  if (totalItems <= 0) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / maxPostsPerPage));
  for (let page = 2; page <= totalPages; page += 1) {
    const normalizedBase = basePath.replace(/\/+$/, '');
    const pagePath = `${normalizedBase}/page/${page}`;
    target.push(buildSitemapUrl(`${baseUrl}${pagePath}`, lastmod, changefreq, priority));
  }
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

export function collectSitemapArchiveMetadata(params: {
  baseUrl: string;
  maxPostsPerPage: number;
  publishedPosts: PostData[];
  publishedListPosts: PostData[];
}): SitemapArchiveMetadata {
  const {
    baseUrl,
    maxPostsPerPage,
    publishedPosts,
    publishedListPosts,
  } = params;

  const allTags = new Set<string>();
  const allCategories = new Set<string>();
  const yearMonths = new Map<string, Date>();
  const years = new Map<number, Date>();
  const yearMonthDays = new Map<string, Date>();
  const postUrls: Array<{ loc: string; lastmod: string }> = [];
  const pageUrls: Array<{ loc: string; lastmod: string }> = [];

  for (const post of publishedPosts) {
    const createdAt = resolvePostCreatedAt(post);
    const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
    const postUrl = `${baseUrl}${canonicalPath}`;
    const updatedAt = post.updatedAt;
    postUrls.push({ loc: postUrl, lastmod: updatedAt.toISOString() });

    const categories = Array.isArray(post.categories) ? post.categories : [];
    if (categories.includes('page')) {
      const trimmedSlug = (post.slug || '').replace(/^\/+|\/+$/g, '');
      if (trimmedSlug.length > 0) {
        pageUrls.push({
          loc: `${baseUrl}/${trimmedSlug}`,
          lastmod: updatedAt.toISOString(),
        });
      }
    }
  }

  for (const post of publishedListPosts) {
    for (const tag of post.tags || []) allTags.add(tag);
    for (const category of post.categories || []) allCategories.add(category);

    const createdAt = resolvePostCreatedAt(post);
    const updatedAt = post.updatedAt;

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

  const now = new Date().toISOString();
  const latestPostUpdatedAt = publishedListPosts[0]?.updatedAt.toISOString() || now;
  const feedPosts = publishedListPosts.slice(0, maxPostsPerPage);

  return {
    allTags,
    allCategories,
    yearMonths,
    years,
    yearMonthDays,
    feedPosts,
    postUrls,
    pageUrls,
    latestPostUpdatedAt,
  };
}

export function buildSitemapAndFeeds(params: BuildSitemapAndFeedsParams): SitemapFeedBuildResult {
  const {
    baseUrl,
    projectName,
    projectDescription,
    maxPostsPerPage,
    publishedPosts,
    publishedListPosts,
    postIndex,
    includeFeeds,
  } = params;

  const archiveMetadata = collectSitemapArchiveMetadata({
    baseUrl,
    maxPostsPerPage,
    publishedPosts,
    publishedListPosts,
  });

  const {
    allTags,
    allCategories,
    yearMonths,
    years,
    yearMonthDays,
    postUrls,
    pageUrls,
    latestPostUpdatedAt,
    feedPosts,
  } = archiveMetadata;

  const urls: string[] = [];
  urls.push(buildSitemapUrl(`${baseUrl}/`, latestPostUpdatedAt, 'daily', '1.0'));
  appendPaginatedSitemapUrls(urls, baseUrl, '', publishedListPosts.length, maxPostsPerPage, latestPostUpdatedAt, 'daily', '0.9');
  for (const post of postUrls) {
    urls.push(buildSitemapUrl(post.loc, post.lastmod, 'monthly', '0.8'));
  }
  for (const page of pageUrls) {
    urls.push(buildSitemapUrl(page.loc, page.lastmod, 'weekly', '0.7'));
  }

  for (const [year, lastmod] of Array.from(years.entries()).sort((a, b) => b[0] - a[0])) {
    urls.push(buildSitemapUrl(`${baseUrl}/${year}`, lastmod.toISOString(), 'monthly', '0.5'));

    const yearCount = postIndex.postsByYear.get(year)?.length ?? 0;
    appendPaginatedSitemapUrls(urls, baseUrl, `/${year}`, yearCount, maxPostsPerPage, lastmod.toISOString(), 'monthly', '0.4');
  }
  for (const [ym, lastmod] of Array.from(yearMonths.entries()).sort().reverse()) {
    urls.push(buildSitemapUrl(`${baseUrl}/${ym}`, lastmod.toISOString(), 'monthly', '0.5'));

    const monthCount = postIndex.postsByYearMonth.get(ym)?.length ?? 0;
    appendPaginatedSitemapUrls(urls, baseUrl, `/${ym}`, monthCount, maxPostsPerPage, lastmod.toISOString(), 'monthly', '0.4');
  }
  for (const [ymd, lastmod] of Array.from(yearMonthDays.entries()).sort().reverse()) {
    urls.push(buildSitemapUrl(`${baseUrl}/${ymd}`, lastmod.toISOString(), 'monthly', '0.4'));

    const dayCount = postIndex.postsByYearMonthDay.get(ymd)?.length ?? 0;
    appendPaginatedSitemapUrls(urls, baseUrl, `/${ymd}`, dayCount, maxPostsPerPage, lastmod.toISOString(), 'monthly', '0.3');
  }

  for (const category of Array.from(allCategories).sort()) {
    urls.push(buildSitemapUrl(`${baseUrl}/category/${encodeURIComponent(category)}`, latestPostUpdatedAt, 'weekly', '0.6'));

    const categoryCount = postIndex.postsByCategory.get(category)?.length ?? 0;
    appendPaginatedSitemapUrls(urls, baseUrl, `/category/${encodeURIComponent(category)}`, categoryCount, maxPostsPerPage, latestPostUpdatedAt, 'weekly', '0.5');
  }

  for (const tag of Array.from(allTags).sort()) {
    urls.push(buildSitemapUrl(`${baseUrl}/tag/${encodeURIComponent(tag)}`, latestPostUpdatedAt, 'weekly', '0.6'));

    const tagCount = postIndex.postsByTag.get(tag)?.length ?? 0;
    appendPaginatedSitemapUrls(urls, baseUrl, `/tag/${encodeURIComponent(tag)}`, tagCount, maxPostsPerPage, latestPostUpdatedAt, 'weekly', '0.5');
  }

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');

  if (!includeFeeds) {
    return {
      allTags,
      allCategories,
      yearMonths,
      years,
      yearMonthDays,
      urls,
      sitemapXml,
      rssXml: '',
      atomXml: '',
      feedPosts,
    };
  }

  const feedUpdatedAt = feedPosts[0]?.updatedAt || new Date();
  const baseLink = `${baseUrl}/`;
  const feedTitle = projectName;
  const feedDescription = projectDescription?.trim() || feedTitle;

  const rssItems = feedPosts.map((post) => {
    const createdAt = resolvePostCreatedAt(post);
    const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
    const permalink = `${baseUrl}${canonicalPath}`;
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
    const permalink = `${baseUrl}${canonicalPath}`;
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

  return {
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
  };
}
