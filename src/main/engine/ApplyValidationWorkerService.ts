/**
 * Builds targeted worker tasks for the applyValidation flow.
 *
 * Takes a targeted validation plan and produces GenerationWorkerTask[]
 * scoped to only the affected sections (categories, tags, dates, singles, core).
 * This gives applyValidation the same worker-pool parallelism as full generation
 * while limiting the volume to only what's needed.
 */
import type { PostData } from './PostEngine';
import type { GenerationPostIndex } from './GenerationPostIndexService';
import type { TargetedValidationPlan } from './ValidationApplyPlannerService';
import type {
  GenerationWorkerTask,
  SerializedMediaData,
  SerializedBlogGenerationOptions,
} from './GenerationWorkerData';
import {
  serializePostData,
  serializePostMap,
  serializeDateMap,
} from './GenerationWorkerData';

export interface ApplyValidationWorkerParams {
  options: SerializedBlogGenerationOptions;
  maxPostsPerPage: number;
  htmlDir: string;
  mediaItems: SerializedMediaData[];
  backlinksRecord: Record<
    string,
    Array<{ id: string; title: string; slug: string }>
  >;
  hashMapEntries: Array<[string, string]>;
  postFilePathEntries: Array<[string, string]>;
  postMediaLinksEntries: Array<
    [string, Array<{ mediaId: string; sortOrder: number }>]
  >;
}

export interface ApplyValidationLanguageParams {
  targetedPlan: TargetedValidationPlan;
  publishedRoutePosts: PostData[];
  publishedListPosts: PostData[];
  generationPostIndex: GenerationPostIndex;
  years: Map<number, Date>;
  yearMonths: Map<string, Date>;
  yearMonthDays: Map<string, Date>;
  languagePrefix?: string;
  mainLanguage?: string;
}

