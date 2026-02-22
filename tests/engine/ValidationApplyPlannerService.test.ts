import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  buildTargetedValidationPlan,
  planMissingValidationPaths,
} from '../../src/main/engine/ValidationApplyPlannerService';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-15T10:00:00.000Z');
  const updatedAt = overrides.updatedAt ?? createdAt;

  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'default',
    title: overrides.title ?? 'Title',
    slug: overrides.slug ?? 'title',
    excerpt: overrides.excerpt,
    content: overrides.content ?? 'Body',
    status: overrides.status ?? 'published',
    author: overrides.author,
    createdAt,
    updatedAt,
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

describe('ValidationApplyPlannerService', () => {
  it('classifies missing paths into route request groups', () => {
    const plan = planMissingValidationPaths([
      '/',
      '/page/2',
      '/category/news/page/2',
      '/tag/dev%20log',
      '/2025/01/15/my%20post',
      '/2025/page/2',
      '/2025/01',
      '/2025/01/15',
      '/about',
    ]);

    expect(plan.requiresFallbackSectionRender).toBe(false);
    expect(plan.requestRootRoutes).toBe(true);
    expect(Array.from(plan.requestedCategories)).toEqual(['news']);
    expect(Array.from(plan.requestedTags)).toEqual(['dev log']);
    expect(plan.requestedPostRoutes).toEqual([
      { year: 2025, month: 1, day: 15, slug: 'my post' },
    ]);
    expect(Array.from(plan.requestedYears)).toContain(2025);
    expect(Array.from(plan.requestedYearMonths)).toContain('2025/01');
    expect(Array.from(plan.requestedYearMonthDays)).toContain('2025/01/15');
    expect(Array.from(plan.requestedPageSlugs)).toEqual(['about']);
  });

  it('expands targeted rerender plan with single-route lineage and available archives', () => {
    const publishedPost = makePost({
      id: 'p1',
      slug: 'post-one',
      categories: ['news'],
      tags: ['tag-1'],
      createdAt: new Date('2025-01-15T10:00:00.000Z'),
    });
    const pagePost = makePost({
      id: 'p2',
      slug: 'about',
      categories: ['page'],
      tags: [],
      createdAt: new Date('2025-01-10T10:00:00.000Z'),
    });

    const initialPlan = planMissingValidationPaths(['/2025/01/15/post-one', '/2025', '/about', '/category/missing']);

    const targeted = buildTargetedValidationPlan({
      initialPlan,
      publishedPosts: [publishedPost, pagePost],
      allCategories: new Set(['news', 'page']),
      allTags: new Set(['tag-1']),
      availableYearMonths: ['2025/01', '2025/02'],
      availableYearMonthDays: ['2025/01/15', '2025/02/20'],
    });

    expect(targeted.requestedPostIds.has('p1')).toBe(true);
    expect(targeted.requestedCategorySet.has('news')).toBe(true);
    expect(targeted.requestedCategorySet.has('missing')).toBe(false);
    expect(targeted.requestedTagSet.has('tag-1')).toBe(true);
    expect(targeted.requestedYears.has(2025)).toBe(true);
    expect(targeted.requestedYearMonths.has('2025/01')).toBe(true);
    expect(targeted.requestedYearMonths.has('2025/02')).toBe(true);
    expect(targeted.requestedYearMonthDays.has('2025/01/15')).toBe(true);
    expect(targeted.requestedYearMonthDays.has('2025/02/20')).toBe(true);
    expect(targeted.requestedPageSlugs.has('about')).toBe(true);
    expect(targeted.requestRootRoutes).toBe(true);
  });
});
