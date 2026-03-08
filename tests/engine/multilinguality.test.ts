import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  applyLanguagePrefixToHtml,
  PageRenderer,
  type HtmlRewriteContext,
} from '../../src/main/engine/PageRenderer';
import {
  buildSitemapAndFeeds,
  buildMultiLanguageSitemap,
  type GenerationPostIndexLike,
} from '../../src/main/engine/GenerationSitemapFeedService';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-03-08T10:00:00.000Z');
  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'default',
    title: overrides.title ?? 'Test Post',
    slug: overrides.slug ?? 'test-post',
    excerpt: overrides.excerpt,
    content: overrides.content ?? '# Test\n\nBody text',
    status: overrides.status ?? 'published',
    author: overrides.author,
    language: overrides.language ?? 'en',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
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
    for (const category of (post.categories ?? [])) {
      postsByCategory.set(category, [...(postsByCategory.get(category) ?? []), post]);
    }
    for (const tag of (post.tags ?? [])) {
      postsByTag.set(tag, [...(postsByTag.get(tag) ?? []), post]);
    }
    const year = post.createdAt.getFullYear();
    const month = String(post.createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(post.createdAt.getDate()).padStart(2, '0');
    postsByYear.set(year, [...(postsByYear.get(year) ?? []), post]);
    postsByYearMonth.set(`${year}/${month}`, [...(postsByYearMonth.get(`${year}/${month}`) ?? []), post]);
    postsByYearMonthDay.set(`${year}/${month}/${day}`, [...(postsByYearMonthDay.get(`${year}/${month}/${day}`) ?? []), post]);
  }

  return { postsByCategory, postsByTag, postsByYear, postsByYearMonth, postsByYearMonthDay };
}

describe('applyLanguagePrefixToHtml', () => {
  it('prefixes internal hrefs with language prefix', () => {
    const html = '<a href="/2025/03/08/my-post/">Post</a>';
    const result = applyLanguagePrefixToHtml(html, '/de');
    expect(result).toBe('<a href="/de/2025/03/08/my-post/">Post</a>');
  });

  it('does not prefix media or asset paths', () => {
    const html = '<img src="/media/2025/03/photo.jpg" /><link href="/assets/bds.css" />';
    const result = applyLanguagePrefixToHtml(html, '/de');
    expect(result).toBe(html);
  });

  it('does not double-prefix already prefixed hrefs', () => {
    const html = '<a href="/de/2025/03/08/my-post/">Post</a>';
    const result = applyLanguagePrefixToHtml(html, '/de');
    expect(result).toBe('<a href="/de/2025/03/08/my-post/">Post</a>');
  });

  it('prefixes root href', () => {
    const html = '<a href="/">Home</a>';
    const result = applyLanguagePrefixToHtml(html, '/fr');
    expect(result).toBe('<a href="/fr/">Home</a>');
  });

  it('prefixes category and tag hrefs', () => {
    const html = '<a href="/category/tech/">Tech</a><a href="/tag/js/">JS</a>';
    const result = applyLanguagePrefixToHtml(html, '/es');
    expect(result).toBe('<a href="/es/category/tech/">Tech</a><a href="/es/tag/js/">JS</a>');
  });

  it('returns html unchanged when prefix is empty', () => {
    const html = '<a href="/some/path">Link</a>';
    const result = applyLanguagePrefixToHtml(html, '');
    expect(result).toBe(html);
  });

  it('prefixes pagination hrefs', () => {
    const html = '<a href="/page/2">Next</a>';
    const result = applyLanguagePrefixToHtml(html, '/de');
    expect(result).toBe('<a href="/de/page/2">Next</a>');
  });

  it('handles both single and double quotes', () => {
    const html = `<a href='/tag/foo/'>Foo</a><a href="/tag/bar/">Bar</a>`;
    const result = applyLanguagePrefixToHtml(html, '/it');
    expect(result).toBe(`<a href='/it/tag/foo/'>Foo</a><a href="/it/tag/bar/">Bar</a>`);
  });
});

