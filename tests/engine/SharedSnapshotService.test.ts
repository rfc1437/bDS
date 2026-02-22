import { describe, expect, it, vi } from 'vitest';
import type { PostData, PostFilter } from '../../src/main/engine/PostEngine';
import {
  findSinglePostBySlug,
  loadPostsForDayPage,
  loadPublishedSnapshotsPage,
  type SharedSnapshotPostEngine,
} from '../../src/main/engine/SharedSnapshotService';

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

function makeEngine(posts: PostData[], snapshotsById: Record<string, PostData | null> = {}): SharedSnapshotPostEngine {
  const byId = new Map(posts.map((post) => [post.id, post]));

  return {
    async getPost(id: string): Promise<PostData | null> {
      return byId.get(id) ?? null;
    },
    async getPublishedVersion(id: string): Promise<PostData | null> {
      return snapshotsById[id] ?? null;
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
        result = result.filter((post) => post.createdAt.getFullYear() === filter.year);
      }

      if (filter.month !== undefined && filter.year !== undefined) {
        result = result.filter((post) => post.createdAt.getMonth() === filter.month);
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

describe('SharedSnapshotService', () => {
  it('loads published snapshots merged from published and draft rows', async () => {
    const published = makePost({ id: 'p1', slug: 'published-1', status: 'published' });
    const draft = makePost({ id: 'd1', slug: 'draft-1', status: 'draft' });
    const draftPublishedSnapshot = makePost({ id: 'd1', slug: 'draft-1', status: 'published' });

    const engine = makeEngine([published, draft], { d1: draftPublishedSnapshot });

    const result = await loadPublishedSnapshotsPage(engine, { status: 'published' }, { maxPostsPerPage: 50, page: 1 });

    expect(result.totalPosts).toBe(2);
    expect(result.posts.map((post) => post.id).sort()).toEqual(['d1', 'p1']);
  });

  it('loads day page strictly for given day', async () => {
    const dayA = makePost({ id: 'a', slug: 'a', createdAt: new Date('2025-01-15T10:00:00.000Z') });
    const dayB = makePost({ id: 'b', slug: 'b', createdAt: new Date('2025-01-16T10:00:00.000Z') });
    const engine = makeEngine([dayA, dayB]);

    const result = await loadPostsForDayPage(engine, 2025, 1, 15, { maxPostsPerPage: 50, page: 1 });

    expect(result.totalPosts).toBe(1);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.id).toBe('a');
  });

  it('prefers matching draft post when draft preview options are provided', async () => {
    const draft = makePost({ id: 'draft-1', slug: 'my-post', status: 'draft', createdAt: new Date('2025-03-21T10:00:00.000Z') });
    const published = makePost({ id: 'pub-1', slug: 'my-post', status: 'published', createdAt: new Date('2025-03-20T10:00:00.000Z') });
    const engine = makeEngine([published, draft]);

    const result = await findSinglePostBySlug(
      engine,
      'my-post',
      { useDraftContent: true, draftPostId: 'draft-1' },
      { year: 2025, month: 2, day: 21 },
    );

    expect(result?.id).toBe('draft-1');
  });

  it('uses findPublishedBySlug shortcut when present', async () => {
    const post = makePost({ id: 'x1', slug: 'shortcut', status: 'published' });
    const engine = makeEngine([post]);
    const findPublishedBySlug = vi.fn(async () => post);
    const engineWithShortcut: SharedSnapshotPostEngine = {
      ...engine,
      findPublishedBySlug,
    };

    const result = await findSinglePostBySlug(engineWithShortcut, 'shortcut', undefined, { year: 2025, month: 0, day: 2 });

    expect(result?.id).toBe('x1');
    expect(findPublishedBySlug).toHaveBeenCalled();
  });
});
