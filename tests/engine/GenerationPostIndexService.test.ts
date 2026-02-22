import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  buildGenerationPostIndex,
  estimateGenerationUnitsBySection,
} from '../../src/main/engine/GenerationPostIndexService';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-02T10:00:00.000Z');
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
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

describe('GenerationPostIndexService', () => {
  it('indexes posts by category tag and date partitions', () => {
    const posts = [
      makePost({ id: '1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T00:00:00.000Z') }),
      makePost({ id: '2', categories: ['page'], tags: ['t2'], createdAt: new Date('2025-02-20T00:00:00.000Z') }),
    ];

    const index = buildGenerationPostIndex(posts);

    expect(index.postsByCategory.get('news')?.map((p) => p.id)).toEqual(['1']);
    expect(index.postsByCategory.get('page')?.map((p) => p.id)).toEqual(['2']);
    expect(index.postsByTag.get('t2')?.map((p) => p.id)).toEqual(['2']);
    expect(index.postsByYear.get(2025)?.length).toBe(2);
    expect(index.postsByYearMonth.get('2025/01')?.length).toBe(1);
    expect(index.postsByYearMonthDay.get('2025/02/20')?.length).toBe(1);
  });

  it('estimates generation units per section using indexed counts', () => {
    const posts = [
      makePost({ id: '1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T00:00:00.000Z') }),
      makePost({ id: '2', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-14T00:00:00.000Z') }),
      makePost({ id: '3', categories: ['page'], tags: [], createdAt: new Date('2025-01-13T00:00:00.000Z') }),
    ];

    const index = buildGenerationPostIndex(posts);
    const estimate = estimateGenerationUnitsBySection({
      posts,
      allCategories: new Set(['news', 'page']),
      allTags: new Set(['t1']),
      yearsMap: new Map([[2025, new Date()]]),
      yearMonthsMap: new Map([['2025/01', new Date()]]),
      yearMonthDaysMap: new Map([
        ['2025/01/15', new Date()],
        ['2025/01/14', new Date()],
        ['2025/01/13', new Date()],
      ]),
      maxPostsPerPage: 2,
      postIndex: index,
    });

    expect(estimate.core).toBeGreaterThanOrEqual(4);
    expect(estimate.single).toBe(3);
    expect(estimate.category).toBe(2);
    expect(estimate.tag).toBe(1);
    expect(estimate.date).toBeGreaterThan(0);
  });
});