describe('Feed language filtering', () => {
  it('includes feedLanguage element in RSS when specified', () => {
    const posts = [makePost({ id: '1', slug: 'a', title: 'Post A' })];
    const result = buildSitemapAndFeeds({
      baseUrl: 'https://example.com',
      projectName: 'Blog',
      maxPostsPerPage: 10,
      publishedPosts: posts,
      publishedListPosts: posts,
      postIndex: buildIndex(posts),
      includeFeeds: true,
      feedLanguage: 'de',
    });

    expect(result.rssXml).toContain('<language>de</language>');
  });

  it('includes xml:lang in Atom feed when feedLanguage is specified', () => {
    const posts = [makePost({ id: '1', slug: 'a', title: 'Post A' })];
    const result = buildSitemapAndFeeds({
      baseUrl: 'https://example.com',
      projectName: 'Blog',
      maxPostsPerPage: 10,
      publishedPosts: posts,
      publishedListPosts: posts,
      postIndex: buildIndex(posts),
      includeFeeds: true,
      feedLanguage: 'fr',
    });

    expect(result.atomXml).toContain('xml:lang="fr"');
  });

  it('omits language elements when feedLanguage is not specified', () => {
    const posts = [makePost({ id: '1', slug: 'a', title: 'Post A' })];
    const result = buildSitemapAndFeeds({
      baseUrl: 'https://example.com',
      projectName: 'Blog',
      maxPostsPerPage: 10,
      publishedPosts: posts,
      publishedListPosts: posts,
      postIndex: buildIndex(posts),
      includeFeeds: true,
    });

    expect(result.rssXml).not.toContain('<language>');
    expect(result.atomXml).not.toMatch(/<feed[^>]+xml:lang=/);
  });
});

