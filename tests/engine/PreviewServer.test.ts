import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData, PostFilter } from '../../src/main/engine/PostEngine';
import { PreviewServer } from '../../src/main/engine/PreviewServer';

type PostEngineLike = {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPost: (id: string) => Promise<PostData | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
};

type SettingsEngineLike = {
  getProjectMetadata: () => Promise<{ maxPostsPerPage?: number } | null>;
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

describe('PreviewServer', () => {
  let server: PreviewServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
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
});