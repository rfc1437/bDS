/**
 * Unit tests for ai/blog-tools.ts — 16 blog data tools.
 * Tests exercise the real createBlogTools() with mocked engine dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlogTools, buildAmbiguityHints, type BlogToolDeps } from '../../src/main/engine/ai/blog-tools';

// ---------------------------------------------------------------------------
// Mock factory — creates a BlogToolDeps with all methods stubbed
// ---------------------------------------------------------------------------

function createMockDeps(): BlogToolDeps {
  return {
    postEngine: {
      getPost: vi.fn(),
      getAllPosts: vi.fn(),
      getPostsFiltered: vi.fn(),
      searchPostsFiltered: vi.fn(),
      getPostCounts: vi.fn(),
      getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
      getTagsWithCounts: vi.fn().mockResolvedValue([]),
      getLinkedBy: vi.fn().mockResolvedValue([]),
      getLinksTo: vi.fn().mockResolvedValue([]),
      updatePost: vi.fn(),
      getBlogStats: vi.fn(),
      getDashboardStats: vi.fn(),
    },
    mediaEngine: {
      getMedia: vi.fn(),
      getAllMedia: vi.fn(),
      getMediaFiltered: vi.fn(),
      updateMedia: vi.fn(),
      getThumbnailDataUrl: vi.fn(),
    },
    postMediaEngine: {
      getLinkedMediaDataForPost: vi.fn().mockResolvedValue([]),
      getLinkedPostsForMedia: vi.fn().mockResolvedValue([]),
    },
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const samplePost = {
  id: 'post-1', projectId: 'proj-1', title: 'Hello World', slug: 'hello-world',
  excerpt: 'A first post', content: '# Hello\n\nWorld', status: 'published' as const,
  author: 'gb', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02'),
  tags: ['intro'], categories: ['article'],
};

const sampleMedia = {
  id: 'media-1', filename: 'photo.webp', originalName: 'photo.jpg',
  mimeType: 'image/webp', size: 12345, width: 800, height: 600,
  title: 'Photo', alt: 'A photo', caption: 'Nice photo',
  author: 'gb', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02'),
  tags: ['landscape'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Blog Tools — createBlogTools', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns all 17 tools', () => {
    const names = Object.keys(tools);
    expect(names).toHaveLength(17);
    expect(names).toContain('check_term');
    expect(names).toContain('search_posts');
    expect(names).toContain('read_post');
    expect(names).toContain('list_posts');
    expect(names).toContain('get_media');
    expect(names).toContain('list_media');
    expect(names).toContain('update_post_metadata');
    expect(names).toContain('update_media_metadata');
    expect(names).toContain('list_tags');
    expect(names).toContain('list_categories');
    expect(names).toContain('count_posts');
    expect(names).toContain('get_blog_stats');
    expect(names).toContain('view_image');
    expect(names).toContain('get_post_backlinks');
    expect(names).toContain('get_post_outlinks');
    expect(names).toContain('get_post_media');
    expect(names).toContain('get_media_posts');
  });

  it('each tool has description and inputSchema', () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} missing description`).toBeTruthy();
      expect(t.inputSchema, `${name} missing inputSchema`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// check_term
// ---------------------------------------------------------------------------

describe('Blog Tools — check_term', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('finds a term as both category and tag', async () => {
    vi.mocked(deps.postEngine.getCategoriesWithCounts).mockResolvedValueOnce([
      { category: 'Travel', count: 5 },
    ]);
    vi.mocked(deps.postEngine.getTagsWithCounts).mockResolvedValueOnce([
      { tag: 'travel', count: 3 },
    ]);

    const result = await tools.check_term.execute!({ term: 'travel' }, { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal });
    expect(result).toEqual({
      success: true,
      term: 'travel',
      asCategory: true,
      categoryPostCount: 5,
      asTag: true,
      tagPostCount: 3,
    });
  });

  it('returns false when term not found', async () => {
    const result = await tools.check_term.execute!({ term: 'nonexistent' }, { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal });
    expect(result).toMatchObject({
      success: true,
      asCategory: false,
      categoryPostCount: 0,
      asTag: false,
      tagPostCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// search_posts
// ---------------------------------------------------------------------------

describe('Blog Tools — search_posts', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns error when month without year', async () => {
    const result = await tools.search_posts.execute!(
      { query: 'test', month: 3 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('month requires year') });
  });

  it('calls searchPostsFiltered with correct filter', async () => {
    vi.mocked(deps.postEngine.searchPostsFiltered).mockResolvedValueOnce({ posts: [samplePost], total: 5 });

    const result = await tools.search_posts.execute!(
      { query: 'hello', category: 'article', year: 2025 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.searchPostsFiltered).toHaveBeenCalledWith(
      'hello',
      { categories: ['article'], year: 2025 },
      { offset: 0, limit: 10 },
    );
    expect(result).toMatchObject({ success: true, count: 1, totalMatches: 5, hasMore: false });
  });

  it('includes ambiguity hints when category also exists as tag', async () => {
    vi.mocked(deps.postEngine.searchPostsFiltered).mockResolvedValueOnce({ posts: [], total: 0 });
    vi.mocked(deps.postEngine.getTagsWithCounts).mockResolvedValueOnce([
      { tag: 'article', count: 2 },
    ]);

    const result = await tools.search_posts.execute!(
      { query: 'test', category: 'article' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toHaveProperty('hints');
    expect((result as Record<string, unknown>).hints).toEqual(
      expect.arrayContaining([expect.stringContaining('also exists as a tag')]),
    );
  });
});

// ---------------------------------------------------------------------------
// read_post
// ---------------------------------------------------------------------------

describe('Blog Tools — read_post', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns post with backlinks and outlinks', async () => {
    vi.mocked(deps.postEngine.getPost).mockResolvedValueOnce(samplePost);
    vi.mocked(deps.postEngine.getLinkedBy).mockResolvedValueOnce([
      { id: 'post-2', title: 'Related', slug: 'related' },
    ]);

    const result = await tools.read_post.execute!(
      { postId: 'post-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({
      success: true,
      post: {
        id: 'post-1',
        title: 'Hello World',
        content: '# Hello\n\nWorld',
        backlinks: [{ id: 'post-2', title: 'Related' }],
      },
    });
  });

  it('returns error for nonexistent post', async () => {
    vi.mocked(deps.postEngine.getPost).mockResolvedValueOnce(null);
    const result = await tools.read_post.execute!(
      { postId: 'nope' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: 'Post not found' });
  });
});

// ---------------------------------------------------------------------------
// list_posts
// ---------------------------------------------------------------------------

describe('Blog Tools — list_posts', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns error when month without year', async () => {
    const result = await tools.list_posts.execute!(
      { month: 6 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('month requires year') });
  });

  it('uses getAllPosts when no filters', async () => {
    vi.mocked(deps.postEngine.getDashboardStats).mockResolvedValueOnce({
      totalPosts: 100, draftCount: 10, publishedCount: 85, archivedCount: 5,
    });
    vi.mocked(deps.postEngine.getAllPosts).mockResolvedValueOnce({
      items: [samplePost], total: 100, hasMore: true,
    });

    const result = await tools.list_posts.execute!(
      {},
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.getAllPosts).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(result).toMatchObject({ success: true, total: 100, filteredTotal: 100 });
  });

  it('uses getPostsFiltered when filters present', async () => {
    vi.mocked(deps.postEngine.getDashboardStats).mockResolvedValueOnce({
      totalPosts: 100, draftCount: 10, publishedCount: 85, archivedCount: 5,
    });
    vi.mocked(deps.postEngine.getPostsFiltered).mockResolvedValueOnce([samplePost]);

    const result = await tools.list_posts.execute!(
      { status: 'published', year: 2025 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.getPostsFiltered).toHaveBeenCalledWith({
      status: 'published', year: 2025,
    });
    expect(result).toMatchObject({ success: true, filteredTotal: 1 });
  });
});

// ---------------------------------------------------------------------------
// get_media / list_media
// ---------------------------------------------------------------------------

describe('Blog Tools — get_media', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns media metadata', async () => {
    vi.mocked(deps.mediaEngine.getMedia).mockResolvedValueOnce(sampleMedia);
    const result = await tools.get_media.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, media: { id: 'media-1', filename: 'photo.webp' } });
  });

  it('returns error for missing media', async () => {
    vi.mocked(deps.mediaEngine.getMedia).mockResolvedValueOnce(null);
    const result = await tools.get_media.execute!(
      { mediaId: 'nope' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: 'Media not found' });
  });
});

describe('Blog Tools — list_media', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns all media when no filters', async () => {
    vi.mocked(deps.mediaEngine.getAllMedia).mockResolvedValueOnce([sampleMedia]);
    const result = await tools.list_media.execute!(
      {},
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, total: 1 });
  });

  it('filters by MIME type', async () => {
    const pdfMedia = { ...sampleMedia, id: 'media-2', mimeType: 'application/pdf' };
    vi.mocked(deps.mediaEngine.getAllMedia).mockResolvedValueOnce([sampleMedia, pdfMedia]);
    const result = await tools.list_media.execute!(
      { mimeTypeFilter: 'image/' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, filteredTotal: 1, total: 2 });
  });

  it('uses getMediaFiltered when year is provided', async () => {
    vi.mocked(deps.mediaEngine.getMediaFiltered).mockResolvedValueOnce([sampleMedia]);
    await tools.list_media.execute!(
      { year: 2025 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.mediaEngine.getMediaFiltered).toHaveBeenCalledWith({ year: 2025 });
  });

  it('returns error when month without year', async () => {
    const result = await tools.list_media.execute!(
      { month: 3 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('month requires year') });
  });
});

// ---------------------------------------------------------------------------
// update_post_metadata / update_media_metadata
// ---------------------------------------------------------------------------

describe('Blog Tools — update_post_metadata', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('calls updatePost with provided fields', async () => {
    await tools.update_post_metadata.execute!(
      { postId: 'post-1', title: 'New Title', tags: ['updated'] },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.updatePost).toHaveBeenCalledWith('post-1', { title: 'New Title', tags: ['updated'] });
  });

  it('returns error when no updates provided', async () => {
    const result = await tools.update_post_metadata.execute!(
      { postId: 'post-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: 'No updates provided' });
  });
});

describe('Blog Tools — update_media_metadata', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('calls updateMedia with provided fields', async () => {
    await tools.update_media_metadata.execute!(
      { mediaId: 'media-1', alt: 'New alt', tags: ['nature'] },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.mediaEngine.updateMedia).toHaveBeenCalledWith('media-1', { alt: 'New alt', tags: ['nature'] });
  });

  it('returns error when no updates provided', async () => {
    const result = await tools.update_media_metadata.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: 'No updates provided' });
  });
});

// ---------------------------------------------------------------------------
// count_posts
// ---------------------------------------------------------------------------

describe('Blog Tools — count_posts', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('calls getPostCounts with groupBy and filters', async () => {
    vi.mocked(deps.postEngine.getPostCounts).mockResolvedValueOnce({
      groups: [
        { month: 1, tag: 'Politik', count: 12 },
        { month: 2, tag: 'Politik', count: 5 },
      ],
      totalPosts: 200,
    });

    const result = await tools.count_posts.execute!(
      { groupBy: ['month', 'tag'], year: 2004 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.getPostCounts).toHaveBeenCalledWith(
      ['month', 'tag'],
      { year: 2004 },
    );
    expect(result).toMatchObject({
      success: true,
      totalPosts: 200,
      groupCount: 2,
    });
    expect((result as any).groups).toHaveLength(2);
  });

  it('passes all optional filters', async () => {
    vi.mocked(deps.postEngine.getPostCounts).mockResolvedValueOnce({
      groups: [],
      totalPosts: 0,
    });

    await tools.count_posts.execute!(
      { groupBy: ['status'], year: 2024, month: 6, status: 'published', category: 'tech', tags: ['js'] },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(deps.postEngine.getPostCounts).toHaveBeenCalledWith(
      ['status'],
      { year: 2024, month: 6, status: 'published', category: 'tech', tags: ['js'] },
    );
  });

  it('returns error when month without year', async () => {
    const result = await tools.count_posts.execute!(
      { groupBy: ['tag'], month: 3 },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('month requires year') });
  });
});

// ---------------------------------------------------------------------------
// list_tags / list_categories
// ---------------------------------------------------------------------------

describe('Blog Tools — list_tags & list_categories', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('list_tags returns tags with counts', async () => {
    vi.mocked(deps.postEngine.getTagsWithCounts).mockResolvedValueOnce([
      { tag: 'travel', count: 10 },
      { tag: 'food', count: 5 },
    ]);
    const result = await tools.list_tags.execute!({}, { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal });
    expect(result).toMatchObject({ success: true, count: 2 });
  });

  it('list_categories returns categories with counts', async () => {
    vi.mocked(deps.postEngine.getCategoriesWithCounts).mockResolvedValueOnce([
      { category: 'article', count: 20 },
    ]);
    const result = await tools.list_categories.execute!({}, { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal });
    expect(result).toMatchObject({ success: true, count: 1 });
  });
});

// ---------------------------------------------------------------------------
// get_blog_stats
// ---------------------------------------------------------------------------

describe('Blog Tools — get_blog_stats', () => {
  it('returns comprehensive stats', async () => {
    const deps = createMockDeps();
    const tools = createBlogTools(deps);

    vi.mocked(deps.postEngine.getBlogStats).mockResolvedValueOnce({
      totalPosts: 50, draftCount: 5, publishedCount: 40, archivedCount: 5,
      oldestPostDate: new Date('2020-01-01'), newestPostDate: new Date('2025-06-01'),
      postsPerYear: { 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10 },
      tagCount: 25, categoryCount: 4,
    });
    vi.mocked(deps.mediaEngine.getAllMedia).mockResolvedValueOnce([sampleMedia, sampleMedia]);

    const result = await tools.get_blog_stats.execute!({}, { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal });
    expect(result).toMatchObject({
      success: true,
      totalPosts: 50,
      totalMedia: 2,
      tagCount: 25,
    });
  });
});

// ---------------------------------------------------------------------------
// view_image
// ---------------------------------------------------------------------------

describe('Blog Tools — view_image', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('returns base64 image data', async () => {
    vi.mocked(deps.mediaEngine.getMedia).mockResolvedValueOnce(sampleMedia);
    vi.mocked(deps.mediaEngine.getThumbnailDataUrl).mockResolvedValueOnce(
      'data:image/webp;base64,iVBORw0KGgo',
    );

    const result = await tools.view_image.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({
      __isImageResult: true,
      success: true,
      base64: 'iVBORw0KGgo',
      mediaType: 'image/webp',
    });
  });

  it('rejects non-image media', async () => {
    vi.mocked(deps.mediaEngine.getMedia).mockResolvedValueOnce({
      ...sampleMedia, mimeType: 'application/pdf',
    });
    const result = await tools.view_image.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Only images') });
  });

  it('returns error when thumbnail unavailable', async () => {
    vi.mocked(deps.mediaEngine.getMedia).mockResolvedValueOnce(sampleMedia);
    vi.mocked(deps.mediaEngine.getThumbnailDataUrl).mockResolvedValueOnce(null);
    const result = await tools.view_image.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Thumbnail not available') });
  });
});

// ---------------------------------------------------------------------------
// Link tools
// ---------------------------------------------------------------------------

describe('Blog Tools — link tools', () => {
  let deps: BlogToolDeps;
  let tools: ReturnType<typeof createBlogTools>;

  beforeEach(() => {
    deps = createMockDeps();
    tools = createBlogTools(deps);
  });

  it('get_post_backlinks returns linked-by posts', async () => {
    vi.mocked(deps.postEngine.getLinkedBy).mockResolvedValueOnce([
      { id: 'post-2', title: 'Ref', slug: 'ref' },
    ]);
    const result = await tools.get_post_backlinks.execute!(
      { postId: 'post-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, linkedBy: [{ id: 'post-2' }] });
  });

  it('get_post_outlinks returns links-to posts', async () => {
    vi.mocked(deps.postEngine.getLinksTo).mockResolvedValueOnce([
      { id: 'post-3', title: 'Target', slug: 'target' },
    ]);
    const result = await tools.get_post_outlinks.execute!(
      { postId: 'post-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, linksTo: [{ id: 'post-3' }] });
  });

  it('get_post_media returns linked media', async () => {
    vi.mocked(deps.postMediaEngine.getLinkedMediaDataForPost).mockResolvedValueOnce([{
      id: 'link-1', projectId: 'proj-1', postId: 'post-1', mediaId: 'media-1',
      sortOrder: 0, createdAt: new Date(),
      media: sampleMedia,
    }]);
    const result = await tools.get_post_media.execute!(
      { postId: 'post-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, media: [{ id: 'media-1' }] });
  });

  it('get_media_posts returns linked posts', async () => {
    vi.mocked(deps.postMediaEngine.getLinkedPostsForMedia).mockResolvedValueOnce([{
      id: 'link-1', projectId: 'proj-1', postId: 'post-1', mediaId: 'media-1',
      sortOrder: 0, createdAt: new Date(),
    }]);
    vi.mocked(deps.postEngine.getPost).mockResolvedValueOnce(samplePost);

    const result = await tools.get_media_posts.execute!(
      { mediaId: 'media-1' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ success: true, count: 1, posts: [{ id: 'post-1' }] });
  });
});

// ---------------------------------------------------------------------------
// buildAmbiguityHints (shared helper)
// ---------------------------------------------------------------------------

describe('buildAmbiguityHints', () => {
  it('returns hint when category also exists as tag', async () => {
    const engine = {
      getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
      getTagsWithCounts: vi.fn().mockResolvedValue([{ tag: 'travel', count: 3 }]),
    };
    const hints = await buildAmbiguityHints(engine, 'travel', undefined);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('also exists as a tag');
  });

  it('returns hint when tag also exists as category', async () => {
    const engine = {
      getCategoriesWithCounts: vi.fn().mockResolvedValue([{ category: 'photo', count: 5 }]),
      getTagsWithCounts: vi.fn().mockResolvedValue([]),
    };
    const hints = await buildAmbiguityHints(engine, undefined, ['photo']);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('also exists as a category');
  });

  it('returns empty when no overlaps', async () => {
    const engine = {
      getCategoriesWithCounts: vi.fn().mockResolvedValue([{ category: 'article', count: 10 }]),
      getTagsWithCounts: vi.fn().mockResolvedValue([{ tag: 'travel', count: 3 }]),
    };
    const hints = await buildAmbiguityHints(engine, 'article', ['travel']);
    expect(hints).toHaveLength(0);
  });

  it('returns empty when no category or tags given', async () => {
    const engine = {
      getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
      getTagsWithCounts: vi.fn().mockResolvedValue([]),
    };
    const hints = await buildAmbiguityHints(engine, undefined, undefined);
    expect(hints).toHaveLength(0);
  });
});