describe('buildMultiLanguageSitemap', () => {
  it('generates hreflang links for translatable posts in all languages', () => {
    const post = makePost({ id: '1', slug: 'hello', title: 'Hello' });
    const postIndex = buildIndex([post]);

    const sitemap = buildMultiLanguageSitemap({
      baseUrl: 'https://example.com',
      mainLanguage: 'en',
      allLanguages: ['en', 'de'],
      translatablePosts: [post],
      doNotTranslatePosts: [],
      publishedListPosts: [post],
      maxPostsPerPage: 10,
      postIndex,
    });

    expect(sitemap).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(sitemap).toContain('hreflang="en"');
    expect(sitemap).toContain('hreflang="de"');
    expect(sitemap).toContain('hreflang="x-default"');
    // Main language post URL is unprefixed
    expect(sitemap).toContain('href="https://example.com/2025/03/08/hello/"');
    // Alternative language post URL is prefixed
    expect(sitemap).toContain('href="https://example.com/de/2025/03/08/hello/"');
  });

  it('generates hreflang links only for main language for doNotTranslate posts', () => {
    const dntPost = makePost({ id: '2', slug: 'private-note', title: 'Private' });
    (dntPost as PostData & { doNotTranslate?: boolean }).doNotTranslate = true;
    const postIndex = buildIndex([dntPost]);

    const sitemap = buildMultiLanguageSitemap({
      baseUrl: 'https://example.com',
      mainLanguage: 'en',
      allLanguages: ['en', 'de', 'fr'],
      translatablePosts: [],
      doNotTranslatePosts: [dntPost],
      publishedListPosts: [dntPost],
      maxPostsPerPage: 10,
      postIndex,
    });

    // The doNotTranslate post URL entry should exist
    expect(sitemap).toContain('https://example.com/2025/03/08/private-note/');
    // But it should NOT have de or fr hreflang links for this specific post
    const postUrlBlock = sitemap.split('<url>').find((block) => block.includes('private-note'));
    expect(postUrlBlock).toBeDefined();
    expect(postUrlBlock).toContain('hreflang="en"');
    expect(postUrlBlock).not.toContain('hreflang="de"');
    expect(postUrlBlock).not.toContain('hreflang="fr"');
  });

  it('includes root page and pagination in all languages', () => {
    const posts = Array.from({ length: 15 }, (_, i) =>
      makePost({
        id: `p-${i}`,
        slug: `post-${i}`,
        createdAt: new Date(`2025-03-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }),
    );
    const postIndex = buildIndex(posts);

    const sitemap = buildMultiLanguageSitemap({
      baseUrl: 'https://example.com',
      mainLanguage: 'en',
      allLanguages: ['en', 'de'],
      translatablePosts: posts,
      doNotTranslatePosts: [],
      publishedListPosts: posts,
      maxPostsPerPage: 10,
      postIndex,
    });

    // Root page has both languages
    expect(sitemap).toContain('https://example.com/');
    expect(sitemap).toContain('https://example.com/de/');
    // Pagination page 2
    expect(sitemap).toContain('https://example.com/page/2');
    expect(sitemap).toContain('https://example.com/de/page/2');
  });

  it('includes archive, category, and tag URLs in all languages', () => {
    const post = makePost({
      id: '1', slug: 'tagged', tags: ['javascript'], categories: ['tutorial'],
    });
    const postIndex = buildIndex([post]);

    const sitemap = buildMultiLanguageSitemap({
      baseUrl: 'https://example.com',
      mainLanguage: 'en',
      allLanguages: ['en', 'fr'],
      translatablePosts: [post],
      doNotTranslatePosts: [],
      publishedListPosts: [post],
      maxPostsPerPage: 10,
      postIndex,
    });

    expect(sitemap).toContain('https://example.com/category/tutorial');
    expect(sitemap).toContain('https://example.com/fr/category/tutorial');
    expect(sitemap).toContain('https://example.com/tag/javascript');
    expect(sitemap).toContain('https://example.com/fr/tag/javascript');
    expect(sitemap).toContain('https://example.com/2025/');
  });
});

describe('Language switcher in templates', () => {
  it('renders language switcher badges when blog_languages has multiple entries', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      { getLinkedMediaDataForPost: async () => [], setProjectContext: () => {} },
    );

    const html = await renderer.renderPostList(
      [makePost()],
      {
        canonicalPostPathBySlug: new Map([['test-post', '/2025/03/08/test-post']]),
        canonicalMediaPathBySourcePath: new Map(),
      },
      {
        archiveGrouping: true,
        routeKind: 'date',
        archiveContext: { kind: 'root' },
        basePathname: '/',
        page_title: 'Blog',
        language: 'en',
        blog_languages: [
          { code: 'en', href_prefix: '', is_current: true },
          { code: 'de', href_prefix: '/de', is_current: false },
        ],
        current_language: 'en',
        language_prefix: '',
      },
    );

    expect(html).toContain('class="language-switcher"');
    expect(html).toContain('class="language-switcher-badge language-switcher-badge-current"');
    expect(html).toContain('>en</span>');
    expect(html).toContain('href="/de"');
    expect(html).toContain('>de</a>');
  });

  it('does not render language switcher when blog_languages has one or zero entries', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      { getLinkedMediaDataForPost: async () => [], setProjectContext: () => {} },
    );

    const html = await renderer.renderPostList(
      [makePost()],
      {
        canonicalPostPathBySlug: new Map(),
        canonicalMediaPathBySourcePath: new Map(),
      },
      {
        archiveGrouping: false,
        routeKind: 'date',
        basePathname: '/',
        page_title: 'Blog',
        language: 'en',
        blog_languages: [{ code: 'en', href_prefix: '', is_current: true }],
        current_language: 'en',
        language_prefix: '',
      },
    );

    expect(html).not.toContain('class="language-switcher"');
  });

  it('renders language switcher in single post template', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      { getLinkedMediaDataForPost: async () => [], setProjectContext: () => {} },
    );

    const html = await renderer.renderSinglePost(
      makePost({ content: 'Hello world' }),
      {
        canonicalPostPathBySlug: new Map(),
        canonicalMediaPathBySourcePath: new Map(),
      },
      {
        page_title: 'Blog',
        language: 'en',
        blog_languages: [
          { code: 'en', href_prefix: '', is_current: false },
          { code: 'de', href_prefix: '/de', is_current: true },
        ],
        current_language: 'de',
        language_prefix: '/de',
      },
    );

    expect(html).toContain('class="language-switcher"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('>de</span>');
  });
});

describe('Per-language feed links in head', () => {
  it('renders language-prefixed feed links in head partial', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      { getLinkedMediaDataForPost: async () => [], setProjectContext: () => {} },
    );

    const html = await renderer.renderPostList(
      [makePost()],
      {
        canonicalPostPathBySlug: new Map(),
        canonicalMediaPathBySourcePath: new Map(),
      },
      {
        archiveGrouping: false,
        routeKind: 'date',
        basePathname: '/',
        page_title: 'Blog',
        language: 'de',
        language_prefix: '/de',
      },
    );

    expect(html).toContain('href="/de/rss.xml"');
    expect(html).toContain('href="/de/atom.xml"');
  });

  it('renders unprefixed feed links when no language prefix', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      { getLinkedMediaDataForPost: async () => [], setProjectContext: () => {} },
    );

    const html = await renderer.renderPostList(
      [makePost()],
      {
        canonicalPostPathBySlug: new Map(),
        canonicalMediaPathBySourcePath: new Map(),
      },
      {
        archiveGrouping: false,
        routeKind: 'date',
        basePathname: '/',
        page_title: 'Blog',
        language: 'en',
      },
    );

    expect(html).toContain('href="/rss.xml"');
    expect(html).toContain('href="/atom.xml"');
  });
});
