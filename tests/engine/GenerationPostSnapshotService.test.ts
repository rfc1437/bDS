import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  loadPublishedGenerationSets,
  type GenerationSnapshotPostEngine,
} from '../../src/main/engine/GenerationPostSnapshotService';

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

function makeEngine(posts: PostData[], snapshotsById: Record<string, PostData | null> = {}): GenerationSnapshotPostEngine {
  return {
    async getPublishedVersion(postId: string): Promise<PostData | null> {
      return snapshotsById[postId] ?? null;
    },
    async getPostsFiltered(filter: { status?: 'draft' | 'published' | 'archived'; excludeCategories?: string[] }): Promise<PostData[]> {
      return posts
        .filter((post) => {
          if (filter.status && post.status !== filter.status) {
            return false;
          }

          if (filter.excludeCategories && filter.excludeCategories.length > 0) {
            const categories = post.categories || [];
            if (categories.some((category) => filter.excludeCategories?.includes(category))) {
              return false;
            }
          }

          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };
}

describe('GenerationPostSnapshotService', () => {
  it('loads published and list snapshots merged from published rows and draft published snapshots', async () => {
    const published = makePost({ id: 'pub-1', status: 'published', categories: ['news'] });
    const draft = makePost({ id: 'draft-1', status: 'draft', categories: ['news'] });
    const draftSnapshot = makePost({ id: 'draft-1', status: 'published', categories: ['news'] });

    const result = await loadPublishedGenerationSets(makeEngine([published, draft], { 'draft-1': draftSnapshot }), []);

    expect(result.publishedPosts).toHaveLength(2);
    expect(result.publishedListPosts).toHaveLength(2);
    expect(result.publishedPosts.map((post) => post.id).sort()).toEqual(['draft-1', 'pub-1']);
  });

  it('excludes list-disabled categories only from list snapshot set', async () => {
    const article = makePost({ id: 'article', status: 'published', categories: ['article'] });
    const page = makePost({ id: 'page', status: 'published', categories: ['page'] });

    const result = await loadPublishedGenerationSets(makeEngine([article, page]), ['page']);

    expect(result.publishedPosts.map((post) => post.id).sort()).toEqual(['article', 'page']);
    expect(result.publishedListPosts.map((post) => post.id)).toEqual(['article']);
  });

  it('uses getPublishedVersionsBulk when available for efficient loading', async () => {
    const published = makePost({ id: 'pub-1', status: 'published', categories: ['news'] });
    const draft = makePost({ id: 'draft-1', status: 'draft', categories: ['news'] });
    const pubSnapshot = makePost({ id: 'pub-1', status: 'published', categories: ['news'], title: 'Snapshot Title' });
    const draftSnapshot = makePost({ id: 'draft-1', status: 'published', categories: ['news'] });

    const engine = makeEngine([published, draft]);
    let individualCallCount = 0;
    engine.getPublishedVersion = async () => {
      individualCallCount++;
      return null;
    };
    engine.getPublishedVersionsBulk = async (ids: string[]) => {
      const map = new Map<string, PostData>();
      if (ids.includes('pub-1')) map.set('pub-1', pubSnapshot);
      if (ids.includes('draft-1')) map.set('draft-1', draftSnapshot);
      return map;
    };

    const result = await loadPublishedGenerationSets(engine, []);

    expect(individualCallCount).toBe(0);
    expect(result.publishedPosts).toHaveLength(2);
    expect(result.publishedPosts.find(p => p.id === 'pub-1')?.title).toBe('Snapshot Title');
  });

  it('uses bulk loading with list-excluded categories filtered in memory', async () => {
    const article = makePost({ id: 'article', status: 'published', categories: ['article'] });
    const page = makePost({ id: 'page', status: 'published', categories: ['page'] });
    const articleSnapshot = makePost({ id: 'article', status: 'published', categories: ['article'], title: 'Article Snap' });
    const pageSnapshot = makePost({ id: 'page', status: 'published', categories: ['page'], title: 'Page Snap' });

    const engine = makeEngine([article, page]);
    engine.getPublishedVersionsBulk = async (ids: string[]) => {
      const map = new Map<string, PostData>();
      if (ids.includes('article')) map.set('article', articleSnapshot);
      if (ids.includes('page')) map.set('page', pageSnapshot);
      return map;
    };

    const result = await loadPublishedGenerationSets(engine, ['page']);

    expect(result.publishedPosts.map(p => p.id).sort()).toEqual(['article', 'page']);
    expect(result.publishedListPosts.map(p => p.id)).toEqual(['article']);
  });

  it('only calls getPostsFiltered twice (published + draft), not four times', async () => {
    const post = makePost({ id: 'p1', status: 'published' });
    const engine = makeEngine([post]);
    let filterCallCount = 0;
    const originalGetPostsFiltered = engine.getPostsFiltered;
    engine.getPostsFiltered = async (filter) => {
      filterCallCount++;
      return originalGetPostsFiltered(filter);
    };

    await loadPublishedGenerationSets(engine, ['some-category']);

    expect(filterCallCount).toBe(2);
  });
});
