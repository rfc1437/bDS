import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  buildSitemapAndFeeds,
  type GenerationPostIndexLike,
} from '../../src/main/engine/GenerationSitemapFeedService';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-02T10:00:00.000Z');
  const updatedAt = overrides.updatedAt ?? createdAt;
  const title = overrides.title ?? 'Title';

  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'default',
    title,
    slug: overrides.slug ?? 'title',
    excerpt: overrides.excerpt,
    content: overrides.content ?? `# ${title}\n\nBody`,
    status: overrides.status ?? 'published',
    author: overrides.author,
    createdAt,
    updatedAt,
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

function buildIndex(posts: PostData[]): GenerationPostIndexLike {
  const postsByCategory = new Map<string, PostData[]>();
  const postsByTag = new Map<string, PostData[]>();
  const postsByYear = new Map<number, PostData[]>();
  const postsByYearMonth = new Map<string, PostData[]>();
  const postsByYearMonthDay = new Map<string, PostData[]>();

  for (const post of posts) {
    const categories = Array.isArray(post.categories) ? post.categories : [];
    for (const category of categories) {
      const existing = postsByCategory.get(category) ?? [];
      existing.push(post);
      postsByCategory.set(category, existing);
    }

    const tags = Array.isArray(post.tags) ? post.tags : [];
    for (const tag of tags) {
      const existing = postsByTag.get(tag) ?? [];
      existing.push(post);
      postsByTag.set(tag, existing);
    }

    const createdAt = post.createdAt;
    const year = createdAt.getFullYear();
    const month = String(createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(createdAt.getDate()).padStart(2, '0');
    const yearMonth = `${year}/${month}`;
    const yearMonthDay = `${year}/${month}/${day}`;

    postsByYear.set(year, [...(postsByYear.get(year) ?? []), post]);
    postsByYearMonth.set(yearMonth, [...(postsByYearMonth.get(yearMonth) ?? []), post]);
    postsByYearMonthDay.set(yearMonthDay, [...(postsByYearMonthDay.get(yearMonthDay) ?? []), post]);
  }

  return {
    postsByCategory,
    postsByTag,
    postsByYear,
    postsByYearMonth,
    postsByYearMonthDay,
  };
}

describe('GenerationSitemapFeedService', () => {
  it('builds canonical sitemap urls and paginated archive routes', () => {
    const publishedPosts = [
      makePost({
        id: '1',
        slug: 'news-1',
        createdAt: new Date('2025-01-15T10:00:00.000Z'),
        categories: ['news'],
        tags: ['tag-a'],
      }),
      makePost({
        id: '2',
        slug: 'news-2',
        createdAt: new Date('2025-01-14T10:00:00.000Z'),
        categories: ['news'],
        tags: ['tag-a'],
      }),
      makePost({
        id: '3',
        slug: 'about',
        createdAt: new Date('2025-01-13T10:00:00.000Z'),
        categories: ['page'],
      }),
    ];

    const publishedListPosts = publishedPosts.filter((post) => !(post.categories || []).includes('page'));

    const result = buildSitemapAndFeeds({
      baseUrl: 'https://example.com',
      projectName: 'Test Blog',
      projectDescription: 'Desc',
      maxPostsPerPage: 1,
      publishedPosts,
      publishedListPosts,
      postIndex: buildIndex(publishedListPosts),
      includeFeeds: true,
    });

    expect(result.sitemapXml).toContain('<loc>https://example.com/</loc>');
    expect(result.sitemapXml).toContain('<loc>https://example.com/page/2/</loc>');
    expect(result.sitemapXml).toContain('<loc>https://example.com/2025/01/15/news-1/</loc>');
    expect(result.sitemapXml).toContain('<loc>https://example.com/category/news/page/2/</loc>');
    expect(result.sitemapXml).toContain('<loc>https://example.com/tag/tag-a/page/2/</loc>');
    expect(result.sitemapXml).toContain('<loc>https://example.com/about/</loc>');
    expect(result.rssXml).toContain('<rss version="2.0"');
    expect(result.atomXml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
  });

  it('can skip feed xml generation for sitemap-only flows', () => {
    const publishedPosts = [makePost({ id: '1', slug: 'post-1', categories: ['news'], tags: ['t1'] })];

    const result = buildSitemapAndFeeds({
      baseUrl: 'https://example.com',
      projectName: 'Test Blog',
      maxPostsPerPage: 10,
      publishedPosts,
      publishedListPosts: publishedPosts,
      postIndex: buildIndex(publishedPosts),
      includeFeeds: false,
    });

    expect(result.sitemapXml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(result.rssXml).toBe('');
    expect(result.atomXml).toBe('');
  });
});
