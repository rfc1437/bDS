import { describe, expect, it, vi } from 'vitest';
import {
  createDataBackedPostEngine,
  createDataBackedMediaEngine,
  createDataBackedPostMediaEngine,
} from '../../src/main/engine/DataBackedEngines';
import type { PostData } from '../../src/main/engine/PostEngine';

function makePost(overrides: Partial<PostData> & { id: string; slug: string }): PostData {
  return {
    projectId: 'proj-1',
    title: overrides.slug,
    excerpt: '',
    content: `content of ${overrides.slug}`,
    status: 'published',
    createdAt: new Date('2025-06-15T12:00:00Z'),
    updatedAt: new Date('2025-06-15T12:00:00Z'),
    tags: [],
    categories: [],
    availableLanguages: [],
    ...overrides,
  };
}

describe('DataBackedPostEngine', () => {
  const posts: PostData[] = [
    makePost({ id: '1', slug: 'alpha', tags: ['js', 'node'], categories: ['article'], createdAt: new Date('2025-01-10T00:00:00Z') }),
    makePost({ id: '2', slug: 'beta', tags: ['python'], categories: ['aside'], createdAt: new Date('2025-02-15T00:00:00Z') }),
    makePost({ id: '3', slug: 'gamma', tags: ['js'], categories: ['page'], createdAt: new Date('2025-03-20T00:00:00Z') }),
    makePost({ id: '4', slug: 'delta', tags: ['rust'], categories: ['article'], createdAt: new Date('2024-12-01T00:00:00Z') }),
  ];

  const backlinksMap = new Map([
    ['1', [{ id: '2', title: 'beta', slug: 'beta' }]],
  ]);

  const engine = createDataBackedPostEngine({ allPosts: posts, backlinksMap });

  describe('getPostsFiltered', () => {
    it('returns all posts when no filter applied', async () => {
      const result = await engine.getPostsFiltered({});
      expect(result).toHaveLength(4);
    });

    it('filters by status', async () => {
      const result = await engine.getPostsFiltered({ status: 'published' });
      expect(result).toHaveLength(4);

      const drafts = await engine.getPostsFiltered({ status: 'draft' });
      expect(drafts).toHaveLength(0);
    });

    it('filters by excludeCategories', async () => {
      const result = await engine.getPostsFiltered({ excludeCategories: ['page'] });
      expect(result).toHaveLength(3);
      expect(result.every((p) => !p.categories.includes('page'))).toBe(true);
    });

    it('filters by categories', async () => {
      const result = await engine.getPostsFiltered({ categories: ['article'] });
      expect(result).toHaveLength(2);
    });

    it('filters by tags (all must match)', async () => {
      const result = await engine.getPostsFiltered({ tags: ['js'] });
      expect(result).toHaveLength(2);

      const both = await engine.getPostsFiltered({ tags: ['js', 'node'] });
      expect(both).toHaveLength(1);
      expect(both[0].slug).toBe('alpha');
    });

    it('filters by year', async () => {
      const result = await engine.getPostsFiltered({ year: 2025 });
      expect(result).toHaveLength(3);
    });

    it('filters by year and month', async () => {
      const result = await engine.getPostsFiltered({ year: 2025, month: 2 });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('beta');
    });

    it('filters by date range', async () => {
      const result = await engine.getPostsFiltered({
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-02-28T23:59:59Z'),
      });
      expect(result).toHaveLength(2);
    });

    it('returns sorted by createdAt descending', async () => {
      const result = await engine.getPostsFiltered({});
      const dates = result.map((p) => p.createdAt.getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('excludes translation variants from filtered results', async () => {
      const canonical = makePost({ id: 'c1', slug: 'hello', content: 'Hello content', language: 'de' });
      const variant = makePost({
        id: 'v1',
        slug: 'hello.en',
        content: 'Hello EN content',
        language: 'en',
        translationSourceSlug: 'hello',
      } as any);

      const eng = createDataBackedPostEngine({ allPosts: [canonical, variant] });
      const result = await eng.getPostsFiltered({ status: 'published' });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('hello');
    });

    it('translation variants remain accessible via findPublishedBySlug', async () => {
      const canonical = makePost({ id: 'c1', slug: 'hello', content: 'Hello content', language: 'de' });
      const variant = makePost({
        id: 'v1',
        slug: 'hello.en',
        content: 'Hello EN content',
        language: 'en',
        translationSourceSlug: 'hello',
      } as any);

      const eng = createDataBackedPostEngine({ allPosts: [canonical, variant] });
      const found = await eng.findPublishedBySlug('hello.en');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('v1');
    });

    it('includes resolved posts (slug === translationSourceSlug) in filtered results', async () => {
      // A resolved post is a canonical post with its title/excerpt replaced by a translation.
      // Its slug remains the same as translationSourceSlug (e.g., both are "hello").
      const resolved = makePost({
        id: 'r1',
        slug: 'hello',
        title: 'Hallo (übersetzt)',
        language: 'en',
        translationSourceSlug: 'hello',
      } as any);
      const unresolved = makePost({
        id: 'r2',
        slug: 'world',
        title: 'Welt',
        language: 'de',
      });

      const eng = createDataBackedPostEngine({ allPosts: [resolved, unresolved] });
      const result = await eng.getPostsFiltered({ status: 'published' });
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.slug).sort()).toEqual(['hello', 'world']);
    });

    it('lazy-loads translation content for resolved posts returned by getPostsFiltered', async () => {
      const resolved = makePost({
        id: 'lz-1',
        slug: 'lazy-post',
        title: 'Translated Title',
        content: '',
        language: 'en',
        translationSourceSlug: 'lazy-post',
        translationFilePath: '/data/posts/2025/06/lazy-post.en.md',
      } as any);

      const readTranslationSpy = vi.spyOn(await import('../../src/main/engine/postTranslationFileUtils'), 'readPostTranslationFile');
      readTranslationSpy.mockResolvedValueOnce({
        translationFor: 'lz-1',
        language: 'en',
        title: 'Translated Title',
        content: 'Lazy loaded translation content!',
      });

      const eng = createDataBackedPostEngine({
        allPosts: [resolved],
        postFilePaths: new Map(),
      });

      const result = await eng.getPostsFiltered({ status: 'published' });
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Lazy loaded translation content!');
      expect(readTranslationSpy).toHaveBeenCalledWith('/data/posts/2025/06/lazy-post.en.md');

      readTranslationSpy.mockRestore();
    });
  });

  describe('lookup methods', () => {
    it('getPublishedVersion returns by id', async () => {
      const post = await engine.getPublishedVersion('2');
      expect(post?.slug).toBe('beta');
    });

    it('getPublishedVersion returns null for unknown id', async () => {
      expect(await engine.getPublishedVersion('unknown')).toBeNull();
    });

    it('getPost returns by id', async () => {
      const post = await engine.getPost('3');
      expect(post?.slug).toBe('gamma');
    });

    it('hasPublishedVersion checks existence', async () => {
      expect(await engine.hasPublishedVersion('1')).toBe(true);
      expect(await engine.hasPublishedVersion('nope')).toBe(false);
    });

    it('findPublishedBySlug returns first match without date filter', async () => {
      const post = await engine.findPublishedBySlug('alpha');
      expect(post?.id).toBe('1');
    });

    it('findPublishedBySlug returns null for unknown slug', async () => {
      expect(await engine.findPublishedBySlug('nope')).toBeNull();
    });

    it('findPublishedBySlug applies date filter', async () => {
      const match = await engine.findPublishedBySlug('alpha', { year: 2025, month: 1 });
      expect(match?.id).toBe('1');

      const noMatch = await engine.findPublishedBySlug('alpha', { year: 2024, month: 1 });
      expect(noMatch).toBeNull();
    });
  });

  describe('backlinks', () => {
    it('getLinkedBy returns backlinks for a post', async () => {
      const links = await engine.getLinkedBy('1');
      expect(links).toEqual([{ id: '2', title: 'beta', slug: 'beta' }]);
    });

    it('getLinkedBy returns empty for unlinked post', async () => {
      const links = await engine.getLinkedBy('3');
      expect(links).toEqual([]);
    });

    it('getAllBacklinks returns the full map', async () => {
      const map = await engine.getAllBacklinks();
      expect(map.size).toBe(1);
      expect(map.get('1')).toHaveLength(1);
    });
  });

  describe('translations (stubs)', () => {
    it('getPostTranslation returns null', async () => {
      expect(await engine.getPostTranslation('1', 'fr')).toBeNull();
    });

    it('getPostTranslations returns empty array', async () => {
      expect(await engine.getPostTranslations('1')).toEqual([]);
    });
  });

  describe('setProjectContext is a no-op', () => {
    it('does not throw', () => {
      expect(() => engine.setProjectContext('proj-1', '/data')).not.toThrow();
    });
  });

  describe('getPublishedVersion with lazy FS content loading', () => {
    it('reads content from filesystem when post has no content and filePath is available', async () => {
      const emptyContentPost = makePost({ id: 'fs-1', slug: 'fs-post', content: '' });
      const postFilePaths = new Map([['fs-1', '/data/posts/2025/06/fs-post.md']]);

      const { readPostFile } = await import('../../src/main/engine/postFileUtils');
      const readPostFileSpy = vi.spyOn(await import('../../src/main/engine/postFileUtils'), 'readPostFile');
      readPostFileSpy.mockResolvedValueOnce({
        id: 'fs-1',
        title: 'FS Post',
        slug: 'fs-post',
        content: 'Content loaded from filesystem!',
        status: 'published',
        createdAt: new Date('2025-06-15'),
        updatedAt: new Date('2025-06-15'),
        tags: [],
        categories: [],
      });

      const fsEngine = createDataBackedPostEngine({
        allPosts: [emptyContentPost],
        postFilePaths,
      });

      const result = await fsEngine.getPublishedVersion('fs-1');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Content loaded from filesystem!');
      expect(readPostFileSpy).toHaveBeenCalledWith('/data/posts/2025/06/fs-post.md');

      readPostFileSpy.mockRestore();
    });

    it('does not read from FS when post already has content', async () => {
      const postWithContent = makePost({ id: 'has-c', slug: 'has-content', content: 'Already here' });
      const postFilePaths = new Map([['has-c', '/data/posts/2025/06/has-content.md']]);

      const readPostFileSpy = vi.spyOn(await import('../../src/main/engine/postFileUtils'), 'readPostFile');

      const fsEngine = createDataBackedPostEngine({
        allPosts: [postWithContent],
        postFilePaths,
      });

      const result = await fsEngine.getPublishedVersion('has-c');
      expect(result!.content).toBe('Already here');
      expect(readPostFileSpy).not.toHaveBeenCalled();

      readPostFileSpy.mockRestore();
    });

    it('reads translation content from translationFilePath', async () => {
      const translationPost = makePost({ id: 'tr-1', slug: 'post.fr', content: '' });
      (translationPost as any).translationFilePath = '/data/posts/2025/06/post.fr.md';

      const readTranslationSpy = vi.spyOn(await import('../../src/main/engine/postTranslationFileUtils'), 'readPostTranslationFile');
      readTranslationSpy.mockResolvedValueOnce({
        translationFor: 'original-id',
        language: 'fr',
        title: 'Post FR',
        content: 'Contenu fran\u00e7ais!',
      });

      const fsEngine = createDataBackedPostEngine({
        allPosts: [translationPost],
        postFilePaths: new Map(),
      });

      const result = await fsEngine.getPublishedVersion('tr-1');
      expect(result!.content).toBe('Contenu fran\u00e7ais!');
      expect(readTranslationSpy).toHaveBeenCalledWith('/data/posts/2025/06/post.fr.md');

      readTranslationSpy.mockRestore();
    });
  });

  describe('getPost with lazy FS content loading', () => {
    it('reads content from filesystem when post has no content', async () => {
      const emptyContentPost = makePost({ id: 'gp-1', slug: 'gp-post', content: '' });
      const postFilePaths = new Map([['gp-1', '/data/posts/2025/06/gp-post.md']]);

      const readPostFileSpy = vi.spyOn(await import('../../src/main/engine/postFileUtils'), 'readPostFile');
      readPostFileSpy.mockResolvedValueOnce({
        id: 'gp-1',
        title: 'GP Post',
        slug: 'gp-post',
        content: 'Content via getPost!',
        status: 'published',
        createdAt: new Date('2025-06-15'),
        updatedAt: new Date('2025-06-15'),
        tags: [],
        categories: [],
      });

      const fsEngine = createDataBackedPostEngine({
        allPosts: [emptyContentPost],
        postFilePaths,
      });

      const result = await fsEngine.getPost('gp-1');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Content via getPost!');
      expect(readPostFileSpy).toHaveBeenCalledWith('/data/posts/2025/06/gp-post.md');

      readPostFileSpy.mockRestore();
    });
  });
});

describe('DataBackedMediaEngine', () => {
  const mediaItems: import('../../src/main/engine/MediaEngine').MediaData[] = [
    {
      id: 'm1', filename: 'photo.jpg', originalName: 'my-photo.jpg',
      mimeType: 'image/jpeg', size: 12345, width: 800, height: 600,
      title: 'Beach', alt: 'Beach photo', caption: 'A sunny beach',
      author: 'Alice', language: 'en',
      createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02'),
      tags: ['nature', 'beach'], linkedPostIds: ['p1', 'p2'], availableLanguages: ['en', 'de'],
    },
    {
      id: 'm2', filename: 'doc.pdf', originalName: 'document.pdf',
      mimeType: 'application/pdf', size: 99999,
      createdAt: new Date('2025-02-01'), updatedAt: new Date('2025-02-01'),
      tags: [], availableLanguages: [],
    },
  ];

  const engine = createDataBackedMediaEngine(mediaItems);

  it('getAllMedia returns all items with full MediaData fields', async () => {
    const result = await engine.getAllMedia();
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('photo.jpg');
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].size).toBe(12345);
    expect(result[0].width).toBe(800);
    expect(result[0].height).toBe(600);
    expect(result[0].title).toBe('Beach');
    expect(result[0].alt).toBe('Beach photo');
    expect(result[0].caption).toBe('A sunny beach');
    expect(result[0].author).toBe('Alice');
    expect(result[0].language).toBe('en');
    expect(result[0].tags).toEqual(['nature', 'beach']);
    expect(result[0].linkedPostIds).toEqual(['p1', 'p2']);
    expect(result[0].availableLanguages).toEqual(['en', 'de']);
  });

  it('setProjectContext is a no-op', () => {
    expect(() => engine.setProjectContext('proj-1')).not.toThrow();
  });
});

