import type { PostData } from './PostEngine';

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function buildApplyValidationArchives(posts: PostData[]): {
  allCategories: Set<string>;
  allTags: Set<string>;
  years: Map<number, Date>;
  yearMonths: Map<string, Date>;
  yearMonthDays: Map<string, Date>;
} {
  const allCategories = new Set<string>();
  const allTags = new Set<string>();
  const years = new Map<number, Date>();
  const yearMonths = new Map<string, Date>();
  const yearMonthDays = new Map<string, Date>();

  for (const post of posts) {
    for (const category of post.categories || []) allCategories.add(category);
    for (const tag of post.tags || []) allTags.add(tag);

    const createdAt = resolvePostCreatedAt(post);
    const updatedAt = post.updatedAt;
    const year = createdAt.getFullYear();
    const month = String(createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(createdAt.getDate()).padStart(2, '0');
    const ymKey = `${year}/${month}`;
    const ymdKey = `${year}/${month}/${day}`;

    if (!years.has(year) || updatedAt > years.get(year)!) {
      years.set(year, updatedAt);
    }
    if (!yearMonths.has(ymKey) || updatedAt > yearMonths.get(ymKey)!) {
      yearMonths.set(ymKey, updatedAt);
    }
    if (!yearMonthDays.has(ymdKey) || updatedAt > yearMonthDays.get(ymdKey)!) {
      yearMonthDays.set(ymdKey, updatedAt);
    }
  }

  return {
    allCategories,
    allTags,
    years,
    yearMonths,
    yearMonthDays,
  };
}

export function selectRequestedPosts(params: {
  publishedPosts: PostData[];
  requestedPostIds: Set<string>;
  requestedPageSlugs: Set<string>;
}): {
  requestedSinglePosts: PostData[];
  requestedPagePosts: PostData[];
} {
  const requestedSinglePosts = params.publishedPosts.filter((post) => params.requestedPostIds.has(post.id));
  const requestedPagePosts = params.publishedPosts.filter((post) => {
    if (!params.requestedPageSlugs.has(post.slug)) {
      return false;
    }
    const categories = Array.isArray(post.categories) ? post.categories : [];
    return categories.includes('page');
  });

  return {
    requestedSinglePosts,
    requestedPagePosts,
  };
}

export function buildRequestedArchiveMaps(params: {
  requestedYears: Set<number>;
  requestedYearMonths: Set<string>;
  requestedYearMonthDays: Set<string>;
  years: Map<number, Date>;
  yearMonths: Map<string, Date>;
  yearMonthDays: Map<string, Date>;
}): {
  requestedYearsMap: Map<number, Date>;
  requestedYearMonthsMap: Map<string, Date>;
  requestedYearMonthDaysMap: Map<string, Date>;
} {
  const requestedYearsMap = new Map<number, Date>();
  for (const year of params.requestedYears) {
    const lastmod = params.years.get(year);
    if (lastmod) {
      requestedYearsMap.set(year, lastmod);
    }
  }

  const requestedYearMonthsMap = new Map<string, Date>();
  for (const ym of params.requestedYearMonths) {
    const lastmod = params.yearMonths.get(ym);
    if (lastmod) {
      requestedYearMonthsMap.set(ym, lastmod);
    }
  }

  const requestedYearMonthDaysMap = new Map<string, Date>();
  for (const ymd of params.requestedYearMonthDays) {
    const lastmod = params.yearMonthDays.get(ymd);
    if (lastmod) {
      requestedYearMonthDaysMap.set(ymd, lastmod);
    }
  }

  return {
    requestedYearsMap,
    requestedYearMonthsMap,
    requestedYearMonthDaysMap,
  };
}
