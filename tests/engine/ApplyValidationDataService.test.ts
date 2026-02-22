import { describe, expect, it } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import {
  buildApplyValidationArchives,
  buildRequestedArchiveMaps,
  selectRequestedPosts,
} from '../../src/main/engine/ApplyValidationDataService';

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
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

describe('ApplyValidationDataService', () => {
  it('builds category tag and date archives from list posts', () => {
    const posts = [
      makePost({ id: '1', categories: ['news'], tags: ['t1'], createdAt: new Date('2025-01-15T00:00:00.000Z') }),
      makePost({ id: '2', categories: ['page'], tags: [], createdAt: new Date('2025-02-20T00:00:00.000Z') }),
    ];

    const result = buildApplyValidationArchives(posts);

    expect(result.allCategories.has('news')).toBe(true);
    expect(result.allCategories.has('page')).toBe(true);
    expect(result.allTags.has('t1')).toBe(true);
    expect(result.years.has(2025)).toBe(true);
    expect(result.yearMonths.has('2025/01')).toBe(true);
    expect(result.yearMonths.has('2025/02')).toBe(true);
    expect(result.yearMonthDays.has('2025/01/15')).toBe(true);
    expect(result.yearMonthDays.has('2025/02/20')).toBe(true);
  });

  it('selects requested single/page posts and resolves requested date maps', () => {
    const publishedPosts = [
      makePost({ id: 'a', slug: 'post-a', categories: ['news'], createdAt: new Date('2025-01-15T00:00:00.000Z') }),
      makePost({ id: 'b', slug: 'about', categories: ['page'], createdAt: new Date('2025-01-10T00:00:00.000Z') }),
    ];

    const selected = selectRequestedPosts({
      publishedPosts,
      requestedPostIds: new Set(['a']),
      requestedPageSlugs: new Set(['about']),
    });

    expect(selected.requestedSinglePosts.map((p) => p.id)).toEqual(['a']);
    expect(selected.requestedPagePosts.map((p) => p.id)).toEqual(['b']);

    const archives = buildApplyValidationArchives(publishedPosts);
    const requested = buildRequestedArchiveMaps({
      requestedYears: new Set([2025]),
      requestedYearMonths: new Set(['2025/01']),
      requestedYearMonthDays: new Set(['2025/01/15']),
      years: archives.years,
      yearMonths: archives.yearMonths,
      yearMonthDays: archives.yearMonthDays,
    });

    expect(requested.requestedYearsMap.has(2025)).toBe(true);
    expect(requested.requestedYearMonthsMap.has('2025/01')).toBe(true);
    expect(requested.requestedYearMonthDaysMap.has('2025/01/15')).toBe(true);
  });
});
