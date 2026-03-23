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
  languagePlans: Map<string, MissingPathPlan>;
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

function classifyPath(
  normalizedPath: string,
  requestedCategories: Set<string>,
  requestedTags: Set<string>,
  requestedYears: Set<number>,
  requestedYearMonths: Set<string>,
  requestedYearMonthDays: Set<string>,
  requestedPostRoutes: RequestedPostRoute[],
  requestedPageSlugs: Set<string>,
  state: { requestRootRoutes: boolean; requiresFallbackSectionRender: boolean },
): void {
  if (normalizedPath === '/' || /^\/(page\/\d+)$/.test(normalizedPath)) {
    state.requestRootRoutes = true;
    return;
  }

  const categoryMatch = normalizedPath.match(/^\/category\/([^/]+)(?:\/page\/\d+)?$/);
  if (categoryMatch) {
    requestedCategories.add(decodePathSegment(categoryMatch[1]));
    return;
  }

  const tagMatch = normalizedPath.match(/^\/tag\/([^/]+)(?:\/page\/\d+)?$/);
  if (tagMatch) {
    requestedTags.add(decodePathSegment(tagMatch[1]));
    return;
  }

  const singleMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)$/);
  if (singleMatch) {
    requestedPostRoutes.push({
      year: Number(singleMatch[1]),
      month: Number(singleMatch[2]),
      day: Number(singleMatch[3]),
      slug: decodePathSegment(singleMatch[4]),
    });
    return;
  }

  const yearMatch = normalizedPath.match(/^\/(\d{4})(?:\/page\/\d+)?$/);
  if (yearMatch) {
    requestedYears.add(Number(yearMatch[1]));
    return;
  }

  const monthMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})(?:\/page\/\d+)?$/);
  if (monthMatch) {
    requestedYearMonths.add(`${monthMatch[1]}/${monthMatch[2]}`);
    return;
  }

  const dayMatch = normalizedPath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})(?:\/page\/\d+)?$/);
  if (dayMatch) {
    requestedYearMonthDays.add(`${dayMatch[1]}/${dayMatch[2]}/${dayMatch[3]}`);
    return;
  }

  const pageMatch = normalizedPath.match(/^\/([^/]+)$/);
  if (pageMatch) {
    requestedPageSlugs.add(decodePathSegment(pageMatch[1]));
    return;
  }

  state.requiresFallbackSectionRender = true;
}

function createEmptyPlan(): {
  requestedCategories: Set<string>;
  requestedTags: Set<string>;
  requestedYears: Set<number>;
  requestedYearMonths: Set<string>;
  requestedYearMonthDays: Set<string>;
  requestedPostRoutes: RequestedPostRoute[];
  requestedPageSlugs: Set<string>;
  state: { requestRootRoutes: boolean; requiresFallbackSectionRender: boolean };
  } {
  return {
    requestedCategories: new Set<string>(),
    requestedTags: new Set<string>(),
    requestedYears: new Set<number>(),
    requestedYearMonths: new Set<string>(),
    requestedYearMonthDays: new Set<string>(),
    requestedPostRoutes: [],
    requestedPageSlugs: new Set<string>(),
    state: { requestRootRoutes: false, requiresFallbackSectionRender: false },
  };
}

function finalizePlan(plan: ReturnType<typeof createEmptyPlan>, languagePlans: Map<string, MissingPathPlan>): MissingPathPlan {
  return {
    requestedCategories: plan.requestedCategories,
    requestedTags: plan.requestedTags,
    requestedYears: plan.requestedYears,
    requestedYearMonths: plan.requestedYearMonths,
    requestedYearMonthDays: plan.requestedYearMonthDays,
    requestedPostRoutes: plan.requestedPostRoutes,
    requestedPageSlugs: plan.requestedPageSlugs,
    requestRootRoutes: plan.state.requestRootRoutes,
    requiresFallbackSectionRender: plan.state.requiresFallbackSectionRender,
    languagePlans,
  };
}

export function planMissingValidationPaths(missingPaths: string[], additionalLanguages?: string[]): MissingPathPlan {
  const mainPlan = createEmptyPlan();
  const langPlanMap = new Map<string, ReturnType<typeof createEmptyPlan>>();
  const knownLanguages = new Set((additionalLanguages ?? []).map((l) => l.trim().toLowerCase()).filter((l) => l.length > 0));

  for (const missingPath of missingPaths) {
    const normalizedPath = normalizeUrlPath(missingPath);

    // Check for language prefix
    const langPrefixMatch = normalizedPath.match(/^\/([a-z]{2,3})(?:(\/.+))?$/);
    if (langPrefixMatch && knownLanguages.has(langPrefixMatch[1])) {
      const lang = langPrefixMatch[1];
      const strippedPath = langPrefixMatch[2] ? normalizeUrlPath(langPrefixMatch[2]) : '/';

      if (!langPlanMap.has(lang)) {
        langPlanMap.set(lang, createEmptyPlan());
      }
      const lp = langPlanMap.get(lang);
      if (!lp) {
        continue;
      }
      classifyPath(
        strippedPath,
        lp.requestedCategories,
        lp.requestedTags,
        lp.requestedYears,
        lp.requestedYearMonths,
        lp.requestedYearMonthDays,
        lp.requestedPostRoutes,
        lp.requestedPageSlugs,
        lp.state,
      );
      if (lp.state.requiresFallbackSectionRender) {
        mainPlan.state.requiresFallbackSectionRender = true;
        break;
      }
      continue;
    }

    classifyPath(
      normalizedPath,
      mainPlan.requestedCategories,
      mainPlan.requestedTags,
      mainPlan.requestedYears,
      mainPlan.requestedYearMonths,
      mainPlan.requestedYearMonthDays,
      mainPlan.requestedPostRoutes,
      mainPlan.requestedPageSlugs,
      mainPlan.state,
    );
    if (mainPlan.state.requiresFallbackSectionRender) {
      break;
    }
  }

  const languagePlans = new Map<string, MissingPathPlan>();
  for (const [lang, lp] of langPlanMap) {
    languagePlans.set(lang, finalizePlan(lp, new Map()));
  }

  return finalizePlan(mainPlan, languagePlans);
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

  // Upward cascade only: day → month → year
  for (const ymd of Array.from(requestedYearMonthDays.values())) {
    const [yearStr, monthStr] = ymd.split('/');
    requestedYears.add(Number(yearStr));
    requestedYearMonths.add(`${yearStr}/${monthStr}`);
  }

  for (const ym of Array.from(requestedYearMonths.values())) {
    const [yearStr] = ym.split('/');
    requestedYears.add(Number(yearStr));
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
    requestRootRoutes: initialPlan.requestRootRoutes || initialPlan.requestedPostRoutes.length > 0,
  };
}
