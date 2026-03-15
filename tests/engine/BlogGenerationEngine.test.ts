import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PostData, PostTranslationData } from '../../src/main/engine/PostEngine';
import { resolveUiLanguageFromSystemLocale } from '../../src/main/shared/i18n';
import type { MenuDocument } from '../../src/main/engine/MenuEngine';
import { createPreviewBackedGenerationRouteRenderer } from '../../src/main/engine/GenerationRouteRendererFactory';

const generatedFileHashes = new Map<string, string>();
const generatedFileUpdatedAt = new Map<string, number>();
const getGeneratedFileHashMock = vi.fn(async (projectId: string, relativePath: string) => {
  const key = `${projectId}:${relativePath}`;
  return generatedFileHashes.get(key) ?? null;
});
const getGeneratedFileHashRecordMock = vi.fn(async (projectId: string, relativePath: string) => {
  const key = `${projectId}:${relativePath}`;
  const contentHash = generatedFileHashes.get(key);
  if (!contentHash) {
    return null;
  }

  return {
    contentHash,
    updatedAt: generatedFileUpdatedAt.get(key) ?? 0,
  };
});
const setGeneratedFileHashMock = vi.fn(async (projectId: string, relativePath: string, hash: string) => {
  const key = `${projectId}:${relativePath}`;
  generatedFileHashes.set(key, hash);
  generatedFileUpdatedAt.set(key, Date.now());
});
const executeDbSql = vi.fn(async (input: { sql: string; args?: unknown[] }) => {
  const sqlText = input.sql.replace(/\s+/g, ' ').trim();
  const args = input.args ?? [];

  if (sqlText.startsWith('CREATE TABLE IF NOT EXISTS generated_file_hashes')) {
    return { rows: [] };
  }

  if (sqlText.startsWith('SELECT content_hash FROM generated_file_hashes')) {
    const key = `${String(args[0] ?? '')}:${String(args[1] ?? '')}`;
    const hash = generatedFileHashes.get(key);
    return { rows: hash ? [{ content_hash: hash }] : [] };
  }

  if (sqlText.startsWith('INSERT INTO generated_file_hashes')) {
    const key = `${String(args[0] ?? '')}:${String(args[1] ?? '')}`;
    generatedFileHashes.set(key, String(args[2] ?? ''));
    return { rows: [] };
  }

  return { rows: [] };
});

vi.mock('../../src/main/database/generatedFileHashStore', () => ({
  getGeneratedFileHash: getGeneratedFileHashMock,
  getGeneratedFileHashRecord: getGeneratedFileHashRecordMock,
  setGeneratedFileHash: setGeneratedFileHashMock,
  getAllGeneratedFileHashes: vi.fn(async () => new Map<string, string>()),
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocalClient: vi.fn(() => ({
      execute: executeDbSql,
    })),
  })),
}));

vi.mock('../../src/main/engine/PostEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/engine/PostEngine')>();
  const mockPostEngine = {
    getPostsFiltered: vi.fn(async () => []),
    getPublishedVersion: vi.fn(async () => null),
    getPost: vi.fn(async () => null),
    getPostTranslation: vi.fn(async () => null),
    getPostTranslations: vi.fn(async () => []),
    setProjectContext: vi.fn(),
  } as Record<string, any>;
  return {
    ...actual,
    getPostEngine: vi.fn(() => mockPostEngine),
    __mockPostEngine: mockPostEngine,
  };
});

vi.mock('../../src/main/engine/MediaEngine', () => {
  const mockMediaEngine = {
    getAllMedia: vi.fn(async () => []),
    setProjectContext: vi.fn(),
  };
  return {
    getMediaEngine: vi.fn(() => mockMediaEngine),
    __mockMediaEngine: mockMediaEngine,
  };
});

vi.mock('../../src/main/engine/PostMediaEngine', () => {
  const mockPostMediaEngine = {
    getLinkedMediaDataForPost: vi.fn(async () => []),
    setProjectContext: vi.fn(),
  };
  return {
    getPostMediaEngine: vi.fn(() => mockPostMediaEngine),
    __mockPostMediaEngine: mockPostMediaEngine,
  };
});

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-15T10:00:00.000Z');
  const updatedAt = overrides.updatedAt ?? createdAt;
  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'default',
    title: overrides.title ?? 'Test Post',
    slug: overrides.slug ?? 'test-post',
    excerpt: overrides.excerpt,
    content: overrides.content ?? '# Test\n\nBody text',
    status: overrides.status ?? 'published',
    author: overrides.author,
    language: overrides.language,
    createdAt,
    updatedAt,
    publishedAt: overrides.publishedAt ?? createdAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
    availableLanguages: overrides.availableLanguages ?? (overrides.language ? [overrides.language] : []),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...await listFiles(path.join(dir, entry.name), relative));
      } else {
        files.push(relative);
      }
    }
  } catch {
    // dir doesn't exist
  }
  return files.sort();
}