export function buildApplyValidationWorkerTasks(
  base: ApplyValidationWorkerParams,
  lang: ApplyValidationLanguageParams,
): GenerationWorkerTask[] {
  const {
    targetedPlan,
    publishedRoutePosts,
    publishedListPosts,
    generationPostIndex,
  } = lang;

  const serializedRoutePosts = publishedRoutePosts.map(serializePostData);
  const serializedListPosts = publishedListPosts.map(serializePostData);

  const baseTaskData = {
    lookupPosts: serializedRoutePosts,
    mediaItems: base.mediaItems,
    backlinksMap: base.backlinksRecord,
    options: lang.languagePrefix
      ? { ...base.options, language: lang.languagePrefix.replace(/^\//, '') }
      : base.options,
    maxPostsPerPage: base.maxPostsPerPage,
    htmlDir: base.htmlDir,
    hashMapEntries: base.hashMapEntries,
    postFilePathEntries: base.postFilePathEntries,
    postMediaLinksEntries: base.postMediaLinksEntries,
    languagePrefix: lang.languagePrefix,
    mainLanguage: lang.mainLanguage,
  };

  const tasks: GenerationWorkerTask[] = [];
  let taskCounter = 0;
  const langSuffix = lang.languagePrefix
    ? `-${lang.languagePrefix.replace(/^\//, '')}`
    : '';
  const nextTaskId = (section: string) =>
    `apply-${section}${langSuffix}-${++taskCounter}`;

  // Core (root + page routes)
  if (targetedPlan.requestRootRoutes) {
    tasks.push({
      ...baseTaskData,
      taskId: nextTaskId('core'),
      section: 'core',
      posts: serializedListPosts,
    });
  }

  // Single posts
  if (targetedPlan.requestedPostIds.size > 0) {
    const requestedSinglePosts = publishedRoutePosts
      .filter((p) => targetedPlan.requestedPostIds.has(p.id))
      .map(serializePostData);

    if (requestedSinglePosts.length > 0) {
      tasks.push({
        ...baseTaskData,
        taskId: nextTaskId('single'),
        section: 'single',
        posts: requestedSinglePosts,
      });
    }
  }

  // Page-slug posts (separate from singles; they're resolved through core)
  // Pages are rendered via the 'core' section's generatePageRoutes call,
  // so they're covered by the requestRootRoutes task above.

  // Categories
  if (targetedPlan.requestedCategorySet.size > 0) {
    // Only include the requested categories and their post-index entries
    const filteredPostsByCategory = new Map<string, PostData[]>();
    for (const category of targetedPlan.requestedCategorySet) {
      const posts = generationPostIndex.postsByCategory.get(category);
      if (posts) {
        filteredPostsByCategory.set(category, posts);
      }
    }

    tasks.push({
      ...baseTaskData,
      taskId: nextTaskId('category'),
      section: 'category',
      posts: serializedListPosts,
      allCategories: Array.from(targetedPlan.requestedCategorySet),
      postsByCategoryEntries: serializePostMap(filteredPostsByCategory),
    });
  }

  // Tags
  if (targetedPlan.requestedTagSet.size > 0) {
    const filteredPostsByTag = new Map<string, PostData[]>();
    for (const tag of targetedPlan.requestedTagSet) {
      const posts = generationPostIndex.postsByTag.get(tag);
      if (posts) {
        filteredPostsByTag.set(tag, posts);
      }
    }

    tasks.push({
      ...baseTaskData,
      taskId: nextTaskId('tag'),
      section: 'tag',
      posts: serializedListPosts,
      allTags: Array.from(targetedPlan.requestedTagSet),
      postsByTagEntries: serializePostMap(filteredPostsByTag),
    });
  }

  // Date archives
  const { requestedYears, requestedYearMonths, requestedYearMonthDays } =
    targetedPlan;
  const hasDateRequests =
    requestedYears.size > 0 ||
    requestedYearMonths.size > 0 ||
    requestedYearMonthDays.size > 0;

  if (hasDateRequests) {
    // Filter archive maps to only the requested keys
    const filteredYears = new Map<number, Date>();
    for (const year of requestedYears) {
      const lastmod = lang.years.get(year);
      if (lastmod) {
        filteredYears.set(year, lastmod);
      }
    }

    const filteredYearMonths = new Map<string, Date>();
    for (const ym of requestedYearMonths) {
      const lastmod = lang.yearMonths.get(ym);
      if (lastmod) {
        filteredYearMonths.set(ym, lastmod);
      }
    }

    const filteredYearMonthDays = new Map<string, Date>();
    for (const ymd of requestedYearMonthDays) {
      const lastmod = lang.yearMonthDays.get(ymd);
      if (lastmod) {
        filteredYearMonthDays.set(ymd, lastmod);
      }
    }

    // Filter post-index entries to only the requested date keys
    const filteredPostsByYear = new Map<number, PostData[]>();
    for (const year of requestedYears) {
      const posts = generationPostIndex.postsByYear.get(year);
      if (posts) {
        filteredPostsByYear.set(year, posts);
      }
    }

    const filteredPostsByYearMonth = new Map<string, PostData[]>();
    for (const ym of requestedYearMonths) {
      const posts = generationPostIndex.postsByYearMonth.get(ym);
      if (posts) {
        filteredPostsByYearMonth.set(ym, posts);
      }
    }

    const filteredPostsByYearMonthDay = new Map<string, PostData[]>();
    for (const ymd of requestedYearMonthDays) {
      const posts = generationPostIndex.postsByYearMonthDay.get(ymd);
      if (posts) {
        filteredPostsByYearMonthDay.set(ymd, posts);
      }
    }

    tasks.push({
      ...baseTaskData,
      taskId: nextTaskId('date'),
      section: 'date',
      posts: serializedListPosts,
      yearsEntries: serializeDateMap(filteredYears),
      yearMonthsEntries: serializeDateMap(filteredYearMonths),
      yearMonthDaysEntries: serializeDateMap(filteredYearMonthDays),
      postsByYearEntries: serializePostMap(filteredPostsByYear),
      postsByYearMonthEntries: serializePostMap(filteredPostsByYearMonth),
      postsByYearMonthDayEntries: serializePostMap(filteredPostsByYearMonthDay),
    });
  }

  return tasks;
}
