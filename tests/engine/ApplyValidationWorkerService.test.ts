import { describe, expect, it } from 'vitest';
import {
  buildApplyValidationWorkerTasks,
  type ApplyValidationWorkerParams,
  type ApplyValidationLanguageParams,
} from '../../src/main/engine/ApplyValidationWorkerService';
import type { PostData } from '../../src/main/engine/PostEngine';
import { buildGenerationPostIndex } from '../../src/main/engine/GenerationPostIndexService';
import type { TargetedValidationPlan } from '../../src/main/engine/ValidationApplyPlannerService';
import type { SerializedBlogGenerationOptions } from '../../src/main/engine/GenerationWorkerData';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-15T10:00:00Z');
  return {
    id: overrides.id ?? 'post-1',
    projectId: 'test',
    title: overrides.title ?? 'Test Post',
    slug: overrides.slug ?? 'test-post',
    content: overrides.content ?? '# Test',
    status: 'published',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    publishedAt: createdAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
    availableLanguages: overrides.availableLanguages ?? [],
  };
}

function makeBaseParams(overrides?: Partial<ApplyValidationWorkerParams>): ApplyValidationWorkerParams {
  const options: SerializedBlogGenerationOptions = {
    projectId: 'test',
    projectName: 'Test Blog',
    dataDir: '/data',
    baseUrl: 'https://example.com',
  };

  return {
    options,
    maxPostsPerPage: 50,
    htmlDir: '/data/html',
    mediaItems: [],
    backlinksRecord: {},
    hashMapEntries: [],
    postFilePathEntries: [],
    postMediaLinksEntries: [],
    ...overrides,
  };
}

function makeEmptyTargetedPlan(overrides?: Partial<TargetedValidationPlan>): TargetedValidationPlan {
  return {
    requestedPostIds: new Set(),
    requestedCategorySet: new Set(),
    requestedTagSet: new Set(),
    requestedYears: new Set(),
    requestedYearMonths: new Set(),
    requestedYearMonthDays: new Set(),
    requestedPageSlugs: new Set(),
    requestRootRoutes: false,
    ...overrides,
  };
}