describe('BlogGenerationEngine', () => {
  let tempDir: string;
  let mockPostEngine: any;
  let mockMediaEngine: any;
  let mockPostMediaEngine: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    generatedFileHashes.clear();
    generatedFileUpdatedAt.clear();
    tempDir = await mkdtemp(path.join(tmpdir(), 'bds-gen-'));

    const { __mockPostEngine } = await import('../../src/main/engine/PostEngine') as any;
    mockPostEngine = __mockPostEngine;
    const { __mockMediaEngine } = await import('../../src/main/engine/MediaEngine') as any;
    mockMediaEngine = __mockMediaEngine;
    const { __mockPostMediaEngine } = await import('../../src/main/engine/PostMediaEngine') as any;
    mockPostMediaEngine = __mockPostMediaEngine;
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function setupPosts(posts: PostData[]): void {
    mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string; excludeCategories?: string[] }) => {
      return posts.filter((p) => {
        if (p.status !== (filter.status ?? p.status)) {
          return false;
        }

        if (Array.isArray(filter.excludeCategories) && filter.excludeCategories.length > 0) {
          const categories = Array.isArray(p.categories) ? p.categories : [];
          if (categories.some((category) => filter.excludeCategories?.includes(category))) {
            return false;
          }
        }

        return true;
      });
    });
    mockPostEngine.getPublishedVersion.mockResolvedValue(null);
    mockPostEngine.getPost.mockImplementation(async (id: string) => {
      return posts.find((p) => p.id === id) ?? null;
    });
    mockPostEngine.getPostTranslation.mockResolvedValue(null);
    mockPostEngine.getPostTranslations.mockResolvedValue([]);
  }

  async function generate(
    posts: PostData[],
    options?: Partial<{
      maxPostsPerPage: number;
      language: string;
      blogLanguages: string[];
      pageTitle: string;
      picoTheme: string;
      categorySettings: Record<string, { renderInLists: boolean; showTitle: boolean }>;
      categoryMetadata: Record<string, { renderInLists: boolean; showTitle: boolean; title: string }>;
      menu: MenuDocument;
    }>,
  ) {
    setupPosts(posts);
    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);
    const onProgress = vi.fn();
    return engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: options?.maxPostsPerPage,
      language: options?.language,
      blogLanguages: options?.blogLanguages,
      pageTitle: options?.pageTitle,
      picoTheme: options?.picoTheme as any,
      categorySettings: options?.categorySettings,
      categoryMetadata: options?.categoryMetadata,
      menu: options?.menu,
    }, onProgress);
  }

  it('renders configured menu below h1 with nested submenu links on list and single pages', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'hello-world',
        title: 'Hello World',
        categories: ['news'],
        createdAt: new Date('2025-03-15T10:00:00Z'),
      }),
      makePost({
        id: '2',
        slug: 'about',
        title: 'About',
        categories: ['page'],
        createdAt: new Date('2025-03-14T10:00:00Z'),
      }),
    ];

    await generate(posts, {
      menu: {
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
      },
    });

    const indexHtml = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    const singleHtml = await readFile(path.join(tempDir, 'html', '2025', '03', '15', 'hello-world', 'index.html'), 'utf-8');

    expect(indexHtml).toContain('class="blog-menu"');
    expect(indexHtml).toContain('href="/"');
    expect(indexHtml).toContain('href="/about/"');
    expect(indexHtml).toContain('href="/category/news/"');
    expect(indexHtml).toContain('<h2 class="post-title"><a href="/2025/03/15/hello-world">Hello World</a></h2>');
    expect(indexHtml).toContain('class="blog-menu-submenu"');

    const listH1Index = indexHtml.indexOf('<h1 class="archive-heading"');
    const listMenuIndex = indexHtml.indexOf('class="blog-menu"');
    const listContentIndex = indexHtml.indexOf('<section class="post-list"');
    expect(listH1Index).toBeGreaterThan(-1);
    expect(listMenuIndex).toBeGreaterThan(listH1Index);
    expect(listContentIndex).toBeGreaterThan(listMenuIndex);

    expect(singleHtml).toContain('class="blog-menu"');
    const singleH1Index = singleHtml.indexOf('<h1>Hello World</h1>');
    const singleMenuIndex = singleHtml.indexOf('class="blog-menu"');
    const singleContentIndex = singleHtml.indexOf('<div class="post">');
    expect(singleH1Index).toBeGreaterThan(-1);
    expect(singleMenuIndex).toBeGreaterThan(singleH1Index);
    expect(singleContentIndex).toBeGreaterThan(singleMenuIndex);
  });

  it('renders menu on generated category and tag archive pages', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'news-post',
        title: 'News Post',
        categories: ['news'],
        tags: ['dev'],
        createdAt: new Date('2025-03-15T10:00:00Z'),
      }),
    ];

    await generate(posts, {
      menu: {
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
          { id: 'news', title: 'News', kind: 'category-archive', categoryName: 'news', children: [] },
        ],
      },
    });

    const categoryHtml = await readFile(path.join(tempDir, 'html', 'category', 'news', 'index.html'), 'utf-8');
    const tagHtml = await readFile(path.join(tempDir, 'html', 'tag', 'dev', 'index.html'), 'utf-8');

    expect(categoryHtml).toContain('class="blog-menu"');
    expect(tagHtml).toContain('class="blog-menu"');
  });

  it('renders category menu links with category metadata title while keeping category URL', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'news-post',
        title: 'News Post',
        categories: ['news'],
        createdAt: new Date('2025-03-15T10:00:00Z'),
      }),
    ];

    await generate(posts, {
      categoryMetadata: {
        news: { renderInLists: true, showTitle: true, title: 'Newsroom' },
      },
      menu: {
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
          { id: 'news', title: 'news', kind: 'category-archive', categoryName: 'news', children: [] },
        ],
      },
    });

    const indexHtml = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(indexHtml).toContain('href="/category/news/"');
    expect(indexHtml).toContain('>Newsroom</a>');
    expect(indexHtml).not.toContain('>news</a>');
  });

  it('copies all required asset files to html/assets/ and html/images/', async () => {
    const result = await generate([]);

    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'pico.min.css'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'lightbox.min.css'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'lightbox.min.js'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'tag-cloud.js'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'vanilla-calendar.min.css'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'vanilla-calendar.min.js'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'assets', 'calendar-runtime.js'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'images', 'prev.png'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'images', 'next.png'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'images', 'close.png'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'images', 'loading.gif'))).toBe(true);

    const picoContent = await readFile(path.join(tempDir, 'html', 'assets', 'pico.min.css'), 'utf-8');
    expect(picoContent.length).toBeGreaterThan(0);
  });

  it('writes calendar.json and wires calendar UI in generated html', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'one',
        title: 'One',
        categories: ['news'],
        tags: ['updates'],
        createdAt: new Date('2025-03-15T10:00:00Z'),
      }),
      makePost({
        id: '2',
        slug: 'two',
        title: 'Two',
        categories: ['news'],
        tags: ['updates'],
        createdAt: new Date('2025-03-15T12:00:00Z'),
      }),
      makePost({
        id: '3',
        slug: 'three',
        title: 'Three',
        categories: ['news'],
        tags: ['updates'],
        createdAt: new Date('2025-04-01T10:00:00Z'),
      }),
    ];

    await generate(posts, {
      menu: {
        items: [
          { id: 'home', title: 'Home', kind: 'home', pageSlug: 'home', children: [] },
        ],
      },
    });

    const calendarJsonRaw = await readFile(path.join(tempDir, 'html', 'calendar.json'), 'utf-8');
    const calendarJson = JSON.parse(calendarJsonRaw) as {
      years: Record<string, number>;
      months: Record<string, number>;
      days: Record<string, number>;
    };

    expect(calendarJson.years['2025']).toBe(3);
    expect(calendarJson.months['2025-03']).toBe(2);
    expect(calendarJson.months['2025-04']).toBe(1);
    expect(calendarJson.days['2025-03-15']).toBe(2);
    expect(calendarJson.days['2025-04-01']).toBe(1);

    const indexHtml = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(indexHtml).toContain('class="blog-menu-calendar-button"');
    expect(indexHtml).toContain('data-blog-calendar-year="2025"');
    expect(indexHtml).toContain('data-blog-calendar-month="4"');
    expect(indexHtml).toContain('id="blog-calendar"');
    expect(indexHtml).toContain('href="/assets/vanilla-calendar.min.css"');
    expect(indexHtml).toContain('src="/assets/vanilla-calendar.min.js"');
    expect(indexHtml).toContain('src="/assets/calendar-runtime.js"');

    const singleHtml = await readFile(path.join(tempDir, 'html', '2025', '03', '15', 'one', 'index.html'), 'utf-8');
    expect(singleHtml).toContain('data-blog-calendar-year="2025"');
    expect(singleHtml).toContain('data-blog-calendar-month="3"');

    const tagArchiveHtml = await readFile(path.join(tempDir, 'html', 'tag', 'updates', 'index.html'), 'utf-8');
    expect(tagArchiveHtml).toContain('data-blog-calendar-year="2025"');
    expect(tagArchiveHtml).toContain('data-blog-calendar-month="4"');

    const calendarRuntime = await readFile(path.join(tempDir, 'html', 'assets', 'calendar-runtime.js'), 'utf-8');
    expect(calendarRuntime).toContain('--blog-calendar-heat-hue');
    expect(calendarRuntime).toContain('--blog-calendar-heat-alpha');
    expect(calendarRuntime).toContain('onCreateMonthEls');
    expect(calendarRuntime).toContain('onCreateYearEls');
    expect(calendarRuntime).toContain('data-blog-calendar-year');
    expect(calendarRuntime).toContain('data-blog-calendar-month');
    expect(calendarRuntime).toContain('window.location.pathname');
    expect(calendarRuntime).toContain('selectedYear');
    expect(calendarRuntime).toContain('selectedMonth');
    expect(calendarRuntime).not.toContain('blog-calendar-post-count');
  });

  it('generates root index.html for published posts', async () => {
    const posts = [
      makePost({ id: '1', slug: 'first', title: 'First Post', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'second', title: 'Second Post', createdAt: new Date('2025-01-14T10:00:00Z') }),
    ];

    const result = await generate(posts);

    expect(result.pagesGenerated).toBeGreaterThan(0);
    const indexPath = path.join(tempDir, 'html', 'index.html');
    expect(await fileExists(indexPath)).toBe(true);

    const html = await readFile(indexPath, 'utf-8');
    expect(html).toContain('data-template="post-list"');
    expect(html).toContain('/assets/pico.min.css');
    expect(html).toContain('/assets/lightbox.min.css');
    expect(html).toContain('/assets/bds.css');
    expect(html).toContain('/assets/tag-cloud.js');
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).toContain('href="/rss.xml"');
    expect(html).toContain('rel="alternate" type="application/atom+xml"');
    expect(html).toContain('href="/atom.xml"');
    expect(html).not.toContain('function parseWords(');
    expect(html).toContain('archive-day-marker');
    expect(html).toContain('15.01.2025');
    expect(html).toContain('14.01.2025');
  });

  it('uses anthracite page background override for all pico themes in dark mode', async () => {
    const posts = [
      makePost({ id: '1', slug: 'first', title: 'First Post', createdAt: new Date('2025-01-15T10:00:00Z') }),
    ];

    await generate(posts, { picoTheme: 'green' });

    const indexPath = path.join(tempDir, 'html', 'index.html');
    const html = await readFile(indexPath, 'utf-8');
    expect(html).toContain('href="/assets/pico.green.min.css"');
    expect(html).toContain('/assets/bds.css');
  });

  it('generates single post pages at /{year}/{month}/{day}/{slug}/index.html', async () => {
    const posts = [
      makePost({ id: '1', slug: 'hello-world', createdAt: new Date('2025-03-15T10:00:00Z') }),
    ];

    await generate(posts);

    const postPath = path.join(tempDir, 'html', '2025', '03', '15', 'hello-world', 'index.html');
    expect(await fileExists(postPath)).toBe(true);

    const html = await readFile(postPath, 'utf-8');
    expect(html).toContain('data-template="single-post"');
  });

  it('renders taxonomy bubbles on generated single-post pages with category-first order and tag color override', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'hello-world',
        title: 'Hello World',
        createdAt: new Date('2025-03-15T10:00:00Z'),
        categories: ['article', 'news'],
        tags: ['css-only', 'default-color'],
      }),
    ];

    await mkdir(path.join(tempDir, 'meta'), { recursive: true });
    await writeFile(path.join(tempDir, 'meta', 'tags.json'), JSON.stringify([
      { name: 'css-only', color: '#22aa88' },
      { name: 'default-color' },
    ]), 'utf-8');

    await generate(posts);

    const postPath = path.join(tempDir, 'html', '2025', '03', '15', 'hello-world', 'index.html');
    expect(await fileExists(postPath)).toBe(true);

    const html = await readFile(postPath, 'utf-8');
    expect(html).toContain('class="single-post-taxonomy"');
    expect(html).toContain('aria-label="Taxonomy"');
    expect(html).toContain('class="single-post-taxonomy-bubble single-post-taxonomy-bubble-category"');
    expect(html).toContain('class="single-post-taxonomy-bubble single-post-taxonomy-bubble-tag"');
    expect(html).toContain('href="/category/article/"');
    expect(html).toContain('href="/tag/css-only/"');
    expect(html).toContain('style="--bubble-accent: #22aa88;"');
    expect(html).toContain('/assets/bds.css');

    const categoryIndex = html.indexOf('single-post-taxonomy-bubble-category');
    const tagIndex = html.indexOf('single-post-taxonomy-bubble-tag');
    expect(categoryIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(-1);
    expect(categoryIndex).toBeLessThan(tagIndex);
  });

  it('generates category pages with correct archive context', async () => {
    const posts = [
      makePost({ id: '1', slug: 'news-1', title: 'News 1', categories: ['news'] }),
      makePost({ id: '2', slug: 'tech-1', title: 'Tech 1', categories: ['tech'] }),
    ];

    await generate(posts);

    const newsPath = path.join(tempDir, 'html', 'category', 'news', 'index.html');
    const techPath = path.join(tempDir, 'html', 'category', 'tech', 'index.html');
    expect(await fileExists(newsPath)).toBe(true);
    expect(await fileExists(techPath)).toBe(true);

    const newsHtml = await readFile(newsPath, 'utf-8');
    expect(newsHtml).toContain('news');
    expect(newsHtml).toContain('data-template="post-list"');
  });

  it('uses category title in rendered archive heading while keeping category name in URL path', async () => {
    const posts = [
      makePost({ id: '1', slug: 'news-1', title: 'News 1', categories: ['news'] }),
    ];

    await generate(posts, {
      categoryMetadata: {
        news: { renderInLists: true, showTitle: true, title: 'Newsroom' },
      },
    });

    const newsPath = path.join(tempDir, 'html', 'category', 'news', 'index.html');
    expect(await fileExists(newsPath)).toBe(true);

    const newsHtml = await readFile(newsPath, 'utf-8');
    expect(newsHtml).toContain('<h1 class="archive-heading">Newsroom</h1>');
    expect(newsHtml).not.toContain('<h1 class="archive-heading">news</h1>');
  });

  it('generates tag pages with correct archive context', async () => {
    const posts = [
      makePost({ id: '1', slug: 'tagged-1', title: 'Tagged 1', tags: ['javascript'] }),
      makePost({ id: '2', slug: 'tagged-2', title: 'Tagged 2', tags: ['typescript'] }),
    ];

    await generate(posts);

    const jsPath = path.join(tempDir, 'html', 'tag', 'javascript', 'index.html');
    const tsPath = path.join(tempDir, 'html', 'tag', 'typescript', 'index.html');
    expect(await fileExists(jsPath)).toBe(true);
    expect(await fileExists(tsPath)).toBe(true);

    const jsHtml = await readFile(jsPath, 'utf-8');
    expect(jsHtml).toContain('javascript');
    expect(jsHtml).toContain('data-template="post-list"');
  });

  it('generates pagination pages for categories with many posts', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 5; i++) {
      posts.push(makePost({
        id: `post-${i}`,
        slug: `post-${i}`,
        title: `Post ${i}`,
        categories: ['big-category'],
        createdAt: new Date(`2025-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));
    }

    await generate(posts, { maxPostsPerPage: 2 });

    expect(await fileExists(path.join(tempDir, 'html', 'category', 'big-category', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'big-category', 'page', '2', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'big-category', 'page', '3', 'index.html'))).toBe(true);
  });

  it('generates pagination pages for tags with many posts', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 4; i++) {
      posts.push(makePost({
        id: `post-${i}`,
        slug: `post-${i}`,
        title: `Post ${i}`,
        tags: ['popular'],
        createdAt: new Date(`2025-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));
    }

    await generate(posts, { maxPostsPerPage: 2 });

    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'popular', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'popular', 'page', '2', 'index.html'))).toBe(true);
  });

  it('generates root pagination pages', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 4; i++) {
      posts.push(makePost({
        id: `post-${i}`,
        slug: `post-${i}`,
        title: `Post ${i}`,
        createdAt: new Date(`2025-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));
    }

    await generate(posts, { maxPostsPerPage: 2 });

    expect(await fileExists(path.join(tempDir, 'html', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'page', '2', 'index.html'))).toBe(true);
  });

  it('generates year, month, and day archive pages', async () => {
    const posts = [
      makePost({ id: '1', slug: 'jan-post', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'feb-post', createdAt: new Date('2025-02-20T10:00:00Z') }),
    ];

    await generate(posts);

    // Year archive
    expect(await fileExists(path.join(tempDir, 'html', '2025', 'index.html'))).toBe(true);
    // Month archives
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '02', 'index.html'))).toBe(true);
    // Day archives
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '02', '20', 'index.html'))).toBe(true);
  });

  it('keeps static render language from project settings when ui language differs', async () => {
    const uiLanguage = resolveUiLanguageFromSystemLocale('de-DE');
    expect(uiLanguage).toBe('de');

    const posts = [
      makePost({ id: 'fr-1', slug: 'fr-1', title: 'FR 1', createdAt: new Date('2020-02-15T10:00:00Z') }),
      makePost({ id: 'fr-2', slug: 'fr-2', title: 'FR 2', createdAt: new Date('2020-02-14T10:00:00Z') }),
    ];

    await generate(posts, { language: 'fr', maxPostsPerPage: 50 });

    const monthArchivePath = path.join(tempDir, 'html', '2020', '02', 'index.html');
    const monthHtml = await readFile(monthArchivePath, 'utf-8');

    expect(monthHtml).toContain('<html lang="fr"');
    expect(monthHtml).toContain('<h1 class="archive-heading">Archives février 2020</h1>');
    expect(monthHtml).not.toContain('<h1 class="archive-heading">Archiv Februar 2020</h1>');
  });

  it('renders canonical single-post route with project main language content when available', async () => {
    const canonicalPost = makePost({
      id: 'post-1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello World\n\nCanonical body',
      language: 'en',
      createdAt: new Date('2025-01-15T10:00:00Z'),
    });

    setupPosts([canonicalPost]);
    mockPostEngine.getPostTranslation.mockImplementation(async (postId: string, language: string) => {
      if (postId === 'post-1' && language === 'fr') {
        return {
          id: 'translation-1-fr',
          projectId: 'default',
          translationFor: 'post-1',
          language: 'fr',
          title: 'Bonjour le monde',
          excerpt: 'Resume FR',
          content: '# Bonjour le monde\n\nCorps FR',
          status: 'published',
          createdAt: new Date('2025-01-15T10:05:00Z'),
          updatedAt: new Date('2025-01-15T10:05:00Z'),
          publishedAt: new Date('2025-01-15T10:06:00Z'),
          filePath: path.join(tempDir, 'posts', 'hello-world.fr.md'),
        };
      }
      return null;
    });

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'fr',
    }, vi.fn());

    const canonicalHtml = await readFile(path.join(tempDir, 'html', '2025', '01', '15', 'hello-world', 'index.html'), 'utf-8');

    expect(mockPostEngine.getPostTranslation).toHaveBeenCalledWith('post-1', 'fr');
    expect(canonicalHtml).toContain('<html lang="fr"');
    expect(canonicalHtml).toContain('Bonjour le monde');
    expect(canonicalHtml).toContain('Corps FR');
    expect(canonicalHtml).not.toContain('Canonical body');
  });

  it('preview-backed generation route renderer prefers project main language content on canonical single-post routes', async () => {
    const canonicalPost = makePost({
      id: 'post-1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello World\n\nCanonical body',
      language: 'en',
      createdAt: new Date('2025-01-15T10:00:00Z'),
    });

    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options: {
        projectId: 'test',
        dataDir: tempDir,
        projectName: 'Test Blog',
        language: 'fr',
      },
      maxPostsPerPage: 50,
      publishedPostsForLookup: [canonicalPost],
      engines: {
        postEngine: {
          getPostsFiltered: mockPostEngine.getPostsFiltered,
          getPublishedVersion: mockPostEngine.getPublishedVersion,
          getPost: mockPostEngine.getPost,
          getPostTranslation: vi.fn(async (postId: string, language: string) => {
            if (postId === 'post-1' && language === 'fr') {
              return {
                id: 'translation-1-fr',
                projectId: 'default',
                translationFor: 'post-1',
                language: 'fr',
                title: 'Bonjour le monde',
                excerpt: 'Resume FR',
                content: '# Bonjour le monde\n\nCorps FR',
                status: 'published',
                createdAt: new Date('2025-01-15T10:05:00Z'),
                updatedAt: new Date('2025-01-15T10:05:00Z'),
                publishedAt: new Date('2025-01-15T10:06:00Z'),
                filePath: path.join(tempDir, 'posts', 'hello-world.fr.md'),
              } satisfies PostTranslationData;
            }
            return null;
          }),
          hasPublishedVersion: mockPostEngine.hasPublishedVersion,
          setProjectContext: mockPostEngine.setProjectContext,
        },
        mediaEngine: mockMediaEngine,
        postMediaEngine: mockPostMediaEngine,
      },
    });

    const html = await renderRoute('/2025/01/15/hello-world');

    expect(html).not.toBeNull();
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('Bonjour le monde');
    expect(html).toContain('Corps FR');
    expect(html).not.toContain('Canonical body');
  });

  it('excludes draft-only posts from generated pages', async () => {
    const posts = [
      makePost({ id: '1', slug: 'published', title: 'Published', status: 'published' }),
      makePost({ id: '2', slug: 'draft-only', title: 'Draft Only', status: 'draft' }),
    ];

    const result = await generate(posts);

    expect(result.postCount).toBe(1);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'published', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'draft-only', 'index.html'))).toBe(false);
  });

  it('includes draft posts that have a published version', async () => {
    const publishedPost = makePost({ id: '1', slug: 'with-published', title: 'Published Version', status: 'published' });
    const draftWithPublished = makePost({ id: '2', slug: 'draft-has-pub', title: 'Draft Has Published', status: 'draft' });
    const publishedVersion = makePost({ id: '2', slug: 'draft-has-pub', title: 'Published Version of Draft', status: 'published', createdAt: new Date('2025-02-10T10:00:00Z') });

    mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
      if (filter.status === 'published') return [publishedPost];
      if (filter.status === 'draft') return [draftWithPublished];
      return [];
    });
    mockPostEngine.getPublishedVersion.mockImplementation(async (id: string) => {
      if (id === '2') return publishedVersion;
      return null;
    });
    mockPostEngine.getPost.mockImplementation(async (id: string) => {
      if (id === '1') return publishedPost;
      if (id === '2') return publishedVersion;
      return null;
    });

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);
    const result = await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    expect(result.postCount).toBe(2);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '02', '10', 'draft-has-pub', 'index.html'))).toBe(true);
  });

  it('returns correct pagesGenerated count', async () => {
    const posts = [
      makePost({ id: '1', slug: 'post-a', categories: ['news'], tags: ['js'], createdAt: new Date('2025-01-15T10:00:00Z') }),
    ];

    const result = await generate(posts);

    // Should have: root(1) + single(1) + category/news(1) + tag/js(1) + year(1) + month(1) + day(1) = 7
    expect(result.pagesGenerated).toBe(7);
  });

  it('reuses shared render snapshot and media lookups across full-site routes', async () => {
    const posts = [
      makePost({ id: '1', slug: 'post-1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'post-2', categories: ['news'], tags: ['t2'], createdAt: new Date('2025-01-14T10:00:00Z') }),
      makePost({ id: '3', slug: 'page-1', categories: ['page'], tags: [], createdAt: new Date('2025-01-13T10:00:00Z') }),
    ];

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);
    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 1,
    }, vi.fn());

    const filteredCallCount = mockPostEngine.getPostsFiltered.mock.calls.length;
    const publishedVersionCallCount = mockPostEngine.getPublishedVersion.mock.calls.length;

    expect(filteredCallCount).toBeLessThanOrEqual(20);
    expect(publishedVersionCallCount).toBeLessThanOrEqual(10);
    expect(mockMediaEngine.getAllMedia).toHaveBeenCalledTimes(1);
  });

  it('avoids per-route snapshot queries for single-post generation', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 6; i += 1) {
      posts.push(makePost({
        id: `single-${i}`,
        slug: `single-${i}`,
        createdAt: new Date(`2025-${String(i + 1).padStart(2, '0')}-15T10:00:00Z`),
      }));
    }

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      sections: ['single'],
    }, vi.fn());

    const filteredCallCount = mockPostEngine.getPostsFiltered.mock.calls.length;
    expect(filteredCallCount).toBeLessThanOrEqual(8);
  });

  it('skips core sitemap and feed build phases for single-only generation', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 4; i += 1) {
      posts.push(makePost({
        id: `single-phase-${i}`,
        slug: `single-phase-${i}`,
        createdAt: new Date(`2025-${String(i + 1).padStart(2, '0')}-10T10:00:00Z`),
      }));
    }

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);
    const onProgress = vi.fn();

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      sections: ['single'],
    }, onProgress);

    const progressMessages = onProgress.mock.calls.map((call) => String(call[1] ?? ''));
    expect(progressMessages).not.toContain('Building sitemap XML...');
    expect(progressMessages).not.toContain('Building RSS and Atom feeds...');
    expect(progressMessages).not.toContain('Writing sitemap and feeds...');
  });

  it('skips sitemap XML build phase for archive-only generation sections', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 8; i += 1) {
      posts.push(makePost({
        id: `archive-only-${i}`,
        slug: `archive-only-${i}`,
        categories: [`cat-${i % 2}`],
        tags: [`tag-${i % 3}`],
        createdAt: new Date(`2025-${String((i % 4) + 1).padStart(2, '0')}-10T10:00:00Z`),
      }));
    }

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);
    const onProgress = vi.fn();

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      sections: ['category', 'tag', 'date'],
    }, onProgress);

    const progressMessages = onProgress.mock.calls.map((call) => String(call[1] ?? ''));
    expect(progressMessages).not.toContain('Building sitemap XML...');
    expect(progressMessages).not.toContain('Building RSS and Atom feeds...');
    expect(progressMessages).not.toContain('Writing sitemap and feeds...');
  });

  it('does not rebuild canonical rewrite context for every generated html file', async () => {
    const posts = [
      makePost({ id: '1', slug: 'p1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'p2', categories: ['news'], tags: ['t2'], createdAt: new Date('2025-01-14T10:00:00Z') }),
      makePost({ id: '3', slug: 'p3', categories: ['news'], tags: ['t3'], createdAt: new Date('2025-01-13T10:00:00Z') }),
    ];

    setupPosts(posts);

    const pageRendererModule = await import('../../src/main/engine/PageRenderer');
    const canonicalPathSpy = vi.spyOn(pageRendererModule, 'buildCanonicalPostPath');

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 1,
    }, vi.fn());

    expect(canonicalPathSpy.mock.calls.length).toBeLessThanOrEqual(6);
    canonicalPathSpy.mockRestore();
  });

  it('does not re-setup engine project context for every rendered html file', async () => {
    const posts = [
      makePost({ id: '1', slug: 'ctx-1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'ctx-2', categories: ['news'], tags: ['t2'], createdAt: new Date('2025-01-14T10:00:00Z') }),
      makePost({ id: '3', slug: 'ctx-3', categories: ['news'], tags: ['t3'], createdAt: new Date('2025-01-13T10:00:00Z') }),
    ];

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 1,
    }, vi.fn());

    expect(mockPostEngine.setProjectContext.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('reduces repeated in-memory filtering across category tag and date generation', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 30; i += 1) {
      const month = (i % 6) + 1;
      const day = (i % 5) + 1;
      posts.push(makePost({
        id: `perf-${i}`,
        slug: `perf-${i}`,
        categories: [`cat-${i % 10}`],
        tags: [`tag-${i % 10}`],
        createdAt: new Date(`2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T10:00:00Z`),
      }));
    }

    setupPosts(posts);

    const filterSpy = vi.spyOn(Array.prototype, 'filter');
    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 5,
      sections: ['category', 'tag', 'date'],
    }, vi.fn());

    const filterCallCount = filterSpy.mock.calls.length;
    filterSpy.mockRestore();

    expect(filterCallCount).toBeLessThanOrEqual(750);
  });

  it('validates sitemap against html folder without rendering missing pages', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'validation-main-post',
        title: 'Validation Main Post',
        categories: ['news'],
        tags: ['validation-tag'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
      makePost({
        id: '2',
        slug: 'validation-page',
        title: 'Validation Page',
        categories: ['page'],
        tags: [],
        createdAt: new Date('2025-01-16T10:00:00Z'),
      }),
    ];
    setupPosts(posts);

    await mkdir(path.join(tempDir, 'html', 'stale'), { recursive: true });
    await writeFile(path.join(tempDir, 'html', 'stale', 'index.html'), '<html>stale</html>', 'utf-8');

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    expect(report.missingUrlPaths).toContain('/2025/01/15/validation-main-post');
    expect(report.missingUrlPaths).toContain('/category/news');
    expect(report.missingUrlPaths).toContain('/tag/validation-tag');
    expect(report.missingUrlPaths).toContain('/validation-page');
    expect(report.extraUrlPaths).toContain('/stale');

    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'validation-main-post', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'sitemap.xml'))).toBe(true);
  });

  it('reports updated post routes separately when post markdown is newer than generated html', async () => {
    const post = makePost({
      id: '1',
      slug: 'updated-post',
      title: 'Updated Post',
      categories: ['news'],
      tags: ['update-tag'],
      createdAt: new Date('2026-02-24T10:00:00Z'),
    });
    setupPosts([post]);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    const postFilePath = path.join(tempDir, 'posts', '2026', '02', 'updated-post.md');
    await mkdir(path.dirname(postFilePath), { recursive: true });
    await writeFile(postFilePath, '# Updated content', 'utf-8');

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    expect(report.missingUrlPaths).toEqual([]);
    expect(report.updatedPostUrlPaths).toEqual(['/2026/02/24/updated-post']);

    const applyResult = await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, report, vi.fn());

    expect(applyResult.renderedUrlCount).toBeGreaterThan(0);
  });

  it('does not repeatedly flag an old unchanged post as updated after a full generation pass', async () => {
    const post = makePost({
      id: '1',
      slug: 'old-stable-post',
      title: 'Old Stable Post',
      createdAt: new Date('2021-02-24T10:00:00Z'),
    });
    setupPosts([post]);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    const canonicalHtmlPath = path.join(tempDir, 'html', '2021', '02', '24', 'old-stable-post', 'index.html');
    const beforeStat = await stat(canonicalHtmlPath);

    const postFilePath = path.join(tempDir, 'posts', '2021', '02', 'old-stable-post.md');
    await mkdir(path.dirname(postFilePath), { recursive: true });
    await writeFile(postFilePath, '# Old Stable Post', 'utf-8');

    const firstReport = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    expect(firstReport.updatedPostUrlPaths).toEqual(['/2021/02/24/old-stable-post']);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    const afterStat = await stat(canonicalHtmlPath);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);

    const secondReport = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    expect(secondReport.updatedPostUrlPaths).toEqual([]);
  });

  it('applies validation by rendering missing pages and deleting extra pages with folder pruning', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'apply-post',
        title: 'Apply Post',
        categories: ['news'],
        tags: ['apply-tag'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
    ];
    setupPosts(posts);

    await mkdir(path.join(tempDir, 'html', 'obsolete', 'deep'), { recursive: true });
    await writeFile(path.join(tempDir, 'html', 'obsolete', 'deep', 'index.html'), '<html>obsolete</html>', 'utf-8');

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, vi.fn());

    const applyResult = await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, report, vi.fn());

    expect(applyResult.deletedUrlCount).toBeGreaterThan(0);
    expect(applyResult.renderedUrlCount).toBeGreaterThan(0);

    expect(await fileExists(path.join(tempDir, 'html', 'obsolete', 'deep', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'obsolete', 'deep'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'obsolete'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'apply-post', 'index.html'))).toBe(true);

    const calendarJsonRaw = await readFile(path.join(tempDir, 'html', 'calendar.json'), 'utf-8');
    const calendarJson = JSON.parse(calendarJsonRaw) as {
      years: Record<string, number>;
      months: Record<string, number>;
      days: Record<string, number>;
    };
    expect(calendarJson.years['2025']).toBe(1);
    expect(calendarJson.months['2025-01']).toBe(1);
    expect(calendarJson.days['2025-01-15']).toBe(1);
  });

  it('does not report valid pagination routes as extra html content', async () => {
    const posts = [
      makePost({ id: '1', slug: 'p1', categories: ['news'], tags: ['tag-news'], createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'p2', categories: ['news'], tags: ['tag-news'], createdAt: new Date('2025-01-14T10:00:00Z') }),
      makePost({ id: '3', slug: 'p3', categories: ['news'], tags: ['tag-news'], createdAt: new Date('2025-01-13T10:00:00Z') }),
    ];

    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 2,
    }, vi.fn());

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      maxPostsPerPage: 2,
    }, vi.fn());

    expect(report.extraUrlPaths).not.toContain('/page/2');
    expect(report.extraUrlPaths).not.toContain('/category/news/page/2');
    expect(report.extraUrlPaths).not.toContain('/tag/tag-news/page/2');
  });

  it('emits sitemap urls with trailing slash canonical form', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'canonical-post',
        categories: ['news'],
        tags: ['canonical-tag'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
      makePost({
        id: '2',
        slug: 'canonical-post-2',
        categories: ['news'],
        tags: ['canonical-tag'],
        createdAt: new Date('2025-01-14T10:00:00Z'),
      }),
      makePost({
        id: '3',
        slug: 'canonical-post-3',
        categories: ['news'],
        tags: ['canonical-tag'],
        createdAt: new Date('2025-01-13T10:00:00Z'),
      }),
      makePost({
        id: '4',
        slug: 'canonical-page',
        categories: ['page'],
        tags: [],
        createdAt: new Date('2025-01-12T10:00:00Z'),
      }),
    ];

    await generate(posts, { maxPostsPerPage: 2 });

    const sitemap = await readFile(path.join(tempDir, 'html', 'sitemap.xml'), 'utf-8');

    expect(sitemap).toContain('<loc>https://example.com/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/2025/01/15/canonical-post/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/category/news/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/category/news/page/2/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/tag/canonical-tag/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/canonical-page/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/page/2/</loc>');
  });

  it('generates published translation pages with alternate links and sitemap entries', async () => {
    const sourcePost = makePost({
      id: '1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello World\n\nEnglish body',
      language: 'en',
      availableLanguages: ['en', 'fr'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
      updatedAt: new Date('2025-01-15T10:00:00Z'),
    });
    const translationsByPostId = new Map<string, PostTranslationData[]>([
      ['1', [{
        id: 'translation-1-fr',
        projectId: 'default',
        translationFor: '1',
        language: 'fr',
        title: 'Bonjour le monde',
        excerpt: 'Resume FR',
        content: '# Bonjour le monde\n\nCorps FR',
        status: 'published',
        createdAt: new Date('2025-01-15T10:05:00Z'),
        updatedAt: new Date('2025-01-15T10:05:00Z'),
        publishedAt: new Date('2025-01-15T10:06:00Z'),
        filePath: path.join(tempDir, 'posts', 'hello-world.fr.md'),
      }]],
    ]);

    setupPosts([sourcePost]);
    mockPostEngine.getPostTranslations.mockImplementation(async (postId: string) => translationsByPostId.get(postId) ?? []);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
    }, vi.fn());

    const canonicalHtml = await readFile(path.join(tempDir, 'html', '2025', '01', '15', 'hello-world', 'index.html'), 'utf-8');
    const translationHtml = await readFile(path.join(tempDir, 'html', '2025', '01', '15', 'hello-world.fr', 'index.html'), 'utf-8');
    const sitemap = await readFile(path.join(tempDir, 'html', 'sitemap.xml'), 'utf-8');

    expect(canonicalHtml).toContain('hreflang="fr"');
    expect(canonicalHtml).toContain('href="/2025/01/15/hello-world.fr"');
    expect(translationHtml).toContain('<html lang="fr"');
    expect(translationHtml).toContain('Bonjour le monde');
    expect(sitemap).toContain('<loc>https://example.com/2025/01/15/hello-world/</loc>');
    expect(sitemap).toContain('<loc>https://example.com/2025/01/15/hello-world.fr/</loc>');
  });

  it('preserves post engine method binding when loading published translations', async () => {
    const sourcePost = makePost({
      id: '1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello World\n\nEnglish body',
      language: 'en',
      availableLanguages: ['en', 'fr'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
      updatedAt: new Date('2025-01-15T10:00:00Z'),
    });
    const translationsByPostId = new Map<string, PostTranslationData[]>([
      ['1', [{
        id: 'translation-1-fr',
        projectId: 'default',
        translationFor: '1',
        language: 'fr',
        title: 'Bonjour le monde',
        excerpt: 'Resume FR',
        content: '# Bonjour le monde\n\nCorps FR',
        status: 'published',
        createdAt: new Date('2025-01-15T10:05:00Z'),
        updatedAt: new Date('2025-01-15T10:05:00Z'),
        publishedAt: new Date('2025-01-15T10:06:00Z'),
        filePath: path.join(tempDir, 'posts', 'hello-world.fr.md'),
      }]],
    ]);

    const postEngine = {
      translationsByPostId,
      setProjectContext: vi.fn(),
      async getPostsFiltered(filter: { status?: string }) {
        return filter.status === 'published' ? [sourcePost] : [];
      },
      async getPublishedVersion() {
        return null;
      },
      async getPost(postId: string) {
        return postId === sourcePost.id ? sourcePost : null;
      },
      async getPostTranslations(postId: string) {
        return this.translationsByPostId.get(postId) ?? [];
      },
    };

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(postEngine as any, mockMediaEngine, mockPostMediaEngine);

    await expect(engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
    }, vi.fn())).resolves.toMatchObject({
      postCount: 1,
    });

    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'hello-world.fr', 'index.html'))).toBe(true);
  });

  it('applies validation by generating only missing category and tag routes', async () => {
    const posts = [
      makePost({ id: '1', slug: 'ordered-post', categories: ['news'], tags: ['ordered-tag'], createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'other-post', categories: ['other-category'], tags: ['other-tag'], createdAt: new Date('2024-12-20T10:00:00Z') }),
    ];
    setupPosts(posts);

    await mkdir(path.join(tempDir, 'html', 'stale'), { recursive: true });
    await writeFile(path.join(tempDir, 'html', 'stale', 'index.html'), '<html>stale</html>', 'utf-8');

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const generateSpy = vi.spyOn(engine, 'generate');

    const result = await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/category/news', '/tag/ordered-tag'],
      extraUrlPaths: ['/stale'],
      expectedUrlCount: 2,
      existingHtmlUrlCount: 1,
    }, vi.fn());

    expect(result.deletedUrlCount).toBe(1);
    expect(generateSpy).not.toHaveBeenCalled();
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'news', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'ordered-tag', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'other-category', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'other-tag', 'index.html'))).toBe(false);

    generateSpy.mockRestore();
  });

  it('applies validation for a missing month by generating that month and parent year only', async () => {
    const posts = [
      makePost({ id: '1', slug: 'jan-post', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'feb-post', createdAt: new Date('2025-02-20T10:00:00Z') }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01'],
      extraUrlPaths: [],
      expectedUrlCount: 1,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    // The requested month and its parent year are rendered
    expect(await fileExists(path.join(tempDir, 'html', '2025', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', 'index.html'))).toBe(true);
    // Child day archives are NOT cascaded into — only upward cascade
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'index.html'))).toBe(false);
    // Unrelated months are not rendered
    expect(await fileExists(path.join(tempDir, 'html', '2025', '02', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '02', '20', 'index.html'))).toBe(false);
  });

  it('applies validation for a missing year by generating only that year archive', async () => {
    const posts = [
      makePost({ id: '1', slug: 'year-2025', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'year-2024', createdAt: new Date('2024-02-20T10:00:00Z') }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025'],
      extraUrlPaths: [],
      expectedUrlCount: 1,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    // Only the requested year archive is rendered — no downward cascade
    expect(await fileExists(path.join(tempDir, 'html', '2025', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'index.html'))).toBe(false);
    // Other years are not rendered
    expect(await fileExists(path.join(tempDir, 'html', '2024', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2024', '02', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2024', '02', '20', 'index.html'))).toBe(false);
  });

  it('applies validation for a missing post by generating post and its date archives only', async () => {
    const posts = [
      makePost({ id: '1', slug: 'target-post', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'other-year-post', createdAt: new Date('2024-02-20T10:00:00Z') }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01/15/target-post'],
      extraUrlPaths: [],
      expectedUrlCount: 1,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'target-post', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2025', '01', '15', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', '2024', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2024', '02', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', '2024', '02', '20', 'index.html'))).toBe(false);
  });

  it('applies validation for a missing post by rerendering the main root page', async () => {
    const posts = [
      makePost({ id: '1', slug: 'target-post', title: 'Target Post', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'older-post', title: 'Older Post', createdAt: new Date('2024-02-20T10:00:00Z') }),
    ];
    setupPosts(posts);

    await mkdir(path.join(tempDir, 'html'), { recursive: true });
    await writeFile(path.join(tempDir, 'html', 'index.html'), '<html><body>stale-root</body></html>', 'utf-8');

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01/15/target-post'],
      extraUrlPaths: [],
      expectedUrlCount: 1,
      existingHtmlUrlCount: 1,
    }, vi.fn());

    const rootHtml = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(rootHtml).not.toContain('stale-root');
    expect(rootHtml).toContain('Target Post');
  });

  it('merges date archive renders when multiple missing posts share the same date lineage', async () => {
    const posts = [
      makePost({ id: '1', slug: 'target-post-1', createdAt: new Date('2025-01-15T10:00:00Z') }),
      makePost({ id: '2', slug: 'target-post-2', createdAt: new Date('2025-01-15T11:00:00Z') }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const { PageRenderer } = await import('../../src/main/engine/PageRenderer');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const renderPostListSpy = vi.spyOn(PageRenderer.prototype, 'renderPostList');

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01/15/target-post-1', '/2025/01/15/target-post-2'],
      extraUrlPaths: [],
      expectedUrlCount: 2,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    const dateCalls = renderPostListSpy.mock.calls
      .map(([, , renderOptions]) => renderOptions)
      .filter((renderOptions) => renderOptions?.routeKind === 'date');

    const yearCalls = dateCalls.filter((call) => call.archiveContext?.kind === 'year' && call.archiveContext?.year === 2025);
    const monthCalls = dateCalls.filter((call) => call.archiveContext?.kind === 'month' && call.archiveContext?.year === 2025 && call.archiveContext?.month === 1);
    const dayCalls = dateCalls.filter((call) => call.archiveContext?.kind === 'day' && call.archiveContext?.year === 2025 && call.archiveContext?.month === 1 && call.archiveContext?.day === 15);

    expect(yearCalls).toHaveLength(1);
    expect(monthCalls).toHaveLength(1);
    expect(dayCalls).toHaveLength(1);

    renderPostListSpy.mockRestore();
  });

  it('applies validation for a missing post by rerendering its categories and tags', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'cat-tag-post',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        categories: ['news'],
        tags: ['alpha'],
      }),
      makePost({
        id: '2',
        slug: 'other-post',
        createdAt: new Date('2024-02-20T10:00:00Z'),
        categories: ['other-category'],
        tags: ['other-tag'],
      }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01/15/cat-tag-post'],
      extraUrlPaths: [],
      expectedUrlCount: 1,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    expect(await fileExists(path.join(tempDir, 'html', 'category', 'news', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'alpha', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'other-category', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'tag', 'other-tag', 'index.html'))).toBe(false);
  });

  it('deduplicates category and tag rerenders when multiple missing posts share them', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'shared-1',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        categories: ['news'],
        tags: ['alpha'],
      }),
      makePost({
        id: '2',
        slug: 'shared-2',
        createdAt: new Date('2025-01-16T10:00:00Z'),
        categories: ['news'],
        tags: ['alpha'],
      }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const { PageRenderer } = await import('../../src/main/engine/PageRenderer');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const renderPostListSpy = vi.spyOn(PageRenderer.prototype, 'renderPostList');

    await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/2025/01/15/shared-1', '/2025/01/16/shared-2'],
      extraUrlPaths: [],
      expectedUrlCount: 2,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    const categoryCalls = renderPostListSpy.mock.calls
      .map(([, , renderOptions]) => renderOptions)
      .filter((renderOptions) => renderOptions?.archiveContext?.kind === 'category' && renderOptions?.archiveContext?.name === 'news');
    const tagCalls = renderPostListSpy.mock.calls
      .map(([, , renderOptions]) => renderOptions)
      .filter((renderOptions) => renderOptions?.archiveContext?.kind === 'tag' && renderOptions?.archiveContext?.name === 'alpha');

    expect(categoryCalls).toHaveLength(1);
    expect(tagCalls).toHaveLength(1);

    renderPostListSpy.mockRestore();
  });

  it('generates HTML that references local assets not CDN', async () => {
    const posts = [makePost({ id: '1', slug: 'test' })];
    await generate(posts);

    const indexHtml = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(indexHtml).toContain('href="/assets/pico.min.css"');
    expect(indexHtml).toContain('href="/assets/lightbox.min.css"');
    expect(indexHtml).toContain('src="/assets/lightbox.min.js"');
    expect(indexHtml).not.toContain('cdn.jsdelivr.net');
    expect(indexHtml).not.toContain('cdnjs.cloudflare.com');
  });

  it('handles categories with special characters via URL encoding', async () => {
    const posts = [
      makePost({ id: '1', slug: 'special', categories: ['my category'] }),
    ];

    await generate(posts);

    expect(await fileExists(path.join(tempDir, 'html', 'category', 'my%20category', 'index.html'))).toBe(true);
  });

  it('omits excluded categories from category archives and sitemap', async () => {
    const posts = [
      makePost({ id: '1', slug: 'aside-post', title: 'Aside Post', categories: ['aside'] }),
    ];

    await generate(posts, {
      categorySettings: {
        aside: { renderInLists: false, showTitle: false },
      },
    });

    const categoryArchivePath = path.join(tempDir, 'html', 'category', 'aside', 'index.html');
    expect(await fileExists(categoryArchivePath)).toBe(false);

    const sitemap = await readFile(path.join(tempDir, 'html', 'sitemap.xml'), 'utf-8');
    expect(sitemap).not.toContain('https://example.com/category/aside');
  });

  it('omits excluded-category posts from RSS and Atom feeds', async () => {
    const posts = [
      makePost({ id: '1', slug: 'aside-post', title: 'Aside Post', categories: ['aside'] }),
    ];

    await generate(posts, {
      categorySettings: {
        aside: { renderInLists: false, showTitle: false },
      },
    });

    const rss = await readFile(path.join(tempDir, 'html', 'rss.xml'), 'utf-8');
    const atom = await readFile(path.join(tempDir, 'html', 'atom.xml'), 'utf-8');

    expect(rss).not.toContain('<title>Aside Post</title>');
    expect(atom).not.toContain('<title>Aside Post</title>');
  });

  it('omits posts that mix included and excluded categories from list outputs and feeds', async () => {
    const posts = [
      makePost({ id: '1', slug: 'mixed-post', title: 'Mixed Post', categories: ['news', 'aside'] }),
    ];

    await generate(posts, {
      categorySettings: {
        aside: { renderInLists: false, showTitle: false },
      },
    });

    expect(await fileExists(path.join(tempDir, 'html', 'category', 'news', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'category', 'aside', 'index.html'))).toBe(false);

    const rss = await readFile(path.join(tempDir, 'html', 'rss.xml'), 'utf-8');
    const atom = await readFile(path.join(tempDir, 'html', 'atom.xml'), 'utf-8');
    const sitemap = await readFile(path.join(tempDir, 'html', 'sitemap.xml'), 'utf-8');

    expect(rss).not.toContain('<title>Mixed Post</title>');
    expect(atom).not.toContain('<title>Mixed Post</title>');
    expect(sitemap).not.toContain('https://example.com/category/news');
    expect(sitemap).not.toContain('https://example.com/category/aside');
  });

  it('generates static page routes at /{slug}/index.html for posts in category page', async () => {
    const posts = [
      makePost({ id: 'page-1', slug: 'about', title: 'About', categories: ['page'] }),
      makePost({ id: 'post-1', slug: 'hello-world', title: 'Hello World', categories: ['blog'] }),
    ];

    await generate(posts);

    expect(await fileExists(path.join(tempDir, 'html', 'about', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'hello-world', 'index.html'))).toBe(false);
  });

  it('generates translated static page routes for published page translations', async () => {
    const pagePost = makePost({
      id: 'page-1',
      slug: 'tag-cloud',
      title: 'Tag Cloud',
      categories: ['page'],
      language: 'en',
      availableLanguages: ['en', 'de'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
      updatedAt: new Date('2025-01-15T10:00:00Z'),
    });

    setupPosts([pagePost]);
    mockPostEngine.getPostTranslations.mockResolvedValue([{
      id: 'translation-page-1-de',
      projectId: 'default',
      translationFor: 'page-1',
      language: 'de',
      title: 'Schlagwortwolke',
      excerpt: 'Zusammenfassung DE',
      content: '# Schlagwortwolke\n\nInhalt DE',
      status: 'published',
      createdAt: new Date('2025-01-15T10:05:00Z'),
      updatedAt: new Date('2025-01-15T10:05:00Z'),
      publishedAt: new Date('2025-01-15T10:06:00Z'),
      filePath: path.join(tempDir, 'posts', 'tag-cloud.de.md'),
    }]);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
    }, vi.fn());

    expect(await fileExists(path.join(tempDir, 'html', 'tag-cloud', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'tag-cloud.de', 'index.html'))).toBe(true);
  });

  it('generates canonical post routes only and does not generate aliases', async () => {
    const posts = [
      makePost({ id: '1', slug: 'alias-test', createdAt: new Date('2025-03-15T10:00:00Z') }),
    ];

    await generate(posts);

    expect(await fileExists(path.join(tempDir, 'html', '2025', '03', '15', 'alias-test', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'posts', 'alias-test', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'posts', '2025', '03', 'alias-test', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'post', 'alias-test', 'index.html'))).toBe(false);
    expect(await fileExists(path.join(tempDir, 'html', 'post', '2025', '03', 'alias-test', 'index.html'))).toBe(false);
  });

  it('rewrites legacy internal media image URLs to canonical media URLs in generated html', async () => {
    mockMediaEngine.getAllMedia.mockResolvedValue([
      {
        id: 'media-1',
        filename: '3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg',
        originalName: '20221111_0177.jpg',
        createdAt: new Date('2022-11-11T10:00:00.000Z'),
      },
    ]);

    const posts = [
      makePost({
        id: 'post-1',
        slug: 'autumn-leaves',
        title: 'Autumn Leaves',
        createdAt: new Date('2022-11-11T10:00:00.000Z'),
        content: '![autumn](/media/2022/11/20221111_0177.jpg)',
      }),
    ];

    await generate(posts);

    const html = await readFile(path.join(tempDir, 'html', '2022', '11', '11', 'autumn-leaves', 'index.html'), 'utf-8');
    expect(html).toContain('/media/2022/11/3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg');
    expect(html).not.toContain('/media/2022/11/20221111_0177.jpg');
  });

  it('does not overwrite unchanged html files on subsequent generation runs', async () => {
    const posts = [
      makePost({ id: '1', slug: 'stable-post', createdAt: new Date('2025-03-15T10:00:00Z') }),
    ];

    await generate(posts);

    const canonicalPath = path.join(tempDir, 'html', '2025', '03', '15', 'stable-post', 'index.html');
    const beforeStat = await stat(canonicalPath);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await generate(posts);

    const afterStat = await stat(canonicalPath);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('delegates hash reads/writes to generated file hash store module', async () => {
    const posts = [makePost({ id: '1', slug: 'delegation-check' })];

    await generate(posts);

    expect(getGeneratedFileHashMock).toHaveBeenCalled();
    expect(setGeneratedFileHashMock).toHaveBeenCalled();
  });

  it('does not execute CREATE TABLE statements during generation runtime', async () => {
    const posts = [makePost({ id: '1', slug: 'runtime-ddl-test' })];

    await generate(posts);

    const createTableCalls = executeDbSql.mock.calls.filter(([input]) => {
      const sql = typeof input?.sql === 'string' ? input.sql : '';
      return sql.toUpperCase().includes('CREATE TABLE');
    });

    expect(createTableCalls).toHaveLength(0);
  });

  it('does not create html/media folder during generation', async () => {
    const posts = [makePost({ id: '1', slug: 'test' })];

    await generate(posts);

    expect(await fileExists(path.join(tempDir, 'html', 'media'))).toBe(false);
  });

  it('validateSite reports missing language subtree pages and does not flag them as extra', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'lang-post',
        title: 'Language Post',
        categories: ['news'],
        tags: ['lang-tag'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    // Generate only main language pages
    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
    }, vi.fn());

    // Validate with blogLanguages including fr - should report missing fr pages
    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, vi.fn());

    expect(report.missingUrlPaths).toContain('/fr');
    expect(report.missingUrlPaths).toContain('/fr/2025/01/15/lang-post');
    expect(report.missingUrlPaths).toContain('/fr/category/news');
    expect(report.missingUrlPaths).toContain('/fr/tag/lang-tag');
    expect(report.extraUrlPaths).not.toContain('/fr');
  });

  it('validateSite reports no missing language pages after full multi-language generation', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'multilang-post',
        title: 'Multi Lang Post',
        categories: ['news'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, vi.fn());

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, vi.fn());

    expect(report.missingUrlPaths).toEqual([]);
    expect(report.extraUrlPaths).toEqual([]);
  });

  it('applyValidation renders missing language subtree pages', async () => {
    const posts = [
      makePost({
        id: '1',
        slug: 'apply-lang-post',
        title: 'Apply Lang Post',
        categories: ['news'],
        tags: ['apply-lang-tag'],
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }),
    ];
    setupPosts(posts);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    const result = await engine.applyValidation({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, {
      sitemapPath: path.join(tempDir, 'html', 'sitemap.xml'),
      sitemapChanged: false,
      missingUrlPaths: ['/fr/category/news', '/fr/tag/apply-lang-tag'],
      extraUrlPaths: [],
      updatedPostUrlPaths: [],
      expectedUrlCount: 2,
      existingHtmlUrlCount: 0,
    }, vi.fn());

    expect(result.renderedUrlCount).toBeGreaterThan(0);
    expect(await fileExists(path.join(tempDir, 'html', 'fr', 'category', 'news', 'index.html'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'html', 'fr', 'tag', 'apply-lang-tag', 'index.html'))).toBe(true);
  });

  it('validateSite excludes doNotTranslate posts from language subtree expected urls', async () => {
    const translatablePost = makePost({
      id: '1',
      slug: 'translatable',
      title: 'Translatable',
      categories: ['news'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
    });
    const dntPost = makePost({
      id: '2',
      slug: 'no-translate',
      title: 'Do Not Translate',
      categories: ['news'],
      createdAt: new Date('2025-01-16T10:00:00Z'),
      doNotTranslate: true,
    } as any);
    setupPosts([translatablePost, dntPost]);

    const { BlogGenerationEngine } = await import('../../src/main/engine/BlogGenerationEngine');
    const engine = new BlogGenerationEngine(mockPostEngine, mockMediaEngine, mockPostMediaEngine);

    await engine.generate({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, vi.fn());

    const report = await engine.validateSite({
      projectId: 'test',
      projectName: 'Test Blog',
      dataDir: tempDir,
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
    }, vi.fn());

    expect(report.missingUrlPaths).toEqual([]);
    // The dnt post's single page should NOT be expected in /fr/ subtree
    expect(report.extraUrlPaths).not.toContain('/fr/2025/01/16/no-translate');
  });

  it('generates zero pages when there are no published posts', async () => {
    const result = await generate([]);
    expect(result.pagesGenerated).toBe(0);
    expect(result.postCount).toBe(0);
  });

  it('language subtree list pages show translated title and excerpt, not canonical language', async () => {
    const posts = [
      makePost({
        id: 'de-post-1',
        slug: 'german-post',
        title: 'Deutscher Titel',
        excerpt: 'Deutscher Auszug',
        content: '# Deutscher Inhalt',
        language: 'de',
        categories: ['tech'],
        createdAt: new Date('2025-06-10T10:00:00Z'),
        availableLanguages: ['de', 'en'],
      }),
    ];

    const translationMap = new Map<string, PostTranslationData[]>();
    translationMap.set('de-post-1', [{
      id: 'en-trans-1',
      projectId: 'test',
      translationFor: 'de-post-1',
      language: 'en',
      title: 'English Title',
      excerpt: 'English excerpt',
      content: '# English Content',
      status: 'published',
      createdAt: new Date('2025-06-10T10:00:00Z'),
      updatedAt: new Date('2025-06-10T10:00:00Z'),
      publishedAt: new Date('2025-06-10T10:00:00Z'),
      filePath: '',
    }]);
    mockPostEngine.getPublishedTranslationsForRoutePosts = vi.fn().mockResolvedValue(translationMap);

    await generate(posts, { language: 'de', blogLanguages: ['de', 'en'] });

    // /en/ subtree list page should show English title and excerpt
    const enIndex = await readFile(path.join(tempDir, 'html', 'en', 'index.html'), 'utf-8');
    expect(enIndex).toContain('English Title');
    expect(enIndex).toContain('English excerpt');
    expect(enIndex).not.toContain('Deutscher Titel');
    expect(enIndex).not.toContain('Deutscher Auszug');

    // Main blog list page should still show German
    const deIndex = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(deIndex).toContain('Deutscher Titel');
    expect(deIndex).not.toContain('English Title');
  });

  it('main blog list pages show translated content when canonical language differs from project language', async () => {
    const posts = [
      makePost({
        id: 'en-post-1',
        slug: 'english-post',
        title: 'English Title',
        excerpt: 'English excerpt',
        content: '# English Content',
        language: 'en',
        categories: ['tech'],
        createdAt: new Date('2025-06-10T10:00:00Z'),
        availableLanguages: ['en', 'de'],
      }),
    ];

    const translationMap = new Map<string, PostTranslationData[]>();
    translationMap.set('en-post-1', [{
      id: 'de-trans-1',
      projectId: 'test',
      translationFor: 'en-post-1',
      language: 'de',
      title: 'Deutscher Titel',
      excerpt: 'Deutscher Auszug',
      content: '# Deutscher Inhalt',
      status: 'published',
      createdAt: new Date('2025-06-10T10:00:00Z'),
      updatedAt: new Date('2025-06-10T10:00:00Z'),
      publishedAt: new Date('2025-06-10T10:00:00Z'),
      filePath: '',
    }]);
    mockPostEngine.getPublishedTranslationsForRoutePosts = vi.fn().mockResolvedValue(translationMap);

    await generate(posts, { language: 'de', blogLanguages: ['de', 'en'] });

    // Main blog (de) should show German translated title, not English canonical
    const deIndex = await readFile(path.join(tempDir, 'html', 'index.html'), 'utf-8');
    expect(deIndex).toContain('Deutscher Titel');
    expect(deIndex).not.toContain('English Title');

    // /en/ subtree should show English canonical title
    const enIndex = await readFile(path.join(tempDir, 'html', 'en', 'index.html'), 'utf-8');
    expect(enIndex).toContain('English Title');
    expect(enIndex).not.toContain('Deutscher Titel');
  });

  it('language subtree RSS and Atom feeds use translated titles and content', async () => {
    const posts = [
      makePost({
        id: 'de-post-1',
        slug: 'german-post',
        title: 'Deutscher Titel',
        content: '# Deutscher Inhalt\n\nDeutscher Body Text',
        language: 'de',
        categories: ['tech'],
        createdAt: new Date('2025-06-10T10:00:00Z'),
        availableLanguages: ['de', 'en'],
      }),
    ];

    const translationFilePath = path.join(tempDir, 'posts', 'german-post.en.md');
    await mkdir(path.join(tempDir, 'posts'), { recursive: true });
    await writeFile(translationFilePath, '---\ntranslationFor: de-post-1\nlanguage: en\ntitle: English Title\n---\n# English Content\n\nEnglish Body Text');

    const translationMap = new Map<string, PostTranslationData[]>();
    translationMap.set('de-post-1', [{
      id: 'en-trans-1',
      projectId: 'test',
      translationFor: 'de-post-1',
      language: 'en',
      title: 'English Title',
      content: '# English Content\n\nEnglish Body Text',
      status: 'published',
      createdAt: new Date('2025-06-10T10:00:00Z'),
      updatedAt: new Date('2025-06-10T10:00:00Z'),
      publishedAt: new Date('2025-06-10T10:00:00Z'),
      filePath: translationFilePath,
    }]);
    mockPostEngine.getPublishedTranslationsForRoutePosts = vi.fn().mockResolvedValue(translationMap);

    await generate(posts, { language: 'de', blogLanguages: ['de', 'en'] });

    // /en/ RSS feed should use English translated title and content
    const enRss = await readFile(path.join(tempDir, 'html', 'en', 'rss.xml'), 'utf-8');
    expect(enRss).toContain('English Title');
    expect(enRss).not.toContain('Deutscher Titel');
    expect(enRss).toContain('English Body Text');
    expect(enRss).not.toContain('Deutscher Body Text');

    // /en/ Atom feed should use English translated title and content
    const enAtom = await readFile(path.join(tempDir, 'html', 'en', 'atom.xml'), 'utf-8');
    expect(enAtom).toContain('English Title');
    expect(enAtom).not.toContain('Deutscher Titel');
    expect(enAtom).toContain('English Body Text');
    expect(enAtom).not.toContain('Deutscher Body Text');

    // Root RSS should keep German canonical content
    const deRss = await readFile(path.join(tempDir, 'html', 'rss.xml'), 'utf-8');
    expect(deRss).toContain('Deutscher Titel');
    expect(deRss).not.toContain('English Title');
  });

  it('generates pagination links in list pages', async () => {
    const posts: PostData[] = [];
    for (let i = 0; i < 4; i++) {
      posts.push(makePost({
        id: `p-${i}`,
        slug: `p-${i}`,
        title: `Post ${i}`,
        tags: ['paginated'],
        createdAt: new Date(`2025-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));
    }

    await generate(posts, { maxPostsPerPage: 2 });

    const page1 = await readFile(path.join(tempDir, 'html', 'tag', 'paginated', 'index.html'), 'utf-8');
    expect(page1).toContain('/tag/paginated/page/2/');

    const page2 = await readFile(path.join(tempDir, 'html', 'tag', 'paginated', 'page', '2', 'index.html'), 'utf-8');
    expect(page2).toContain('/tag/paginated/');
  });
});
