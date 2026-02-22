import type { PostData } from './PostEngine';
import type { GenerationPostIndexLike } from './GenerationSitemapFeedService';

export type GenerationSection = 'core' | 'single' | 'category' | 'tag' | 'date';

export type GenerationPostIndex = GenerationPostIndexLike;

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function buildGenerationPostIndex(posts: PostData[]): GenerationPostIndex {
  const postsByCategory = new Map<string, PostData[]>();
  const postsByTag = new Map<string, PostData[]>();
  const postsByYear = new Map<number, PostData[]>();
  const postsByYearMonth = new Map<string, PostData[]>();
  const postsByYearMonthDay = new Map<string, PostData[]>();

  const append = <TKey extends string | number>(target: Map<TKey, PostData[]>, key: TKey, post: PostData) => {
    const existing = target.get(key);
    if (existing) {
      existing.push(post);
      return;
    }
    target.set(key, [post]);
  };

  for (const post of posts) {
    for (const category of post.categories || []) {
      append(postsByCategory, category, post);
    }

    for (const tag of post.tags || []) {
      append(postsByTag, tag, post);
    }

    const createdAt = resolvePostCreatedAt(post);
    const year = createdAt.getFullYear();
    const month = String(createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(createdAt.getDate()).padStart(2, '0');
    const ym = `${year}/${month}`;
    const ymd = `${year}/${month}/${day}`;

    append(postsByYear, year, post);
    append(postsByYearMonth, ym, post);
    append(postsByYearMonthDay, ymd, post);
  }

  return {
    postsByCategory,
    postsByTag,
    postsByYear,
    postsByYearMonth,
    postsByYearMonthDay,
  };
}

function countPaginatedPages(totalPosts: number, maxPostsPerPage: number): number {
  if (totalPosts <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(totalPosts / maxPostsPerPage));
}

export function estimateGenerationUnitsBySection(params: {
  posts: PostData[];
  allCategories: Set<string>;
  allTags: Set<string>;
  yearsMap: Map<number, Date>;
  yearMonthsMap: Map<string, Date>;
  yearMonthDaysMap: Map<string, Date>;
  maxPostsPerPage: number;
  postIndex?: GenerationPostIndex;
}): Record<GenerationSection, number> {
  const {
    posts,
    allCategories,
    allTags,
    yearsMap,
    yearMonthsMap,
    yearMonthDaysMap,
    maxPostsPerPage,
    postIndex,
  } = params;

  const index = postIndex ?? buildGenerationPostIndex(posts);
  const rootPages = countPaginatedPages(posts.length, maxPostsPerPage);
  const pageRoutes = index.postsByCategory.get('page')?.length ?? 0;

  const categoryPages = Array.from(allCategories).reduce((sum, category) => {
    const count = index.postsByCategory.get(category)?.length ?? 0;
    return sum + countPaginatedPages(count, maxPostsPerPage);
  }, 0);

  const tagPages = Array.from(allTags).reduce((sum, tag) => {
    const count = index.postsByTag.get(tag)?.length ?? 0;
    return sum + countPaginatedPages(count, maxPostsPerPage);
  }, 0);

  let datePages = 0;

  for (const [year] of yearsMap) {
    const count = index.postsByYear.get(year)?.length ?? 0;
    datePages += countPaginatedPages(count, maxPostsPerPage);
  }

  for (const [ym] of yearMonthsMap) {
    const count = index.postsByYearMonth.get(ym)?.length ?? 0;
    datePages += countPaginatedPages(count, maxPostsPerPage);
  }

  for (const [ymd] of yearMonthDaysMap) {
    const count = index.postsByYearMonthDay.get(ymd)?.length ?? 0;
    datePages += countPaginatedPages(count, maxPostsPerPage);
  }

  return {
    core: 4 + rootPages + pageRoutes,
    single: posts.length,
    category: categoryPages,
    tag: tagPages,
    date: datePages,
  };
}