describe('buildApplyValidationWorkerTasks', () => {
  it('returns empty tasks when plan has no requests', () => {
    const posts = [makePost()];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan(),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    expect(tasks).toHaveLength(0);
  });

  it('creates a single-post task containing only requested post IDs', () => {
    const post1 = makePost({ id: 'p1', slug: 'post-one', tags: ['alpha'], categories: ['news'] });
    const post2 = makePost({ id: 'p2', slug: 'post-two', tags: ['beta'], categories: ['other'] });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedPostIds: new Set(['p1']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    const singleTasks = tasks.filter((t) => t.section === 'single');
    expect(singleTasks).toHaveLength(1);
    expect(singleTasks[0].posts).toHaveLength(1);
    expect(singleTasks[0].posts[0].id).toBe('p1');
  });

  it('creates a category task containing only requested categories', () => {
    const post1 = makePost({ id: 'p1', categories: ['news'], tags: [] });
    const post2 = makePost({ id: 'p2', categories: ['other'], tags: [] });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedCategorySet: new Set(['news']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    const catTasks = tasks.filter((t) => t.section === 'category');
    expect(catTasks).toHaveLength(1);
    expect(catTasks[0].allCategories).toEqual(['news']);
    expect(catTasks[0].postsByCategoryEntries).toHaveLength(1);
    expect(catTasks[0].postsByCategoryEntries![0][0]).toBe('news');
  });

  it('creates a tag task containing only requested tags', () => {
    const post1 = makePost({ id: 'p1', tags: ['alpha'] });
    const post2 = makePost({ id: 'p2', tags: ['beta'] });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedTagSet: new Set(['alpha']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    const tagTasks = tasks.filter((t) => t.section === 'tag');
    expect(tagTasks).toHaveLength(1);
    expect(tagTasks[0].allTags).toEqual(['alpha']);
    expect(tagTasks[0].postsByTagEntries).toHaveLength(1);
    expect(tagTasks[0].postsByTagEntries![0][0]).toBe('alpha');
  });

  it('creates a date task containing only requested year/month/day archives', () => {
    const post1 = makePost({ id: 'p1', createdAt: new Date('2025-01-15T10:00:00Z') });
    const post2 = makePost({ id: 'p2', createdAt: new Date('2024-06-20T10:00:00Z') });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const years = new Map<number, Date>([[2025, new Date()], [2024, new Date()]]);
    const yearMonths = new Map<string, Date>([['2025/01', new Date()], ['2024/06', new Date()]]);
    const yearMonthDays = new Map<string, Date>([['2025/01/15', new Date()], ['2024/06/20', new Date()]]);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedYears: new Set([2025]),
          requestedYearMonths: new Set(['2025/01']),
          requestedYearMonthDays: new Set(['2025/01/15']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years,
        yearMonths,
        yearMonthDays,
      },
    );

    const dateTasks = tasks.filter((t) => t.section === 'date');
    expect(dateTasks).toHaveLength(1);
    expect(dateTasks[0].yearsEntries).toHaveLength(1);
    expect(dateTasks[0].yearsEntries![0][0]).toBe(2025);
    expect(dateTasks[0].yearMonthsEntries).toHaveLength(1);
    expect(dateTasks[0].yearMonthsEntries![0][0]).toBe('2025/01');
    expect(dateTasks[0].yearMonthDaysEntries).toHaveLength(1);
    expect(dateTasks[0].yearMonthDaysEntries![0][0]).toBe('2025/01/15');
  });

  it('creates a core task when requestRootRoutes is true', () => {
    const posts = [makePost()];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestRootRoutes: true,
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    const coreTasks = tasks.filter((t) => t.section === 'core');
    expect(coreTasks).toHaveLength(1);
  });

  it('does not create core task when requestRootRoutes is false', () => {
    const posts = [makePost()];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestRootRoutes: false,
          requestedPostIds: new Set(['post-1']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    expect(tasks.filter((t) => t.section === 'core')).toHaveLength(0);
  });

  it('creates tasks across multiple sections for a comprehensive plan', () => {
    const post1 = makePost({
      id: 'p1', slug: 'target-post',
      categories: ['news'], tags: ['alpha'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
    });
    const post2 = makePost({
      id: 'p2', slug: 'other-post',
      categories: ['other'], tags: ['beta'],
      createdAt: new Date('2024-06-20T10:00:00Z'),
    });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const years = new Map<number, Date>([[2025, new Date()]]);
    const yearMonths = new Map<string, Date>([['2025/01', new Date()]]);
    const yearMonthDays = new Map<string, Date>([['2025/01/15', new Date()]]);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestRootRoutes: true,
          requestedPostIds: new Set(['p1']),
          requestedCategorySet: new Set(['news']),
          requestedTagSet: new Set(['alpha']),
          requestedYears: new Set([2025]),
          requestedYearMonths: new Set(['2025/01']),
          requestedYearMonthDays: new Set(['2025/01/15']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years,
        yearMonths,
        yearMonthDays,
      },
    );

    expect(tasks.filter((t) => t.section === 'core')).toHaveLength(1);
    expect(tasks.filter((t) => t.section === 'single')).toHaveLength(1);
    expect(tasks.filter((t) => t.section === 'category')).toHaveLength(1);
    expect(tasks.filter((t) => t.section === 'tag')).toHaveLength(1);
    expect(tasks.filter((t) => t.section === 'date')).toHaveLength(1);
    expect(tasks).toHaveLength(5);
  });

  it('sets language prefix on tasks for language subtree rendering', () => {
    const posts = [makePost({ id: 'p1', tags: ['alpha'] })];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedTagSet: new Set(['alpha']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
        languagePrefix: '/fr',
        mainLanguage: 'en',
      },
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].languagePrefix).toBe('/fr');
    expect(tasks[0].mainLanguage).toBe('en');
    expect(tasks[0].options.language).toBe('fr');
  });

  it('uses all route posts as lookupPosts regardless of targeted plan', () => {
    const post1 = makePost({ id: 'p1', slug: 'target', tags: ['alpha'] });
    const post2 = makePost({ id: 'p2', slug: 'other', tags: ['beta'] });
    const posts = [post1, post2];
    const postIndex = buildGenerationPostIndex(posts);

    const tasks = buildApplyValidationWorkerTasks(
      makeBaseParams(),
      {
        targetedPlan: makeEmptyTargetedPlan({
          requestedPostIds: new Set(['p1']),
        }),
        publishedRoutePosts: posts,
        publishedListPosts: posts,
        generationPostIndex: postIndex,
        years: new Map(),
        yearMonths: new Map(),
        yearMonthDays: new Map(),
      },
    );

    // Single task has only 1 post to render...
    expect(tasks[0].posts).toHaveLength(1);
    // ...but lookupPosts contains ALL posts for slug resolution
    expect(tasks[0].lookupPosts).toHaveLength(2);
  });
});
