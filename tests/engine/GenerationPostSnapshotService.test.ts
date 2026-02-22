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
});