describe('DataBackedPostMediaEngine', () => {
  const mediaItems: import('../../src/main/engine/MediaEngine').MediaData[] = [
    {
      id: 'm1', filename: 'photo.jpg', originalName: 'my-photo.jpg',
      mimeType: 'image/jpeg', size: 12345, width: 800, height: 600,
      title: 'Beach', alt: 'Beach photo', caption: 'A sunny beach',
      createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02'),
      tags: ['nature'], linkedPostIds: ['p1'], availableLanguages: [],
    },
    {
      id: 'm2', filename: 'sunset.png', originalName: 'sunset.png',
      mimeType: 'image/png', size: 5555,
      createdAt: new Date('2025-02-01'), updatedAt: new Date('2025-02-01'),
      tags: [], linkedPostIds: ['p1'], availableLanguages: [],
    },
    {
      id: 'm3', filename: 'doc.pdf', originalName: 'document.pdf',
      mimeType: 'application/pdf', size: 99999,
      createdAt: new Date('2025-03-01'), updatedAt: new Date('2025-03-01'),
      tags: [], availableLanguages: [],
    },
  ];

  // Post p1 is linked to m1 (sort 0) and m2 (sort 1)
  const postMediaLinks = new Map<string, Array<{ mediaId: string; sortOrder: number }>>([
    ['p1', [{ mediaId: 'm1', sortOrder: 0 }, { mediaId: 'm2', sortOrder: 1 }]],
  ]);

  const engine = createDataBackedPostMediaEngine({ mediaItems, postMediaLinks });

  it('getLinkedMediaForPost returns links for a post', async () => {
    const result = await engine.getLinkedMediaForPost('p1');
    expect(result).toHaveLength(2);
    expect(result[0].mediaId).toBe('m1');
    expect(result[1].mediaId).toBe('m2');
  });

  it('getLinkedMediaForPost returns empty for unknown post', async () => {
    const result = await engine.getLinkedMediaForPost('unknown');
    expect(result).toEqual([]);
  });

  it('getLinkedMediaDataForPost returns links with full media data', async () => {
    const result = await engine.getLinkedMediaDataForPost('p1');
    expect(result).toHaveLength(2);
    expect(result[0].media.id).toBe('m1');
    expect(result[0].media.mimeType).toBe('image/jpeg');
    expect(result[0].media.caption).toBe('A sunny beach');
    expect(result[1].media.id).toBe('m2');
    expect(result[1].media.mimeType).toBe('image/png');
  });

  it('getLinkedMediaDataForPost returns empty for unknown post', async () => {
    const result = await engine.getLinkedMediaDataForPost('unknown');
    expect(result).toEqual([]);
  });

  it('setProjectContext is a no-op', () => {
    expect(() => engine.setProjectContext('proj-1')).not.toThrow();
  });
});
