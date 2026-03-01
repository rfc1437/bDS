import { describe, expect, it, vi } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  createGenerationRouteRenderer,
  createPreviewBackedGenerationRouteRenderer,
} from '../../src/main/engine/GenerationRouteRendererFactory';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-15T10:00:00.000Z');
  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'project',
    title: overrides.title ?? 'Title',
    slug: overrides.slug ?? 'title',
    excerpt: overrides.excerpt,
    content: overrides.content ?? 'Body',
    status: overrides.status ?? 'published',
    author: overrides.author,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    publishedAt: overrides.publishedAt ?? createdAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

describe('GenerationRouteRendererFactory', () => {
  it('normalizes route keys and memoizes html rendering calls', async () => {
    const renderWithContext = vi.fn().mockResolvedValue('<html>ok</html>');

    const renderRoute = createGenerationRouteRenderer({
      renderWithContext,
      context: {
        projectContext: {
          projectId: 'p',
          dataDir: '/tmp',
          projectName: 'P',
          projectDescription: 'D',
        },
        metadata: {
          name: 'P',
          description: 'D',
        },
        menu: { items: [] },
        maxPostsPerPage: 50,
      },
    });

    const a = await renderRoute('/foo/');
    const b = await renderRoute('/foo');

    expect(a).toBe('<html>ok</html>');
    expect(b).toBe('<html>ok</html>');
    expect(renderWithContext).toHaveBeenCalledTimes(1);
    expect(renderWithContext).toHaveBeenCalledWith('/foo', expect.any(Object));
  });

  it('keeps day archive query caches distinct across different dates', async () => {
    const posts = [
      makePost({
        id: 'day-1',
        slug: 'day-1',
        title: 'Post On Day One',
        createdAt: new Date('2025-01-15T10:00:00.000Z'),
      }),
      makePost({
        id: 'day-2',
        slug: 'day-2',
        title: 'Post On Day Two',
        createdAt: new Date('2025-01-16T10:00:00.000Z'),
      }),
    ];

    const postEngine = {
      getPostsFiltered: vi.fn(async (filter: {
        status?: 'draft' | 'published' | 'archived';
        startDate?: Date;
        endDate?: Date;
        year?: number;
        month?: number;
      }) => {
        let filtered = posts.filter((post) => post.status === (filter.status ?? post.status));

        if (typeof filter.year === 'number') {
          filtered = filtered.filter((post) => post.createdAt.getFullYear() === filter.year);
        }

        if (typeof filter.month === 'number') {
          filtered = filtered.filter((post) => post.createdAt.getMonth() === filter.month - 1);
        }

        if (filter.startDate) {
          filtered = filtered.filter((post) => post.createdAt >= filter.startDate as Date);
        }

        if (filter.endDate) {
          filtered = filtered.filter((post) => post.createdAt <= filter.endDate as Date);
        }

        return filtered;
      }),
      getPublishedVersion: vi.fn(async () => null),
      findPublishedBySlug: vi.fn(async (slug: string) => posts.find((post) => post.slug === slug) ?? null),
      getPost: vi.fn(async (id: string) => posts.find((post) => post.id === id) ?? null),
      hasPublishedVersion: vi.fn(async () => false),
      setProjectContext: vi.fn(),
    };

    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options: {
        projectId: 'project',
        dataDir: '/tmp',
        projectName: 'Project',
      },
      maxPostsPerPage: 50,
      publishedPostsForLookup: posts,
      engines: {
        postEngine,
        mediaEngine: {
          getAllMedia: vi.fn(async () => []),
          setProjectContext: vi.fn(),
        },
        postMediaEngine: {
          setProjectContext: vi.fn(),
          getLinkedMediaForPost: vi.fn(async () => []),
          getLinkedMediaDataForPost: vi.fn(async () => []),
        },
      },
    });

    const dayOneHtml = await renderRoute('/2025/01/15');
    const dayTwoHtml = await renderRoute('/2025/01/16');

    expect(dayOneHtml).toContain('Post On Day One');
    expect(dayOneHtml).not.toContain('Post On Day Two');
    expect(dayTwoHtml).toContain('Post On Day Two');
    expect(dayTwoHtml).not.toContain('Post On Day One');
  });

  it('includes youtube macro spacing styles in preview-backed generated html routes', async () => {
    const post = makePost({
      id: 'youtube-1',
      slug: 'youtube-spacing',
      title: 'YouTube Spacing',
      content: ['Intro paragraph.', '[[youtube id="dQw4w9WgXcQ"]]', 'Paragraph after video.'].join('\n\n'),
      createdAt: new Date('2025-01-15T10:00:00.000Z'),
    });

    const postEngine = {
      getPostsFiltered: vi.fn(async () => [post]),
      getPublishedVersion: vi.fn(async () => null),
      findPublishedBySlug: vi.fn(async (slug: string) => (slug === post.slug ? post : null)),
      getPost: vi.fn(async (id: string) => (id === post.id ? post : null)),
      hasPublishedVersion: vi.fn(async () => false),
      setProjectContext: vi.fn(),
    };

    const renderRoute = createPreviewBackedGenerationRouteRenderer({
      options: {
        projectId: 'project',
        dataDir: '/tmp',
        projectName: 'Project',
      },
      maxPostsPerPage: 50,
      publishedPostsForLookup: [post],
      engines: {
        postEngine,
        mediaEngine: {
          getAllMedia: vi.fn(async () => []),
          setProjectContext: vi.fn(),
        },
        postMediaEngine: {
          setProjectContext: vi.fn(),
          getLinkedMediaForPost: vi.fn(async () => []),
          getLinkedMediaDataForPost: vi.fn(async () => []),
        },
      },
    });

    const html = await renderRoute('/2025/01/15/youtube-spacing');

    expect(html).toContain('class="macro-youtube"');
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ?rel=0');
    expect(html).toContain('/assets/bds.css');
  });
});
