import type { PostData } from './PostEngine';

export interface RequestedPostRoute {
  year: number;
  month: number;
  day: number;
  slug: string;
}

export interface MissingPathPlan {
  requestedCategories: Set<string>;
  requestedTags: Set<string>;
  requestedYears: Set<number>;
  requestedYearMonths: Set<string>;
  requestedYearMonthDays: Set<string>;
  requestedPostRoutes: RequestedPostRoute[];
  requestedPageSlugs: Set<string>;
  requestRootRoutes: boolean;
  requiresFallbackSectionRender: boolean;
}

export interface TargetedValidationPlan {
  requestedPostIds: Set<string>;
  requestedCategorySet: Set<string>;
  requestedTagSet: Set<string>;
  requestedYears: Set<number>;
  requestedYearMonths: Set<string>;
  requestedYearMonthDays: Set<string>;
  requestedPageSlugs: Set<string>;
  requestRootRoutes: boolean;
}

function normalizeUrlPath(urlPath: string): string {
  const trimmed = (urlPath || '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const noQuery = trimmed.split('?')[0]?.split('#')[0] ?? '';
  const withoutSlashes = noQuery.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}` : '/';
}

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function planMissingValidationPaths(missingPaths: string[]): MissingPathPlan {
  const requestedCategories = new Set<string>();
  const requestedTags = new Set<string>();
  const requestedYears = new Set<number>();
  const requestedYearMonths = new Set<string>();
  const requestedYearMonthDays = new Set<string>();
  const requestedPostRoutes: RequestedPostRoute[] = [];
  const requestedPageSlugs = new Set<string>();
  let requestRootRoutes = false;
  let requiresFallbackSectionRender = false;

  for (const missingPath of missingPaths) {
    const normalizedPath = normalizeUrlPath(missingPath);

    if (normalizedPath === '/' || /^\/page\/\d+$/.test(normalizedPath)) {
      requestRootRoutes = true;
      continue;
    }

    const categoryMatch = normalizedPath.match(/^\/category\/([^/]+)(?:\/page\/\d+)?$/);
    if (categoryMatch) {
      requestedCategories.add(decodePathSegment(categoryMatch[1]));
      continue;
    }

    const tagMatch = normalizedPath.match(/^\/tag\/([^/]+)(?:\/page\/\d+)?$/);
    if (tagMatch) {
      requestedTags.add(decodePathSegment(tagMatch[1]));
      continue;
    }

    const singleMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)$/);
    if (singleMatch) {
      requestedPostRoutes.push({
        year: Number(singleMatch[1]),
        month: Number(singleMatch[2]),
        day: Number(singleMatch[3]),
        slug: decodePathSegment(singleMatch[4]),
      });
      continue;
    }

    const yearMatch = normalizedPath.match(/^\/(\d{4})(?:\/page\/\d+)?$/);
    if (yearMatch) {
      requestedYears.add(Number(yearMatch[1]));
      continue;
    }

    const monthMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})(?:\/page\/\d+)?$/);
    if (monthMatch) {
      requestedYearMonths.add(`${monthMatch[1]}/${monthMatch[2]}`);
      continue;
    }

    const dayMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})(?:\/page\/\d+)?$/);
    if (dayMatch) {
      requestedYearMonthDays.add(`${dayMatch[1]}/${dayMatch[2]}/${dayMatch[3]}`);
      continue;
    }

    const pageMatch = normalizedPath.match(/^\/([^/]+)$/);
    if (pageMatch) {
      requestedPageSlugs.add(decodePathSegment(pageMatch[1]));
      continue;
    }

    requiresFallbackSectionRender = true;
    break;
  }

  return {
    requestedCategories,
    requestedTags,
    requestedYears,
    requestedYearMonths,
    requestedYearMonthDays,
    requestedPostRoutes,
    requestedPageSlugs,
    requestRootRoutes,
    requiresFallbackSectionRender,
  };
}

interface BuildTargetedValidationPlanParams {
  initialPlan: MissingPathPlan;
  publishedPosts: PostData[];
  allCategories: Set<string>;
  allTags: Set<string>;
  availableYearMonths: Iterable<string>;
  availableYearMonthDays: Iterable<string>;
}

export function buildTargetedValidationPlan(params: BuildTargetedValidationPlanParams): TargetedValidationPlan {
  const {
    initialPlan,
    publishedPosts,
    allCategories,
    allTags,
    availableYearMonths,
    availableYearMonthDays,
  } = params;

  const requestedCategories = new Set(initialPlan.requestedCategories);
  const requestedTags = new Set(initialPlan.requestedTags);
  const requestedYears = new Set(initialPlan.requestedYears);
  const requestedYearMonths = new Set(initialPlan.requestedYearMonths);
  const requestedYearMonthDays = new Set(initialPlan.requestedYearMonthDays);
  const requestedPostIds = new Set<string>();

  for (const requestedRoute of initialPlan.requestedPostRoutes) {
    const routePost = publishedPosts.find((post) => {
      if (post.slug !== requestedRoute.slug) {
        return false;
      }
      const createdAt = resolvePostCreatedAt(post);
      return createdAt.getFullYear() === requestedRoute.year
        && (createdAt.getMonth() + 1) === requestedRoute.month
        && createdAt.getDate() === requestedRoute.day;
    });

    if (routePost) {
      requestedPostIds.add(routePost.id);
      for (const category of routePost.categories || []) {
        requestedCategories.add(category);
      }
      for (const tag of routePost.tags || []) {
        requestedTags.add(tag);
      }

      const createdAt = resolvePostCreatedAt(routePost);
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');
      requestedYears.add(year);
      requestedYearMonths.add(`${year}/${month}`);
      requestedYearMonthDays.add(`${year}/${month}/${day}`);
    } else {
      requestedYears.add(requestedRoute.year);
      requestedYearMonths.add(`${requestedRoute.year}/${String(requestedRoute.month).padStart(2, '0')}`);
      requestedYearMonthDays.add(`${requestedRoute.year}/${String(requestedRoute.month).padStart(2, '0')}/${String(requestedRoute.day).padStart(2, '0')}`);
    }
  }

  for (const year of Array.from(requestedYears.values())) {
    for (const ym of availableYearMonths) {
      if (ym.startsWith(`${year}/`)) {
        requestedYearMonths.add(ym);
      }
    }
  }

  for (const ym of Array.from(requestedYearMonths.values())) {
    for (const ymd of availableYearMonthDays) {
      if (ymd.startsWith(`${ym}/`)) {
        requestedYearMonthDays.add(ymd);
      }
    }

    const [yearStr] = ym.split('/');
    requestedYears.add(Number(yearStr));
  }

  for (const ymd of Array.from(requestedYearMonthDays.values())) {
    const [yearStr, monthStr] = ymd.split('/');
    requestedYears.add(Number(yearStr));
    requestedYearMonths.add(`${yearStr}/${monthStr}`);
  }

  return {
    requestedPostIds,
    requestedCategorySet: new Set(
      Array.from(requestedCategories.values()).filter((category) => allCategories.has(category)),
    ),
    requestedTagSet: new Set(
      Array.from(requestedTags.values()).filter((tag) => allTags.has(tag)),
    ),
    requestedYears,
    requestedYearMonths,
    requestedYearMonthDays,
    requestedPageSlugs: new Set(initialPlan.requestedPageSlugs),
    requestRootRoutes: initialPlan.requestRootRoutes,
  };
}
