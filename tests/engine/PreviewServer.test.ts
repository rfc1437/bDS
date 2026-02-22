import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PostData, PostFilter } from '../../src/main/engine/PostEngine';
import { PreviewServer } from '../../src/main/engine/PreviewServer';
import { resolveUiLanguageFromSystemLocale } from '../../src/main/shared/i18n';
import type { MenuDocument } from '../../src/main/engine/MenuEngine';

type PostEngineLike = {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPost: (id: string) => Promise<PostData | null>;
  hasPublishedVersion: (id: string) => Promise<boolean>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
};

type SettingsEngineLike = {
  getProjectMetadata: () => Promise<{ maxPostsPerPage?: number; mainLanguage?: string } | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
};

type MenuEngineLike = {
  getMenu: () => Promise<MenuDocument>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
};

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

function makeEngine(posts: PostData[]): PostEngineLike {
  const byId = new Map(posts.map((post) => [post.id, post]));

  return {
    setProjectContext: vi.fn(),
    async hasPublishedVersion(): Promise<boolean> {
      return false;
    },
    async getPublishedVersion(): Promise<PostData | null> {
      return null;
    },
    async getPost(id: string): Promise<PostData | null> {
      return byId.get(id) ?? null;
    },
    async getPostsFiltered(filter: PostFilter): Promise<PostData[]> {
      let result = posts.filter((post) => post.status === (filter.status ?? post.status));

      if (filter.tags && filter.tags.length > 0) {
        result = result.filter((post) => filter.tags!.every((tag) => post.tags.includes(tag)));
      }

      if (filter.categories && filter.categories.length > 0) {
        result = result.filter((post) => filter.categories!.some((category) => post.categories.includes(category)));
      }

      if ((filter as any).excludeCategories && (filter as any).excludeCategories.length > 0) {
        result = result.filter((post) => !(filter as any).excludeCategories.some((category: string) => post.categories.includes(category)));
      }

      if (filter.year !== undefined) {
        result = result.filter((post) => post.createdAt.getUTCFullYear() === filter.year);
      }

      if (filter.month !== undefined && filter.year !== undefined) {
        result = result.filter((post) => post.createdAt.getUTCMonth() === filter.month);
      }

      if (filter.startDate) {
        result = result.filter((post) => post.createdAt >= filter.startDate!);
      }

      if (filter.endDate) {
        result = result.filter((post) => post.createdAt <= filter.endDate!);
      }

      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };
}

function makeSettings(maxPostsPerPage = 50): SettingsEngineLike {
  return {
    setProjectContext: vi.fn(),
    async getProjectMetadata(): Promise<{ maxPostsPerPage?: number } | null> {
      return { maxPostsPerPage };
    },
  };
}

function makeMediaEngine(mediaItems: Array<{ id: string; filename: string; originalName: string; createdAt: Date }>) {
  return {
    async getAllMedia() {
      return mediaItems;
    },
  };
}

function makePostMediaEngine(linksByPostId: Record<string, Array<{ media: { id: string } }>>) {
  return {
    setProjectContext: vi.fn(),
    async getLinkedMediaDataForPost(postId: string) {
      return linksByPostId[postId] ?? [];
    },
  };
}

function makeMenuEngine(menu: MenuDocument): MenuEngineLike {
  return {
    setProjectContext: vi.fn(),
    async getMenu(): Promise<MenuDocument> {
      return menu;
    },
  };
}

describe('PreviewServer', () => {
  let server: PreviewServer;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds to localhost and serves root route', async () => {
    const posts = [
      makePost({ id: '1', slug: 'newest', title: 'Newest', createdAt: new Date('2025-01-03T10:00:00.000Z') }),
      makePost({ id: '2', slug: 'older', title: 'Older', createdAt: new Date('2025-01-02T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    const port = await server.start(0);
    expect(port).toBeGreaterThan(0);
    expect(server.getBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('<div class="post">');
    expect(html).toContain('<h1>Newest</h1>');
    expect(html).toContain('archive-day-marker');
    expect(html).toContain('03.01.2025');
    expect(html).toContain('02.01.2025');
  });

  it('renders menu below h1 with nested submenu links', async () => {
    const posts = [
      makePost({ id: '1', slug: 'hello', title: 'Hello', categories: ['news'], createdAt: new Date('2025-01-03T10:00:00.000Z') }),
      makePost({ id: '2', slug: 'about', title: 'About', categories: ['page'], createdAt: new Date('2025-01-02T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      menuEngine: makeMenuEngine({
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
          { id: 'about', title: 'About', kind: 'page', pageSlug: 'about', children: [] },
          {
            id: 'sections',
            title: 'Sections',
            kind: 'submenu',
            children: [
              { id: 'news', title: 'News', kind: 'category-archive', categoryName: 'news', children: [] },
            ],
          },
        ],
      }),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootHtml = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(rootHtml).toContain('class="blog-menu"');
    expect(rootHtml).toContain('href="/"');
    expect(rootHtml).toContain('href="/about/"');
    expect(rootHtml).toContain('href="/category/news/"');
    expect(rootHtml).toContain('class="blog-menu-submenu"');

    const rootH1Index = rootHtml.indexOf('<h1 class="archive-heading"');
    const rootMenuIndex = rootHtml.indexOf('class="blog-menu"');
    const rootPostListIndex = rootHtml.indexOf('<section class="post-list"');
    expect(rootH1Index).toBeGreaterThan(-1);
    expect(rootMenuIndex).toBeGreaterThan(rootH1Index);
    expect(rootPostListIndex).toBeGreaterThan(rootMenuIndex);

    const singleHtml = await (await fetch(`${server.getBaseUrl()}/2025/01/03/hello`)).text();
    const singleH1Index = singleHtml.indexOf('<h1>Hello</h1>');
    const singleMenuIndex = singleHtml.indexOf('class="blog-menu"');
    const singleTextIndex = singleHtml.indexOf('<div class="post">');
    expect(singleH1Index).toBeGreaterThan(-1);
    expect(singleMenuIndex).toBeGreaterThan(singleH1Index);
    expect(singleTextIndex).toBeGreaterThan(singleMenuIndex);
  });

  it('renders menu on category and tag archive pages', async () => {
    const posts = [
      makePost({ id: '1', slug: 'news-post', title: 'News Post', categories: ['news'], tags: ['dev'], createdAt: new Date('2025-01-03T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      menuEngine: makeMenuEngine({
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
          { id: 'dev', title: 'Dev', kind: 'category-archive', categoryName: 'news', children: [] },
        ],
      }),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const categoryHtml = await (await fetch(`${server.getBaseUrl()}/category/news`)).text();
    expect(categoryHtml).toContain('class="blog-menu"');

    const tagHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev`)).text();
    expect(tagHtml).toContain('class="blog-menu"');
  });

  it('renders category menu link labels from category metadata title', async () => {
    const posts = [
      makePost({ id: '1', slug: 'news-post', title: 'News Post', categories: ['news'], createdAt: new Date('2025-01-03T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            categoryMetadata: {
              news: { renderInLists: true, showTitle: true, title: 'Newsroom' },
            },
          } as any;
        },
      } as any,
      menuEngine: makeMenuEngine({
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
          { id: 'news', title: 'news', kind: 'category-archive', categoryName: 'news', children: [] },
        ],
      }),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootHtml = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(rootHtml).toContain('href="/category/news/"');
    expect(rootHtml).toContain('>Newsroom</a>');
    expect(rootHtml).not.toContain('>news</a>');
  });

  it('uses local CSS/JS assets and serves them from the preview server', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootResponse = await fetch(`${server.getBaseUrl()}/`);
    expect(rootResponse.status).toBe(200);
    const rootHtml = await rootResponse.text();

    expect(rootHtml).toContain('href="/assets/pico.min.css"');
    expect(rootHtml).toContain('href="/assets/lightbox.min.css"');
    expect(rootHtml).toContain('href="/assets/highlight.min.css"');
    expect(rootHtml).toContain('href="/assets/vanilla-calendar.min.css"');
    expect(rootHtml).toContain('src="/assets/lightbox.min.js"');
    expect(rootHtml).toContain('src="/assets/highlight.min.js"');
    expect(rootHtml).toContain('src="/assets/code-enhancements.js"');
    expect(rootHtml).toContain('src="/assets/d3.layout.cloud.js"');
    expect(rootHtml).toContain('src="/assets/tag-cloud.js"');
    expect(rootHtml).toContain('src="/assets/vanilla-calendar.min.js"');
    expect(rootHtml).toContain('src="/assets/calendar-runtime.js"');
    expect(rootHtml).not.toContain('function parseWords(');
    expect(rootHtml).not.toContain('cdn.jsdelivr.net');

    const picoResponse = await fetch(`${server.getBaseUrl()}/assets/pico.min.css`);
    expect(picoResponse.status).toBe(200);
    expect(picoResponse.headers.get('content-type')).toContain('text/css');

    const lightboxCssResponse = await fetch(`${server.getBaseUrl()}/assets/lightbox.min.css`);
    expect(lightboxCssResponse.status).toBe(200);
    expect(lightboxCssResponse.headers.get('content-type')).toContain('text/css');

    const lightboxJsResponse = await fetch(`${server.getBaseUrl()}/assets/lightbox.min.js`);
    expect(lightboxJsResponse.status).toBe(200);
    expect(lightboxJsResponse.headers.get('content-type')).toContain('application/javascript');

    const highlightCssResponse = await fetch(`${server.getBaseUrl()}/assets/highlight.min.css`);
    expect(highlightCssResponse.status).toBe(200);
    expect(highlightCssResponse.headers.get('content-type')).toContain('text/css');

    const highlightJsResponse = await fetch(`${server.getBaseUrl()}/assets/highlight.min.js`);
    expect(highlightJsResponse.status).toBe(200);
    expect(highlightJsResponse.headers.get('content-type')).toContain('application/javascript');

    const codeEnhancementsResponse = await fetch(`${server.getBaseUrl()}/assets/code-enhancements.js`);
    expect(codeEnhancementsResponse.status).toBe(200);
    expect(codeEnhancementsResponse.headers.get('content-type')).toContain('application/javascript');

    const d3CloudJsResponse = await fetch(`${server.getBaseUrl()}/assets/d3.layout.cloud.js`);
    expect(d3CloudJsResponse.status).toBe(200);
    expect(d3CloudJsResponse.headers.get('content-type')).toContain('application/javascript');

    const tagCloudJsResponse = await fetch(`${server.getBaseUrl()}/assets/tag-cloud.js`);
    expect(tagCloudJsResponse.status).toBe(200);
    expect(tagCloudJsResponse.headers.get('content-type')).toContain('application/javascript');

    const lightboxPrevImageResponse = await fetch(`${server.getBaseUrl()}/images/prev.png`);
    expect(lightboxPrevImageResponse.status).toBe(200);
    expect(lightboxPrevImageResponse.headers.get('content-type')).toContain('image/png');

    const lightboxLoadingImageResponse = await fetch(`${server.getBaseUrl()}/images/loading.gif`);
    expect(lightboxLoadingImageResponse.status).toBe(200);
    expect(lightboxLoadingImageResponse.headers.get('content-type')).toContain('image/gif');
  });

  it('serves calendar.json for preview calendar runtime', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'bds-preview-calendar-'));
    await mkdir(path.join(tempDir, 'html'), { recursive: true });
    await writeFile(path.join(tempDir, 'html', 'calendar.json'), JSON.stringify({
      years: { '2025': 2 },
      months: { '2025-01': 2 },
      days: { '2025-01-02': 1, '2025-01-03': 1 },
    }), 'utf-8');

    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default', dataDir: tempDir ?? undefined }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/calendar.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const payload = await response.json() as {
      years: Record<string, number>;
      months: Record<string, number>;
      days: Record<string, number>;
    };

    expect(payload.years['2025']).toBe(2);
    expect(payload.months['2025-01']).toBe(2);
    expect(payload.days['2025-01-03']).toBe(1);
  });

  it('keeps markdown code block html minimal and includes code language metadata', async () => {
    const postWithCode = makePost({
      content: '```python\nprint("hello")\n```',
    });

    server = new PreviewServer({
      postEngine: makeEngine([postWithCode]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(html).toContain('<code class="language-python" data-code-language="python">');
  });

  it('does not set project context or run startup sync for static asset requests', async () => {
    const postEngine = makeEngine([makePost()]);
    const mediaEngine = {
      setProjectContext: vi.fn(),
      async getAllMedia() {
        return [];
      },
    };
    const postMediaEngine = makePostMediaEngine({});
    const syncOnStartup = vi.fn(async () => undefined);
    const settingsEngine = {
      setProjectContext: vi.fn(),
      isInitialized: vi.fn(() => false),
      syncOnStartup,
      async getProjectMetadata() {
        return { maxPostsPerPage: 50 };
      },
    };
    const menuEngine = makeMenuEngine({ items: [] });

    server = new PreviewServer({
      postEngine,
      mediaEngine: mediaEngine as any,
      postMediaEngine,
      settingsEngine: settingsEngine as any,
      menuEngine,
      getActiveProjectContext: async () => ({ projectId: 'default', dataDir: '/tmp/default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/assets/pico.min.css`);
    expect(response.status).toBe(200);

    expect(postEngine.setProjectContext).not.toHaveBeenCalled();
    expect(mediaEngine.setProjectContext).not.toHaveBeenCalled();
    expect(postMediaEngine.setProjectContext).not.toHaveBeenCalled();
    expect(settingsEngine.setProjectContext).not.toHaveBeenCalled();
    expect(menuEngine.setProjectContext).not.toHaveBeenCalled();
    expect(syncOnStartup).not.toHaveBeenCalled();
  });

  it('renders tag_cloud macro with normalized tag usage and tag archive links', async () => {
    const posts = [
      makePost({
        id: 'tags-1',
        slug: 'tag-cloud-source',
        title: 'Tag Cloud Source',
        tags: ['TypeScript', 'Electron'],
        content: '[[tag_cloud]]',
      }),
      makePost({
        id: 'tags-2',
        slug: 'second',
        title: 'Second',
        tags: ['TypeScript'],
      }),
      makePost({
        id: 'tags-3',
        slug: 'third',
        title: 'Third',
        tags: ['Electron', 'SQLite', 'TypeScript'],
      }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/2025/01/02/tag-cloud-source`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('class="macro-tag-cloud"');
    expect(html).toContain('data-tag-cloud="true"');
    expect(html).toContain('data-orientation="horizontal"');
    expect(html).toContain('data-color-distribution="quantile"');
    expect(html).toContain('data-color-easing="0.7"');
    expect(html).toContain('data-color-theme="pico"');
    expect(html).toContain('TypeScript');
    expect(html).toContain('/tag/TypeScript/');
    expect(html).toContain('/tag/Electron/');
    expect(html).toContain('/tag/SQLite/');
    expect(html).toContain('&quot;count&quot;:3');
    expect(html).toContain('&quot;count&quot;:2');
    expect(html).toContain('&quot;count&quot;:1');
    expect(html).not.toContain('&quot;color&quot;');
  });

  it('supports tag_cloud orientation parameter modes', async () => {
    const posts = [
      makePost({
        id: 'orientation-1',
        slug: 'orientation-hv',
        title: 'Orientation HV',
        tags: ['alpha', 'beta'],
        content: '[[tag_cloud orientation="mixed_hv"]]',
      }),
      makePost({
        id: 'orientation-2',
        slug: 'orientation-diagonal',
        title: 'Orientation Diagonal',
        tags: ['alpha'],
        content: '[[tag_cloud orientation="mixed_diagonal"]]',
      }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const hvResponse = await fetch(`${server.getBaseUrl()}/2025/01/02/orientation-hv`);
    expect(hvResponse.status).toBe(200);
    const hvHtml = await hvResponse.text();
    expect(hvHtml).toContain('data-orientation="mixed-hv"');

    const diagonalResponse = await fetch(`${server.getBaseUrl()}/2025/01/02/orientation-diagonal`);
    expect(diagonalResponse.status).toBe(200);
    const diagonalHtml = await diagonalResponse.text();
    expect(diagonalHtml).toContain('data-orientation="mixed-diagonal"');
  });

  it('serves draft content for single post route when draft query flag and postId are provided', async () => {
    const publishedPost = makePost({
      id: 'post-1',
      slug: 'shared-slug',
      title: 'Published Title',
      content: 'Published body',
      status: 'published',
      createdAt: new Date('2025-01-03T10:00:00.000Z'),
    });
    const draftPost = makePost({
      id: 'post-2',
      slug: 'shared-slug',
      title: 'Draft Title',
      content: 'Draft-only body',
      status: 'draft',
      createdAt: new Date('2025-01-03T10:00:00.000Z'),
    });

    server = new PreviewServer({
      postEngine: makeEngine([publishedPost, draftPost]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const publishedResponse = await fetch(`${server.getBaseUrl()}/2025/01/03/shared-slug`);
    expect(publishedResponse.status).toBe(200);
    const publishedHtml = await publishedResponse.text();
    expect(publishedHtml).toContain('Published Title');
    expect(publishedHtml).toContain('Published body');
    expect(publishedHtml).not.toContain('Draft-only body');

    const draftResponse = await fetch(`${server.getBaseUrl()}/2025/01/03/shared-slug?draft=true&postId=post-2`);
    expect(draftResponse.status).toBe(200);
    const draftHtml = await draftResponse.text();
    expect(draftHtml).toContain('Draft Title');
    expect(draftHtml).toContain('Draft-only body');
    expect(draftHtml).not.toContain('Published body');
  });

  it('uses selected pico theme stylesheet from project metadata', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            picoTheme: 'slate',
          };
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootResponse = await fetch(`${server.getBaseUrl()}/`);
    expect(rootResponse.status).toBe(200);
    const rootHtml = await rootResponse.text();

    expect(rootHtml).toContain('href="/assets/pico.slate.min.css"');
    expect(rootHtml).not.toContain('href="/assets/pico.min.css"');

    const themedCss = await fetch(`${server.getBaseUrl()}/assets/pico.slate.min.css`);
    expect(themedCss.status).toBe(200);
    expect(themedCss.headers.get('content-type')).toContain('text/css');
  });

  it('supports preview mode override for style preview route', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            picoTheme: 'green',
          };
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/__style-preview?theme=green&mode=dark`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('href="/assets/pico.green.min.css"');
    expect(html).toContain('--pico-background-color: #13171f;');
  });

  it('limits list routes to 50 posts', async () => {
    const posts = Array.from({ length: 60 }).map((_, index) =>
      makePost({
        id: `p-${index + 1}`,
        slug: `slug-${index + 1}`,
        title: `Post ${index + 1}`,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)),
      })
    );

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    const html = await response.text();
    const renderedPosts = (html.match(/<div class="post">/g) || []).length;
    expect(renderedPosts).toBe(50);
  });

  it('supports year, month, and day archive routes', async () => {
    const matchingDay = makePost({ id: 'd1', slug: 'day-post', title: 'Day Post', createdAt: new Date('2025-02-14T10:00:00.000Z') });
    const sameMonth = makePost({ id: 'm1', slug: 'month-post', title: 'Month Post', createdAt: new Date('2025-02-10T10:00:00.000Z') });
    const sameYear = makePost({ id: 'y1', slug: 'year-post', title: 'Year Post', createdAt: new Date('2025-08-01T10:00:00.000Z') });
    const differentYear = makePost({ id: 'o1', slug: 'other', title: 'Other', createdAt: new Date('2024-02-14T10:00:00.000Z') });

    server = new PreviewServer({
      postEngine: makeEngine([matchingDay, sameMonth, sameYear, differentYear]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const yearHtml = await (await fetch(`${server.getBaseUrl()}/2025/`)).text();
    expect(yearHtml).toContain('Day Post');
    expect(yearHtml).toContain('Month Post');
    expect(yearHtml).toContain('Year Post');
    expect(yearHtml).not.toContain('Other');

    const monthHtml = await (await fetch(`${server.getBaseUrl()}/2025/2/`)).text();
    expect(monthHtml).toContain('Day Post');
    expect(monthHtml).toContain('Month Post');
    expect(monthHtml).not.toContain('Year Post');

    const dayHtml = await (await fetch(`${server.getBaseUrl()}/2025/2/14/`)).text();
    expect(dayHtml).toContain('Day Post');
    expect(dayHtml).not.toContain('Month Post');
  });

  it('renders archive pages grouped by day with rotated date markers and separators', async () => {
    const posts = [
      makePost({ id: 'a1', slug: 'a1', title: 'A1', createdAt: new Date('2025-02-14T12:00:00.000Z') }),
      makePost({ id: 'a2', slug: 'a2', title: 'A2', createdAt: new Date('2025-02-14T08:00:00.000Z') }),
      makePost({ id: 'b1', slug: 'b1', title: 'B1', createdAt: new Date('2025-02-13T09:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/2025/2/`)).text();

    expect(html).toContain('archive-day-group');
    expect(html).toContain('archive-day-marker');
    expect(html).toContain('14.02.2025');
    expect(html).toContain('13.02.2025');

    const markerCount = (html.match(/class="archive-day-marker"/g) || []).length;
    expect(markerCount).toBe(2);

    const separatorCount = (html.match(/class="archive-day-separator"/g) || []).length;
    expect(separatorCount).toBe(1);

    expect(html).toContain('.archive-day-separator { position: relative; height: 2px;');
    expect(html).toContain('color: var(--pico-color, var(--color));');
    expect(html).toContain('border-top: 1px solid currentColor;');
    expect(html).toContain('opacity: .18;');
    expect(html).toContain('.archive-day-separator::before');
    expect(html).toContain('linear-gradient(to right, transparent 0%, transparent 18%, currentColor 58%, transparent 92%, transparent 100%)');
  });

  it('supports day-and-slug post route', async () => {
    const post = makePost({ id: 'one', title: 'Single Post', slug: 'single-post', createdAt: new Date('2025-02-14T10:00:00.000Z') });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/2025/2/14/single-post/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Single Post');
    expect(html).toContain('data-template="single-post"');
    expect(html).toContain('.single-post { margin: 0; padding: 0; background: transparent; border: 0; box-shadow: none; }');
  });

  it('resets lightbox nav anchor hover and focus styles to avoid frame artifacts over images', async () => {
    const post = makePost({
      id: 'lightbox-style-post',
      title: 'Lightbox Style Post',
      slug: 'lightbox-style-post',
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
      content: '{{gallery post="one" columns="2"}}',
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/2025/2/14/lightbox-style-post/`)).text();
    expect(html).toContain('.lb-nav a, .lb-nav a:hover, .lb-nav a:focus-visible { border: 0; box-shadow: none; outline: none; text-decoration: none; }');
  });

  it('keeps code blocks constrained to post column width with horizontal overflow inside the block', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost({ content: '```js\nconst line = "x".repeat(1000);\n```' })]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(html).toContain('.post { border: 1px solid var(--pico-muted-border-color, var(--muted-border-color)); padding: 1rem; background: var(--pico-card-background-color, var(--card-background-color)); min-width: 0; }');
    expect(html).toContain('.post pre { position: relative; overflow-x: auto; max-width: 100%;');
    expect(html).toContain('.post pre code { display: block; font-size: .88rem; line-height: 1.5; white-space: pre; }');
  });

  it('renders single post title as h1', async () => {
    const post = makePost({
      id: 'single-title',
      title: 'Explicit Single Post Title',
      slug: 'single-title',
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
      content: 'Plain body without markdown heading',
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/2025/2/14/single-title/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>Explicit Single Post Title</h1>');

    const mainIndex = html.indexOf('<main>');
    const h1Index = html.indexOf('<h1>Explicit Single Post Title</h1>');
    const articleIndex = html.indexOf('<article class="single-post" data-template="single-post">');
    expect(mainIndex).toBeGreaterThan(-1);
    expect(h1Index).toBeGreaterThan(mainIndex);
    expect(articleIndex).toBeGreaterThan(mainIndex);
    expect(h1Index).toBeLessThan(articleIndex);
  });

  it('renders categories and tags as small bubbles on single post pages with category-first order and tag color override', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'bds-preview-taxonomy-'));
    await mkdir(path.join(tempDir, 'meta'), { recursive: true });
    await writeFile(path.join(tempDir, 'meta', 'tags.json'), JSON.stringify([
      { name: 'css-only', color: '#22aa88' },
      { name: 'default-color' },
    ]), 'utf-8');

    const post = makePost({
      id: 'taxonomy-post',
      title: 'Taxonomy Post',
      slug: 'taxonomy-post',
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
      categories: ['article', 'news'],
      tags: ['css-only', 'default-color'],
      content: 'Body',
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default', dataDir: tempDir || undefined }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/2025/2/14/taxonomy-post/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('class="single-post-taxonomy"');
    expect(html).toContain('aria-label="Taxonomy"');
    expect(html).toContain('class="single-post-taxonomy-bubble single-post-taxonomy-bubble-category"');
    expect(html).toContain('class="single-post-taxonomy-bubble single-post-taxonomy-bubble-tag"');
    expect(html).toContain('href="/category/article/"');
    expect(html).toContain('href="/tag/css-only/"');
    expect(html).toContain('style="--bubble-accent: #22aa88;"');
    expect(html).toContain('background: var(--bubble-bg, var(--bubble-accent));');
    expect(html).toContain('color: #000;');
    expect(html).toContain('.single-post-taxonomy-bubble-category {');
    expect(html).toContain('--bubble-accent: var(--pico-ins-color');
    expect(html).toContain('--bubble-bg: var(--pico-ins-color');
    expect(html).toContain('.single-post-taxonomy-bubble-tag {');
    expect(html).toContain('--bubble-accent: var(--pico-del-color');
    expect(html).toContain('--bubble-bg: var(--pico-del-color');

    const categoryIndex = html.indexOf('single-post-taxonomy-bubble-category');
    const tagIndex = html.indexOf('single-post-taxonomy-bubble-tag');
    expect(categoryIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(-1);
    expect(categoryIndex).toBeLessThan(tagIndex);
  });

  it('uses blog description as h1 on first date archive page and date range h1 on later pages', async () => {
    const posts = [
      makePost({
        id: 'd-1',
        slug: 'd-1',
        title: 'D1',
        content: 'Body 1',
        createdAt: new Date('2020-02-05T10:00:00.000Z'),
      }),
      makePost({
        id: 'd-2',
        slug: 'd-2',
        title: 'D2',
        content: 'Body 2',
        createdAt: new Date('2020-02-04T10:00:00.000Z'),
      }),
      makePost({
        id: 'd-3',
        slug: 'd-3',
        title: 'D3',
        content: 'Body 3',
        createdAt: new Date('2020-01-02T10:00:00.000Z'),
      }),
      makePost({
        id: 'd-4',
        slug: 'd-4',
        title: 'D4',
        content: 'Body 4',
        createdAt: new Date('2020-01-01T10:00:00.000Z'),
      }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            description: 'Meine Blog Beschreibung',
            maxPostsPerPage: 2,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const firstPageHtml = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(firstPageHtml).toContain('<h1 class="archive-heading">Meine Blog Beschreibung</h1>');

    const secondPageHtml = await (await fetch(`${server.getBaseUrl()}/page/2/`)).text();
    expect(secondPageHtml).toContain('<h1 class="archive-heading">Archive 1.1.2020 - 2.1.2020</h1>');
  });

  it('renders month archive heading in the active render language on first page', async () => {
    const posts = [
      makePost({ id: 'm-1', slug: 'm-1', title: 'M1', content: 'Body 1', createdAt: new Date('2020-02-05T10:00:00.000Z') }),
      makePost({ id: 'm-2', slug: 'm-2', title: 'M2', content: 'Body 2', createdAt: new Date('2020-02-04T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            description: 'Meine Blog Beschreibung',
            maxPostsPerPage: 50,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const monthPageHtml = await (await fetch(`${server.getBaseUrl()}/2020/2/`)).text();
    expect(monthPageHtml).toContain('<h1 class="archive-heading">Archive February 2020</h1>');
  });

  it('uses project mainLanguage for translated archive heading text', async () => {
    const posts = [
      makePost({ id: 'fr-1', slug: 'fr-1', title: 'FR1', content: 'Body 1', createdAt: new Date('2020-02-05T10:00:00.000Z') }),
      makePost({ id: 'fr-2', slug: 'fr-2', title: 'FR2', content: 'Body 2', createdAt: new Date('2020-02-04T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            mainLanguage: 'fr',
            maxPostsPerPage: 50,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const monthPageHtml = await (await fetch(`${server.getBaseUrl()}/2020/2/`)).text();
    expect(monthPageHtml).toContain('<h1 class="archive-heading">Archives février 2020</h1>');
  });

  it('keeps preview render language from project settings when ui language differs', async () => {
    const uiLanguage = resolveUiLanguageFromSystemLocale('de-DE');
    expect(uiLanguage).toBe('de');

    const posts = [
      makePost({ id: 'mixed-1', slug: 'mixed-1', title: 'Mixed 1', content: 'Body 1', createdAt: new Date('2020-02-05T10:00:00.000Z') }),
      makePost({ id: 'mixed-2', slug: 'mixed-2', title: 'Mixed 2', content: 'Body 2', createdAt: new Date('2020-02-04T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            mainLanguage: 'fr',
            maxPostsPerPage: 50,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const monthPageHtml = await (await fetch(`${server.getBaseUrl()}/2020/2/`)).text();
    expect(monthPageHtml).toContain('<html lang="fr">');
    expect(monthPageHtml).toContain('<h1 class="archive-heading">Archives février 2020</h1>');
    expect(monthPageHtml).not.toContain('<h1 class="archive-heading">Archiv Februar 2020</h1>');
  });

  it('renders tag heading on first page and adds date range on later pages', async () => {
    const posts = [
      makePost({ id: 't-1', slug: 't-1', title: 'T1', content: 'Body 1', tags: ['dev'], createdAt: new Date('2020-02-05T10:00:00.000Z') }),
      makePost({ id: 't-2', slug: 't-2', title: 'T2', content: 'Body 2', tags: ['dev'], createdAt: new Date('2020-02-04T10:00:00.000Z') }),
      makePost({ id: 't-3', slug: 't-3', title: 'T3', content: 'Body 3', tags: ['dev'], createdAt: new Date('2020-01-02T10:00:00.000Z') }),
      makePost({ id: 't-4', slug: 't-4', title: 'T4', content: 'Body 4', tags: ['dev'], createdAt: new Date('2020-01-01T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return { description: 'Beschreibung', maxPostsPerPage: 2 };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const firstPageHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev/`)).text();
    expect(firstPageHtml).toContain('<h1 class="archive-heading">dev</h1>');

    const secondPageHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev/page/2/`)).text();
    expect(secondPageHtml).toContain('<h1 class="archive-heading">dev - 1.1.2020 - 2.1.2020</h1>');
  });

  it('renders category heading on first page and adds date range on later pages', async () => {
    const posts = [
      makePost({ id: 'c-1', slug: 'c-1', title: 'C1', content: 'Body 1', categories: ['news'], createdAt: new Date('2020-02-05T10:00:00.000Z') }),
      makePost({ id: 'c-2', slug: 'c-2', title: 'C2', content: 'Body 2', categories: ['news'], createdAt: new Date('2020-02-04T10:00:00.000Z') }),
      makePost({ id: 'c-3', slug: 'c-3', title: 'C3', content: 'Body 3', categories: ['news'], createdAt: new Date('2020-01-02T10:00:00.000Z') }),
      makePost({ id: 'c-4', slug: 'c-4', title: 'C4', content: 'Body 4', categories: ['news'], createdAt: new Date('2020-01-01T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return { description: 'Beschreibung', maxPostsPerPage: 2 };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const firstPageHtml = await (await fetch(`${server.getBaseUrl()}/category/news/`)).text();
    expect(firstPageHtml).toContain('<h1 class="archive-heading">news</h1>');

    const secondPageHtml = await (await fetch(`${server.getBaseUrl()}/category/news/page/2/`)).text();
    expect(secondPageHtml).toContain('<h1 class="archive-heading">news - 1.1.2020 - 2.1.2020</h1>');
  });

  it('filters out categories disabled for list rendering on list routes', async () => {
    const posts = [
      makePost({ id: 'list-1', slug: 'list-1', title: 'List Included', categories: ['article'], createdAt: new Date('2025-02-05T10:00:00.000Z') }),
      makePost({ id: 'list-2', slug: 'list-2', title: 'List Excluded', categories: ['page'], createdAt: new Date('2025-02-04T10:00:00.000Z') }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            categorySettings: {
              article: { renderInLists: true, showTitle: true },
              page: { renderInLists: false, showTitle: true },
            },
          };
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(html).toContain('List Included');
    expect(html).not.toContain('List Excluded');
  });

  it('suppresses all list category titles when any assigned category has showTitle disabled', async () => {
    const posts = [
      makePost({
        id: 'ct-1',
        slug: 'ct-1',
        title: 'Category Title Test',
        categories: ['aside', 'article'],
        content: 'Body without markdown headings',
        createdAt: new Date('2025-02-05T10:00:00.000Z'),
      }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            categorySettings: {
              article: { renderInLists: true, showTitle: true },
              aside: { renderInLists: true, showTitle: false },
            },
          };
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(html).not.toContain('<h2 class="post-title">Category Title Test</h2>');
  });

  it('renders post title in list when category titles are enabled', async () => {
    const posts = [
      makePost({
        id: 'pt-1',
        slug: 'pt-1',
        title: 'Article Title',
        categories: ['article'],
        content: 'Body without markdown headings',
        createdAt: new Date('2025-02-06T10:00:00.000Z'),
      }),
    ];

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            maxPostsPerPage: 50,
            categorySettings: {
              article: { renderInLists: true, showTitle: true },
              aside: { renderInLists: true, showTitle: false },
              page: { renderInLists: false, showTitle: true },
            },
          };
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const html = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(html).toContain('<h2 class="post-title"><a href="/2025/02/06/pt-1">Article Title</a></h2>');
    expect(html).not.toContain('<h2 class="post-category-title">article</h2>');
  });

  it('supports tag, category, and page-slug routes', async () => {
    const tagged = makePost({ id: 'tag1', title: 'Tagged', slug: 'tagged', tags: ['dev'] });
    const categorized = makePost({ id: 'cat1', title: 'Categorized', slug: 'categorized', categories: ['news'] });
    const page = makePost({ id: 'page1', title: 'About', slug: 'about', categories: ['page'] });
    const regular = makePost({ id: 'post1', title: 'About Blog Post', slug: 'about', categories: ['blog'] });

    server = new PreviewServer({
      postEngine: makeEngine([tagged, categorized, page, regular]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const tagHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev/`)).text();
    expect(tagHtml).toContain('Tagged');
    expect(tagHtml).not.toContain('Categorized');

    const categoryHtml = await (await fetch(`${server.getBaseUrl()}/category/news/`)).text();
    expect(categoryHtml).toContain('Categorized');
    expect(categoryHtml).not.toContain('Tagged');

    const pageResponse = await fetch(`${server.getBaseUrl()}/about/`);
    expect(pageResponse.status).toBe(200);
    const pageHtml = await pageResponse.text();
    expect(pageHtml).toContain('About');
    expect(pageHtml).not.toContain('About Blog Post');
  });

  it('renders tag and category pages with archive-style day grouping', async () => {
    const tagDayOneA = makePost({
      id: 'tag-day-one-a',
      title: 'Tag Day One A',
      slug: 'tag-day-one-a',
      tags: ['dev'],
      categories: ['news'],
      createdAt: new Date('2025-03-10T14:00:00.000Z'),
    });
    const tagDayOneB = makePost({
      id: 'tag-day-one-b',
      title: 'Tag Day One B',
      slug: 'tag-day-one-b',
      tags: ['dev'],
      categories: ['news'],
      createdAt: new Date('2025-03-10T08:00:00.000Z'),
    });
    const tagDayTwo = makePost({
      id: 'tag-day-two',
      title: 'Tag Day Two',
      slug: 'tag-day-two',
      tags: ['dev'],
      categories: ['news'],
      createdAt: new Date('2025-03-09T09:00:00.000Z'),
    });

    server = new PreviewServer({
      postEngine: makeEngine([tagDayOneA, tagDayOneB, tagDayTwo]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const tagHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev/`)).text();
    expect(tagHtml).toContain('class="archive-day-group"');
    expect(tagHtml).toContain('10.03.2025');
    expect(tagHtml).toContain('09.03.2025');

    const categoryHtml = await (await fetch(`${server.getBaseUrl()}/category/news/`)).text();
    expect(categoryHtml).toContain('class="archive-day-group"');
    expect(categoryHtml).toContain('class="archive-day-separator"');
  });

  it('supports /page/<num> suffix on list routes', async () => {
    const baseTimestamp = Date.UTC(2020, 9, 31, 23, 59, 59);
    const posts = Array.from({ length: 120 }).map((_, index) => {
      const number = index + 1;
      return makePost({
        id: `hist-${number}`,
        slug: `history-${number}`,
        title: `History ${number}`,
        createdAt: new Date(baseTimestamp - index * 1000),
        tags: ['dev'],
        categories: ['news'],
      });
    });

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootPageTwoHtml = await (await fetch(`${server.getBaseUrl()}/page/2/`)).text();
    expect(rootPageTwoHtml).toContain('data-template="post-list"');
    expect(rootPageTwoHtml).toContain('data-first-page="false"');
    expect(rootPageTwoHtml).toContain('data-last-page="false"');
    expect(rootPageTwoHtml).toContain('href="/"');
    expect(rootPageTwoHtml).toContain('href="/page/3/"');
    expect(rootPageTwoHtml).toContain('class="preview-pagination-link"');
    expect(rootPageTwoHtml).not.toContain('role="button"');
    expect(rootPageTwoHtml).toContain('History 51');
    expect(rootPageTwoHtml).toContain('History 100');
    expect(rootPageTwoHtml).not.toContain('History 50');
    expect(rootPageTwoHtml).not.toContain('History 101');

    const yearPageThreeHtml = await (await fetch(`${server.getBaseUrl()}/2020/page/3/`)).text();
    expect(yearPageThreeHtml).toContain('data-last-page="true"');
    expect(yearPageThreeHtml).toContain('href="/2020/page/2/"');
    expect(yearPageThreeHtml).not.toContain('href="/2020/page/4/"');
    expect(yearPageThreeHtml).toContain('History 101');
    expect(yearPageThreeHtml).toContain('History 120');
    expect(yearPageThreeHtml).not.toContain('History 100');

    const monthPageTwoHtml = await (await fetch(`${server.getBaseUrl()}/2020/10/page/2/`)).text();
    expect(monthPageTwoHtml).toContain('History 51');
    expect(monthPageTwoHtml).toContain('History 100');
    expect(monthPageTwoHtml).not.toContain('History 50');

    const categoryPageTwoHtml = await (await fetch(`${server.getBaseUrl()}/category/news/page/2/`)).text();
    expect(categoryPageTwoHtml).toContain('History 51');
    expect(categoryPageTwoHtml).toContain('History 100');
    expect(categoryPageTwoHtml).not.toContain('History 50');

    const tagPageThreeHtml = await (await fetch(`${server.getBaseUrl()}/tag/dev/page/3/`)).text();
    expect(tagPageThreeHtml).toContain('History 101');
    expect(tagPageThreeHtml).toContain('History 120');
    expect(tagPageThreeHtml).not.toContain('History 100');
  });

  it('uses max posts per page from preferences', async () => {
    const posts = Array.from({ length: 20 }).map((_, index) =>
      makePost({
        id: `pref-${index + 1}`,
        slug: `pref-slug-${index + 1}`,
        title: `Pref Post ${index + 1}`,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)),
      })
    );

    server = new PreviewServer({
      postEngine: makeEngine(posts),
      settingsEngine: makeSettings(7),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    const html = await response.text();
    const renderedPosts = (html.match(/<div class="post">/g) || []).length;
    expect(renderedPosts).toBe(7);
  });

  it('uses project description from metadata in page title', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            name: 'My Great Blog',
            description: 'A wonderful publication',
            maxPostsPerPage: 50,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<title>A wonderful publication</title>');
    expect(html).not.toContain('<title>My Great Blog</title>');
    expect(html).not.toContain('<title>Blog Preview</title>');
  });

  it('uses mainLanguage from metadata for html lang attribute', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return {
            name: 'My Great Blog',
            mainLanguage: 'de',
            maxPostsPerPage: 50,
          };
        },
      },
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="de">');
  });

  it('initializes metadata before reading language when supported by settings engine', async () => {
    let initialized = false;

    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        isInitialized: vi.fn(() => initialized),
        syncOnStartup: vi.fn(async () => {
          initialized = true;
        }),
        async getProjectMetadata() {
          return initialized
            ? { name: 'My Great Blog', mainLanguage: 'fr', maxPostsPerPage: 50 }
            : null;
        },
      } as any,
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="fr">');
  });

  it('falls back to active project name in page title when metadata is unavailable', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: {
        setProjectContext: vi.fn(),
        async getProjectMetadata() {
          return null;
        },
      },
      getActiveProjectContext: async () => ({
        projectId: 'default',
        dataDir: '/tmp/default',
        projectName: 'Configured Project Name',
      } as any),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<title>Configured Project Name</title>');
    expect(html).not.toContain('<title>Blog Preview</title>');
  });

  it('rewrites internal markdown links to canonical URLs while leaving external links unchanged', async () => {
    const targetBySlug = makePost({
      id: 'target-1',
      slug: 'target-post',
      title: 'Target Post',
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
      content: '# Target',
    });
    const targetByYearMonth = makePost({
      id: 'target-2',
      slug: 'archive-post',
      title: 'Archive Post',
      createdAt: new Date('2025-02-10T10:00:00.000Z'),
      content: '# Archive',
    });
    const legacyTarget = makePost({
      id: 'target-3',
      slug: 'legacy-post',
      title: 'Legacy Post',
      createdAt: new Date('2025-03-01T10:00:00.000Z'),
      content: '# Legacy',
    });

    const post = makePost({
      id: 'rewrite-1',
      slug: 'rewrite-test',
      title: 'Rewrite Test',
      content: [
        '[Post by slug](/posts/target-post)',
        '[Post by year/month](/posts/2025/02/archive-post)',
        '[Legacy post link](post/legacy-post)',
        '[Media file link](/media/2025/02/example.jpg)',
        '![Local image](media/2025/02/example.jpg)',
        '[External](https://example.com/path)',
      ].join('\n\n'),
    });

    server = new PreviewServer({
      postEngine: makeEngine([post, targetBySlug, targetByYearMonth, legacyTarget]),
      mediaEngine: makeMediaEngine([
        {
          id: 'media-guid-1',
          filename: '3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg',
          originalName: 'example.jpg',
          createdAt: new Date('2025-02-03T10:00:00.000Z'),
        },
      ]) as any,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('href="/2025/02/14/target-post"');
    expect(html).toContain('href="/2025/02/10/archive-post"');
    expect(html).toContain('href="/2025/03/01/legacy-post"');
    expect(html).toContain('href="/media/2025/02/3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg"');
    expect(html).toContain('src="/media/2025/02/3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg"');
    expect(html).toContain('href="https://example.com/path"');
  });

  it('does not resolve legacy post URL routes', async () => {
    const post = makePost({
      id: 'legacy-route-1',
      slug: 'legacy-route-target',
      title: 'Legacy Route Target',
      createdAt: new Date('2025-04-05T10:00:00.000Z'),
      content: '# Legacy route target',
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const canonicalResponse = await fetch(`${server.getBaseUrl()}/2025/04/05/legacy-route-target`);
    expect(canonicalResponse.status).toBe(200);

    const legacyPostsResponse = await fetch(`${server.getBaseUrl()}/posts/legacy-route-target`);
    expect(legacyPostsResponse.status).toBe(404);

    const legacyPostResponse = await fetch(`${server.getBaseUrl()}/post/legacy-route-target`);
    expect(legacyPostResponse.status).toBe(404);
  });

  it('renders gallery and photo_album macros as interactive lightbox markup in preview', async () => {
    const post = makePost({
      id: 'macro-1',
      slug: 'macro-preview',
      title: 'Macro Preview',
      content: [
        '[[gallery columns="2" caption="Trip Photos"]]',
        '[[photo_album year="2025" month="2"]]',
      ].join('\n\n'),
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      mediaEngine: makeMediaEngine([
        {
          id: 'media-1',
          filename: 'linked-1.jpg',
          originalName: 'linked-1.jpg',
          createdAt: new Date('2025-02-10T10:00:00.000Z'),
          linkedPostIds: ['macro-1'],
        } as any,
        {
          id: 'media-2',
          filename: 'linked-2.jpg',
          originalName: 'linked-2.jpg',
          createdAt: new Date('2025-02-12T10:00:00.000Z'),
          linkedPostIds: ['macro-1'],
        } as any,
        {
          id: 'media-3',
          filename: 'archive.jpg',
          originalName: 'archive.jpg',
          createdAt: new Date('2025-02-09T10:00:00.000Z'),
          linkedPostIds: [],
        } as any,
      ]) as any,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).not.toContain('Gallery preview is not interactive yet.');
    expect(html).not.toContain('Photo archive preview is not interactive yet.');

    expect(html).toContain('class="macro-gallery gallery-cols-2"');
    expect(html).toContain('data-lightbox="gallery-macro-1"');
    expect(html).toContain('/media/2025/02/linked-1.jpg');
    expect(html).toContain('/media/2025/02/linked-2.jpg');
    expect(html).toContain('Trip Photos');

    expect(html).toContain('class="macro-photo-archive photo-archive-single-month"');
    expect(html).toContain('data-lightbox="photo-archive-2025-02"');
    expect(html).toContain('/media/2025/02/archive.jpg');
  });

  it('resolves gallery linked images via post-media links even when media.linkedPostIds is empty', async () => {
    const post = makePost({
      id: 'macro-junction-1',
      slug: 'macro-junction-preview',
      title: 'Macro Junction Preview',
      content: '[[gallery columns="2"]]',
    });

    server = new PreviewServer({
      postEngine: makeEngine([post]),
      mediaEngine: makeMediaEngine([
        {
          id: 'junction-media-1',
          filename: 'junction-1.jpg',
          originalName: 'junction-1.jpg',
          createdAt: new Date('2025-02-10T10:00:00.000Z'),
          linkedPostIds: [],
        } as any,
      ]) as any,
      postMediaEngine: makePostMediaEngine({
        'macro-junction-1': [{ media: { id: 'junction-media-1' } }],
      }) as any,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    } as any);

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).not.toContain('No linked images found.');
    expect(html).toContain('/media/2025/02/junction-1.jpg');
  });

  it('serves media files from the active project data directory at /media/...', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'bds-preview-media-'));
    const mediaDir = path.join(tempDir, 'media', '2025', '02');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(path.join(mediaDir, 'sample.jpg'), Buffer.from('fake-image-bytes'));

    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({
        projectId: 'default',
        dataDir: tempDir!,
      }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/media/2025/02/sample.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    const body = await response.text();
    expect(body).toBe('fake-image-bytes');
  });

  it('uses published snapshot content and metadata for draft posts that have a published version', async () => {
    const draftWithPublished = makePost({
      id: 'draft-1',
      status: 'draft',
      title: 'Draft Title',
      slug: 'draft-slug',
      content: '# Draft content must not leak',
      tags: ['draft-tag'],
      categories: ['draft-category'],
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
    });

    const publishedSnapshot = makePost({
      id: 'draft-1',
      status: 'published',
      title: 'Published Title',
      slug: 'published-slug',
      content: '# Published content only',
      tags: ['published-tag'],
      categories: ['article'],
      createdAt: new Date('2025-02-14T10:00:00.000Z'),
    });

    const engine = makeEngine([draftWithPublished]);
    engine.hasPublishedVersion = vi.fn(async (id: string) => id === 'draft-1');
    engine.getPublishedVersion = vi.fn(async (id: string) => (id === 'draft-1' ? publishedSnapshot : null));

    server = new PreviewServer({
      postEngine: engine,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const rootHtml = await (await fetch(`${server.getBaseUrl()}/`)).text();
    expect(rootHtml).toContain('Published content only');
    expect(rootHtml).not.toContain('Draft content must not leak');

    const publishedSlugResponse = await fetch(`${server.getBaseUrl()}/2025/02/14/published-slug/`);
    expect(publishedSlugResponse.status).toBe(200);

    const draftSlugResponse = await fetch(`${server.getBaseUrl()}/2025/02/14/draft-slug/`);
    expect(draftSlugResponse.status).toBe(404);

    const publishedTagHtml = await (await fetch(`${server.getBaseUrl()}/tag/published-tag/`)).text();
    expect(publishedTagHtml).toContain('Published content only');

    const draftTagResponse = await fetch(`${server.getBaseUrl()}/tag/draft-tag/`);
    expect(draftTagResponse.status).toBe(404);
    const draftTagHtml = await draftTagResponse.text();
    expect(draftTagHtml).not.toContain('Published content only');
  });

  it('discovers candidates via status-scoped DB filters for published and draft only', async () => {
    const published = makePost({ id: 'pub-1', status: 'published', slug: 'pub-1', content: '# Published one' });
    const draft = makePost({ id: 'draft-1', status: 'draft', slug: 'draft-1', content: '# Draft one' });

    const getPostsFiltered = vi.fn(async (filter: PostFilter) => {
      if (filter.status === 'published') return [published];
      if (filter.status === 'draft') return [draft];
      return [];
    });

    const engine: PostEngineLike = {
      setProjectContext: vi.fn(),
      getPostsFiltered,
      getPost: vi.fn(async (id: string) => (id === published.id ? published : draft)),
      hasPublishedVersion: vi.fn(async (id: string) => id === draft.id),
      getPublishedVersion: vi.fn(async (id: string) => (id === draft.id
        ? makePost({ ...published, id: draft.id, slug: 'pub-draft', content: '# Published snapshot for draft' })
        : null)),
    };

    server = new PreviewServer({
      postEngine: engine,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);
    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);

    const statusValues = getPostsFiltered.mock.calls.map((args) => args[0]?.status);
    expect(statusValues.every((value) => value === 'published' || value === 'draft')).toBe(true);
    expect(statusValues).toContain('published');
    expect(statusValues).toContain('draft');
  });

  it('loads published filesystem content only for rendered posts', async () => {
    const fullPublishedPosts = Array.from({ length: 60 }).map((_, index) =>
      makePost({
        id: `pub-full-${index + 1}`,
        slug: `pub-full-${index + 1}`,
        title: `Published Full ${index + 1}`,
        content: `# Published Full ${index + 1}`,
        status: 'published',
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)),
      })
    );

    const summaryPublishedPosts = fullPublishedPosts.map((post) => ({
      ...post,
      content: '',
    }));

    const byId = new Map(fullPublishedPosts.map((post) => [post.id, post]));
    const getPost = vi.fn(async (id: string) => byId.get(id) ?? null);

    const engine: PostEngineLike = {
      setProjectContext: vi.fn(),
      getPost,
      hasPublishedVersion: vi.fn(async () => false),
      getPublishedVersion: vi.fn(async () => null),
      getPostsFiltered: vi.fn(async (filter: PostFilter) => {
        if (filter.status === 'published') {
          return summaryPublishedPosts;
        }
        if (filter.status === 'draft') {
          return [];
        }
        return [];
      }),
    };

    server = new PreviewServer({
      postEngine: engine,
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/`);
    expect(response.status).toBe(200);

    expect(getPost).toHaveBeenCalledTimes(50);
  });

  it('renders custom 404 template for unknown routes', async () => {
    server = new PreviewServer({
      postEngine: makeEngine([makePost()]),
      settingsEngine: makeSettings(50),
      getActiveProjectContext: async () => ({ projectId: 'default' }),
    });

    await server.start(0);

    const response = await fetch(`${server.getBaseUrl()}/does-not-exist/`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('data-template="not-found"');
    expect(html).toContain('class="not-found"');
  });
});
